import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { SyncClientKey } from '../../src/runtime/composables/useNuxtSync'
import { useSyncMap, type UseSyncMapReturn } from '../../src/runtime/composables/useSyncMap'
import { sync } from '../../src/runtime/core/schema'
import type { Operation } from '../../src/runtime/core/types'

const TestSchema = sync.map({
  title: sync.string(),
  done: sync.boolean(),
})

type TestData = typeof TestSchema._type

interface MockClient {
  clientId: string
  subscribe: ReturnType<typeof vi.fn>
  sendOp: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

interface SubscribeCallbacks {
  onOp: (op: Operation) => void
  onSnapshot: (ops: Operation[]) => void
}

function createMockClient(): { client: MockClient; getCallbacks: (docId: string) => SubscribeCallbacks | undefined } {
  const callbacksMap = new Map<string, SubscribeCallbacks>()

  const client: MockClient = {
    clientId: 'test-client',
    subscribe: vi.fn((docId: string, onOp: (op: Operation) => void, onSnapshot: (ops: Operation[]) => void) => {
      callbacksMap.set(docId, { onOp, onSnapshot })
      return vi.fn(() => {
        callbacksMap.delete(docId)
      })
    }),
    sendOp: vi.fn(),
    destroy: vi.fn(),
  }

  return { client, getCallbacks: (docId: string) => callbacksMap.get(docId) }
}

function mountWithSync(
  client: MockClient,
  setup: () => UseSyncMapReturn<TestData>,
): { result: UseSyncMapReturn<TestData>; wrapper: ReturnType<typeof mount> } {
  let result!: UseSyncMapReturn<TestData>

  const TestComponent = defineComponent({
    setup() {
      result = setup()
      return () => h('div')
    },
  })

  const wrapper = mount(TestComponent, {
    global: {
      provide: { [SyncClientKey as symbol]: client },
    },
  })

  return { result, wrapper }
}

describe('useSyncMap', () => {
  let mockClient: MockClient
  let getCallbacks: (docId: string) => SubscribeCallbacks | undefined

  beforeEach(() => {
    const mock = createMockClient()
    mockClient = mock.client
    getCallbacks = mock.getCallbacks
  })

  describe('subscription', () => {
    it('subscribes to document on mount', () => {
      mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))

      expect(mockClient.subscribe).toHaveBeenCalledOnce()
      expect(mockClient.subscribe).toHaveBeenCalledWith('doc-1', expect.any(Function), expect.any(Function))
    })

    it('starts with loading status and null data', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))

      expect(result.status.value).toBe('loading')
      expect(result.data.value).toBeNull()
    })

    it('re-subscribes when reactive id changes', async () => {
      const id = ref('doc-1')
      mountWithSync(mockClient, () => useSyncMap(TestSchema, id))

      expect(mockClient.subscribe).toHaveBeenCalledTimes(1)

      id.value = 'doc-2'
      await nextTick()

      expect(mockClient.subscribe).toHaveBeenCalledTimes(2)
      expect(mockClient.subscribe).toHaveBeenLastCalledWith('doc-2', expect.any(Function), expect.any(Function))
    })
  })

  describe('snapshot handling', () => {
    it('applies snapshot and sets status to ready', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Hello', ts: 1, clientId: 'other' },
        { type: 'map:set', id: '2', docId: 'doc-1', key: 'done', value: false, ts: 1, clientId: 'other' },
      ])

      expect(result.status.value).toBe('ready')
      expect(result.data.value).toEqual({ title: 'Hello', done: false })
    })

    it('handles empty snapshot', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      callbacks.onSnapshot([])

      expect(result.status.value).toBe('ready')
      expect(result.data.value).toEqual({})
    })

    it('applies LWW correctly in snapshot', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Old', ts: 1, clientId: 'c' },
        { type: 'map:set', id: '2', docId: 'doc-1', key: 'title', value: 'New', ts: 2, clientId: 'c' },
      ])

      expect(result.data.value!.title).toBe('New')
    })
  })

  describe('incoming operations', () => {
    it('applies map:set op from other clients', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      // First set up initial state via snapshot
      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Hello', ts: 1, clientId: 'other' },
      ])

      // Incoming op from another client
      callbacks.onOp({
        type: 'map:set',
        id: '2',
        docId: 'doc-1',
        key: 'title',
        value: 'Updated',
        ts: 2,
        clientId: 'other',
      })

      expect(result.data.value!.title).toBe('Updated')
    })

    it('applies map:del op', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Hello', ts: 1, clientId: 'other' },
        { type: 'map:set', id: '2', docId: 'doc-1', key: 'done', value: false, ts: 1, clientId: 'other' },
      ])

      callbacks.onOp({
        type: 'map:del',
        id: '3',
        docId: 'doc-1',
        key: 'title',
        ts: 2,
        clientId: 'other',
      })

      expect(result.data.value).toEqual({ done: false })
    })

    it('ignores ops that lose LWW comparison', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!

      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Newer', ts: 10, clientId: 'c' },
      ])

      callbacks.onOp({
        type: 'map:set',
        id: '2',
        docId: 'doc-1',
        key: 'title',
        value: 'Older',
        ts: 5,
        clientId: 'c',
      })

      expect(result.data.value!.title).toBe('Newer')
    })
  })

  describe('set()', () => {
    it('sets a single field optimistically', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!
      callbacks.onSnapshot([])

      result.set('title', 'New Title')

      expect(result.data.value!.title).toBe('New Title')
    })

    it('sends op to server via sendOp', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!
      callbacks.onSnapshot([])

      result.set('title', 'Hello')

      expect(mockClient.sendOp).toHaveBeenCalledOnce()
      const sentOp = mockClient.sendOp.mock.calls[0][0] as Operation
      expect(sentOp.type).toBe('map:set')
      expect((sentOp as any).key).toBe('title')
      expect((sentOp as any).value).toBe('Hello')
      expect(sentOp.docId).toBe('doc-1')
      expect(sentOp.clientId).toBe('test-client')
    })

    it('batch sets multiple fields', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!
      callbacks.onSnapshot([])

      result.set({ title: 'Batch', done: true })

      expect(result.data.value).toEqual({ title: 'Batch', done: true })
      expect(mockClient.sendOp).toHaveBeenCalledTimes(2) // One op per field
    })
  })

  describe('del()', () => {
    it('deletes a field optimistically', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!
      callbacks.onSnapshot([
        { type: 'map:set', id: '1', docId: 'doc-1', key: 'title', value: 'Hello', ts: 1, clientId: 'c' },
        { type: 'map:set', id: '2', docId: 'doc-1', key: 'done', value: false, ts: 1, clientId: 'c' },
      ])

      result.del('title')

      expect(result.data.value).toEqual({ done: false })
    })

    it('sends del op to server', () => {
      const { result } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))
      const callbacks = getCallbacks('doc-1')!
      callbacks.onSnapshot([])

      result.del('title')

      expect(mockClient.sendOp).toHaveBeenCalledOnce()
      const sentOp = mockClient.sendOp.mock.calls[0][0] as Operation
      expect(sentOp.type).toBe('map:del')
      expect((sentOp as any).key).toBe('title')
    })
  })

  describe('cleanup', () => {
    it('unsubscribes on unmount', () => {
      const { wrapper } = mountWithSync(mockClient, () => useSyncMap(TestSchema, 'doc-1'))

      // Get the unsubscribe function that was returned by subscribe
      const unsubscribe = mockClient.subscribe.mock.results[0].value

      wrapper.unmount()

      expect(unsubscribe).toHaveBeenCalled()
    })
  })
})
