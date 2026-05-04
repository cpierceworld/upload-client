# upload-client

Angular 19 + Material 19 file-upload library with a long-lived (Shared or Dedicated) Web Worker and per-upload `clientKey` tagging. Sibling `test-app` is included for live development against the mock server in `../upload-mock-server2`.

## Quickstart

```bash
npm install
npm run dev
```

This starts (concurrently):

- `dev:lib` — `ng build upload-client --watch` (incremental rebuild on save)
- `dev:app` — `ng serve test-app --port 4200`
- `dev:mock` — `npm --prefix ../upload-mock-server2 run dev` (Express on port 4000)

Open <http://localhost:4200>.

## Test-app query params

- `?clientId=<id>` — sets the per-frame client identity (defaults to `main-<random>`).
- The iframe panel spawns nested frames each with their own `clientId` (e.g. `iframe-1`); those frames render the same app, including their own iframe panel, so you can build arbitrary depth.

## Library API

```ts
import { provideUploadClient, UploadService } from 'upload-client';

provideUploadClient({
  clientId: 'app-main',
  serverUrl: 'http://localhost:4000',
  workerMode: 'shared',          // or 'dedicated'; 'shared' auto-falls-back to dedicated
  maxConcurrentParts: 6,
  defaultClientKey: 'app-main',  // tag applied to uploads when caller omits clientKey
  eviction: { ttlMs: 5 * 60_000, maxTerminal: 200 },
});
```

```ts
const svc = inject(UploadService);

svc.upload(file, { clientKey: 'sectionA' }).subscribe(/* status events */);
svc.cancelUpload(uploadId);
svc.retryUpload(uploadId);

svc.myUploads$;                      // uploads owned by this clientId
svc.allUploads$;                     // all uploads visible to this Service's worker
svc.uploadsByKey$('sectionA');       // myUploads filtered by clientKey
```

## Worker modes

- **shared** (default) — one `SharedWorker` per origin. All frames on the same origin see each other's uploads in `allUploads$`. Required for the cross-tab use case.
- **dedicated** — each `UploadService` owns a private `Worker`.
- Auto-fallback: if `workerMode: 'shared'` is requested but `SharedWorker` is undefined (older Safari, some embedded contexts), the service constructs a dedicated worker and logs a warning.

## Memory bounds

Terminal uploads (`complete` / `failed` / `cancelled`) are evicted on a 30s tick:

- Drop entries older than `eviction.ttlMs`.
- If terminal-entry count still exceeds `eviction.maxTerminal`, drop the oldest by termination time.
- In-flight uploads are never evicted.

## Mock server

See `../upload-mock-server2/openapi.yaml` for the wire spec. Port 4000 by default.
