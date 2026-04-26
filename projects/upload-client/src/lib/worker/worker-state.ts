import { ClientToWorker, WorkerToClient } from '../messages';
import { UploadStatus } from '../upload-status';
import {
  cancelUpload as cancelUploadOnServer,
  completeUpload,
  initiateUpload,
  putPart,
  sendHeartbeat,
} from './worker-api';

interface InternalUpload extends UploadStatus {
  file: File;
  partUrls: string[];
  partSize: number;
  failedDispatch: boolean;
  abortController: AbortController;
}

interface PortInfo {
  clientId?: string;
  subscribesMine: boolean;
  subscribesAll: boolean;
}

const HEARTBEAT_INTERVAL_MS = 120_000;

export class WorkerState {
  private uploads = new Map<string, InternalUpload>();
  private partQueue: { uploadId: string; partNumber: number }[] = [];
  private inFlight = 0;
  private maxConcurrentParts = 6;
  private serverUrl = '';
  private configured = false;
  private ports = new Map<MessagePort, PortInfo>();

  constructor() {
    setInterval(() => this.tickHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  attachPort(port: MessagePort): void {
    this.ports.set(port, { subscribesMine: false, subscribesAll: false });
  }

  detachPort(port: MessagePort): void {
    this.ports.delete(port);
  }

  handleMessage(port: MessagePort, msg: ClientToWorker): void {
    switch (msg.type) {
      case 'register':
        this.register(port, msg);
        return;
      case 'addUpload':
        void this.addUpload(port, msg);
        return;
      case 'subscribeMine':
        this.subscribeMine(port, msg.clientId);
        return;
      case 'subscribeAll':
        this.subscribeAll(port);
        return;
      case 'cancelUpload':
        this.cancelUpload(msg.uploadId);
        return;
    }
  }

  private register(
    port: MessagePort,
    msg: Extract<ClientToWorker, { type: 'register' }>
  ): void {
    const info = this.ports.get(port);
    if (info) info.clientId = msg.clientId;
    if (!this.configured) {
      this.serverUrl = msg.serverUrl;
      this.maxConcurrentParts = msg.maxConcurrentParts;
      this.configured = true;
    }
  }

  private subscribeMine(port: MessagePort, clientId: string): void {
    const info = this.ports.get(port);
    if (!info) return;
    info.subscribesMine = true;
    info.clientId = clientId;
    const mine = this.publicSnapshot().filter((u) => u.clientId === clientId);
    this.send(port, { type: 'snapshot', scope: 'mine', uploads: mine });
  }

  private subscribeAll(port: MessagePort): void {
    const info = this.ports.get(port);
    if (!info) return;
    info.subscribesAll = true;
    this.send(port, { type: 'snapshot', scope: 'all', uploads: this.publicSnapshot() });
  }

  private async addUpload(
    port: MessagePort,
    msg: Extract<ClientToWorker, { type: 'addUpload' }>
  ): Promise<void> {
    let uploadId: string;
    try {
      const init = await initiateUpload(this.serverUrl, msg.file.name, msg.file.size);
      uploadId = init.fileId;
      const status: InternalUpload = {
        uploadId,
        clientId: msg.clientId,
        fileName: msg.file.name,
        fileSize: msg.file.size,
        status: 'queued',
        totalParts: init.totalParts,
        completedParts: 0,
        inFlightParts: 0,
        bytesUploaded: 0,
        progressPercent: 0,
        createdAt: Date.now(),
        file: msg.file,
        partUrls: init.parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => p.uploadUrl),
        partSize: init.partSize,
        failedDispatch: false,
        abortController: new AbortController(),
      };
      this.uploads.set(uploadId, status);
      this.send(port, { type: 'uploadAdded', requestId: msg.requestId, uploadId });
      this.broadcastUpdate(uploadId);
      for (let p = 1; p <= init.totalParts; p++) {
        this.partQueue.push({ uploadId, partNumber: p });
      }
      this.pump();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(port, { type: 'error', requestId: msg.requestId, message });
    }
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrentParts && this.partQueue.length > 0) {
      const job = this.partQueue.shift()!;
      const upload = this.uploads.get(job.uploadId);
      if (!upload || upload.failedDispatch) continue;
      this.inFlight++;
      void this.runPart(job.uploadId, job.partNumber).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  private async runPart(uploadId: string, partNumber: number): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.failedDispatch) return;

    if (upload.status === 'queued') {
      upload.status = 'uploading';
    }
    upload.inFlightParts++;
    this.broadcastUpdate(uploadId);

    const start = (partNumber - 1) * upload.partSize;
    const end = Math.min(start + upload.partSize, upload.fileSize);
    const blob = upload.file.slice(start, end);
    const url = upload.partUrls[partNumber - 1];

    try {
      await putPart(url, blob, upload.abortController.signal);
      upload.completedParts++;
      upload.bytesUploaded += end - start;
      upload.progressPercent = Math.floor(
        (upload.completedParts / upload.totalParts) * 100
      );
    } catch (err) {
      upload.inFlightParts--;
      if (upload.status === 'cancelled') {
        this.broadcastUpdate(uploadId);
        return;
      }
      upload.status = 'failed';
      upload.error = err instanceof Error ? err.message : String(err);
      upload.failedDispatch = true;
      this.broadcastUpdate(uploadId);
      return;
    }

    upload.inFlightParts--;
    this.broadcastUpdate(uploadId);

    if (upload.completedParts === upload.totalParts && upload.status !== 'failed') {
      void this.complete(uploadId);
    }
  }

