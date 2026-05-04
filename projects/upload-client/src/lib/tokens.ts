import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export type WorkerMode = 'shared' | 'dedicated';

export interface EvictionConfig {
  ttlMs?: number;
  maxTerminal?: number;
}

export interface AlternativeUploadConfig {
  matches: (file: File) => boolean;
  handler: (file: File) => Observable<unknown>;
}

export interface UploadClientConfig {
  clientId: string;
  serverUrl: string;
  maxConcurrentParts?: number;
  workerMode?: WorkerMode;
  eviction?: EvictionConfig;
  alternativeUpload?: AlternativeUploadConfig;
}

export interface ResolvedUploadClientConfig {
  clientId: string;
  serverUrl: string;
  maxConcurrentParts: number;
  workerMode: WorkerMode;
  eviction: { ttlMs: number; maxTerminal: number };
  alternativeUpload?: AlternativeUploadConfig;
}

export const UPLOAD_CLIENT_CONFIG = new InjectionToken<ResolvedUploadClientConfig>(
  'UPLOAD_CLIENT_CONFIG'
);
