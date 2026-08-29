import { useEffect, useState, useCallback } from 'react';

export interface AbortHandle {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
}

export function useAbort(): AbortHandle {
  const [controller] = useState(() => new AbortController());

  useEffect(() => {
    return () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('Componente desmontado'));
      }
    };
  }, [controller]);

  const abort = useCallback(
    (reason?: unknown) => controller.abort(reason),
    [controller]
  );

  return { signal: controller.signal, abort };
}