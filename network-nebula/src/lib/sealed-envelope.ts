/**
 * sealed-envelope.ts
 *
 * Client-Side Cryptography for NetworkNebula Zero-Storage Architecture.
 * Implements:
 * 1. X25519 ECDH via @noble/curves/ed25519 (x25519)
 * 2. HKDF-SHA256 key derivation via WebCrypto SubtleCrypto
 * 3. AES-256-GCM authenticated encryption/decryption bound to job_id AAD
 * 4. Binary envelope packing matching worker unseal_envelope:
 *    PK_C (32B) + salt (16B) + IV (12B) + Tag (16B) + Ciphertext
 * 5. DEK generation, session/local storage retention, and .nebulakey export/import
 * 6. Local .safetensors adapter decryption with DEK
 */

import { x25519 } from "@noble/curves/ed25519.js";

export interface SealedEnvelopeResult {
  sealed_secrets_b64: string;
  ephemeral_pubkey_x25519: string;
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  aad: string;
}

export interface NebulaKeyFile {
  version: "nebula-v1";
  job_id: string;
  dek_b64: string;
  created_at: string;
  model_id?: string;
  notes?: string;
}

// ==============================================================================
// Binary / Base64 Helpers
// ==============================================================================

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  // Strip whitespace, data URLs if present
  let clean = base64.trim();
  if (clean.includes(",")) {
    clean = clean.split(",")[1];
  }
  // Convert URL-safe base64 to standard
  clean = clean.replace(/-/g, "+").replace(/_/g, "/");
  while (clean.length % 4 !== 0) {
    clean += "=";
  }
  const binaryString = atob(clean);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle || (globalThis as any).crypto?.webcrypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available in this environment.");
  }
  return subtle;
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// ==============================================================================
// Ephemeral X25519 Sealed Envelope Creation
// ==============================================================================

/**
 * Creates an X25519 + HKDF-SHA256 + AES-256-GCM sealed envelope matching
 * worker unseal_envelope specification.
 *
 * @param secrets Object containing secrets (e.g. { hf_token, dek_b64, dataset_get_url, checkpoint_put_url })
 * @param workerPubkeyB64 Base64-encoded 32-byte X25519 public key of worker
 * @param jobId Job ID used as AES-GCM Associated Authenticated Data (AAD)
 */
export async function sealEnvelope(
  secrets: Record<string, any>,
  workerPubkeyB64: string,
  jobId: string
): Promise<SealedEnvelopeResult> {
  const subtle = getSubtleCrypto();

  // 1. Parse worker X25519 public key (32 bytes)
  const workerPkBytes = base64ToUint8Array(workerPubkeyB64);
  if (workerPkBytes.length !== 32) {
    throw new Error(`Worker X25519 public key must be 32 bytes (got ${workerPkBytes.length})`);
  }

  // 2. Generate client ephemeral X25519 keypair
  const clientKeys = x25519.keygen();
  const clientSkBytes = clientKeys.secretKey;
  const clientPkBytes = clientKeys.publicKey;

  // 3. Compute shared secret via ECDH
  const sharedSecret = x25519.getSharedSecret(clientSkBytes, workerPkBytes);

  // 4. Generate random salt (16 bytes) and IV (12 bytes)
  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12);

  // 5. Derive 32-byte AES-GCM key using HKDF-SHA256 (info = "nebula-sealed-envelope-v1")
  const hkdfKey = await subtle.importKey(
    "raw",
    sharedSecret as unknown as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  const derivedAesKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      info: new TextEncoder().encode("nebula-sealed-envelope-v1") as unknown as BufferSource,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 6. Encrypt plaintext secrets with AES-256-GCM bound to AAD = jobId
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const aad = new TextEncoder().encode(jobId);

  const encryptedBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
      tagLength: 128,
    },
    derivedAesKey,
    plaintext as unknown as BufferSource
  );

  const encBytes = new Uint8Array(encryptedBuffer);
  // WebCrypto AES-GCM puts 16-byte tag at the end of ciphertext
  const ciphertext = encBytes.subarray(0, encBytes.length - 16);
  const tag = encBytes.subarray(encBytes.length - 16);

  // 7. Binary packing: PK_C (32B) + salt (16B) + IV (12B) + Tag (16B) + Ciphertext
  const envelopeBin = new Uint8Array(32 + 16 + 12 + 16 + ciphertext.length);
  envelopeBin.set(clientPkBytes, 0);
  envelopeBin.set(salt, 32);
  envelopeBin.set(iv, 48);
  envelopeBin.set(tag, 60);
  envelopeBin.set(ciphertext, 76);

  const envelopeB64 = uint8ArrayToBase64(envelopeBin);

  return {
    sealed_secrets_b64: envelopeB64,
    ephemeral_pubkey_x25519: uint8ArrayToBase64(clientPkBytes),
    salt: uint8ArrayToBase64(salt),
    nonce: uint8ArrayToBase64(iv),
    tag: uint8ArrayToBase64(tag),
    ciphertext: uint8ArrayToBase64(ciphertext),
    aad: jobId,
  };
}

