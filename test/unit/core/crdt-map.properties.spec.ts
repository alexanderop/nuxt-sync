import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { CRDTMap } from '../../../src/runtime/core/crdt'
import { shuffle, sortKeys } from './test-utils'

// ─── Arbitraries ──────────────────────────────────────────────────────

const key = fc.constantFrom('a', 'b', 'c', 'd')
const clientId = fc.constantFrom('c1', 'c2', 'c3', 'c4', 'c5')
const ts = fc.nat({ max: 100 })
const value = fc.oneof(fc.string(), fc.integer(), fc.boolean())

type MapOp =
  | { type: 'set'; key: string; value: unknown; ts: number; clientId: string }
  | { type: 'del'; key: string; ts: number; clientId: string }

const mapOpArb: fc.Arbitrary<MapOp> = fc.oneof(
  fc.record({ type: fc.constant('set' as const), key, value, ts, clientId }),
  fc.record({ type: fc.constant('del' as const), key, ts, clientId }),
)

const mapOpsArb = fc.array(mapOpArb, { minLength: 1, maxLength: 30 })

// ─── Preconditions ────────────────────────────────────────────────────

/**
 * LWW commutativity requires a total order on versions. When two ops target
 * the same key with identical (ts, clientId), neither wins over the other
 * via lwwWins — the first-applied wins, breaking commutativity. In practice
 * a single client never emits two ops at the same timestamp, so we filter
 * these out.
 */
function hasUniqueVersionsPerKey(ops: MapOp[]): boolean {
  const seen = new Set<string>()
  for (const op of ops) {
    const k = `${op.key}:${op.ts}:${op.clientId}`
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

// ─── Helpers ──────────────────────────────────────────────────────────

function applyMapOp(crdt: CRDTMap, op: MapOp): boolean {
  if (op.type === 'set') return crdt.applySet(op.key, op.value, op.ts, op.clientId)
  return crdt.applyDel(op.key, op.ts, op.clientId)
}

function applyAll(ops: MapOp[]): CRDTMap {
  const crdt = new CRDTMap()
  for (const op of ops) applyMapOp(crdt, op)
  return crdt
}

function sortedStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj))
}

// ─── Properties ───────────────────────────────────────────────────────

describe('CRDTMap property-based tests', () => {
  it('commutativity — reversed order produces identical state', () => {
    fc.assert(
      fc.property(mapOpsArb, (ops) => {
        fc.pre(hasUniqueVersionsPerKey(ops))
        const forward = applyAll(ops)
        const backward = applyAll([...ops].reverse())
        expect(forward.toJSON()).toEqual(backward.toJSON())
        expect(forward.getState()).toEqual(backward.getState())
      }),
      { numRuns: 500, seed: 42 },
    )
  })

  it('commutativity — full shuffle across multiple replicas', () => {
    fc.assert(
      fc.property(mapOpsArb, fc.infiniteStream(fc.nat()), (ops, seeds) => {
        fc.pre(hasUniqueVersionsPerKey(ops))
        const replicaCount = 4
        const results: string[] = []

        for (let i = 0; i < replicaCount; i++) {
          const seed = seeds.next().value! + i * 1000
          const shuffled = shuffle(ops, seed)
          const crdt = applyAll(shuffled)
          results.push(sortedStringify(crdt.toJSON()))
        }

        // All replicas must agree
        for (let i = 1; i < results.length; i++) {
          expect(results[i]).toBe(results[0])
        }
      }),
      { numRuns: 200, seed: 42 },
    )
  })

  it('idempotency — applying each op twice produces same result as once', () => {
    fc.assert(
      fc.property(mapOpsArb, (ops) => {
        const once = applyAll(ops)
        const twice = new CRDTMap()
        for (const op of ops) {
          applyMapOp(twice, op)
          applyMapOp(twice, op) // Apply again
        }
        expect(twice.toJSON()).toEqual(once.toJSON())
        expect(twice.getState()).toEqual(once.getState())
      }),
      { numRuns: 500, seed: 42 },
    )
  })

  it('convergence under arbitrary interleaving — two client op lists merge to same state', () => {
    fc.assert(
      fc.property(mapOpsArb, mapOpsArb, (opsA, opsB) => {
        fc.pre(hasUniqueVersionsPerKey([...opsA, ...opsB]))
        // Interleaving 1: A then B
        const replica1 = applyAll([...opsA, ...opsB])
        // Interleaving 2: B then A
        const replica2 = applyAll([...opsB, ...opsA])

        expect(replica1.toJSON()).toEqual(replica2.toJSON())
        expect(replica1.getState()).toEqual(replica2.getState())
      }),
      { numRuns: 300, seed: 42 },
    )
  })

  it('tombstone resurrection prevention — set with lower ts after del does not resurrect', () => {
    fc.assert(
      fc.property(
        key,
        ts,
        clientId,
        fc.array(
          fc.record({
            value,
            ts: fc.nat({ max: 100 }),
            clientId,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (delKey, delTs, delClient, setOps) => {
          const crdt = new CRDTMap()
          // First set the key so there's something to delete
          crdt.applySet(delKey, 'initial', 0, 'c0')
          // Apply the delete
          crdt.applyDel(delKey, delTs, delClient)

          // Try to resurrect with strictly lower timestamps
          for (const op of setOps) {
            const lowerTs = op.ts % delTs // Guarantee ts < delTs
            if (lowerTs < delTs) {
              crdt.applySet(delKey, op.value, lowerTs, op.clientId)
            }
          }

          // Key must remain deleted (tombstone prevents resurrection)
          expect(crdt.get(delKey)).toBeUndefined()
        },
      ),
      { numRuns: 300, seed: 42 },
    )
  })

  it('state snapshot roundtrip stability — getState/loadState preserves semantics', () => {
    fc.assert(
      fc.property(mapOpsArb, mapOpsArb, (firstHalf, secondHalf) => {
        // Replica 1: apply all ops directly
        const direct = applyAll([...firstHalf, ...secondHalf])

        // Replica 2: apply first half, snapshot, load, apply second half
        const partial = applyAll(firstHalf)
        const state = partial.getState()
        const restored = new CRDTMap()
        restored.loadState(state)
        for (const op of secondHalf) applyMapOp(restored, op)

        expect(restored.toJSON()).toEqual(direct.toJSON())
        expect(restored.getState()).toEqual(direct.getState())
      }),
      { numRuns: 300, seed: 42 },
    )
  })

  it('deterministic tiebreaking — identical timestamps resolve by highest clientId', () => {
    fc.assert(
      fc.property(
        key,
        ts,
        fc.array(
          fc.record({ value, clientId }),
          { minLength: 2, maxLength: 10 },
        ),
        (k, sharedTs, entries) => {
          const crdt = new CRDTMap()
          for (const entry of entries) {
            crdt.applySet(k, entry.value, sharedTs, entry.clientId)
          }

          // The winner should be the entry with the highest clientId
          const winner = entries.reduce((best, cur) =>
            cur.clientId > best.clientId ? cur : best,
          )
          expect(crdt.get(k)).toBe(winner.value)
        },
      ),
      { numRuns: 200, seed: 42 },
    )
  })
})
