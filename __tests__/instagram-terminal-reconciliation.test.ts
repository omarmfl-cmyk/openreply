import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    automation: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
  comments: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/queue/client", () => ({ sendDmJob: mocks.send }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: vi.fn().mockResolvedValue({ provider: "META", accessToken: "token" }),
  getRecentMediaComments: mocks.comments,
  MetaApiError: class extends Error {},
}));
import { reconcileComments } from "@/lib/polling/comment-reconciler";

const automation = {
  id: "campaign", name: "Campaign", postId: "post", matchAnyWord: true,
  keywords: [], publicReplyEnabled: false, workspaceId: "workspace",
  instagramAccount: { id: "account", instagramId: "owner" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.automation.findMany.mockResolvedValue([automation]);
  mocks.prisma.$queryRaw.mockResolvedValue([]);
  mocks.prisma.operationalEvent.create.mockResolvedValue({});
  mocks.comments.mockResolvedValue([{
    id: "comment", text: "LINK", from: { id: "visitor" }, timestamp: new Date().toISOString(),
  }]);
});

describe.each([2534001, 2534025])("reconciliation of terminal subcode %s", (subcode) => {
  const log = { commentId: "comment", status: "FAILED", errorMessage: `PermissionError 100: rejected [code=100 sub=${subcode}]` };

  it.each([false, true])("does not loop when public reply is handled or disabled (%s)", async (publicReplyEnabled) => {
    mocks.prisma.automation.findMany.mockResolvedValue([{ ...automation, publicReplyEnabled }]);
    mocks.prisma.dmLog.findMany.mockResolvedValue([{ ...log, publicReplySentAt: publicReplyEnabled ? new Date() : null }]);
    await reconcileComments();
    await reconcileComments();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.prisma.dmLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { automationId: "campaign", commentId: { in: ["comment"] } },
      select: expect.objectContaining({ errorMessage: true, status: true }),
    }));
  });

  it("allows missing public reply, then stops after public success", async () => {
    mocks.prisma.automation.findMany.mockResolvedValue([{ ...automation, publicReplyEnabled: true }]);
    mocks.prisma.dmLog.findMany.mockResolvedValue([log]);
    await reconcileComments();
    expect(mocks.send).toHaveBeenCalledOnce();
    mocks.prisma.dmLog.findMany.mockResolvedValue([{ ...log, publicReplySentAt: new Date() }]);
    await reconcileComments();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});

it("still enqueues transient failed DMs", async () => {
  mocks.prisma.dmLog.findMany.mockResolvedValue([{ commentId: "comment", status: "FAILED", errorMessage: "MetaApiError 2: temporary outage" }]);
  await reconcileComments();
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("preserves Zernio delivery uncertainty", async () => {
  mocks.prisma.automation.findMany.mockResolvedValue([{ ...automation, publicReplyEnabled: true }]);
  mocks.prisma.dmLog.findMany.mockResolvedValue([{
    commentId: "comment", status: "FAILED", dmDeliveryUnconfirmed: true, publicReplyDeliveryUnconfirmed: true,
  }]);
  await reconcileComments();
  expect(mocks.send).not.toHaveBeenCalled();
});
