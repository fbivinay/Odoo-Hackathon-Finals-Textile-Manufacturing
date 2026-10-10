-- AlterTable ("priority" is added by 20261011120000_order_priority_remake)
ALTER TABLE "Order" ADD COLUMN     "replacesOrderId" TEXT;

-- AlterTable
ALTER TABLE "Roll" ADD COLUMN     "replacementOrderId" TEXT,
ADD COLUMN     "reworkStage" "Stage";
