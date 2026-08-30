# Roadmap — Nostr FileSync

## Visão do projeto

O Nostr FileSync é um sistema **offline-first, criptografado e descentralizado para armazenamento e sincronização de arquivos**, utilizando Nostr para identidade, descoberta, metadata e sincronização de estado.

O roadmap prioriza:

1. estabilidade;
2. modelo de dados;
3. sincronização;
4. integridade e recuperação;
5. segurança;
6. compartilhamento;
7. organização;
8. UX e performance.

### Princípio fundamental

> **Não adicionar uma nova funcionalidade que dependa de sincronização antes de a Sync Engine estar preparada para lidar com alterações, exclusões, conflitos e dispositivos offline.**

---

# Estado atual

O projeto atualmente possui:

- React + Vite + TypeScript
- PWA
- IndexedDB
- identidade Nostr
- BIP-39
- NIP-49
- NIP-42
- NIP-44
- NIP-46
- NIP-65
- AES-256-GCM
- gzip
- SHA-256
- deduplicação
- upload em chunks
- retomada de uploads
- organização por `path`
- drag-and-drop
- thumbnails
- preview
- tarefas Nostr
- i18n
- dark/light mode
- testes unitários e de integração

O roadmap anterior possuía funcionalidades como Passkey, multi-device, favoritos, busca, quota, compartilhamento, testes, notificações, backup e gestão de pastas. Esta versão reorganiza essas funcionalidades e adiciona a infraestrutura necessária para torná-las robustas.

---

# FASE 0 — Fundação e segurança do código

**Prioridade: 🔴 CRÍTICA**

Objetivo:

> Criar uma base segura para todas as próximas fases.

## 0.1 — Versionamento do IndexedDB

Implementar:

- `DB_VERSION`
- migrations
- `SCHEMA_VERSION`
- função central de migração

Criar uma estrutura equivalente a:

```text
v1
 ↓
v2
 ↓
v3
 ↓
v4
```

Cada alteração estrutural deve possuir uma migração própria.

Nunca depender somente de alterações ad-hoc no `onupgradeneeded`.

### Critérios de aceitação

- Instalações novas criam o schema atual.
- Instalações antigas conseguem migrar para a versão atual.
- Uma migração interrompida não deixa o banco em estado inconsistente.
- Migrações possuem testes automatizados.

---

## 0.2 — Estrutura de serviços

Separar responsabilidades:

```text
services/
├── db/
├── crypto/
├── nostr/
├── files/
├── sync/
├── devices/
└── diagnostics/
```

Evitar que `filesync.ts` concentre responsabilidades diferentes.

### Critérios de aceitação

- Serviços possuem responsabilidades claras.
- Crypto não depende da UI.
- DB não depende da UI.
- Sync não depende diretamente de componentes React.

---

## 0.3 — Abstração de signer

Criar uma interface equivalente a:

```ts
interface Signer {
  getPublicKey(): Promise<string>
  signEvent(event: UnsignedEvent): Promise<SignedEvent>
}
```

Implementações previstas:

```text
LocalSigner
NIP07Signer
NIP46Signer
```

O restante do sistema não deve precisar saber qual signer está sendo utilizado.

---

## 0.4 — Testes de fundação

Adicionar ou reforçar testes para:

- migrações;
- criptografia;
- descriptografia;
- upload;
- download;
- deleção;
- corrupção;
- retry;
- IndexedDB;
- eventos Nostr.

---

## 0.5 — CI

Pipeline mínimo:

```text
push
 ↓
lint
 ↓
typecheck
 ↓
unit tests
 ↓
build
```

Posteriormente:

```text
E2E
 ↓
coverage
```

### Resultado da Fase 0

O projeto possui uma base versionada, testável e modular para receber as próximas mudanças.

---

# FASE 1 — Novo modelo de arquivos e pastas

**Prioridade: 🔴 CRÍTICA**

Objetivo:

> Substituir a dependência estrutural de `path` por entidades estáveis de arquivo e pasta.

O modelo baseado somente em paths dificulta renomeações, movimentações, sincronização e resolução de conflitos.

---

## 1.1 — Folder entity

Criar estrutura equivalente a:

```ts
interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
  version: number
}
```

---

## 1.2 — File entity

Criar estrutura equivalente a:

