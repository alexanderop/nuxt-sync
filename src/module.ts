import { defineNuxtModule, addPlugin, addImports, createResolver, addServerHandler } from '@nuxt/kit'
import { defu } from 'defu'

export interface NuxtSyncOptions {
  /** WebSocket route path (default: '/__sync') */
  wsPath?: string
  /** Storage backend: 'memory' | 'sqlite' (default: 'memory') */
  storage?: 'memory' | 'sqlite'
  /** SQLite database path (when storage is 'sqlite') */
  dbPath?: string
}

export default defineNuxtModule<NuxtSyncOptions>({
  meta: {
    name: 'nuxt-sync',
    configKey: 'sync',
    compatibility: {
      nuxt: '>=3.16.0',
    },
  },
  defaults: {
    wsPath: '/__sync',
    storage: 'memory',
    dbPath: '.data/nuxt-sync.db',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Merge options
    const config = defu(options, {
      wsPath: '/__sync',
      storage: 'memory' as const,
      dbPath: '.data/nuxt-sync.db',
    })

    // Enable Nitro experimental WebSocket support
    nuxt.options.nitro = defu(nuxt.options.nitro, {
      experimental: {
        websocket: true,
      },
    })

    // ── Client Plugin ──
    // Establishes WebSocket connection and provides SyncClient
    addPlugin({
      src: resolve('./runtime/plugins/sync.client'),
      mode: 'client',
    })

    // ── Server WebSocket Route ──
    // Handles sync protocol over WebSocket
    addServerHandler({
      route: config.wsPath,
      handler: resolve('./runtime/server/routes/__sync'),
    })

    // ── Auto-import Composables ──
    addImports([
      {
        name: 'useSyncMap',
        from: resolve('./runtime/composables/useSyncMap'),
      },
      {
        name: 'useSyncList',
        from: resolve('./runtime/composables/useSyncList'),
      },
      {
        name: 'useNuxtSync',
        from: resolve('./runtime/composables/useNuxtSync'),
      },
    ])

    // ── Make core utilities available ──
    // Schema builder and types are importable from 'nuxt-sync/schema'
    // No auto-import for schema to keep it explicit

    // ── Runtime config ──
    nuxt.options.runtimeConfig.public = defu(
      nuxt.options.runtimeConfig.public,
      {
        sync: {
          wsPath: config.wsPath,
        },
      },
    )

    console.log('[nuxt-sync] Module loaded — WebSocket route:', config.wsPath)
  },
})
