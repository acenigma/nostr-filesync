import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../services/blossom', () => ({
  listServers: vi.fn(),
  onServersChange: vi.fn(),
  addCustomServer: vi.fn(),
  removeServer: vi.fn(),
  toggleServerTrusted: vi.fn(),
  runHealthChecks: vi.fn(),
}));

vi.mock('../services/blossom/repair', () => ({
  getTrackedBlobs: vi.fn(),
  repairBlobs: vi.fn(),
}));

vi.mock('../services/blossom/healthScheduler', () => ({
  onHealthSchedulerChange: vi.fn(),
  runHealthNow: vi.fn(),
}));

import * as blossom from '../services/blossom';
import * as repair from '../services/blossom/repair';
import * as health from '../services/blossom/healthScheduler';
import BlossomServersPanel from '../components/BlossomServersPanel';
import type { BlossomServer } from '../services/blossom/types';

const mkServer = (over: Partial<BlossomServer>): BlossomServer => ({
  url: 'https://x',
  name: 'X',
  healthy: true,
  lastCheckAt: null,
  avgLatencyMs: null,
  trusted: true,
  source: 'fallback',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
    cb([]);
    return () => {};
  });
  vi.mocked(health.onHealthSchedulerChange).mockImplementation((cb) => {
    cb({ lastRunAt: null, lastResult: null });
    return () => {};
  });
  vi.mocked(blossom.listServers).mockReturnValue([]);
  vi.mocked(repair.getTrackedBlobs).mockReturnValue([]);
  vi.mocked(blossom.runHealthChecks).mockResolvedValue(undefined as never);
  vi.mocked(blossom.addCustomServer).mockImplementation((url, name) => mkServer({ url, name: name ?? undefined }));
});