```ts
interface FileRecord {
  id: string
  folderId: string
  name: string
  mimeType: string
  size: number
  contentHash: string
  createdAt: number
  updatedAt: number
  version: number
}
```

---

## 1.3 — Conteúdo separado da metadata

Separar conceitualmente:

```text
File
 ↓
metadata
 ↓
Blob
```

A identidade do arquivo não deve depender do path.

---

## 1.4 — IDs estáveis

Cada arquivo deve possuir:

```text
fileId
```

Cada pasta:

```text
folderId
```

Mover um arquivo deve alterar somente:

```text
folderId
```

Renomear deve alterar somente:

```text
name
```

---

## 1.5 — Tombstones

Criar representação de exclusão:

```ts
interface Tombstone {
  entityId: string
  entityType: "file" | "folder"
  deletedAt: number
  deletedBy: string
  version: number
}
```

Tombstones serão necessários para impedir que dispositivos offline recriem arquivos excluídos.

---

## 1.6 — Migração do modelo antigo

Converter o modelo baseado em:

```text
path
```

para:

```text
folderId
parentId
name
```

Sem perder os arquivos existentes.

---

## 1.7 — Testes

Testar:

- criação;
- rename;
- move;
- delete;
- restore;
- pastas vazias;
- árvores profundas;
- migração;
- colisão de nomes.

### Resultado da Fase 1

O sistema possui uma estrutura de arquivos adequada para sincronização distribuída.

---

# FASE 2 — Sync Engine

**Prioridade: 🔴 CRÍTICA**

Objetivo:

> Transformar a sincronização em um mecanismo confiável e persistente.

---

## 2.1 — Estados de sincronização

Definir estados:

```text
LOCAL_ONLY
PENDING_UPLOAD
UPLOADING
SYNCED
PENDING_DOWNLOAD
DOWNLOADING
CONFLICT
ERROR
DELETED
```

---

## 2.2 — Sync queue

Criar fila persistente no IndexedDB:

```ts
interface SyncOperation {
  id: string
  type: SyncOperationType
  entityId: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  status: string
}
```

Operações iniciais:

```text
CREATE
UPDATE
MOVE
RENAME
DELETE
RESTORE
UPLOAD
DOWNLOAD
```

---

## 2.3 — Retry

Implementar:

- retry;
- exponential backoff;
- jitter;
- limite de tentativas;
- estado de falha permanente.

---

## 2.4 — Cursor de sincronização

Cada dispositivo deve persistir seu ponto de sincronização:

```text
lastProcessedEvent
```

ou mecanismo equivalente.

Objetivo:

> Evitar baixar e processar novamente todo o histórico.

---

## 2.5 — Device registry

Criar entidade:

```text
Device
├── id
├── name
├── platform
├── appVersion
├── lastSeen
└── capabilities
```

---

## 2.6 — Descoberta de dispositivos

Publicar e descobrir metadata dos dispositivos do mesmo usuário.

Separar claramente:

```text
Device Discovery
```

de:

```text
File Synchronization
```

---

## 2.7 — Manifest

Criar um manifest da estrutura de arquivos:

```json
{
  "version": 17,
  "root": "...",
  "entries": []
}
```

---

## 2.8 — Delta sync

Fluxo:

```text
manifest local
      ↓
manifest remoto
      ↓
diff
      ↓
somente alterações
```

Um dispositivo com 10.000 arquivos e uma alteração não deve precisar sincronizar novamente os 10.000 arquivos.

---

## 2.9 — Pull

Implementar:

```text
remote
 ↓
discover changes
 ↓
validate
 ↓
queue local operations
 ↓
apply
```

---

## 2.10 — Push

Implementar:

```text
local change
 ↓
queue
 ↓
validate
 ↓
publish
 ↓
mark synced
```

---

## 2.11 — Conflitos

Detectar situações como:

```text
             v10
            /   \
         v11     v11'
```

Estratégias iniciais:

```text
KEEP_BOTH
LAST_WRITE_WINS
MANUAL
```

Para arquivos binários:

> `KEEP_BOTH` deve ser o comportamento padrão inicial.

---

## 2.12 — Tombstones e deleções

Fluxo:

```text
DELETE
 ↓
TOMBSTONE
 ↓
SYNC
 ↓
OTHER DEVICES
```

---

## 2.13 — Reparação de estado

Permitir reconstrução quando metadata local estiver incompleta:

