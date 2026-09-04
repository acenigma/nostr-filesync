# Nostr FileSync

PWA (Progressive Web App) que sincroniza **arquivos** e **tarefas** entre dispositivos via relays Nostr, com identidade local criptografada, versionamento, deduplicação por conteúdo, compartilhamento seguro, backup/recuperação, busca, notificações e suporte offline completo.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7** + **OxLint**
- **nostr-tools** (NIP-19, NIP-42, NIP-44, NIP-46, NIP-49, NIP-65)
- **@scure/bip39** (mnemônico BIP-39)
- **IndexedDB** (DB_VERSION=9) com 10 stores versionadas e migrações numeradas
- **vite-plugin-pwa** + Workbox (Service Worker, runtime caching, background sync)
- **Web Crypto** (AES-256-GCM, SHA-256, XChaCha20-Poly1305 via NIP-49, PBKDF2)
- **Web Workers** (SHA-256 off-main-thread)
- **WebAuthn / PRF** (passkey unlock com derivação de chave)
- **Vitest 4** + jsdom + @testing-library/react + fake-indexeddb (testes)
- 893 testes em 56 arquivos

## Funcionalidades

### Identidade e autenticação

- Identidade Nostr local com **mnemônico BIP-39 de 12 palavras** + senha
- Importação via `nsec1...`, `ncryptsec1...`, hex 64 chars ou mnemônico
- Criptografia local da chave privada via **NIP-49** (XChaCha20-Poly1305, KDF Argon2)
- Backup recuperável do mnemônico (cifrado com a mesma senha)
- Migração automática de identidades em texto claro para criptografadas
- Bloqueio automático (`lock()`) configurável: nunca / 5min / 15min / 30min / 1h
- **Passkey (WebAuthn + PRF)**: registrar, autenticar, listar, renomear, remover; `unlockWithPasskey()` deriva chave via HKDF
- **NIP-42 auth**: auto-resposta a challenges de relays autenticados
- **NIP-46 remote signer**: conectar a bunker via `bunker://` ou `nostrconnect://`
- **Signers** (abstração `Signer` interface): `LocalSigner` e `NIP07Signer` + factory `createSigner`

### Arquivos (Nostr FileSync)

- Upload de arquivos grandes (chunked em 64 KB, kind 1063/1064)
- **Criptografia AES-256-GCM** com chave aleatória por arquivo, envelopeada via **NIP-44**
- **Compressão gzip** automática quando reduz ≥ 2%
- **Deduplicação por hash** (sha256 do plaintext + nome + tamanho) — blobs compartilhados entre arquivos
- **Modelo de pastas hierárquicas** (`parentId`, `version`) em vez de path
- Drag-drop de arquivos e pastas (via `webkitGetAsEntry` API)
- Download com verificação de integridade por hash
- Deleção via **tombstones** sincronizados (kind 5 com `k=1063`)
- **Thumbnails lazy** com `IntersectionObserver` + cancelamento via AbortController
- **Preview fullscreen** com navegação prev/next (teclado: Esc/←/→)
- Visualização em árvore de pastas ou lista plana
- Busca por nome ou pasta
- Indicador global de progresso

### Versionamento e histórico

- `createVersion()`, `getVersion()`, `listVersions()`, `getLatestVersion()`
- `restoreVersion()` (cria nova versão, não destrói histórico)
- `deleteVersions()`, `getFileVersions()`
- Version metadata com `parentVersionId`, `contentHash`, `createdBy`

### Lixeira e retenção

- **Trash** store dedicada (`store_trash`) para entidades excluídas
- `deleteFolder(id, { permanent: false })` move para lixeira
- `restoreVersion` + restore from trash
- **Retention policies** configuráveis: 30 dias / 90 dias / 1 ano / indefinido
- Garbage collector com **mark → grace period → verify references → delete**

### Sincronização (Sync Engine)

