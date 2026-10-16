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

	addCommand(_command: unknown): void {
		// no-op: no command palette in unit tests
	}

	addRibbonIcon(_icon: string, _title: string, _callback: unknown): HTMLElement {
		// no-op: unit tests never use the returned element
		return {} as HTMLElement;
	}
}

export class Modal {
	constructor(_app: unknown) {
		// no-op: no modal UI in unit tests
	}
}

export class Notice {
	constructor(_message: unknown, _duration?: number) {
		// no-op: no notice UI in unit tests
	}

	hide(): void {
		// no-op
	}
}

export class ButtonComponent {}

export class PluginSettingTab {}

export class Setting {}

export function getLanguage(): string {
	return 'en';
}

export function requestUrl(): never {
	throw new Error('not available in unit tests');
}
