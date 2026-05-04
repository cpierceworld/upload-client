import { UploadStatus } from './upload-status';
import { WorkerMode } from './tokens';

export type ClientToWorker =
  | {
      type: 'register';
      clientId: string;
      serverUrl: string;
      maxConcurrentParts: number;
      workerMode: WorkerMode;
      eviction: { ttlMs: number; maxTerminal: number };
    }
  | {
      type: 'addUpload';
      clientId: string;
      clientKey: string;
      requestId: string;
      file: File;
    }
  | {
      type: 'addCustomUpload';
      uploadId: string;
      clientId: string;
      clientKey: string;
      fileName: string;
      fileSize: number;
    }
  | {
      type: 'updateCustomUpload';
      uploadId: string;
      status: 'complete' | 'failed' | 'cancelled';
      error?: string;
    }
  | { type: 'subscribeMine'; clientId: string; clientKey?: string }
  | { type: 'subscribeAll' }
  | { type: 'cancelUpload'; uploadId: string }
  | { type: 'retryUpload'; uploadId: string };

export type WorkerToClient =
  | { type: 'uploadAdded'; requestId: string; uploadId: string }
  | { type: 'uploadUpdate'; status: UploadStatus }
  | { type: 'snapshot'; scope: 'mine' | 'all'; uploads: UploadStatus[] }
  | { type: 'error'; uploadId?: string; requestId?: string; message: string };
