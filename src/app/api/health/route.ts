import { NextResponse } from "next/server";

/** Liveness probe. Returns 200 with basic build info; used by CI/hosting. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    app: "discoball",
    phase: "0-scaffold",
    time: new Date().toISOString(),
  });
}
