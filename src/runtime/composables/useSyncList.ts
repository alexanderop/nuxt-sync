import { shallowRef, toValue, watch, getCurrentInstance, onUnmounted, ref, type MaybeRefOrGetter, type ShallowRef } from 'vue'
import type { SyncListSchema } from '../core/schema'
import type { Operation, SyncStatus } from '../core/types'
import { CRDTList } from '../core/crdt'
import { generateId } from '../core/id'
import { useNuxtSync } from './useNuxtSync'

export interface SyncListItem<T> {
  /** Unique item ID */
  id: string
  /** Item data */
  data: T
}

export interface UseSyncListReturn<T> {
  /** Current items (empty array while loading) */
  items: ShallowRef<SyncListItem<T>[]>
  /** Connection/loading status */
  status: ShallowRef<SyncStatus>
  /** Append an item to the end of the list */
  push: (data: T) => string
  /** Insert an item after a specific item */
  insertAfter: (afterId: string, data: T) => string
  /** Remove an item by ID */
  remove: (itemId: string) => void
  /** Update fields on a list item */
  updateItem: {
    (itemId: string, updates: Partial<T>): void
    <K extends keyof T>(itemId: string, key: K, value: T[K]): void
  }
}

/**
 * Subscribe to a collaborative list document.
 *
 * ```ts
 * const { items, push, remove, updateItem } = useSyncList(TodoListSchema, 'my-todos')
 *
 * // Add
 * push({ title: 'Buy milk', done: false })
 *
 * // Update
 * updateItem(todo.id, 'done', true)
 *
 * // Remove
 * remove(todo.id)
 * ```
 */
export function useSyncList<T>(
  schema: SyncListSchema<T>,
  id: MaybeRefOrGetter<string>,
): UseSyncListReturn<T> {
  const client = useNuxtSync()
  const crdt = new CRDTList()

  const items = shallowRef<SyncListItem<T>[]>([]) as ShallowRef<SyncListItem<T>[]>
  const status = ref<SyncStatus>('loading') as ShallowRef<SyncStatus>

  let unsub: (() => void) | null = null

  function refreshItems() {
    items.value = crdt.toArray().map(item => ({
      id: item.id,
      data: item.fields as T,
    }))
  }

  function handleOp(op: Operation) {
    let changed = false
    switch (op.type) {
      case 'list:ins':
        changed = crdt.insert(op.itemId, op.afterId, op.fields, op.ts, op.clientId)
        break
      case 'list:del':
        changed = crdt.delete(op.itemId, op.ts, op.clientId)
        break
      case 'list-item:set':
        changed = crdt.setItemField(op.itemId, op.key, op.value, op.ts, op.clientId)
        break
    }
    if (changed) refreshItems()
  }

  function handleSnapshot(ops: Operation[]) {
    for (const op of ops) {
      switch (op.type) {
        case 'list:ins':
          crdt.insert(op.itemId, op.afterId, op.fields, op.ts, op.clientId)
          break
        case 'list:del':
          crdt.delete(op.itemId, op.ts, op.clientId)
          break
        case 'list-item:set':
          crdt.setItemField(op.itemId, op.key, op.value, op.ts, op.clientId)
          break
      }
    }
    refreshItems()
    status.value = 'ready'
  }

  // Watch for id changes
  const stopWatch = watch(
    () => toValue(id),
    (docId) => {
      unsub?.()
      status.value = 'loading'
      unsub = client.subscribe(docId, handleOp, handleSnapshot)
    },
    { immediate: true },
  )

  // ── Mutation Methods ──

  function push(data: T): string {
    const docId = toValue(id)
    const itemId = generateId()
    const ts = Date.now()

    // Find the last item to insert after
    const currentItems = crdt.toArray()
    const lastId = currentItems.length > 0 ? currentItems[currentItems.length - 1].id : null

    const op: Operation = {
      type: 'list:ins',
      id: generateId(),
      docId,
      itemId,
      afterId: lastId,
      fields: data as Record<string, unknown>,
      ts,
      clientId: client.clientId,
    }

    crdt.insert(itemId, lastId, data as Record<string, unknown>, ts, client.clientId)
    refreshItems()
    client.sendOp(op)

    return itemId
  }

  function insertAfter(afterId: string, data: T): string {
    const docId = toValue(id)
    const itemId = generateId()
    const ts = Date.now()

    const op: Operation = {
      type: 'list:ins',
      id: generateId(),
      docId,
      itemId,
      afterId,
      fields: data as Record<string, unknown>,
      ts,
      clientId: client.clientId,
    }

    crdt.insert(itemId, afterId, data as Record<string, unknown>, ts, client.clientId)
    refreshItems()
    client.sendOp(op)

    return itemId
  }

  function remove(itemId: string): void {
    const docId = toValue(id)
    const ts = Date.now()

    const op: Operation = {
      type: 'list:del',
      id: generateId(),
      docId,
      itemId,
      ts,
      clientId: client.clientId,
    }

    crdt.delete(itemId, ts, client.clientId)
    refreshItems()
    client.sendOp(op)
  }

  function updateItem(itemId: string, keyOrUpdates: keyof T | Partial<T>, value?: unknown): void {
    const docId = toValue(id)
    const ts = Date.now()

    if (typeof keyOrUpdates === 'string') {
      const op: Operation = {
        type: 'list-item:set',
        id: generateId(),
        docId,
        itemId,
        key: keyOrUpdates,
        value: value as unknown,
        ts,
        clientId: client.clientId,
      }
      crdt.setItemField(itemId, keyOrUpdates, value, ts, client.clientId)
      client.sendOp(op)
    } else {
      for (const [key, val] of Object.entries(keyOrUpdates as Record<string, unknown>)) {
        const op: Operation = {
          type: 'list-item:set',
          id: generateId(),
          docId,
          itemId,
          key,
          value: val,
          ts,
          clientId: client.clientId,
        }
        crdt.setItemField(itemId, key, val, ts, client.clientId)
        client.sendOp(op)
      }
    }
    refreshItems()
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      unsub?.()
      stopWatch()
    })
  }

  return {
    items,
    status,
    push,
    insertAfter,
    remove,
    updateItem: updateItem as UseSyncListReturn<T>['updateItem'],
  }
}
