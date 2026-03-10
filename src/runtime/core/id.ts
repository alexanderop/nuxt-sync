let counter = 0

/**
 * Generate a short, collision-resistant ID.
 * Uses crypto.randomUUID when available, falls back to timestamp + counter.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Generate a document-scoped ID with a prefix */
export function docId(prefix = 'doc'): string {
  return `${prefix}_${generateId()}`
}
