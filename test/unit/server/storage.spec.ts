import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryStorage, type SyncStorage } from '../../../src/runtime/server/utils/storage'
import type { Operation } from '../../../src/runtime/core/types'

function makeOp(overrides: Partial<Operation> & { type: Operation['type'] }): Operation {
  const base = {
    id: `op-${Math.random().toString(36).slice(2)}`,
    docId: 'doc-1',
    ts: Date.now(),
    clientId: 'client-a',
  }

  switch (overrides.type) {
    case 'map:set':
      return { ...base, key: 'key', value: 'val', ...overrides } as Operation
    case 'map:del':
      return { ...base, key: 'key', ...overrides } as Operation
    case 'list:ins':
      return { ...base, itemId: 'item-1', afterId: null, fields: {}, ...overrides } as Operation
    case 'list:del':
      return { ...base, itemId: 'item-1', ...overrides } as Operation
    case 'list-item:set':
      return { ...base, itemId: 'item-1', key: 'key', value: 'val', ...overrides } as Operation
  }
}

describe('createMemoryStorage', () => {
  let storage: SyncStorage

  beforeEach(async () => {
    storage = createMemoryStorage()
    await storage.initialize()
  })

  describe('initialize', () => {
    it('initializes without error', async () => {
      const s = createMemoryStorage()
      await expect(s.initialize()).resolves.toBeUndefined()
    })
  })

  describe('saveOperation / getOperations', () => {
    it('saves and retrieves operations', async () => {
      const op = makeOp({ type: 'map:set', docId: 'doc-1', key: 'title', value: 'Hello' })
      await storage.saveOperation(op)

      const ops = await storage.getOperations('doc-1')
      expect(ops).toHaveLength(1)
      expect(ops[0]).toEqual(op)
    })

    it('returns empty array for unknown docId', async () => {
      const ops = await storage.getOperations('unknown')
      expect(ops).toEqual([])
    })

    it('stores operations per document', async () => {
      const op1 = makeOp({ type: 'map:set', docId: 'doc-1', key: 'a', value: 1 })
      const op2 = makeOp({ type: 'map:set', docId: 'doc-2', key: 'b', value: 2 })
      const op3 = makeOp({ type: 'map:set', docId: 'doc-1', key: 'c', value: 3 })

      await storage.saveOperation(op1)
      await storage.saveOperation(op2)
      await storage.saveOperation(op3)

      const doc1Ops = await storage.getOperations('doc-1')
      expect(doc1Ops).toHaveLength(2)

      const doc2Ops = await storage.getOperations('doc-2')
      expect(doc2Ops).toHaveLength(1)
    })

    it('preserves operation order', async () => {
      const op1 = makeOp({ type: 'map:set', id: 'first', docId: 'doc-1', key: 'a', value: 1 })
      const op2 = makeOp({ type: 'map:set', id: 'second', docId: 'doc-1', key: 'b', value: 2 })
      const op3 = makeOp({ type: 'map:set', id: 'third', docId: 'doc-1', key: 'c', value: 3 })

      await storage.saveOperation(op1)
      await storage.saveOperation(op2)
      await storage.saveOperation(op3)

      const ops = await storage.getOperations('doc-1')
      expect(ops.map(o => (o as any).id)).toEqual(['first', 'second', 'third'])
    })

    it('handles all operation types', async () => {
      const ops: Operation[] = [
        makeOp({ type: 'map:set', key: 'title', value: 'Test' }),
        makeOp({ type: 'map:del', key: 'title' }),
        makeOp({ type: 'list:ins', itemId: 'i1', afterId: null, fields: { x: 1 } }),
        makeOp({ type: 'list:del', itemId: 'i1' }),
        makeOp({ type: 'list-item:set', itemId: 'i1', key: 'x', value: 2 }),
      ]

      for (const op of ops) {
        await storage.saveOperation(op)
      }

      const stored = await storage.getOperations('doc-1')
      expect(stored).toHaveLength(5)
      expect(stored.map(o => o.type)).toEqual([
        'map:set', 'map:del', 'list:ins', 'list:del', 'list-item:set',
      ])
    })
  })

  describe('getAllDocIds', () => {
    it('returns empty array when no operations stored', async () => {
      const ids = await storage.getAllDocIds()
      expect(ids).toEqual([])
    })

    it('returns all unique document IDs', async () => {
      await storage.saveOperation(makeOp({ type: 'map:set', docId: 'doc-a' }))
      await storage.saveOperation(makeOp({ type: 'map:set', docId: 'doc-b' }))
      await storage.saveOperation(makeOp({ type: 'map:set', docId: 'doc-a' }))

      const ids = await storage.getAllDocIds()
      expect(ids.sort()).toEqual(['doc-a', 'doc-b'])
    })
  })
})
