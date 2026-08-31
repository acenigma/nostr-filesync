import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { afterEach } from 'vitest';
import * as db from '../services/db';
import * as devices from '../services/devices';
import DevicesPanel, {
  getDeviceStatus,
  formatLastSeen,
  getStatusColor,
  getStatusLabel,
  type DeviceStatus,
} from '../components/DevicesPanel';

const PUBKEY = 'a'.repeat(64);

beforeEach(async () => {
  db.__useIsolatedDatabaseForTesting();
  localStorage.clear();
  await db.clear(db.STORE_DEVICES);
});

afterEach(() => {
  // Cleanup timers
});

describe('getDeviceStatus', () => {
  const now = 1000000;
  it('online: lastSeen < 5 min', () => {
    expect(getDeviceStatus(now - 60 * 1000, now)).toBe('online');
    expect(getDeviceStatus(now - 4 * 60 * 1000, now)).toBe('online');
  });

  it('recent: lastSeen < 24h', () => {
    expect(getDeviceStatus(now - 30 * 60 * 1000, now)).toBe('recent');
    expect(getDeviceStatus(now - 12 * 60 * 60 * 1000, now)).toBe('recent');
  });

  it('offline: lastSeen > 24h', () => {
    expect(getDeviceStatus(now - 48 * 60 * 60 * 1000, now)).toBe('offline');
  });
});

describe('formatLastSeen', () => {
  const now = 1000000;
  it('recently (< 1 min): "agora"', () => {
    expect(formatLastSeen(now - 30 * 1000, now)).toBe('agora');
  });

  it('minutes', () => {
    expect(formatLastSeen(now - 5 * 60 * 1000, now)).toBe('5 min atrás');
  });

  it('hours', () => {
    expect(formatLastSeen(now - 3 * 60 * 60 * 1000, now)).toBe('3 h atrás');
  });

  it('days', () => {
    expect(formatLastSeen(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 dia(s) atrás');
  });
});

describe('getStatusColor / getStatusLabel', () => {
  const statuses: DeviceStatus[] = ['online', 'recent', 'offline'];
  for (const s of statuses) {
    it(`${s}: tem cor e label`, () => {
      expect(getStatusColor(s)).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(getStatusLabel(s)).toBeTruthy();
    });
  }
});

describe('DevicesPanel', () => {
  it('renderiza loading inicialmente', () => {
    render(<DevicesPanel pubkey={PUBKEY} />);
    expect(screen.getByText(/Carregando devices/)).toBeTruthy();
  });

  it('renderiza empty state quando sem devices', async () => {
    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });
    expect(screen.getByText(/Nenhum device conhecido/)).toBeTruthy();
  });

  it('lista devices do pubkey', async () => {
    await devices.registerLocalDevice({ pubkey: PUBKEY, name: 'My Laptop' });
    await devices.discoverOrUpsert({
      id: 'dev-phone-1',
      pubkey: PUBKEY,
      name: 'My Phone',
      platform: 'ios',
      appVersion: '1.0.0',
      lastSeen: Date.now(),
      capabilities: ['upload'],
    });

    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });

    expect(screen.getByText('My Laptop')).toBeTruthy();
    expect(screen.getByText('My Phone')).toBeTruthy();
    expect(screen.getByText(/Devices \(2\)/)).toBeTruthy();
  });

  it('marca device local com badge "Este device"', async () => {
    await devices.registerLocalDevice({ pubkey: PUBKEY, name: 'Local' });
    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });
    expect(screen.getByText('Este device')).toBeTruthy();
  });

  it('mostra plataforma e versão', async () => {
    await devices.discoverOrUpsert({
      id: 'dev-1',
      pubkey: PUBKEY,
      name: 'Phone',
      platform: 'ios',
      appVersion: '2.5.0',
      lastSeen: Date.now(),
      capabilities: [],
    });
    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });
    expect(screen.getByText('ios')).toBeTruthy();
    expect(screen.getByText(/v2\.5\.0/)).toBeTruthy();
  });

  it('filtra devices por pubkey', async () => {
    const otherPubkey = 'b'.repeat(64);
    await devices.discoverOrUpsert({
      id: 'dev-a',
      pubkey: PUBKEY,
      name: 'A',
      platform: 'web',
      appVersion: '1.0',
      lastSeen: Date.now(),
      capabilities: [],
    });
    await devices.discoverOrUpsert({
      id: 'dev-b',
      pubkey: otherPubkey,
      name: 'B',
      platform: 'web',
      appVersion: '1.0',
      lastSeen: Date.now(),
      capabilities: [],
    });

    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });

    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('B')).toBeNull();
  });

  it('ordena devices por lastSeen (mais recente primeiro)', async () => {
    const now = Date.now();
    await devices.discoverOrUpsert({
      id: 'dev-old',
      pubkey: PUBKEY,
      name: 'Old',
      platform: 'web',
      appVersion: '1',
      lastSeen: now - 24 * 60 * 60 * 1000,
      capabilities: [],
    });
    await devices.discoverOrUpsert({
      id: 'dev-new',
      pubkey: PUBKEY,
      name: 'New',
      platform: 'web',
      appVersion: '1',
      lastSeen: now,
      capabilities: [],
    });

    await act(async () => {
      render(<DevicesPanel pubkey={PUBKEY} />);
    });

    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('New');
    expect(items[1].textContent).toContain('Old');
  });
});
