-- AlterTable
ALTER TABLE "FabricSpec" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "dailyCapacity" DECIMAL(12,2);
