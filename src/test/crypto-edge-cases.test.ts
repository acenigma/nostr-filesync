import { describe, it, expect } from 'vitest';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
  concatBytes,
  gzipCompress,
  gzipDecompress,
  sha256Hex,
} from '../services/crypto/index';

describe('hex / base64 utilities', () => {
  it('bytesToHex é inverso de hexToBytes', () => {
    const original = new Uint8Array([0, 1, 15, 16, 255, 128, 64, 32]);
    const hex = bytesToHex(original);
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('hexToBytes aceita hex com prefixo 0x', () => {
    const hex = '0xdeadbeef';
    const bytes = hexToBytes(hex);
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('hexToBytes lança erro em hex de tamanho ímpar', () => {
    expect(() => hexToBytes('abc')).toThrow(/hex inválido/);
  });

  it('bytesToBase64 é inverso de base64ToBytes', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = bytesToBase64(original);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('bytesToBase64 lida com arrays grandes (>16KB)', () => {
    const large = new Uint8Array(50000);
    for (let i = 0; i < large.length; i++) large[i] = i % 256;
    const b64 = bytesToBase64(large);
    const back = base64ToBytes(b64);
    expect(back.length).toBe(large.length);
    expect(Array.from(back.slice(0, 10))).toEqual(Array.from(large.slice(0, 10)));
  });

  it('concatBytes une múltiplos arrays preservando ordem', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const c = new Uint8Array([6, 7, 8, 9]);
    const result = concatBytes([a, b, c]);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('concatBytes com array vazio retorna Uint8Array vazio', () => {
    const result = concatBytes([]);
    expect(result.length).toBe(0);
  });

  it('concatBytes com um único array retorna cópia equivalente', () => {
    const a = new Uint8Array([1, 2, 3]);
    const result = concatBytes([a]);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });
});

describe('sha256Hex', () => {
  it('hash de string vazia é e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', async () => {
    const hash = await sha256Hex(new Uint8Array());
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hash de "abc" é conhecido', async () => {
    const hash = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hash tem exatamente 64 caracteres hex (32 bytes)', async () => {
    const hash = await sha256Hex(new TextEncoder().encode('test'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashs de inputs diferentes são diferentes', async () => {
    const a = await sha256Hex(new TextEncoder().encode('a'));
    const b = await sha256Hex(new TextEncoder().encode('b'));
    expect(a).not.toBe(b);
  });
});

describe('AES-GCM edge cases', () => {
  it('roundtrip com 1 byte', async () => {
    const plain = new Uint8Array([42]);
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const decrypted = await aesGcmDecrypt(encrypted, key);
    expect(Array.from(decrypted)).toEqual([42]);
  });

  it('roundtrip com 1MB', async () => {
    const plain = new Uint8Array(1024 * 1024);
    for (let i = 0; i < plain.length; i++) plain[i] = i % 256;
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const decrypted = await aesGcmDecrypt(encrypted, key);
    expect(decrypted.length).toBe(plain.length);
    expect(decrypted[0]).toBe(0);
    expect(decrypted[255]).toBe(255);
    expect(decrypted[256]).toBe(0);
  });

  it('nonce + ciphertext são concatenados no output', async () => {
    const plain = new TextEncoder().encode('test');
    const { encrypted, nonce } = await aesGcmEncrypt(plain);
    // O output começa com o nonce (12 bytes)
    const extractedNonce = encrypted.subarray(0, 12);
    expect(Array.from(extractedNonce)).toEqual(Array.from(nonce));
    // O resto é o ciphertext
    expect(encrypted.length).toBeGreaterThan(12);
  });

  it('chave de 32 bytes é retornada', async () => {
    const { key } = await aesGcmEncrypt(new Uint8Array([1]));
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('nonce de 12 bytes é retornado', async () => {
    const { nonce } = await aesGcmEncrypt(new Uint8Array([1]));
    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(12);
  });

  it('falha com chave truncada (32 -> 16 bytes)', async () => {
    const plain = new TextEncoder().encode('secret');
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const truncatedKey = key.subarray(0, 16);
    await expect(aesGcmDecrypt(encrypted, truncatedKey)).rejects.toThrow();
  });

  it('falha com chave zerada', async () => {
    const plain = new TextEncoder().encode('secret');
    const { encrypted } = await aesGcmEncrypt(plain);
    const zeroKey = new Uint8Array(32); // all zeros
    await expect(aesGcmDecrypt(encrypted, zeroKey)).rejects.toThrow();
  });

  it('falha se ciphertext for truncado (corrompido)', async () => {
    const plain = new TextEncoder().encode('secret message');
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const truncated = encrypted.subarray(0, encrypted.length - 1);
    await expect(aesGcmDecrypt(truncated, key)).rejects.toThrow();
  });

  it('falha se nonce for alterado (corrompido)', async () => {
    const plain = new TextEncoder().encode('secret');
    const { encrypted, key } = await aesGcmEncrypt(plain);
    const corrupted = new Uint8Array(encrypted);
    corrupted[0] = (corrupted[0] + 1) % 256;
    await expect(aesGcmDecrypt(corrupted, key)).rejects.toThrow();
  });

  it('ciphertexts de mesmo plaintext diferem (nonce aleatório)', async () => {
    const plain = new TextEncoder().encode('same input');
    const a = await aesGcmEncrypt(plain);
    const b = await aesGcmEncrypt(plain);
    const c = await aesGcmEncrypt(plain);
    expect(bytesToHex(a.encrypted)).not.toBe(bytesToHex(b.encrypted));
    expect(bytesToHex(b.encrypted)).not.toBe(bytesToHex(c.encrypted));
    expect(bytesToHex(a.encrypted)).not.toBe(bytesToHex(c.encrypted));
  });
});

describe('gzip edge cases', () => {
  it('roundtrip com dados vazios', async () => {
    const empty = new Uint8Array(0);
    const { compressed, ratio } = await gzipCompress(empty);
    const decompressed = await gzipDecompress(compressed);
    expect(decompressed.length).toBe(0);
    expect(typeof ratio).toBe('number');
  });

  it('roundtrip com dados binários aleatórios', async () => {
    const random = new Uint8Array(1000);
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
    const { compressed } = await gzipCompress(random);
    const decompressed = await gzipDecompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(random));
  });

  it('compressão de dados repetitivos é eficiente', async () => {
    const repetitive = new TextEncoder().encode('a'.repeat(10000));
    const { ratio } = await gzipCompress(repetitive);
    expect(ratio).toBeLessThan(0.01);
  });

  it('compressão de dados aleatórios não reduz significativamente', async () => {
    const random = new Uint8Array(500);
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
    const { ratio } = await gzipCompress(random);
    // ratio próximo de 1 (pode até ser > 1 se dados aleatórios)
    expect(ratio).toBeGreaterThan(0.8);
  });

  it('roundtrip com texto unicode', async () => {
    const text = 'Olá mundo! 🌍 café 漢字 ñ';
    const encoded = new TextEncoder().encode(text);
    const { compressed } = await gzipCompress(encoded);
    const decompressed = await gzipDecompress(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(text);
  });
});
