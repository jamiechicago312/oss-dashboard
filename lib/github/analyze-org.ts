import { GitHubClientPool } from "@/lib/github/client";
import type {
  AnalyzeOrgResponse,
  OrgRepo,
  PullRequestReview,
  PullRequestSummary,
  RepoReadinessSummary,
} from "@/lib/github/types";

type PublicMember = {
  login: string;
};

type RepoContributor = {
  login?: string;
  type?: string;
};

type GraphQlRepoCounts = {
  data: {
    repository: {
      opened: { totalCount: number };
      merged: { totalCount: number };
      closed: { totalCount: number };
    } | null;
  };
};

type RepoRecentPullRequests = {
  repo: OrgRepo;
  pulls: PullRequestSummary[];
};

type RepoLabel = {
  name: string;
};

type IssueSummary = {
  id: number;
  pull_request?: Record<string, unknown>;
};

type CommunityProfile = {
  files?: {
    contributing?: {
      path?: string | null;
    } | null;
  } | null;
};

const ANALYSIS_WINDOW_DAYS = 90;

type AnalysisTarget =
  | {
      kind: "org";
      owner: string;
      repo: null;
      slug: string;
    }
  | {
      kind: "repo";
      owner: string;
      repo: string;
      slug: string;
    };

function isRateLimitError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("rate limit") ||
      error.message.includes("secondary rate limit") ||
      error.message.includes("GitHub request failed (403)") ||
      error.message.includes("GitHub request failed (429)"))
  );
}

async function runStage<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
  notes: string[],
) {
  try {
    return await work();
  } catch (error) {
    if (isRateLimitError(error)) {
      notes.push(`${label} was skipped because GitHub rate limits were reached for this refresh.`);
      return fallback;
    }

    notes.push(
      `${label} was skipped because one or more GitHub responses were incomplete or invalid during this refresh.`,
    );
    return fallback;
  }
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];

  for (const itemGroup of chunk(items, Math.max(concurrency, 1))) {
    const groupResults = await Promise.all(itemGroup.map((item) => mapper(item)));
    results.push(...groupResults);
  }

  return results;
}

async function paginate<T>(
  fetchPage: (page: number) => Promise<T[]>,
  shouldContinue?: (pageItems: T[]) => boolean,
) {
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await fetchPage(page);
    items.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }

    if (shouldContinue && !shouldContinue(pageItems)) {
      break;
    }
  }

  return items;
}

function roundPercent(value: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(1));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function isExternalAssociation(association: string) {
  return ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"].includes(association);
}

function isMaintainerAssociation(association: string) {
  return association === "COLLABORATOR";
}

function isOrgAssociation(association: string) {
  return association === "MEMBER" || association === "OWNER";
}

function normalizeLabelName(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isGoodFirstIssueLabel(value: string) {
  return normalizeLabelName(value) === "goodfirstissue";
}

function parseTarget(input: string): AnalysisTarget {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 1) {
    const owner = segments[0];
    return {
      kind: "org",
      owner,
      repo: null,
      slug: owner,
    };
  }

  if (segments.length === 2) {
    const [owner, repo] = segments;
    return {
      kind: "repo",
      owner,
      repo,
      slug: `${owner}/${repo}`,
    };
  }

  throw new Error('Enter either an organization slug like "nodejs" or a repository like "nodejs/node".');
}

async function fetchOrgRepos(client: GitHubClientPool, org: string) {
  return paginate<OrgRepo>((page) =>
    client.rest<OrgRepo[]>({
      path: `/orgs/${org}/repos`,
      query: {
        type: "public",
        sort: "updated",
        per_page: 100,
        page,
      },
    }),
  );
}

async function fetchSingleRepo(client: GitHubClientPool, owner: string, repo: string) {
  return client.rest<OrgRepo>({
    path: `/repos/${owner}/${repo}`,
  });
}

async function fetchPublicOrgMembers(client: GitHubClientPool, org: string) {
  return paginate<PublicMember>((page) =>
    client.rest<PublicMember[]>({
      path: `/orgs/${org}/public_members`,
      query: {
        per_page: 100,
        page,
      },
    }),
  );
}

async function fetchRepoContributors(client: GitHubClientPool, org: string, repo: string) {
  return paginate<RepoContributor>((page) =>
    client.rest<RepoContributor[]>({
      path: `/repos/${org}/${repo}/contributors`,
      query: {
        per_page: 100,
        page,
        anon: "false",
      },
    }),
  );
}

