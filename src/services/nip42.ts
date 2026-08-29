import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';

let privateKeyRef: Uint8Array | null = null;

export function bindAuthContext(sec: Uint8Array | null): void {
  privateKeyRef = sec;
}

export async function handleAuth(evt: EventTemplate): Promise<VerifiedEvent> {
  if (!privateKeyRef) {
    throw new Error('Não autenticado para responder ao challenge do relay');
  }
  return finalizeEvent(evt, privateKeyRef);
}