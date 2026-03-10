import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  createStore,
  applyOp,
  getOrCreateMap,
} from '../../../src/runtime/core/crdt'
import type { CRDTStore } from '../../../src/runtime/core/crdt'
import type { Operation } from '../../../src/runtime/core/types'
import { shuffle, sortKeys } from './test-utils'

// ─── Arbitraries ──────────────────────────────────────────────────────

const key = fc.constantFrom('a', 'b', 'c', 'd')
const clientId = fc.constantFrom('c1', 'c2', 'c3', 'c4', 'c5')
const ts = fc.nat({ max: 100 })
const value = fc.oneof(fc.string(), fc.integer(), fc.boolean())

const mapDocId = fc.constantFrom('map-1', 'map-2')
const listDocId = fc.constantFrom('list-1', 'list-2')

// Use fc.uuid() for op IDs — pure, no side effects, unique per generation
const opId = fc.uuid()

const mapSetOpArb: fc.Arbitrary<Operation> = fc.record({
  type: fc.constant('map:set' as const),
  id: opId,
  docId: mapDocId,
  key,
  value,
  ts,
  clientId,
})

const mapDelOpArb: fc.Arbitrary<Operation> = fc.record({
  type: fc.constant('map:del' as const),
  id: opId,
  docId: mapDocId,
  key,
  ts,
  clientId,
})

const mapOpArb = fc.oneof(mapSetOpArb, mapDelOpArb)

// For store tests, we pre-generate list inserts with unique itemIds per docId
// then reference those for delete and setItemField ops

function storeOpsArb(): fc.Arbitrary<Operation[]> {
  return fc
    .record({
      mapOps: fc.array(mapOpArb, { minLength: 0, maxLength: 15 }),
      listInsertCount: fc.integer({ min: 1, max: 8 }),
    })
    .chain(({ mapOps, listInsertCount }) => {
      const itemIds = Array.from(
        { length: listInsertCount },
        (_, i) => `store-item-${i}`,
      )

      return fc
        .tuple(
          fc.array(
            fc.record({
              docId: listDocId,
              ts,
              clientId,
              fields: fc.record({ title: value }),
            }),
            { minLength: listInsertCount, maxLength: listInsertCount },
          ),
          fc.array(
            fc.oneof(
              fc.record({
                type: fc.constant('list:del' as const),
                id: opId,
                docId: listDocId,
                itemId: fc.constantFrom(...itemIds),
                ts,
                clientId,
              }) as fc.Arbitrary<Operation>,
              fc.record({
                type: fc.constant('list-item:set' as const),
                id: opId,
                docId: listDocId,
                itemId: fc.constantFrom(...itemIds),
                key,
                value,
                ts,
                clientId,
              }) as fc.Arbitrary<Operation>,
            ),
            { minLength: 0, maxLength: 10 },
          ),
        )
        .map(([insertEntries, listMutations]) => {
          const insertOps: Operation[] = insertEntries.map((entry, i) => ({
            type: 'list:ins' as const,
            id: `ins-${i}`,
            docId: entry.docId,
            itemId: itemIds[i],
            afterId: null,
            fields: entry.fields,
            ts: entry.ts,
            clientId: entry.clientId,
          }))
          // List inserts first (causal order), then map ops + list mutations
          return [...insertOps, ...mapOps, ...listMutations]
        })
    })
}

// ─── Preconditions ────────────────────────────────────────────────────

/**
 * LWW commutativity requires unique (key, ts, clientId) per key within
 * each document. This checks map ops (map:set and map:del).
 */
