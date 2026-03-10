# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

nuxt-sync is a Nuxt 3 module that provides real-time collaborative data using CRDTs (Conflict-free Replicated Data Types) with Nitro WebSocket sync. It's currently a proof-of-concept / early stage.

## Commands

```bash
npm run dev              # Start playground dev server (nuxi dev playground)
npm run build            # Build the module (nuxt-module-build build)
npm run prepare          # Generate playground types (nuxi prepare playground)
npm run typecheck        # Typecheck via playground (nuxi typecheck playground)
npm test                 # Run all vitest tests (unit + composables)
npm run test:unit        # Run unit tests only (core CRDT, schema, id, storage)
npm run test:composables # Run composable tests only (useSyncMap, useSyncList)
npm run test:e2e         # Run Playwright E2E tests (playground todo app)
npm run test:coverage    # Run vitest with V8 coverage
```

## Architecture

### Module Entry (`src/module.ts`)

Registers:
- A client-only plugin (`sync.client`) that creates a `SyncClient` WebSocket connection
- A server WebSocket handler at `/__sync` (configurable via `wsPath`)
- Auto-imported composables: `useSyncMap`, `useSyncList`, `useNuxtSync`

Module options go under the `sync` config key in `nuxt.config.ts`.

### Core Layer (`src/runtime/core/`)

- **`types.ts`** — All types: field definitions, CRDT registers, operations (`map:set`, `map:del`, `list:ins`, `list:del`, `list-item:set`), and the WebSocket protocol messages (`sub`, `unsub`, `op`, `snapshot`, `ack`, `error`)
- **`schema.ts`** — Schema builder (`sync.map()`, `sync.list()`) with phantom types for inference. Exported publicly via `nuxt-sync/schema`
- **`crdt.ts`** — `CRDTMap` (LWW registers) and `CRDTList` (linked list with LWW per-field). Both used identically on client and server. `applyOp()` is the universal operation dispatcher
- **`id.ts`** — ID generation (`generateId`, `docId`)

### Client Layer (`src/runtime/composables/`)

- **`useNuxtSync.ts`** — `SyncClient` class (WebSocket connection, message routing, reconnection, op queuing) + Vue injection via `SyncClientKey`. Returns a noop client during SSR
- **`useSyncMap.ts`** — Composable returning `{ data, status, set, del }`. Maintains a local `CRDTMap`, applies ops optimistically, syncs via `SyncClient`
- **`useSyncList.ts`** — Composable returning `{ items, status, push, insertAfter, remove, updateItem }`. Same pattern with `CRDTList`

Both composables accept a reactive `id` parameter and clean up subscriptions on unmount.

### Server Layer (`src/runtime/server/`)

- **`routes/__sync.ts`** — WebSocket handler using `defineWebSocketHandler` from h3/crossws. Maintains in-process CRDT store, subscription map, and peer registry. Broadcasts ops to subscribers
- **`utils/storage.ts`** — `SyncStorage` interface with `createMemoryStorage()` (default) and `createSQLiteStorage()` (better-sqlite3) implementations

### Data Flow

1. Client composable applies op locally to its CRDT (optimistic)
2. Op sent via WebSocket to server
3. Server applies op to its CRDT store, persists it, broadcasts to other subscribers
4. Other clients receive op, apply to their local CRDTs, trigger Vue reactivity

### Playground (`playground/`)

Demo app with a shared todo list. Schema definitions live in `playground/shared/schema.ts`.

## Key Patterns

- All CRDT conflict resolution uses Last-Writer-Wins (LWW) with `(timestamp, clientId)` tiebreaker
- The same CRDT classes (`CRDTMap`, `CRDTList`) run on both client and server — no separate implementations
- Schemas use phantom types (`_type`) for TypeScript inference without runtime overhead
- Composables use `shallowRef` for performance — mutations replace the entire value object
