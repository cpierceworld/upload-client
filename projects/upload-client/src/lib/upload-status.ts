export type UploadStatusValue =
  | 'queued'
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface UploadStatus {
  uploadId: string;
  clientId: string;
  clientKey: string;
  kind: 'standard' | 'custom';
  fileName: string;
  fileSize: number;
  status: UploadStatusValue;
  totalParts: number;
  completedParts: number;
  inFlightParts: number;
  bytesUploaded: number;
  progressPercent: number;
  etag?: string;
  error?: string;
  createdAt: number;
}