```text
local state
 ↓
remote manifest
 ↓
rebuild
```

---

## 2.14 — Interface de dispositivos

Adicionar:

```text
Settings
 └── Devices
```

Mostrar:

```text
Meu PC
✓ sincronizado

Celular
✓ sincronizado há 5 min

Notebook
⚠ offline
```

### Resultado da Fase 2

Dois ou mais dispositivos podem trabalhar offline e posteriormente convergir para um estado consistente.

---

# FASE 3 — Integridade e armazenamento

**Prioridade: 🔴 ALTA**

Objetivo:

> Garantir que o conteúdo possa ser identificado, validado, deduplicado e recuperado.

---

## 3.1 — Content-addressed storage

Utilizar:

```text
SHA-256(content)
```

como identificador do conteúdo.

```text
hash
 ↓
blob
```

---

## 3.2 — Deduplicação real

Arquivos com conteúdo idêntico devem compartilhar o mesmo blob físico.

```text
PC
 └── file A
       ↓
     HASH X

Celular
 └── file B
       ↓
     HASH X
```

---

## 3.3 — Verificação de integridade

Criar:

```text
IntegrityScanner
```

Verificar:

- hash;
- tamanho;
- chunks;
- metadata;
- referências;
- réplicas, quando aplicável.

---

## 3.4 — Reparação

Detectar:

```text
CORRUPTED
MISSING
INCOMPLETE
```

e tentar recuperar de uma fonte válida.

---

## 3.5 — Garbage collector

Fluxo:

```text
mark
 ↓
grace period
 ↓
verify references
 ↓
delete
```

Nunca remover imediatamente um blob somente porque uma referência foi removida.

### Resultado da Fase 3

O sistema possui mecanismos de integridade, deduplicação e limpeza segura.

---

# FASE 4 — Versionamento e histórico

**Prioridade: 🔴 ALTA**

Objetivo:

> Permitir histórico, restauração e recuperação de alterações.

---

## 4.1 — File versions

Estrutura:

```text
arquivo
├── v1
├── v2
├── v3
└── v4 ← atual
```

---

## 4.2 — Version metadata

Criar estrutura equivalente a:

```ts
interface FileVersion {
  id: string
  fileId: string
  parentVersionId: string | null
  contentHash: string
  createdAt: number
  createdBy: string
}
```

---

## 4.3 — Restore

Permitir:

```text
Restore v2
```

A restauração deve criar uma nova versão, em vez de destruir o histórico.

---

## 4.4 — Trash

Criar área de arquivos excluídos.

---

## 4.5 — Undelete

Permitir:

```text
Trash
 ↓
Restore
```

---

## 4.6 — Retention

Configurações possíveis:

```text
30 dias
90 dias
1 ano
indefinido
```

### Resultado da Fase 4

O usuário consegue recuperar versões e arquivos excluídos sem depender de backups externos.

---

# FASE 5 — Backup e recuperação

**Prioridade: 🔴 ALTA**

Objetivo:

> Permitir recuperação completa do estado da aplicação.

---

## 5.1 — Export bundle

Criar formato:

```text
.nostrbundle
```

Incluir:

- identidade;
- configuração;
- relays;
- folders;
- files;
- metadata;
- versions;
- sync state;
- referências de conteúdo.

---

## 5.2 — Estrutura do bundle

```text
header
├── version
├── salt
├── KDF
└── parameters

encrypted payload
```

---

## 5.3 — Criptografia

Avaliar KDF moderna, preferencialmente Argon2id quando tecnicamente viável, mantendo parâmetros versionados.

---

## 5.4 — Import

Fluxo:

```text
select bundle
 ↓
password / credential
 ↓
decrypt
 ↓
validate
 ↓
restore
```

---

## 5.5 — Integrity verification

O bundle deve possuir:

- checksum;
- manifest;
- schema version;
- crypto version;
- versão do aplicativo que o criou.

---

## 5.6 — Recovery test

Cenário obrigatório:

```text
Device A
 ↓
export
 ↓
destroy local database
 ↓
import
 ↓
Device B
```

### Resultado da Fase 5

O usuário consegue recuperar o sistema mesmo após perder completamente o armazenamento local.

---

# FASE 6 — Passkey e segurança avançada

**Prioridade: 🟠 ALTA**

---

## 6.1 — Passkey POC

Validar:

