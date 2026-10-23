import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import domReview from '../plugin/index.js'

export default defineConfig({
  plugins: [react(), domReview()],
})
