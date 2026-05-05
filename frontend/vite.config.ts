import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        embed: path.resolve(__dirname, 'embed.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || /\/node_modules\/(react|scheduler)\//.test(id)) return 'react-vendor'
          if (id.includes('echarts') || id.includes('echarts-for-react')) return 'echarts'
          if (id.includes('@lobehub/icons')) return 'lobehub-icons'
          if (id.includes('lucide-react')) return 'lucide'
          if (id.includes('@radix-ui/')) return 'radix'
          if (id.includes('@dnd-kit/')) return 'dnd'
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
