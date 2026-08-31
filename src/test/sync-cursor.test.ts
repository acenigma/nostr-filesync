import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as cursor from '../services/sync/cursor';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const RELAY_1 = 'wss://relay1.example.com';
const RELAY_2 = 'wss://relay2.example.com';

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_SYNC_CURSORS);
});

describe('getCursorId', () => {
  it('combina pubkey:relayUrl', () => {
    expect(cursor.getCursorId(PUBKEY_A, RELAY_1)).toBe(`${PUBKEY_A}:${RELAY_1}`);
  });

  it('diferentes relays geram IDs diferentes', () => {
    expect(cursor.getCursorId(PUBKEY_A, RELAY_1)).not.toBe(
      cursor.getCursorId(PUBKEY_A, RELAY_2)
    );
  });
});

describe('getCursor / setCursor', () => {
  it('getCursor retorna null quando não existe', async () => {
    expect(await cursor.getCursor(PUBKEY_A, RELAY_1)).toBeNull();
  });

  it('setCursor cria novo cursor', async () => {
    const c = await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    expect(c.id).toBe(`${PUBKEY_A}:${RELAY_1}`);
    expect(c.pubkey).toBe(PUBKEY_A);
    expect(c.relayUrl).toBe(RELAY_1);
    expect(c.lastEventId).toBe('evt-1');
    expect(c.lastEventCreatedAt).toBe(100);
  });

  it('getCursor retorna cursor existente', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    const fetched = await cursor.getCursor(PUBKEY_A, RELAY_1);
    expect(fetched?.lastEventId).toBe('evt-1');
  });

  it('setCursor sobrescreve existente', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    const updated = await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-2', 200);
    expect(updated.lastEventId).toBe('evt-2');
    expect(updated.lastEventCreatedAt).toBe(200);
  });

  it('lança erro em pubkey inválido', async () => {
    await expect(cursor.setCursor('abc', RELAY_1, 'evt-1', 100)).rejects.toThrow(/pubkey/);
  });
});

describe('advanceCursor', () => {
  it('atualiza para evento mais recente', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    const advanced = await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-2', 200);
    expect(advanced.lastEventId).toBe('evt-2');
    expect(advanced.lastEventCreatedAt).toBe(200);
  });

  it('NÃO atualiza para evento mais antigo', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 200);
    const result = await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-old', 100);
    expect(result.lastEventId).toBe('evt-1');
    expect(result.lastEventCreatedAt).toBe(200);
  });

  it('NÃO atualiza para evento com mesmo timestamp', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 200);
    const result = await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-2', 200);
    expect(result.lastEventId).toBe('evt-1');
  });

  it('cria cursor se não existir', async () => {
    const advanced = await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    expect(advanced.lastEventId).toBe('evt-1');
  });
});

describe('deleteCursor', () => {
  it('remove cursor existente', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    expect(await cursor.deleteCursor(PUBKEY_A, RELAY_1)).toBe(true);
    expect(await cursor.getCursor(PUBKEY_A, RELAY_1)).toBeNull();
  });

  it('retorna false para cursor inexistente', async () => {
    expect(await cursor.deleteCursor(PUBKEY_A, RELAY_1)).toBe(false);
  });
});

describe('listCursorsByPubkey / listAllCursors', () => {
  it('listAllCursors retorna todos', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    await cursor.setCursor(PUBKEY_A, RELAY_2, 'evt-2', 200);
    await cursor.setCursor(PUBKEY_B, RELAY_1, 'evt-3', 300);
    const all = await cursor.listAllCursors();
    expect(all).toHaveLength(3);
  });

  it('listCursorsByPubkey filtra por pubkey', async () => {
    await cursor.setCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    await cursor.setCursor(PUBKEY_A, RELAY_2, 'evt-2', 200);
    await cursor.setCursor(PUBKEY_B, RELAY_1, 'evt-3', 300);

    const cursorsA = await cursor.listCursorsByPubkey(PUBKEY_A);
    expect(cursorsA).toHaveLength(2);
    expect(cursorsA.every((c) => c.pubkey === PUBKEY_A)).toBe(true);

    const cursorsB = await cursor.listCursorsByPubkey(PUBKEY_B);
    expect(cursorsB).toHaveLength(1);
  });
});

describe('Cenários de uso', () => {
  it('pull de N eventos: cursor avança para o mais recente', async () => {
    const events = [
      { id: 'evt-1', createdAt: 100 },
      { id: 'evt-2', createdAt: 200 },
      { id: 'evt-3', createdAt: 300 },
    ];

    let current = await cursor.getCursor(PUBKEY_A, RELAY_1);
    expect(current).toBeNull();

    for (const ev of events) {
      await cursor.advanceCursor(PUBKEY_A, RELAY_1, ev.id, ev.createdAt);
    }

    const final = await cursor.getCursor(PUBKEY_A, RELAY_1);
    expect(final?.lastEventId).toBe('evt-3');
    expect(final?.lastEventCreatedAt).toBe(300);
  });

  it('replay (mesmo evento não avança)', async () => {
    await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    const before = await cursor.getCursor(PUBKEY_A, RELAY_1);

    await cursor.advanceCursor(PUBKEY_A, RELAY_1, 'evt-1', 100);
    const after = await cursor.getCursor(PUBKEY_A, RELAY_1);

    expect(after?.lastEventId).toBe(before?.lastEventId);
  });
});
