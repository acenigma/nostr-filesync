import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { LocalSigner, NIP46Signer, createSigner } from '../services/nostr/signer';

describe('Signer Abstraction', () => {
  describe('LocalSigner', () => {
    it('getPublicKey retorna a pubkey da chave local', async () => {
      const sec = generateSecretKey();
      const signer = new LocalSigner(sec);
      const pub = await signer.getPublicKey();
      expect(pub).toBe(getPublicKey(sec));
    });

    it('signEvent produz evento assinado verificável', async () => {
      const sec = generateSecretKey();
      const signer = new LocalSigner(sec);
      const event = await signer.signEvent({
        kind: 1,
        content: 'hello',
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
      expect(event.sig).toBeDefined();
      expect(verifyEvent(event)).toBe(true);
    });

    it('getPrivateKey retorna a mesma chave fornecida', () => {
      const sec = generateSecretKey();
      const signer = new LocalSigner(sec);
      expect(signer.getPrivateKey()).toBe(sec);
    });

    it('dois LocalSigners com chaves diferentes produzem eventos diferentes', async () => {
      const sec1 = generateSecretKey();
      const sec2 = generateSecretKey();
      const signer1 = new LocalSigner(sec1);
      const signer2 = new LocalSigner(sec2);

      const event1 = await signer1.signEvent({
        kind: 1,
        content: 'test',
        tags: [],
        created_at: 100,
      });
      const event2 = await signer2.signEvent({
        kind: 1,
        content: 'test',
        tags: [],
        created_at: 100,
      });
      expect(event1.id).not.toBe(event2.id);
    });
  });

  describe('NIP46Signer', () => {
    it('lança erro se usado sem connect()', async () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      await expect(signer.getPublicKey()).rejects.toThrow(/não conectado/);
    });

    it('lança erro em connect() com URL inválida', async () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      await expect(signer.connect('not-a-url')).rejects.toThrow(/Formato não reconhecido/);
      await expect(signer.connect('')).rejects.toThrow(/Formato não reconhecido/);
    });

    it('connect() aceita URL bunker://', async () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      await expect(signer.connect('bunker://npub1abc?relay=wss://relay.example.com')).resolves.toBeUndefined();
    });

    it('connect() aceita URL nostrconnect://', async () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      await expect(signer.connect('nostrconnect://abc123')).resolves.toBeUndefined();
    });

    it('signEvent requer implementação completa do bunker', async () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      await signer.connect('bunker://npub1abc');
      await expect(
        signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 })
      ).rejects.toThrow(/implementação completa do bunker/);
    });

    it('getClientSecret retorna o secret fornecido', () => {
      const sec = generateSecretKey();
      const signer = new NIP46Signer(sec);
      expect(signer.getClientSecret()).toBe(sec);
    });
  });

  describe('createSigner factory', () => {
    it('retorna LocalSigner quando privateKey fornecido', async () => {
      const sec = generateSecretKey();
      const signer = await createSigner(sec, null);
      expect(signer).toBeInstanceOf(LocalSigner);
    });

    it('lança erro quando nem privateKey nem remoteSigner fornecidos', async () => {
      await expect(createSigner(null, null)).rejects.toThrow(/Nenhuma fonte de assinatura/);
    });

    it('retorna Signer wrapper quando apenas remoteSigner fornecido', async () => {
      const pub = 'a'.repeat(64);
      const remoteSigner = { getPublicKey: async () => pub };
      const signer = await createSigner(null, remoteSigner);
      const got = await signer.getPublicKey();
      expect(got).toBe(pub);
    });

    it('signEvent em remote signer lança erro (não implementado)', async () => {
      const remoteSigner = { getPublicKey: async () => 'a'.repeat(64) };
      const signer = await createSigner(null, remoteSigner);
      await expect(
        signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 })
      ).rejects.toThrow(/integração completa do bunker/);
    });
  });
});
