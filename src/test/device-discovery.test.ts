import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from 'nostr-tools';
import * as db from '../services/db';
import * as devices from '../services/devices';
import * as discovery from '../services/devices/discovery';

const PUBKEY = 'a'.repeat(64);

const makeEvent = (
  overrides: Partial<{
    pubkey: string;
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
    id: string;
    sig: string;
  }> = {}
): NostrEvent => ({
  id: overrides.id ?? 'evt-1',
  pubkey: overrides.pubkey ?? PUBKEY,
  kind: overrides.kind ?? discovery.KIND_DEVICE_METADATA,
  content: overrides.content ?? '',
  tags: overrides.tags ?? [['d', 'dev-1']],
  created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
  sig: overrides.sig ?? 'sig',
});

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_DEVICES);
});

describe('encodeDeviceMetadata / decodeDeviceMetadata', () => {
  it('roundtrip preserva dados', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'iPhone',
      platform: 'ios',
      appVersion: '0.1.0',
      lastSeen: 1700000000000,
      capabilities: ['upload', 'download'],
      isLocal: false,
      createdAt: 1700000000000,
    };
    const payload = discovery.encodeDeviceMetadata(device);
    const json = JSON.stringify(payload);
    const decoded = discovery.decodeDeviceMetadata(json);
    expect(decoded).toEqual(payload);
  });

  it('decodeDeviceMetadata lança em JSON inválido', () => {
    expect(() => discovery.decodeDeviceMetadata('not json')).toThrow(/JSON/);
  });

  it('decodeDeviceMetadata lança em schema mismatch', () => {
    expect(() =>
      discovery.decodeDeviceMetadata(JSON.stringify({ schema: 'wrong' }))
    ).toThrow(/Schema/);
  });

  it('decodeDeviceMetadata valida campos obrigatórios', () => {
    expect(() =>
      discovery.decodeDeviceMetadata(JSON.stringify({ schema: 'nostr-filesync.device/v1' }))
    ).toThrow(/deviceId/);
    expect(() =>
      discovery.decodeDeviceMetadata(
        JSON.stringify({ schema: 'nostr-filesync.device/v1', deviceId: 'd1' })
      )
    ).toThrow(/name/);
  });

  it('encodeDeviceMetadata lança se device sem id', () => {
    const device = {
      id: '',
      pubkey: PUBKEY,
      name: 'x',
      platform: 'web' as const,
      appVersion: '0',
      lastSeen: 0,
      capabilities: [],
      isLocal: false,
      createdAt: 0,
    };
    expect(() => discovery.encodeDeviceMetadata(device)).toThrow(/sem id/);
  });
});

describe('buildDeviceEvent', () => {
  it('cria evento kind 30078 com tags corretas', () => {
    const device: devices.Device = {
      id: 'dev-abc',
      pubkey: PUBKEY,
      name: 'Mac',
      platform: 'web',
      appVersion: '0.1.0',
      lastSeen: 0,
      capabilities: ['upload'],
      isLocal: true,
      createdAt: 0,
    };
    const event = discovery.buildDeviceEvent(device, PUBKEY);
    expect(event.kind).toBe(30078);
    expect(event.tags).toContainEqual(['d', 'dev-abc']);
    expect(event.tags).toContainEqual(['client', 'nostr-filesync']);
    expect(event.tags).toContainEqual(['t', 'device']);
  });

  it('content é JSON válido do metadata', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'Test',
      platform: 'android',
      appVersion: '1.0',
      lastSeen: 1700000000000,
      capabilities: ['a', 'b'],
      isLocal: false,
      createdAt: 0,
    };
    const event = discovery.buildDeviceEvent(device, PUBKEY);
    const payload = JSON.parse(event.content);
    expect(payload.deviceId).toBe('dev-1');
    expect(payload.name).toBe('Test');
  });
});

