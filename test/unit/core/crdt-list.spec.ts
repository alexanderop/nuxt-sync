import { describe, it, expect, beforeEach } from 'vitest'
import { CRDTList } from '../../../src/runtime/core/crdt'

describe('CRDTList', () => {
  let crdt: CRDTList

  beforeEach(() => {
    crdt = new CRDTList()
  })

  describe('insert', () => {
    it('inserts an item at the root (afterId=null)', () => {
      const changed = crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      expect(changed).toBe(true)

      const items = crdt.toArray()
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({ id: 'item-1', fields: { title: 'First' } })
    })

    it('rejects duplicate inserts', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      const changed = crdt.insert('item-1', null, { title: 'Duplicate' }, 2, 'c')
      expect(changed).toBe(false)

      const items = crdt.toArray()
      expect(items).toHaveLength(1)
      expect(items[0].fields.title).toBe('First')
    })

    it('inserts after a specific item', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'Second' }, 2, 'c')

      const items = crdt.toArray()
      expect(items).toHaveLength(2)
      expect(items[0].fields.title).toBe('First')
      expect(items[1].fields.title).toBe('Second')
    })

    it('preserves insert fields as LWW registers', () => {
      crdt.insert('item-1', null, { title: 'Hello', done: false }, 10, 'client-a')

      const rawItems = crdt.getItems()
      expect(rawItems[0].fields.title).toEqual({
        value: 'Hello',
        ts: 10,
        clientId: 'client-a',
      })
    })
  })

  describe('delete', () => {
    it('marks an item as deleted', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      const changed = crdt.delete('item-1', 2, 'c')
      expect(changed).toBe(true)
      expect(crdt.toArray()).toHaveLength(0)
    })

    it('returns false for non-existent item', () => {
      const changed = crdt.delete('missing', 1, 'c')
      expect(changed).toBe(false)
    })

    it('returns false for already-deleted item', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      crdt.delete('item-1', 2, 'c')
      const changed = crdt.delete('item-1', 3, 'c')
      expect(changed).toBe(false)
    })

    it('deleted items are excluded from toArray', () => {
      crdt.insert('item-1', null, { title: 'A' }, 1, 'c')
      crdt.insert('item-2', null, { title: 'B' }, 2, 'c')
      crdt.insert('item-3', null, { title: 'C' }, 3, 'c')
      crdt.delete('item-2', 4, 'c')

      const items = crdt.toArray()
      expect(items).toHaveLength(2)
      expect(items.map(i => i.fields.title)).toEqual(['A', 'C'])
    })

    it('deleting a parent orphans its children in linked list', () => {
      // This is by design — children of a deleted item become unreachable
      crdt.insert('item-1', null, { title: 'Parent' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'Child' }, 2, 'c')
      crdt.delete('item-1', 3, 'c')

      const items = crdt.toArray()
      // Child becomes orphaned because parent is deleted and DFS can't reach it
      expect(items).toHaveLength(0)
    })
  })

  describe('setItemField', () => {
    it('updates a field on an existing item', () => {
      crdt.insert('item-1', null, { title: 'Old', done: false }, 1, 'c')
      const changed = crdt.setItemField('item-1', 'title', 'New', 2, 'c')
      expect(changed).toBe(true)

      const items = crdt.toArray()
      expect(items[0].fields.title).toBe('New')
    })

    it('rejects update with older timestamp (LWW)', () => {
      crdt.insert('item-1', null, { title: 'Current' }, 5, 'c')
      const changed = crdt.setItemField('item-1', 'title', 'Old', 3, 'c')
      expect(changed).toBe(false)

      const items = crdt.toArray()
      expect(items[0].fields.title).toBe('Current')
    })

    it('returns false for non-existent item', () => {
      const changed = crdt.setItemField('missing', 'title', 'val', 1, 'c')
      expect(changed).toBe(false)
    })

    it('returns false for deleted item', () => {
      crdt.insert('item-1', null, { title: 'Hello' }, 1, 'c')
      crdt.delete('item-1', 2, 'c')
      const changed = crdt.setItemField('item-1', 'title', 'Updated', 3, 'c')
      expect(changed).toBe(false)
    })

    it('breaks ties with clientId', () => {
      crdt.insert('item-1', null, { title: 'Init' }, 1, 'alpha')
      crdt.setItemField('item-1', 'title', 'Beta', 5, 'beta')
      crdt.setItemField('item-1', 'title', 'Alpha', 5, 'alpha')

      const items = crdt.toArray()
      expect(items[0].fields.title).toBe('Beta')
    })
  })

  describe('toArray ordering', () => {
    it('orders by timestamp ASC', () => {
      crdt.insert('item-b', null, { title: 'B' }, 2, 'c')
      crdt.insert('item-a', null, { title: 'A' }, 1, 'c')
      crdt.insert('item-c', null, { title: 'C' }, 3, 'c')

      const items = crdt.toArray()
      expect(items.map(i => i.fields.title)).toEqual(['A', 'B', 'C'])
    })

    it('breaks timestamp ties with clientId ASC', () => {
      crdt.insert('item-b', null, { title: 'B' }, 1, 'client-b')
      crdt.insert('item-a', null, { title: 'A' }, 1, 'client-a')

      const items = crdt.toArray()
      expect(items.map(i => i.fields.title)).toEqual(['A', 'B'])
    })

    it('handles nested inserts (afterId chains)', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'Second' }, 2, 'c')
      crdt.insert('item-3', 'item-2', { title: 'Third' }, 3, 'c')

      const items = crdt.toArray()
      expect(items.map(i => i.fields.title)).toEqual(['First', 'Second', 'Third'])
    })

    it('handles branching inserts (multiple items after same parent)', () => {
      crdt.insert('item-1', null, { title: 'Root' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'Branch A' }, 2, 'c')
      crdt.insert('item-3', 'item-1', { title: 'Branch B' }, 3, 'c')

      const items = crdt.toArray()
      expect(items[0].fields.title).toBe('Root')
      // Branch A (ts=2) comes before Branch B (ts=3) — ASC order
      expect(items[1].fields.title).toBe('Branch A')
      expect(items[2].fields.title).toBe('Branch B')
    })

    it('returns empty array for empty list', () => {
      expect(crdt.toArray()).toEqual([])
    })

    it('returns empty array when all items are deleted', () => {
      crdt.insert('item-1', null, { title: 'A' }, 1, 'c')
      crdt.delete('item-1', 2, 'c')
      expect(crdt.toArray()).toEqual([])
    })
  })

  describe('getItems / loadItems', () => {
    it('returns all items including deleted', () => {
      crdt.insert('item-1', null, { title: 'A' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'B' }, 2, 'c')
      crdt.delete('item-1', 3, 'c')

      const items = crdt.getItems()
      expect(items).toHaveLength(2)
      expect(items.find(i => i.id === 'item-1')!.deleted).toBe(true)
      expect(items.find(i => i.id === 'item-2')!.deleted).toBe(false)
    })

    it('roundtrips through getItems/loadItems', () => {
      crdt.insert('item-1', null, { title: 'First' }, 1, 'c')
      crdt.insert('item-2', 'item-1', { title: 'Second' }, 2, 'c')
      crdt.setItemField('item-1', 'title', 'Updated', 3, 'c')

      const items = crdt.getItems()
      const crdt2 = new CRDTList()
      crdt2.loadItems(items)

      expect(crdt2.toArray()).toEqual(crdt.toArray())
    })

    it('loadItems clears previous data', () => {
      crdt.insert('old', null, { x: 1 }, 1, 'c')
      crdt.loadItems([
        {
          id: 'new',
          afterId: null,
          fields: { x: { value: 2, ts: 1, clientId: 'c' } },
          ts: 1,
          clientId: 'c',
          deleted: false,
        },
      ])

      const items = crdt.toArray()
      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('new')
    })
  })

  describe('convergence', () => {
    it('converges with concurrent inserts from different clients', () => {
      const crdt1 = new CRDTList()
      const crdt2 = new CRDTList()

      // Both clients insert after root
      const ops = [
        { itemId: 'a', afterId: null, fields: { title: 'A' }, ts: 1, clientId: 'client-a' },
        { itemId: 'b', afterId: null, fields: { title: 'B' }, ts: 1, clientId: 'client-b' },
      ] as const

      // Apply in different orders
      crdt1.insert(ops[0].itemId, ops[0].afterId, ops[0].fields, ops[0].ts, ops[0].clientId)
      crdt1.insert(ops[1].itemId, ops[1].afterId, ops[1].fields, ops[1].ts, ops[1].clientId)

      crdt2.insert(ops[1].itemId, ops[1].afterId, ops[1].fields, ops[1].ts, ops[1].clientId)
      crdt2.insert(ops[0].itemId, ops[0].afterId, ops[0].fields, ops[0].ts, ops[0].clientId)

      // Both should produce the same order
      expect(crdt1.toArray().map(i => i.id)).toEqual(crdt2.toArray().map(i => i.id))
    })

    it('converges with concurrent field updates', () => {
      const crdt1 = new CRDTList()
      const crdt2 = new CRDTList()

      // Both start with the same item
      crdt1.insert('item', null, { title: 'Init' }, 1, 'c')
      crdt2.insert('item', null, { title: 'Init' }, 1, 'c')

      // Concurrent updates
      crdt1.setItemField('item', 'title', 'FromA', 5, 'client-a')
      crdt1.setItemField('item', 'title', 'FromB', 5, 'client-b')

      crdt2.setItemField('item', 'title', 'FromB', 5, 'client-b')
      crdt2.setItemField('item', 'title', 'FromA', 5, 'client-a')

      // Both converge (client-b > client-a)
      expect(crdt1.toArray()[0].fields.title).toBe('FromB')
      expect(crdt2.toArray()[0].fields.title).toBe('FromB')
    })
  })
})
