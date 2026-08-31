import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../services/db';
import * as devices from '../services/devices';

const PUBKEY = 'a'.repeat(64);
const PUBKEY_2 = 'b'.repeat(64);

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_DEVICES);
});

describe('getOrCreateLocalDeviceId', () => {
  it('retorna mesmo id em chamadas subsequentes', () => {
    const id1 = devices.getOrCreateLocalDeviceId();
    const id2 = devices.getOrCreateLocalDeviceId();
    expect(id1).toBe(id2);
  });

  it('gera id com prefixo dev-', () => {
    const id = devices.getOrCreateLocalDeviceId();
    expect(id).toMatch(/^dev-/);
  });

  it('persiste no localStorage', () => {
    const id = devices.getOrCreateLocalDeviceId();
    expect(localStorage.getItem('nostr_filesync_device_id')).toBe(id);
  });
});

describe('setLocalDeviceName / getLocalDeviceName', () => {
  it('default name quando não configurado', () => {
    expect(devices.getLocalDeviceName()).toBeTruthy();
  });

  it('setLocalDeviceName persiste', () => {
    devices.setLocalDeviceName('Meu MacBook');
    expect(devices.getLocalDeviceName()).toBe('Meu MacBook');
  });

  it('lança erro em nome vazio', () => {
    expect(() => devices.setLocalDeviceName('')).toThrow();
    expect(() => devices.setLocalDeviceName('   ')).toThrow();
  });

  it('lança erro em nome muito longo', () => {
    expect(() => devices.setLocalDeviceName('a'.repeat(65))).toThrow();
  });
});

describe('getLocalPlatform', () => {
  it('retorna platform detectado', () => {
    const p = devices.getLocalPlatform();
    expect(['web', 'android', 'ios', 'desktop', 'unknown']).toContain(p);
  });

  it('persiste no localStorage', () => {
    const p = devices.getLocalPlatform();
    expect(localStorage.getItem('nostr_filesync_device_platform')).toBe(p);
  });
});

describe('registerLocalDevice', () => {
  it('cria device com isLocal=true', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY });
    expect(d.isLocal).toBe(true);
    expect(d.pubkey).toBe(PUBKEY);
    expect(d.id).toMatch(/^dev-/);
    expect(d.appVersion).toBeTruthy();
  });

  it('cria device com name customizado', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY, name: 'Custom' });
    expect(d.name).toBe('Custom');
  });

  it('cria device com platform customizado', async () => {
    const d = await devices.registerLocalDevice({
      pubkey: PUBKEY,
      platform: 'android',
    });
    expect(d.platform).toBe('android');
  });

  it('cria device com capabilities customizadas', async () => {
    const d = await devices.registerLocalDevice({
      pubkey: PUBKEY,
      capabilities: ['upload', 'share'],
    });
    expect(d.capabilities).toEqual(['upload', 'share']);
  });

  it('lança erro em pubkey inválido', async () => {
    await expect(devices.registerLocalDevice({ pubkey: 'abc' })).rejects.toThrow();
  });
});

describe('getDevice / getLocalDevice', () => {
  it('getDevice retorna null para id inexistente', async () => {
    expect(await devices.getDevice('dev-nope')).toBeNull();
  });

  it('getLocalDevice retorna device registrado', async () => {
    const created = await devices.registerLocalDevice({ pubkey: PUBKEY });
    const fetched = await devices.getLocalDevice(PUBKEY);
    expect(fetched?.id).toBe(created.id);
  });

  it('getLocalDevice retorna null se pubkey diferente', async () => {
    await devices.registerLocalDevice({ pubkey: PUBKEY });
    expect(await devices.getLocalDevice(PUBKEY_2)).toBeNull();
  });
});

