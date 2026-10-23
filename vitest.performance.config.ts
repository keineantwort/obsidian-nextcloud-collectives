import { defineConfig } from 'vitest/config';
import { integrationOptions, PERFORMANCE_TESTS } from './vitest.integration.config.ts';
// Performance tests against the same Docker test server as the integration tests (vitest.integration.config.ts).
export default defineConfig({ test: { ...integrationOptions, include: PERFORMANCE_TESTS } });
