import { useEffect } from 'react';

export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface ShortcutBinding {
  key: string;
  handler: ShortcutHandler;
  description?: string;
  when?: (target: EventTarget | null) => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export function useShortcuts(bindings: ShortcutBinding[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      for (const b of bindings) {
        if (b.key !== e.key) continue;
        if (isEditableTarget(e.target) && b.key !== 'Escape') continue;
        if (b.when && !b.when(e.target)) continue;
        b.handler(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
        }
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, enabled]);
}