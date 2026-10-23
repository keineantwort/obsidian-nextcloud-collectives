/// <reference types="node" />
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules', 'dist', 'coverage', 'main.js',
		'esbuild.config.mjs', 'versions.json', 'package.json', 'package-lock.json', 'tsconfig.json',
		'scripts/**', 'dev-vault/**',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts', 'vitest.integration.config.ts', 'vitest.performance.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	// The plugin must run on mobile: Node modules and fetch are errors in src/ (warnings by default in the preset).
	{
		files: ['src/**/*.ts'],
		rules: { 'obsidianmd/no-nodejs-modules': 'error', 'no-restricted-globals': 'error' },
	},
	// planner and mapping are pure (AGENTS rule 3): no Obsidian, no network modules; the vitest stub would hide a violation.
	{
		files: ['src/sync/plan*.ts', 'src/sync/placement.ts', 'src/sync/treeIndex.ts', 'src/sync/locate.ts', 'src/sync/decide.ts', 'src/mapping/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', {
				paths: [{ name: 'obsidian', message: 'planner and mapping must stay free of Obsidian imports.' }],
				patterns: [{ group: ['**/api/http', '**/api/ocsClient', '**/api/webdavClient', '**/api/collectivesApi', '**/api/clients', '**/api/obsidianRequest', '**/api/connection'], message: 'planner and mapping must stay free of network modules; only ../api/types is allowed.' }],
			}],
		},
	},
	// Sync core, its state and the pure UI helpers are testable without Obsidian: no 'obsidian' import (the rest of src/ may import it).
	{
		files: [
			'src/sync/conflicts.ts', 'src/sync/dirtyQueue.ts', 'src/sync/executor*.ts', 'src/sync/pageState.ts', 'src/sync/syncRun.ts', 'src/sync/localScanner.ts',
			'src/sync/remoteScanner.ts', 'src/sync/state.ts', 'src/sync/stateStore.ts', 'src/sync/types.ts', 'src/ui/conflictView.ts', 'src/ui/confirmView.ts',
			'src/ui/statusBar.ts', 'src/ui/syncNotices.ts', 'src/util/diff.ts',
		],
		rules: {
			'no-restricted-imports': ['error', {
				paths: [{ name: 'obsidian', message: 'sync core and its pure helpers must not import Obsidian; go through the injected interfaces.' }],
			}],
		},
	},
	// The declarative settings API needs Obsidian 1.13+, but minAppVersion is 1.11.4, so the imperative tab stays.
	{
		files: ['src/settings/**/*.ts'],
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	// Tests run in Node (vitest), not inside Obsidian: Node modules, fetch and globalThis are allowed there.
	{
		files: ['tests/**/*.ts', 'vitest.config.ts', 'vitest.integration.config.ts', 'vitest.performance.config.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'no-restricted-globals': 'off',
			'obsidianmd/no-global-this': 'off',
			// Fixtures model the default config folder on purpose; src/ still gets the rule.
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
);
