import { defineWebSocketHandler } from 'h3'
import type { Peer } from 'crossws'
import type { ClientMessage, ServerMessage } from '../../core/types'
import { createStore, applyOp, type CRDTStore } from '../../core/crdt'
import { createMemoryStorage, type SyncStorage } from '../utils/storage'

// ─── Server-side sync state (singleton per server process) ───────────

const store: CRDTStore = createStore()
const storage: SyncStorage = createMemoryStorage()

/** Map of docId → Set of subscribed peer IDs */
const subscriptions = new Map<string, Set<string>>()

/** Map of peer ID → Peer instance */
const peers = new Map<string, Peer>()

// Initialize storage
let initialized = false
async function ensureInitialized() {
  if (initialized) return
  initialized = true
  await storage.initialize()

  // Replay all persisted operations into the CRDT store
  const docIds = await storage.getAllDocIds()
  for (const docId of docIds) {
    const ops = await storage.getOperations(docId)
    for (const op of ops) {
      applyOp(store, op)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sendTo(peer: Peer, msg: ServerMessage) {
  peer.send(JSON.stringify(msg))
}

function broadcast(docId: string, msg: ServerMessage, excludePeerId?: string) {
  const subs = subscriptions.get(docId)
  if (!subs) return
  for (const peerId of subs) {
    if (peerId === excludePeerId) continue
    const peer = peers.get(peerId)
    if (peer) {
      sendTo(peer, msg)
    }
  }
}

function getPeerId(peer: Peer): string {
  return peer.id ?? String(peer)
}

// ─── WebSocket Handler ───────────────────────────────────────────────

export default defineWebSocketHandler({
  async open(peer) {
    await ensureInitialized()
    const peerId = getPeerId(peer)
    peers.set(peerId, peer)
    console.log(`[nuxt-sync] peer connected: ${peerId}`)
  },

  async message(peer, message) {
    const peerId = getPeerId(peer)

    let msg: ClientMessage
    try {
      msg = JSON.parse(message.text())
    } catch {
      sendTo(peer, { type: 'error', message: 'Invalid JSON' })
      return
    }

    switch (msg.type) {
      case 'sub': {
        // Subscribe peer to a document
        if (!subscriptions.has(msg.docId)) {
          subscriptions.set(msg.docId, new Set())
        }
        subscriptions.get(msg.docId)?.add(peerId)

        // Send current state as a snapshot (all operations for this doc)
        const ops = await storage.getOperations(msg.docId)
        sendTo(peer, {
          type: 'snapshot',
          docId: msg.docId,
          docType: 'map', // The client determines the actual type
          ops,
        })

        console.log(`[nuxt-sync] peer ${peerId} subscribed to ${msg.docId}`)
        break
      }

      case 'unsub': {
        subscriptions.get(msg.docId)?.delete(peerId)
        console.log(`[nuxt-sync] peer ${peerId} unsubscribed from ${msg.docId}`)
        break
      }

      case 'op': {
        const op = msg.op

        // Apply to CRDT store
        applyOp(store, op)

        // Persist the operation
        await storage.saveOperation(op)

        // Broadcast to all other subscribers of this document
        broadcast(op.docId, { type: 'op', op }, peerId)

        // Acknowledge
        sendTo(peer, { type: 'ack', opId: op.id })
        break
      }

      default: {
        sendTo(peer, { type: 'error', message: `Unknown message type` })
      }
    }
  },

  close(peer) {
    const peerId = getPeerId(peer)
    peers.delete(peerId)

    // Remove from all subscriptions
    for (const [, subs] of subscriptions) {
      subs.delete(peerId)
    }

    console.log(`[nuxt-sync] peer disconnected: ${peerId}`)
  },

  error(peer, error) {
    console.error(`[nuxt-sync] peer error:`, error)
  },
})