- **Sync queue persistente** no IndexedDB com tipos: `CREATE / UPDATE / MOVE / RENAME / DELETE / RESTORE / UPLOAD / DOWNLOAD`
- **Retry** com **exponential backoff** (jitter, max 5 tentativas, falha permanente)
- **Cursor de sincronização** por `${pubkey}:${relayUrl}` — evita reprocessar histórico
- **Device registry** com `pubkey`, `name`, `platform`, `capabilities`, `lastSeen`
- **Device discovery** via relays (separado de file sync)
- **Manifest** versionado com entries
- **Delta sync** (manifest local vs remoto, diff mínimo)
- **Pull/Push** com queue local, validação, mark synced
- **Conflitos** detectados por `version`; estratégias: `KEEP_BOTH`, `LAST_WRITE_WINS`, `MANUAL`
- **Tombstone sync** — propagação de exclusões entre dispositivos
- **Repair** — `rebuildIndex`, `rebuildManifest`, `retryFailed`, `checkIntegrity`
- **Background sync** com retry persistente (5s → 5min), pausa offline, re-sync ao reconectar

### Integridade e armazenamento (Content-addressed)

- `sha256(content)` como identificador do blob
- `createBlobRef`, `verifyBlob`, `findFilesByBlobHash`
- `computeDedupStats()` — total blobs, refs, taxa de dedup, bytes economizados
- **IntegrityScanner** (`services/diagnostics/integrity.ts`): hash, tamanho, chunks, metadata, referências
- **Garbage Collector** (`services/diagnostics/gc.ts`): mark → grace period → verify refs → delete

### Backup e recuperação (bundles .nostrbundle)

- Formato próprio `.nostrbundle` com header (versão, salt, KDF, parameters) + payload criptografado
- Inclui: identidade, configuração, relays, folders, files, metadata, versions, sync state, refs de conteúdo
- **Criptografia**: PBKDF2 (100k iterações) + AES-256-GCM
- **Manifest de integridade** com checksums por tipo de entidade (folders, files, fileVersions, devices, syncQueue, syncCursors, blobs, relays, config, identity)
- `computeManifest()` + `verifyManifest()` para validação
- `BUNDLE_VERSION=2`, `CRYPTO_VERSION=1`, `SCHEMA_VERSION=1`
- `exportBundle()`, `importBundle()`, `validateBundle()`, `parseBundleHeader()`, `formatBundleSize()`

### Compartilhamento seguro (NIP-44)

- `createShare(fileId, recipientPubkey, permission, expiresInMs?)`
- `discoverIncomingShares()` descobre shares via relays
- `acceptShare(shareId, targetFolderId)`, `acceptShareFromLink(link)`
- `revokeShare(shareId)` via kind:5 (delete event)
- `shareFolder()`, `acceptFolderShare()` — pastas inteiras
- Permissões: `viewer` / `editor` / `owner`
- `generateShareLink()` / `parseShareLink()` → `nostrsync://share/{eventId}?from={npub}&id={shareId}`
- Expiração configurável (1h / 1d / 7d / 30d / never)

### Busca e organização

- `searchMetadata({ query, mimeType, size, dateRange, tags })` — busca por nome, pasta, MIME, tamanho, data, tags
- **Índice invertido** (`term → files`) com `buildInvertedIndex`, `searchWithIndex`, `refreshSearchIndex`, `clearSearchIndex`
- Tokenizer para busca full-text
- **Favoritos**: `favoriteFile`, `favoriteFolder`, `unfavorite`, `isFavorited`, `listFavorites()`
- 📌 Preferências locais por dispositivo

### Notificações

- **Notification Center** in-app com abas Não lidas / Lidas / Arquivadas
- `recordEvent(category, level, message, meta?)` — buffer circular de 500 eventos
- `notifyFileEvent({ type, fileId, fileName })` — eventos `new-file | new-version | deleted | restored`
- `notifySyncEvent({ type, message })` — eventos `sync-error | sync-recovered | conflict | queued | completed`
- **Browser Notifications** API com permission flow + tag/icon/onclick → deep link
- Persistência em IndexedDB (store `notifications`, v9)
- Marcar como lida, arquivar, excluir (individual e em massa)

### Armazenamento (Storage management)

