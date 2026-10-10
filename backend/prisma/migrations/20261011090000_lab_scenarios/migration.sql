-- CreateEnum
CREATE TYPE "LabDecision" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "LabScenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "costs" JSONB NOT NULL,
    "days" INTEGER NOT NULL,
    "result" JSONB,
    "snapshotAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3),
    "decision" "LabDecision" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabScenario_pkey" PRIMARY KEY ("id")
);

