import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative assets let the same build work on any GitHub Pages project path.
  base: './',
  plugins: [react()],
})
