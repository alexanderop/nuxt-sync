import { shallowRef, toValue, watch, getCurrentInstance, onUnmounted, type MaybeRefOrGetter, type ShallowRef } from 'vue'
import { ref } from 'vue'
import type { SyncMapSchema } from '../core/schema'
import type { Operation, SyncStatus } from '../core/types'
import { CRDTMap } from '../core/crdt'
import { generateId } from '../core/id'
import { useNuxtSync } from './useNuxtSync'

export interface UseSyncMapReturn<T> {
  /** Current data (null while loading) */
  data: ShallowRef<T | null>
  /** Connection/loading status */
  status: ShallowRef<SyncStatus>
  /** Set one or more fields */
  set: {
    (updates: Partial<T>): void
    <K extends keyof T>(key: K, value: T[K]): void
  }
  /** Delete a field */
  del: (key: keyof T) => void
}

/**
 * Subscribe to a collaborative map document.
 *
 * ```ts
 * const { data, set } = useSyncMap(TodoSchema, 'todo-123')
 *
 * // Read
 * data.value?.title
 *
 * // Write
 * set('title', 'Buy groceries')
 * set({ title: 'Buy groceries', done: true })
 * ```
 */
export function useSyncMap<T>(
  schema: SyncMapSchema<T>,
  id: MaybeRefOrGetter<string>,
): UseSyncMapReturn<T> {
  const client = useNuxtSync()
  const crdt = new CRDTMap()

  const data = shallowRef<T | null>(null) as ShallowRef<T | null>
  const status = ref<SyncStatus>('loading') as ShallowRef<SyncStatus>

  let unsub: (() => void) | null = null

  function refreshData() {
    data.value = crdt.toJSON() as T
  }

  function handleOp(op: Operation) {
    let changed = false
    if (op.type === 'map:set') {
      changed = crdt.applySet(op.key, op.value, op.ts, op.clientId)
    } else if (op.type === 'map:del') {
      changed = crdt.applyDel(op.key, op.ts, op.clientId)
    }
    if (changed) refreshData()
  }

  function handleSnapshot(ops: Operation[]) {
    for (const op of ops) {
      if (op.type === 'map:set') {
        crdt.applySet(op.key, op.value, op.ts, op.clientId)
      } else if (op.type === 'map:del') {
        crdt.applyDel(op.key, op.ts, op.clientId)
      }
    }
    refreshData()
    status.value = 'ready'
  }

  // Watch for id changes (supports reactive ids)
  const stopWatch = watch(
    () => toValue(id),
    (docId) => {
      // Cleanup previous subscription
      unsub?.()
      status.value = 'loading'

      unsub = client.subscribe(docId, handleOp, handleSnapshot)
    },
    { immediate: true },
  )

  // ── Mutation Methods ──

  function set(keyOrUpdates: keyof T | Partial<T>, value?: unknown): void {
    const docId = toValue(id)

    if (typeof keyOrUpdates === 'string') {
      // Single field: set('title', 'new')
      const ts = Date.now()
      const op: Operation = {
        type: 'map:set',
        id: generateId(),
        docId,
        key: keyOrUpdates,
        value: value as unknown,
        ts,
        clientId: client.clientId,
      }
      crdt.applySet(keyOrUpdates, value, ts, client.clientId)
      refreshData()
      client.sendOp(op)
    } else {
      // Batch: set({ title: 'new', done: true })
      const ts = Date.now()
      for (const [key, val] of Object.entries(keyOrUpdates as Record<string, unknown>)) {
        const op: Operation = {
          type: 'map:set',
          id: generateId(),
          docId,
          key,
          value: val,
          ts,
          clientId: client.clientId,
        }
        crdt.applySet(key, val, ts, client.clientId)
        client.sendOp(op)
      }
      refreshData()
    }
  }

  function del(key: keyof T): void {
    const docId = toValue(id)
    const ts = Date.now()
    const op: Operation = {
      type: 'map:del',
      id: generateId(),
      docId,
      key: key as string,
      ts,
      clientId: client.clientId,
    }
    crdt.applyDel(key as string, ts, client.clientId)
    refreshData()
    client.sendOp(op)
  }

  // Cleanup on unmount (only in client-side component lifecycle)
  if (getCurrentInstance()) {
    onUnmounted(() => {
      unsub?.()
      stopWatch()
    })
  }

  return { data, status, set: set as UseSyncMapReturn<T>['set'], del }
}
