# Nostr FileSync

PWA (Progressive Web App) que sincroniza **arquivos** e **tarefas** entre dispositivos via relays Nostr, com identidade local criptografada e suporte offline.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7** + **OxLint**
- **nostr-tools** (NIP-19, NIP-44, NIP-49, NIP-65)
- **@scure/bip39** (mnemônico BIP-39)
- **IndexedDB** (nativo) para metadados persistentes
- **vite-plugin-pwa** (Service Worker + manifest)
- **Web Crypto** (AES-256-GCM, SHA-256, PBKDF2)

## Funcionalidades

### Identidade e autenticação

- Criação de identidade Nostr local com **mnemônico BIP-39 de 12 palavras** + senha
- Importação via `nsec1...`, `ncryptsec1...`, hex 64 chars ou mnemônico
- Criptografia local da chave privada via **NIP-49** (XChaCha20-Poly1305, KDF Argon2)
- Backup recuperável do mnemônico real (cifrado com a mesma senha)
- Migração automática de identidades salvas em texto claro (nsec) para criptografadas
- Bloqueio automático (`lock()`); logout zera a chave em memória
- Confirmação obrigatória antes de sobrescrever identidade existente

### Arquivos (Nostr FileSync)

- Upload de arquivos grandes (chunked em 64 KB, kind 1063/1064)
- **Criptografia AES-256-GCM** com chave aleatória por arquivo, envelopeada via **NIP-44 self-wrap**
- **Compressão gzip** automática quando reduz ≥ 2%
- **Deduplicação por hash** (sha256 do plaintext + nome + tamanho)
- Organização em pastas (tag `path`)
- Download com verificação de integridade por hash
- Deleção remota (kind 5 com `k=1063`)
- **Thumbnails lazy** para `image/*` e `video/*` (via `IntersectionObserver`)
- Visualização em árvore de pastas ou lista plana
- Busca por nome ou pasta
- Drag-and-drop de arquivos

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

- **Tema dark/light** com toggle manual (☀/☾), persistência em `localStorage`, fallback para `prefers-color-scheme`
- Sem flash no boot (tema aplicado inline em `main.tsx`)
- Cancelamento de uploads/downloads via `AbortController` ao desmontar componentes
- Settings: exportar nsec/ncryptsec/mnemonic via QR, alterar senha, atualizar relays
- QR Scanner para importar chaves via câmera
- Mensagens de erro claras e contextuais

### PWA

- Service Worker com cache de fontes Google
- Manifest instalável (ícones 192/512, maskable)
- Funciona offline (após primeiro carregamento)
- `workbox` com cleanup automático de caches antigos

## Estrutura

```
src/
  main.tsx                  # bootstrap + tema inline
  App.tsx                   # router view + theme + top-nav
  hooks/
    useAbort.ts             # AbortController por componente
    useTheme.ts             # tema dark/light
  services/
    db.ts                   # wrapper IndexedDB nativo
    nostr.ts          # identidade, relays, NIP-65, todos
    filesync.ts             # upload/download criptografado, chunks
    uploadState.ts          # estado de uploads pendentes (IDB)
  components/
    Unlock.tsx              # criar / desbloquear / importar
    Settings.tsx            # exportar chave, alterar senha, relays
    MnemonicSetup.tsx       # backup de 12 palavras
    QRScanner.tsx           # câmera para QR codes
    FileSync.tsx            # lista de arquivos, upload, download
    TodoList.tsx            # lista de tarefas
    Thumbnail.tsx           # preview lazy de image/video
```

## Comandos

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # build de produção + PWA
npm run preview    # preview do build
npm run lint       # OxLint
npm run typecheck  # tsc --noEmit
```

## Segurança

- Chave privada nunca sai da memória sem criptografia NIP-49
- Conteúdo dos arquivos cifrado com AES-256-GCM antes de publicar nos relays
- Chave AES envelopeada via NIP-44 self-wrap (ECDHP entre si mesmo)
- Mnemônico cifrado com a senha local, recuperável apenas pelo usuário
- Tokens sensíveis (`ncryptsec`, mnemônico cifrado) ficam em `localStorage`/IndexedDB do device — assumimos que o device é confiável
- Sem servidor central: tudo passa por relays públicos do protocolo Nostr

## Limitações conhecidas

- Sem NIP-42 auth (relays podem ler metadados de quem conecta)
- Sem NIP-46 remote signer
- Uploads em background: fechar a aba durante um upload grande aborta o chunk atual (estado fica salvo para retomada)
- Relays podem reter ou censurar eventos (mitigação: replicar em N relays)