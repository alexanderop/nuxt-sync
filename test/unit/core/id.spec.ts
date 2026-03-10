import { describe, it, expect } from 'vitest'
import { generateId, docId } from '../../../src/runtime/core/id'

describe('ID generation', () => {
  describe('generateId', () => {
    it('returns a string', () => {
      const id = generateId()
      expect(typeof id).toBe('string')
    })

    it('returns a non-empty string', () => {
      const id = generateId()
      expect(id.length).toBeGreaterThan(0)
    })

    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(1000)
    })

    it('returns a 16-char hex string when crypto.randomUUID is available', () => {
      const id = generateId()
      // In Node.js test env, crypto.randomUUID should be available
      expect(id).toMatch(/^[a-f0-9]{16}$/)
    })
  })

  describe('docId', () => {
    it('returns a prefixed ID', () => {
      const id = docId('todo')
      expect(id).toMatch(/^todo_/)
    })

    it('uses default prefix "doc"', () => {
      const id = docId()
      expect(id).toMatch(/^doc_/)
    })

    it('generates unique document IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(docId('test'))
      }
      expect(ids.size).toBe(100)
    })
  })
})
