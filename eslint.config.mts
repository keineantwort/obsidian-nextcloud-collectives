/// <reference types="node" />
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules', 'dist', 'coverage', 'main.js',
		'esbuild.config.mjs', 'versions.json', 'package.json', 'package-lock.json', 'tsconfig.json',
		'scripts/**',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts', 'vitest.integration.config.ts'],
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
	// The declarative settings API needs Obsidian 1.13+, but minAppVersion is 1.11.4, so the imperative tab stays.
	{
		files: ['src/settings/**/*.ts'],
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	// Tests run in Node (vitest), not inside Obsidian: Node modules, fetch and globalThis are allowed there.
	{
		files: ['tests/**/*.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'no-restricted-globals': 'off',
			'obsidianmd/no-global-this': 'off',
		},
	},
);
