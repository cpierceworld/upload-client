import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  ResolvedUploadClientConfig,
  UPLOAD_CLIENT_CONFIG,
  UploadClientConfig,
} from './tokens';
import { UploadService } from './upload.service';

export function provideUploadClient(cfg: UploadClientConfig): EnvironmentProviders {
  const resolved: ResolvedUploadClientConfig = {
    clientId: cfg.clientId,
    serverUrl: cfg.serverUrl,
    maxConcurrentParts: cfg.maxConcurrentParts ?? 6,
    workerMode: cfg.workerMode ?? 'shared',
    eviction: {
      ttlMs: cfg.eviction?.ttlMs ?? 5 * 60_000,
      maxTerminal: cfg.eviction?.maxTerminal ?? 200,
    },
    alternativeUpload: cfg.alternativeUpload,
  };
  return makeEnvironmentProviders([
    { provide: UPLOAD_CLIENT_CONFIG, useValue: resolved },
    UploadService,
  ]);
}
