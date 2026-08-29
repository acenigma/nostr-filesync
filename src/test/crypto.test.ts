import { describe, it, expect } from 'vitest';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  gzipCompress,
  gzipDecompress,
  nip44SelfUnwrap,
  nip44SelfWrap,
  sha256Hex,
} from '../services/filesync';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('produz hash SHA-256 conhecido para string vazia', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('produz hash determinístico', async () => {
    const input = new TextEncoder().encode('hello');
    const a = await sha256Hex(input);
    const b = await sha256Hex(input);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe('AES-GCM roundtrip', () => {
  it('decrypt recupera plaintext original', async () => {
    const plain = new TextEncoder().encode('conteúdo secreto de teste');
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const decrypted = await aesGcmDecrypt(encrypted, key);
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plain));
  });

  it('ciphertext difere entre chamadas (nonce aleatório)', async () => {
    const plain = new TextEncoder().encode('mesmo input');
    const a = await aesGcmEncrypt(plain);
    const b = await aesGcmEncrypt(plain);
    expect(bytesToHex(a.encrypted)).not.toBe(bytesToHex(b.encrypted));
  });

  it('falha ao descriptografar com chave errada', async () => {
    const plain = new TextEncoder().encode('x');
    const { encrypted } = await aesGcmEncrypt(plain);
    const wrongKey = new Uint8Array(32);
    wrongKey.set([1]);
    await expect(aesGcmDecrypt(encrypted, wrongKey)).rejects.toThrow();
  });
});

describe('gzip roundtrip', () => {
  it('compress + decompress preserva bytes', async () => {
    const input = new TextEncoder().encode('hello '.repeat(1000));
    const { compressed } = await gzipCompress(input);
    const decompressed = await gzipDecompress(compressed);
    expect(bytesToHex(decompressed)).toBe(bytesToHex(input));
  });

  it('compression ratio < 1 para dados repetitivos', async () => {
    const input = new TextEncoder().encode('a'.repeat(10000));
    const { ratio } = await gzipCompress(input);
    expect(ratio).toBeLessThan(0.1);
  });
});

describe('NIP-44 self-wrap roundtrip', () => {
  it('unwrap recupera os bytes originais', () => {
    const sec = generateSecretKey();
    const pub = getPublicKey(sec);
    const original = new Uint8Array(32);
    crypto.getRandomValues(original);
    const wrapped = nip44SelfWrap(original, sec, pub);
    const unwrapped = nip44SelfUnwrap(wrapped, sec, pub);
    expect(bytesToHex(unwrapped)).toBe(bytesToHex(original));
  });

  it('falha com sec diferente', () => {
    const sec1 = generateSecretKey();
    const sec2 = generateSecretKey();
    const pub1 = getPublicKey(sec1);
    const original = bytesFromHex('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
    const wrapped = nip44SelfWrap(original, sec1, pub1);
    expect(() => nip44SelfUnwrap(wrapped, sec2, pub1)).toThrow();
  });
});

describe('integração finalizeEvent', () => {
  it('produz evento válido assinando', () => {
    const sec = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 1,
        content: 'hello world',
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      },
      sec
    );
    expect(event.id).toBeDefined();
    expect(event.sig).toBeDefined();
    expect(event.pubkey).toBe(getPublicKey(sec));
  });
});