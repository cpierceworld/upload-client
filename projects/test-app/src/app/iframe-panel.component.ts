import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

interface IframeEntry {
  id: string;
  src: SafeResourceUrl;
}

@Component({
  selector: 'app-iframe-panel',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule],
  template: `
    <mat-card class="panel">
      <mat-card-header>
        <mat-card-title>Embedded clients ({{ frames().length }})</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <div class="actions">
          <button mat-stroked-button (click)="add()">Add iframe</button>
          <button mat-stroked-button (click)="remove()" [disabled]="!frames().length">
            Remove iframe
          </button>
        </div>
        <div class="frames">
          <iframe
            *ngFor="let f of frames(); trackBy: trackById"
            [src]="f.src"
            width="520"
            height="380"
          ></iframe>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .panel { margin-top: 16px; }
      .actions { display: flex; gap: 8px; margin-bottom: 12px; }
      .frames { display: flex; flex-wrap: wrap; gap: 12px; }
      iframe { border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 4px; background: white; }
    `,
  ],
})
export class IframePanelComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private nextId = 1;
  readonly frames = signal<IframeEntry[]>([]);

  add(): void {
    const id = `iframe-${this.nextId++}`;
    const url = `${location.pathname}?clientId=${id}`;
    const entry: IframeEntry = {
      id,
      src: this.sanitizer.bypassSecurityTrustResourceUrl(url),
    };
    this.frames.update((arr) => [...arr, entry]);
  }

  remove(): void {
    this.frames.update((arr) => arr.slice(0, -1));
  }

  trackById = (_: number, f: IframeEntry): string => f.id;
}
