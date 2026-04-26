import { InjectionToken } from '@angular/core';

export interface UploadClientConfig {
  clientId: string;
  serverUrl: string;
  maxConcurrentParts?: number;
}

export type ResolvedUploadClientConfig = Required<UploadClientConfig>;

export const UPLOAD_CLIENT_CONFIG = new InjectionToken<ResolvedUploadClientConfig>(
  'UPLOAD_CLIENT_CONFIG'
);
