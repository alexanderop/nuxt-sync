import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { CRDTList } from '../../../src/runtime/core/crdt'
import { shuffle, sortKeys } from './test-utils'

// ─── Arbitraries ──────────────────────────────────────────────────────

const clientId = fc.constantFrom('c1', 'c2', 'c3', 'c4', 'c5')
const ts = fc.nat({ max: 100 })
const fieldKey = fc.constantFrom('title', 'done', 'priority', 'label')
const fieldValue = fc.oneof(fc.string(), fc.integer(), fc.boolean())

// Generate a causally valid sequence of list operations:
// 1. Generate inserts first (all with afterId=null for commutativity)
// 2. Generate delete/setItemField ops referencing those itemIds
interface InsertOp {
  type: 'insert'
  itemId: string
  afterId: string | null
  fields: Record<string, unknown>
  ts: number
  clientId: string
}

interface DeleteOp {
  type: 'delete'
  itemId: string
  ts: number
  clientId: string
}

interface SetFieldOp {
  type: 'setField'
  itemId: string
  key: string
  value: unknown
  ts: number
  clientId: string
}

type ListOp = InsertOp | DeleteOp | SetFieldOp

/** Generate N insert ops all rooted at null (siblings) with unique itemIds */
function rootInsertsArb(count: number): fc.Arbitrary<InsertOp[]> {
  return fc.array(
    fc.record({
      fields: fc.record({ title: fieldValue, done: fc.boolean() }),
      ts,
      clientId,
    }),
    { minLength: count, maxLength: count },
  ).map(entries =>
    entries.map((e, i) => ({
      type: 'insert' as const,
      itemId: `item-${i}`,
      afterId: null,
      fields: e.fields,
      ts: e.ts,
      clientId: e.clientId,
    })),
  )
}

/** Generate a causally valid op sequence: inserts first, then mutations */
function causalOpsArb(
  insertCount: number,
  mutationCount: number,
): fc.Arbitrary<{ inserts: InsertOp[]; mutations: ListOp[] }> {
  return rootInsertsArb(insertCount).chain((inserts) => {
    const itemIds = inserts.map(i => i.itemId)

    const deleteArb: fc.Arbitrary<DeleteOp> = fc.record({
      type: fc.constant('delete' as const),
      itemId: fc.constantFrom(...itemIds),
      ts: fc.nat({ max: 100 }),
      clientId,
    })

    const setFieldArb: fc.Arbitrary<SetFieldOp> = fc.record({
      type: fc.constant('setField' as const),
      itemId: fc.constantFrom(...itemIds),
      key: fieldKey,
      value: fieldValue,
      ts: fc.nat({ max: 100 }),
      clientId,
    })

    const mutationArb = fc.oneof(deleteArb, setFieldArb)

    return fc
      .array(mutationArb, { minLength: 0, maxLength: mutationCount })
      .map(mutations => ({ inserts, mutations }))
  })
}

/** Generate a chain of inserts where each references the previous */
function chainedInsertsArb(count: number): fc.Arbitrary<InsertOp[]> {
  return fc.array(
    fc.record({ ts, clientId, fields: fc.record({ title: fieldValue }) }),
    { minLength: count, maxLength: count },
  ).map(entries => {
    const inserts: InsertOp[] = []
    for (let i = 0; i < entries.length; i++) {
      inserts.push({
        type: 'insert' as const,
        itemId: `chain-${i}`,
        afterId: i === 0 ? null : `chain-${i - 1}`,
        fields: entries[i].fields,
        ts: entries[i].ts,
        clientId: entries[i].clientId,
      })
    }
    return inserts
  })
}

// ─── Preconditions ────────────────────────────────────────────────────

/**
 * toArray() sorts siblings by (ts, clientId). When two items share the same
 * (afterId, ts, clientId), sort returns 0 and order depends on Map insertion
 * order — breaking commutativity. In practice, concurrent inserts always
 * come from different clients or at different timestamps.
 */