async function fetchRepoPullRequestCounts(client: GitHubClientPool, org: string, repo: string) {
  const payload = await client.graphQl<GraphQlRepoCounts>({
    query: `
      query RepoPullRequestCounts($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          opened: pullRequests(states: OPEN) { totalCount }
          merged: pullRequests(states: MERGED) { totalCount }
          closed: pullRequests(states: CLOSED) { totalCount }
        }
      }
    `,
    variables: {
      owner: org,
      repo,
    },
  });

  if (!payload.data.repository) {
    return { opened: 0, merged: 0, closed: 0 };
  }

  return {
    opened: payload.data.repository.opened.totalCount,
    merged: payload.data.repository.merged.totalCount,
    closed: payload.data.repository.closed.totalCount,
  };
}

async function fetchRepoLabels(client: GitHubClientPool, org: string, repo: string) {
  return paginate<RepoLabel>(async (page) => {
    const labels = await client.restOptional<RepoLabel[]>(
      {
        path: `/repos/${org}/${repo}/labels`,
        query: {
          per_page: 100,
          page,
        },
      },
      [404],
    );

    return labels ?? [];
  });
}

async function fetchOpenIssuesByLabel(
  client: GitHubClientPool,
  org: string,
  repo: string,
  label: string,
) {
  const issues = await paginate<IssueSummary>((page) =>
    client
      .restOptional<IssueSummary[]>(
        {
          path: `/repos/${org}/${repo}/issues`,
          query: {
            state: "open",
            labels: label,
            per_page: 100,
            page,
          },
        },
        [404, 410],
      )
      .then((issuesPage) => issuesPage ?? []),
  );

  return issues.filter((issue) => !issue.pull_request).length;
}

async function fetchCommunityProfile(client: GitHubClientPool, org: string, repo: string) {
  return client.restOptional<CommunityProfile>(
    {
      path: `/repos/${org}/${repo}/community/profile`,
    },
    [404],
  );
}

async function fetchRecentRepoPullRequests(
  client: GitHubClientPool,
  org: string,
  repo: OrgRepo,
  cutoffDate: Date,
) {
  const pulls = await paginate<PullRequestSummary>(
    (page) =>
      client.rest<PullRequestSummary[]>({
        path: `/repos/${org}/${repo.name}/pulls`,
        query: {
          state: "all",
          sort: "created",
          direction: "desc",
          per_page: 100,
          page,
        },
      }),
    (pageItems) => {
      if (pageItems.length === 0) {
        return false;
      }

      const oldest = new Date(pageItems[pageItems.length - 1].created_at);
      return oldest >= cutoffDate;
    },
  );

  return pulls.filter((pull) => new Date(pull.created_at) >= cutoffDate);
}

async function fetchPullRequestReviews(
  client: GitHubClientPool,
  org: string,
  repo: string,
  number: number,
) {
  return client.rest<PullRequestReview[]>({
    path: `/repos/${org}/${repo}/pulls/${number}/reviews`,
    query: {
      per_page: 100,
    },
  });
}

