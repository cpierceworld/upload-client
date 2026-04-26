import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
  UPLOAD_CLIENT_CONFIG,
  UploadService,
  UploadsListComponent,
} from 'upload-client';
import { toSignal } from '@angular/core/rxjs-interop';
import { IframePanelComponent } from './iframe-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatSlideToggleModule,
    UploadsListComponent,
    IframePanelComponent,
  ],
  template: `
    <div class="page">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Upload Client Test App</mat-card-title>
          <mat-card-subtitle>clientId: <code>{{ cfg.clientId }}</code></mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <div class="picker">
            <input
              type="file"
              multiple
              #picker
              (change)="filesSelected.set(!!picker.files?.length)"
            />
            <button
              mat-raised-button
              color="primary"
              (click)="upload(picker.files); picker.value = ''; filesSelected.set(false)"
              [disabled]="!filesSelected()"
            >
              Upload
            </button>
          </div>

          <div class="toggle">
            <mat-slide-toggle
              [checked]="showAll()"
              (change)="showAll.set($event.checked)"
            >
              Show all uploads (global, across iframes)
            </mat-slide-toggle>
          </div>

          <h3>{{ showAll() ? 'All uploads' : 'My uploads' }}</h3>
          <lib-uploads-list
            [uploads]="visibleUploads()"
            (cancel)="onCancel($event)"
          ></lib-uploads-list>
        </mat-card-content>
      </mat-card>

      <app-iframe-panel *ngIf="!isIframe"></app-iframe-panel>
    </div>
  `,
  styles: [
    `
      .page { padding: 16px; max-width: 1400px; margin: 0 auto; }
      .picker { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .toggle { margin: 12px 0; }
      h3 { margin: 16px 0 4px; font-weight: 500; }
      code { background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 3px; }
    `,
  ],
})
export class AppComponent {
  readonly cfg = inject(UPLOAD_CLIENT_CONFIG);
  readonly svc = inject(UploadService);
  readonly isIframe = window.self !== window.top;

  readonly showAll = signal(false);
  readonly filesSelected = signal(false);

  private readonly mine = toSignal(this.svc.myUploads$, { initialValue: [] });
  private readonly all = toSignal(this.svc.allUploads$, { initialValue: [] });
  readonly visibleUploads = computed(() => (this.showAll() ? this.all() : this.mine()));

  upload(files: FileList | null): void {
    if (!files) return;
    for (const f of Array.from(files)) {
      this.svc.upload(f).subscribe({
        error: (err) => console.error(`upload failed for ${f.name}`, err),
      });
    }
  }

  onCancel(uploadId: string): void {
    this.svc.cancelUpload(uploadId);
  }
}
