-- Legacy Datadog imports could link one repository case to several Synthetic
-- tests. The import picker now considers a test imported only when a case is
-- linked to exactly one public id. Soft-delete combined cases so the tests can
-- be imported individually while existing run history stays intact.
UPDATE "TestCase"
SET
  "deleted_at" = NOW(),
  "updated_at" = NOW()
WHERE
  "deleted_at" IS NULL
  AND jsonb_typeof("custom_fields" -> '_datadog' -> 'publicIds') = 'array'
  AND jsonb_array_length("custom_fields" -> '_datadog' -> 'publicIds') > 1;