- `getStorageEstimate()` via `navigator.storage.estimate()`
- `getStorageAlert()` com níveis: 80% (aviso) / 90% (crítico) / 95% (restrição)
- `setStorageState`, `getStorageState`, `clearStorageStates`
- Ações explícitas (sem auto-delete): limpar cache, limpar thumbnails, remover offline
- Sempre com confirmação para ações destrutivas

### Diagnóstico e observabilidade

- **Diagnostics service** com categorias: relay / upload / download / sync / system
- Níveis: debug / info / warn / error
- **Relay health** com score (successRate × 0.7 + latencyFactor × 0.3), EMA de latência (α=0.3)
- `recordRelaySuccess(url, latencyMs)`, `recordRelayFailure(url, error, latencyMs?)`
- **Repair tools**: `checkIntegrity()`, `rebuildIndex()`, `rebuildManifest()`, `retryFailed()`, `runAllRepairs()`
- **Export diagnostics** → `diagnostics-YYYY-MM-DD.json` com version, app, stats, events, relays
- **DiagnosticsPanel** in-app: 3 tabs (Eventos / Relays / Reparo) com 4 stat cards
- Configurações → "🩺 Diagnóstico & Reparo"

### Mobile

- **Battery Status API**: `useBattery()` — nível, carregando, lowPower (< 20%)
- **Network Information API**: `useNetworkInfo()` — effectiveType, RTT, saveData, downlink
- **Auto-defer** de uploads pesados em: offline / save-data / 2g / slow-2g / 3g com RTT > 500ms / bateria baixa
- **Lazy image loading** com `IntersectionObserver` (rootMargin 200px)
- **MobileResourceIndicator** banner

### PWA e Service Worker

- Service Worker com **cache strategies** separadas:
  - `NetworkFirst` (3s timeout) para navegação
  - `NetworkFirst` (5s timeout) para `/api/*`
  - `StaleWhileRevalidate` para imagens
  - `CacheFirst` para fontes Google
  - `NetworkOnly` + `BackgroundSyncPlugin` para `/sync/*`
- Manifest instalável (ícones 192/512, maskable)
- **Prompt de instalação** com modal + instruções específicas para iOS (Safari)
- **Indicador online/offline** + auto-sync ao reconectar
- **Background sync** com retry persistente, pausa offline
- **Deep links** `?view=sync|todo` + `nostrsync://share/...` (parsing)
- Workbox com cleanup automático de caches antigos
- PWA shortcuts: `/?view=sync` e `/?view=todo`

### Performance

- **Code splitting** via `React.lazy()` + `Suspense`:
  - Main chunk: 533KB → 432KB (gzip 175KB → 144KB)
  - Lazy chunks: FileSync (17KB), Settings (63KB), TodoList (5KB), NotificationCenter (4KB), DiagnosticsPanel
- **Web Worker** para SHA-256 (`workers/hashWorker.ts`) com fallback para `crypto.subtle`
- **Upload scheduler** (`UploadScheduler`): combina bandwidth config + priority queue
- **Bandwidth profiles**: unlimited (6 paralelos) / high (4) / medium (2) / low (1) — persistente em localStorage
- **Adaptive chunk size**: baseado no tamanho do arquivo
- **Priority queue** com 5 níveis: metadata < small-file < user-requested < background < thumbnail
- **Content Defined Chunking (CDC)**: rolling hash + 12-bit mask, dedup por boundary, `estimateDedupRatio`
- **Web Workers** para hash (off-main-thread) com fallback automático

### UX

- **i18n**: pt-BR, en, es (seletor em Settings, persistência em localStorage, fallback para `navigator.language`)
- **Tema dark/light** com toggle manual, persistência, fallback para `prefers-color-scheme`
- Sem flash no boot (tema aplicado inline em `main.tsx`)
- **Atalhos de teclado**: `n` (foca todo), `/` (foca busca), `Esc` (fecha modais)
- Cancelamento de uploads/downloads via AbortController
- Settings: exportar nsec/ncryptsec/mnemonic via QR, alterar senha, atualizar relays, bunker NIP-46, export bundle, gerenciar passkeys, bandwidth, diagnóstico
- QR Scanner para importar chaves via câmera
- Mensagens de erro claras e contextuais

