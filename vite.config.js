import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' 讓網站在 https://<帳號>.github.io/<repo>/ 子路徑下也能正常運作
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
