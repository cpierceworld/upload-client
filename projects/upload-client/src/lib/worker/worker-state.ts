import { ClientToWorker, WorkerToClient } from '../messages';
import { UploadStatus } from '../upload-status';
import { crc32Base64 } from './crc32';
import {
  abortUpload,
  completeUpload,
  getStatus,
  initiateUpload,
  PartUploadError,
  putPart,
  refreshUrls,
} from './worker-api';

interface PartSlot {
  url: string;
  expiresAt: number; // epoch ms
}

interface InternalUpload extends UploadStatus {
  file?: File;
  fileIdNumeric: number;
  partUrls: PartSlot[];
  partSize: number;
  failedDispatch: boolean;
  abortController: AbortController;
  nextPartToDispatch: number;
  terminatedAt?: number;
}

const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled']);
const EVICTION_INTERVAL_MS = 30_000;

export interface WorkerSidePort {
  postMessage(msg: WorkerToClient): void;
}

interface PortInfo {
  clientId?: string;
  subscribesMine: boolean;
  subscribesAll: boolean;
}

const HEARTBEAT_INTERVAL_MS = 120_000;
const URL_REFRESH_GUARD_MS = 60_000; // refresh if URL within this window of expiry

export class WorkerState {
  private uploads = new Map<string, InternalUpload>();
  private inFlight = 0;
  private maxConcurrentParts = 6;
  private serverUrl = '';
  private configured = false;
  private ports = new Map<WorkerSidePort, PortInfo>();
  private evictionTtlMs = 5 * 60_000;
  private maxTerminal = 200;
  private refreshInFlight = new Map<string, Promise<void>>();
  private evictionTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    setInterval(() => this.tickHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  attachPort(port: WorkerSidePort): void {
    this.ports.set(port, { subscribesMine: false, subscribesAll: false });
  }

  detachPort(port: WorkerSidePort): void {
    this.ports.delete(port);
  }

  handleMessage(port: WorkerSidePort, msg: ClientToWorker): void {
    switch (msg.type) {
      case 'register':
        this.register(port, msg);
        return;
      case 'addUpload':
        void this.addUpload(port, msg);
        return;
      case 'addCustomUpload':
        this.addCustomUpload(msg);
        return;
      case 'updateCustomUpload':
        this.updateCustomUpload(msg);
        return;
      case 'subscribeMine':
        this.subscribeMine(port, msg.clientId, msg.clientKey);
        return;
      case 'subscribeAll':
        this.subscribeAll(port);
        return;
      case 'cancelUpload':
        this.cancelUpload(msg.uploadId);
        return;
      case 'retryUpload':
        void this.retryUpload(msg.uploadId);
        return;
    }
  }

  private addCustomUpload(
    msg: Extract<ClientToWorker, { type: 'addCustomUpload' }>
  ): void {
    if (this.uploads.has(msg.uploadId)) return;
    const upload: InternalUpload = {
      uploadId: msg.uploadId,
      clientId: msg.clientId,
      clientKey: msg.clientKey,
      kind: 'custom',
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      status: 'processing',
      totalParts: 0,
      completedParts: 0,
      inFlightParts: 0,
      bytesUploaded: 0,
      progressPercent: 0,
      createdAt: Date.now(),
      fileIdNumeric: 0,
      partUrls: [],
      partSize: 0,
      failedDispatch: true,
      abortController: new AbortController(),
      nextPartToDispatch: 1,
    };
    this.uploads.set(msg.uploadId, upload);
    this.broadcastUpdate(msg.uploadId);
  }

  private updateCustomUpload(
    msg: Extract<ClientToWorker, { type: 'updateCustomUpload' }>
  ): void {
    const upload = this.uploads.get(msg.uploadId);
    if (!upload || upload.kind !== 'custom') return;
    if (TERMINAL_STATUSES.has(upload.status)) return;
    upload.status = msg.status;
    if (msg.status === 'complete') upload.progressPercent = 100;
    if (msg.error) upload.error = msg.error;
    upload.terminatedAt = Date.now();
    this.broadcastUpdate(msg.uploadId);
  }

  private async retryUpload(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.status !== 'failed') return;
    if (upload.kind === 'custom') return;
    try {
      const res = await refreshUrls(this.serverUrl, upload.fileIdNumeric);
      for (const p of res.presignedUrls) {
        upload.partUrls[p.partNumber - 1] = {
          url: p.url,
          expiresAt: Date.parse(p.expiresAt),
        };
      }
      const remaining = res.presignedUrls
        .map((p) => p.partNumber)
        .sort((a, b) => a - b);
      upload.completedParts = res.currentProgress.completedParts;
      upload.bytesUploaded = Math.min(
        upload.completedParts * upload.partSize,
        upload.fileSize
      );
      upload.progressPercent = Math.floor(
        (upload.completedParts / upload.totalParts) * 100
      );
      upload.nextPartToDispatch = remaining[0] ?? upload.totalParts + 1;
      upload.failedDispatch = false;
      upload.error = undefined;
      upload.terminatedAt = undefined;
      upload.abortController = new AbortController();
      upload.status = 'uploading';
      this.broadcastUpdate(uploadId);
      this.pump();
      if (remaining.length === 0) {
        void this.complete(uploadId);
      }
    } catch (err) {
      upload.error = err instanceof Error ? err.message : String(err);
      this.broadcastUpdate(uploadId);
    }
  }