- WebAuthn;
- PRF;
- navegadores compatíveis;
- desktop;
- mobile;
- fallback.

---

## 6.2 — Derivação de chave

Não tratar diretamente o resultado do PRF como senha conceitual do NIP-49.

Modelo:

```text
PRF output
 ↓
KDF / HKDF
 ↓
key material
 ↓
local credential protection
```

---

## 6.3 — Passkey management

Permitir:

- adicionar;
- remover;
- renomear;
- listar;
- identificar último uso.

---

## 6.4 — Recovery

Manter sempre uma alternativa de recuperação baseada na credencial de recuperação do sistema.

---

## 6.5 — NIP-07

Adicionar suporte a extensões de assinatura.

---

## 6.6 — NIP-46

Completar integração através da abstração `Signer`.

---

## 6.7 — Auto-lock

Configurações:

```text
Never
5 min
15 min
30 min
1 hour
```

---

# FASE 7 — Compartilhamento seguro

**Prioridade: 🟠 ALTA**

Objetivo:

> Permitir compartilhamento sem expor o conteúdo ou as chaves de forma insegura.

---

## 7.1 — Share file

Fluxo:

```text
File
 ↓
Share
 ↓
Recipient npub
```

---

## 7.2 — Key delegation

A chave necessária para acessar o conteúdo deve ser protegida especificamente para o destinatário.

---

## 7.3 — Permissions

Inicialmente:

```text
VIEWER
EDITOR
OWNER
```

---

## 7.4 — Revocation

Permitir:

```text
revoke access
```

---

## 7.5 — Share link

Criar links seguros.

Evitar colocar segredos diretamente em query strings.

Quando apropriado, avaliar uso de fragmentos da URL para material secreto que não deve ser enviado ao servidor.

---

## 7.6 — Expiração

Opções:

```text
1 hour
1 day
7 days
30 days
never
```

---

## 7.7 — Shared folders

Posteriormente:

```text
Folder
├── owner
├── editors
└── viewers
```

---

# FASE 8 — Storage management

**Prioridade: 🟡 MÉDIA**

---

## 8.1 — Quota

Utilizar:

```text
navigator.storage.estimate()
```

---

## 8.2 — Dashboard

Mostrar:

```text
Local storage
IndexedDB
Cache
Offline files
Thumbnails
```

---

## 8.3 — Alertas

```text
80% → aviso
90% → aviso crítico
95% → restringir operações
```

---

## 8.4 — Nunca apagar automaticamente arquivos do usuário

Oferecer ações explícitas:

```text
Limpar cache
Limpar thumbnails
Remover conteúdo offline
Remover arquivos locais já sincronizados
```

Sempre pedir confirmação para ações destrutivas.

---

## 8.5 — Smart storage

Estados:

```text
Always offline
Available offline
Online only
Pinned
```

### Resultado

O usuário controla quais arquivos ocupam armazenamento local.

---

# FASE 9 — Busca e organização

**Prioridade: 🟡 MÉDIA**

---

## 9.1 — Pastas favoritas

Adicionar:

```text
📌 Favorites
```

Preferências locais podem permanecer específicas de cada dispositivo.

---

## 9.2 — Busca por metadata

Pesquisar por:

- nome;
- pasta;
- MIME;
- tamanho;
- data;
- tags.

---

## 9.3 — Full-text

Começar por formatos leves:

```text
.txt
.md
.json
.csv
```

---

## 9.4 — Search Worker

Mover indexação para Web Worker.

---

## 9.5 — Índice invertido

Modelo:

```text
term → files
```

Exemplo:

```text
"nostr" → [file1, file8, file25]
"sync"  → [file1, file2]
```

---

## 9.6 — Search syntax

Futuramente:

```text
path:photos
type:image
ext:md
before:2026-01-01
after:2026-06-01
```

---

# FASE 10 — PWA, background e mobile

**Prioridade: 🟡 MÉDIA**

---

## 10.1 — PWA UX

Implementar:

- instalação;
- standalone;
- manifest;
- deep links;
- instruções específicas para iOS.

---

## 10.2 — Service Worker

Separar:

```text
static assets
network requests
background operations
```

---

## 10.3 — Background sync

Quando suportado:

```text
offline upload
 ↓
queue
 ↓
internet
 ↓
automatic retry
```

---

## 10.4 — Web Workers

Mover operações pesadas:

