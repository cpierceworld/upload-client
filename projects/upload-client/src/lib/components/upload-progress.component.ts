import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule, ProgressBarMode } from '@angular/material/progress-bar';
import { UploadStatus } from '../upload-status';

@Component({
  selector: 'lib-upload-progress',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="upload-row">
      <div class="meta">
        <span class="name">{{ upload().fileName }}</span>
        <span class="size">({{ sizeMb() }} MB)</span>
        <span
          class="status"
          [class.failed]="upload().status === 'failed'"
          [class.cancelled]="upload().status === 'cancelled'"
        >
          [{{ upload().status }}]
        </span>
        <span class="pct" *ngIf="upload().status !== 'queued'">
          {{ upload().progressPercent }}%
        </span>
        <span class="parts" *ngIf="upload().totalParts > 0">
          {{ upload().completedParts }}/{{ upload().totalParts }} parts
        </span>
        <span class="client">client: {{ upload().clientId }}</span>
        <button
          *ngIf="canCancel()"
          mat-icon-button
          class="cancel-btn"
          aria-label="Cancel upload"
          (click)="cancel.emit(upload().uploadId)"
        >
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <mat-progress-bar [mode]="barMode()" [value]="upload().progressPercent"></mat-progress-bar>
      <div class="hash" *ngIf="upload().sha256">
        sha256: {{ upload().sha256!.slice(0, 16) }}…
      </div>
      <div class="err" *ngIf="upload().error">error: {{ upload().error }}</div>
    </div>
  `,
  styles: [
    `
      .upload-row {
        padding: 8px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      }
      .meta {
        display: flex;
        gap: 12px;
        font-size: 13px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .name { font-weight: 600; }
      .size { color: rgba(0, 0, 0, 0.6); }
      .status { text-transform: uppercase; font-size: 11px; color: #1976d2; }
      .status.failed { color: #d32f2f; }
      .status.cancelled { color: #757575; }
      .pct { font-variant-numeric: tabular-nums; }
      .parts { color: rgba(0, 0, 0, 0.6); font-size: 12px; }
      .client { color: rgba(0, 0, 0, 0.5); font-size: 11px; margin-left: auto; }
      .cancel-btn { width: 32px; height: 32px; line-height: 32px; }
      .cancel-btn .mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .hash { font-family: monospace; font-size: 11px; color: rgba(0, 0, 0, 0.6); margin-top: 4px; }
      .err { color: #d32f2f; font-size: 12px; margin-top: 4px; }
    `,
  ],
})
export class UploadProgressComponent {
  readonly upload = input.required<UploadStatus>();
  readonly cancel = output<string>();

  readonly sizeMb = computed(() => (this.upload().fileSize / 1024 / 1024).toFixed(2));

  readonly canCancel = computed(() => {
    const s = this.upload().status;
    return s === 'queued' || s === 'initiating' || s === 'uploading' || s === 'completing';
  });

  readonly barMode = computed<ProgressBarMode>(() => {
    switch (this.upload().status) {
      case 'queued':
        return 'buffer';
      case 'initiating':
      case 'completing':
        return 'query';
      default:
        return 'determinate';
    }
  });
}
