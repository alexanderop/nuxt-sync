# nuxt-sync

Real-time collaborative data for Nuxt using CRDTs with Nitro WebSocket sync.

Inspired by [Jazz](https://jazz.tools) and [Nuxt Content](https://content.nuxt.com) — nuxt-sync aims to be a native Nuxt module that helps you build local-first apps.

> **Early stage / proof of concept** — API will change.

## Install

```bash
pnpm add nuxt-sync
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-sync'],
})
```

## Features

- CRDT-based conflict resolution (Last-Writer-Wins)
- Real-time sync over WebSockets via Nitro
- Shared CRDT logic on client and server
- Composables: `useSyncMap`, `useSyncList`, `useNuxtSync`
- Schema builder with full TypeScript inference
- SQLite or in-memory storage

## Quick Start

Define a schema:

```ts
// shared/schema.ts
import { sync } from 'nuxt-sync/schema'

export const Todo = sync.map({
  title: sync.string(),
  done: sync.boolean(),
})
```

Use it in a component:

```vue
<script setup>
const { data, set } = useSyncMap(Todo, 'todo-1')
</script>

<template>
  <input :value="data?.title" @input="set('title', $event.target.value)" />
</template>
```

## License

MIT
