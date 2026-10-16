import { defineConfig } from 'vitest/config';
// All integration test files share one Nextcloud test server; running them in parallel lets one file's collectives
// and pages show up in another file's listing. Files therefore run one after another.
export default defineConfig({ test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', setupFiles: ['tests/setup/domParser.ts'], testTimeout: 30000, fileParallelism: false } });
