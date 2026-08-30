# Roadmap detalhado — Nostr FileSync

> Documento de planejamento para discussão em outra sessão/agente. Cada fase tem objetivo, escopo técnico, estrutura de dados, UX, riscos e esforço estimado.

---

## Estado atual (resumo)

App PWA (React 19 + Vite 8 + TS 7) com 69 testes passando. Funcionalidades entregues:
- Identidade Nostr (nsec/ncryptsec/BIP-39) com NIP-49 + migração plain → encrypted
- NIP-42 (auth), NIP-46 (bunker)
- Upload AES-256-GCM + NIP-44 + gzip + dedup + chunks
- Drag-drop de pastas, thumbnails lazy, preview fullscreen
- Tarefas kind 30000/5
- IndexedDB com migração localStorage
- Cancelamento AbortController
- i18n (pt-BR/en/es), tema dark/light, atalhos

---

## Fase A — 🔑 Passkey (WebAuthn) para desbloqueio local

**Objetivo.** Oferecer desbloqueio biométrico (Touch ID / Face ID / Windows Hello) como **2º fator opcional**, não substituto da senha/frase BIP-39. A chave privada Nostr continua cifrada com NIP-49; o passkey protege/desbloqueia a senha NIP-49.

### A.1 Por que Passkey aqui

