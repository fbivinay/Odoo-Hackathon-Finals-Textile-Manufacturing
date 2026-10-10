-- The column default stamped existing logins with the database clock (local time);
-- start them from when they were created so the Employees list orders correctly.
UPDATE "User" SET "updatedAt" = "createdAt";
