import type { FieldDef, FieldType, InferFields } from './types'

// ─── Schema Classes ──────────────────────────────────────────────────

export class SyncMapSchema<T = unknown> {
  readonly kind = 'map' as const
  readonly fields: Record<string, FieldDef>

  constructor(fields: Record<string, FieldDef>) {
    this.fields = fields
  }

  /** Validate a plain object against this schema */
  validate(data: Record<string, unknown>): boolean {
    for (const [key, def] of Object.entries(this.fields)) {
      const val = data[key]
      if (val === undefined) return false
      if (!matchesType(val, def.type)) return false
    }
    return true
  }

  /** Return default values for all fields */
  defaults(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, def] of Object.entries(this.fields)) {
      result[key] = defaultForType(def.type)
    }
    return result
  }

  // Carry phantom type
  declare _type: T
}

export class SyncListSchema<T = unknown> {
  readonly kind = 'list' as const
  readonly itemSchema: SyncMapSchema<T>

  constructor(itemSchema: SyncMapSchema<T>) {
    this.itemSchema = itemSchema
  }

  // Carry phantom type
  declare _type: T
}

// ─── Schema Builder ──────────────────────────────────────────────────

export const sync = {
  /** String field */
  string: (): FieldDef<string> => ({ type: 'string' }),

  /** Number field (also used for dates as timestamps) */
  number: (): FieldDef<number> => ({ type: 'number' }),

  /** Boolean field */
  boolean: (): FieldDef<boolean> => ({ type: 'boolean' }),

  /** Date field (stored as numeric timestamp) */
  date: (): FieldDef<number> => ({ type: 'number' }),

  /**
   * Define a collaborative map schema.
   *
   * ```ts
   * const Todo = sync.map({
   *   title: sync.string(),
   *   done: sync.boolean(),
   * })
   * ```
   */
  map: <F extends Record<string, FieldDef>>(
    fields: F,
  ): SyncMapSchema<InferFields<F>> => {
    return new SyncMapSchema<InferFields<F>>(fields)
  },

  /**
   * Define a collaborative list schema.
   *
   * ```ts
   * const TodoList = sync.list(Todo)
   * ```
   */
  list: <T>(itemSchema: SyncMapSchema<T>): SyncListSchema<T> => {
    return new SyncListSchema<T>(itemSchema)
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────

function matchesType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    default: return false
  }
}

function defaultForType(type: FieldType): unknown {
  switch (type) {
    case 'string': return ''
    case 'number': return 0
    case 'boolean': return false
    default: return null
  }
}
