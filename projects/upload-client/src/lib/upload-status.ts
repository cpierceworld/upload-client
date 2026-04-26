export type UploadStatusValue =
  | 'queued'
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface UploadStatus {
  uploadId: string;
  clientId: string;
  fileName: string;
  fileSize: number;
  status: UploadStatusValue;
  totalParts: number;
  completedParts: number;
  inFlightParts: number;
  bytesUploaded: number;
  progressPercent: number;
  sha256?: string;
  error?: string;
  createdAt: number;
}
