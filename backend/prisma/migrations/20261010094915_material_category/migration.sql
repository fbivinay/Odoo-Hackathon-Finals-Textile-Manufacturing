-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('YARN', 'DYE', 'CHEMICAL', 'PACKAGING', 'OTHER');

-- AlterTable
ALTER TABLE "RawMaterial" ADD COLUMN     "category" "MaterialCategory" NOT NULL DEFAULT 'YARN';
