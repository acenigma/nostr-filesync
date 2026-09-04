# Nostr FileSync

PWA (Progressive Web App) que sincroniza **arquivos** e **tarefas** entre dispositivos via relays Nostr, com identidade local criptografada e suporte offline.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7** + **OxLint**
- **nostr-tools** (NIP-19, NIP-42, NIP-44, NIP-46, NIP-49, NIP-65)
- **@scure/bip39** (mnemônico BIP-39)
- **IndexedDB** (nativo, via wrapper próprio) para metadados persistentes
- **vite-plugin-pwa** (Service Worker + manifest)
- **Web Crypto** (AES-256-GCM, SHA-256, XChaCha20-Poly1305 via NIP-49)
- **Vitest 4** + jsdom + @testing-library/react + fake-indexeddb (testes)

## Funcionalidades

### Identidade e autenticação

- Criação de identidade Nostr local com **mnemônico BIP-39 de 12 palavras** + senha
- Importação via `nsec1...`, `ncryptsec1...`, hex 64 chars ou mnemônico
- Criptografia local da chave privada via **NIP-49** (XChaCha20-Poly1305, KDF Argon2)
- Backup recuperável do mnemônico real (cifrado com a mesma senha)
- Migração automática de identidades salvas em texto claro (nsec) para criptografadas
- Bloqueio automático (`lock()`); logout zera a chave em memória
- Confirmação obrigatória antes de sobrescrever identidade existente
- **NIP-42 auth**: relays autenticados (responde automaticamente a challenges com eventos assinados)
- **NIP-46 remote signer**: conectar a um bunker externo via `bunker://` ou `nostrconnect://` URL (Settings → Remote signer)

### Arquivos (Nostr FileSync)

- Upload de arquivos grandes (chunked em 64 KB, kind 1063/1064)
- **Criptografia AES-256-GCM** com chave aleatória por arquivo, envelopeada via **NIP-44 self-wrap**
- **Compressão gzip** automática quando reduz ≥ 2%
- **Deduplicação por hash** (sha256 do plaintext + nome + tamanho)
- Organização em pastas (tag `path`)
- **Drag-drop de pastas** (via `webkitGetAsEntry` API; estrutura preservada como `path`)
- Upload de arquivos ou diretórios inteiros via botão "choose files" (com `webkitdirectory` quando suportado). Quando um diretório é selecionado, a estrutura interna é preservada e os arquivos são organizados automaticamente em subpastas correspondentes
- Download com verificação de integridade por hash
- Deleção remota (kind 5 com `k=1063`)
- **Thumbnails lazy** para `image/*` e `video/*` (via `IntersectionObserver`, cancelamento via AbortController)
- **Preview fullscreen** com navegação prev/next (teclado: Esc/←/→)
- Visualização em árvore de pastas ou lista plana
- Busca por nome ou pasta
- Drag-and-drop de arquivos
- Indicador global de progresso no topo (3px, accent color)

### Tarefas (Nostr Todo)

- Lista de tarefas (kind 30000, parameterizable replaceable)
- Checkbox de conclusão
- Deleção (kind 5 com referência ao event id)
- Sincronização em tempo real via `subscribeMany`
- Validação de payload (`text: string`, `done: boolean`)

### Sincronização e relays

- Lista de relays do usuário via **NIP-65** (kind 10002), filtrada por marker `write` (mantém read+write e read-only)
- Cache de relay list com TTL de 10 minutos
- Fallback para 5 relays públicos quando o usuário não publicou NIP-65
- Pool único reutilizado entre views (`SimplePool` do `nostr-tools`)
- Retry com backoff exponencial para publicação
- Status de conexão em tempo real (`connectedRelays` populado por `pingRelays`)
- Subscription robusta: cleanup fecha a subscription mesmo se ela ainda estiver inicializando

### Persistência local

- **IndexedDB** (`nostr-filesync` database, version 1) com stores `files` e `uploads`
- Migração silenciosa de `localStorage` → IDB na primeira execução
- Fallback de leitura por uma release (defesa em profundidade)
- Estado de uploads pendentes preservado entre sessões (retomada automática)
- Pruning automático de uploads > 7 dias

### UX

- **i18n**: pt-BR, en, es (seletor em Settings → Aparência, persistência em localStorage, fallback para `navigator.language`)
- **Tema dark/light** com toggle manual (☀/☾), persistência em `localStorage`, fallback para `prefers-color-scheme`
- Sem flash no boot (tema aplicado inline em `main.tsx`)
- **Atalhos de teclado**: `n` foca input de nova tarefa (view todo), `/` foca busca (view sync), `Esc` fecha Settings
- Cancelamento de uploads/downloads via `AbortController` ao desmontar componentes
- Settings: exportar nsec/ncryptsec/mnemonic via QR, alterar senha, atualizar relays, conectar bunker NIP-46
- QR Scanner para importar chaves via câmera
- Mensagens de erro claras e contextuais

### PWA

- Service Worker com cache de fontes Google, imagens, páginas e APIs
- Manifest instalável (ícones 192/512, maskable)
- **Prompt de instalação** com instruções específicas para iOS (Safari)
- **Indicador online/offline** + auto-sync ao reconectar
- **Background sync** com retry exponencial (5s → 5min), pausa offline, persistência de estado
- `workbox` com cleanup automático de caches antigos

### Notificações

- **Notification Center** in-app com abas Não lidas / Lidas / Arquivadas
- Eventos: novo arquivo, nova versão, conflito, erro de sync, sync recuperada
- **Browser Notifications API** com pedido de permissão e `tag`/`icon`/`onclick`
- Persistência em IndexedDB (store `notifications`, migration v9)
- Marcar como lida, arquivar, excluir (individual e em massa)

