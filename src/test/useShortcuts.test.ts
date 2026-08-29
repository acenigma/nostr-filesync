import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShortcuts } from '../hooks/useShortcuts';

describe('useShortcuts', () => {
  it('executa handler quando tecla correta é pressionada', () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: 'n', handler }]));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignora teclas modificadoras', () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: 'n', handler }]));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('não dispara quando foco está em input (exceto Escape)', () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: 'n', handler }]));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('Escape funciona mesmo em input', () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: 'Escape', handler }]));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
    document.body.removeChild(input);
  });

  it('respeita when() customizado', () => {
    const handler = vi.fn();
    const when = vi.fn(() => false);
    renderHook(() => useShortcuts([{ key: 'n', handler, when }]));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    expect(handler).not.toHaveBeenCalled();
    expect(when).toHaveBeenCalled();
  });

  it('enabled=false desativa', () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: 'n', handler }], false));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('remove listener no unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useShortcuts([{ key: 'n', handler }]));
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    expect(handler).not.toHaveBeenCalled();
  });
});