describe('parseDeviceEvent', () => {
  it('parse evento válido', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'X',
      platform: 'web',
      appVersion: '0.1.0',
      lastSeen: 1700000000000,
      capabilities: [],
      isLocal: false,
      createdAt: 0,
    };
    const event = makeEvent({
      pubkey: PUBKEY,
      content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
      tags: [['d', 'dev-1']],
    });
    const parsed = discovery.parseDeviceEvent(event);
    expect(parsed.deviceId).toBe('dev-1');
    expect(parsed.pubkey).toBe(PUBKEY);
  });

  it('lança em kind errado', () => {
    const event = makeEvent({ kind: 1 });
    expect(() => discovery.parseDeviceEvent(event)).toThrow(/kind/);
  });

  it('lança em tag d ausente', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'X',
      platform: 'web',
      appVersion: '0',
      lastSeen: 0,
      capabilities: [],
      isLocal: false,
      createdAt: 0,
    };
    const event = makeEvent({
      content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
      tags: [],
    });
    expect(() => discovery.parseDeviceEvent(event)).toThrow(/d.*ausente/);
  });

  it('lança em inconsistência entre tag d e deviceId', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'X',
      platform: 'web',
      appVersion: '0',
      lastSeen: 0,
      capabilities: [],
      isLocal: false,
      createdAt: 0,
    };
    const event = makeEvent({
      content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
      tags: [['d', 'dev-DIFFERENT']],
    });
    expect(() => discovery.parseDeviceEvent(event)).toThrow(/inconsistente/);
  });
});

describe('eventToDevice', () => {
  it('converte evento para Device partial', () => {
    const device: devices.Device = {
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'Phone',
      platform: 'ios',
      appVersion: '0.2.0',
      lastSeen: 1700000000000,
      capabilities: ['upload'],
      isLocal: false,
      createdAt: 0,
    };
    const event = makeEvent({
      pubkey: PUBKEY,
      content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
      tags: [['d', 'dev-1']],
    });
    const partial = discovery.eventToDevice(event);
    expect(partial.id).toBe('dev-1');
    expect(partial.pubkey).toBe(PUBKEY);
    expect(partial.name).toBe('Phone');
    expect(partial.platform).toBe('ios');
  });
});

describe('selectLatestDeviceEvents', () => {
  it('seleciona evento mais recente por deviceId', () => {
    const make = (lastSeen: number, id: string): NostrEvent => {
      const device: devices.Device = {
        id,
        pubkey: PUBKEY,
        name: 'X',
        platform: 'web',
        appVersion: '0',
        lastSeen,
        capabilities: [],
        isLocal: false,
        createdAt: 0,
      };
      return makeEvent({
        content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
        tags: [['d', id]],
        id: `evt-${id}-${lastSeen}`,
      });
    };

    const events = [
      make(100, 'dev-1'),
      make(300, 'dev-1'), // mais recente do dev-1
      make(200, 'dev-2'),
    ];
    const selected = discovery.selectLatestDeviceEvents(events);
    expect(selected).toHaveLength(2);
    const byId = new Map(selected.map((e) => [e.id, e]));
    expect(byId.get('evt-dev-1-300')).toBeDefined();
    expect(byId.get('evt-dev-2-200')).toBeDefined();
  });

  it('ignora eventos inválidos', () => {
    const events = [
      makeEvent({ kind: 1 }), // kind errado
      makeEvent({ content: 'invalid json' }),
    ];
    const selected = discovery.selectLatestDeviceEvents(events);
    expect(selected).toHaveLength(0);
  });
});

describe('applyDeviceEvents', () => {
  it('aplica eventos e persiste devices', async () => {
    const make = (id: string, name: string, lastSeen: number): NostrEvent => {
      const device: devices.Device = {
        id,
        pubkey: PUBKEY,
        name,
        platform: 'web',
        appVersion: '0.1.0',
        lastSeen,
        capabilities: [],
        isLocal: false,
        createdAt: 0,
      };
      return makeEvent({
        content: JSON.stringify(discovery.encodeDeviceMetadata(device)),
        tags: [['d', id]],
      });
    };

    const events = [make('dev-1', 'Phone', 100), make('dev-2', 'Laptop', 200)];
    const applied = await discovery.applyDeviceEvents(events);

    expect(applied).toHaveLength(2);
    const all = await devices.listAllDevices();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.id === 'dev-1')?.name).toBe('Phone');
  });
});
