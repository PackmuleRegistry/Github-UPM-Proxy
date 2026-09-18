export interface Env {
	/** GitHub org (or user) that owns the npm packages, e.g. "PackmuleRegistry". */
	GITHUB_ORG: string;
	/** Base URL of the upstream GitHub npm registry. */
	UPSTREAM_REGISTRY: string;
	/** Base URL of the GitHub REST API. */
	GITHUB_API_URL: string;
	/** How long (seconds) to cache the synthesized /-/all package list. */
	CACHE_TTL_SECONDS: string;
	/** GitHub PAT (classic) with `read:packages` scope. Required. */
	GITHUB_TOKEN: string;
	/** Optional shared secret required from clients calling this worker. */
	PROXY_AUTH_TOKEN?: string;
}

/** Minimal shape of a GitHub REST API package list entry. */
export interface GitHubPackage {
	name: string;
	package_type: string;
	visibility: string;
	version_count: number;
}

/** Minimal shape of an npm packument as served by the GitHub npm registry. */
export interface NpmPackument {
	name: string;
	description?: string;
	"dist-tags"?: Record<string, string>;
	versions?: Record<string, NpmVersion>;
	time?: Record<string, string>;
	[key: string]: unknown;
}

export interface NpmVersion {
	name: string;
	version: string;
	description?: string;
	keywords?: string[];
	author?: unknown;
	[key: string]: unknown;
}
