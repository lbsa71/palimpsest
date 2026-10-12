import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/** Node host composition only. Domain methods retain these callbacks once. */
export function createProductionWallClock(): () => number { return Date.now; }
export function createProductionElapsedClock(): () => number { return performance.now.bind(performance); }
export function createProductionIdSupplier(): () => string { return randomUUID; }
