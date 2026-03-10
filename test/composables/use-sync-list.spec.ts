import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { SyncClientKey } from '../../src/runtime/composables/useNuxtSync'
import { useSyncList, type UseSyncListReturn } from '../../src/runtime/composables/useSyncList'
import { sync } from '../../src/runtime/core/schema'
import type { Operation } from '../../src/runtime/core/types'

const ItemSchema = sync.map({
  title: sync.string(),
  done: sync.boolean(),
})
const ListSchema = sync.list(ItemSchema)

type ItemData = typeof ItemSchema._type

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
  setup: () => UseSyncListReturn<ItemData>,
): { result: UseSyncListReturn<ItemData>; wrapper: ReturnType<typeof mount> } {
  let result!: UseSyncListReturn<ItemData>

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

describe('useSyncList', () => {
  let mockClient: MockClient
  let getCallbacks: (docId: string) => SubscribeCallbacks | undefined

  beforeEach(() => {
    const mock = createMockClient()
    mockClient = mock.client
    getCallbacks = mock.getCallbacks
  })

  describe('subscription', () => {
    it('subscribes to document on mount', () => {
      mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))

      expect(mockClient.subscribe).toHaveBeenCalledOnce()
      expect(mockClient.subscribe).toHaveBeenCalledWith('list-1', expect.any(Function), expect.any(Function))
    })

    it('starts with loading status and empty items', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))

      expect(result.status.value).toBe('loading')
      expect(result.items.value).toEqual([])
    })

    it('re-subscribes when reactive id changes', async () => {
      const id = ref('list-1')
      mountWithSync(mockClient, () => useSyncList(ListSchema, id))

      id.value = 'list-2'
      await nextTick()

      expect(mockClient.subscribe).toHaveBeenCalledTimes(2)
      expect(mockClient.subscribe).toHaveBeenLastCalledWith('list-2', expect.any(Function), expect.any(Function))
    })
  })

  describe('snapshot handling', () => {
    it('applies snapshot and sets status to ready', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'First', done: false },
          ts: 1,
          clientId: 'other',
        },
      ])

      expect(result.status.value).toBe('ready')
      expect(result.items.value).toHaveLength(1)
      expect(result.items.value[0]).toEqual({
        id: 'item-1',
        data: { title: 'First', done: false },
      })
    })

    it('handles empty snapshot', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([])

      expect(result.status.value).toBe('ready')
      expect(result.items.value).toEqual([])
    })

    it('applies multiple items from snapshot in correct order', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'First', done: false },
          ts: 1,
          clientId: 'c',
        },
        {
          type: 'list:ins',
          id: 'op-2',
          docId: 'list-1',
          itemId: 'item-2',
          afterId: 'item-1',
          fields: { title: 'Second', done: true },
          ts: 2,
          clientId: 'c',
        },
      ])

      expect(result.items.value.map(i => i.data.title)).toEqual(['First', 'Second'])
    })

    it('applies delete operations in snapshot', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'First', done: false },
          ts: 1,
          clientId: 'c',
        },
        {
          type: 'list:ins',
          id: 'op-2',
          docId: 'list-1',
          itemId: 'item-2',
          afterId: null,
          fields: { title: 'Second', done: false },
          ts: 2,
          clientId: 'c',
        },
        {
          type: 'list:del',
          id: 'op-3',
          docId: 'list-1',
          itemId: 'item-1',
          ts: 3,
          clientId: 'c',
        },
      ])

      expect(result.items.value).toHaveLength(1)
      expect(result.items.value[0].data.title).toBe('Second')
    })
  })

  describe('incoming operations', () => {
    it('handles list:ins from other client', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([])

      callbacks.onOp({
        type: 'list:ins',
        id: 'op-1',
        docId: 'list-1',
        itemId: 'item-1',
        afterId: null,
        fields: { title: 'Remote', done: false },
        ts: 1,
        clientId: 'other',
      })

      expect(result.items.value).toHaveLength(1)
      expect(result.items.value[0].data.title).toBe('Remote')
    })

    it('handles list:del from other client', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'Hello', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      callbacks.onOp({
        type: 'list:del',
        id: 'op-2',
        docId: 'list-1',
        itemId: 'item-1',
        ts: 2,
        clientId: 'other',
      })

      expect(result.items.value).toHaveLength(0)
    })

    it('handles list-item:set from other client', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!

      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'Old', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      callbacks.onOp({
        type: 'list-item:set',
        id: 'op-2',
        docId: 'list-1',
        itemId: 'item-1',
        key: 'title',
        value: 'New',
        ts: 2,
        clientId: 'other',
      })

      expect(result.items.value[0].data.title).toBe('New')
    })
  })

  describe('push()', () => {
    it('appends item optimistically', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([])

      const itemId = result.push({ title: 'New Todo', done: false })

      expect(typeof itemId).toBe('string')
      expect(result.items.value).toHaveLength(1)
      expect(result.items.value[0].data.title).toBe('New Todo')
      expect(result.items.value[0].id).toBe(itemId)
    })

    it('sends insert op to server', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([])

      result.push({ title: 'Test', done: false })

      expect(mockClient.sendOp).toHaveBeenCalledOnce()
      const sentOp = mockClient.sendOp.mock.calls[0][0] as Operation
      expect(sentOp.type).toBe('list:ins')
      expect((sentOp as any).afterId).toBeNull() // First item, no predecessor
      expect((sentOp as any).fields).toEqual({ title: 'Test', done: false })
    })

    it('appends after the last item', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'existing',
          afterId: null,
          fields: { title: 'Existing', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.push({ title: 'New', done: false })

      const sentOp = mockClient.sendOp.mock.calls[0][0] as any
      expect(sentOp.afterId).toBe('existing')
    })
  })

  describe('insertAfter()', () => {
    it('inserts after a specific item', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'First', done: false },
          ts: 1,
          clientId: 'c',
        },
        {
          type: 'list:ins',
          id: 'op-2',
          docId: 'list-1',
          itemId: 'item-3',
          afterId: 'item-1',
          fields: { title: 'Third', done: false },
          ts: 2,
          clientId: 'c',
        },
      ])

      result.insertAfter('item-1', { title: 'Second', done: false })

      // Should have 3 items now
      expect(result.items.value).toHaveLength(3)
      expect(result.items.value[0].data.title).toBe('First')
    })

    it('sends insert op with correct afterId', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([])

      result.insertAfter('target-id', { title: 'Inserted', done: false })

      const sentOp = mockClient.sendOp.mock.calls[0][0] as any
      expect(sentOp.type).toBe('list:ins')
      expect(sentOp.afterId).toBe('target-id')
    })
  })

  describe('remove()', () => {
    it('removes item optimistically', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'Delete me', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.remove('item-1')

      expect(result.items.value).toHaveLength(0)
    })

    it('sends delete op to server', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'X', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.remove('item-1')

      expect(mockClient.sendOp).toHaveBeenCalledOnce()
      const sentOp = mockClient.sendOp.mock.calls[0][0] as any
      expect(sentOp.type).toBe('list:del')
      expect(sentOp.itemId).toBe('item-1')
    })
  })

  describe('updateItem()', () => {
    it('updates a single field optimistically', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'Old', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.updateItem('item-1', 'title', 'New')

      expect(result.items.value[0].data.title).toBe('New')
      expect(result.items.value[0].data.done).toBe(false) // Unchanged
    })

    it('batch updates multiple fields', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'Old', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.updateItem('item-1', { title: 'Updated', done: true })

      expect(result.items.value[0].data).toEqual({ title: 'Updated', done: true })
      expect(mockClient.sendOp).toHaveBeenCalledTimes(2) // One op per field
    })

    it('sends list-item:set op to server', () => {
      const { result } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))
      const callbacks = getCallbacks('list-1')!
      callbacks.onSnapshot([
        {
          type: 'list:ins',
          id: 'op-1',
          docId: 'list-1',
          itemId: 'item-1',
          afterId: null,
          fields: { title: 'X', done: false },
          ts: 1,
          clientId: 'c',
        },
      ])

      result.updateItem('item-1', 'done', true)

      const sentOp = mockClient.sendOp.mock.calls[0][0] as any
      expect(sentOp.type).toBe('list-item:set')
      expect(sentOp.itemId).toBe('item-1')
      expect(sentOp.key).toBe('done')
      expect(sentOp.value).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('unsubscribes on unmount', () => {
      const { wrapper } = mountWithSync(mockClient, () => useSyncList(ListSchema, 'list-1'))

      const unsubscribe = mockClient.subscribe.mock.results[0].value
      wrapper.unmount()

      expect(unsubscribe).toHaveBeenCalled()
    })
  })
})
