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
  owner: {
    login: string;
    type: "Organization" | "User";
  };
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
  hasMaintainerGuide: boolean;
  maintainerGuidePath: string | null;
};

export type SnapshotMetricChange = {
  label: string;
  previousValue: number;
  currentValue: number;
  percentageChange: number | null;
  tone: "positive" | "negative" | "neutral";
};

export type AnalyzeRepoResponse = {
  target: {
    owner: string;
    repo: string;
    slug: string;
  };
  repository: {
    name: string;
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
    archived: boolean;
    ownerType: "Organization" | "User";
  };
  snapshot: {
    generatedAt: string;
    cacheHit: boolean;
    baseSnapshotGeneratedAt: string | null;
    tokensUsed: number;
    notes: string[];
  };
  metrics: {
    vanity: {
      stars: number;
      forks: number;
      orgMembers: number;
      contributors: number;
    };
    pullRequests: {
      totalLast90Days: number;
      opened: number;
      merged: number;
      closed: number;
    };
    contributorExperience: {
      maintainers: number;
      externalContributors: number;
      repeatContributors: number;
      averageHoursToFirstReview: number | null;
      averageHoursToMerge: number | null;
    };
    contributorOnRamp: {
      hasContributingGuide: boolean;
      contributingGuidePath: string | null;
      hasMaintainerGuide: boolean;
      maintainerGuidePath: string | null;
      goodFirstIssueLabel: string | null;
      openGoodFirstIssues: number;
    };
  };
  analysis: {
    window: {
      start: string;
      end: string;
      label: string;
    };
    cache: {
      reusedPullRequests: number;
      refreshedPullRequests: number;
      reusedReviews: number;
      refreshedReviews: number;
    };
  };
  comparison: {
    previousSnapshotGeneratedAt: string | null;
    metrics: SnapshotMetricChange[];
  };
};

export type AnalyzeOrgResponse = AnalyzeRepoResponse;