export async function analyzeOrganization(
  input: string,
  tokens: string[] = [],
): Promise<AnalyzeOrgResponse> {
  const target = parseTarget(input);
  const sanitizedTokens = tokens.map((token) => token.trim()).filter(Boolean);
  const client = new GitHubClientPool(sanitizedTokens);
  const generatedAt = new Date();
  const cutoffDate = new Date(generatedAt);
  cutoffDate.setDate(cutoffDate.getDate() - ANALYSIS_WINDOW_DAYS);
  const runtimeNotes: string[] = [];

  try {
    const repos =
      target.kind === "org"
        ? await fetchOrgRepos(client, target.owner)
        : [await fetchSingleRepo(client, target.owner, target.repo)];
    if (repos.length === 0) {
      throw new Error(`No public repositories found for "${target.slug}".`);
    }

    const publicMembers =
      target.kind === "org"
        ? await runStage(
            "Public org member collection",
            () => fetchPublicOrgMembers(client, target.owner),
            [],
            runtimeNotes,
          )
        : [];
    const observedOrgMembers = new Set(publicMembers.map((member) => member.login.toLowerCase()));

    const repoContributorLists = await runStage(
      "Contributor collection",
      () =>
        mapWithConcurrency(repos, Math.max(client.tokenCount, 1), (repo) =>
          fetchRepoContributors(client, target.owner, repo.name),
        ),
      repos.map(() => [] as RepoContributor[]),
      runtimeNotes,
    );
    const repoPullCounts = await runStage(
      "PR total collection",
      () =>
        mapWithConcurrency(repos, Math.max(client.tokenCount, 1), (repo) =>
          fetchRepoPullRequestCounts(client, target.owner, repo.name),
        ),
      repos.map(() => ({ opened: 0, merged: 0, closed: 0 })),
      runtimeNotes,
    );
    const repoRecentPulls = await runStage(
      "Recent PR collection",
      () =>
        mapWithConcurrency(repos, Math.max(client.tokenCount, 1), async (repo) => ({
          repo,
          pulls: await fetchRecentRepoPullRequests(client, target.owner, repo, cutoffDate),
        })),
      repos.map((repo) => ({ repo, pulls: [] as PullRequestSummary[] })),
      runtimeNotes,
    );
    const repoReadiness = await runStage(
      "Contributor readiness collection",
      () =>
        mapWithConcurrency(repos, Math.max(client.tokenCount, 1), async (repo) => {
          try {
            const [labels, communityProfile] = await Promise.all([
              fetchRepoLabels(client, target.owner, repo.name),
              fetchCommunityProfile(client, target.owner, repo.name),
            ]);
            const matchedLabel =
              labels.find((label) => isGoodFirstIssueLabel(label.name))?.name ?? null;
            const openGoodFirstIssues = matchedLabel
              ? await fetchOpenIssuesByLabel(client, target.owner, repo.name, matchedLabel)
              : 0;
            const contributingGuidePath = communityProfile?.files?.contributing?.path ?? null;

            return {
              repo: repo.name,
              goodFirstIssueLabel: matchedLabel,
              openGoodFirstIssues,
              hasContributingGuide: Boolean(contributingGuidePath),
              contributingGuidePath,
            } satisfies RepoReadinessSummary;
          } catch {
            return {
              repo: repo.name,
              goodFirstIssueLabel: null,
              openGoodFirstIssues: 0,
              hasContributingGuide: false,
              contributingGuidePath: null,
            } satisfies RepoReadinessSummary;
          }
        }),
      repos.map((repo) => ({
        repo: repo.name,
        goodFirstIssueLabel: null,
        openGoodFirstIssues: 0,
        hasContributingGuide: false,
        contributingGuidePath: null,
      })),
      runtimeNotes,
    );

    const contributorLogins = new Set<string>();
    for (const contributors of repoContributorLists) {
      for (const contributor of contributors) {
        if (contributor.login) {
          contributorLogins.add(contributor.login.toLowerCase());
        }
      }
    }

    const recentPulls = repoRecentPulls.flatMap((entry) =>
      entry.pulls.map((pull) => ({
        ...pull,
        repo: entry.repo.name,
      })),
    );

    const externalPulls = recentPulls.filter((pull) => isExternalAssociation(pull.author_association));
    const reviewsByPull = await runStage(
      "PR review collection",
      () =>
        mapWithConcurrency(
          externalPulls,
          Math.max(client.tokenCount, 1),
          async (pull) => ({
            repo: pull.repo,
            number: pull.number,
            reviews: await fetchPullRequestReviews(client, target.owner, pull.repo, pull.number),
          }),
        ),
      [] as Array<{ repo: string; number: number; reviews: PullRequestReview[] }>,
      runtimeNotes,
    );

    const reviewLookup = new Map<string, PullRequestReview[]>();
    for (const entry of reviewsByPull) {
      reviewLookup.set(`${entry.repo}#${entry.number}`, entry.reviews);
    }

    const maintainers = new Set<string>();
    const externalContributors = new Set<string>();
    const externalPullCounts = new Map<string, number>();
    const firstReviewLatencies: number[] = [];
    const mergeLatencies: number[] = [];

    const actorCounts = {
      external: 0,
      maintainer: 0,
      orgMember: 0,
      unknown: 0,
    };

    for (const pull of recentPulls) {
      const login = pull.user?.login?.toLowerCase();
      const association = pull.author_association;

      if (login) {
        if (isMaintainerAssociation(association)) {
          maintainers.add(login);
        } else if (isOrgAssociation(association)) {
          observedOrgMembers.add(login);
        } else if (isExternalAssociation(association)) {
          externalContributors.add(login);
          externalPullCounts.set(login, (externalPullCounts.get(login) ?? 0) + 1);
        }
      }

      if (isMaintainerAssociation(association)) {
        actorCounts.maintainer += 1;
      } else if (isOrgAssociation(association)) {
        actorCounts.orgMember += 1;
      } else if (isExternalAssociation(association)) {
        actorCounts.external += 1;
      } else {
        actorCounts.unknown += 1;
      }

      if (login && isExternalAssociation(association)) {
        const reviews = reviewLookup
          .get(`${pull.repo}#${pull.number}`)
          ?.filter((review) => Boolean(review.submitted_at))
          .sort((left, right) =>
            (left.submitted_at ?? "").localeCompare(right.submitted_at ?? ""),
          );
        const firstReview = reviews?.[0];

        if (firstReview?.submitted_at) {
          const reviewHours =
            (new Date(firstReview.submitted_at).getTime() - new Date(pull.created_at).getTime()) /
            3_600_000;
          if (reviewHours >= 0) {
            firstReviewLatencies.push(reviewHours);
          }
        }

        if (pull.merged_at) {
          const mergeHours =
            (new Date(pull.merged_at).getTime() - new Date(pull.created_at).getTime()) /
            3_600_000;
          if (mergeHours >= 0) {
            mergeLatencies.push(mergeHours);
          }
        }
      }
    }

    for (const login of observedOrgMembers) {
      externalContributors.delete(login);
      maintainers.delete(login);
    }

    for (const login of maintainers) {
      externalContributors.delete(login);
    }

    const totals = repoPullCounts.reduce(
      (sum, repoCount) => ({
        opened: sum.opened + repoCount.opened + repoCount.merged + repoCount.closed,
        merged: sum.merged + repoCount.merged,
        closed: sum.closed + repoCount.closed,
      }),
      { opened: 0, merged: 0, closed: 0 },
    );

    const notes = [
      "Org member counts combine public membership data with users observed as MEMBER or OWNER on recent PRs.",
      "Maintainer counts are approximated from public PR author associations and do not expose full collaborator permission grids.",
      "Contributor experience metrics are calculated only for external-contributor PRs opened in the last 90 days.",
      "Good first issue metrics look for labels normalized to `goodfirstissue`, so `good first issue` and `good-first-issue` are both counted.",
      "Contribution guide detection uses GitHub's public community profile data and may miss unconventional onboarding docs outside the standard contributing file path.",
      "Review fetches are limited to external-contributor PRs to reduce API pressure on large targets.",
      ...runtimeNotes,
    ];

    const topGoodFirstIssueRepos = [...repoReadiness]
      .filter((repo) => repo.openGoodFirstIssues > 0)
      .sort((left, right) => right.openGoodFirstIssues - left.openGoodFirstIssues)
      .slice(0, 5);
    const reposMissingContributingGuide = repoReadiness
      .filter((repo) => !repo.hasContributingGuide)
      .map((repo) => repo.repo)
      .sort((left, right) => left.localeCompare(right));

    const response: AnalyzeOrgResponse = {
      target: {
        kind: target.kind,
        owner: target.owner,
        repo: target.repo,
        slug: target.slug,
      },
      org: {
        login: target.slug,
        publicRepos: repos.length,
        archivedRepos: repos.filter((repo) => repo.archived).length,
      },
      snapshot: {
        generatedAt: generatedAt.toISOString(),
        tokensUsed: Math.max(client.tokenCount, 1),
        notes,
      },
      metrics: {
        vanity: {
          stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
          forks: repos.reduce((sum, repo) => sum + repo.forks_count, 0),
        },
        pullRequestTotals: totals,
        people: {
          uniqueRepoContributors: contributorLogins.size,
          orgMembers: observedOrgMembers.size,
          maintainers: maintainers.size,
          externalContributors: externalContributors.size,
        },
        contributorReadiness: {
          reposWithGoodFirstIssueLabel: repoReadiness.filter((repo) => repo.goodFirstIssueLabel)
            .length,
          reposWithOpenGoodFirstIssues: repoReadiness.filter(
            (repo) => repo.openGoodFirstIssues > 0,
          ).length,
          openGoodFirstIssues: repoReadiness.reduce(
            (sum, repo) => sum + repo.openGoodFirstIssues,
            0,
          ),
          reposWithContributingGuide: repoReadiness.filter((repo) => repo.hasContributingGuide)
            .length,
          reposWithoutContributingGuide: repoReadiness.filter(
            (repo) => !repo.hasContributingGuide,
          ).length,
        },
      },
      analysis: {
        window: {
          start: cutoffDate.toISOString(),
          end: generatedAt.toISOString(),
          label: "Last 90 days",
        },
        pullRequests: {
          total: recentPulls.length,
          byActor: {
            external: {
              count: actorCounts.external,
              percent: roundPercent(actorCounts.external, recentPulls.length),
            },
            maintainer: {
              count: actorCounts.maintainer,
              percent: roundPercent(actorCounts.maintainer, recentPulls.length),
            },
            orgMember: {
              count: actorCounts.orgMember,
              percent: roundPercent(actorCounts.orgMember, recentPulls.length),
            },
            unknown: {
              count: actorCounts.unknown,
              percent: roundPercent(actorCounts.unknown, recentPulls.length),
            },
          },
        },
        externalContributors: {
          uniqueContributors: externalContributors.size,
          repeatContributors: [...externalPullCounts.values()].filter((count) => count > 1)
            .length,
          averageHoursToFirstReview: average(firstReviewLatencies),
          averageHoursToMerge: average(mergeLatencies),
        },
        contributorReadiness: {
          repos: repoReadiness,
          topGoodFirstIssueRepos,
          reposMissingContributingGuide,
        },
      },
    };

    return response;
  } catch (error) {
    throw error;
  }
}
