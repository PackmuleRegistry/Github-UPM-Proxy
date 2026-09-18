import type { Env, NpmPackument } from "./types";
import { fetchAllPackuments } from "./github";

const CACHE_KEY = "https://github-upm-proxy.internal/cache/all-packuments";

/**
 * Returns packuments for every npm package in the org, using the Workers Cache API
 * to avoid hammering the GitHub API/registry on every UPM search/list request.
 */
export async function getCachedPackuments(env: Env, ctx: ExecutionContext): Promise<NpmPackument[]> {
	const cache = caches.default;
	const cacheKey = new Request(CACHE_KEY);

	const cached = await cache.match(cacheKey);
	if (cached) {
		return (await cached.json()) as NpmPackument[];
	}

	const packuments = await fetchAllPackuments(env);

	const ttl = Number.parseInt(env.CACHE_TTL_SECONDS, 10) || 300;
	const response = new Response(JSON.stringify(packuments), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": `max-age=${ttl}`,
		},
	});
	ctx.waitUntil(cache.put(cacheKey, response));

	return packuments;
}
