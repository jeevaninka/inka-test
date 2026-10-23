-- Password reset tokens for the self-service "forgot password" flow.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "password_reset_token" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "password_reset_expires" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_password_reset_token_key"
  ON "User"("password_reset_token");
