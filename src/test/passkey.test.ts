import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as passkey from '../services/passkey';
import { NIP07Signer, LocalSigner, NIP46Signer, createSigner } from '../services/nostr/signer';
import { generateSecretKey } from 'nostr-tools';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Passkey Service', () => {
  describe('isPasskeySupported', () => {
    it('retorna false quando window.PublicKeyCredential não existe', () => {
      const original = (globalThis as any).window;
      try {
        (globalThis as any).window = undefined;
        expect(passkey.isPasskeySupported()).toBe(false);
      } finally {
        (globalThis as any).window = original;
      }
    });

    it('retorna false quando credentials.create não é uma função', () => {
      const originalCreds = (window as any).credentials;
      try {
        (window as any).credentials = undefined;
        expect(passkey.isPasskeySupported()).toBe(false);
      } finally {
        (window as any).credentials = originalCreds;
      }
    });
  });

  describe('AUTO_LOCK_DURATIONS', () => {
    it('possui 5 durações: never, 5min, 15min, 30min, 1hour', () => {
      expect(passkey.AUTO_LOCK_DURATIONS).toHaveLength(5);
      const keys = passkey.AUTO_LOCK_DURATIONS.map((d) => d.key);
      expect(keys).toEqual(['never', '5min', '15min', '30min', '1hour']);
    });

    it('Never tem ms null', () => {
      const never = passkey.AUTO_LOCK_DURATIONS[0];
      expect(never.ms).toBeNull();
    });

    it('durações não-Never são positivas', () => {
      const durations = passkey.AUTO_LOCK_DURATIONS.slice(1);
      for (const d of durations) {
        expect(d.ms).toBeGreaterThan(0);
      }
    });

    it('5min = 5 * 60 * 1000', () => {
      const fiveMin = passkey.AUTO_LOCK_DURATIONS.find((d) => d.key === '5min');
      expect(fiveMin?.ms).toBe(5 * 60 * 1000);
    });

    it('1hour = 60 * 60 * 1000', () => {
      const oneHour = passkey.AUTO_LOCK_DURATIONS.find((d) => d.key === '1hour');
      expect(oneHour?.ms).toBe(60 * 60 * 1000);
    });
  });

  describe('getAutoLockDuration / setAutoLockDuration', () => {
    it('retorna "never" por padrão', () => {
      const dur = passkey.getAutoLockDuration();
      expect(dur.key).toBe('never');
      expect(dur.ms).toBeNull();
    });

    it('retorna a duração configurada após setAutoLockDuration', () => {
      passkey.setAutoLockDuration('15min');
      const dur = passkey.getAutoLockDuration();
      expect(dur.key).toBe('15min');
      expect(dur.ms).toBe(15 * 60 * 1000);
    });

    it('lança erro para duração inválida', () => {
      expect(() => passkey.setAutoLockDuration('invalid')).toThrow(/inválida/);
    });

    it('persiste na localStorage', () => {
      passkey.setAutoLockDuration('30min');
      expect(localStorage.getItem(passkey.AUTO_LOCK_STORAGE_KEY)).toBe('30min');
    });
  });

  describe('deriveKeyFromPRF', () => {
    it('deriva uma chave de 32 bytes do output do PRF', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key = await passkey.deriveKeyFromPRF(prfOutput);
      expect(key).toHaveLength(32);
    });

    it('sempre retorna a mesma chave para o mesmo PRF + contexto', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key1 = await passkey.deriveKeyFromPRF(prfOutput);
      const key2 = await passkey.deriveKeyFromPRF(prfOutput);
      expect(Array.from(key1)).toEqual(Array.from(key2));
    });

    it('retorna chaves diferentes para PRFs diferentes', async () => {
      const prf1 = crypto.getRandomValues(new Uint8Array(32));
      const prf2 = crypto.getRandomValues(new Uint8Array(32));
      const key1 = await passkey.deriveKeyFromPRF(prf1);
      const key2 = await passkey.deriveKeyFromPRF(prf2);
      expect(Array.from(key1)).not.toEqual(Array.from(key2));
    });

    it('respeita outputLength customizado', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key = await passkey.deriveKeyFromPRF(prfOutput, 'context', 16);
      expect(key).toHaveLength(16);
    });
  });

  describe('Passkey storage management', () => {
    const mockPasskey: passkey.PasskeyInfo = {
      id: 'cred-abc-123',
      credentialId: 'cred-abc',
      name: 'YubiKey #1',
      createdAt: 1000,
      lastUsed: 2000,
      prfSalt: 'salt-abc',
    };

    const mockPasskey2: passkey.PasskeyInfo = {
      id: 'cred-def-456',
      credentialId: 'cred-def',
      name: 'iPhone',
      createdAt: 3000,
      lastUsed: 4000,
      prfSalt: 'salt-def',
    };

    function savePasskeys(ps: passkey.PasskeyInfo[]): void {
      localStorage.setItem('nostr_filesync_passkeys', JSON.stringify(ps));
    }

    it('listPasskeys retorna array vazio quando não há passkeys', () => {
      expect(passkey.listPasskeys()).toHaveLength(0);
    });

    it('listPasskeys retorna passkeys salvas, ordenadas por lastUsed decrescente', () => {
      savePasskeys([mockPasskey, mockPasskey2]);
      const list = passkey.listPasskeys();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('cred-def-456');
      expect(list[1].id).toBe('cred-abc-123');
    });

    it('getPasskey encontra passkey pelo ID', () => {
      savePasskeys([mockPasskey]);
      const found = passkey.getPasskey('cred-abc-123');
      expect(found?.name).toBe('YubiKey #1');
    });

    it('removePasskey remove e retorna true para ID existente', () => {
      savePasskeys([mockPasskey, mockPasskey2]);
      const result = passkey.removePasskey('cred-abc-123');
      expect(result).toBe(true);
      expect(passkey.listPasskeys()).toHaveLength(1);
      expect(passkey.getPasskey('cred-abc-123')).toBeNull();
    });

    it('removePasskey retorna false para ID inexistente', () => {
      savePasskeys([mockPasskey]);
      expect(passkey.removePasskey('nonexistent')).toBe(false);
      expect(passkey.listPasskeys()).toHaveLength(1);
    });

    it('renamePasskey atualiza o nome da passkey', () => {
      savePasskeys([mockPasskey]);
      const renamed = passkey.renamePasskey('cred-abc-123', 'YubiKey Pro');
      expect(renamed.name).toBe('YubiKey Pro');
      const stored = passkey.getPasskey('cred-abc-123');
      expect(stored?.name).toBe('YubiKey Pro');
    });

    it('renamePasskey faz trim no nome', () => {
      savePasskeys([mockPasskey]);
      const renamed = passkey.renamePasskey('cred-abc-123', '  New Name  ');
      expect(renamed.name).toBe('New Name');
    });

    it('renamePasskey lança erro para nome vazio', () => {
      savePasskeys([mockPasskey]);
      expect(() => passkey.renamePasskey('cred-abc-123', '')).toThrow(/não pode ser vazio/);
    });

    it('renamePasskey lança erro para ID inexistente', () => {
      expect(() => passkey.renamePasskey('nonexistent', 'New Name')).toThrow(/não encontrada/);
    });
  });
});