  private cancelUpload(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    if (
      upload.status === 'complete' ||
      upload.status === 'failed' ||
      upload.status === 'cancelled'
    ) {
      return;
    }
    upload.status = 'cancelled';
    upload.failedDispatch = true;
    this.partQueue = this.partQueue.filter((j) => j.uploadId !== uploadId);
    upload.abortController.abort();
    void cancelUploadOnServer(this.serverUrl, uploadId);
    this.broadcastUpdate(uploadId);
  }

  private async complete(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    upload.status = 'completing';
    this.broadcastUpdate(uploadId);
    try {
      const res = await completeUpload(this.serverUrl, uploadId);
      upload.sha256 = res.sha256;
      upload.status = 'complete';
      upload.progressPercent = 100;
    } catch (err) {
      upload.status = 'failed';
      upload.error = err instanceof Error ? err.message : String(err);
    }
    this.broadcastUpdate(uploadId);
  }

  private tickHeartbeats(): void {
    if (!this.configured) return;
    for (const upload of this.uploads.values()) {
      if (
        upload.status === 'initiating' ||
        upload.status === 'uploading' ||
        upload.status === 'completing'
      ) {
        void sendHeartbeat(this.serverUrl, upload.uploadId).catch(() => {
          // best-effort; failures are surfaced via the upload status if a part PUT fails
        });
      }
    }
  }

  private publicSnapshot(): UploadStatus[] {
    return Array.from(this.uploads.values()).map((u) => this.publicStatus(u));
  }

  private publicStatus(u: InternalUpload): UploadStatus {
    return {
      uploadId: u.uploadId,
      clientId: u.clientId,
      fileName: u.fileName,
      fileSize: u.fileSize,
      status: u.status,
      totalParts: u.totalParts,
      completedParts: u.completedParts,
      inFlightParts: u.inFlightParts,
      bytesUploaded: u.bytesUploaded,
      progressPercent: u.progressPercent,
      sha256: u.sha256,
      error: u.error,
      createdAt: u.createdAt,
    };
  }

  private broadcastUpdate(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    const status = this.publicStatus(upload);
    for (const [port, info] of this.ports) {
      const matchesMine = info.subscribesMine && info.clientId === status.clientId;
      const matchesAll = info.subscribesAll;
      if (matchesMine || matchesAll) {
        this.send(port, { type: 'uploadUpdate', status });
      }
    }
  }

  private send(port: MessagePort, msg: WorkerToClient): void {
    try {
      port.postMessage(msg);
    } catch {
      this.ports.delete(port);
    }
  }
}
