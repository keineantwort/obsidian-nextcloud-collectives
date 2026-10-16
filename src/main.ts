import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, NcSettings } from './settings/types';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	async onload(): Promise<void> { await this.loadSettings(); }
	async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<NcSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
