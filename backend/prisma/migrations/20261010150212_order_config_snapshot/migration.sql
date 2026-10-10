-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "listPrice" DECIMAL(12,2),
ADD COLUMN     "wastagePct" DECIMAL(5,2),
ADD COLUMN     "yarnPerMetre" DECIMAL(8,4);
