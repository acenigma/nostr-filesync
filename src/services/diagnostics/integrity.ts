import * as db from '../db/index';
import * as fileEntity from '../file-entity/index';
import * as folders from '../folders/index';
import * as tombstones from '../tombstones/index';
import * as blobs from '../blobs/index';

export const DIAGNOSTICS_VERSION = '1.0.0';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'FILE_FOLDER_MISSING'
  | 'FILE_NAME_INVALID'
  | 'FILE_HASH_INVALID'
  | 'FILE_SIZE_INVALID'
  | 'FILE_DUPLICATE_NAME'
  | 'FOLDER_PARENT_MISSING'
  | 'FOLDER_PARENT_CYCLE'
  | 'FOLDER_NAME_INVALID'
  | 'TOMBSTONE_ENTITY_STILL_LIVE'
  | 'TOMBSTONE_DUPLICATE'
  | 'BLOB_HASH_INVALID'
  | 'BLOB_SIZE_INVALID'
  | 'BLOB_ORPHAN_TOO_OLD'
  | 'BLOB_MISSING_FOR_FILE'
  | 'GENERAL_CORRUPTION';

export interface IntegrityIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  entityId?: string;
  entityType?: 'file' | 'folder' | 'blob' | 'tombstone';
  context?: Record<string, unknown>;
}

export interface IntegrityReport {
  scannedAt: number;
  durationMs: number;
  issues: IntegrityIssue[];
  stats: {
    files: number;
    folders: number;
    blobs: number;
    tombstones: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function isValidHash(hash: string | undefined | null): boolean {
  return !!hash && HASH_PATTERN.test(hash);
}

export async function scanFiles(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const files = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const allFolders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);
  const folderIds = new Set(allFolders.map((f) => f.id));

  const byFolderAndName = new Map<string, db.FileRecord[]>();
  for (const file of files) {
    if (!file.name || !file.name.trim()) {
      issues.push({
        code: 'FILE_NAME_INVALID',
        severity: 'error',
        message: `File ${file.fileId} tem nome vazio`,
        entityId: file.fileId,
        entityType: 'file',
      });
    }
    if (file.name && (file.name.includes('/') || file.name.includes('\0'))) {
      issues.push({
        code: 'FILE_NAME_INVALID',
        severity: 'error',
        message: `File ${file.fileId} tem nome com caracteres inválidos`,
        entityId: file.fileId,
        entityType: 'file',
      });
    }
    if (!isValidHash(file.contentHash)) {
      issues.push({
        code: 'FILE_HASH_INVALID',
        severity: 'error',
        message: `File ${file.fileId} tem contentHash inválido`,
        entityId: file.fileId,
        entityType: 'file',
      });
    }
    if (file.size < 0) {
      issues.push({
        code: 'FILE_SIZE_INVALID',
        severity: 'error',
        message: `File ${file.fileId} tem size negativo`,
        entityId: file.fileId,
        entityType: 'file',
      });
    }
    if (file.folderId && !folderIds.has(file.folderId)) {
      issues.push({
        code: 'FILE_FOLDER_MISSING',
        severity: 'error',
        message: `File ${file.fileId} referencia folderId inexistente: ${file.folderId}`,
        entityId: file.fileId,
        entityType: 'file',
        context: { folderId: file.folderId },
      });
    }
    const key = `${file.folderId ?? 'null'}::${file.name}`;
    const list = byFolderAndName.get(key) ?? [];
    list.push(file);
    byFolderAndName.set(key, list);
  }

  for (const [key, group] of byFolderAndName) {
    if (group.length > 1) {
      const [folderId, name] = key.split('::');
      issues.push({
        code: 'FILE_DUPLICATE_NAME',
        severity: 'warning',
        message: `${group.length} files com mesmo nome '${name}' no mesmo folder`,
        entityType: 'file',
        context: { folderId, name, fileIds: group.map((f) => f.fileId) },
      });
    }
  }

  return issues;
}

export async function scanFolders(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const allFolders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);
  const folderIds = new Set(allFolders.map((f) => f.id));

