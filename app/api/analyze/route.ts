import { NextRequest, NextResponse } from "next/server";
import { analyzeOrganization } from "@/lib/github/analyze-org";

type RequestBody = {
  org?: string;
  target?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const org = body.target?.trim() ?? body.org?.trim();

    if (!org) {
      return NextResponse.json({ error: "Organization is required." }, { status: 400 });
    }

    const response = await analyzeOrganization(org);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Organization analysis failed", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
