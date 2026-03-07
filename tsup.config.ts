import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  packages: 'external',
  external: ['dockerode', 'tar-stream'],
})
