import { describe, expect, it } from 'vitest';
import { MemoryVault } from '../fakes/memoryVault';

describe('MemoryVault case handling (default: case-insensitive, like macOS and Windows)', () => {
	it('refuses to create a file whose path differs from an existing one only in case', async () => {
		const vault = new MemoryVault();
		vault.seedFolder('Coll');
		await vault.create('Coll/Neu.md', 'Eins');

		await expect(vault.create('coll/neu.md', 'Zwei')).rejects.toThrow('already exists');
		expect(await vault.read('Coll/Neu.md')).toBe('Eins');
	});

	it('reads and processes a file through a path with another spelling', async () => {
		const vault = new MemoryVault();
		vault.seed('Coll/Neu.md', 'Eins');

		expect(await vault.read('coll/NEU.md')).toBe('Eins');
		await vault.process('COLL/neu.md', () => 'Zwei');
		expect(await vault.read('Coll/Neu.md')).toBe('Zwei');
	});

	it('finds a folder through a path with another spelling and refuses to create it again', async () => {
		const vault = new MemoryVault();
		vault.seedFolder('Coll');

		expect(vault.exists('coll')).toBe(true);
		await expect(vault.createFolder('COLL')).rejects.toThrow('already exists');
	});

	it('lists files and folders with the spelling used when they were created', async () => {
		const vault = new MemoryVault();
		vault.seedFolder('Coll');
		await vault.create('coll/Neu.md', 'Text');

		expect(vault.listFiles().map((file) => file.path)).toEqual(['coll/Neu.md']);
		expect(vault.listFolders()).toEqual(['Coll']);
	});
});

describe('MemoryVault with caseInsensitive: false (like Linux)', () => {
	it('creates two files whose paths differ only in case', async () => {
		const vault = new MemoryVault({ caseInsensitive: false });
		vault.seedFolder('Coll');
		vault.seedFolder('coll');
		await vault.create('Coll/Neu.md', 'Eins');
		await vault.create('coll/neu.md', 'Zwei');

		expect(vault.listFiles().map((file) => file.path).sort()).toEqual(['Coll/Neu.md', 'coll/neu.md']);
	});
});
