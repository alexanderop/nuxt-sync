<script setup lang="ts">
import { ref } from 'vue'
import { TodoListSchema } from '../shared/schema'

// Subscribe to a shared todo list — all clients see the same data.
// The document ID 'todos-demo' is the shared key.
const { items, status, push, remove, updateItem } = useSyncList(TodoListSchema, 'todos-demo')

const newTitle = ref('')

function addTodo() {
  const title = newTitle.value.trim()
  if (!title) return

  push({
    title,
    done: false,
    createdAt: Date.now(),
  })

  newTitle.value = ''
}

function toggleDone(id: string, currentDone: boolean) {
  updateItem(id, 'done', !currentDone)
}
</script>

<template>
  <div class="app">
    <header>
      <h1>nuxt-sync demo</h1>
      <p class="subtitle">
        Real-time collaborative todos — open multiple tabs to see sync in action
      </p>
      <div class="status" :class="status">
        {{ status }}
      </div>
    </header>

    <form class="add-form" @submit.prevent="addTodo">
      <input
        v-model="newTitle"
        type="text"
        placeholder="What needs to be done?"
        autofocus
      />
      <button type="submit" :disabled="!newTitle.trim()">Add</button>
    </form>

    <TransitionGroup name="list" tag="ul" class="todo-list">
      <li
        v-for="todo in items"
        :key="todo.id"
        class="todo-item"
        :class="{ done: todo.data.done }"
      >
        <label class="todo-label">
          <input
            type="checkbox"
            :checked="todo.data.done"
            @change="toggleDone(todo.id, todo.data.done)"
          />
          <span class="todo-title">{{ todo.data.title }}</span>
        </label>
        <button class="delete-btn" @click="remove(todo.id)" title="Delete">
          &times;
        </button>
      </li>
    </TransitionGroup>

    <p v-if="items.length === 0 && status === 'ready'" class="empty">
      No todos yet. Add one above!
    </p>

    <footer>
      <p>{{ items.length }} item{{ items.length === 1 ? '' : 's' }}</p>
      <p class="tech">
        LWW-CRDT &middot; Nitro WebSocket &middot; Vue Reactivity
      </p>
    </footer>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f0f0f;
  color: #e0e0e0;
  min-height: 100vh;
}

.app {
  max-width: 560px;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}

header {
  margin-bottom: 2rem;
}

h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
}

.subtitle {
  color: #888;
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

.status {
  display: inline-block;
  margin-top: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status.ready {
  background: #0a2e1a;
  color: #34d399;
}

.status.connecting,
.status.loading {
  background: #2e2a0a;
  color: #fbbf24;
}

.status.error {
  background: #2e0a0a;
  color: #f87171;
}

.add-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.add-form input {
  flex: 1;
  padding: 0.65rem 0.85rem;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  color: #fff;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
}

.add-form input:focus {
  border-color: #555;
}

.add-form button {
  padding: 0.65rem 1.2rem;
  background: #fff;
  color: #000;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.add-form button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.todo-list {
  list-style: none;
}

.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 0.85rem;
  margin-bottom: 0.35rem;
  background: #1a1a1a;
  border-radius: 8px;
  transition: all 0.2s;
}

.todo-item:hover {
  background: #222;
}

.todo-item.done .todo-title {
  text-decoration: line-through;
  color: #666;
}

.todo-label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  flex: 1;
}

.todo-label input[type='checkbox'] {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: #34d399;
  cursor: pointer;
}

.todo-title {
  font-size: 0.9rem;
}

.delete-btn {
  background: none;
  border: none;
  color: #555;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0 0.3rem;
  line-height: 1;
  transition: color 0.15s;
}

.delete-btn:hover {
  color: #f87171;
}

.empty {
  text-align: center;
  color: #555;
  padding: 2rem 0;
  font-size: 0.9rem;
}

footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid #222;
  display: flex;
  justify-content: space-between;
  color: #555;
  font-size: 0.8rem;
}

.tech {
  color: #444;
}

/* Transition animations */
.list-enter-active,
.list-leave-active {
  transition: all 0.25s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