describe('NIP07Signer', () => {
  it('isAvailable retorna false quando window.nostr não existe', () => {
    expect(NIP07Signer.isAvailable()).toBe(false);
  });

  it('isAvailable retorna true quando window.nostr existe', () => {
    (window as any).nostr = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async () => ({ id: 'x', sig: 'y', pubKey: 'z' } as any),
    };
    expect(NIP07Signer.isAvailable()).toBe(true);
    delete (window as any).nostr;
  });

  it('getPublicKey lança erro quando não disponível', async () => {
    const signer = new NIP07Signer();
    await expect(signer.getPublicKey()).rejects.toThrow(/NIP-07 não detectado/);
  });

  it('signEvent lança erro quando não disponível', async () => {
    const signer = new NIP07Signer();
    await expect(
      signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 })
    ).rejects.toThrow(/NIP-07 não detectado/);
  });

  it('delega para window.nostr quando disponível', async () => {
    const mockPub = 'a'.repeat(64);
    (window as any).nostr = {
      getPublicKey: vi.fn().mockResolvedValue(mockPub),
      signEvent: vi.fn().mockResolvedValue({ id: 'evt', sig: 'sig', pubKey: mockPub } as any),
    };

    const signer = new NIP07Signer();
    const pub = await signer.getPublicKey();
    expect(pub).toBe(mockPub);
    expect((window as any).nostr.getPublicKey).toHaveBeenCalled();

    const event = await signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 });
    expect(event.id).toBe('evt');
    expect((window as any).nostr.signEvent).toHaveBeenCalled();

    delete (window as any).nostr;
  });
});

describe('createSigner factory', () => {
  it('retorna NIP07Signer quando preferNIP07=true e window.nostr disponível', async () => {
    (window as any).nostr = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async () => ({ id: 'x', sig: 'y', pubKey: 'z' } as any),
    };
    const signer = await createSigner(null, null, { preferNIP07: true });
    expect(signer).toBeInstanceOf(NIP07Signer);
    delete (window as any).nostr;
  });

  it('retorna NIP07Signer quando não há privateKey e window.nostr disponível', async () => {
    (window as any).nostr = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async () => ({ id: 'x', sig: 'y', pubKey: 'z' } as any),
    };
    const signer = await createSigner(null, null);
    expect(signer).toBeInstanceOf(NIP07Signer);
    delete (window as any).nostr;
  });

  it('preferLocal quando preferNIP07=true mas window.nostr não disponível', async () => {
    const sec = generateSecretKey();
    const signer = await createSigner(sec, null, { preferNIP07: true });
    expect(signer).toBeInstanceOf(LocalSigner);
  });
});

describe('NIP46Signer with createSigner factory', () => {
  it('createSigner retorna NIP46Signer-like quando remoteSigner fornecido', async () => {
    const signer = await createSigner(null, {
      getPublicKey: async () => 'a'.repeat(64),
    });
    const pub = await signer.getPublicKey();
    expect(pub).toBe('a'.repeat(64));
    await expect(
      signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 })
    ).rejects.toThrow(/integração completa/);
  });

  it('NIP46Signer.connect aceita bunker:// e nostrconnect://', async () => {
    const sec = generateSecretKey();
    const signer = new NIP46Signer(sec);
    await expect(signer.connect('bunker://npub1abc?relay=wss://relay.example.com')).resolves.toBeUndefined();
    await expect(signer.connect('nostrconnect://abc123')).resolves.toBeUndefined();
    await expect(signer.connect('not-a-url')).rejects.toThrow(/Formato não reconhecido/);
  });

  it('NIP46Signer.getClientSecret retorna a chave fornecida', () => {
    const sec = generateSecretKey();
    const signer = new NIP46Signer(sec);
    expect(signer.getClientSecret()).toBe(sec);
  });
});
