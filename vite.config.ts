import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bound to every interface so anyone on the same network can play.
    // Share the `.local` hostname, never the IP — YouTube refuses a numeric
    // origin. Vite blocks unknown hosts unless they are listed here;
    // `.local` covers this machine and any other Bonjour name.
    host: true,
    allowedHosts: ['.local'],
    port: 5180,
    strictPort: true,
    // Same-origin `/api` so the httpOnly identity cookie is first-party.
    // 5180 and 5182 are different origins; SameSite=Lax would drop the cookie.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5182',
      },
      '/ws': {
        target: 'http://127.0.0.1:5182',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        rooms: 'rooms.html',
        create: 'create.html',
        play: 'play.html',
        prototype: 'prototype.html',
      },
    },
  },
})
