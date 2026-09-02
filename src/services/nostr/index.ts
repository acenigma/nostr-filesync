// Re-export do módulo nostr principal (mantido em services/nostr.ts para compatibilidade)
export * from '../nostr';

// Re-export do signer
export { LocalSigner, NIP46Signer, NIP07Signer, createSigner, type Signer } from './signer';

// Re-export de tipos de passkey
export type { PasskeyInfo, AuthenticationResult } from '../passkey';
