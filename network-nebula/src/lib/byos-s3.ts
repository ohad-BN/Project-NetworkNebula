/**
 * byos-s3.ts
 *
 * Direct BYOS (Bring Your Own Storage) S3 & Cloudflare R2 Client-Side Uploader.
 * Adheres strictly to Zero-Storage Mandate:
 * - Direct client-to-storage PUT (0 B data sent to Oracle coordinator).
 * - Avoids Cloudflare R2 "501 Not Implemented" error by never using S3 form POST.
 * - Credentials stored exclusively in client localStorage (never sent in plaintext to API).
 */

export interface ByosConfig {
  provider: "cloudflare_r2" | "aws_s3" | "custom_s3";
  endpoint: string; // e.g. https://<account_id>.r2.cloudflarestorage.com or https://s3.us-east-1.amazonaws.com
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlPrefix?: string;
}

const BYOS_STORAGE_KEY = "nebula_byos_config_v1";
const memoryStorage: Record<string, string> = {};

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // restricted storage
  }
  return null;
}

/**
 * Load saved BYOS credentials from localStorage.
 */
export function loadByosConfig(): ByosConfig | null {
  try {
    const storage = getLocalStorage();
    const raw = storage ? storage.getItem(BYOS_STORAGE_KEY) : memoryStorage[BYOS_STORAGE_KEY];
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.endpoint && parsed.bucket) {
      return parsed as ByosConfig;
    }
  } catch {
    // Ignore corrupt storage
  }
  return null;
}

/**
 * Persist BYOS credentials strictly in client localStorage.
 */
export function saveByosConfig(config: ByosConfig): void {
  try {
    const raw = JSON.stringify(config);
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(BYOS_STORAGE_KEY, raw);
    } else {
      memoryStorage[BYOS_STORAGE_KEY] = raw;
    }
  } catch (err) {
    console.error("Failed to save BYOS config to localStorage", err);
  }
}

/**
 * Clear saved BYOS credentials from localStorage.
 */
export function clearByosConfig(): void {
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.removeItem(BYOS_STORAGE_KEY);
    }
    delete memoryStorage[BYOS_STORAGE_KEY];
  } catch {
    // Ignore
  }
}

export interface UploadProgressCallback {
  (progressPercent: number, bytesLoaded: number, bytesTotal: number): void;
}

/**
 * Uploads a file or binary payload directly to Cloudflare R2 or AWS S3
 * via a presigned PUT URL.
 * Strictly uses HTTP PUT (never POST) to avoid Cloudflare R2 501 errors.
 */
export function uploadToPresignedPutUrl(
  presignedPutUrl: string,
  data: Blob | File | ArrayBuffer | Uint8Array,
  contentType = "application/octet-stream",
  onProgress?: UploadProgressCallback
): Promise<{ success: boolean; status: number; etag?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedPutUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          onProgress(pct, evt.loaded, evt.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") || undefined;
        resolve({ success: true, status: xhr.status, etag });
      } else {
        reject(
          new Error(
            `Direct S3/R2 PUT upload failed (HTTP ${xhr.status}): ${xhr.statusText || xhr.responseText}`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during direct S3/R2 presigned PUT upload"));
    };

    xhr.ontimeout = () => {
      reject(new Error("Timeout during direct S3/R2 presigned PUT upload"));
    };

    let body: BodyInit;
    if (data instanceof Uint8Array) {
      body = new Blob([data as BlobPart], { type: contentType });
    } else if (data instanceof ArrayBuffer) {
      body = new Blob([data], { type: contentType });
    } else {
      body = data;
    }

    xhr.send(body);
  });
}

/**
 * Construct an S3 URI or clean public URL from bucket and object key.
 */
export function constructS3Uri(bucket: string, objectKey: string, provider: ByosConfig["provider"]): string {
  const cleanKey = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;
  if (provider === "cloudflare_r2") {
    return `r2://${bucket}/${cleanKey}`;
  }
  return `s3://${bucket}/${cleanKey}`;
}
