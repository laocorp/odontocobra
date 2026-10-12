import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({ plugins: [react()], envDir: resolve(appDir, '../..') })
