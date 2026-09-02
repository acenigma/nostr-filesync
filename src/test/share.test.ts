import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as share from '../services/share';
import { nip44, generateSecretKey, getPublicKey } from 'nostr-tools';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Share Service - Storage Management', () => {
  const mockShare: share.ShareRecord = {
    id: 'shr-abc-123',
    fileId: 'file-1',
    fileName: 'doc.txt',
    folderId: 'fld-1',
    contentHash: 'a'.repeat(64),
    size: 100,
    mimeType: 'text/plain',
    sharedBy: 'a'.repeat(64),
    sharedWith: 'b'.repeat(64),
    permission: 'viewer',
    eventId: 'evt-1',
    createdAt: 1000,
    accepted: false,
    revoked: false,
    isFolder: false,
  };

  function saveShare(s: share.ShareRecord): void {
    const shares = [{
      id: s.id,
      eventId: s.eventId,
      sharedBy: s.sharedBy,
      sharedWith: s.sharedWith,
      fileId: s.fileId,
      fileName: s.fileName,
      folderId: s.folderId,
      contentHash: s.contentHash,
      size: s.size,
      mimeType: s.mimeType,
      permission: s.permission,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      accepted: s.accepted,
      revoked: s.revoked,
    }];
    localStorage.setItem(share.SHARE_RECORD_KEY, JSON.stringify(shares));
  }

  describe('listShares', () => {
    it('retorna array vazio quando não há shares', () => {
      expect(share.listShares()).toHaveLength(0);
    });

    it('retorna todos os shares armazenados', () => {
      saveShare(mockShare);
      const list = share.listShares();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('shr-abc-123');
      expect(list[0].fileName).toBe('doc.txt');
    });
  });

  describe('getShare', () => {
    it('retorna null para ID inexistente', () => {
      expect(share.getShare('nonexistent')).toBeNull();
    });

    it('retorna share pelo ID', () => {
      saveShare(mockShare);
      const found = share.getShare('shr-abc-123');
      expect(found?.fileName).toBe('doc.txt');
      expect(found?.permission).toBe('viewer');
    });
  });

  describe('removeShareRecord', () => {
    it('remove share e retorna true', () => {
      saveShare(mockShare);
      const result = share.removeShareRecord('shr-abc-123');
      expect(result).toBe(true);
      expect(share.listShares()).toHaveLength(0);
    });

    it('retorna false para ID inexistente', () => {
      expect(share.removeShareRecord('nonexistent')).toBe(false);
    });
  });
});

describe('Share Service - Expiration (7.6)', () => {
  it('isShareExpired retorna false quando não há expiresAt', () => {
    const s: share.ShareRecord = {
      id: 's1', fileId: 'f1', fileName: 'f', folderId: null,
      contentHash: 'a', size: 0, mimeType: '', sharedBy: 'a',
      sharedWith: 'b', permission: 'viewer', eventId: 'e1',
      createdAt: 0, accepted: false, revoked: false, isFolder: false,
    };
    expect(share.isShareExpired(s)).toBe(false);
  });

  it('isShareExpired retorna true quando expiresAt passado', () => {
    const s: share.ShareRecord = {
      id: 's1', fileId: 'f1', fileName: 'f', folderId: null,
      contentHash: 'a', size: 0, mimeType: '', sharedBy: 'a',
      sharedWith: 'b', permission: 'viewer', eventId: 'e1',
      createdAt: 0, expiresAt: Date.now() - 1000,
      accepted: false, revoked: false, isFolder: false,
    };
    expect(share.isShareExpired(s)).toBe(true);
  });

  it('isShareExpired retorna false quando expiresAt futuro', () => {
    const s: share.ShareRecord = {
      id: 's1', fileId: 'f1', fileName: 'f', folderId: null,
      contentHash: 'a', size: 0, mimeType: '', sharedBy: 'a',
      sharedWith: 'b', permission: 'viewer', eventId: 'e1',
      createdAt: 0, expiresAt: Date.now() + 60000,
      accepted: false, revoked: false, isFolder: false,
    };
    expect(share.isShareExpired(s)).toBe(false);
  });
});

