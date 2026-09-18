import type { Env, GitHubPackage, NpmPackument } from "./types";

export function orgScope(env: Env): string {
	return `@${env.GITHUB_ORG.toLowerCase()}`;
}

function githubApiHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.GITHUB_TOKEN}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "github-upm-proxy",
	};
}

/**
 * Lists every npm package published under the configured GitHub org, paginating
 * through the GitHub REST API. Requires GITHUB_TOKEN to have `read:packages`
 * (and org read access for private packages).
 */
export async function listOrgNpmPackages(env: Env): Promise<GitHubPackage[]> {
	const packages: GitHubPackage[] = [];
	const perPage = 100;
	let page = 1;

	for (;;) {
		const url = `${env.GITHUB_API_URL}/orgs/${encodeURIComponent(
			env.GITHUB_ORG,
		)}/packages?package_type=npm&per_page=${perPage}&page=${page}`;
		const res = await fetch(url, { headers: githubApiHeaders(env) });

		if (!res.ok) {
			throw new Error(
				`GitHub API error listing packages for org "${env.GITHUB_ORG}": ${res.status} ${await res.text()}`,
			);
		}

		const batch = (await res.json()) as GitHubPackage[];
		packages.push(...batch);

		if (batch.length < perPage) {
			break;
		}
		page += 1;
	}

	return packages;
}

/**
 * Fetches the full npm packument for a scoped package name (e.g. "@packmuleregistry/com.foo.bar")
 * directly from the upstream GitHub npm registry.
 */
export async function fetchPackument(env: Env, scopedName: string): Promise<NpmPackument | null> {
	const url = `${env.UPSTREAM_REGISTRY}/${scopedName}`;
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.GITHUB_TOKEN}`,
			Accept: "application/json",
			"User-Agent": "github-upm-proxy",
		},
	});

	if (res.status === 404) {
		return null;
	}
	if (!res.ok) {
		throw new Error(`Failed to fetch packument for ${scopedName}: ${res.status} ${await res.text()}`);
	}

	return (await res.json()) as NpmPackument;
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once. Used to stay
 * well under both Cloudflare Workers' per-invocation subrequest limit (50 on Free plans,
 * 1000 on paid) and GitHub's secondary/abuse rate limits, which trigger on bursts of
 * concurrent requests even when the hourly quota isn't close to exhausted.
 */
async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let next = 0;

	async function run(): Promise<void> {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			try {
				results[index] = { status: "fulfilled", value: await worker(items[index] as T) };
			} catch (reason) {
				results[index] = { status: "rejected", reason };
			}
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
	await Promise.all(workers);
	return results;
}

/**
 * Fetches packuments for every npm package in the org, throttled to a bounded number of
 * concurrent upstream requests. Failures for individual packages are logged and skipped
 * rather than failing the whole batch.
 */
export async function fetchAllPackuments(env: Env): Promise<NpmPackument[]> {
	const pkgs = await listOrgNpmPackages(env);
	const scope = orgScope(env);
	const concurrency = Number.parseInt(env.FETCH_CONCURRENCY, 10) || 8;

	const results = await mapWithConcurrency(pkgs, concurrency, (pkg) =>
		fetchPackument(env, `${scope}/${pkg.name}`),
	);

	const packuments: NpmPackument[] = [];
	for (const result of results) {
		if (result.status === "fulfilled" && result.value) {
			packuments.push(result.value);
		} else if (result.status === "rejected") {
			console.error("Failed to fetch packument", result.reason);
		}
	}

	return packuments;
}
