import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { UploadStatus } from '../../upload-status';
import { UploadProgressComponent } from '../upload-progress/upload-progress.component';

@Component({
  selector: 'lib-uploads-list',
  standalone: true,
  imports: [UploadProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './uploads-list.component.html',
  styleUrls: ['./uploads-list.component.scss'],
})
export class UploadsListComponent {
  readonly uploads = input<UploadStatus[] | null>([]);
  readonly clientKeyFilter = input<string | null>(null);
  readonly emptyText = input('No uploads yet.');
  readonly cancel = output<string>();
  readonly retry = output<string>();

  readonly displayed = computed<UploadStatus[]>(() => {
    const list = this.uploads() ?? [];
    const key = this.clientKeyFilter();
    return key ? list.filter((u) => u.clientKey === key) : list;
  });
}
