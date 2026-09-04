import { PriorityQueue, priorityForFile, type PriorityTask, type UploadPriority } from './priorityQueue';
import { getBandwidthConfig, onBandwidthChange, type BandwidthConfig } from './bandwidth';

export interface UploadTask {
  fileId: string;
  fileSize: number;
  userRequested: boolean;
}

export interface SchedulerState {
  inFlight: number;
  queued: number;
  maxParallel: number;
}

type Worker = (task: UploadTask) => Promise<void>;

export class UploadScheduler {
  private queue = new PriorityQueue<UploadTask>();
  private inFlight = new Set<string>();
  private config: BandwidthConfig;
  private offBw: () => void;
  private worker: Worker | null = null;

  constructor() {
    this.config = getBandwidthConfig();
    this.offBw = onBandwidthChange((cfg) => {
      this.config = cfg;
      this.tick();
    });
  }

  setWorker(worker: Worker): void {
    this.worker = worker;
    this.tick();
  }

  enqueueFile(task: UploadTask, priority?: UploadPriority): void {
    if (this.inFlight.has(task.fileId)) return;
    const existing = this.queue.snapshot().find((t) => t.data.fileId === task.fileId);
    if (existing) return;
    const pri = priority ?? priorityForFile(task.fileSize, task.userRequested);
    this.queue.enqueue({
      id: task.fileId,
      priority: pri,
      data: task,
      enqueuedAt: Date.now(),
    });
    this.tick();
  }

  cancel(fileId: string): void {
    this.queue.remove(fileId);
  }

  state(): SchedulerState {
    return {
      inFlight: this.inFlight.size,
      queued: this.queue.size(),
      maxParallel: this.config.maxParallelFiles,
    };
  }

  onChange(listener: () => void): () => void {
    return this.queue.onChange(listener);
  }

  destroy(): void {
    this.offBw();
    this.queue.clear();
    this.inFlight.clear();
  }

  private tick(): void {
    if (!this.worker) return;
    while (this.inFlight.size < this.config.maxParallelFiles) {
      const next: PriorityTask<UploadTask> | undefined = this.queue.peek();
      if (!next) break;
      this.queue.dequeue();
      this.runOne(next.data);
    }
  }

  private async runOne(task: UploadTask): Promise<void> {
    this.inFlight.add(task.fileId);
    try {
      if (this.worker) {
        await this.worker(task);
      }
    } catch {
      /* swallow; worker handles retry */
    } finally {
      this.inFlight.delete(task.fileId);
      this.tick();
    }
  }
}

let _scheduler: UploadScheduler | null = null;

export function getUploadScheduler(): UploadScheduler {
  if (!_scheduler) _scheduler = new UploadScheduler();
  return _scheduler;
}
