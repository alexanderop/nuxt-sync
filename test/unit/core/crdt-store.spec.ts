import { describe, it, expect } from 'vitest'
import {
  createStore,
  getOrCreateMap,
  getOrCreateList,
  applyOp,
  CRDTMap,
  CRDTList,
} from '../../../src/runtime/core/crdt'
import type { Operation } from '../../../src/runtime/core/types'

describe('CRDTStore', () => {
  describe('createStore', () => {
    it('creates an empty store', () => {
      const store = createStore()
      expect(store.maps.size).toBe(0)
      expect(store.lists.size).toBe(0)
    })
  })

  describe('getOrCreateMap', () => {
    it('creates a new CRDTMap for unknown docId', () => {
      const store = createStore()
      const map = getOrCreateMap(store, 'doc-1')
      expect(map).toBeInstanceOf(CRDTMap)
      expect(store.maps.size).toBe(1)
    })

    it('returns existing CRDTMap for known docId', () => {
      const store = createStore()
      const map1 = getOrCreateMap(store, 'doc-1')
      const map2 = getOrCreateMap(store, 'doc-1')
      expect(map1).toBe(map2)
      expect(store.maps.size).toBe(1)
    })

    it('creates separate maps for different docIds', () => {
      const store = createStore()
      const map1 = getOrCreateMap(store, 'doc-1')
      const map2 = getOrCreateMap(store, 'doc-2')
      expect(map1).not.toBe(map2)
      expect(store.maps.size).toBe(2)
    })
  })

  describe('getOrCreateList', () => {
    it('creates a new CRDTList for unknown docId', () => {
      const store = createStore()
      const list = getOrCreateList(store, 'list-1')
      expect(list).toBeInstanceOf(CRDTList)
      expect(store.lists.size).toBe(1)
    })

    it('returns existing CRDTList for known docId', () => {
      const store = createStore()
      const list1 = getOrCreateList(store, 'list-1')
      const list2 = getOrCreateList(store, 'list-1')
      expect(list1).toBe(list2)
    })
  })

  describe('applyOp', () => {
    it('applies map:set operation', () => {
      const store = createStore()
      const op: Operation = {
        type: 'map:set',
        id: 'op-1',
        docId: 'doc-1',
        key: 'title',
        value: 'Hello',
        ts: 1,
        clientId: 'c',
      }

      const changed = applyOp(store, op)
      expect(changed).toBe(true)

      const map = getOrCreateMap(store, 'doc-1')
      expect(map.get('title')).toBe('Hello')
    })

    it('applies map:del operation', () => {
      const store = createStore()
      applyOp(store, {
        type: 'map:set',
        id: 'op-1',
        docId: 'doc-1',
        key: 'title',
        value: 'Hello',
        ts: 1,
        clientId: 'c',
      })

      const changed = applyOp(store, {
        type: 'map:del',
        id: 'op-2',
        docId: 'doc-1',
        key: 'title',
        ts: 2,
        clientId: 'c',
      })

      expect(changed).toBe(true)
      const map = getOrCreateMap(store, 'doc-1')
      expect(map.get('title')).toBeUndefined()
    })

    it('applies list:ins operation', () => {
      const store = createStore()
      const changed = applyOp(store, {
        type: 'list:ins',
        id: 'op-1',
        docId: 'list-1',
        itemId: 'item-1',
        afterId: null,
        fields: { title: 'First' },
        ts: 1,
        clientId: 'c',
      })

      expect(changed).toBe(true)
      const list = getOrCreateList(store, 'list-1')
      expect(list.toArray()).toHaveLength(1)
      expect(list.toArray()[0].fields.title).toBe('First')
    })

    it('applies list:del operation', () => {
      const store = createStore()
      applyOp(store, {
        type: 'list:ins',
        id: 'op-1',
        docId: 'list-1',
        itemId: 'item-1',
        afterId: null,
        fields: { title: 'First' },
        ts: 1,
        clientId: 'c',
      })

      const changed = applyOp(store, {
        type: 'list:del',
        id: 'op-2',
        docId: 'list-1',
        itemId: 'item-1',
        ts: 2,
        clientId: 'c',
      })

      expect(changed).toBe(true)
      const list = getOrCreateList(store, 'list-1')
      expect(list.toArray()).toHaveLength(0)
    })

    it('applies list-item:set operation', () => {
      const store = createStore()
      applyOp(store, {
        type: 'list:ins',
        id: 'op-1',
        docId: 'list-1',
        itemId: 'item-1',
        afterId: null,
        fields: { title: 'Old' },
        ts: 1,
        clientId: 'c',
      })

      const changed = applyOp(store, {
        type: 'list-item:set',
        id: 'op-2',
        docId: 'list-1',
        itemId: 'item-1',
        key: 'title',
        value: 'New',
        ts: 2,
        clientId: 'c',
      })

      expect(changed).toBe(true)
      const list = getOrCreateList(store, 'list-1')
      expect(list.toArray()[0].fields.title).toBe('New')
    })

    it('routes operations to correct document', () => {
      const store = createStore()

      applyOp(store, {
        type: 'map:set',
        id: 'op-1',
        docId: 'map-a',
        key: 'x',
        value: 1,
        ts: 1,
        clientId: 'c',
      })

      applyOp(store, {
        type: 'map:set',
        id: 'op-2',
        docId: 'map-b',
        key: 'x',
        value: 2,
        ts: 1,
        clientId: 'c',
      })

      expect(getOrCreateMap(store, 'map-a').get('x')).toBe(1)
      expect(getOrCreateMap(store, 'map-b').get('x')).toBe(2)
    })
  })
})
