export default defineNuxtConfig({
  modules: ['../src/module'],

  sync: {
    wsPath: '/__sync',
    storage: 'memory',
  },

  devtools: { enabled: true },

  compatibilityDate: '2025-03-10',
})
