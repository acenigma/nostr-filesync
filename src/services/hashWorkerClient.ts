export interface HashTask {
  id: string;
  resolve: (hash: string) => void;
  reject: (e: Error) => void;
}

class HashWorkerClient {
  private worker: Worker | null = null;
  private tasks: Map<string, HashTask> = new Map();
  private fallback: boolean = false;

  private ensureWorker(): Worker | null {
    if (this.fallback) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      this.fallback = true;
      return null;
    }
    try {
      this.worker = new Worker(new URL('../workers/hashWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (e: MessageEvent) => {
        const data = e.data as { id: string; ok: boolean; hash?: string; error?: string };
        const task = this.tasks.get(data.id);
        if (!task) return;
        this.tasks.delete(data.id);
        if (data.ok && data.hash) task.resolve(data.hash);
        else task.reject(new Error(data.error || 'hash failed'));
      });
      this.worker.addEventListener('error', () => {
        this.fallback = true;
        this.worker?.terminate();
        this.worker = null;
        this.tasks.forEach((t) => t.reject(new Error('worker crashed')));
        this.tasks.clear();
      });
      return this.worker;
    } catch {
      this.fallback = true;
      return null;
    }
  }

  async hash(data: ArrayBuffer | Uint8Array): Promise<string> {
    const buf =
      data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
    const worker = this.ensureWorker();
    if (!worker) {
      return this.fallbackHash(buf as ArrayBuffer);
    }
    const id = Math.random().toString(36).slice(2);
    return new Promise<string>((resolve, reject) => {
      this.tasks.set(id, { id, resolve, reject });
      worker.postMessage({ id, type: 'sha256', data: buf }, [buf]);
    });
  }

  private async fallbackHash(buf: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.tasks.clear();
  }
}

let _client: HashWorkerClient | null = null;

export function getHashWorker(): HashWorkerClient {
  if (!_client) _client = new HashWorkerClient();
  return _client;
}

export async function hashInWorker(data: ArrayBuffer | Uint8Array): Promise<string> {
  return getHashWorker().hash(data);
}
