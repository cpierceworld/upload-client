import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
  readonly emptyText = input('No uploads yet.');
  readonly cancel = output<string>();
}
