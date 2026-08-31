import * as db from '../db/index';
import * as fileEntity from '../file-entity/index';
import * as folders from '../folders/index';
import type { Manifest, ManifestEntry } from './manifest';
import * as tombSync from './tombstone-sync';

export interface RepairPlan {
  toDownload: ManifestEntry[];
  toRecreate: ManifestEntry[];
  toDelete: string[];
  toKeep: ManifestEntry[];
}

export function planRepair(remote: Manifest): RepairPlan {
  const toDownload: ManifestEntry[] = [];
  const toRecreate: ManifestEntry[] = [];
  const toDelete: string[] = [];
  const toKeep: ManifestEntry[] = [];

  for (const entry of remote.entries) {
    if (entry.deleted) {
      toKeep.push(entry);
      continue;
    }
    toDownload.push(entry);
    toRecreate.push(entry);
  }

  return { toDownload, toRecreate, toDelete, toKeep };
}

export interface RepairResult {
  downloaded: number;
  recreated: number;
  deleted: number;
  failed: number;
}

export interface RepairOptions {
  fetchContent?: (entityId: string) => Promise<Uint8Array | null>;
  applyRemote?: (entry: ManifestEntry) => Promise<void>;
  backupLocal?: () => Promise<void>;
  confirmBeforeApply?: () => Promise<boolean>;
}

export async function executeRepair(
  remote: Manifest,
  options: RepairOptions = {}
): Promise<RepairResult> {
  const result: RepairResult = {
    downloaded: 0,
    recreated: 0,
    deleted: 0,
    failed: 0,
  };

  if (options.confirmBeforeApply) {
    const ok = await options.confirmBeforeApply();
    if (!ok) return result;
  }

  if (options.backupLocal) {
    await options.backupLocal();
  }

  const plan = planRepair(remote);

  for (const entry of plan.toRecreate) {
    try {
      if (options.applyRemote) {
        await options.applyRemote(entry);
        result.recreated++;
      } else {
        await defaultApplyRemoteEntry(entry);
        result.recreated++;
      }
    } catch {
      result.failed++;
    }
  }

  for (const entry of plan.toDownload) {
    if (options.fetchContent) {
      try {
        const content = await options.fetchContent(entry.entityId);
        if (content) result.downloaded++;
      } catch {
        result.failed++;
      }
    }
  }

  return result;
}

async function defaultApplyRemoteEntry(entry: ManifestEntry): Promise<void> {
  if (entry.type === 'file') {
    const existing = await fileEntity.getFile(entry.entityId);
    if (!existing) {
      // Cria registro mínimo
      await db.put(db.STORE_FILES, {
        fileId: entry.entityId,
        folderId: null,
        name: `recovered-${entry.entityId.slice(0, 8)}`,
        mimeType: 'application/octet-stream',
        size: 0,
        contentHash: '',
        chunks: 0,
        headerEventId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: entry.version,
        encrypted: false,
      });
    }
  } else if (entry.type === 'folder') {
    const existing = await folders.getFolder(entry.entityId);
    if (!existing) {
      await db.put(db.STORE_FOLDERS, {
        id: entry.entityId,
        parentId: null,
        name: `recovered-${entry.entityId.slice(0, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: entry.version,
      });
    }
  }
}

export async function rebuildFromManifest(
  remote: Manifest,
  options: RepairOptions = {}
): Promise<RepairResult> {
  return executeRepair(remote, options);
}

export async function verifyManifestConsistency(
  remote: Manifest
): Promise<{ consistent: boolean; issues: string[] }> {
  const issues: string[] = [];

  const folders = new Map<string, ManifestEntry>();
  for (const entry of remote.entries) {
    if (entry.type === 'folder' && !entry.deleted) {
      folders.set(entry.entityId, entry);
    }
  }

  for (const entry of remote.entries) {
    if (entry.type === 'file' && !entry.deleted) {
      // Verifica se há metadata mínima
      if (entry.version <= 0) {
        issues.push(`file ${entry.entityId} tem version inválida`);
      }
    }
  }

  return { consistent: issues.length === 0, issues };
}

export { tombSync };
