import { UploadStatus } from './upload-status';

export type ClientToWorker =
  | { type: 'register'; clientId: string; serverUrl: string; maxConcurrentParts: number }
  | { type: 'addUpload'; clientId: string; requestId: string; file: File }
  | { type: 'subscribeMine'; clientId: string }
  | { type: 'subscribeAll' }
  | { type: 'cancelUpload'; uploadId: string };

export type WorkerToClient =
  | { type: 'uploadAdded'; requestId: string; uploadId: string }
  | { type: 'uploadUpdate'; status: UploadStatus }
  | { type: 'snapshot'; scope: 'mine' | 'all'; uploads: UploadStatus[] }
  | { type: 'error'; uploadId?: string; requestId?: string; message: string };
