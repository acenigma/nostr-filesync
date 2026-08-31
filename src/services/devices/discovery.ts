import type { NostrEvent, EventTemplate } from 'nostr-tools';
import type { Device, DevicePlatform } from '../db/index';
import * as devices from './index';

export const KIND_DEVICE_METADATA = 30078;
export const DEVICE_TAG = 'device';

export interface DeviceMetadataPayload {
  schema: 'nostr-filesync.device/v1';
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  capabilities: string[];
  lastSeen: number;
}

export class DeviceMetadataError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_PAYLOAD' | 'INVALID_TAGS' | 'INVALID_DEVICE_ID' | 'SCHEMA_MISMATCH'
  ) {
    super(message);
    this.name = 'DeviceMetadataError';
  }
}

export function encodeDeviceMetadata(device: Device): DeviceMetadataPayload {
  if (!device.id) {
    throw new DeviceMetadataError('Device sem id', 'INVALID_DEVICE_ID');
  }
  return {
    schema: 'nostr-filesync.device/v1',
    deviceId: device.id,
    name: device.name,
    platform: device.platform,
    appVersion: device.appVersion,
    lastSeen: device.lastSeen,
    capabilities: device.capabilities,
  };
}

export function decodeDeviceMetadata(content: string): DeviceMetadataPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DeviceMetadataError('JSON inválido', 'INVALID_PAYLOAD');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new DeviceMetadataError('Payload não é objeto', 'INVALID_PAYLOAD');
  }

  const p = parsed as Record<string, unknown>;
  if (p.schema !== 'nostr-filesync.device/v1') {
    throw new DeviceMetadataError(
      `Schema mismatch: esperado 'nostr-filesync.device/v1', recebido '${p.schema}'`,
      'SCHEMA_MISMATCH'
    );
  }

  if (typeof p.deviceId !== 'string' || !p.deviceId) {
    throw new DeviceMetadataError('deviceId ausente ou inválido', 'INVALID_PAYLOAD');
  }
  if (typeof p.name !== 'string' || !p.name) {
    throw new DeviceMetadataError('name ausente ou inválido', 'INVALID_PAYLOAD');
  }
  if (typeof p.platform !== 'string') {
    throw new DeviceMetadataError('platform ausente ou inválido', 'INVALID_PAYLOAD');
  }
  if (typeof p.appVersion !== 'string') {
    throw new DeviceMetadataError('appVersion ausente ou inválido', 'INVALID_PAYLOAD');
  }
  if (typeof p.lastSeen !== 'number') {
    throw new DeviceMetadataError('lastSeen ausente ou inválido', 'INVALID_PAYLOAD');
  }
  if (!Array.isArray(p.capabilities)) {
    throw new DeviceMetadataError('capabilities deve ser array', 'INVALID_PAYLOAD');
  }

  return {
    schema: 'nostr-filesync.device/v1',
    deviceId: p.deviceId,
    name: p.name,
    platform: p.platform as DevicePlatform,
    appVersion: p.appVersion,
    lastSeen: p.lastSeen,
    capabilities: p.capabilities as string[],
  };
}

export function buildDeviceEvent(
  device: Device,
  _pubkey: string
): Omit<EventTemplate, 'pubkey'> {
  const payload = encodeDeviceMetadata(device);
  return {
    kind: KIND_DEVICE_METADATA,
    content: JSON.stringify(payload),
    tags: [
      ['d', device.id],
      ['client', 'nostr-filesync'],
      ['t', DEVICE_TAG],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
}

export function parseDeviceEvent(
  event: Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'created_at' | 'pubkey'>
): { deviceId: string; pubkey: string; payload: DeviceMetadataPayload; createdAt: number } {
  if (event.kind !== KIND_DEVICE_METADATA) {
    throw new DeviceMetadataError(
      `Event kind errado: esperado ${KIND_DEVICE_METADATA}, recebido ${event.kind}`,
      'INVALID_TAGS'
    );
  }
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (!dTag) {
    throw new DeviceMetadataError('Tag "d" ausente', 'INVALID_TAGS');
  }
  const payload = decodeDeviceMetadata(event.content);
  if (payload.deviceId !== dTag) {
    throw new DeviceMetadataError(
      `deviceId inconsistente: tag d=${dTag}, payload=${payload.deviceId}`,
      'INVALID_TAGS'
    );
  }
  return {
    deviceId: dTag,
    pubkey: event.pubkey,
    payload,
    createdAt: event.created_at ?? 0,
  };
}

export function eventToDevice(
  event: Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'created_at' | 'pubkey'>
): Omit<Device, 'createdAt' | 'isLocal'> {
  const parsed = parseDeviceEvent(event);
  return {
    id: parsed.deviceId,
    pubkey: parsed.pubkey,
    name: parsed.payload.name,
    platform: parsed.payload.platform,
    appVersion: parsed.payload.appVersion,
    lastSeen: parsed.payload.lastSeen,
    capabilities: parsed.payload.capabilities,
  };
}

export function selectLatestDeviceEvents(
  events: Array<Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'created_at' | 'pubkey'>>
): NostrEvent[] {
  const byDevice = new Map<string, NostrEvent>();
  for (const ev of events) {
    try {
      const { deviceId, payload } = parseDeviceEvent(ev);
      const existing = byDevice.get(deviceId);
      if (!existing || payload.lastSeen > (existing as any)._lastSeen) {
        byDevice.set(deviceId, { ...ev, _lastSeen: payload.lastSeen } as any);
      }
    } catch {
      // ignora events inválidos
    }
  }
  return Array.from(byDevice.values());
}

export async function applyDeviceEvents(
  events: Array<Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'created_at' | 'pubkey'>>
): Promise<Device[]> {
  const latest = selectLatestDeviceEvents(events);
  const applied: Device[] = [];
  for (const ev of latest) {
    try {
      const partial = eventToDevice(ev);
      const d = await devices.discoverOrUpsert(partial);
      applied.push(d);
    } catch {
      // ignora
    }
  }
  return applied;
}
