-- Add a distinct Error outcome for runner/script limitations.
-- A script exception (e.g. an unsupported Postman `pm` API) means the check
-- could not be evaluated; it must never be counted as a product failure.
ALTER TYPE "ResultStatus" ADD VALUE IF NOT EXISTS 'ERROR';
