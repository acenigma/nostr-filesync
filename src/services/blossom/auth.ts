import { type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import * as nip42 from '../nip42';

export interface BlossomAuthChallenge {
  challenge: string;
  relayUrl: string;
}

export interface BlossomAuthResult {
  event: VerifiedEvent;
  /** Base64-encoded event for `Authorization: Nostr <base64>` header */
  header: string;
}

function toBase64(ev: VerifiedEvent): string {
  if (typeof btoa === 'function') {
    return btoa(JSON.stringify(ev));
  }
  return Buffer.from(JSON.stringify(ev)).toString('base64');
}

export async function authWithBlossom(
  serverUrl: string,
  method: string,
  path: string
): Promise<BlossomAuthResult | null> {
  let challenge = '';
  try {
    const probeUrl = `${serverUrl.replace(/\/+$/, '')}${path}`;
    const probe = await fetch(probeUrl, {
      method,
      headers: { Accept: 'application/json' },
    });
    const wwwAuth = probe.headers.get('www-authenticate') || probe.headers.get('WWW-Authenticate');
    if (!wwwAuth) return null;
    const match = wwwAuth.match(/Nostr\s+([^,]+)/i);
    if (!match) return null;
    const params = parseAuthParams(match[1]);
    challenge = params.challenge || '';
    if (!challenge) return null;
  } catch {
    return null;
  }

  if (!nip42.isReady()) {
    return null;
  }

  const eventTemplate: EventTemplate = {
    kind: 24242,
    content: '',
    tags: [
      ['t', 'upload'],
      ['challenge', challenge],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
  const signed = await nip42.handleAuth(eventTemplate);
  return { event: signed, header: `Nostr ${toBase64(signed)}` };
}

function parseAuthParams(raw: string): { challenge?: string; relay?: string } {
  const out: { challenge?: string; relay?: string } = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] === 'challenge') out.challenge = m[2];
    else if (m[1] === 'relay') out.relay = m[2];
  }
  return out;
}

export function makeAuthHeader(event: VerifiedEvent): string {
  return `Nostr ${toBase64(event)}`;
}
