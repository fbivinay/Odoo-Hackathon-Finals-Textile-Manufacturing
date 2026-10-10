-- DropForeignKey
ALTER TABLE "MaterialIssue" DROP CONSTRAINT "MaterialIssue_orderId_fkey";

-- AlterTable
ALTER TABLE "MaterialIssue" ALTER COLUMN "orderId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
