-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('LOGISTICS', 'UTILITIES');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PAID', 'UNPAID', 'ACCRUED');

-- AlterEnum
BEGIN;
CREATE TYPE "MaterialCategory_new" AS ENUM ('YARN', 'WEAVING', 'DYEING', 'FINISHING', 'QC', 'PACKAGING', 'MAINTENANCE');
ALTER TABLE "RawMaterial" ALTER COLUMN "category" DROP DEFAULT;
-- Old sections map onto the new ones; no row is dropped. Dyes and chemicals go to Dyeing (the
-- softener moves to Finishing below), anything filed under Other goes to Maintenance.
ALTER TABLE "RawMaterial" ALTER COLUMN "category" TYPE "MaterialCategory_new" USING (
  CASE "category"::text
    WHEN 'DYE' THEN 'DYEING'
    WHEN 'CHEMICAL' THEN CASE WHEN "yarnType" ILIKE '%soften%' THEN 'FINISHING' ELSE 'DYEING' END
    WHEN 'OTHER' THEN 'MAINTENANCE'
    ELSE "category"::text
  END
)::"MaterialCategory_new";
ALTER TYPE "MaterialCategory" RENAME TO "MaterialCategory_old";
ALTER TYPE "MaterialCategory_new" RENAME TO "MaterialCategory";
DROP TYPE "MaterialCategory_old";
ALTER TABLE "RawMaterial" ALTER COLUMN "category" SET DEFAULT 'YARN';
COMMIT;

-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'Gujarat';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itcEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxCode" TEXT,
ADD COLUMN     "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTreatment" TEXT,
ADD COLUMN     "totalAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "MaterialInward" ADD COLUMN     "batchNo" TEXT,
ADD COLUMN     "billNo" TEXT,
ADD COLUMN     "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itcEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxCode" TEXT,
ADD COLUMN     "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTreatment" TEXT,
ADD COLUMN     "totalAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "MaterialIssue" ADD COLUMN     "department" TEXT,
ADD COLUMN     "jobId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "RawMaterial" ADD COLUMN     "department" TEXT,
ADD COLUMN     "isSpare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "subcategory" TEXT,
ADD COLUMN     "taxCode" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'Gujarat';

-- AlterTable
ALTER TABLE "WagePayment" ADD COLUMN     "allowances" DECIMAL(12,2),
ADD COLUMN     "basic" DECIMAL(12,2),
ADD COLUMN     "daysWorked" DECIMAL(5,1),
ADD COLUMN     "deductions" DECIMAL(12,2),
ADD COLUMN     "gross" DECIMAL(12,2),
ADD COLUMN     "overtime" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "department" TEXT NOT NULL DEFAULT 'Production floor';

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "inwardId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "subcategory" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "payee" TEXT NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "method" TEXT,
    "reference" TEXT,
    "costCentre" TEXT NOT NULL,
    "orderId" TEXT,
    "dispatchId" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxTreatment" TEXT,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "itcEligible" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPayment_paidAt_idx" ON "SupplierPayment"("paidAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_inwardId_idx" ON "SupplierPayment"("inwardId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_voucherNo_key" ON "Expense"("voucherNo");

-- CreateIndex
CREATE INDEX "Expense_incurredAt_idx" ON "Expense"("incurredAt");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_sku_key" ON "RawMaterial"("sku");

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_inwardId_fkey" FOREIGN KEY ("inwardId") REFERENCES "MaterialInward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

