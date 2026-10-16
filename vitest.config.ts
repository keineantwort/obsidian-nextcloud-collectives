import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
	resolve: {
		// 'obsidian' ships only type declarations; unit tests load a runtime stub instead.
		// Exact-match regex: a plain string key did not take effect for this bare specifier.
		alias: [{ find: /^obsidian$/, replacement: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)) }],
	},
	test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
