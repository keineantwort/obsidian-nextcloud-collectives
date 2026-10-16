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
	// Tests run in Node (vitest), not inside Obsidian: Node modules are allowed there.
	{
		files: ['tests/**/*.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: { 'obsidianmd/no-nodejs-modules': 'off' },
	},
);
