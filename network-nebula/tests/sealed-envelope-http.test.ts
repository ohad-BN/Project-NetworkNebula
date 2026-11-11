import { describe, expect, test } from "bun:test";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  base64ToUint8Array,
  decryptSafetensors,
  generateDekBase64,
  sealEnvelope,
  uint8ArrayToBase64,
} from "../src/lib/sealed-envelope";

function buildDummySafetensors(): Uint8Array {
  const headerJson = JSON.stringify({
    "lora_A.weight": { dtype: "F32", shape: [2, 2], data_offsets: [0, 16] },
  });
  const headerBytes = new TextEncoder().encode(headerJson);
  const tensorBytes = new Uint8Array(16).fill(42);
  const out = new Uint8Array(8 + headerBytes.length + tensorBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, headerBytes.length, true);
  view.setUint32(4, 0, true);
  out.set(headerBytes, 8);
  out.set(tensorBytes, 8 + headerBytes.length);
  return out;
}

async function withMockedHttpCrypto<T>(fn: () => Promise<T>): Promise<T> {
  const origCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const realCrypto = globalThis.crypto;
  // Simulate plain-HTTP browser crypto: getRandomValues exists, crypto.subtle is absent
  const httpCryptoMock = {
    getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
  };
  Object.defineProperty(globalThis, "crypto", {
    value: httpCryptoMock,
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (origCryptoDesc) {
      Object.defineProperty(globalThis, "crypto", origCryptoDesc);
    }
  }
}

describe("sealed-envelope HTTP (no SubtleCrypto) & WebCrypto interop", () => {
  test("decryptSafetensors passes through raw unencrypted .safetensors even without SubtleCrypto", async () => {
    const raw = buildDummySafetensors();
    const dekB64 = generateDekBase64();
    const out = await withMockedHttpCrypto(() => decryptSafetensors(raw, dekB64, "job-123"));
    expect(out).toEqual(raw);
  });

  test("decryptSafetensors rejects HTML SPA fallback page clearly without SubtleCrypto", async () => {
    const html = new TextEncoder().encode("<!doctype html><html><body>SPA</body></html>");
    const dekB64 = generateDekBase64();
    await expect(
      withMockedHttpCrypto(() => decryptSafetensors(html, dekB64, "job-123"))
    ).rejects.toThrow(/HTML instead of \.safetensors/);
  });

  test("sealEnvelope without SubtleCrypto unseals cleanly under WebCrypto subtle.decrypt", async () => {
    const workerKeys = x25519.keygen();
    const workerPubB64 = uint8ArrayToBase64(workerKeys.publicKey);
    const jobId = "7059fbb5-2719-403e-9bb7-59962ffd28de";
    const secrets = { hf_token: "hf_secret_123", dek_b64: generateDekBase64() };

    const envelope = await withMockedHttpCrypto(() =>
      sealEnvelope(secrets, workerPubB64, jobId)
    );

    const bin = base64ToUint8Array(envelope.sealed_secrets_b64);
    expect(bin.length).toBeGreaterThan(76);
    const clientPk = bin.subarray(0, 32);
    const salt = bin.subarray(32, 48);
    const iv = bin.subarray(48, 60);
    const tag = bin.subarray(60, 76);
    const ct = bin.subarray(76);

    const shared = x25519.getSharedSecret(workerKeys.secretKey, clientPk);
    const hkdfKey = await globalThis.crypto.subtle.importKey(
      "raw",
      shared as unknown as BufferSource,
      { name: "HKDF" },
      false,
      ["deriveKey"]
    );
    const aesKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as unknown as BufferSource,
        info: new TextEncoder().encode("nebula-sealed-envelope-v1") as unknown as BufferSource,
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const combined = new Uint8Array(ct.length + 16);
    combined.set(ct, 0);
    combined.set(tag, ct.length);

    const decryptedBuf = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: new TextEncoder().encode(jobId) as unknown as BufferSource,
        tagLength: 128,
      },
      aesKey,
      combined as unknown as BufferSource
    );
    const unsealed = JSON.parse(new TextDecoder().decode(decryptedBuf));
    expect(unsealed).toEqual(secrets);
  });

  test("decryptSafetensors without SubtleCrypto decrypts WebCrypto AES-GCM payloads (with AAD)", async () => {
    const raw = buildDummySafetensors();
    const dekB64 = generateDekBase64();
    const dekBytes = base64ToUint8Array(dekB64);
    const jobId = "job-http-decrypt-test";
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(jobId);

    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      dekBytes as unknown as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    const encrypted = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv as unknown as BufferSource,
          additionalData: aad as unknown as BufferSource,
          tagLength: 128,
        },
        key,
        raw as unknown as BufferSource
      )
    );
    // Format 1: IV + Ciphertext + Tag
    const format1 = new Uint8Array(12 + encrypted.length);
    format1.set(iv, 0);
    format1.set(encrypted, 12);

    const dec1 = await withMockedHttpCrypto(() => decryptSafetensors(format1, dekB64, jobId));
    expect(dec1).toEqual(raw);

    // Format 2: IV + Tag + Ciphertext
    const ct = encrypted.subarray(0, encrypted.length - 16);
    const tag = encrypted.subarray(encrypted.length - 16);
    const format2 = new Uint8Array(12 + 16 + ct.length);
    format2.set(iv, 0);
    format2.set(tag, 12);
    format2.set(ct, 28);

    const dec2 = await withMockedHttpCrypto(() => decryptSafetensors(format2, dekB64, jobId));
    expect(dec2).toEqual(raw);
  });
});
