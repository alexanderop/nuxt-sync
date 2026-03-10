import { describe, it, expect, beforeEach } from 'vitest'
import { CRDTMap } from '../../../src/runtime/core/crdt'

describe('CRDTMap', () => {
  let crdt: CRDTMap

  beforeEach(() => {
    crdt = new CRDTMap()
  })

  describe('applySet', () => {
    it('sets a value on an empty map', () => {
      const changed = crdt.applySet('title', 'Hello', 1, 'client-a')
      expect(changed).toBe(true)
      expect(crdt.get('title')).toBe('Hello')
    })

    it('overwrites with a newer timestamp', () => {
      crdt.applySet('title', 'Old', 1, 'client-a')
      const changed = crdt.applySet('title', 'New', 2, 'client-a')
      expect(changed).toBe(true)
      expect(crdt.get('title')).toBe('New')
    })

    it('rejects an older timestamp (LWW)', () => {
      crdt.applySet('title', 'New', 2, 'client-a')
      const changed = crdt.applySet('title', 'Old', 1, 'client-b')
      expect(changed).toBe(false)
      expect(crdt.get('title')).toBe('New')
    })

    it('breaks ties with clientId (higher wins)', () => {
      crdt.applySet('title', 'A', 1, 'client-a')
      const changed = crdt.applySet('title', 'B', 1, 'client-b')
      expect(changed).toBe(true)
      expect(crdt.get('title')).toBe('B')
    })

    it('rejects same-timestamp lower clientId', () => {
      crdt.applySet('title', 'B', 1, 'client-b')
      const changed = crdt.applySet('title', 'A', 1, 'client-a')
      expect(changed).toBe(false)
      expect(crdt.get('title')).toBe('B')
    })

    it('handles multiple keys independently', () => {
      crdt.applySet('title', 'Hello', 1, 'client-a')
      crdt.applySet('done', true, 1, 'client-a')
      expect(crdt.get('title')).toBe('Hello')
      expect(crdt.get('done')).toBe(true)
    })

    it('handles various value types', () => {
      crdt.applySet('str', 'text', 1, 'c')
      crdt.applySet('num', 42, 2, 'c')
      crdt.applySet('bool', false, 3, 'c')
      crdt.applySet('nil', null, 4, 'c')

      expect(crdt.get('str')).toBe('text')
      expect(crdt.get('num')).toBe(42)
      expect(crdt.get('bool')).toBe(false)
      expect(crdt.get('nil')).toBe(null)
    })
  })

  describe('applyDel', () => {
    it('deletes an existing key', () => {
      crdt.applySet('title', 'Hello', 1, 'client-a')
      const changed = crdt.applyDel('title', 2, 'client-a')
      expect(changed).toBe(true)
      expect(crdt.get('title')).toBeUndefined()
    })

    it('rejects delete with older timestamp', () => {
      crdt.applySet('title', 'Hello', 2, 'client-a')
      const changed = crdt.applyDel('title', 1, 'client-b')
      expect(changed).toBe(false)
      expect(crdt.get('title')).toBe('Hello')
    })

    it('can delete a non-existent key (no-op but returns true)', () => {
      const changed = crdt.applyDel('missing', 1, 'client-a')
      expect(changed).toBe(true)
      expect(crdt.get('missing')).toBeUndefined()
    })

    it('allows re-setting after delete with newer timestamp', () => {
      crdt.applySet('title', 'Hello', 1, 'client-a')
      crdt.applyDel('title', 2, 'client-a')
      const changed = crdt.applySet('title', 'Back', 3, 'client-a')
      expect(changed).toBe(true)
      expect(crdt.get('title')).toBe('Back')
    })
  })

  describe('get', () => {
    it('returns undefined for missing keys', () => {
      expect(crdt.get('missing')).toBeUndefined()
    })

    it('returns the current value', () => {
      crdt.applySet('x', 42, 1, 'c')
      expect(crdt.get('x')).toBe(42)
    })
  })

  describe('toJSON', () => {
    it('returns empty object for empty map', () => {
      expect(crdt.toJSON()).toEqual({})
    })

    it('returns all current values', () => {
      crdt.applySet('title', 'Hello', 1, 'c')
      crdt.applySet('done', false, 1, 'c')
      expect(crdt.toJSON()).toEqual({ title: 'Hello', done: false })
    })

    it('excludes deleted keys', () => {
      crdt.applySet('a', 1, 1, 'c')
      crdt.applySet('b', 2, 1, 'c')
      crdt.applyDel('a', 2, 'c')
      expect(crdt.toJSON()).toEqual({ b: 2 })
    })
  })

  describe('getState / loadState', () => {
    it('returns full register state', () => {
      crdt.applySet('title', 'Hello', 100, 'client-a')
      const state = crdt.getState()
      expect(state).toEqual({
        title: { value: 'Hello', ts: 100, clientId: 'client-a' },
      })
    })

    it('state is a copy (not a reference)', () => {
      crdt.applySet('title', 'Hello', 1, 'c')
      const state = crdt.getState()
      state.title.value = 'Modified'
      expect(crdt.get('title')).toBe('Hello')
    })

    it('loads state from snapshot', () => {
      const state = {
        title: { value: 'Loaded', ts: 50, clientId: 'client-b' },
        done: { value: true, ts: 50, clientId: 'client-b' },
      }
      crdt.loadState(state)
      expect(crdt.get('title')).toBe('Loaded')
      expect(crdt.get('done')).toBe(true)
    })

    it('loadState clears previous data', () => {
      crdt.applySet('old', 'data', 1, 'c')
      crdt.loadState({ new: { value: 'data', ts: 1, clientId: 'c' } })
      expect(crdt.get('old')).toBeUndefined()
      expect(crdt.get('new')).toBe('data')
    })

    it('roundtrips through getState/loadState', () => {
      crdt.applySet('a', 1, 10, 'c1')
      crdt.applySet('b', 'hello', 20, 'c2')

      const state = crdt.getState()
      const crdt2 = new CRDTMap()
      crdt2.loadState(state)

      expect(crdt2.toJSON()).toEqual(crdt.toJSON())
    })
  })

  describe('concurrent operations', () => {
    it('converges regardless of operation order', () => {
      // Simulate two clients setting the same key concurrently
      const crdt1 = new CRDTMap()
      const crdt2 = new CRDTMap()

      // Client A sets at ts=1, Client B sets at ts=2
      crdt1.applySet('title', 'A', 1, 'client-a')
      crdt1.applySet('title', 'B', 2, 'client-b')

      // Reverse order
      crdt2.applySet('title', 'B', 2, 'client-b')
      crdt2.applySet('title', 'A', 1, 'client-a')

      // Both should converge to 'B' (newer timestamp wins)
      expect(crdt1.get('title')).toBe('B')
      expect(crdt2.get('title')).toBe('B')
    })

    it('converges with same-timestamp different clients', () => {
      const crdt1 = new CRDTMap()
      const crdt2 = new CRDTMap()

      crdt1.applySet('x', 'A', 5, 'alpha')
      crdt1.applySet('x', 'B', 5, 'beta')

      crdt2.applySet('x', 'B', 5, 'beta')
      crdt2.applySet('x', 'A', 5, 'alpha')

      // Both converge to 'B' (higher clientId 'beta' > 'alpha')
      expect(crdt1.get('x')).toBe('B')
      expect(crdt2.get('x')).toBe('B')
    })
  })
})
