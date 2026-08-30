import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useAbort } from '../hooks/useAbort';

describe('useAbort StrictMode simulation', () => {
  it('cria controller novo a cada mount', () => {
    const { result, unmount } = renderHook(() => useAbort());
    const sig1 = result.current.signal;
    expect(sig1.aborted).toBe(false);
    unmount();
    expect(sig1.aborted).toBe(true);

    const { result: r2 } = renderHook(() => useAbort());
    expect(r2.current.signal.aborted).toBe(false);
    expect(r2.current.signal).not.toBe(sig1);
  });
});