// ==============================================================================
// Client-Side DEK (Data Encryption Key) Management
// ==============================================================================

/**
 * Generate a cryptographically secure 256-bit (32-byte) Data Encryption Key.
 */
export function generateDek(): Uint8Array {
  return getRandomBytes(32);
}

export function generateDekBase64(): string {
  return uint8ArrayToBase64(generateDek());
}

/**
 * Session & LocalStorage key management to prevent losing DEK on refresh.
 */
const DEK_STORAGE_PREFIX = "nebula_dek_";
const memoryDekStorage: Record<string, string> = {};

function getBrowserStorage(type: "local" | "session"): Storage | null {
  try {
    if (typeof window !== "undefined") {
      if (type === "local" && window.localStorage) return window.localStorage;
      if (type === "session" && window.sessionStorage) return window.sessionStorage;
    }
    if (typeof localStorage !== "undefined" && type === "local") return localStorage;
    if (typeof sessionStorage !== "undefined" && type === "session") return sessionStorage;
  } catch {
    // restricted storage
  }
  return null;
}

export function saveJobDek(jobId: string, dekB64: string): void {
  try {
    const ls = getBrowserStorage("local");
    const ss = getBrowserStorage("session");
    if (ls) ls.setItem(`${DEK_STORAGE_PREFIX}${jobId}`, dekB64);
    if (ss) ss.setItem(`${DEK_STORAGE_PREFIX}${jobId}`, dekB64);
    memoryDekStorage[jobId] = dekB64;
  } catch {
    memoryDekStorage[jobId] = dekB64;
  }
}

export function getJobDek(jobId: string): string | null {
  try {
    const ss = getBrowserStorage("session");
    const ls = getBrowserStorage("local");
    const val = (ss ? ss.getItem(`${DEK_STORAGE_PREFIX}${jobId}`) : null) ||
      (ls ? ls.getItem(`${DEK_STORAGE_PREFIX}${jobId}`) : null) ||
      memoryDekStorage[jobId] ||
      null;
    return val;
  } catch {
    return memoryDekStorage[jobId] || null;
  }
}

export function removeJobDek(jobId: string): void {
  try {
    const ls = getBrowserStorage("local");
    const ss = getBrowserStorage("session");
    if (ls) ls.removeItem(`${DEK_STORAGE_PREFIX}${jobId}`);
    if (ss) ss.removeItem(`${DEK_STORAGE_PREFIX}${jobId}`);
    delete memoryDekStorage[jobId];
  } catch {
    delete memoryDekStorage[jobId];
  }
}

export function listSavedJobDeks(): Record<string, string> {
  const result: Record<string, string> = { ...memoryDekStorage };
  try {
    const ls = getBrowserStorage("local");
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (key && key.startsWith(DEK_STORAGE_PREFIX)) {
          const jobId = key.slice(DEK_STORAGE_PREFIX.length);
          const val = ls.getItem(key);
          if (val) result[jobId] = val;
        }
      }
    }
  } catch {
    // ignore
  }
  return result;
}

// ==============================================================================
// .nebulakey Export & Import
// ==============================================================================

/**
 * Export a .nebulakey recovery file to user's computer.
 */
