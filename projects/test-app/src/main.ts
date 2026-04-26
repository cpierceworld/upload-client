import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideZoneChangeDetection } from '@angular/core';
import { provideUploadClient } from 'upload-client';
import { AppComponent } from './app/app.component';

const params = new URLSearchParams(location.search);
const clientId = params.get('clientId') ?? `main-${crypto.randomUUID().slice(0, 8)}`;

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimations(),
    provideUploadClient({
      clientId,
      serverUrl: 'http://localhost:3000',
      maxConcurrentParts: 6,
    }),
  ],
}).catch((err) => console.error(err));