function hasUniqueSortKeys(inserts: InsertOp[]): boolean {
  const seen = new Set<string>()
  for (const ins of inserts) {
    const k = `${ins.afterId}:${ins.ts}:${ins.clientId}`
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/**
 * LWW field updates are commutative only when each (itemId, key, ts, clientId)
 * tuple is unique — including the initial field values set during insert.
 * A setField with the same (ts, clientId) as the insert's field is ambiguous.
 */
function hasUniqueFieldVersions(
  inserts: InsertOp[],
  ops: ListOp[],
): boolean {
  const seen = new Set<string>()

  // Register initial field versions from inserts
  for (const ins of inserts) {
    for (const fieldKey of Object.keys(ins.fields)) {
      seen.add(`${ins.itemId}:${fieldKey}:${ins.ts}:${ins.clientId}`)
    }
  }

  // Check setField ops don't collide with inserts or each other
  for (const op of ops) {
    if (op.type !== 'setField') continue
    const k = `${op.itemId}:${op.key}:${op.ts}:${op.clientId}`
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

// ─── Helpers ──────────────────────────────────────────────────────────

function applyListOp(crdt: CRDTList, op: ListOp): boolean {
  switch (op.type) {
    case 'insert':
      return crdt.insert(op.itemId, op.afterId, op.fields, op.ts, op.clientId)
    case 'delete':
      return crdt.delete(op.itemId, op.ts, op.clientId)
    case 'setField':
      return crdt.setItemField(op.itemId, op.key, op.value, op.ts, op.clientId)
  }
}

function applyAllListOps(ops: ListOp[]): CRDTList {
  const crdt = new CRDTList()
  for (const op of ops) applyListOp(crdt, op)
  return crdt
}

function toArrayIds(crdt: CRDTList): string[] {
  return crdt.toArray().map(i => i.id)
}

function toArraySnapshot(crdt: CRDTList): string {
  // Sort field keys for order-independent comparison — field insertion order
  // in the underlying object depends on op application order, but values converge.
  const items = crdt.toArray().map(item => ({
    id: item.id,
    fields: sortKeys(item.fields),
  }))
  return JSON.stringify(items)
}

// ─── Properties ───────────────────────────────────────────────────────

describe('CRDTList property-based tests', () => {
  it('insert commutativity — root sibling inserts in any order produce same toArray', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }).chain(n => rootInsertsArb(n)),
        fc.nat(),
        (inserts, seed) => {
          fc.pre(hasUniqueSortKeys(inserts))
          const forward = applyAllListOps(inserts)
          const shuffled = shuffle(inserts, seed)
          const reversed = applyAllListOps(shuffled)

          expect(toArrayIds(forward)).toEqual(toArrayIds(reversed))
        },
      ),
      { numRuns: 500, seed: 42 },
    )
  })

  it('insert + field update commutativity — inserts in order, field updates shuffled converge', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }).chain(n => causalOpsArb(n, 15)),
        fc.nat(),
        ({ inserts, mutations }, seed) => {
          // Filter to only setField mutations for this test
          const setFieldOps = mutations.filter(m => m.type === 'setField')
          fc.pre(hasUniqueFieldVersions(inserts, setFieldOps))

          // Replica 1: inserts in order, then setFields in original order
          const crdt1 = new CRDTList()
          for (const ins of inserts) applyListOp(crdt1, ins)
          for (const op of setFieldOps) applyListOp(crdt1, op)

          // Replica 2: inserts in order, then setFields shuffled
          const crdt2 = new CRDTList()
          for (const ins of inserts) applyListOp(crdt2, ins)
          for (const op of shuffle(setFieldOps, seed)) applyListOp(crdt2, op)

          expect(toArraySnapshot(crdt1)).toBe(toArraySnapshot(crdt2))
        },
      ),
      { numRuns: 300, seed: 42 },
    )
  })

  it('idempotency of insert — same itemId inserted twice is rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain(n => rootInsertsArb(n)),
        (inserts) => {
          const crdt = new CRDTList()

          // Apply all inserts
          for (const ins of inserts) {
            const first = applyListOp(crdt, ins)
            expect(first).toBe(true)
          }
          const stateAfterFirst = toArraySnapshot(crdt)

          // Apply all inserts again — all should be rejected
          for (const ins of inserts) {
            const second = applyListOp(crdt, ins)
            expect(second).toBe(false)
          }
          expect(toArraySnapshot(crdt)).toBe(stateAfterFirst)
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('idempotency of setItemField — same update applied twice produces same state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }).chain(n => causalOpsArb(n, 10)),
        ({ inserts, mutations }) => {
          const setFieldOps = mutations.filter(m => m.type === 'setField')

          const once = new CRDTList()
          for (const ins of inserts) applyListOp(once, ins)
          for (const op of setFieldOps) applyListOp(once, op)
          const stateOnce = toArraySnapshot(once)

          const twice = new CRDTList()
          for (const ins of inserts) applyListOp(twice, ins)
          for (const op of setFieldOps) {
            applyListOp(twice, op)
            applyListOp(twice, op) // Apply again
          }
          expect(toArraySnapshot(twice)).toBe(stateOnce)
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('delete irreversibility — setItemField on deleted item always returns false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }).chain(n => causalOpsArb(n, 10)),
        ({ inserts, mutations }) => {
          const crdt = new CRDTList()

          // Apply all inserts
          for (const ins of inserts) applyListOp(crdt, ins)

          // Apply all delete mutations
          const deleteOps = mutations.filter(m => m.type === 'delete')
          for (const op of deleteOps) applyListOp(crdt, op)

          // Collect actually-deleted itemIds
          const deletedIds = new Set<string>()
          for (const item of crdt.getItems()) {
            if (item.deleted) deletedIds.add(item.id)
          }

          // setItemField on any deleted item must return false
          for (const id of deletedIds) {
            const result = crdt.setItemField(id, 'title', 'revived', 999, 'c5')
            expect(result).toBe(false)
          }
        },
      ),
      { numRuns: 300, seed: 42 },
    )
  })

  it('orphan invariant — deleted parent excludes descendants from toArray', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }).chain(n => chainedInsertsArb(n)),
        (inserts) => {
          const crdt = new CRDTList()

          // Apply all chained inserts (chain-0 → chain-1 → chain-2 → ...)
          for (const ins of inserts) applyListOp(crdt, ins)

          // Delete the root (chain-0) — must use a ts > insertion ts for it to work
          const rootInsert = inserts[0]
          crdt.delete('chain-0', rootInsert.ts + 1, 'c5')

          // All items in the chain should be excluded from toArray
          // (chain-0 is deleted; chain-1+ are orphaned since their parent chain is broken)
          const visibleIds = toArrayIds(crdt)
          expect(visibleIds).not.toContain('chain-0')

          // If chain-1's afterId is chain-0 (deleted), chain-1 is orphaned
          // DFS starts from null, so chain-1 (afterId=chain-0) becomes unreachable
          for (let i = 1; i < inserts.length; i++) {
            if (inserts[i].afterId !== null) {
              // This item's parent is in the chain — if chain-0 is deleted,
              // the entire subtree rooted at chain-0 is orphaned
              expect(visibleIds).not.toContain(`chain-${i}`)
            }
          }
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('toArray determinism — same items always produce same output regardless of insertion order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }).chain(n => rootInsertsArb(n)),
        fc.nat(),
        fc.nat(),
        (inserts, seed1, seed2) => {
          fc.pre(hasUniqueSortKeys(inserts))
          const shuffled1 = shuffle(inserts, seed1)
          const shuffled2 = shuffle(inserts, seed2)

          const crdt1 = applyAllListOps(shuffled1)
          const crdt2 = applyAllListOps(shuffled2)

          expect(toArraySnapshot(crdt1)).toBe(toArraySnapshot(crdt2))
        },
      ),
      { numRuns: 500, seed: 42 },
    )
  })

  it('state snapshot roundtrip — getItems/loadItems then apply more ops converges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain(n => causalOpsArb(n, 10)),
        ({ inserts, mutations }) => {
          // Direct: apply all inserts then all mutations
          const direct = new CRDTList()
          for (const ins of inserts) applyListOp(direct, ins)
          for (const m of mutations) applyListOp(direct, m)

          // Roundtrip: apply inserts, snapshot, load, then mutations
          const partial = new CRDTList()
          for (const ins of inserts) applyListOp(partial, ins)
          const snapshot = partial.getItems()

          const restored = new CRDTList()
          restored.loadItems(snapshot)
          for (const m of mutations) applyListOp(restored, m)

          expect(toArraySnapshot(restored)).toBe(toArraySnapshot(direct))
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('multi-replica convergence — 3 replicas with shuffled non-insert ops converge', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }).chain(n => causalOpsArb(n, 15)),
        fc.nat(),
        ({ inserts, mutations }, seed) => {
          fc.pre(hasUniqueFieldVersions(inserts, mutations))
          const replicas: CRDTList[] = []

          for (let r = 0; r < 3; r++) {
            const crdt = new CRDTList()
            // Inserts must be in causal order
            for (const ins of inserts) applyListOp(crdt, ins)
            // Mutations are shuffled differently per replica
            const shuffled = shuffle(mutations, seed + r * 7919)
            for (const m of shuffled) applyListOp(crdt, m)
            replicas.push(crdt)
          }

          const expected = toArraySnapshot(replicas[0])
          for (let r = 1; r < replicas.length; r++) {
            expect(toArraySnapshot(replicas[r])).toBe(expected)
          }
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('concurrent insert + delete convergence — replicas agree on surviving items', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }).chain(n =>
          rootInsertsArb(n).chain(inserts => {
            const itemIds = inserts.map(i => i.itemId)
            return fc
              .array(
                fc.record({
                  type: fc.constant('delete' as const),
                  itemId: fc.constantFrom(...itemIds),
                  ts: fc.nat({ max: 100 }),
                  clientId,
                }),
                { minLength: 1, maxLength: n },
              )
              .map(deletes => ({ inserts, deletes }))
          }),
        ),
        fc.nat(),
        ({ inserts, deletes }, seed) => {
          // Replica 1: inserts then deletes
          const crdt1 = new CRDTList()
          for (const ins of inserts) applyListOp(crdt1, ins)
          for (const del of deletes) applyListOp(crdt1, del)

          // Replica 2: inserts then deletes in shuffled order
          const crdt2 = new CRDTList()
          for (const ins of inserts) applyListOp(crdt2, ins)
          for (const del of shuffle(deletes, seed)) applyListOp(crdt2, del)

          expect(toArrayIds(crdt1)).toEqual(toArrayIds(crdt2))
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })
})
