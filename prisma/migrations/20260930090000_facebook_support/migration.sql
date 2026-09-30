-- CreateEnum
CREATE TYPE "FacebookReplyStatus" AS ENUM ('PENDING', 'UNCONFIRMED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "FacebookPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookCampaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "automationId" TEXT,
    "name" TEXT NOT NULL,
    "postId" TEXT,
    "matchAnyPost" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[],
    "matchAnyWord" BOOLEAN NOT NULL DEFAULT false,
    "wholeWordMatch" BOOLEAN NOT NULL DEFAULT true,
    "privateReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "privateReplyMessage" TEXT NOT NULL,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicReplyMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookDelivery" (
    "id" TEXT NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "commenterId" TEXT NOT NULL,
    "commenterName" TEXT,
    "commentText" TEXT NOT NULL,
    "matchedKeyword" TEXT,
    "commentCreatedAt" TIMESTAMP(3) NOT NULL,
    "publicStatus" "FacebookReplyStatus" NOT NULL DEFAULT 'PENDING',
    "privateStatus" "FacebookReplyStatus" NOT NULL DEFAULT 'PENDING',
    "publicError" TEXT,
    "privateError" TEXT,
    "publicReplyId" TEXT,
    "privateReplyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookPrivateClaim" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookPrivateClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPage_pageId_key" ON "FacebookPage"("pageId");

-- CreateIndex
CREATE INDEX "FacebookPage_workspaceId_idx" ON "FacebookPage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookCampaign_automationId_key" ON "FacebookCampaign"("automationId");

-- CreateIndex
CREATE INDEX "FacebookCampaign_workspaceId_idx" ON "FacebookCampaign"("workspaceId");

-- CreateIndex
CREATE INDEX "FacebookCampaign_facebookPageId_isActive_idx" ON "FacebookCampaign"("facebookPageId", "isActive");

-- CreateIndex
CREATE INDEX "FacebookDelivery_createdAt_idx" ON "FacebookDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookDelivery_facebookPageId_campaignId_commentId_key" ON "FacebookDelivery"("facebookPageId", "campaignId", "commentId");

-- AddForeignKey
ALTER TABLE "FacebookPage" ADD CONSTRAINT "FacebookPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookCampaign" ADD CONSTRAINT "FacebookCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookCampaign" ADD CONSTRAINT "FacebookCampaign_facebookPageId_fkey" FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookCampaign" ADD CONSTRAINT "FacebookCampaign_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookDelivery" ADD CONSTRAINT "FacebookDelivery_facebookPageId_fkey" FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookDelivery" ADD CONSTRAINT "FacebookDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "FacebookCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
