import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the React app runs on 5173 and proxies API + websocket traffic to the Node server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
