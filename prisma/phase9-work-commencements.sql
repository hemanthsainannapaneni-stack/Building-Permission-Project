-- CreateTable
CREATE TABLE "work_commencements" (
    "id" TEXT NOT NULL,
    "commencementNumber" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOTIFIED',
    "approvalOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderIssuedAt" TIMESTAMP(3) NOT NULL,
    "orderValidUntil" TIMESTAMP(3),
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ltpUserId" TEXT NOT NULL,
    "ltpName" TEXT NOT NULL DEFAULT '',
    "ltpLicenceNo" TEXT NOT NULL DEFAULT '',
    "contractorName" TEXT NOT NULL,
    "contractorLicenceNo" TEXT NOT NULL DEFAULT '',
    "contractorPhone" TEXT NOT NULL DEFAULT '',
    "contractorAddress" TEXT NOT NULL DEFAULT '',
    "commencementDate" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "remarks" TEXT NOT NULL DEFAULT '',
    "notifiedById" TEXT,
    "notifiedByName" TEXT NOT NULL DEFAULT '',
    "notifiedByRoleKey" TEXT NOT NULL DEFAULT '',
    "stageCode" TEXT NOT NULL DEFAULT '',
    "workflowSequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_commencements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_commencements_commencementNumber_key" ON "work_commencements"("commencementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "work_commencements_applicationId_key" ON "work_commencements"("applicationId");

-- CreateIndex
CREATE INDEX "work_commencements_commencementDate_idx" ON "work_commencements"("commencementDate");

-- AddForeignKey
ALTER TABLE "work_commencements" ADD CONSTRAINT "work_commencements_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

