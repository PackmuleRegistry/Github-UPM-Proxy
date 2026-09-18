import type { Env, NpmPackument, NpmVersion } from "../types";
import { getCachedPackuments } from "../cache";

interface SearchObject {
	package: {
		name: string;
		version: string;
		description: string;
		keywords: string[];
		date: string;
		links: Record<string, string>;
		author?: unknown;
	};
	score: {
		final: number;
		detail: { quality: number; popularity: number; maintenance: number };
	};
	searchScore: number;
}

function latestVersion(packument: NpmPackument): NpmVersion | undefined {
	const latestTag = packument["dist-tags"]?.latest;
	if (!latestTag || !packument.versions) return undefined;
	return packument.versions[latestTag];
}

function matchesQuery(packument: NpmPackument, version: NpmVersion | undefined, text: string): boolean {
	if (!text) return true;
	const haystack = [packument.name, packument.description, version?.description, ...(version?.keywords ?? [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return text
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

/**
 * Implements the legacy `/-/v1/search` endpoint that Unity's Package Manager uses
 * to search a registry. GitHub's npm registry does not implement this endpoint, so
 * we synthesize results from the org's cached packuments with a simple substring match.
 */
export async function handleSearch(env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
	const text = url.searchParams.get("text") ?? "";
	const size = Math.min(Number.parseInt(url.searchParams.get("size") ?? "20", 10) || 20, 250);
	const from = Number.parseInt(url.searchParams.get("from") ?? "0", 10) || 0;

	const packuments = await getCachedPackuments(env, ctx);

	const matched = packuments
		.map((packument) => ({ packument, version: latestVersion(packument) }))
		.filter(({ packument, version }) => matchesQuery(packument, version, text));

	const total = matched.length;
	const page = matched.slice(from, from + size);

	const objects: SearchObject[] = page.map(({ packument, version }) => ({
		package: {
			name: packument.name,
			version: version?.version ?? "0.0.0",
			description: version?.description ?? packument.description ?? "",
			keywords: version?.keywords ?? [],
			date: packument.time?.modified ?? packument.time?.created ?? new Date(0).toISOString(),
			links: {},
			author: version?.author,
		},
		score: {
			final: 1,
			detail: { quality: 1, popularity: 1, maintenance: 1 },
		},
		searchScore: 1,
	}));

	const body = {
		objects,
		total,
		time: new Date().toISOString(),
	};

	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
	});
}