## Estrutura

```
src/
  main.tsx                          # bootstrap + tema inline
  App.tsx                           # router + theme + atalhos + lazy components
  sw.ts                             # custom Service Worker (Workbox)

  components/
    Unlock.tsx                      # criar / desbloquear / importar (com passkey)
    Settings.tsx                    # exportar chave, senha, relays, passkey, bundle, bw, diag
    FileSync.tsx                    # UI de arquivos (lazy)
    TodoList.tsx                    # UI de tarefas (lazy)
    Thumbnail.tsx                   # preview lazy image/video
    PreviewModal.tsx                # preview fullscreen com navegação
    QRScanner.tsx                   # câmera para QR codes
    MnemonicSetup.tsx               # backup de 12 palavras
    InstallPrompt.tsx               # modal de instalação PWA (com iOS)
    OnlineIndicator.tsx             # banner offline/online
    MobileResourceIndicator.tsx     # banner de upload deferido
    NotificationCenter.tsx          # center de notificações (lazy)
    DiagnosticsPanel.tsx            # painel de diagnóstico (lazy)
    DevicesPanel.tsx                # UI de devices descobertos

  hooks/
    useAbort.ts                     # AbortController por componente
    useTheme.ts                     # tema dark/light
    useShortcuts.ts                 # atalhos de teclado
    useT.ts                         # i18n
    useFileSync.ts                  # estado + sync de arquivos
    useTodoSync.ts                  # estado + sync de tarefas
    usePWAInstall.ts                # beforeinstallprompt + iOS detection
    useOnlineStatus.ts              # online/offline + justCameOnline
    useDeepLink.ts                  # parse nostrsync:// e ?view=
    useBattery.ts                   # Battery Status API
    useNetworkInfo.ts               # Network Information API
    useMobileResourceState.ts       # combina battery + network
    useLazyImage.ts                 # IntersectionObserver
    useBrowserNotifications.ts      # Notification API + permission

  services/
    db/index.ts                     # IndexedDB v9 + 10 stores + migrations
    filesync.ts                     # re-export './files'
    files/                          # upload/download criptografado, chunks, NIP-44
    file-entity/                    # FileRecord, FolderRecord, helpers
    folders/                        # CRUD de pastas + tree
    blobs/                          # content-addressed storage + dedup
    blob-dedup                      # dedup helpers
    blobs-storage                   # blob persistence
    crypto/                         # AES, SHA-256, gzip, NIP-44
    nostr/                          # identidade, relays, signers
      index.ts                      # entry point
      signer.ts                     # LocalSigner, NIP07Signer
    nostr.ts                        # re-export
    passkey/                        # WebAuthn + PRF + auto-lock
    nip42.ts                        # auto-resposta a challenges
    nip46.ts                        # remote signer via bunker
    sync/                           # Sync Engine completo
      states.ts                     # LOCAL_ONLY, PENDING_UPLOAD, etc
      backoff.ts                    # exponential backoff + jitter
      queue.ts                      # sync queue persistente
      retry.ts                      # retry logic
      cursor.ts                     # sync cursor
      manifest.ts                   # manifest de arquivos
      delta.ts                      # delta sync (diff)
      pull.ts                       # pull sync
      push.ts                       # push sync
      conflicts.ts                  # detecção e resolução
      tombstone-sync.ts             # propagação de tombstones
      repair.ts                     # sync repair
    tombstones/                     # Tombstone entity
    trash/                          # lixeira
    versions/                       # versionamento de arquivos
    share/                          # NIP-44 share + folder share
    notifications/                  # in-app notifications
    search/                         # busca + favoritos + índice invertido
    storage/                        # quota + alerts
    diagnostics/                    # logs + relay health
      index.ts                      # event buffer
      integrity.ts                  # IntegrityScanner
      gc.ts                         # Garbage Collector
    repair/                         # repair tools
    bundle/                         # .nostrbundle export/import
    retention/                      # retention policies
    devices/                        # device registry + discovery
    migration/                      # path-to-folders migration
      index.ts
      path-to-folders.ts
    tombstones.ts                   # re-export
    uploadState.ts                  # estado de uploads pendentes
    backgroundSync.ts               # background sync com backoff
    bandwidth.ts                    # bandwidth profiles
    priorityQueue.ts                # priority queue
    uploadScheduler.ts              # scheduler combinado
    cdc.ts                          # Content Defined Chunking
    swMessaging.ts                  # SW ↔ app messaging
    hashWorkerClient.ts             # Web Worker wrapper para SHA-256
    filesync.ts                     # re-export
    file-entity.ts                  # re-export
    folders.ts                      # re-export
    blobs.ts                        # re-export
    migration.ts                    # re-export
    tombstones.ts                   # re-export

  workers/
    hashWorker.ts                   # Web Worker para SHA-256

  i18n/
    index.ts                        # detectLocale, getDictionary, interpolate
    pt-BR.ts                        # português
    en.ts                           # inglês
    es.ts                           # espanhol

  test/                             # 893 testes em 56 arquivos
    setup.ts                        # polyfills jsdom
    [50+ test files]                # coverage de todos os services e components
```

