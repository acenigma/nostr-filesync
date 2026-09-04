import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as diag from '../services/diagnostics';

vi.mock('../services/repair', () => ({
  runAllRepairs: vi.fn(async () => []),
  checkIntegrity: vi.fn(async () => ({ tool: 'check-integrity', status: 'ok', message: 'OK', durationMs: 5 })),
  rebuildIndex: vi.fn(async () => ({ tool: 'rebuild-index', status: 'ok', message: 'OK', durationMs: 5 })),
  rebuildManifest: vi.fn(async () => ({ tool: 'rebuild-manifest', status: 'ok', message: 'OK', durationMs: 5 })),
  retryFailed: vi.fn(async () => ({ tool: 'retry-failed', status: 'ok', message: 'OK', durationMs: 5 })),
}));

import DiagnosticsPanel from '../components/DiagnosticsPanel';

beforeEach(() => {
  diag.__resetDiagnostics();
});

describe('DiagnosticsPanel', () => {
  it('renders title and tabs', () => {
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    expect(container.textContent).toContain('Diagnóstico');
    expect(container.textContent).toContain('Eventos');
    expect(container.textContent).toContain('Relays');
    expect(container.textContent).toContain('Reparo');
  });

  it('switches to repair tab', () => {
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: 'Reparo' });
    fireEvent.click(buttons[0]);
    expect(container.textContent).toContain('Verificar integridade');
  });

  it('switches to relays tab', () => {
    diag.recordRelaySuccess('wss://relay.test', 100);
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: 'Relays' });
    fireEvent.click(buttons[0]);
    expect(container.textContent).toContain('wss://relay.test');
  });

  it('renders events tab with recorded event', () => {
    diag.recordEvent('upload', 'info', 'test event');
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    expect(container.textContent).toContain('test event');
  });

  it('shows empty state when no events', () => {
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    expect(container.textContent).toContain('Nenhum evento.');
  });

  it('renders close button', () => {
    const onClose = vi.fn();
    const { container } = render(<DiagnosticsPanel onClose={onClose} />);
    const closeBtn = container.querySelector('.close-btn');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows aggregate stats when present', () => {
    diag.recordEvent('system', 'info', 'a');
    diag.recordEvent('system', 'error', 'b');
    const { container } = render(<DiagnosticsPanel onClose={() => {}} />);
    expect(container.textContent).toContain('Eventos');
    expect(container.textContent).toContain('Erros');
  });
});