  for (const folder of allFolders) {
    if (!folder.name || !folder.name.trim()) {
      issues.push({
        code: 'FOLDER_NAME_INVALID',
        severity: 'error',
        message: `Folder ${folder.id} tem nome vazio`,
        entityId: folder.id,
        entityType: 'folder',
      });
    }
    if (folder.name && (folder.name.includes('/') || folder.name.includes('\0'))) {
      issues.push({
        code: 'FOLDER_NAME_INVALID',
        severity: 'error',
        message: `Folder ${folder.id} tem nome com caracteres inválidos`,
        entityId: folder.id,
        entityType: 'folder',
      });
    }
    if (folder.parentId && !folderIds.has(folder.parentId)) {
      issues.push({
        code: 'FOLDER_PARENT_MISSING',
        severity: 'error',
        message: `Folder ${folder.id} referencia parentId inexistente: ${folder.parentId}`,
        entityId: folder.id,
        entityType: 'folder',
        context: { parentId: folder.parentId },
      });
    }
  }

  const byParent = new Map<string | null, db.FolderRecord[]>();
  for (const folder of allFolders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  for (const [parentId, group] of byParent) {
    if (group.length > 1) {
      const seen = new Set<string>();
      for (const f of group) {
        if (seen.has(f.name)) {
          issues.push({
            code: 'FOLDER_NAME_INVALID',
            severity: 'warning',
            message: `Folders duplicados com nome '${f.name}' no mesmo parent`,
            entityId: f.id,
            entityType: 'folder',
            context: { parentId, name: f.name },
          });
        }
        seen.add(f.name);
      }
    }
  }

  for (const folder of allFolders) {
    const visited = new Set<string>();
    let current: string | null = folder.parentId;
    while (current) {
      if (visited.has(current)) {
        issues.push({
          code: 'FOLDER_PARENT_CYCLE',
          severity: 'error',
          message: `Ciclo detectado na hierarquia de folders envolvendo ${current}`,
          entityId: folder.id,
          entityType: 'folder',
          context: { cycle: Array.from(visited), culprit: current },
        });
        break;
      }
      visited.add(current);
      const parent = allFolders.find((f) => f.id === current);
      if (!parent) break;
      current = parent.parentId;
    }
  }

  return issues;
}

export async function scanBlobs(options: { orphanMaxAgeMs?: number } = {}): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const maxAge = options.orphanMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const allBlobs = await blobs.listAllBlobs();
  const now = Date.now();

  for (const blob of allBlobs) {
    if (!isValidHash(blob.contentHash)) {
      issues.push({
        code: 'BLOB_HASH_INVALID',
        severity: 'error',
        message: `Blob tem contentHash inválido`,
        entityId: blob.contentHash,
        entityType: 'blob',
      });
    }
    if (blob.size < 0) {
      issues.push({
        code: 'BLOB_SIZE_INVALID',
        severity: 'error',
        message: `Blob ${blob.contentHash} tem size negativo`,
        entityId: blob.contentHash,
        entityType: 'blob',
      });
    }
    if (blob.refCount === 0 && now - blob.lastAccessedAt > maxAge) {
      issues.push({
        code: 'BLOB_ORPHAN_TOO_OLD',
        severity: 'info',
        message: `Blob ${blob.contentHash} é orphan há mais de ${maxAge}ms`,
        entityId: blob.contentHash,
        entityType: 'blob',
      });
    }
  }

  const fileRecords = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const blobsWithFiles = new Set(fileRecords.map((f) => f.contentHash));
  for (const blob of allBlobs) {
    if (blob.refCount > 0 && !blobsWithFiles.has(blob.contentHash)) {
      issues.push({
        code: 'BLOB_MISSING_FOR_FILE',
        severity: 'warning',
        message: `Blob ${blob.contentHash} tem refCount>0 mas nenhum file o referencia`,
        entityId: blob.contentHash,
        entityType: 'blob',
      });
    }
  }

  return issues;
}

