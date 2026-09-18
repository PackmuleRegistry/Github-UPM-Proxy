import type { Env, NpmPackument } from "./types";
import { fetchAllPackuments } from "./github";

const KV_KEY = "all-packuments";

interface CacheEntry {
	fetchedAt: number;
	packuments: NpmPackument[];
}

let inflightRefresh: Promise<NpmPackument[]> | null = null;

/**
 * Fetches a fresh package list and writes it to KV. De-duplicated per-isolate so a burst
 * of concurrent requests within the same worker instance triggers at most one refresh.
 */
function refreshCache(env: Env): Promise<NpmPackument[]> {
	if (!inflightRefresh) {
		inflightRefresh = (async () => {
			try {
				const packuments = await fetchAllPackuments(env);
				const entry: CacheEntry = { fetchedAt: Date.now(), packuments };
				await env.PACKUMENT_CACHE.put(KV_KEY, JSON.stringify(entry));
				return packuments;
			} finally {
				inflightRefresh = null;
			}
		})();
	}
	return inflightRefresh;
}

/**
 * Returns packuments for every npm package in the org.
 *
 * Uses KV as a shared, stale-while-revalidate cache: a fresh hit returns immediately, a
 * stale hit is returned immediately while a refresh is kicked off in the background (via
 * ctx.waitUntil), and only a true cache miss (e.g. first request, or KV read failure)
 * blocks on a live GitHub fetch. This avoids "thundering herd" refreshes - many
 * concurrent Unity/npm clients hitting an expired cache at once - which is what makes
 * GitHub's secondary rate limiting most likely to trigger.
 */
export async function getCachedPackuments(env: Env, ctx: ExecutionContext): Promise<NpmPackument[]> {
	const ttlMs = (Number.parseInt(env.CACHE_TTL_SECONDS, 10) || 300) * 1000;

	const raw = await env.PACKUMENT_CACHE.get(KV_KEY);
	if (raw) {
		const entry = JSON.parse(raw) as CacheEntry;
		const age = Date.now() - entry.fetchedAt;
		if (age > ttlMs) {
			ctx.waitUntil(refreshCache(env));
		}
		return entry.packuments;
	}

	return refreshCache(env);
}

/** Proactively refreshes the cache; intended for use from a Cron Trigger. */
export async function warmCache(env: Env): Promise<void> {
	await refreshCache(env);
}
