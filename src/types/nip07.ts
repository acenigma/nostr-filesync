import type { EventTemplate, VerifiedEvent } from 'nostr-tools';

declare global {
  interface Window {
    nostr?: NIP07Provider;
  }
}

export interface NIP07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  getRelays?(relays: string[]): Promise<Record<string, { read: boolean; write: boolean }>>;
  encrypt?(pubkey: string, plaintext: string): Promise<string>;
  decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  close?(): void;
  on?(func: string, callback: () => void): void;
  off?(func: string, callback: () => void): void;
  removeHandler?(func: string): void;
}
