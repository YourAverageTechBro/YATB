import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Workers AI has no local simulator, so remote bindings would need Cloudflare credentials and bill the
    // account. Local dev runs DRAFT_AI_MODE=stub and never calls env.AI.
    cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: false }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
})