export async function scanTombstones(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const allTombstones = await tombstones.listTombstones();
  const allFiles = await db.getAll<db.FileRecord>(db.STORE_FILES);
  const allFolders = await db.getAll<db.FolderRecord>(db.STORE_FOLDERS);

  const tombById = new Map<string, (typeof allTombstones)[number]>();
  for (const t of allTombstones) {
    if (tombById.has(t.entityId)) {
      issues.push({
        code: 'TOMBSTONE_DUPLICATE',
        severity: 'warning',
        message: `Tombstone duplicado para ${t.entityId}`,
        entityId: t.entityId,
        entityType: 'tombstone',
      });
    }
    tombById.set(t.entityId, t);
  }

  for (const t of allTombstones) {
    if (t.entityType === 'file') {
      const live = allFiles.find((f) => f.fileId === t.entityId);
      if (live) {
        issues.push({
          code: 'TOMBSTONE_ENTITY_STILL_LIVE',
          severity: 'error',
          message: `File ${t.entityId} tem tombstone mas ainda está vivo`,
          entityId: t.entityId,
          entityType: 'file',
          context: { tombstoneVersion: t.version, fileVersion: live.version },
        });
      }
    } else if (t.entityType === 'folder') {
      const live = allFolders.find((f) => f.id === t.entityId);
      if (live) {
        issues.push({
          code: 'TOMBSTONE_ENTITY_STILL_LIVE',
          severity: 'error',
          message: `Folder ${t.entityId} tem tombstone mas ainda está vivo`,
          entityId: t.entityId,
          entityType: 'folder',
          context: { tombstoneVersion: t.version, folderVersion: live.version },
        });
      }
    }
  }

  return issues;
}

export async function runFullScan(options: { orphanMaxAgeMs?: number } = {}): Promise<IntegrityReport> {
  const start = Date.now();
  const [fileIssues, folderIssues, blobIssues, tombstoneIssues] = await Promise.all([
    scanFiles(),
    scanFolders(),
    scanBlobs(options),
    scanTombstones(),
  ]);
  const issues = [...fileIssues, ...folderIssues, ...blobIssues, ...tombstoneIssues];
  const fileCount = (await db.getAll<db.FileRecord>(db.STORE_FILES)).length;
  const folderCount = (await db.getAll<db.FolderRecord>(db.STORE_FOLDERS)).length;
  const blobCount = (await blobs.listAllBlobs()).length;
  const tombCount = (await tombstones.listTombstones()).length;

  return {
    scannedAt: start,
    durationMs: Date.now() - start,
    issues,
    stats: {
      files: fileCount,
      folders: folderCount,
      blobs: blobCount,
      tombstones: tombCount,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    },
  };
}

export function generateReport(report: IntegrityReport): string {
  const lines: string[] = [];
  lines.push('=== Integrity Scan Report ===');
  lines.push(`Scanned at: ${new Date(report.scannedAt).toISOString()}`);
  lines.push(`Duration: ${report.durationMs}ms`);
  lines.push('');
  lines.push('Stats:');
  lines.push(`  Files: ${report.stats.files}`);
  lines.push(`  Folders: ${report.stats.folders}`);
  lines.push(`  Blobs: ${report.stats.blobs}`);
  lines.push(`  Tombstones: ${report.stats.tombstones}`);
  lines.push(`  Errors: ${report.stats.errors}`);
  lines.push(`  Warnings: ${report.stats.warnings}`);
  lines.push(`  Info: ${report.stats.info}`);
  lines.push('');
  if (report.issues.length === 0) {
    lines.push('No issues found.');
  } else {
    lines.push(`Issues (${report.issues.length}):`);
    for (const issue of report.issues) {
      lines.push(`  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
    }
  }
  return lines.join('\n');
}

export function groupByCode(issues: IntegrityIssue[]): Map<IssueCode, IntegrityIssue[]> {
  const map = new Map<IssueCode, IntegrityIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.code) ?? [];
    list.push(issue);
    map.set(issue.code, list);
  }
  return map;
}

export { db, fileEntity, folders, tombstones, blobs };
