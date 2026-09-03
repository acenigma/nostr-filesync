/// <reference lib="webworker" />

interface HashRequest {
  id: string;
  type: 'sha256';
  data: ArrayBuffer;
}

interface HashResponse {
  id: string;
  ok: true;
  hash: string;
}

interface HashError {
  id: string;
  ok: false;
  error: string;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

self.addEventListener('message', async (event: MessageEvent<HashRequest>) => {
  const { id, type, data } = event.data;
  try {
    if (type === 'sha256') {
      const hash = await sha256Hex(data);
      const res: HashResponse = { id, ok: true, hash };
      (self as unknown as Worker).postMessage(res);
      return;
    }
    const err: HashError = { id, ok: false, error: `unknown type: ${type}` };
    (self as unknown as Worker).postMessage(err);
  } catch (e) {
    const err: HashError = { id, ok: false, error: (e as Error).message };
    (self as unknown as Worker).postMessage(err);
  }
});
