export type UploadPriority = 'metadata' | 'small-file' | 'user-requested' | 'background' | 'thumbnail';

const PRIORITY_RANK: Record<UploadPriority, number> = {
  metadata: 0,
  'small-file': 1,
  'user-requested': 2,
  background: 3,
  thumbnail: 4,
};

export interface PriorityTask<T> {
  id: string;
  priority: UploadPriority;
  data: T;
  enqueuedAt: number;
}

export class PriorityQueue<T> {
  private items: PriorityTask<T>[] = [];
  private listeners: Array<() => void> = [];

  enqueue(task: PriorityTask<T>): void {
    this.items.push(task);
    this.sort();
    this.emit();
  }

  dequeue(): PriorityTask<T> | undefined {
    const item = this.items.shift();
    this.emit();
    return item;
  }

  peek(): PriorityTask<T> | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.emit();
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    this.emit();
    return true;
  }

  snapshot(): readonly PriorityTask<T>[] {
    return this.items.slice();
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private sort(): void {
    this.items.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority];
      const pb = PRIORITY_RANK[b.priority];
      if (pa !== pb) return pa - pb;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export function priorityForFile(sizeBytes: number, userRequested: boolean): UploadPriority {
  if (userRequested) return 'user-requested';
  if (sizeBytes < 32 * 1024) return 'small-file';
  return 'background';
}
