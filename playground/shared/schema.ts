import { sync } from '../../src/runtime/core/schema'

// ─── Schema Definitions ──────────────────────────────────────────────
// These are shared between client and server.
// Each schema defines the shape of a collaborative document.

/** A single todo item */
export const TodoSchema = sync.map({
  title: sync.string(),
  done: sync.boolean(),
  createdAt: sync.number(),
})

/** A list of todo items */
export const TodoListSchema = sync.list(TodoSchema)

// Type helpers (for use in components)
export type Todo = typeof TodoSchema._type
export type TodoList = typeof TodoListSchema._type
