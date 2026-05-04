import { Inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, map } from 'rxjs';
import { ClientToWorker, WorkerToClient } from './messages';
import { AlternativeUploadConfig, UPLOAD_CLIENT_CONFIG, ResolvedUploadClientConfig } from './tokens';
import { UploadStatus } from './upload-status';

interface ClientPort {
  postMessage(msg: ClientToWorker): void;
  setOnMessage(h: (msg: WorkerToClient) => void): void;
  start(): void;
  close(): void;
}

function sharedPort(p: MessagePort): ClientPort {
  return {
    postMessage: (m) => p.postMessage(m),
    setOnMessage: (h) => {
      p.onmessage = (e: MessageEvent<WorkerToClient>) => h(e.data);
    },
    start: () => p.start(),
    close: () => p.close(),
  };
}

function dedicatedPort(w: Worker): ClientPort {
  return {
    postMessage: (m) => w.postMessage(m),
    setOnMessage: (h) => {
      w.onmessage = (e: MessageEvent<WorkerToClient>) => h(e.data);
    },
    start: () => {
      // dedicated workers do not require start()
    },
    close: () => w.terminate(),
  };
}

@Injectable()
export class UploadService implements OnDestroy {
  private port: ClientPort;
  private myMap = new Map<string, UploadStatus>();
  private allMap = new Map<string, UploadStatus>();
  private myUploads = new BehaviorSubject<UploadStatus[]>([]);
  private allUploads = new BehaviorSubject<UploadStatus[]>([]);
  private pendingByRequestId = new Map<string, Subject<UploadStatus>>();
  private subjectByUploadId = new Map<string, Subject<UploadStatus>>();
  private customSubs = new Map<string, Subscription>();

  readonly myUploads$ = this.myUploads.asObservable();
  readonly allUploads$ = this.allUploads.asObservable();

  constructor(
    @Inject(UPLOAD_CLIENT_CONFIG) private readonly cfg: ResolvedUploadClientConfig
  ) {
    const want = cfg.workerMode;
    const canShare = typeof SharedWorker !== 'undefined';
    if (want === 'shared' && !canShare) {
      console.warn('[upload-client] SharedWorker unavailable; falling back to dedicated.');
    }
    const useShared = want === 'shared' && canShare;
    this.port = useShared
      ? sharedPort(
          new SharedWorker(
            new URL('./worker/upload.worker.shared', import.meta.url),
            { type: 'module', name: 'upload-shared-worker' }
          ).port
        )
      : dedicatedPort(
          new Worker(new URL('./worker/upload.worker.dedicated', import.meta.url), {
            type: 'module',
          })
        );
    this.port.setOnMessage((msg) => this.handle(msg));
    this.port.start();

    this.send({
      type: 'register',
      clientId: cfg.clientId,
      serverUrl: cfg.serverUrl,
      maxConcurrentParts: cfg.maxConcurrentParts,
      workerMode: cfg.workerMode,
      eviction: cfg.eviction,
    });
    this.send({ type: 'subscribeMine', clientId: cfg.clientId });
    this.send({ type: 'subscribeAll' });
  }

  upload(file: File, opts?: { clientKey?: string }): Observable<UploadStatus> {
    const alt = this.cfg.alternativeUpload;
    if (alt && alt.matches(file)) {
      return this.runCustomUpload(file, opts, alt);
    }
    const requestId = crypto.randomUUID();
    const subject = new Subject<UploadStatus>();
    this.pendingByRequestId.set(requestId, subject);
    this.send({
      type: 'addUpload',
      clientId: this.cfg.clientId,
      clientKey: opts?.clientKey ?? '',
      requestId,
      file,
    });
    return subject.asObservable();
  }

  uploadsByKey$(key: string): Observable<UploadStatus[]> {
    return this.myUploads$.pipe(map((list) => list.filter((u) => u.clientKey === key)));
  }

  cancelUpload(uploadId: string): void {
    const sub = this.customSubs.get(uploadId);
    if (sub) {
      sub.unsubscribe();
      this.customSubs.delete(uploadId);
      this.send({ type: 'updateCustomUpload', uploadId, status: 'cancelled' });
      return;
    }
    this.send({ type: 'cancelUpload', uploadId });
  }

