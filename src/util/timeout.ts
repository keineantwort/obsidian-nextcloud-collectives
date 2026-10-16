/** Rejects with NetworkError if `promise` does not settle within `ms`. Uses window.setTimeout / window.clearTimeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> { void promise; void ms; throw new Error('not implemented'); }
