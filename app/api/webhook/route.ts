import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  parseCommentEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import { processInstagramWebhook } from "@/lib/queue/process-webhook";
import { processFacebookWebhook } from "@/lib/facebook/queue";
import { facebookEnabled } from "@/lib/facebook/config";
import { verifyFacebookSignature } from "@/lib/facebook/webhook";


export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (facebookEnabled() && mode === "subscribe" && token && token === process.env.FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // Inspect only the envelope before authentication; never process unsigned data.
  let envelope: unknown;
  try { envelope = JSON.parse(rawBody); } catch { /* Existing invalid-JSON path below. */ }
  const isPage = typeof envelope === "object" && envelope !== null && "object" in envelope && envelope.object === "page";
  if (isPage) {
    if (!facebookEnabled()) return NextResponse.json({ success: true });
    if (!verifyFacebookSignature(rawBody, signature)) return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    try {
      await processFacebookWebhook(envelope);
      return NextResponse.json({ success: true });
    } catch {
      return NextResponse.json({ success: false, error: "Facebook webhook processing failed" }, { status: 500 });
    }
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Record the attempt so a signature mismatch is visible rather than a
    // silent 401. This is the common symptom of FACEBOOK_APP_SECRET being
    // set to the wrong app's secret for the webhook's signing key.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Webhook signature verification failed",
          payload: {
            hadSignatureHeader: Boolean(signature),
            bodyLength: rawBody.length,
            bodyPreview: rawBody.slice(0, 200),
          },
        },
      })
      .catch(() => {});
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  try {
    if (typeof payload === "object" && payload !== null && "object" in payload && payload.object === "instagram") {
      await processInstagramWebhook({ payload: payload as Parameters<typeof parseCommentEvents>[0], provider: 'META' });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Webhook processing failed' }, { status: 500 });
  }
}
