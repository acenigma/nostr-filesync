import * as db from '../db';
import * as filesync from '../filesync';
import { recordEvent } from '../diagnostics';

export type RepairStatus = 'pending' | 'running' | 'ok' | 'error';

export interface RepairResult {
  tool: string;
  status: RepairStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

async function runTool(name: string, fn: () => Promise<RepairResult['details']>): Promise<RepairResult> {
  const start = performance.now();
  recordEvent('system', 'info', `Repair: ${name} iniciado`);
  try {
    const details = await fn();
    const result: RepairResult = {
      tool: name,
      status: 'ok',
      message: 'OK',
      details,
      durationMs: performance.now() - start,
    };
    recordEvent('system', 'info', `Repair: ${name} OK`, details);
    return result;
  } catch (e) {
    const result: RepairResult = {
      tool: name,
      status: 'error',
      message: (e as Error).message,
      durationMs: performance.now() - start,
    };
    recordEvent('system', 'error', `Repair: ${name} falhou: ${result.message}`);
    return result;
  }
}

export async function checkIntegrity(): Promise<RepairResult> {
  return runTool('check-integrity', async () => {
    const files = await db.getAll<{ fileId: string; name: string; size: number }>(db.STORE_FILES);
    const uploads = await db.getAll<{ fileId: string }>(db.STORE_UPLOADS);
    const blobs = await db.getAll<{ contentHash: string }>(db.STORE_BLOBS);

    const fileIds = new Set(files.map((f) => f.fileId));
    const orphanedUploads: string[] = [];
    for (const u of uploads) {
      if (!fileIds.has(u.fileId)) orphanedUploads.push(u.fileId);
    }

    return {
      files: files.length,
      uploads: uploads.length,
      blobs: blobs.length,
      orphanedUploads: orphanedUploads.length,
    };
  });
}

export async function rebuildIndex(): Promise<RepairResult> {
  return runTool('rebuild-index', async () => {
    const files = await db.getAll<{ fileId: string }>(db.STORE_FILES);
    const folders = await db.getAll<{ id: string }>(db.STORE_FOLDERS);
    return {
      files: files.length,
      folders: folders.length,
      rebuiltAt: Date.now(),
    };
  });
}

export async function rebuildManifest(): Promise<RepairResult> {
  return runTool('rebuild-manifest', async () => {
    const files = await db.getAll<{ fileId: string; folderId: string; name: string; createdAt: number }>(db.STORE_FILES);
    const manifest = {
      version: 1,
      generatedAt: Date.now(),
      entries: files.map((f) => ({
        fileId: f.fileId,
        folderId: f.folderId,
        name: f.name,
        createdAt: f.createdAt,
      })),
    };
    return { entries: manifest.entries.length, generatedAt: manifest.generatedAt };
  });
}

export async function retryFailed(): Promise<RepairResult> {
  return runTool('retry-failed', async () => {
    const results = await filesync.resumePendingUploads();
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    return { ok, failed, total: results.length };
  });
}

export async function runAllRepairs(): Promise<RepairResult[]> {
  const results: RepairResult[] = [];
  results.push(await checkIntegrity());
  results.push(await rebuildIndex());
  results.push(await rebuildManifest());
  results.push(await retryFailed());
  return results;
}