describe('listAllDevices / listDevicesByPubkey', () => {
  beforeEach(async () => {
    await db.clear(db.STORE_DEVICES);
  });

  it('listAllDevices retorna todos', async () => {
    await devices.registerLocalDevice({ pubkey: PUBKEY });
    await devices.discoverOrUpsert({
      id: 'dev-remote-1',
      pubkey: PUBKEY,
      name: 'Phone',
      platform: 'ios',
      appVersion: '0.0.0',
      lastSeen: Date.now(),
      capabilities: [],
    });
    const all = await devices.listAllDevices();
    expect(all).toHaveLength(2);
  });

  it('listDevicesByPubkey filtra', async () => {
    await devices.registerLocalDevice({ pubkey: PUBKEY });
    await devices.discoverOrUpsert({
      id: 'dev-other',
      pubkey: PUBKEY_2,
      name: 'Other',
      platform: 'web',
      appVersion: '0.0.0',
      lastSeen: Date.now(),
      capabilities: [],
    });
    const a = await devices.listDevicesByPubkey(PUBKEY);
    expect(a.every((d) => d.pubkey === PUBKEY)).toBe(true);
  });
});

describe('touchLastSeen / renameDevice / updateCapabilities', () => {
  it('touchLastSeen atualiza lastSeen', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY });
    const old = d.lastSeen;
    await new Promise((r) => setTimeout(r, 10));
    const touched = await devices.touchLastSeen(d.id);
    expect(touched!.lastSeen).toBeGreaterThan(old);
  });

  it('renameDevice altera nome', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY });
    const renamed = await devices.renameDevice(d.id, 'New Name');
    expect(renamed.name).toBe('New Name');
  });

  it('renameDevice lança erro se device não existe', async () => {
    await expect(devices.renameDevice('dev-nope', 'x')).rejects.toThrow();
  });

  it('updateCapabilities altera capabilities', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY });
    const updated = await devices.updateCapabilities(d.id, ['a', 'b']);
    expect(updated.capabilities).toEqual(['a', 'b']);
  });
});

describe('deleteDevice', () => {
  it('remove device existente', async () => {
    const d = await devices.registerLocalDevice({ pubkey: PUBKEY });
    expect(await devices.deleteDevice(d.id)).toBe(true);
    expect(await devices.getDevice(d.id)).toBeNull();
  });

  it('retorna false para device inexistente', async () => {
    expect(await devices.deleteDevice('dev-nope')).toBe(false);
  });
});

describe('discoverOrUpsert', () => {
  it('cria novo device remoto', async () => {
    const d = await devices.discoverOrUpsert({
      id: 'dev-remote-1',
      pubkey: PUBKEY,
      name: 'iPhone',
      platform: 'ios',
      appVersion: '0.0.0',
      lastSeen: Date.now(),
      capabilities: ['upload'],
    });
    expect(d.isLocal).toBe(false);
    expect(d.name).toBe('iPhone');
  });

  it('atualiza device existente (upsert)', async () => {
    const t0 = Date.now();
    await devices.discoverOrUpsert({
      id: 'dev-remote-1',
      pubkey: PUBKEY,
      name: 'Old Name',
      platform: 'web',
      appVersion: '0.0.0',
      lastSeen: t0,
      capabilities: ['a'],
    });
    const t1 = Date.now() + 1000;
    const updated = await devices.discoverOrUpsert({
      id: 'dev-remote-1',
      pubkey: PUBKEY,
      name: 'New Name',
      platform: 'android',
      appVersion: '0.1.0',
      lastSeen: t1,
      capabilities: ['b'],
    });
    expect(updated.name).toBe('New Name');
    expect(updated.platform).toBe('android');
    expect(updated.appVersion).toBe('0.1.0');
    expect(updated.lastSeen).toBe(t1);
  });

  it('lança erro em pubkey inválido', async () => {
    await expect(
      devices.discoverOrUpsert({
        id: 'dev-x',
        pubkey: 'bad',
        name: 'x',
        platform: 'web',
        appVersion: '0.0.0',
        lastSeen: 0,
        capabilities: [],
      })
    ).rejects.toThrow();
  });
});