function hasUniqueMapVersions(ops: Operation[]): boolean {
  const seen = new Set<string>()
  for (const op of ops) {
    if (op.type !== 'map:set' && op.type !== 'map:del') continue
    const k = `${op.docId}:${op.key}:${op.ts}:${op.clientId}`
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/**
 * List item field updates are commutative only when each
 * (docId, itemId, key, ts, clientId) is unique — including initial field
 * values from inserts.
 */
function hasUniqueListFieldVersions(allOps: Operation[]): boolean {
  const seen = new Set<string>()

  // Register initial field versions from inserts
  for (const op of allOps) {
    if (op.type !== 'list:ins') continue
    for (const fieldKey of Object.keys(op.fields)) {
      seen.add(`${op.docId}:${op.itemId}:${fieldKey}:${op.ts}:${op.clientId}`)
    }
  }

  // Check setField ops don't collide with inserts or each other
  for (const op of allOps) {
    if (op.type !== 'list-item:set') continue
    const k = `${op.docId}:${op.itemId}:${op.key}:${op.ts}:${op.clientId}`
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

// ─── Helpers ──────────────────────────────────────────────────────────

function storeSnapshot(store: CRDTStore): string {
  const result: Record<string, unknown> = {}

  // Maps — sort keys within each map's toJSON for deterministic comparison
  for (const [docId, map] of store.maps) {
    result[`map:${docId}`] = sortKeys(map.toJSON())
  }

  // Lists — sort field keys within each item for deterministic comparison
  for (const [docId, list] of store.lists) {
    result[`list:${docId}`] = list.toArray().map(item => ({
      id: item.id,
      fields: sortKeys(item.fields),
    }))
  }

  return JSON.stringify(sortKeys(result))
}

/** Full snapshot including internal register metadata */
function fullStoreSnapshot(store: CRDTStore): string {
  const result: Record<string, unknown> = {}

  for (const [docId, map] of store.maps) {
    result[`map:${docId}`] = map.getState()
  }

  for (const [docId, list] of store.lists) {
    result[`list:${docId}`] = list.getItems()
  }

  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(result).sort()) {
    sorted[k] = result[k]
  }
  return JSON.stringify(sorted)
}

function partitionInserts(
  ops: Operation[],
): { inserts: Operation[]; rest: Operation[] } {
  const inserts: Operation[] = []
  const rest: Operation[] = []
  for (const op of ops) {
    if (op.type === 'list:ins') inserts.push(op)
    else rest.push(op)
  }
  return { inserts, rest }
}

// ─── Properties ───────────────────────────────────────────────────────

describe('CRDTStore property-based tests', () => {
  it('cross-type commutativity — ops across maps and lists in different orders converge', () => {
    fc.assert(
      fc.property(storeOpsArb(), fc.nat(), (ops, seed) => {
        const { inserts, rest } = partitionInserts(ops)
        fc.pre(hasUniqueMapVersions(rest))
        fc.pre(hasUniqueListFieldVersions(ops))

        // Replica 1: inserts in order, rest in original order
        const store1 = createStore()
        for (const op of inserts) applyOp(store1, op)
        for (const op of rest) applyOp(store1, op)

        // Replica 2: inserts in order, rest shuffled
        const store2 = createStore()
        for (const op of inserts) applyOp(store2, op)
        for (const op of shuffle(rest, seed)) applyOp(store2, op)

        expect(storeSnapshot(store1)).toBe(storeSnapshot(store2))
      }),
      { numRuns: 300, seed: 42 },
    )
  })

  it('document isolation — ops on different docIds never affect each other', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constant('map:set' as const),
            id: opId,
            docId: fc.constant('doc-a'),
            key,
            value,
            ts,
            clientId,
          }) as fc.Arbitrary<Operation>,
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(
          fc.record({
            type: fc.constant('map:set' as const),
            id: opId,
            docId: fc.constant('doc-b'),
            key,
            value,
            ts,
            clientId,
          }) as fc.Arbitrary<Operation>,
          { minLength: 1, maxLength: 10 },
        ),
        (opsA, opsB) => {
          // Interleaved: all ops together
          const interleaved = createStore()
          for (const op of [...opsA, ...opsB]) applyOp(interleaved, op)

          // Separated: only ops for each doc
          const separatedA = createStore()
          for (const op of opsA) applyOp(separatedA, op)

          const separatedB = createStore()
          for (const op of opsB) applyOp(separatedB, op)

          // doc-a state must be identical whether ops were interleaved or not
          expect(
            getOrCreateMap(interleaved, 'doc-a').toJSON(),
          ).toEqual(
            getOrCreateMap(separatedA, 'doc-a').toJSON(),
          )

          // doc-b state must be identical
          expect(
            getOrCreateMap(interleaved, 'doc-b').toJSON(),
          ).toEqual(
            getOrCreateMap(separatedB, 'doc-b').toJSON(),
          )
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })

  it('multi-document multi-replica convergence — 3 replicas, ops across 3+ documents, all converge', () => {
    fc.assert(
      fc.property(storeOpsArb(), fc.nat(), (ops, seed) => {
        const { inserts, rest } = partitionInserts(ops)
        fc.pre(hasUniqueMapVersions(rest))
        fc.pre(hasUniqueListFieldVersions(ops))
        const replicas: CRDTStore[] = []

        for (let r = 0; r < 3; r++) {
          const store = createStore()
          // Inserts in causal order
          for (const op of inserts) applyOp(store, op)
          // Rest shuffled differently per replica
          for (const op of shuffle(rest, seed + r * 7919)) applyOp(store, op)
          replicas.push(store)
        }

        const expected = storeSnapshot(replicas[0])
        for (let r = 1; r < replicas.length; r++) {
          expect(storeSnapshot(replicas[r])).toBe(expected)
        }
      }),
      { numRuns: 200, seed: 42 },
    )
  })

  it('applyOp return value correctness — returns true iff internal state changed', () => {
    fc.assert(
      fc.property(
        fc.array(mapOpArb, { minLength: 1, maxLength: 20 }),
        (ops) => {
          const store = createStore()

          for (const op of ops) {
            // Use full snapshot (includes register metadata) to detect internal changes
            const before = fullStoreSnapshot(store)
            const result = applyOp(store, op)
            const after = fullStoreSnapshot(store)

            if (result) {
              // applyOp returned true → internal state must have changed
              expect(after).not.toBe(before)
            } else {
              // applyOp returned false → internal state must be unchanged
              expect(after).toBe(before)
            }
          }
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })
})
