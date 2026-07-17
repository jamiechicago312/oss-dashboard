import { NextRequest, NextResponse } from "next/server";
import { analyzeOrganization } from "@/lib/github/analyze-org";

type RequestBody = {
  target?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const target = body.target?.trim();

    if (!target) {
      return NextResponse.json({ error: "Repository is required." }, { status: 400 });
    }

    const response = await analyzeOrganization(target);
    return NextResponse.json(response, { status: 200 });
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
