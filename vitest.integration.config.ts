import { configDefaults, defineConfig } from 'vitest/config';
// All integration test files share one Nextcloud test server; running them in parallel lets one file's collectives
// and pages show up in another file's listing. Files therefore run one after another.
// The performance test (500 pages) takes several minutes per server and runs on its own: npm run test:perf.
export const PERFORMANCE_TESTS = ['tests/integration/performance.test.ts'];
export const integrationOptions = { environment: 'node', setupFiles: ['tests/setup/domParser.ts'], testTimeout: 30000, fileParallelism: false } as const;
export default defineConfig({ test: { ...integrationOptions, include: ['tests/integration/**/*.test.ts'], exclude: [...configDefaults.exclude, ...PERFORMANCE_TESTS] } });
