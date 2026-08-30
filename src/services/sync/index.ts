/**
 * Sync Engine — stub
 *
 * Implementação prevista na Fase 2 do roadmap nostr-filesync.md:
 * - SyncOperation queue persistente no IDB
 * - Retry com exponential backoff + jitter
 * - Cursor de sincronização (lastProcessedEvent)
 * - Pull/Push
 * - Delta sync via manifest
 * - Conflict resolution (KEEP_BOTH, LAST_WRITE_WINS, MANUAL)
 * - Tombstones e sync de deleções
 * - Repair/rebuild
 */

export const SYNC_ENGINE_VERSION = '0.0.0-stub';
