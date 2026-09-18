import type { Env } from "../types";
import { getCachedPackuments } from "../cache";

/**
 * Implements the legacy CouchDB-style `/-/all` endpoint that Unity's Package Manager
 * uses to list every package on a registry. GitHub's npm registry does not implement
 * this endpoint, so we synthesize it from the org's package list + individual packuments.
 */
export async function handleAll(env: Env, ctx: ExecutionContext): Promise<Response> {
	const packuments = await getCachedPackuments(env, ctx);

	const all: Record<string, unknown> = {
		_updated: Date.now(),
	};
	for (const packument of packuments) {
		all[packument.name] = packument;
	}

	return new Response(JSON.stringify(all), {
		headers: { "Content-Type": "application/json" },
	});
}
