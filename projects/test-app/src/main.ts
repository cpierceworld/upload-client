import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideZoneChangeDetection } from '@angular/core';
import { provideUploadClient } from 'upload-client';
import { Observable } from 'rxjs';
import { AppComponent } from './app/app.component';

const params = new URLSearchParams(location.search);
const clientId = params.get('clientId') ?? `main-${crypto.randomUUID().slice(0, 8)}`;

const SMALL_FILE_THRESHOLD = 100 * 1024 * 2014;

function fakeAlternativeUpload(file: File): Observable<void> {
  return new Observable<void>((subscriber) => {
    const timer = setTimeout(() => {
      console.log(`[alt-upload] handled ${file.name} (${file.size}B)`);
      subscriber.complete();
    }, 2000);
    return () => clearTimeout(timer);
  });
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimations(),
    provideUploadClient({
      clientId,
      serverUrl: 'http://localhost:4000',
      maxConcurrentParts: 6,
      alternativeUpload: {
        matches: (file) => file.size < SMALL_FILE_THRESHOLD,
        handler: fakeAlternativeUpload,
      },
    }),
  ],
}).catch((err) => console.error(err));
