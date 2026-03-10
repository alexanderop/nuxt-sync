import type {
  MapState,
  Register,
  ListItem,
  Operation,
} from './types'

// ─── LWW comparison ─────────────────────────────────────────────────

/** Returns true if (ts, clientId) wins over an existing register */
function lwwWins(
  newTs: number,
  newClientId: string,
  existing: Register | undefined,
): boolean {
  if (!existing) return true
  if (newTs > existing.ts) return true
  if (newTs === existing.ts && newClientId > existing.clientId) return true
  return false
}

// ─── CRDTMap ─────────────────────────────────────────────────────────

export class CRDTMap {
  private registers: Map<string, Register> = new Map()

  applySet(key: string, value: unknown, ts: number, clientId: string): boolean {
    const existing = this.registers.get(key)
    if (lwwWins(ts, clientId, existing)) {
      this.registers.set(key, { value, ts, clientId })
      return true
    }
    return false
  }

  applyDel(key: string, ts: number, clientId: string): boolean {
    const existing = this.registers.get(key)
    if (lwwWins(ts, clientId, existing)) {
      this.registers.delete(key)
      return true
    }
    return false
  }

  get(key: string): unknown {
    return this.registers.get(key)?.value
  }

  /** Return a plain object with current values */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, reg] of this.registers) {
      result[key] = reg.value
    }
    return result
  }

  /** Return the full register state (for snapshots) */
  getState(): MapState {
    const state: MapState = {}
    for (const [key, reg] of this.registers) {
      state[key] = { ...reg }
    }
    return state
  }

  /** Initialize from a state snapshot */
  loadState(state: MapState): void {
    this.registers.clear()
    for (const [key, reg] of Object.entries(state)) {
      this.registers.set(key, { ...reg })
    }
  }
}

// ─── CRDTList ────────────────────────────────────────────────────────

export class CRDTList {
  private items: Map<string, ListItem> = new Map()

  insert(
    itemId: string,
    afterId: string | null,
    fields: Record<string, unknown>,
    ts: number,
    clientId: string,
  ): boolean {
    if (this.items.has(itemId)) return false // Duplicate insert

    const mapState: MapState = {}
    for (const [key, value] of Object.entries(fields)) {
      mapState[key] = { value, ts, clientId }
    }

    this.items.set(itemId, {
      id: itemId,
      afterId,
      fields: mapState,
      ts,
      clientId,
      deleted: false,
    })
    return true
  }

  delete(itemId: string, _ts: number, _clientId: string): boolean {
    const item = this.items.get(itemId)
    if (!item || item.deleted) return false
    // For delete, we use LWW — any delete with a later ts wins
    item.deleted = true
    return true
  }

  setItemField(
    itemId: string,
    key: string,
    value: unknown,
    ts: number,
    clientId: string,
  ): boolean {
    const item = this.items.get(itemId)
    if (!item || item.deleted) return false

    const existing = item.fields[key]
    if (lwwWins(ts, clientId, existing)) {
      item.fields[key] = { value, ts, clientId }
      return true
    }
    return false
  }

  /**
   * Build the ordered list by traversing the linked structure.
   * Items inserted after the same parent are ordered by timestamp DESC
   * (newest first — so new inserts appear right after the parent).
   */
  toArray(): Array<{ id: string; fields: Record<string, unknown> }> {
    // Group non-deleted items by afterId
    const childrenOf = new Map<string | null, ListItem[]>()

    for (const item of this.items.values()) {
      if (item.deleted) continue
      const key = item.afterId
      let children = childrenOf.get(key)
      if (!children) {
        children = []
        childrenOf.set(key, children)
      }
      children.push(item)
    }

    // Sort children: timestamp ASC, then clientId ASC for determinism
    // (earlier inserts first, so appending works naturally)
    for (const children of childrenOf.values()) {
      children.sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts
        return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0
      })
    }

    // DFS traversal to build ordered list
    const result: Array<{ id: string; fields: Record<string, unknown> }> = []

    const traverse = (afterId: string | null) => {
      const children = childrenOf.get(afterId)
      if (!children) return
      for (const child of children) {
        const fields: Record<string, unknown> = {}
        for (const [k, reg] of Object.entries(child.fields)) {
          fields[k] = reg.value
        }
        result.push({ id: child.id, fields })
        traverse(child.id)
      }
    }

    traverse(null)
    return result
  }

  /** Get all items including metadata (for snapshots) */
  getItems(): ListItem[] {
    return Array.from(this.items.values())
  }

  /** Initialize from items snapshot */
  loadItems(items: ListItem[]): void {
    this.items.clear()
    for (const item of items) {
      this.items.set(item.id, { ...item, fields: { ...item.fields } })
    }
  }
}

// ─── Apply any operation to the appropriate CRDT ─────────────────────

export interface CRDTStore {
  maps: Map<string, CRDTMap>
  lists: Map<string, CRDTList>
}

export function createStore(): CRDTStore {
  return { maps: new Map(), lists: new Map() }
}

export function getOrCreateMap(store: CRDTStore, docId: string): CRDTMap {
  let crdt = store.maps.get(docId)
  if (!crdt) {
    crdt = new CRDTMap()
    store.maps.set(docId, crdt)
  }
  return crdt
}

export function getOrCreateList(store: CRDTStore, docId: string): CRDTList {
  let crdt = store.lists.get(docId)
  if (!crdt) {
    crdt = new CRDTList()
    store.lists.set(docId, crdt)
  }
  return crdt
}

/** Apply an operation to the store. Returns true if state changed. */
export function applyOp(store: CRDTStore, op: Operation): boolean {
  switch (op.type) {
    case 'map:set': {
      const crdt = getOrCreateMap(store, op.docId)
      return crdt.applySet(op.key, op.value, op.ts, op.clientId)
    }
    case 'map:del': {
      const crdt = getOrCreateMap(store, op.docId)
      return crdt.applyDel(op.key, op.ts, op.clientId)
    }
    case 'list:ins': {
      const crdt = getOrCreateList(store, op.docId)
      return crdt.insert(op.itemId, op.afterId, op.fields, op.ts, op.clientId)
    }
    case 'list:del': {
      const crdt = getOrCreateList(store, op.docId)
      return crdt.delete(op.itemId, op.ts, op.clientId)
    }
    case 'list-item:set': {
      const crdt = getOrCreateList(store, op.docId)
      return crdt.setItemField(op.itemId, op.key, op.value, op.ts, op.clientId)
    }
  }
}
