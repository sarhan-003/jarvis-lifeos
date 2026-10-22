import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 explicitly: on Windows Node resolves localhost to ::1 only, which some browsers can't reach.
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.AGENT_PORT ?? 5200}` },
  },
});
