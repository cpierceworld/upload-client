export interface InitiateResponse {
  fileId: string;
  partSize: number;
  totalParts: number;
  parts: { partNumber: number; uploadUrl: string }[];
}

export interface CompleteResponse {
  success: boolean;
  sha256: string;
}

export async function initiateUpload(
  serverUrl: string,
  fileName: string,
  fileSize: number
): Promise<InitiateResponse> {
  const res = await fetch(`${serverUrl}/api/upload/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileSize }),
  });
  if (!res.ok) throw new Error(`initiate failed: HTTP ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`PUT part failed: HTTP ${res.status}`);
}

export async function cancelUpload(serverUrl: string, fileId: string): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/upload/${fileId}`, { method: 'DELETE' });
  } catch (err) {
    console.warn(`[upload-worker] cancel DELETE failed for ${fileId}`, err);
  }
}

export async function sendHeartbeat(serverUrl: string, fileId: string): Promise<void> {
  await fetch(`${serverUrl}/api/upload/${fileId}/heartbeat`, { method: 'POST' });
}

export async function completeUpload(
  serverUrl: string,
  fileId: string
): Promise<CompleteResponse> {
  const res = await fetch(`${serverUrl}/api/upload/${fileId}/complete`, { method: 'POST' });
  if (!res.ok) throw new Error(`complete failed: HTTP ${res.status}`);
  return res.json();
}