## Comandos

```bash
npm run dev            # servidor de desenvolvimento
npm run build          # build de produção + PWA
npm run preview        # preview do build
npm run lint           # OxLint
npm run typecheck      # tsc --noEmit
npm test               # Vitest (single run)
npm run test:watch     # Vitest em watch mode
npm run test:coverage  # Vitest com cobertura (v8)
```

## IndexedDB Schema (v9)

Database `nostr-filesync` com 10 stores:

| Store | Key | Indexes | Migration |
|-------|-----|---------|-----------|
| `files` | `fileId` | — | v1 |
| `uploads` | `fileId` | — | v1 |
| `folders` | `id` | — | v2 |
| `tombstones` | `entityId` | — | v2 |
| `sync_queue` | `id` | status, nextAttemptAt, entityId | v3 |
| `sync_cursors` | `id` | pubkey | v4 |
| `devices` | `id` | pubkey, lastSeen | v5 |
| `blobs` | `contentHash` | refCount, lastAccessedAt | v6 |
| `file_versions` | `id` | fileId, contentHash, createdAt | v7 |
| `trash` | `id` | entityType, entityId, deletedAt | v8 |
| `notifications` | `id` | status, category, createdAt | v9 |

## Segurança

- Chave privada nunca sai da memória sem criptografia NIP-49
- Conteúdo dos arquivos cifrado com AES-256-GCM antes de publicar nos relays
- Chave AES envelopeada via NIP-44 (criptografia entre público e privado)
- Mnemônico cifrado com a senha local, recuperável apenas pelo usuário
- Passkey usa WebAuthn + PRF → HKDF → chave local (nunca sai do device)
- Tokens sensíveis (`ncryptsec`, mnemônico cifrado) ficam em `localStorage`/IndexedDB do device — assumimos que o device é confiável
- Sem servidor central: tudo passa por relays públicos do protocolo Nostr
- Bundles `.nostrbundle` cifrados com PBKDF2 (100k) + AES-256-GCM
- Shares usam NIP-44 (ECDH + ChaCha20 + HMAC-SHA256)

## Limitações conhecidas

- Sem suporte a múltiplas contas simultâneas
- Uploads em background: fechar a aba aborta o chunk atual (estado salvo para retomada)
- Relays podem reter ou censurar eventos (mitigação: replicar em N relays)
- NIP-46: configuração/setup funciona, mas eventos ainda são assinados pela chave local
- **Push remoto** (Fase 11.4): não implementado. SW sozinho não fornece push remoto; necessário NIP específico para Nostr ou Web Push server. Notificações funcionam via `Notification` API local disparada por polling de eventos
- **Blossom / storage descentralizado** (Fase 14): ainda não implementado; arquivos binários vão via eventos Nostr (kind 1063/1064)
- **CDC** ainda não está integrado ao pipeline de upload (apenas exposto como service)
- **Versioning UI**: service completo, mas UI de listagem/restore de versões ainda não integrada ao FileSync
- **Repair tools** funcionam mas dependem de IDB estar consistente
