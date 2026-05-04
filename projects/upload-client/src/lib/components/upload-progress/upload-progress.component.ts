import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule, ProgressBarMode } from '@angular/material/progress-bar';
import { UploadStatus } from '../../upload-status';

@Component({
  selector: 'lib-upload-progress',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upload-progress.component.html',
  styleUrls: ['./upload-progress.component.scss'],
})
export class UploadProgressComponent {
  readonly upload = input.required<UploadStatus>();
  readonly cancel = output<string>();
  readonly retry = output<string>();

  readonly canRetry = computed(
    () => this.upload().kind === 'standard' && this.upload().status === 'failed'
  );

  readonly sizeMb = computed(() => (this.upload().fileSize / 1024 / 1024).toFixed(2));

  readonly canCancel = computed(() => {
    const s = this.upload().status;
    return (
      s === 'queued' ||
      s === 'initiating' ||
      s === 'uploading' ||
      s === 'completing' ||
      s === 'processing'
    );
  });

  readonly barMode = computed<ProgressBarMode>(() => {
    switch (this.upload().status) {
      case 'queued':
        return 'buffer';
      case 'initiating':
      case 'completing':
        return 'query';
      case 'processing':
        return 'indeterminate';
      default:
        return 'determinate';
    }
  });
}
