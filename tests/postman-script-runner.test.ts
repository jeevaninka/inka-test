import { describe, expect, it } from 'vitest';
import { runPostmanTestScripts } from '@/lib/integrations/tool-clients';

const base = {
  statusCode: 200,
  statusText: 'OK',
  durationMs: 12,
  responseText: '{"ok":true}',
  responseHeaders: { 'content-type': 'application/json' },
  variables: {},
};

function runScript(source: string) {
  return runPostmanTestScripts({
    ...base,
    events: [{ listen: 'test', script: { exec: source.split('\n'), type: 'text/javascript' } }],
  });
}

describe('Postman script runner compatibility', () => {
  it('treats pm.execution.setNextRequest as a supported no-op', () => {
    const result = runScript(
      "pm.execution.setNextRequest('Next request');\npm.test('ok', () => pm.expect(pm.response.code).to.eql(200));"
    );
    expect(result.assertions.every((a) => a.passed)).toBe(true);
    expect(result.assertions.some((a) => a.scriptError)).toBe(false);
  });

  it('treats legacy postman.setNextRequest as a no-op', () => {
    const result = runScript('postman.setNextRequest(null);');
    expect(result.assertions).toHaveLength(0);
  });

  it('flags a thrown runtime exception as a script error, not a product failure', () => {
    const result = runScript('someUndefinedHelper();');
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]).toMatchObject({
      name: 'Test Script Execution',
      passed: false,
      scriptError: true,
    });
  });

  it('keeps a real assertion mismatch as a normal failure', () => {
    const result = runScript(
      "pm.test('title matches', () => pm.expect('Add Super Top-Up').to.eql('Super Top-Up Recommended'));"
    );
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].passed).toBe(false);
    expect(result.assertions[0].scriptError).toBeUndefined();
  });
});