  private register(
    port: WorkerSidePort,
    msg: Extract<ClientToWorker, { type: 'register' }>
  ): void {
    const info = this.ports.get(port);
    if (info) info.clientId = msg.clientId;
    if (!this.configured) {
      this.serverUrl = msg.serverUrl;
      this.maxConcurrentParts = msg.maxConcurrentParts;
      this.evictionTtlMs = msg.eviction.ttlMs;
      this.maxTerminal = msg.eviction.maxTerminal;
      this.configured = true;
      if (!this.evictionTimer) {
        this.evictionTimer = setInterval(
          () => this.evictTerminal(),
          EVICTION_INTERVAL_MS
        );
      }
    }
  }

  private evictTerminal(): void {
    const now = Date.now();
    let removed = 0;
    const survivors: InternalUpload[] = [];
    for (const u of this.uploads.values()) {
      if (!TERMINAL_STATUSES.has(u.status)) continue;
      const t = u.terminatedAt ?? now;
      if (t + this.evictionTtlMs < now) {
        this.uploads.delete(u.uploadId);
        removed++;
      } else {
        survivors.push(u);
      }
    }
    if (survivors.length > this.maxTerminal) {
      survivors.sort((a, b) => (a.terminatedAt ?? 0) - (b.terminatedAt ?? 0));
      const drop = survivors.length - this.maxTerminal;
      for (let i = 0; i < drop; i++) {
        this.uploads.delete(survivors[i].uploadId);
        removed++;
      }
    }
    if (removed > 0) {
      const snap = this.publicSnapshot();
      for (const [port, info] of this.ports) {
        if (info.subscribesAll) {
          this.send(port, { type: 'snapshot', scope: 'all', uploads: snap });
        }
        if (info.subscribesMine && info.clientId) {
          const id = info.clientId;
          const mine = snap.filter(
            (u) => u.clientId === id
          );
          this.send(port, { type: 'snapshot', scope: 'mine', uploads: mine });
        }
      }
    }
  }

  private subscribeMine(port: WorkerSidePort, clientId: string, clientKey?: string): void {
    const info = this.ports.get(port);
    if (!info) return;
    info.subscribesMine = true;
    info.clientId = clientId;
    info.clientKey = clientKey;
    const mine = this.publicSnapshot().filter(
      (u) => u.clientId === clientId && (!clientKey || u.clientKey === clientKey)
    );
    this.send(port, { type: 'snapshot', scope: 'mine', uploads: mine });
  }

  private subscribeAll(port: WorkerSidePort): void {
    const info = this.ports.get(port);
    if (!info) return;
    info.subscribesAll = true;
    this.send(port, { type: 'snapshot', scope: 'all', uploads: this.publicSnapshot() });
  }

