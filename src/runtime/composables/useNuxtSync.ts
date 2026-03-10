import { inject, ref, type InjectionKey, type Ref } from 'vue'
import type { Operation, ClientMessage, ServerMessage, SyncStatus } from '../core/types'
import { generateId } from '../core/id'

// ─── SyncClient ──────────────────────────────────────────────────────

export class SyncClient {
  readonly clientId: string
  private ws: WebSocket | null = null
  private url: string
  private listeners = new Map<string, Set<(op: Operation) => void>>()
  private snapshotListeners = new Map<string, (ops: Operation[]) => void>()
  private queue: ClientMessage[] = []
  private _status = ref<SyncStatus>('connecting')
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  get status(): Ref<SyncStatus> {
    return this._status
  }

  constructor(url: string) {
    this.clientId = generateId()
    this.url = url
    this.connect()
  }

  private connect() {
    this._status.value = 'connecting'

    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      this._status.value = 'ready'
      // Flush queued messages
      for (const msg of this.queue) {
        this.ws?.send(JSON.stringify(msg))
      }
      this.queue = []
      // Re-subscribe to all active docs
      for (const docId of this.listeners.keys()) {
        this.ws?.send(JSON.stringify({ type: 'sub', docId }))
      }
    })

    this.ws.addEventListener('message', (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch {
        // Ignore malformed messages
      }
    })

    this.ws.addEventListener('close', () => {
      this.scheduleReconnect()
    })

    this.ws.addEventListener('error', () => {
      this._status.value = 'error'
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this._status.value = 'connecting'
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': {
        const cb = this.snapshotListeners.get(msg.docId)
        cb?.(msg.ops)
        break
      }
      case 'op': {
        // Don't re-apply our own operations
        if (msg.op.clientId === this.clientId) return
        const cbs = this.listeners.get(msg.op.docId)
        cbs?.forEach(cb => cb(msg.op))
        break
      }
      case 'error': {
        console.error('[nuxt-sync]', msg.message)
        break
      }
    }
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.queue.push(msg)
    }
  }

  /** Subscribe to operations on a document */
  subscribe(
    docId: string,
    onOp: (op: Operation) => void,
    onSnapshot: (ops: Operation[]) => void,
  ): () => void {
    // Register listeners
    if (!this.listeners.has(docId)) {
      this.listeners.set(docId, new Set())
    }
    this.listeners.get(docId)?.add(onOp)
    this.snapshotListeners.set(docId, onSnapshot)

    // Send subscribe message
    this.send({ type: 'sub', docId })

    // Return unsubscribe function
    return () => {
      this.listeners.get(docId)?.delete(onOp)
      if (this.listeners.get(docId)?.size === 0) {
        this.listeners.delete(docId)
        this.snapshotListeners.delete(docId)
        this.send({ type: 'unsub', docId })
      }
    }
  }

  /** Send an operation to the server */
  sendOp(op: Operation) {
    this.send({ type: 'op', op })
  }

  /** Disconnect and clean up */
  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
    this.snapshotListeners.clear()
    this.queue = []
  }
}

// ─── Vue Integration ─────────────────────────────────────────────────

export const SyncClientKey: InjectionKey<SyncClient> = Symbol('nuxt-sync-client')

/**
 * No-op client for SSR — all operations are silently dropped.
 */
const noopClient: SyncClient = {
  clientId: 'ssr',
  status: ref<SyncStatus>('connecting'),
  subscribe: () => () => {},
  sendOp: () => {},
  destroy: () => {},
} as unknown as SyncClient

/** Get the SyncClient instance (provided by the plugin on client, noop on server) */
export function useNuxtSync(): SyncClient {
  if (typeof window === 'undefined') {
    return noopClient
  }
  const client = inject(SyncClientKey)
  if (!client) {
    throw new Error(
      '[nuxt-sync] SyncClient not found. Make sure the nuxt-sync module is installed.',
    )
  }
  return client
}
