import { describe, it, expect } from 'vitest';
import { interpolateStepText } from '@/lib/variables';

describe('interpolateStepText', () => {
  it('returns empty string for undefined or null text', () => {
    expect(interpolateStepText(undefined)).toBe('');
    expect(interpolateStepText(null)).toBe('');
    expect(interpolateStepText('')).toBe('');
  });

  it('leaves text unchanged when no placeholders exist', () => {
    expect(interpolateStepText('Click on the submit button')).toBe('Click on the submit button');
  });

  it('interpolates resolved environment variables with {{VAR}} syntax', () => {
    const text = 'Navigate to {{BASE_URL}}/dashboard using account {{ADMIN_USER}}';
    const envVars = {
      BASE_URL: 'https://staging.inkaqa.io',
      ADMIN_USER: 'lead_qa',
    };
    expect(interpolateStepText(text, envVars)).toBe(
      'Navigate to https://staging.inkaqa.io/dashboard using account lead_qa'
    );
  });

  it('leaves unresolved {{VAR}} unchanged if not present in envVars', () => {
    const text = 'Use token {{SECRET_TOKEN}} with {{MISSING}}';
    const envVars = {
      SECRET_TOKEN: 'xyz-99',
    };
    expect(interpolateStepText(text, envVars)).toBe('Use token xyz-99 with {{MISSING}}');
  });

  it('interpolates dataset parameters with {param} syntax', () => {
    const text = 'Enter username {user} and password {pass}';
    const params = {
      user: 'alice@example.com',
      pass: 'secure123',
    };
    expect(interpolateStepText(text, null, params)).toBe(
      'Enter username alice@example.com and password secure123'
    );
  });

  it('handles both {{ENV_VAR}} and {param} in the same string', () => {
    const text = 'Open {{BASE_URL}} and login as {role} with ID {id}';
    const envVars = { BASE_URL: 'https://test.inkaqa.io' };
    const params = { role: 'Auditor', id: 42 };
    expect(interpolateStepText(text, envVars, params)).toBe(
      'Open https://test.inkaqa.io and login as Auditor with ID 42'
    );
  });

  it('does not confuse double braces with single braces', () => {
    const text = '{{VAR}} vs {param}';
    const envVars = { VAR: 'ENV_VAL' };
    const params = { param: 'PARAM_VAL' };
    expect(interpolateStepText(text, envVars, params)).toBe('ENV_VAL vs PARAM_VAL');
  });
});
