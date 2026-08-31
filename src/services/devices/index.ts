import * as db from '../db/index';
import type { Device, DevicePlatform } from '../db/index';

export type { Device, DevicePlatform } from '../db/index';

const DEVICE_ID_KEY = 'nostr_filesync_device_id';
const DEVICE_NAME_KEY = 'nostr_filesync_device_name';
const PLATFORM_KEY = 'nostr_filesync_device_platform';
const APP_VERSION = '0.0.0';

function makeDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'dev-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultDeviceName(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux';
  }
  return 'Unknown device';
}

function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac|Win|Linux/.test(ua)) return 'web';
  return 'unknown';
}

function validateName(name: string): void {
  if (!name || !name.trim()) {
    throw new Error('Device name não pode ser vazio');
  }
  if (name.length > 64) {
    throw new Error('Device name muito longo (máx 64)');
  }
}

function validatePubkey(pubkey: string): void {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error(`pubkey inválido: ${pubkey}`);
  }
}

export function getOrCreateLocalDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = makeDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getLocalDeviceName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) || defaultDeviceName();
}

export function setLocalDeviceName(name: string): void {
  validateName(name);
  localStorage.setItem(DEVICE_NAME_KEY, name.trim());
}

export function getLocalPlatform(): DevicePlatform {
  const stored = localStorage.getItem(PLATFORM_KEY) as DevicePlatform | null;
  if (stored) return stored;
  const detected = detectPlatform();
  localStorage.setItem(PLATFORM_KEY, detected);
  return detected;
}

export interface RegisterLocalDeviceInput {
  pubkey: string;
  name?: string;
  platform?: DevicePlatform;
  capabilities?: string[];
}

export async function registerLocalDevice(
  input: RegisterLocalDeviceInput
): Promise<Device> {
  validatePubkey(input.pubkey);
  const id = getOrCreateLocalDeviceId();
  const now = Date.now();
  const device: Device = {
    id,
    pubkey: input.pubkey,
    name: input.name?.trim() || getLocalDeviceName(),
    platform: input.platform || getLocalPlatform(),
    appVersion: APP_VERSION,
    lastSeen: now,
    capabilities: input.capabilities ?? ['upload', 'download', 'sync'],
    isLocal: true,
    createdAt: now,
  };
  await db.put(db.STORE_DEVICES, device);
  return device;
}

export async function getDevice(id: string): Promise<Device | null> {
  const d = await db.get<Device>(db.STORE_DEVICES, id);
  return d ?? null;
}

export async function listAllDevices(): Promise<Device[]> {
  return db.getAll<Device>(db.STORE_DEVICES);
}

export async function listDevicesByPubkey(pubkey: string): Promise<Device[]> {
  const all = await listAllDevices();
  return all.filter((d) => d.pubkey === pubkey);
}

export async function getLocalDevice(pubkey: string): Promise<Device | null> {
  const id = getOrCreateLocalDeviceId();
  const d = await getDevice(id);
  if (d && d.pubkey === pubkey) return d;
  return null;
}

export async function touchLastSeen(id: string): Promise<Device | null> {
  const d = await getDevice(id);
  if (!d) return null;
  const updated: Device = { ...d, lastSeen: Date.now() };
  await db.put(db.STORE_DEVICES, updated);
  return updated;
}

export async function renameDevice(id: string, name: string): Promise<Device> {
  validateName(name);
  const d = await getDevice(id);
  if (!d) throw new Error(`Device não encontrado: ${id}`);
  const updated: Device = { ...d, name: name.trim() };
  await db.put(db.STORE_DEVICES, updated);
  return updated;
}

export async function updateCapabilities(
  id: string,
  capabilities: string[]
): Promise<Device> {
  const d = await getDevice(id);
  if (!d) throw new Error(`Device não encontrado: ${id}`);
  const updated: Device = { ...d, capabilities };
  await db.put(db.STORE_DEVICES, updated);
  return updated;
}

export async function deleteDevice(id: string): Promise<boolean> {
  const d = await getDevice(id);
  if (!d) return false;
  await db.del(db.STORE_DEVICES, id);
  return true;
}

export async function discoverOrUpsert(
  remote: Omit<Device, 'createdAt' | 'isLocal'>
): Promise<Device> {
  validatePubkey(remote.pubkey);
  validateName(remote.name);
  const existing = await getDevice(remote.id);
  const now = Date.now();
  if (existing) {
    const updated: Device = {
      ...existing,
      name: remote.name,
      platform: remote.platform,
      appVersion: remote.appVersion,
      lastSeen: remote.lastSeen,
      capabilities: remote.capabilities,
      isLocal: false,
    };
    await db.put(db.STORE_DEVICES, updated);
    return updated;
  }
  const device: Device = {
    id: remote.id,
    pubkey: remote.pubkey,
    name: remote.name,
    platform: remote.platform,
    appVersion: remote.appVersion,
    lastSeen: remote.lastSeen,
    capabilities: remote.capabilities,
    isLocal: false,
    createdAt: now,
  };
  await db.put(db.STORE_DEVICES, device);
  return device;
}
