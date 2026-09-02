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
