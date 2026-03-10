import { describe, it, expect } from 'vitest'
import { sync, SyncMapSchema, SyncListSchema } from '../../../src/runtime/core/schema'

describe('Schema', () => {
  describe('field builders', () => {
    it('sync.string() returns string FieldDef', () => {
      const field = sync.string()
      expect(field.type).toBe('string')
    })

    it('sync.number() returns number FieldDef', () => {
      const field = sync.number()
      expect(field.type).toBe('number')
    })

    it('sync.boolean() returns boolean FieldDef', () => {
      const field = sync.boolean()
      expect(field.type).toBe('boolean')
    })

    it('sync.date() returns number FieldDef (stored as timestamp)', () => {
      const field = sync.date()
      expect(field.type).toBe('number')
    })
  })

  describe('sync.map()', () => {
    it('creates a SyncMapSchema', () => {
      const schema = sync.map({
        title: sync.string(),
        done: sync.boolean(),
      })
      expect(schema).toBeInstanceOf(SyncMapSchema)
      expect(schema.kind).toBe('map')
    })

    it('stores field definitions', () => {
      const schema = sync.map({
        title: sync.string(),
        count: sync.number(),
      })
      expect(schema.fields.title.type).toBe('string')
      expect(schema.fields.count.type).toBe('number')
    })
  })

  describe('sync.list()', () => {
    it('creates a SyncListSchema', () => {
      const itemSchema = sync.map({ title: sync.string() })
      const schema = sync.list(itemSchema)
      expect(schema).toBeInstanceOf(SyncListSchema)
      expect(schema.kind).toBe('list')
    })

    it('references the item schema', () => {
      const itemSchema = sync.map({ title: sync.string() })
      const schema = sync.list(itemSchema)
      expect(schema.itemSchema).toBe(itemSchema)
    })
  })

  describe('SyncMapSchema.validate()', () => {
    const schema = sync.map({
      title: sync.string(),
      done: sync.boolean(),
      count: sync.number(),
    })

    it('returns true for valid data', () => {
      expect(schema.validate({ title: 'Hello', done: false, count: 0 })).toBe(true)
    })

    it('returns false for missing field', () => {
      expect(schema.validate({ title: 'Hello', done: false })).toBe(false)
    })

    it('returns false for wrong type', () => {
      expect(schema.validate({ title: 123, done: false, count: 0 })).toBe(false)
    })

    it('returns false for string instead of boolean', () => {
      expect(schema.validate({ title: 'Hi', done: 'yes', count: 0 })).toBe(false)
    })

    it('returns false for string instead of number', () => {
      expect(schema.validate({ title: 'Hi', done: true, count: 'five' })).toBe(false)
    })

    it('accepts extra fields (no strict mode)', () => {
      expect(schema.validate({ title: 'Hi', done: true, count: 1, extra: 'ok' })).toBe(true)
    })
  })

  describe('SyncMapSchema.defaults()', () => {
    it('returns defaults for all field types', () => {
      const schema = sync.map({
        title: sync.string(),
        done: sync.boolean(),
        count: sync.number(),
      })

      expect(schema.defaults()).toEqual({
        title: '',
        done: false,
        count: 0,
      })
    })

    it('returns defaults for date fields (number)', () => {
      const schema = sync.map({
        createdAt: sync.date(),
      })
      expect(schema.defaults()).toEqual({ createdAt: 0 })
    })
  })
})
