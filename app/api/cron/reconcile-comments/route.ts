import { seedReconciliation } from "@/lib/queue/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily recovery on Hobby; also call immediately after promotion or rollback.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  return Response.json({ success: true, data: await seedReconciliation() });
}
