import { defineNuxtPlugin } from '#app'
import { SyncClient, SyncClientKey } from '../composables/useNuxtSync'

export default defineNuxtPlugin((nuxtApp) => {
  // Build WebSocket URL from current location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/__sync`

  const client = new SyncClient(wsUrl)

  // Provide to all components
  nuxtApp.vueApp.provide(SyncClientKey, client)

  // Cleanup on app unmount
  nuxtApp.hook('app:beforeMount', () => {
    // Client is already connected
  })

  // Provide for use in Nuxt context
  return {
    provide: {
      syncClient: client,
    },
  }
})
