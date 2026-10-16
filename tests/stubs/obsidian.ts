// Runtime stand-in for the 'obsidian' package, which ships only type declarations.
// Used by vitest only (see vitest.config.ts alias). Covers what src/ touches at import time;
// the methods below are never called by the unit tests that use it.

export class Plugin {
	app: unknown;
	manifest: unknown;

	constructor(app: unknown, manifest: unknown) {
		this.app = app;
		this.manifest = manifest;
	}

	loadData(): Promise<unknown> {
		return Promise.resolve(null);
	}

	saveData(_data: unknown): Promise<void> {
		return Promise.resolve();
	}

	addSettingTab(_tab: unknown): void {
		// no-op: no settings UI in unit tests
	}
}

export class PluginSettingTab {}

export class Setting {}

export function getLanguage(): string {
	return 'en';
}

export function requestUrl(): never {
	throw new Error('not available in unit tests');
}