  retryUpload(uploadId: string): void {
    if (uploadId.startsWith('custom:')) return;
    this.send({ type: 'retryUpload', uploadId });
  }

  ngOnDestroy(): void {
    for (const sub of this.customSubs.values()) sub.unsubscribe();
    this.customSubs.clear();
    this.port.close();
  }

  private send(msg: ClientToWorker): void {
    this.port.postMessage(msg);
  }

  private runCustomUpload(
    file: File,
    opts: { clientKey?: string } | undefined,
    alt: AlternativeUploadConfig
  ): Observable<UploadStatus> {
    const uploadId = 'custom:' + crypto.randomUUID();
    const subject = new Subject<UploadStatus>();
    this.subjectByUploadId.set(uploadId, subject);

    this.send({
      type: 'addCustomUpload',
      uploadId,
      clientId: this.cfg.clientId,
      clientKey: opts?.clientKey ?? '',
      fileName: file.name,
      fileSize: file.size,
    });

    const sub = alt.handler(file).subscribe({
      next: () => {},
      complete: () => {
        if (!this.customSubs.has(uploadId)) return;
        this.customSubs.delete(uploadId);
        this.send({ type: 'updateCustomUpload', uploadId, status: 'complete' });
      },
      error: (err) => {
        if (!this.customSubs.has(uploadId)) return;
        this.customSubs.delete(uploadId);
        this.send({
          type: 'updateCustomUpload',
          uploadId,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      },
    });
    this.customSubs.set(uploadId, sub);

    return subject.asObservable();
  }

  private handle(msg: WorkerToClient): void {
    switch (msg.type) {
      case 'uploadAdded': {
        if (this.myMap.delete(msg.requestId)) {
          this.myUploads.next(this.snapshot(this.myMap));
        }
        if (this.allMap.delete(msg.requestId)) {
          this.allUploads.next(this.snapshot(this.allMap));
        }
        const subject = this.pendingByRequestId.get(msg.requestId);
        if (subject) {
          this.subjectByUploadId.set(msg.uploadId, subject);
          this.pendingByRequestId.delete(msg.requestId);
        }
        return;
      }
      case 'uploadUpdate': {
        const status = msg.status;
        if (status.clientId === this.cfg.clientId) {
          this.myMap.set(status.uploadId, status);
          this.myUploads.next(this.snapshot(this.myMap));
        }
        this.allMap.set(status.uploadId, status);
        this.allUploads.next(this.snapshot(this.allMap));

        const terminal =
          status.status === 'complete' ||
          status.status === 'failed' ||
          status.status === 'cancelled';

        if (terminal) {
          const sub = this.customSubs.get(status.uploadId);
          if (sub) {
            sub.unsubscribe();
            this.customSubs.delete(status.uploadId);
          }
        }

        const subject = this.subjectByUploadId.get(status.uploadId);
        if (subject) {
          subject.next(status);
          if (terminal) {
            subject.complete();
            this.subjectByUploadId.delete(status.uploadId);
          }
        }
        return;
      }
      case 'snapshot': {
        const target = msg.scope === 'mine' ? this.myMap : this.allMap;
        target.clear();
        for (const u of msg.uploads) target.set(u.uploadId, u);
        const subject = msg.scope === 'mine' ? this.myUploads : this.allUploads;
        subject.next(this.snapshot(target));
        return;
      }
      case 'error': {
        if (msg.requestId) {
          if (this.myMap.delete(msg.requestId)) {
            this.myUploads.next(this.snapshot(this.myMap));
          }
          if (this.allMap.delete(msg.requestId)) {
            this.allUploads.next(this.snapshot(this.allMap));
          }
          const subject = this.pendingByRequestId.get(msg.requestId);
          if (subject) {
            subject.error(new Error(msg.message));
            this.pendingByRequestId.delete(msg.requestId);
          }
        }
        console.error('[UploadService]', msg.message);
        return;
      }
    }
  }

  private snapshot(map: Map<string, UploadStatus>): UploadStatus[] {
    return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
}
