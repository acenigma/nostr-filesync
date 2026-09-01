import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as folders from '../services/folders';
import { FolderError } from '../services/folders';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_FOLDERS);
});

describe('createFolder', () => {
  it('cria pasta raiz com id único', async () => {
    const folder = await folders.createFolder({ name: 'Documents' });
    expect(folder.id).toMatch(/^fld-/);
    expect(folder.parentId).toBeNull();
    expect(folder.name).toBe('Documents');
    expect(folder.version).toBe(1);
    expect(folder.createdAt).toBeGreaterThan(0);
    expect(folder.updatedAt).toBeGreaterThan(0);
  });

  it('cria pasta dentro de outra pasta', async () => {
    const parent = await folders.createFolder({ name: 'Photos' });
    const child = await folders.createFolder({ name: '2024', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(child.name).toBe('2024');
  });

  it('trim espaços no nome', async () => {
    const folder = await folders.createFolder({ name: '  Spaced  ' });
    expect(folder.name).toBe('Spaced');
  });

  it('lança erro em nome vazio', async () => {
    await expect(folders.createFolder({ name: '' })).rejects.toThrow(FolderError);
    await expect(folders.createFolder({ name: '   ' })).rejects.toThrow(FolderError);
  });

  it('lança erro em nome com /', async () => {
    await expect(folders.createFolder({ name: 'a/b' })).rejects.toThrow(FolderError);
  });

  it('lança erro em nome com caractere nulo', async () => {
    await expect(folders.createFolder({ name: 'a\0b' })).rejects.toThrow(FolderError);
  });

  it('lança erro em nome muito longo (> 255 chars)', async () => {
    const longName = 'a'.repeat(256);
    await expect(folders.createFolder({ name: longName })).rejects.toThrow(FolderError);
  });

  it('lança erro se parentId não existir', async () => {
    await expect(
      folders.createFolder({ name: 'child', parentId: 'fld-nonexistent' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lança erro em nome duplicado no mesmo parent', async () => {
    await folders.createFolder({ name: 'docs' });
    await expect(folders.createFolder({ name: 'docs' })).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('permite mesmo nome em parents diferentes', async () => {
    const a = await folders.createFolder({ name: 'A' });
    await folders.createFolder({ name: 'sub' });
    const sub = await folders.createFolder({ name: 'sub', parentId: a.id });
    expect(sub.parentId).toBe(a.id);
  });
});

describe('getFolder', () => {
  it('retorna null para id inexistente', async () => {
    const result = await folders.getFolder('fld-nonexistent');
    expect(result).toBeNull();
  });

  it('retorna pasta existente', async () => {
    const created = await folders.createFolder({ name: 'test' });
    const fetched = await folders.getFolder(created.id);
    expect(fetched).toEqual(created);
  });
});

describe('listFolders', () => {
  beforeEach(async () => {
    await db.clear(db.STORE_FOLDERS);
  });

  it('retorna pastas raiz quando parentId é null', async () => {
    await folders.createFolder({ name: 'root1' });
    await folders.createFolder({ name: 'root2' });
    const parent = await folders.createFolder({ name: 'parent' });
    await folders.createFolder({ name: 'child', parentId: parent.id });

    const roots = await folders.listFolders(null);
    expect(roots).toHaveLength(3);
    expect(roots.map((f) => f.name).sort()).toEqual(['parent', 'root1', 'root2']);
  });

  it('retorna apenas filhos diretos', async () => {
    const parent = await folders.createFolder({ name: 'p' });
    const child = await folders.createFolder({ name: 'c', parentId: parent.id });
    await folders.createFolder({ name: 'gc', parentId: child.id });

    const children = await folders.listFolders(parent.id);
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(child.id);
  });

  it('listAllFolders retorna todas as pastas', async () => {
    const parent = await folders.createFolder({ name: 'p' });
    await folders.createFolder({ name: 'c', parentId: parent.id });
    await folders.createFolder({ name: 'root' });

    const all = await folders.listAllFolders();
    expect(all).toHaveLength(3);
  });
});

describe('updateFolder (rename)', () => {
  it('atualiza nome', async () => {
    const folder = await folders.createFolder({ name: 'old' });
    const updated = await folders.updateFolder(folder.id, { name: 'new' });
    expect(updated.name).toBe('new');
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(folder.updatedAt);
  });

  it('lança erro em nome vazio', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    await expect(folders.updateFolder(folder.id, { name: '' })).rejects.toThrow(FolderError);
  });

  it('lança erro em nome duplicado no mesmo parent', async () => {
    await folders.createFolder({ name: 'a' });
    const b = await folders.createFolder({ name: 'b' });
    await expect(folders.updateFolder(b.id, { name: 'a' })).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('permite renomear para mesmo nome (no-op)', async () => {
    const folder = await folders.createFolder({ name: 'same' });
    const updated = await folders.updateFolder(folder.id, { name: 'same' });
    expect(updated.name).toBe('same');
    expect(updated.version).toBe(2);
  });

  it('lança erro ao renomear pasta inexistente', async () => {
    await expect(
      folders.updateFolder('fld-nonexistent', { name: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('updateFolder (move)', () => {
  it('move pasta para outro parent', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    const sub = await folders.createFolder({ name: 'sub', parentId: a.id });

    const moved = await folders.updateFolder(sub.id, { parentId: b.id });
    expect(moved.parentId).toBe(b.id);
    expect(moved.version).toBe(2);
  });

  it('move para raiz (parentId null)', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const sub = await folders.createFolder({ name: 'sub', parentId: a.id });

    const moved = await folders.updateFolder(sub.id, { parentId: null });
    expect(moved.parentId).toBeNull();
  });

  it('lança erro ao mover para si mesma', async () => {
    const folder = await folders.createFolder({ name: 'self' });
    await expect(
      folders.updateFolder(folder.id, { parentId: folder.id })
    ).rejects.toMatchObject({ code: 'CYCLE' });
  });

  it('lança erro ao criar ciclo (mover pai para dentro de filho)', async () => {
    const parent = await folders.createFolder({ name: 'parent' });
    const child = await folders.createFolder({ name: 'child', parentId: parent.id });
    const grandchild = await folders.createFolder({ name: 'gc', parentId: child.id });

    await expect(
      folders.updateFolder(parent.id, { parentId: grandchild.id })
    ).rejects.toMatchObject({ code: 'CYCLE' });
  });

  it('lança erro ao mover para parentId inexistente', async () => {
    const folder = await folders.createFolder({ name: 'x' });
    await expect(
      folders.updateFolder(folder.id, { parentId: 'fld-nope' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lança erro se nome colidir com pasta existente no novo parent', async () => {
    const a = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B' });
    await folders.createFolder({ name: 'shared', parentId: a.id });
    const toMove = await folders.createFolder({ name: 'shared', parentId: b.id });

    await expect(
      folders.updateFolder(toMove.id, { parentId: a.id })
    ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });
});

describe('deleteFolder', () => {
  it('deleta pasta sem filhos', async () => {
    const folder = await folders.createFolder({ name: 'lonely' });
    const deleted = await folders.deleteFolder(folder.id, { permanent: true });
    expect(deleted).toEqual([folder.id]);
    expect(await folders.getFolder(folder.id)).toBeNull();
  });

  it('deleta pasta + descendentes (cascade)', async () => {
    const root = await folders.createFolder({ name: 'root' });
    const child = await folders.createFolder({ name: 'child', parentId: root.id });
    const grandchild = await folders.createFolder({ name: 'gc', parentId: child.id });
    const sibling = await folders.createFolder({ name: 'sibling' });

    const deleted = await folders.deleteFolder(root.id, { permanent: true });
    expect(deleted.sort()).toEqual([root.id, child.id, grandchild.id].sort());

    expect(await folders.getFolder(root.id)).toBeNull();
    expect(await folders.getFolder(child.id)).toBeNull();
    expect(await folders.getFolder(grandchild.id)).toBeNull();
    expect(await folders.getFolder(sibling.id)).not.toBeNull();
  });

  it('lança erro ao deletar pasta inexistente', async () => {
    await expect(folders.deleteFolder('fld-nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('deleteFolder com árvore profunda deleta todos os níveis', async () => {
    let parent: folders.FolderRecord | null = null;
    for (let i = 0; i < 10; i++) {
      parent = await folders.createFolder({ name: `level-${i}`, parentId: parent?.id ?? null });
    }
    const root = (await folders.listFolders(null))[0];

    const deleted = await folders.deleteFolder(root.id, { permanent: true });
    expect(deleted).toHaveLength(10);
  });
});

describe('buildFolderTree', () => {
  it('retorna null quando não há pastas', async () => {
    expect(await folders.buildFolderTree()).toBeNull();
  });

  it('retorna single root quando há uma pasta raiz', async () => {
    await folders.createFolder({ name: 'only' });
    const tree = await folders.buildFolderTree();
    expect(tree).not.toBeNull();
    expect(tree!.folder.name).toBe('only');
    expect(tree!.depth).toBe(0);
    expect(tree!.children).toEqual([]);
  });

  it('constrói árvore aninhada corretamente', async () => {
    const root = await folders.createFolder({ name: 'A' });
    const b = await folders.createFolder({ name: 'B', parentId: root.id });
    const c = await folders.createFolder({ name: 'C', parentId: b.id });
    await folders.createFolder({ name: 'D', parentId: c.id });

    const tree = await folders.buildFolderTree();
    expect(tree!.folder.name).toBe('A');
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].folder.name).toBe('B');
    expect(tree!.children[0].depth).toBe(1);
    expect(tree!.children[0].children[0].folder.name).toBe('C');
    expect(tree!.children[0].children[0].children[0].folder.name).toBe('D');
  });

  it('cria virtual root quando há múltiplas pastas raiz', async () => {
    await folders.createFolder({ name: 'root1' });
    await folders.createFolder({ name: 'root2' });

    const tree = await folders.buildFolderTree();
    expect(tree!.folder.id).toBe('__virtual_root__');
    expect(tree!.children).toHaveLength(2);
    expect(tree!.children.map((c) => c.folder.name).sort()).toEqual(['root1', 'root2']);
  });

  it('ordena filhos alfabeticamente', async () => {
    const root = await folders.createFolder({ name: 'root' });
    await folders.createFolder({ name: 'z', parentId: root.id });
    await folders.createFolder({ name: 'a', parentId: root.id });
    await folders.createFolder({ name: 'm', parentId: root.id });

    const tree = await folders.buildFolderTree();
    expect(tree!.folder.name).toBe('root');
    const names = tree!.children.map((c) => c.folder.name);
    expect(names).toEqual(['a', 'm', 'z']);
  });
});
