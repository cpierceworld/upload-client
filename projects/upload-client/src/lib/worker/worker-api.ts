export interface PresignedUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface InitiateRequestBody {
  fileName: string;
  fileSize: number;
  mimeType: string;
  crc32Hash: string;
  userDescription: string;
  userTags?: string[];
  encryptionNote?: string;
}

export interface InitiateResponse {
  fileId: number;
  uploadId: string;
  presignedUrls: PresignedUrl[];
  partSize: number;
  expiresAt: string;
}

export interface CompleteResponse {
  fileId: number;
  s3Key: string;
  etag: string;
  sizeBytes: number;
  completedAt: string;
}

export interface RefreshUrlsResponse {
  fileId: number;
  uploadId: string;
  presignedUrls: PresignedUrl[];
  currentProgress: { completedParts: number; remainingParts: number; totalParts: number };
  expiresAt: string;
}

export interface StatusResponse {
  fileId: number;
  status: string;
  uploadId: string;
  expiresAt: string;
  totalPartsExpected: number;
  partsCompleted: number;
  parts: Array<{ partNumber: number; etag: string; sizeBytes: number; expectedSizeByes: number }>;
}

export async function initiateUpload(
  serverUrl: string,
  body: InitiateRequestBody
): Promise<InitiateResponse> {
  const res = await fetch(`${serverUrl}/api/upload/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`initiate failed: HTTP ${res.status}`);
  return res.json();
}

export class PartUploadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function putPart(
  uploadUrl: string,
  blob: Blob,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
    signal,
  });
  if (!res.ok) {
    throw new PartUploadError(`PUT part failed: HTTP ${res.status}`, res.status);
  }
}

export async function completeUpload(
  serverUrl: string,
  fileId: number | string
): Promise<CompleteResponse> {
  const res = await fetch(`${serverUrl}/api/upload/${fileId}/complete`, { method: 'POST' });
  if (!res.ok) throw new Error(`complete failed: HTTP ${res.status}`);
  return res.json();
}

export async function abortUpload(
  serverUrl: string,
  fileId: number | string
): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/upload/abort/${fileId}`, { method: 'POST' });
  } catch (err) {
    console.warn(`[upload-worker] abort failed for ${fileId}`, err);
  }
}

export async function getStatus(
  serverUrl: string,
  fileId: number | string
): Promise<StatusResponse> {
  const res = await fetch(`${serverUrl}/api/upload/${fileId}/status`, { method: 'GET' });
  if (!res.ok) throw new Error(`status failed: HTTP ${res.status}`);
  return res.json();
}

export async function refreshUrls(
  serverUrl: string,
  fileId: number | string
): Promise<RefreshUrlsResponse> {
  const res = await fetch(`${serverUrl}/api/upload/${fileId}/refresh-urls`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`refresh-urls failed: HTTP ${res.status}`);
  return res.json();
}
