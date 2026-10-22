import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/scone/',
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
