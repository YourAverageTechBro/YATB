import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { reviewApi } from './server/plugin.ts'

export default defineConfig({
  plugins: [viteReact(), tailwindcss(), reviewApi()],
})