export function exportNebulaKey(
  jobId: string,
  dekB64: string,
  extra?: { model_id?: string; notes?: string }
): void {
  const keyData: NebulaKeyFile = {
    version: "nebula-v1",
    job_id: jobId,
    dek_b64: dekB64,
    created_at: new Date().toISOString(),
    model_id: extra?.model_id,
    notes: extra?.notes,
  };

  const jsonStr = JSON.stringify(keyData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nebula-${jobId.slice(0, 8)}.nebulakey`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate a .nebulakey file content.
 */
export function parseNebulaKey(fileContent: string): NebulaKeyFile {
  let parsed: any;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err: any) {
    throw new Error("Invalid .nebulakey file: not valid JSON format.");
  }

  if (parsed.version !== "nebula-v1") {
    throw new Error(`Unsupported .nebulakey version: ${parsed.version || "unknown"}`);
  }
  if (!parsed.job_id || typeof parsed.job_id !== "string") {
    throw new Error("Invalid .nebulakey file: missing 'job_id'");
  }
  if (!parsed.dek_b64 || typeof parsed.dek_b64 !== "string") {
    throw new Error("Invalid .nebulakey file: missing 'dek_b64'");
  }

  return parsed as NebulaKeyFile;
}

// ==============================================================================
// Safetensors Format Detection & Local Decryption
// ==============================================================================

/**
 * Checks if raw bytes represent an unencrypted safetensors file.
 * Safetensors begins with an 8-byte little-endian uint64 header size,
 * followed by a UTF-8 JSON header string.
 */
export function isSafetensorsFile(bytes: Uint8Array): boolean {
  if (bytes.length < 10) return false;
  // Read first 8 bytes as little endian uint64
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLenLow = view.getUint32(0, true);
  const headerLenHigh = view.getUint32(4, true);

  // If header length high 32 bits is non-zero, it's either corrupt or encrypted
  if (headerLenHigh !== 0) return false;
  if (headerLenLow <= 0 || headerLenLow > bytes.length - 8) return false;

  // Next byte should be '{'
  return bytes[8] === 0x7b; // '{' in ASCII
}

/**
 * Decrypts a downloaded .safetensors adapter buffer using client DEK.
 * If the buffer is already unencrypted safetensors, returns it directly.
 * Handles both standard WebCrypto AES-GCM (IV + Ciphertext + Tag) and
 * packed envelope (IV + Tag + Ciphertext) formats.
 */
export async function decryptSafetensors(
  input: ArrayBuffer | Uint8Array,
  dekB64: string,
  jobId?: string
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const rawBytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // Check if already raw unencrypted safetensors
  if (isSafetensorsFile(rawBytes)) {
    return rawBytes;
  }

  // Parse DEK
  const dekBytes = base64ToUint8Array(dekB64);
  if (dekBytes.length !== 32) {
    throw new Error(`Invalid DEK length: expected 32 bytes, got ${dekBytes.length}`);
  }

  const aesKey = await subtle.importKey(
    "raw",
    dekBytes as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // An encrypted safetensors payload needs at least 12 (IV) + 16 (Tag) = 28 bytes
  if (rawBytes.length < 28) {
    throw new Error("Ciphertext too short to contain IV and authentication tag.");
  }

  // Candidates for AAD
  const aadCandidates: (BufferSource | undefined)[] = [];
  if (jobId) {
    aadCandidates.push(new TextEncoder().encode(jobId) as unknown as BufferSource);
  }
  aadCandidates.push(undefined);

  // Candidate formats:
  // Format 1: IV (12B) + Ciphertext + Tag (16B) (Standard WebCrypto streaming output)
  // Format 2: IV (12B) + Tag (16B) + Ciphertext (Nebula envelope convention)
  const iv = rawBytes.subarray(0, 12);

  // Format 1 cipher payload:
  const payloadFormat1 = rawBytes.subarray(12); // length >= 16 (has tag at end)

  // Format 2 cipher payload:
  const tagFormat2 = rawBytes.subarray(12, 28);
  const ciphertextFormat2 = rawBytes.subarray(28);
  const payloadFormat2 = new Uint8Array(ciphertextFormat2.length + 16);
  payloadFormat2.set(ciphertextFormat2, 0);
  payloadFormat2.set(tagFormat2, ciphertextFormat2.length);

  const payloadCandidates = [payloadFormat1, payloadFormat2];

  let lastError: any = null;

  for (const aad of aadCandidates) {
    for (const payload of payloadCandidates) {
      try {
        const decryptedBuffer = await subtle.decrypt(
          {
            name: "AES-GCM",
            iv: iv as unknown as BufferSource,
            additionalData: aad,
            tagLength: 128,
          },
          aesKey,
          payload as unknown as BufferSource
        );
        const result = new Uint8Array(decryptedBuffer);
        return result;
      } catch (err: any) {
        lastError = err;
      }
    }
  }

  throw new Error(
    `Failed to decrypt safetensors: invalid DEK or corrupted ciphertext (${lastError?.message || lastError})`
  );
}

/**
 * Triggers a browser download of a decrypted safetensors adapter file.
 */
export function downloadSafetensorsFile(bytes: Uint8Array, filename = "adapter_model.safetensors"): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
