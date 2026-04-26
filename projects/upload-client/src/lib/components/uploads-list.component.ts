import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UploadStatus } from '../upload-status';
import { UploadProgressComponent } from './upload-progress.component';

@Component({
  selector: 'lib-uploads-list',
  standalone: true,
  imports: [CommonModule, UploadProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *ngIf="uploads()?.length; else empty">
      <lib-upload-progress
        *ngFor="let u of uploads(); trackBy: trackById"
        [upload]="u"
        (cancel)="cancel.emit($event)"
      ></lib-upload-progress>
    </ng-container>
    <ng-template #empty>
      <p class="empty">{{ emptyText() }}</p>
    </ng-template>
  `,
  styles: [
    `
      .empty {
        color: rgba(0, 0, 0, 0.5);
        font-style: italic;
        padding: 8px 0;
      }
    `,
  ],
})
export class UploadsListComponent {
  readonly uploads = input<UploadStatus[] | null>([]);
  readonly emptyText = input('No uploads yet.');
  readonly cancel = output<string>();

  trackById = (_: number, u: UploadStatus): string => u.uploadId;
}
