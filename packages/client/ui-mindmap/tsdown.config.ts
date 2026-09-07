import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'browser',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-theme',
    'react',
    'react-dom',
    '@xyflow/react',
    'zustand',
    'immer',
    'nanoid',
  ],
  globals: {
    react: 'React',
    'react-dom': 'ReactDOM',
  },
})