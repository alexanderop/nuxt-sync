import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#core': resolve(__dirname, 'src/runtime/core'),
      '#composables': resolve(__dirname, 'src/runtime/composables'),
      '#server': resolve(__dirname, 'src/runtime/server'),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'composables',
          include: ['test/composables/**/*.spec.ts'],
          environment: 'jsdom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/module.ts', 'src/runtime/plugins/**'],
    },
  },
})