- **Reduz fricção**: usuário toca/biometria em vez de digitar senha de 6+ caracteres toda vez
- **Resistente a phishing**: WebAuthn é bound ao origin (https://app...)
- **UX moderna**: expectativa de apps modernos suportarem

### A.2 Limites importantes

| Risco | Mitigação |
|-------|-----------|
| Passkey fica preso ao device/perfil | Sincroniza via iCloud Keychain / Google Password Manager (limitado). Manter frase BIP-39 como fallback **obrigatório** |
| Sem PRF extension (Firefox antigo) | Fallback para senha digitada |
| Sem biometria (PC compartilhado) | Usuário escolhe "manter senha"; passkey fica configurado mas opcional |
| Browser limpa storage (logout) | Passkey é resiliente a isso (roaming); mas `localStorage` não é |

### A.3 Padrão técnico

**WebAuthn + PRF (Pseudo-Random Function extension)**:
- `navigator.credentials.create({ publicKey: { ..., extensions: { prf: { eval: { first: new Uint8Array(32) } } } } })` na criação
- `navigator.credentials.get({ ..., extensions: { prf: { eval: { first: new Uint8Array(32) } } } })` no uso → retorna 32 bytes derivados deterministicamente
- Esses 32 bytes viram a **senha NIP-49** automaticamente
- Identidade (credential ID) fica em IndexedDB local

### A.4 Estrutura de dados

```ts
// src/services/passkey.ts
interface PasskeyRecord {
  credentialId: string;   // base64url
  publicKey: string;      // base64url (para verificação se necessário)
  prfSalt: Uint8Array;    // 32 bytes (sempre mesmo valor → PRF determinístico)
  createdAt: number;
  lastUsedAt: number;
  // Nome amigável para o usuário (ex: "MacBook Touch ID", "iPhone 15")
  deviceName: string;
}
```

IndexedDB separado (`nostr_filesync_passkeys`) para isolamento:
- DB v2: adicionar store `passkeys` (keyPath: `credentialId`)
- Migração automática de v1 → v2 preservando dados existentes

### A.5 Fluxos

**Setup (Settings → Security)**:
1. Botão "Adicionar passkey"
2. Verifica se há identidade salva → sim, pede para usuário tocar/biometria
3. `create()` com challenge do servidor (server não existe; usar `crypto.getRandomValues` + persistir challenge + counter)
4. Salva credentialId + prfSalt no IDB
5. Marca identidade como "passkey-enabled"

**Unlock**:
1. Se há passkey configurado → tela de unlock mostra "Unlock with biometric" como botão principal
2. Click → `get()` com PRF
3. Se PRF retorna 32 bytes → usa esses bytes como senha NIP-49 → `unlockWithPassword(password)`
4. Se `get()` falhar (passkey removida) → cai para tela de senha digitada

**Remoção**:
- Botão "Remove passkey" em Settings → confirmação → deleta do IDB
- Senha digitada continua funcionando

### A.6 UI — mockup

```
┌─────────────────────────────────┐
│ Security                        │
│                                 │
│ Passkey (biometric)             │
│ ┌───────────────────────────┐   │
│ │ ✓ MacBook Touch ID        │   │
│ │   Last used: 2 min ago    │   │
│ │   [Remove]                │   │
│ └───────────────────────────┘   │
│ [Add another passkey]           │
│                                 │
│ ℹ The passkey unlocks your     │
│ encrypted key. Your recovery    │
│ phrase is still required for    │
│ new devices.                    │
└─────────────────────────────────┘
```

### A.7 Verificação

- Browser suporta WebAuthn: `if (!window.PublicKeyCredential) return;`
- PRF suportado: `getClientCapabilities()` ou tentar e cair back
- HTTPS em produção (localhost OK para dev)
- `navigator.credentials.userAgentActivation` para UX sem cliques extras

### A.8 Testes

- **Unitários**: mock `navigator.credentials`, testar fluxo de setup + unlock + fallback
- **Integration**: usar `@simplewebauthn/browser` mock para simular cerimônia
- **Manual**: testar com Touch ID real, Windows Hello, verificar sync entre devices

### A.9 Esforço estimado

~3-5 dias de dev. Risco principal: testing cross-browser. iOS Safari tem peculiaridades com PRF.

---

## Fase B — 📱 PWA instalação e UX mobile

### B.1 Objetivos

- Detectar se está instalado como PWA vs browser
- Ajustar UI (sem nav de browser, splash screen)
- Manifest icons + shortcuts já existem — verificar deep links

### B.2 Implementação

- Hook `usePWAInstall()`: detecta `display-mode: standalone` via media query
- Mostra/oculta elementos baseado em modo (botão "install" se disponível, dismiss)
- Evento `beforeinstallprompt` para capturar prompt
- iOS: instrução manual via overlay (Safari não dispara prompt nativo)

### B.3 Verificação

- Lighthouse PWA score
- Testar em Chrome Android, iOS Safari, Edge

### B.4 Esforço: ~1-2 dias

---

## Fase C — 🔄 Sync multi-device via NIP-65 relay discovery

### C.1 Estado atual

- Cada device guarda ncryptsec localmente, criptografado com senha local
- Não há mecanismo de descobrir "outras instâncias" do mesmo npub
- Relay list (NIP-65) já é sincronizada via relays

### C.2 Oportunidades

- Quando user A publica ncryptsec ou metadata para si mesmo via relay, user B (mesmo npub) pode detectar
- Adicionar **kind 30078** (NIP-78) application-specific data com metadata da instância: device name, OS, last seen, encrypted contact info
- Pull kind 30078 do próprio pubkey ao desbloquear → listar outros devices conhecidos

### C.3 Implementação

- Novo service `deviceSync.ts`
- Publica kind 30078 com metadata (NIP-44 encrypted self-to-self):
  - `deviceName`, `platform`, `lastSeenAt`, `appVersion`
- Subscription para detectar mudanças
- UI: Settings → "Other devices" list

### C.4 Esforço: ~3 dias

- Risco: depende de relays preservarem kind 30078; relays públicos podem filtrar

---

## Fase D — 🗂️ Pastas remotas como favoritos

### D.1 UX

- Click longo em pasta → "Pin to top"
- Sidebar ou top filter: lista de pastas pinned
- Compartilhar pasta via URL `?path=photos/2024` (deep link já funciona via `view` query)

### D.2 Implementação

- IndexedDB store `pinnedFolders` (keyPath: `path`)
- UI no TreeView: ícone 📌 ao lado de pinned
- Filter: `useState<Set<string>>(pinnedPaths)`

### D.3 Esforço: ~1-2 dias

---

## Fase E — 🔍 Busca full-text em arquivos

### E.1 Caso de uso

- User tem notes, configs, .md files
- Buscar por substring dentro do conteúdo (não só nome)

### E.2 Limitações

- Indexar conteúdo de arquivos < 1 MB (texto puro detectado por MIME)
- Não suporta: PDFs, docx, imagens com OCR (escopo futuro)
- Index cresce → compressão LZ-string antes de armazenar

### E.3 Implementação

- Service `searchIndex.ts`:
  - Hook no `useFileSync`: após upload bem-sucedido, se MIME começar com `text/`, indexa
  - Index: `Map<fileId, { content: string, keywords: string[] }>`
  - Storage: IndexedDB store `searchIndex` (keyPath: `fileId`)
- Search: tokeniza query, faz AND match nos keywords indexados
- Ranking: simples (match count + recência)

### E.4 Search syntax (opcional)

- `"exact phrase"`, `path:photos/ ext:.md`, exclusion com `-`
- v1 só substring literal

### E.5 Esforço: ~3 dias

- Risco: indexing para 1000 arquivos grandes pode ser lento (background worker?)

---

## Fase F — 📊 Quota UI

### F.1 Objetivo

Mostrar uso de IndexedDB + localStorage + cache PWA. Avisar quando >80% da cota.

### F.2 Implementação

- `navigator.storage.estimate()` → retorna `{ usage, quota }`
- Componente `<StorageIndicator>` em Settings → Storage
- Barra de progresso com cores (verde <50%, amarelo <80%, vermelho >80%)
- Botão "Limpar cache do Service Worker" (PWA cache separado)
- Auto-cleanup: ao chegar 90%, perguntar ao usuário ou deletar arquivos antigos (>1 ano)

### F.3 Esforço: ~1-2 dias

---

## Fase G — 📨 Compartilhar link de arquivo

### G.1 Caso de uso

User quer mandar arquivo específico para outra pessoa (mesmo npub), com notificação direta.

### G.2 Implementação

- Botão "Share" em cada FileRow
- Gera URL: `https://app.nostrfilesync.com/?share={npub}&file={fileId}`
- Manifest adiciona `share_target` action + manifest `protocol_handlers`
- Ao abrir: app verifica share params, mostra modal "Você recebeu um arquivo de {npub}", com download direto
- Backend opcional: notificação push via NIP-17 DM

### G.3 Sem servidor

Sem push, só notificação in-app quando app é aberto pelo recipient.

### G.4 Esforço: ~2-3 dias

- Requer NIP-44 decrypt + verificação de assinatura

---

## Fase H — 🧪 Mais testes

### H.1 E2E com Playwright

- Setup completo: criar identidade → upload → download → multi-tab sync
- CI no push (GitHub Actions)

### H.2 Snapshot tests

- Componentes com `@testing-library/react` snapshot
- Cobertura de regressão visual

### H.3 Testes de migração IDB v1 → v2

- Mockar IDB v1 com dados existentes
- Verificar migração preserva tudo

### H.4 Property-based testing

- `fast-check` para parsers (parseCredential, parseRelayTags)

### H.5 Esforço: ~5 dias

---

## Fase I — 🔔 Notificações de eventos

### I.1 Objetivo

User com app em background recebe notificação quando:
- Novo arquivo aparece (sync de outro device)
- Nova tarefa (outro device adicionou)
- Bunker pediu autenticação

### I.2 Implementação

- `Notification.requestPermission()` no primeiro login
- Service Worker `push` event (sem servidor real → não usaremos push remoto)
- Notification local: quando `useFileSync` detecta novo file via subscription, dispara `new Notification(...)`
- Contador na top-nav: badge com número de unseen (persistido em IDB)
- Click na notificação → foca o app na aba correspondente

### I.3 Privacidade

- Notifications só mostram "Você recebeu um arquivo" sem detalhes sensíveis
- Click revela o conteúdo

### I.4 Esforço: ~2 dias

---

## Fase J — 📦 Export bundle criptografado

### J.1 Caso de uso

Cold backup: usuário exporta tudo (identidade + frase + lista de arquivos) num único arquivo cifrado, guarda em local seguro. Restaura em novo device sem depender de relays (embora arquivos em si precisem ser baixados).

### J.2 Estrutura do bundle

```jsonc
{
  "version": 1,
  "exportedAt": 1700000000,
  "identity": {
    "npub": "npub1...",
    "mnemonicEncrypted": "ncryptsec1...", // BIP-39 phrase encrypted
    "nsecEncrypted": "ncryptsec1..." // private key encrypted
  },
  "todos": [...],
  "files": [
    // só metadados — conteúdo precisa ser baixado dos relays
    { "fileId": "f-1", "name": "...", "hash": "...", "headerEventId": "..." }
  ],
  "subscriptions": {
    "relays": ["wss://..."]
  }
}
```

### J.3 Criptografia

- Bundle inteiro cifrado com AES-256-GCM (chave derivada da senha via PBKDF2)
- User escolhe senha forte específica para o bundle
- Output: arquivo `.nostrbundle` (json + header)

### J.4 Import

- Botão "Restore from bundle" no Setup → escolher arquivo + senha → restaura identidade, faz download dos arquivos dos relays

### J.5 Esforço: ~3 dias

---

## Fase K — 🔧 Melhorias técnicas

### K.1 Schema migrations IDB versionadas

Hoje: `DB_VERSION = 1`, sem mecanismo de upgrade além do `onupgradeneeded` vazio. Implementar:
- Constantes `SCHEMA_VERSION` por store
- Helper `migrate(db, oldVersion, newVersion)`
- Testes de migração v1 → v2 → v3

### K.2 Service Worker com Workbox avançado

- Estratégias: cache-first para assets, network-first para relays
- Background sync API (retry uploads quando online)

### K.3 Otimização de bundle

- Code splitting: separar `useTodoSync`, `useFileSync` em chunks
- Lazy load `PreviewModal` (já é leve, mas abrir sob demanda)

### K.4 Telemetria opcional

- Contar relays usados, taxa de sucesso de upload, latência média
- Tudo local em IndexedDB, sem servidor
- UI opcional em Settings → Diagnostics

---

## Fase L — 📁 Gestão de pastas

### L.1 Caso de uso

- Criar pastas vazias manualmente (organização prévia antes do upload)
- Mover arquivos ou subpastas entre pastas (drag-drop na árvore)
- Renomear pastas
- Deletar pastas (cascade delete: remove arquivos dentro)

### L.2 Implementação

- Nova ação em `FileSync.tsx`: botão "New folder" → input de texto → cria entry com `path` no IDB sem arquivo associado (kind 1063 opcional com tag `t` = "folder")
- No `TreeView`: drag-drop de `FileRow` entre pastas → atualiza `path` do record local + evento kind 5 + novo kind 1063 com `path` atualizado
- Rename: atualiza `path` de todos os arquivos na pasta (prefix-match)
- Delete folder: remove todos os arquivos recursivamente + kind 5 para cada evento remoto

### L.3 Esforço: ~3-4 dias

- Risco: eventos Nostr são imutáveis → mover = publicar novo header + kind 5 para o antigo

---

| Fase | Descrição | Esforço | Dependências |
|------|-----------|---------|--------------|
| A | Passkey (WebAuthn) | 3-5 dias | nenhuma |
| B | PWA install/UX mobile | 1-2 dias | nenhuma |
| C | Multi-device sync | 3 dias | nenhuma |
| D | Pastas pinned | 1-2 dias | nenhuma |
| E | Busca full-text | 3 dias | D (recomendado) |
| F | Quota UI | 1-2 dias | nenhuma |
| G | Compartilhar link | 2-3 dias | nenhuma |
| H | Mais testes | 5 dias | nenhuma |
| I | Notificações | 2 dias | nenhuma |
| J | Bundle export | 3 dias | nenhuma |
| K | Melhorias técnicas | contínua | — |

| L | Gestão de pastas | 3-4 dias | K.1 (schema) |

**Total realista para tudo: ~5-7 semanas de dev.**

## Combinações sugeridas

- **Curto (1-2 semanas)**: A (passkey) + I (notificações) — foca em segurança + UX
- **Médio (3-4 semanas)**: A + B + D + F — fundamentos de segurança e UX
- **Longo (6+ semanas)**: tudo, priorizado por valor de usuário

---

## Próximos passos sugeridos

1. **Discutir este roadmap** em outra sessão com stakeholders
2. **Validar Fase A** (passkey) com teste de conceito (1-2 dias)
3. **Priorizar** baseado em feedback de usuários reais
4. **Implementar** em ciclos curtos (1 semana por fase)