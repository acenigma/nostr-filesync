import * as db from '../db/index';
import * as fileEntity from '../file-entity/index';

export type { FileVersion, FileVersions } from '../db/index';

export async function createVersion(input: {
  fileId: string;
  parentVersionId: string | null;
  contentHash: string;
  size: number;
  name: string;
  folderId: string | null;
  mimeType: string;
  version: number;
  createdBy?: string;
}): Promise<db.FileVersion> {
  const now = Date.now();
  const record: db.FileVersion = {
    id: `v-${input.fileId}-${input.version}-${now}`,
    fileId: input.fileId,
    parentVersionId: input.parentVersionId,
    contentHash: input.contentHash,
    size: input.size,
    name: input.name,
    folderId: input.folderId,
    mimeType: input.mimeType,
    createdAt: now,
    createdBy: input.createdBy ?? 'local',
    version: input.version,
  };
  await db.put(db.STORE_FILE_VERSIONS, record);
  return record;
}

export async function getVersion(versionId: string): Promise<db.FileVersion | null> {
  const record = await db.get<db.FileVersion>(db.STORE_FILE_VERSIONS, versionId);
  return record ?? null;
}

export async function listVersions(fileId: string): Promise<db.FileVersion[]> {
  const all = await db.getAll<db.FileVersion>(db.STORE_FILE_VERSIONS);
  return all
    .filter((v) => v.fileId === fileId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLatestVersion(fileId: string): Promise<db.FileVersion | null> {
  const versions = await listVersions(fileId);
  return versions[0] ?? null;
}

export async function deleteVersions(fileId: string): Promise<number> {
  const versions = await listVersions(fileId);
  for (const v of versions) {
    await db.del(db.STORE_FILE_VERSIONS, v.id);
  }
  return versions.length;
}

export async function getFileVersions(fileId: string): Promise<db.FileVersions> {
  const versions = await listVersions(fileId);
  const file = await fileEntity.getFile(fileId);
  return {
    currentVersion: file?.version ?? versions.length + 1,
    versions,
  };
}

export async function restoreVersion(
  versionId: string
): Promise<db.FileRecord | null> {
  const version = await getVersion(versionId);
  if (!version) return null;

  const file = await fileEntity.getFile(version.fileId);
  if (!file) return null;

  const newVersion = file.version + 1;
  const now = Date.now();

  await createVersion({
    fileId: file.fileId,
    parentVersionId: null,
    contentHash: file.contentHash,
    size: file.size,
    name: file.name,
    folderId: file.folderId,
    mimeType: file.mimeType,
    version: file.version,
    createdBy: 'local',
  });

  const updated: db.FileRecord = {
    ...file,
    contentHash: version.contentHash,
    size: version.size,
    name: version.name,
    folderId: version.folderId,
    mimeType: version.mimeType,
    updatedAt: now,
    version: newVersion,
  };
  await db.put(db.STORE_FILES, updated);
  return updated;
}