describe('BlossomServersPanel', () => {
  it('renders summary stats with zero servers', () => {
    const { container } = render(<BlossomServersPanel />);
    expect(container.textContent).toContain('Saudáveis');
    expect(container.textContent).toContain('Confiáveis');
    expect(container.textContent).toContain('Total');
    expect(container.textContent).toContain('Blobs');
  });

  it('renders server list with health dots', () => {
    vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
      cb([
        mkServer({ url: 'https://a.com', name: 'A', healthy: true, source: 'fallback' }),
        mkServer({ url: 'https://b.com', name: 'B', healthy: false, source: 'custom' }),
      ]);
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');
    expect(container.textContent).toContain('padrão');
    expect(container.textContent).toContain('custom');
    const dots = container.querySelectorAll('.blossom-dot');
    expect(dots.length).toBe(2);
  });

  it('shows last check time from health scheduler', () => {
    vi.mocked(health.onHealthSchedulerChange).mockImplementation((cb) => {
      cb({ lastRunAt: Date.now() - 60_000, lastResult: { healthy: 2, total: 3, errors: [] } });
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    expect(container.textContent).toContain('Última verificação');
    expect(container.textContent).toContain('agora');
  });

  it('shows "nunca" when no health check ran', () => {
    const { container } = render(<BlossomServersPanel />);
    expect(container.textContent).toContain('nunca');
  });

  it('addCustomServer is called when adding valid URL', () => {
    const { container } = render(<BlossomServersPanel />);
    const inputs = container.querySelectorAll('input');
    const urlInput = inputs[0];
    fireEvent.change(urlInput, { target: { value: 'https://my-server.com' } });
    const addBtn = container.querySelector('[data-testid="blossom-add-btn"]') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(blossom.addCustomServer).toHaveBeenCalledWith('https://my-server.com', undefined);
  });

  it('shows error for invalid URL (no protocol)', () => {
    const { container } = render(<BlossomServersPanel />);
    const urlInput = container.querySelector('[data-testid="blossom-url-input"]') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    const addBtn = container.querySelector('[data-testid="blossom-add-btn"]') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(container.textContent).toContain('http://');
  });

  it('shows error for empty URL', () => {
    const { container } = render(<BlossomServersPanel />);
    const addBtn = container.querySelector('[data-testid="blossom-add-btn"]') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('add button is disabled when URL is empty', () => {
    const { container } = render(<BlossomServersPanel />);
    const addBtn = container.querySelector('[data-testid="blossom-add-btn"]') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('shows server error when addCustomServer throws', () => {
    vi.mocked(blossom.addCustomServer).mockImplementation(() => {
      throw new Error('duplicate url');
    });
    const { container } = render(<BlossomServersPanel />);
    const urlInput = container.querySelector('[data-testid="blossom-url-input"]') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'https://x.com' } });
    const addBtn = container.querySelector('[data-testid="blossom-add-btn"]') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(container.textContent).toContain('duplicate url');
  });

  it('runHealthChecks called when clicking check button', () => {
    const { container } = render(<BlossomServersPanel />);
    const checkBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Verificar')
    ) as HTMLButtonElement;
    fireEvent.click(checkBtn);
    expect(blossom.runHealthChecks).toHaveBeenCalled();
  });

  it('repair button is disabled when no tracked blobs', () => {
    const { container } = render(<BlossomServersPanel />);
    const repairBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Reparar')
    ) as HTMLButtonElement;
    expect(repairBtn.disabled).toBe(true);
  });

  it('repairBlobs called when clicking repair button', async () => {
    vi.mocked(repair.getTrackedBlobs).mockReturnValue([
      {
        sha256: 'a'.repeat(64),
        urls: ['https://a.com/x'],
        lastSeenAt: Date.now(),
      },
    ]);
    vi.mocked(repair.repairBlobs).mockResolvedValue({
      checked: 1,
      missing: [],
      repaired: 1,
      failed: 0,
      durationMs: 100,
    });
    const { container } = render(<BlossomServersPanel />);
    const repairBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Reparar')
    ) as HTMLButtonElement;
    fireEvent.click(repairBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(repair.repairBlobs).toHaveBeenCalled();
  });

  it('shows repair result after completion', async () => {
    vi.mocked(repair.getTrackedBlobs).mockReturnValue([
      {
        sha256: 'a'.repeat(64),
        urls: ['https://a.com/x'],
        lastSeenAt: Date.now(),
      },
    ]);
    vi.mocked(repair.repairBlobs).mockResolvedValue({
      checked: 1,
      missing: [],
      repaired: 1,
      failed: 0,
      durationMs: 100,
    });
    const { container } = render(<BlossomServersPanel />);
    const repairBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Reparar')
    ) as HTMLButtonElement;
    fireEvent.click(repairBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toContain('Verificados: 1');
    expect(container.textContent).toContain('Reparados: 1');
  });

  it('shows custom name in input', () => {
    const { container } = render(<BlossomServersPanel />);
    const inputs = container.querySelectorAll('input');
    const nameInput = inputs[1];
    fireEvent.change(nameInput, { target: { value: 'My Server' } });
    expect((nameInput as HTMLInputElement).value).toBe('My Server');
  });

  it('toggles trusted when checkbox clicked', () => {
    vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
      cb([mkServer({ url: 'https://a.com', name: 'A', trusted: true })]);
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(blossom.toggleServerTrusted).toHaveBeenCalledWith('https://a.com', false);
  });

  it('hides remove button for fallback servers', () => {
    vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
      cb([mkServer({ url: 'https://a.com', name: 'A', source: 'fallback' })]);
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    expect(container.textContent).not.toContain('Remover');
  });

  it('shows remove button for custom servers', () => {
    vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
      cb([mkServer({ url: 'https://a.com', name: 'A', source: 'custom' })]);
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    const removeBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remover'
    );
    expect(removeBtn).toBeDefined();
  });

  it('clicking remove calls removeServer', () => {
    vi.mocked(blossom.onServersChange).mockImplementation((cb) => {
      cb([mkServer({ url: 'https://a.com', name: 'A', source: 'custom' })]);
      return () => {};
    });
    const { container } = render(<BlossomServersPanel />);
    const removeBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remover'
    ) as HTMLButtonElement;
    fireEvent.click(removeBtn);
    expect(blossom.removeServer).toHaveBeenCalledWith('https://a.com');
  });
});
