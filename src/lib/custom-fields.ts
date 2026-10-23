export const MAX_CUSTOM_FIELDS_PER_ENTITY = 15;
export const MAX_KEY_NAME_LENGTH = 30;
export const MAX_OPTION_LENGTH = 30;
export const MAX_OPTIONS_COUNT = 20;
export const MAX_TEXT_VALUE_LENGTH = 100;

export function sanitizeFieldKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_KEY_NAME_LENGTH);
}
