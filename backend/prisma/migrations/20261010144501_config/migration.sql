-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('QUANTITY', 'DEADLINE');

-- AlterTable
ALTER TABLE "RawMaterial" ADD COLUMN     "leadDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "FabricSpec" (
    "id" TEXT NOT NULL,
    "fabricType" TEXT NOT NULL,
    "materialId" TEXT,
    "yarnPerMetre" DECIMAL(8,4) NOT NULL,
    "wastagePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "pricePerMetre" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FabricSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRule" (
    "id" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "below" INTEGER NOT NULL,
    "pricePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wastagePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ConfigChange" (
    "id" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FabricSpec_fabricType_key" ON "FabricSpec"("fabricType");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRule_kind_below_key" ON "OrderRule"("kind", "below");

-- CreateIndex
CREATE INDEX "ConfigChange_changedAt_idx" ON "ConfigChange"("changedAt");

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricSpec" ADD CONSTRAINT "FabricSpec_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
