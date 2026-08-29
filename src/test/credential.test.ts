import { describe, it, expect, beforeEach } from 'vitest';
import * as nostr from '../services/nostr';
import { generateSecretKey, nip19 } from 'nostr-tools';

describe('parseCredential', () => {
  it('decodifica nsec1 válido', async () => {
    const sec = generateSecretKey();
    const nsec = nip19.nsecEncode(sec);
    const result = await nostr.parseCredential(nsec);
    expect(result.source).toBe('nsec');
    expect(result.sec).toBeInstanceOf(Uint8Array);
    expect(result.sec.length).toBe(32);
    expect(Array.from(result.sec)).toEqual(Array.from(sec));
  });

  it('decodifica hex de 64 caracteres', async () => {
    const sec = generateSecretKey();
    const hex = Array.from(sec, (b) => b.toString(16).padStart(2, '0')).join('');
    const result = await nostr.parseCredential(hex);
    expect(result.source).toBe('hex');
    expect(Array.from(result.sec)).toEqual(Array.from(sec));
  });

  it('decodifica mnemônico válido de 12 palavras', async () => {
    const mnemonic = nostr.generateFreshMnemonic();
    const result = await nostr.parseCredential(mnemonic);
    expect(result.source).toBe('mnemonic');
    expect(result.sec.length).toBe(32);
  });

  it('rejeita mnemônico inválido', async () => {
    await expect(
      nostr.parseCredential('palavra1 palavra2 palavra3 palavra4 palavra5 palavra6 palavra7 palavra8 palavra9 palavra10 word12 invalida')
    ).rejects.toThrow(/Frase de recuperação inválida/);
  });

  it('rejeita hex de tamanho errado', async () => {
    await expect(nostr.parseCredential('aabbcc')).rejects.toThrow();
  });

  it('rejeita entrada vazia', async () => {
    await expect(nostr.parseCredential('')).rejects.toThrow(/Cole uma chave válida/);
  });

  it('rejeita formato desconhecido', async () => {
    await expect(
      nostr.parseCredential('isso-nao-e-nada-reconhecivel')
    ).rejects.toThrow(/Formato não reconhecido/);
  });
});

describe('isValidMnemonic', () => {
  it('aceita mnemônico de 12 palavras válido', () => {
    expect(nostr.isValidMnemonic(nostr.generateFreshMnemonic())).toBe(true);
  });

  it('rejeita quantidade errada de palavras', () => {
    expect(nostr.isValidMnemonic('foo bar baz')).toBe(false);
  });

  it('rejeita palavra inexistente', () => {
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon xxxx';
    expect(nostr.isValidMnemonic(phrase)).toBe(false);
  });
});

describe('hasStoredCredential', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('retorna false sem credencial', () => {
    expect(nostr.hasStoredCredential()).toBe(false);
  });

  it('retorna true com ncryptsec1', () => {
    localStorage.setItem('nostr_todo_privkey', 'ncryptsec1fake');
    expect(nostr.hasStoredCredential()).toBe(true);
  });

  it('retorna true com nsec1', () => {
    localStorage.setItem('nostr_todo_privkey', 'nsec1fake');
    expect(nostr.hasStoredCredential()).toBe(true);
  });

  it('retorna false com lixo', () => {
    localStorage.setItem('nostr_todo_privkey', 'lixo');
    expect(nostr.hasStoredCredential()).toBe(false);
  });
});

describe('parseTodoPayload', () => {
  it('aceita payload válido', () => {
    expect(nostr.parseTodoPayload('{"text":"hello","done":false}')).toEqual({
      text: 'hello',
      done: false,
    });
  });

  it('rejeita JSON malformado', () => {
    expect(nostr.parseTodoPayload('não é json')).toBeNull();
  });

  it('rejeita done não-boolean', () => {
    expect(nostr.parseTodoPayload('{"text":"x","done":"yes"}')).toBeNull();
  });

  it('rejeita text não-string', () => {
    expect(nostr.parseTodoPayload('{"text":123,"done":false}')).toBeNull();
  });

  it('rejeita falta de campos', () => {
    expect(nostr.parseTodoPayload('{"text":"x"}')).toBeNull();
    expect(nostr.parseTodoPayload('{"done":false}')).toBeNull();
  });
});

describe('parseRelayTags (NIP-65)', () => {
  it('inclui relay sem marker (read+write)', () => {
    expect(nostr.parseRelayTags([['r', 'wss://a']])).toEqual(['wss://a']);
  });

  it('inclui relay com marker read', () => {
    expect(nostr.parseRelayTags([['r', 'wss://a', 'read']])).toEqual(['wss://a']);
  });

  it('exclui relay com marker write', () => {
    expect(nostr.parseRelayTags([['r', 'wss://a', 'write']])).toEqual([]);
  });

  it('ignora tags não-r', () => {
    expect(nostr.parseRelayTags([['e', 'x'], ['r', 'wss://a']])).toEqual(['wss://a']);
  });

  it('ignora r sem url', () => {
    expect(nostr.parseRelayTags([['r']])).toEqual([]);
  });

  it('mistura vários relays respeitando marker', () => {
    const tags = [
      ['r', 'wss://rw'],
      ['r', 'wss://r', 'read'],
      ['r', 'wss://w', 'write'],
      ['r', 'wss://other'],
    ];
    expect(nostr.parseRelayTags(tags)).toEqual(['wss://rw', 'wss://r', 'wss://other']);
  });
});