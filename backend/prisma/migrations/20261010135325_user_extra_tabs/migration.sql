-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraTabs" TEXT[] DEFAULT ARRAY[]::TEXT[];