- hash;
- compressão;
- criptografia;
- indexação.

---

## 10.5 — Mobile optimization

Priorizar:

- bateria;
- memória;
- banda;
- armazenamento.

---

# FASE 11 — Notificações

**Prioridade: 🟡 MÉDIA**

---

## 11.1 — In-app notifications

Eventos:

```text
Novo arquivo
Nova versão
Conflito
Erro de sync
```

---

## 11.2 — Notification center

```text
Notifications
├── unread
├── read
└── archived
```

---

## 11.3 — Browser notifications

Utilizar Notification API quando disponível e apropriado.

---

## 11.4 — Push remoto

Deixar explicitamente como etapa futura.

Não assumir que Service Worker sozinho fornece push remoto.

---

# FASE 12 — Performance

**Prioridade: 🟢 POSTERIOR**

---

## 12.1 — Bundle

- code splitting;
- lazy loading;
- tree shaking.

---

## 12.2 — Upload

Avaliar:

- chunks paralelos;
- tamanho adaptativo;
- fila de prioridade.

---

## 12.3 — Content Defined Chunking

Para arquivos grandes:

```text
content
 ↓
CDC
 ↓
chunks
```

Objetivo:

> Reutilizar chunks que não foram alterados.

---

## 12.4 — Bandwidth control

Opções:

```text
Unlimited
Low
Medium
High
```

---

## 12.5 — Priority queue

Exemplo:

```text
1. metadata
2. small files
3. user-requested download
4. background sync
5. thumbnails
```

---

# FASE 13 — Diagnóstico e observabilidade

**Prioridade: 🟢 CONTÍNUA**

---

## 13.1 — Diagnostics local

Guardar somente localmente, quando possível:

- relay latency;
- upload success;
- download success;
- sync errors;
- retry count.

Evitar coletar conteúdo ou dados privados.

---

## 13.2 — Relay health

Calcular score baseado em:

```text
latency
availability
success rate
```

---

## 13.3 — Repair tools

Disponibilizar:

```text
Check integrity
Rebuild index
Rebuild manifest
Retry failed operations
```

---

## 13.4 — Export diagnostics

Permitir exportar logs técnicos sem dados sensíveis.

---

# FASE 14 — Armazenamento descentralizado avançado

**Prioridade: 🔵 FUTURA**

Objetivo:

> Separar definitivamente a camada de metadata da camada de armazenamento de blobs.

---

## 14.1 — Separação Nostr / Blob storage

Arquitetura:

```text
Nostr
 ↓
identity
metadata
versions
permissions
sync state

Storage
 ↓
encrypted blobs
```

---

## 14.2 — Blossom

Avaliar utilização de Blossom para armazenamento de blobs.

O objetivo é evitar usar eventos Nostr como mecanismo principal para transportar grandes volumes de conteúdo.

---

## 14.3 — Storage providers

Permitir múltiplos servidores:

```text
Blossom A
Blossom B
Blossom C
```

---

## 14.4 — Replication factor

Exemplo:

```text
critical   → 5 replicas
normal     → 3 replicas
temporary  → 1 replica
```

---

## 14.5 — Automatic repair

```text
replica missing
 ↓
download healthy replica
 ↓
upload new replica
```

### Resultado

O FileSync passa a possuir uma camada de armazenamento descentralizado independente da camada Nostr.

---

# FASE 15 — Desktop e filesystem real

**Prioridade: 🔵 FUTURA**

Objetivo:

> Transformar o FileSync em um sistema de sincronização de arquivos semelhante a Dropbox/Drive, mas descentralizado e criptografado.

---

## 15.1 — File System Access API

Permitir escolher uma pasta local:

```text
~/NostrDrive
```

---

## 15.2 — Folder watcher

Detectar:

```text
created
modified
renamed
deleted
```

---

## 15.3 — Automatic sync

```text
filesystem
 ↓
Sync Engine
 ↓
Nostr + Storage
```

---

## 15.4 — Desktop application

Avaliar:

```text
Tauri
+
Rust
```

para:

- filesystem watcher;
- background sync;
- notificações;
- execução contínua.

---

# FASE 16 — Auditoria e hardening

**Prioridade: 🔵 ANTES DE PRODUÇÃO EM ESCALA**

---

## 16.1 — Security audit

Revisar:

- criptografia;
- armazenamento;
- NIP-44;
- NIP-49;
- NIP-46;
- WebAuthn;
- compartilhamento;
- links.