  private async addUpload(
    port: WorkerSidePort,
    msg: Extract<ClientToWorker, { type: 'addUpload' }>
  ): Promise<void> {
    const provisionalId = msg.requestId;
    const provisional: InternalUpload = {
      uploadId: provisionalId,
      clientId: msg.clientId,
      clientKey: msg.clientKey,
      kind: 'standard',
      fileName: msg.file.name,
      fileSize: msg.file.size,
      status: 'initiating',
      totalParts: 0,
      completedParts: 0,
      inFlightParts: 0,
      bytesUploaded: 0,
      progressPercent: 0,
      createdAt: Date.now(),
      file: msg.file,
      fileIdNumeric: 0,
      partUrls: [],
      partSize: 0,
      failedDispatch: false,
      abortController: new AbortController(),
      nextPartToDispatch: 1,
    };
    this.uploads.set(provisionalId, provisional);
    this.broadcastUpdate(provisionalId);

    let crc32Hash: string;
    try {
      crc32Hash = await crc32Base64(msg.file);
    } catch (err) {
      this.uploads.delete(provisionalId);
      const message = err instanceof Error ? err.message : String(err);
      this.send(port, { type: 'error', requestId: msg.requestId, message: `crc32 failed: ${message}` });
      return;
    }

    let init;
    try {
      init = await initiateUpload(this.serverUrl, {
        fileName: msg.file.name,
        fileSize: msg.file.size,
        mimeType: msg.file.type || 'application/octet-stream',
        crc32Hash,
        userDescription: msg.file.name,
      });
    } catch (err) {
      this.uploads.delete(provisionalId);
      const message = err instanceof Error ? err.message : String(err);
      this.send(port, { type: 'error', requestId: msg.requestId, message });
      return;
    }

    const uploadId = init.uploadId;
    const totalParts = init.presignedUrls.length;
    const partUrls: PartSlot[] = new Array(totalParts);
    for (const p of init.presignedUrls) {
      partUrls[p.partNumber - 1] = {
        url: p.url,
        expiresAt: Date.parse(p.expiresAt),
      };
    }

    this.uploads.delete(provisionalId);
    const upload: InternalUpload = {
      uploadId,
      clientId: msg.clientId,
      clientKey: msg.clientKey,
      kind: 'standard',
      fileName: msg.file.name,
      fileSize: msg.file.size,
      status: 'queued',
      totalParts,
      completedParts: 0,
      inFlightParts: 0,
      bytesUploaded: 0,
      progressPercent: 0,
      createdAt: Date.now(),
      file: msg.file,
      fileIdNumeric: init.fileId,
      partUrls,
      partSize: init.partSize,
      failedDispatch: false,
      abortController: new AbortController(),
      nextPartToDispatch: 1,
    };
    this.uploads.set(uploadId, upload);
    this.broadcastUploadAdded(upload, msg.requestId, uploadId);
    this.broadcastUpdate(uploadId);
    this.pump();
  }

