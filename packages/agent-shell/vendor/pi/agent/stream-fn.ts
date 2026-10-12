import type { StreamFn } from "./types.ts";

/** The retained loop has no mutable process-wide provider default. */
export function requireStreamFn(streamFn: StreamFn): StreamFn {
	if (typeof streamFn !== "function") throw new Error("Pass a stream function explicitly.");
	return streamFn;
}
