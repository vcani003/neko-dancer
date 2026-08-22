import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bound to every interface so anyone on the same network can play by
    // opening this machine's IP address. The console prints the URL to share.
    host: true,
    port: 5180,
    strictPort: true,
  },
})