  private broadcastUploadAdded(
    upload: InternalUpload,
    requestId: string,
    uploadId: string
  ): void {
    for (const [port, info] of this.ports) {
      const matchesMine =
        info.subscribesMine &&
        info.clientId === upload.clientId;
      const matchesAll = info.subscribesAll;
      if (matchesMine || matchesAll) {
        this.send(port, { type: 'uploadAdded', requestId, uploadId });
      }
    }
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrentParts) {
      const upload = this.pickNextDispatch();
      if (!upload) return;
      const partNumber = upload.nextPartToDispatch++;
      this.inFlight++;
      void this.runPart(upload.uploadId, partNumber).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  private pickNextDispatch(): InternalUpload | undefined {
    let best: InternalUpload | undefined;
    for (const u of this.uploads.values()) {
      if (u.failedDispatch) continue;
      if (u.nextPartToDispatch > u.totalParts) continue;
      if (!best || u.inFlightParts < best.inFlightParts) best = u;
    }
    return best;
  }

  private async ensureFreshUrls(uploadId: string): Promise<void> {
    let pending = this.refreshInFlight.get(uploadId);
    if (pending) return pending;
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    pending = (async () => {
      try {
        const res = await refreshUrls(this.serverUrl, upload.fileIdNumeric);
        for (const p of res.presignedUrls) {
          upload.partUrls[p.partNumber - 1] = {
            url: p.url,
            expiresAt: Date.parse(p.expiresAt),
          };
        }
      } finally {
        this.refreshInFlight.delete(uploadId);
      }
    })();
    this.refreshInFlight.set(uploadId, pending);
    return pending;
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
    const blob = upload.file!.slice(start, end);

    const slot = upload.partUrls[partNumber - 1];
    if (slot && slot.expiresAt - Date.now() < URL_REFRESH_GUARD_MS) {
      try {
        await this.ensureFreshUrls(uploadId);
      } catch {
        // fall through; the PUT may still succeed, or fail and trigger retry
      }
    }

    let attemptedRefresh = false;
    let backoffIdx = 0;
    const backoffMs = [250, 1000, 4000];
    while (true) {
      const fresh = upload.partUrls[partNumber - 1];
      try {
        await putPart(fresh.url, blob, upload.abortController.signal);
        upload.completedParts++;
        upload.bytesUploaded += end - start;
        upload.progressPercent = Math.floor(
          (upload.completedParts / upload.totalParts) * 100
        );
        break;
      } catch (err) {
        if (upload.status === 'cancelled') {
          upload.inFlightParts--;
          this.broadcastUpdate(uploadId);
          return;
        }
        const status = err instanceof PartUploadError ? err.status : undefined;
        if (status === 403 && !attemptedRefresh) {
          attemptedRefresh = true;
          try {
            await this.ensureFreshUrls(uploadId);
            continue;
          } catch {
            // fall through to transient handling
          }
        }
        const transient =
          status === undefined || status >= 500 || status === 408 || status === 429;
        if (transient && backoffIdx < backoffMs.length) {
          await new Promise((r) => setTimeout(r, backoffMs[backoffIdx++]));
          continue;
        }
        upload.inFlightParts--;
        upload.status = 'failed';
        upload.error = err instanceof Error ? err.message : String(err);
        upload.failedDispatch = true;
        upload.terminatedAt = Date.now();
        this.broadcastUpdate(uploadId);
        return;
      }
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
    upload.terminatedAt = Date.now();
    if (upload.kind !== 'custom') {
      upload.abortController.abort();
      void abortUpload(this.serverUrl, upload.fileIdNumeric);
    }
    this.broadcastUpdate(uploadId);
  }

  private async complete(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    upload.status = 'completing';
    this.broadcastUpdate(uploadId);
    try {
      const res = await completeUpload(this.serverUrl, upload.fileIdNumeric);
      upload.etag = res.etag;
      upload.status = 'complete';
      upload.progressPercent = 100;
    } catch (err) {
      upload.status = 'failed';
      upload.error = err instanceof Error ? err.message : String(err);
    }
    upload.terminatedAt = Date.now();
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
        if (upload.fileIdNumeric === 0) continue; // not yet initiated
        void getStatus(this.serverUrl, upload.fileIdNumeric).catch(() => {
          // best-effort; failures surface via PUT errors
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
      clientKey: u.clientKey,
      kind: u.kind,
      fileName: u.fileName,
      fileSize: u.fileSize,
      status: u.status,
      totalParts: u.totalParts,
      completedParts: u.completedParts,
      inFlightParts: u.inFlightParts,
      bytesUploaded: u.bytesUploaded,
      progressPercent: u.progressPercent,
      etag: u.etag,
      error: u.error,
      createdAt: u.createdAt,
    };
  }

  private broadcastUpdate(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;
    const status = this.publicStatus(upload);
    for (const [port, info] of this.ports) {
      const matchesMine =
        info.subscribesMine &&
        info.clientId === status.clientId &&
        (!info.clientKey || info.clientKey === status.clientKey);
      const matchesAll = info.subscribesAll;
      if (matchesMine || matchesAll) {
        this.send(port, { type: 'uploadUpdate', status });
      }
    }
  }

  private send(port: WorkerSidePort, msg: WorkerToClient): void {
    try {
      port.postMessage(msg);
    } catch {
      this.ports.delete(port);
    }
  }
}
