import { after, NextRequest, NextResponse } from "next/server";
import { analyzeOrganization } from "@/lib/github/analyze-org";
import {
  createAnalysisJob,
  ensureAnalysisJobsTable,
  getActiveAnalysisJob,
  markAnalysisJobCompleted,
  markAnalysisJobFailed,
  markAnalysisJobRunning,
} from "@/lib/neon/jobs";
import { isSnapshotStoreConfigured, loadLatestSnapshot } from "@/lib/neon/snapshots";

export const maxDuration = 300;

type RequestBody = {
  target?: string;
};

function parseTarget(input: string) {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length !== 2) {
    throw new Error('Enter a GitHub repository in "owner/repo" format.');
  }

  const [owner, repo] = segments;
  return { owner, repo, slug: `${owner}/${repo}` };
}

async function runRefreshJob(jobId: string, target: string) {
  try {
    await markAnalysisJobRunning(jobId);
    await analyzeOrganization(target);
    await markAnalysisJobCompleted(jobId);
  } catch (error) {
    await markAnalysisJobFailed(
      jobId,
      error instanceof Error ? error.message : "Unknown analysis job failure.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const target = body.target?.trim();

    if (!target) {
      return NextResponse.json({ error: "Repository is required." }, { status: 400 });
    }

    if (!isSnapshotStoreConfigured()) {
      const response = await analyzeOrganization(target);
      return NextResponse.json(
        {
          mode: "sync",
          result: response,
          isStale: false,
          job: null,
        },
        { status: 200 },
      );
    }

    await ensureAnalysisJobsTable();

    const parsedTarget = parseTarget(target);
    const cachedSnapshot = await loadLatestSnapshot(parsedTarget.owner, parsedTarget.repo);
    const cachedResult = (cachedSnapshot?.payload ?? null) as Awaited<ReturnType<typeof analyzeOrganization>> | null;

    let activeJob = await getActiveAnalysisJob(parsedTarget.owner, parsedTarget.repo);

    if (!activeJob) {
      const jobId = await createAnalysisJob(parsedTarget.owner, parsedTarget.repo);
      if (!jobId) {
        throw new Error("Failed to create analysis job.");
      }

      after(async () => {
        await runRefreshJob(jobId, target);
      });

      activeJob = await getActiveAnalysisJob(parsedTarget.owner, parsedTarget.repo);
    }

    return NextResponse.json(
      {
        mode: "async",
        result: cachedResult,
        isStale: Boolean(cachedResult),
        job: activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
            }
          : null,
      },
      { status: cachedResult ? 200 : 202 },
    );
  } catch (error) {
    console.error("Repository analysis failed", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
