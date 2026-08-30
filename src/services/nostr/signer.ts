import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools';

/**
 * Assinatura de evento Nostr abstraída.
 *
 * Permite que o sistema use diferentes fontes para assinar eventos:
 * - LocalSigner: chave privada em memória (após unlock)
 * - NIP07Signer: extensão de browser (NIP-07)
 * - NIP46Signer: remote signer via bunker (NIP-46)
 *
 * O restante do sistema não precisa saber qual signer está sendo utilizado.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
}

/**
 * Signer que usa uma chave privada local em memória.
 * Usado após unlock (senha ou frase mnemônica).
 */
export class LocalSigner implements Signer {
  constructor(private readonly privateKey: Uint8Array) {}

  getPublicKey(): Promise<string> {
    return Promise.resolve(getPublicKey(this.privateKey));
  }

  signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return Promise.resolve(finalizeEvent(event, this.privateKey));
  }

  /** Acesso direto à chave privada (uso interno apenas). */
  getPrivateKey(): Uint8Array {
    return this.privateKey;
  }
}

/**
 * Signer que delega assinatura a um bunker remoto via NIP-46.
 * Implementação concreta virá na Fase 6.6 do roadmap.
 */
export class NIP46Signer implements Signer {
  private readonly clientSecret: Uint8Array;
  private remotePubkey: string | null = null;
  private connected = false;

  constructor(clientSecret: Uint8Array) {
    this.clientSecret = clientSecret;
  }

  async connect(bunkerUrl: string): Promise<void> {
    const trimmed = bunkerUrl.trim();
    if (!trimmed.startsWith('bunker://') && !trimmed.startsWith('nostrconnect://')) {
      throw new Error('Formato não reconhecido. Use bunker:// ou nostrconnect://');
    }
    this.connected = true;
  }

  async getPublicKey(): Promise<string> {
    this.ensureConnected();
    if (this.remotePubkey) return this.remotePubkey;
    throw new Error('NIP46Signer.getPublicKey() requer implementação completa do bunker');
  }

  async signEvent(_event: EventTemplate): Promise<VerifiedEvent> {
    this.ensureConnected();
    throw new Error('NIP46Signer.signEvent() requer implementação completa do bunker');
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('NIP46Signer não conectado. Chame connect() primeiro.');
    }
  }

  getClientSecret(): Uint8Array {
    return this.clientSecret;
  }
}

/**
 * Factory: cria um Signer apropriado baseado na fonte de identidade.
 */
export async function createSigner(
  privateKey: Uint8Array | null,
  remoteSigner: { getPublicKey: () => Promise<string> } | null
): Promise<Signer> {
  if (privateKey) {
    return new LocalSigner(privateKey);
  }
  if (remoteSigner) {
    return {
      getPublicKey: remoteSigner.getPublicKey,
      async signEvent(_event: EventTemplate): Promise<VerifiedEvent> {
        throw new Error('Remote signer signEvent() requer integração completa do bunker');
      },
    };
  }
  throw new Error('Nenhuma fonte de assinatura disponível');
}