describe('Share Service - Share Link (7.5)', () => {
  it('parseShareLink retorna null para URL inválida', () => {
    expect(share.parseShareLink('not-a-link')).toBeNull();
    expect(share.parseShareLink('http://example.com')).toBeNull();
    expect(share.parseShareLink('nostrsync://wronghost/event123')).toBeNull();
  });

  it('generateShareLink cria link valido', () => {
    const s: share.ShareRecord = {
      id: 'shr-abc-123', fileId: 'f1', fileName: 'f', folderId: null,
      contentHash: 'a', size: 0, mimeType: '', sharedBy: 'a'.repeat(64),
      sharedWith: 'b'.repeat(64), permission: 'viewer', eventId: 'evt-1',
      createdAt: 0, accepted: false, revoked: false, isFolder: false,
    };
    const shares = [{
      ...s,
      id: s.id, eventId: s.eventId, sharedBy: s.sharedBy, sharedWith: s.sharedWith,
      fileId: s.fileId, fileName: s.fileName, folderId: s.folderId,
      contentHash: s.contentHash, size: s.size, mimeType: s.mimeType,
      permission: s.permission, createdAt: s.createdAt, expiresAt: s.expiresAt,
      accepted: s.accepted, revoked: s.revoked, isFolder: false,
    }];
    localStorage.setItem(share.SHARE_RECORD_KEY, JSON.stringify(shares));

    const link = share.generateShareLink('shr-abc-123');
    expect(link.startsWith('nostrsync://share/evt-1')).toBe(true);
    expect(link.includes('from=' + 'a'.repeat(64))).toBe(true);
    expect(link.includes('id=shr-abc-123')).toBe(true);
  });

  it('parseShareLink extrai dados corretos', () => {
    const link = 'nostrsync://share/evt-999?from=aaaa&b=cccc&id=shr-xyz';
    const parsed = share.parseShareLink(link);
    expect(parsed).not.toBeNull();
    expect(parsed?.eventId).toBe('evt-999');
    expect(parsed?.from).toBe('aaaa');
    expect(parsed?.shareId).toBe('shr-xyz');
  });

  it('parseShareLink retorna null para link incompleto', () => {
    expect(share.parseShareLink('nostrsync://share/evt-999')).toBeNull();
  });
});

describe('Share Service - Permission', () => {
  it('Permission type inclui viewer, editor e owner', () => {
    const perms: share.Permission[] = ['viewer', 'editor', 'owner'];
    expect(perms).toHaveLength(3);
  });
});

describe('NIP-44 Key Delegation (7.2)', () => {
  it('conversation key é determinística para mesmo par de chaves', () => {
    const sec = generateSecretKey();
    const pub = getPublicKey(sec);
    const ck1 = nip44.getConversationKey(sec, pub);
    const ck2 = nip44.getConversationKey(sec, pub);
    expect(ck1).toStrictEqual(ck2);
  });

  it('conversation key difere para chaves diferentes', () => {
    const sec1 = generateSecretKey();
    const sec2 = generateSecretKey();
    const pub = getPublicKey(sec1);
    const ck1 = nip44.getConversationKey(sec1, pub);
    const ck2 = nip44.getConversationKey(sec2, pub);
    expect(ck1).not.toBe(ck2);
  });

  it('encripta e decripta texto com conversation key', () => {
    const sec = generateSecretKey();
    const pub = getPublicKey(sec);
    const ck = nip44.getConversationKey(sec, pub);
    const plaintext = JSON.stringify({ fileId: 'test', permission: 'editor' });
    const encrypted = nip44.encrypt(plaintext, ck);
    const decrypted = nip44.decrypt(encrypted, ck);
    expect(decrypted).toBe(plaintext);
  });

  it('encripta e decripta payload de share', () => {
    const sec = generateSecretKey();
    const recipientPub = getPublicKey(generateSecretKey());
    const ck = nip44.getConversationKey(sec, recipientPub);

    const payload = {
      fileId: 'file-123',
      fileName: 'shared_doc.txt',
      folderId: null,
      contentHash: 'a'.repeat(64),
      size: 2048,
      mimeType: 'text/plain',
      permission: 'viewer' as share.Permission,
    };

    const encrypted = nip44.encrypt(JSON.stringify(payload), ck);
    const decrypted = JSON.parse(nip44.decrypt(encrypted, ck));
    expect(decrypted.fileId).toBe('file-123');
    expect(decrypted.fileName).toBe('shared_doc.txt');
    expect(decrypted.permission).toBe('viewer');
  });
});
