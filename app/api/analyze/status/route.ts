import { NextRequest, NextResponse } from "next/server";
import { getAnalysisJob, getCompletedJobResult } from "@/lib/neon/jobs";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await getAnalysisJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const result = job.status === "completed" ? await getCompletedJobResult(jobId) : null;

  return NextResponse.json(
    {
      job: {
        id: job.id,
        status: job.status,
        errorMessage: job.error_message,
      },
      result,
    },
    { status: 200 },
  );
}