### Mobile

- **Detecção de bateria** (Battery Status API) e **network info** (effective type, RTT, save-data)
- **Auto-defer de uploads** pesados em bateria baixa / conexões lentas (2g, save-data, 3g com RTT > 500ms)
- **Lazy image loading** com IntersectionObserver (rootMargin 200px)

## Estrutura

```
src/
  main.tsx                    # bootstrap + tema inline (sem flash)
  App.tsx                     # router view + theme + atalhos + indicador global

  hooks/
    useAbort.ts               # AbortController por componente
    useTheme.ts               # tema dark/light
    useShortcuts.ts           # atalhos de teclado com guard de foco
    useT.ts                   # i18n (locale, dicionário, t())
    useFileSync.ts            # estado + sync de arquivos (upload/download/subscriptions)
    useTodoSync.ts            # estado + sync de tarefas

  services/
    db.ts                     # wrapper IndexedDB nativo (zero deps)
    nostr.ts                  # identidade, relays (NIP-65), todos (kind 30000), pub/sub
    filesync.ts               # upload/download criptografado, chunks, NIP-44
    uploadState.ts            # estado de uploads pendentes (IDB)
    nip42.ts                  # auto-resposta a challenges de relays autenticados
    nip46.ts                  # remote signer via bunker

  components/
    Unlock.tsx                # criar / desbloquear / importar
    Settings.tsx              # exportar chave, alterar senha, relays, idioma, bunker
    MnemonicSetup.tsx         # backup de 12 palavras
    QRScanner.tsx             # câmera para QR codes
    FileSync.tsx              # UI de arquivos (delega a useFileSync)
    TodoList.tsx              # UI de tarefas (delega a useTodoSync)
    Thumbnail.tsx             # preview lazy de image/video
    PreviewModal.tsx          # preview fullscreen com navegação prev/next

  i18n/
    index.ts                  # detectLocale, getDictionary, interpolate
    pt-BR.ts                  # dicionário português (chaves + valores)
    en.ts                     # dicionário inglês
    es.ts                     # dicionário espanhol

  test/
    setup.ts                  # polyfills jsdom (fake-indexeddb, localStorage, matchMedia)
    credential.test.ts        # parse nsec/hex/mnemonic, NIP-65, validações
    crypto.test.ts            # roundtrip AES, gzip, NIP-44, SHA-256
    components.test.tsx       # smoke tests de Thumbnail e Unlock
    useShortcuts.test.ts      # comportamento do hook de atalhos
    db.test.ts                # IndexedDB: db.ts + uploadState + migrateFromLegacy
    useFileSync.test.ts       # integração: hook com mocks de filesync/uploadState
    useTodoSync.test.ts       # integração: hook com mocks de nostr (apply events via subscribe)

vitest.config.ts              # config do Vitest
vite.config.ts                # config do Vite + PWA
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

## Testes

**69 testes** em 7 arquivos. Cobertura foca em services críticos (parsing, crypto, NIP-65, NIP-42, NIP-44, IDB) e integração de hooks (useFileSync, useTodoSync) com mocks de `nostr-tools` e IndexedDB:

- **credential.test.ts** (25): parse de nsec, hex, mnemônico (válido/inválido), validação de mnemônico, hasStoredCredential, parseTodoPayload, filtro NIP-65 (parseRelayTags)
- **crypto.test.ts** (10): SHA-256, AES-GCM roundtrip + nonce aleatório + falha com chave errada, gzip roundtrip + ratio, NIP-44 self-wrap roundtrip, finalizeEvent
- **components.test.tsx** (3): smoke do Thumbnail (ícone para PDF, image lazy) e Unlock (estado inicial)
- **useShortcuts.test.ts** (7): tecla simples, modificadores ignorados, foco em input bloqueia (Escape não), guard `when()`, enabled=false, cleanup no unmount
- **db.test.ts** (12): put/getAll/get/del/upsert/clear de IndexedDB; uploadState save/update/listPending/markComplete/migrateFromLegacy/pruneOld
- **useFileSync.test.ts** (5): integração com mocks — carga inicial, onDelete, onClearPending, handleFiles success/error
- **useTodoSync.test.ts** (7): integração com mocks — fetch inicial, addTodo, toggleTodo, deleteTodo, applyEvent via subscribe (kind 5 + kind 30000 válido e inválido)

Para rodar localmente: `npm test` (single run) ou `npm run test:watch`.

## Segurança

- Chave privada nunca sai da memória sem criptografia NIP-49
- Conteúdo dos arquivos cifrado com AES-256-GCM antes de publicar nos relays
- Chave AES envelopeada via NIP-44 self-wrap (ECDHP entre si mesmo)
- Mnemônico cifrado com a senha local, recuperável apenas pelo usuário
- Tokens sensíveis (`ncryptsec`, mnemônico cifrado) ficam em `localStorage`/IndexedDB do device — assumimos que o device é confiável
- Sem servidor central: tudo passa por relays públicos do protocolo Nostr

## Limitações conhecidas

- Sem suporte a múltiplas contas simultâneas
- Uploads em background: fechar a aba durante um upload grande aborta o chunk atual (estado fica salvo para retomada)
- Relays podem reter ou censurar eventos (mitigação: replicar em N relays)
- NIP-46 não está totalmente integrado ao fluxo de assinatura de eventos do app (por ora é configuração/setup; eventos ainda são assinados pela chave local)
- **Push remoto** (Fase 11.4): ainda não implementado. Service Worker sozinho não fornece push remoto; é necessário NIP-?? específico para relays Nostr ou servidor Web Push dedicado. Por ora, notificações funcionam via `Notification` API local disparada por polling de eventos.