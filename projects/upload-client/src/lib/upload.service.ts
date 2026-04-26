import { Inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { ClientToWorker, WorkerToClient } from './messages';
import { UPLOAD_CLIENT_CONFIG, ResolvedUploadClientConfig } from './tokens';
import { UploadStatus } from './upload-status';

@Injectable()
export class UploadService implements OnDestroy {
  private port: MessagePort;
  private myMap = new Map<string, UploadStatus>();
  private allMap = new Map<string, UploadStatus>();
  private myUploads = new BehaviorSubject<UploadStatus[]>([]);
  private allUploads = new BehaviorSubject<UploadStatus[]>([]);
  private pendingByRequestId = new Map<string, Subject<UploadStatus>>();
  private subjectByUploadId = new Map<string, Subject<UploadStatus>>();

  readonly myUploads$ = this.myUploads.asObservable();
  readonly allUploads$ = this.allUploads.asObservable();

  constructor(
    @Inject(UPLOAD_CLIENT_CONFIG) private readonly cfg: ResolvedUploadClientConfig
  ) {
    const worker = new SharedWorker(
      new URL('./worker/upload.worker', import.meta.url),
      { type: 'module', name: 'upload-shared-worker' }
    );
    this.port = worker.port;
    this.port.onmessage = (e: MessageEvent<WorkerToClient>) => this.handle(e.data);
    this.port.start();

    this.send({
      type: 'register',
      clientId: cfg.clientId,
      serverUrl: cfg.serverUrl,
      maxConcurrentParts: cfg.maxConcurrentParts,
    });
    this.send({ type: 'subscribeMine', clientId: cfg.clientId });
    this.send({ type: 'subscribeAll' });
  }

  upload(file: File): Observable<UploadStatus> {
    const requestId = crypto.randomUUID();
    const subject = new Subject<UploadStatus>();
    this.pendingByRequestId.set(requestId, subject);
    this.send({ type: 'addUpload', clientId: this.cfg.clientId, requestId, file });
    return subject.asObservable();
  }

  cancelUpload(uploadId: string): void {
    this.send({ type: 'cancelUpload', uploadId });
  }

  ngOnDestroy(): void {
    this.port.close();
  }

  private send(msg: ClientToWorker): void {
    this.port.postMessage(msg);
  }

  private handle(msg: WorkerToClient): void {
    switch (msg.type) {
      case 'uploadAdded': {
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

        const subject = this.subjectByUploadId.get(status.uploadId);
        if (subject) {
          subject.next(status);
          if (
            status.status === 'complete' ||
            status.status === 'failed' ||
            status.status === 'cancelled'
          ) {
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
