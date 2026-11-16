import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // lightningcss (Vite's CSS minifier) has no build for Android/Termux
  build: { cssMinify: false },
})
