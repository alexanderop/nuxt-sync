// ─── Field & Schema Types ────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean'

export interface FieldDef<T = unknown> {
  type: FieldType
  /** Phantom type carrier for inference */
  _t?: T
}

/** Infer the JS type from a field definition record */
export type InferFields<F extends Record<string, FieldDef>> = {
  [K in keyof F]: F[K] extends FieldDef<infer T> ? T : never
}

// ─── CRDT Register (per-field metadata) ──────────────────────────────

export interface Register<T = unknown> {
  value: T
  ts: number
  clientId: string
}

// ─── Map CRDT State ──────────────────────────────────────────────────

export type MapState = Record<string, Register>

// ─── List CRDT State ─────────────────────────────────────────────────

export interface ListItem {
  id: string
  afterId: string | null
  /** Each list item is a map — stores the Register per field */
  fields: MapState
  ts: number
  clientId: string
  deleted: boolean
}

// ─── Operations ──────────────────────────────────────────────────────

export interface MapSetOp {
  type: 'map:set'
  id: string
  docId: string
  key: string
  value: unknown
  ts: number
  clientId: string
}

export interface MapDelOp {
  type: 'map:del'
  id: string
  docId: string
  key: string
  ts: number
  clientId: string
}

export interface ListInsertOp {
  type: 'list:ins'
  id: string
  docId: string
  itemId: string
  afterId: string | null
  fields: Record<string, unknown>
  ts: number
  clientId: string
}

export interface ListDeleteOp {
  type: 'list:del'
  id: string
  docId: string
  itemId: string
  ts: number
  clientId: string
}

export interface ListItemSetOp {
  type: 'list-item:set'
  id: string
  docId: string
  itemId: string
  key: string
  value: unknown
  ts: number
  clientId: string
}

export type Operation =
  | MapSetOp
  | MapDelOp
  | ListInsertOp
  | ListDeleteOp
  | ListItemSetOp

// ─── Sync Protocol Messages ──────────────────────────────────────────

export interface SubscribeMsg {
  type: 'sub'
  docId: string
}

export interface UnsubscribeMsg {
  type: 'unsub'
  docId: string
}

export interface SnapshotMsg {
  type: 'snapshot'
  docId: string
  docType: 'map' | 'list'
  ops: Operation[]
}

export interface OpMsg {
  type: 'op'
  op: Operation
}

export interface AckMsg {
  type: 'ack'
  opId: string
}

export interface ErrorMsg {
  type: 'error'
  message: string
}

export type ClientMessage = SubscribeMsg | UnsubscribeMsg | OpMsg
export type ServerMessage = SnapshotMsg | OpMsg | AckMsg | ErrorMsg

// ─── Status ──────────────────────────────────────────────────────────

export type SyncStatus = 'connecting' | 'loading' | 'ready' | 'error'
