import type { ConnectionResult } from '../api/connection';

export function describeConnectionError(err: unknown): string { void err; throw new Error('not implemented'); }
export function formatConnectionSuccess(result: ConnectionResult): string { void result; throw new Error('not implemented'); }
