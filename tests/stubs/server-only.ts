/**
 * `server-only` throws by design when imported outside a React Server
 * Component. Unit tests import those modules directly, so it is aliased to
 * this no-op in vitest.config.ts.
 */
export {};
