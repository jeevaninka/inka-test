-- Compact, display-safe provider metadata for imported steps.
-- Datadog imports store only: stepId, badges, subtest group, source test id and
-- variable names. Raw provider payloads/locators are never stored.
ALTER TABLE "TestCaseStep" ADD COLUMN "meta" TEXT;
