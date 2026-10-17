// Sync executor (PLAN §6.3, §7.2): applies the planner's operations to the vault and the sync state.
// Imports nothing from 'obsidian': all vault access goes through VaultWriter.
import { pathKey } from '../mapping/paths';
import { isRunFatal } from '../util/errors';
import { applyContentOp } from './executorContent';
import type { ExecutorDeps } from './executorDeps';
import { applyStructureOp } from './executorStructure';
import type { SyncOp, SyncPlan } from './planner';
import { emptyResult } from './types';
import type { SyncResult } from './types';

export type { SyncResult } from './types';
export type { ExecutorDeps, VaultWriter } from './executorDeps';

/**
 * Applies the planner's operations in order. A failing page operation is counted and logged (pageId and error class
 * only), then the run continues. Errors for which isRunFatal is true abort the run and are rethrown.
 */
export async function executeSync(plan: SyncPlan, deps: ExecutorDeps): Promise<SyncResult> {
	const result = emptyResult();
	for (const op of plan.ops) {
		let changedState: boolean;
		try {
			changedState = await applyOp(op, deps, result);
		} catch (err) {
			if (isRunFatal(err)) throw err;
			result.failed++;
			deps.log.warn('Sync operation failed', {
				kind: op.kind,
				...pageFields(op),
				error: err instanceof Error ? err.name : 'unknown',
			});
			continue;
		}
		if (changedState) await deps.persist(deps.state);
	}
	return result;
}

/** Runs one operation and updates the counters. Returns true if the sync state changed. */
async function applyOp(op: SyncOp, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	switch (op.kind) {
		case 'ensureFolder':
			if (!deps.vault.exists(op.path)) await deps.vault.createFolder(op.path);
			deps.occupied.add(pathKey(op.path));
			return false;
		case 'saveCollective':
			deps.state.collectives[String(op.collective.collectiveId)] = op.collective;
			return true;
		case 'saveTags':
			deps.state.tags[String(op.collectiveId)] = op.tags;
			return true;
		case 'create':
		case 'createConflict':
		case 'adopt':
		case 'update':
		case 'push':
		case 'updateMeta':
			return applyContentOp(op, deps, result);
		default:
			return applyStructureOp(op, deps, result);
	}
}

/** The page an operation works on, for the log. */
function pageFields(op: SyncOp): { pageId?: number } {
	if ('page' in op) return { pageId: op.page.id };
	if ('pageId' in op) return { pageId: op.pageId };
	return {};
}
