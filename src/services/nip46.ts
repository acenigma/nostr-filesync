import { generateSecretKey, nip19 } from 'nostr-tools';
import { parseBunkerInput, BunkerSigner } from 'nostr-tools/nip46';

type BunkerSignerInstance = {
  connect(): Promise<void>;
  close(): Promise<void>;
  getPublicKey(): Promise<string>;
};

let currentSigner: BunkerSignerInstance | null = null;

export function getActiveRemoteSigner(): BunkerSignerInstance | null {
  return currentSigner;
}

export async function connectToBunker(input: string): Promise<{
  pubkey: string;
  npub: string;
  close: () => Promise<void>;
}> {
  const trimmed = input.trim();
  if (trimmed.startsWith('bunker://')) {
    const parsed = await parseBunkerInput(trimmed);
    if (!parsed) throw new Error('URL de bunker inválida');
    const clientSecret = generateSecretKey();
    const signer = BunkerSigner.fromBunker(clientSecret, parsed) as unknown as BunkerSignerInstance;
    await signer.connect();
    currentSigner = signer;
    const pubkey = await signer.getPublicKey();
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
      close: async () => {
        await signer.close();
        currentSigner = null;
      },
    };
  }
  if (trimmed.startsWith('nostrconnect://')) {
    const clientSecret = generateSecretKey();
    const signer = (await BunkerSigner.fromURI(clientSecret, trimmed)) as unknown as BunkerSignerInstance;
    await signer.connect();
    currentSigner = signer;
    const pubkey = await signer.getPublicKey();
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
      close: async () => {
        await signer.close();
        currentSigner = null;
      },
    };
  }
  throw new Error('Formato não reconhecido. Use bunker:// ou nostrconnect://');
}

export function isRemoteSignerActive(): boolean {
  return currentSigner !== null;
}