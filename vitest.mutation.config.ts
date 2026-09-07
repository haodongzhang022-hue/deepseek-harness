import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Dedicated Vitest surface for mutation testing (Stryker). The default
// vitest.config.ts exercises every package's suite, which would make each
// mutant run the whole repository; this surface scopes Stryker's test run to
// the packages under mutation so a mutated unit reruns only its own suite.
// Resolution mirrors vitest.config.ts: tsconfig.base.json paths must win over
// package exports so built lib/ never loads a second module-singleton copy.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  test: {
    setupFiles: ['./scripts/test-invariants.ts'],
    // Mutation scope: only the packages/util tree. Stryker's `mutate` glob
    // selects which sources to mutate; this include selects which tests run.
    include: ['packages/util/*/tests/**/*.spec.{ts,tsx}'],
    pool: 'forks',
    execArgv: vitestExecArgv,
  },
})
