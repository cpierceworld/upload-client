import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  ResolvedUploadClientConfig,
  UPLOAD_CLIENT_CONFIG,
  UploadClientConfig,
} from './tokens';
import { UploadService } from './upload.service';

export function provideUploadClient(cfg: UploadClientConfig): EnvironmentProviders {
  const resolved: ResolvedUploadClientConfig = {
    maxConcurrentParts: 6,
    ...cfg,
  };
  return makeEnvironmentProviders([
    { provide: UPLOAD_CLIENT_CONFIG, useValue: resolved },
    UploadService,
  ]);
}
