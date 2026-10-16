import type { RequestFn } from './connection';
/** RequestFn backed by Obsidian's requestUrl (throw: false), with timeout. */
export const obsidianRequest: RequestFn = async (req) => { void req; throw new Error('not implemented'); };
