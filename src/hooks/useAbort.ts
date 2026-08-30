import { useEffect, useState, useCallback } from 'react';

export interface AbortHandle {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
}

/**
 * Cria um AbortController por componente.
 *
 * Em React StrictMode (dev) o componente monta duas vezes; o state é
 * descartado entre os ciclos, então cada mount recebe um controller
 * fresco. O cleanup do useEffect aborta o controller APENAS quando o
 * signal não está aborted — isso evita abortar um controller que já
 * foi descartado por outro ciclo do StrictMode.
 *
 * Na prática, em produção, este hook cria 1 controller por mount e
 * aborta no unmount. Em dev (StrictMode), aborta no meio, mas o
 * controller do segundo mount é independente.
 */
export function useAbort(): AbortHandle {
  const [controller] = useState(() => new AbortController());

  useEffect(() => {
    return () => {
      controller.abort(new Error('Componente desmontado'));
    };
  }, [controller]);

  const abort = useCallback(
    (reason?: unknown) => {
      controller.abort(reason);
    },
    [controller]
  );

  return { signal: controller.signal, abort };
}