export type OrgRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
};

export type PullRequestSummary = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  draft: boolean;
  author_association: string;
  user: {
    login: string;
  } | null;
};

export type PullRequestReview = {
  id: number;
  state: string;
  submitted_at: string | null;
  user: {
    login: string;
  } | null;
};

export type RepoReadinessSummary = {
  repo: string;
  goodFirstIssueLabel: string | null;
  openGoodFirstIssues: number;
  hasContributingGuide: boolean;
  contributingGuidePath: string | null;
};

export type AnalyzeOrgResponse = {
  target: {
    kind: "org" | "repo";
    owner: string;
    repo: string | null;
    slug: string;
  };
  org: {
    login: string;
    publicRepos: number;
    archivedRepos: number;
  };
  snapshot: {
    generatedAt: string;
    orgDirectory: string;
    tokensUsed: number;
    notes: string[];
  };
  metrics: {
    vanity: {
      stars: number;
      forks: number;
    };
    pullRequestTotals: {
      opened: number;
      merged: number;
      closed: number;
    };
    people: {
      uniqueRepoContributors: number;
      orgMembers: number;
      maintainers: number;
      externalContributors: number;
    };
    contributorReadiness: {
      reposWithGoodFirstIssueLabel: number;
      reposWithOpenGoodFirstIssues: number;
      openGoodFirstIssues: number;
      reposWithContributingGuide: number;
      reposWithoutContributingGuide: number;
    };
  };
  analysis: {
    window: {
      start: string;
      end: string;
      label: string;
    };
    pullRequests: {
      total: number;
      byActor: Record<
        "external" | "maintainer" | "orgMember" | "unknown",
        {
          count: number;
          percent: number;
        }
      >;
    };
    externalContributors: {
      uniqueContributors: number;
      repeatContributors: number;
      averageHoursToFirstReview: number | null;
      averageHoursToMerge: number | null;
    };
    contributorReadiness: {
      repos: RepoReadinessSummary[];
      topGoodFirstIssueRepos: RepoReadinessSummary[];
      reposMissingContributingGuide: string[];
    };
  };
};
