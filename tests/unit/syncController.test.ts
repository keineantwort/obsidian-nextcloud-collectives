import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { createTranslator } from '../../src/i18n';
import { STARTUP_DELAY_MS } from '../../src/sync/scheduler';
import { DEFAULT_SETTINGS } from '../../src/settings/types';
import type { NcSettings } from '../../src/settings/types';
import type { SyncRunDeps } from '../../src/sync/syncRun';
import type { SyncRunOutcome } from '../../src/sync/types';
import { emptyResult } from '../../src/sync/types';
import type { SyncNoticeSpec } from '../../src/ui/syncNotices';
import { AuthError, ConfigError, NetworkError } from '../../src/util/errors';
import { Logger } from '../../src/util/logger';

const runSyncMock = vi.hoisted(() => vi.fn());
const shown = vi.hoisted(() => ({ notices: [] as unknown[] }));
const dialogs = vi.hoisted(() => ({ confirm: vi.fn(), initial: vi.fn() }));

vi.mock('../../src/sync/syncRun', () => ({ runSync: runSyncMock }));
vi.mock('../../src/sync/obsidianVault', () => ({ createObsidianVault: () => ({}) }));
vi.mock('../../src/ui/showSyncNotice', () => ({ showSyncNotice: (spec: unknown) => { shown.notices.push(spec); } }));
vi.mock('../../src/ui/confirmModal', () => ({ confirmProposals: dialogs.confirm }));
vi.mock('../../src/ui/initialSyncModal', () => ({ confirmInitialSync: dialogs.initial }));
vi.mock('../../src/ui/conflictModal', () => ({ openConflictModal: vi.fn() }));

// Imported after the mocks are registered.
const { SyncController } = await import('../../src/syncController');

const t = createTranslator('en');
const done = (over: Partial<ReturnType<typeof emptyResult>> = {}): SyncRunOutcome => ({
	kind: 'done', result: { ...emptyResult(), ...over }, skips: [], openConflicts: 0, pages: 3,
});

/** A run that the test finishes by hand. */
function gate() {
	let release: (outcome: SyncRunOutcome) => void = () => undefined;
	let fail: (err: unknown) => void = () => undefined;
	const promise = new Promise<SyncRunOutcome>((resolve, reject) => { release = resolve; fail = reject; });
	return { promise, release, fail };
}

function setup(settings: Partial<NcSettings> = {}) {
	const current: NcSettings = { ...DEFAULT_SETTINGS, syncIntervalMinutes: 0, syncOnStartup: false, ...settings };
	const state = { load: vi.fn().mockResolvedValue(null), save: vi.fn() };
	const controller = new SyncController({
		app: { workspace: {} } as unknown as App,
		t,
		log: new Logger(),
		settings: () => current,
		readPassword: () => Promise.resolve('pw'),
		stateStore: () => state as never,
		onStatusChange: () => undefined,
	});
	return { controller, current };
}

const texts = (): string[] => shown.notices.map((n) => (n as SyncNoticeSpec).lines.join(' | '));

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('window', globalThis);
	runSyncMock.mockReset();
	dialogs.confirm.mockReset();
	dialogs.initial.mockReset();
	shown.notices = [];
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('SyncController: mutex with re-run flag', () => {
	it('runs once more after the current run when triggers came in meanwhile', async () => {
		const first = gate();
		runSyncMock.mockReturnValueOnce(first.promise).mockResolvedValue(done());
		const { controller } = setup();

		const running = controller.runFromUi();
		await vi.advanceTimersByTimeAsync(0);
		void controller.runFromUi();
		void controller.runFromUi();
		expect(runSyncMock).toHaveBeenCalledTimes(1);

		first.release(done());
		await running;

		expect(runSyncMock).toHaveBeenCalledTimes(2);
	});

	it('tells the user that a second manual request waits', async () => {
		const first = gate();
		runSyncMock.mockReturnValueOnce(first.promise).mockResolvedValue(done());
		const { controller } = setup();
		const running = controller.runFromUi();
		await vi.advanceTimersByTimeAsync(0);

		void controller.runFromUi();
		first.release(done());
		await running;

		expect(texts()).toContain(t('sync.rerunQueued'));
	});

	it('never runs two syncs at the same time', async () => {
		let active = 0;
		let maxActive = 0;
		runSyncMock.mockImplementation(async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active--;
			return done();
		});
		const { controller } = setup();

		const runs = [controller.runFromUi(), controller.runFromUi(), controller.runFromUi()];
		await Promise.all(runs);
		await vi.advanceTimersByTimeAsync(0);

		expect(maxActive).toBe(1);
	});

	it('runs a request that comes after a finished run', async () => {
		runSyncMock.mockResolvedValue(done());
		const { controller } = setup();
		await controller.runFromUi();
		await controller.runFromUi();
		expect(runSyncMock).toHaveBeenCalledTimes(2);
	});
});

