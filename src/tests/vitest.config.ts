import {defineConfig} from 'vitest/config'
import path from 'path'

const src = path.resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    // Mirror tsconfig "baseUrl": "src" for the bare imports used in the source
    alias: [
      {find: /^index$/, replacement: path.join(src, 'index.ts')},
      {
        find: /^macfc-security-hub-sync$/,
        replacement: path.join(src, 'macfc-security-hub-sync.ts')
      }
    ]
  },
  test: {include: ['src/tests/**/*.test.ts']}
})
