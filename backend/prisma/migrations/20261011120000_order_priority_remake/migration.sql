-- AlterTable
ALTER TABLE "Order" ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "remakeOfId" TEXT,
ADD COLUMN "note" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_remakeOfId_fkey" FOREIGN KEY ("remakeOfId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