describe('SyncController: automatic runs', () => {
	const auto = async (controller: InstanceType<typeof SyncController>): Promise<void> => {
		controller.noteUserChange();
		await vi.advanceTimersByTimeAsync(10_000);
	};

	it('starts a run after the quiet period following a change', async () => {
		runSyncMock.mockResolvedValue(done());
		const { controller } = setup();
		controller.startAutomation();

		controller.noteUserChange();
		await vi.advanceTimersByTimeAsync(9_999);
		expect(runSyncMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		expect(runSyncMock).toHaveBeenCalledTimes(1);
	});

	it('runs on startup when the setting is on', async () => {
		runSyncMock.mockResolvedValue(done());
		const { controller } = setup({ syncOnStartup: true });
		controller.startAutomation();
		await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
		expect(runSyncMock).toHaveBeenCalledTimes(1);
	});

	it('stays quiet when nothing needs attention', async () => {
		runSyncMock.mockResolvedValue(done({ pushed: 2 }));
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);
		expect(shown.notices).toEqual([]);
	});

	it('shows a warning once and not again for the same text', async () => {
		runSyncMock.mockResolvedValue(done({ conflicts: 1 }));
		const { controller } = setup();
		controller.startAutomation();

		await auto(controller);
		await auto(controller);

		expect(shown.notices).toHaveLength(1);
		expect((shown.notices[0] as SyncNoticeSpec).level).toBe('warning');
	});

	it('shows a repeated warning again after a quiet run in between', async () => {
		runSyncMock.mockResolvedValueOnce(done({ conflicts: 1 })).mockResolvedValueOnce(done()).mockResolvedValueOnce(done({ conflicts: 1 }));
		const { controller } = setup();
		controller.startAutomation();

		await auto(controller);
		await auto(controller);
		await auto(controller);

		expect(shown.notices).toHaveLength(2);
	});

	it('opens no dialog and defers the questions, with a hint', async () => {
		runSyncMock.mockImplementation(async (deps: SyncRunDeps) => {
			expect(await deps.confirmInitialSync()).toBe(false);
			const answers = await deps.confirm([{ id: 'x' } as never]);
			expect(answers.size).toBe(0);
			return done();
		});
		const { controller } = setup();
		controller.startAutomation();

		await auto(controller);

		expect(dialogs.confirm).not.toHaveBeenCalled();
		expect(dialogs.initial).not.toHaveBeenCalled();
		expect(texts()).toEqual([expect.stringContaining(t('sync.auto.questionsPending'))]);
	});

	it('a manual run opens the dialogs', async () => {
		dialogs.confirm.mockResolvedValue(new Map());
		runSyncMock.mockImplementation(async (deps: SyncRunDeps) => {
			await deps.confirm([{ id: 'x' } as never]);
			return done();
		});
		const { controller } = setup();
		await controller.runFromUi();
		expect(dialogs.confirm).toHaveBeenCalledTimes(1);
	});

	it('is quiet about a cancelled automatic initial sync', async () => {
		runSyncMock.mockResolvedValue({ kind: 'cancelled' });
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);
		expect(shown.notices).toEqual([]);
	});

	it('stays quiet without a network and keeps running', async () => {
		runSyncMock.mockRejectedValue(new NetworkError('offline'));
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);
		await auto(controller);
		expect(shown.notices).toEqual([]);
		expect(runSyncMock).toHaveBeenCalledTimes(2);
	});

	it('stays quiet without configuration', async () => {
		runSyncMock.mockRejectedValue(new ConfigError('appPassword', 'missing'));
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);
		expect(shown.notices).toEqual([]);
	});

	it('pauses after rejected credentials, shows one error, and resumes after a settings change', async () => {
		runSyncMock.mockRejectedValue(new AuthError(401));
		const { controller } = setup();
		controller.startAutomation();

		await auto(controller);
		await auto(controller);
		expect(runSyncMock).toHaveBeenCalledTimes(1);
		expect(shown.notices).toHaveLength(1);
		expect((shown.notices[0] as SyncNoticeSpec).level).toBe('error');

		runSyncMock.mockResolvedValue(done());
		controller.settingsChanged();
		await auto(controller);
		expect(runSyncMock).toHaveBeenCalledTimes(2);
	});

	it('a manual run works while paused and ends the pause when it succeeds', async () => {
		runSyncMock.mockRejectedValueOnce(new AuthError(401)).mockResolvedValue(done());
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);

		await controller.runFromUi();
		await auto(controller);

		expect(runSyncMock).toHaveBeenCalledTimes(3);
	});

	it('does not repeat an automatic re-run once paused by the run in progress', async () => {
		const first = gate();
		runSyncMock.mockReturnValueOnce(first.promise).mockResolvedValue(done());
		const { controller } = setup();
		controller.startAutomation();
		await auto(controller);
		await auto(controller);
		expect(runSyncMock).toHaveBeenCalledTimes(1);

		first.fail(new AuthError(401));
		await vi.advanceTimersByTimeAsync(0);

		expect(runSyncMock).toHaveBeenCalledTimes(1);
	});
});

describe('SyncController: dirty keys of unfinished runs', () => {
	it('puts the keys back when the run fails', async () => {
		runSyncMock.mockImplementation(async (deps: SyncRunDeps) => {
			deps.dirty();
			throw new NetworkError('offline');
		});
		const { controller } = setup();
		controller.dirtyQueue.noteModified('A/B.md');

		await controller.runFromUi();

		expect(controller.dirtyQueue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('puts the keys back when a page failed', async () => {
		runSyncMock.mockImplementation(async (deps: SyncRunDeps) => {
			deps.dirty();
			return done({ failed: 1 });
		});
		const { controller } = setup();
		controller.dirtyQueue.noteModified('A/B.md');

		await controller.runFromUi();

		expect(controller.dirtyQueue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('does not put them back after a clean run', async () => {
		runSyncMock.mockImplementation(async (deps: SyncRunDeps) => {
			deps.dirty();
			return done({ pushed: 1 });
		});
		const { controller } = setup();
		controller.dirtyQueue.noteModified('A/B.md');

		await controller.runFromUi();

		expect(controller.dirtyQueue.drain()).toEqual(new Set());
	});
});