---

## 16.2 — Dependency audit

Automatizar:

```text
npm audit
dependency review
lockfile verification
```

---

## 16.3 — CSP

Implementar Content Security Policy adequada.

---

## 16.4 — Threat model

Documentar:

```text
Quem é o atacante?
O que ele consegue ver?
O que ele consegue modificar?
O que acontece se um relay for malicioso?
O que acontece se um storage server for malicioso?
O que acontece se o dispositivo for comprometido?
```

---

# Estratégia de implementação para IA Free Tier

Cada fase deve ser dividida em micro-etapas.

Nunca enviar uma fase inteira para uma IA com contexto limitado.

Exemplo:

```text
Fase 2 — Sync Engine

2.1 Criar SyncOperation
2.2 Criar sync queue
2.3 Persistir queue no IndexedDB
2.4 Implementar retry
2.5 Implementar backoff
2.6 Criar SyncState
2.7 Criar Device
2.8 Publicar Device metadata
2.9 Descobrir devices
2.10 Criar cursor
2.11 Implementar pull
2.12 Implementar diff
2.13 Implementar push
2.14 Implementar tombstones
2.15 Implementar conflitos
2.16 Criar UI
2.17 Criar testes
```

Cada prompt deve conter:

```text
OBJETIVO

ARQUIVOS QUE PODE ALTERAR

ARQUIVOS QUE NÃO DEVE ALTERAR

REGRAS

IMPLEMENTAÇÃO

TESTES

CRITÉRIOS DE ACEITAÇÃO
```

Após cada micro-etapa:

```text
implementação
 ↓
typecheck
 ↓
testes
 ↓
build
 ↓
próxima etapa
```

---

# Milestones

## 🟢 M1 — Stable Local

Após as Fases 0–1:

> O app possui banco local versionado e modelo correto de arquivos/pastas.

---

## 🟢 M2 — Reliable Sync

Após a Fase 2:

> Dois ou mais dispositivos podem trabalhar offline e sincronizar alterações.

---

## 🟢 M3 — Recoverable

Após as Fases 3–5:

> Dados podem ser verificados, versionados, recuperados e restaurados.

---

## 🟢 M4 — Secure

Após a Fase 6:

> Identidade e desbloqueio possuem mecanismos modernos de proteção.

---

## 🟢 M5 — Collaborative

Após a Fase 7:

> Usuários podem compartilhar arquivos e pastas de forma criptografada.

---

## 🟢 M6 — Usable

Após as Fases 8–11:

> O produto possui busca, organização, PWA, notificações e boa experiência mobile.

---

## 🔵 M7 — Advanced

Após as Fases 12–15:

> O FileSync se comporta como uma plataforma descentralizada de armazenamento e sincronização.

---

## 🔴 M8 — Production Hardened

Após a Fase 16:

> O projeto possui processos e controles de segurança adequados para uso em produção em escala.

---

# Ordem resumida

```text
FASE 0
Fundação
        ↓
FASE 1
Modelo de arquivos/pastas
        ↓
FASE 2
Sync Engine
        ↓
FASE 3
Integridade + Storage
        ↓
FASE 4
Versionamento
        ↓
FASE 5
Backup/Recovery
        ↓
FASE 6
Passkey + Signers
        ↓
FASE 7
Compartilhamento
        ↓
FASE 8
Storage management
        ↓
FASE 9
Busca + Organização
        ↓
FASE 10
PWA + Background
        ↓
FASE 11
Notificações
        ↓
FASE 12
Performance
        ↓
FASE 13
Diagnostics
        ↓
FASE 14
Blossom / Storage descentralizado
        ↓
FASE 15
Desktop / Filesystem
        ↓
FASE 16
Security Audit
```

---

# Regra de ouro do projeto

Antes de avançar para uma nova fase:

1. todas as alterações da fase anterior devem estar funcionando;
2. testes devem passar;
3. `typecheck` deve passar;
4. build deve passar;
5. migrações devem estar documentadas;
6. nenhuma funcionalidade existente deve ser quebrada;
7. decisões arquiteturais que afetam fases futuras devem ser documentadas.

> **O objetivo não é implementar o maior número de features rapidamente. O objetivo é construir uma base que permita adicionar features sem precisar reescrever a arquitetura posteriormente.**
