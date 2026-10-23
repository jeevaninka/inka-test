import { describe, it, expect } from 'vitest';
import {
  resolveParameterizedTemplate,
  executeDatadogSyntheticsRun,
  mapPostmanCollectionToRequestItems,
  extractPostmanAssertions,
  runPostmanTestScripts,
  formatPostmanRequestAsStep,
  buildJourneyCaseTitle,
  detectRecommendedPostmanStructureMode,
} from '@/lib/integrations/tool-clients';

describe('Postman & Datadog Parameterized Runner Engine', () => {
  it('interpolates both {{VAR}} environment variables and {param} dataset parameters without corrupting JSON braces', () => {
    const vars = {
      BASE_URL: 'https://staging-api.inka.io',
      API_TOKEN: 'secret-jwt-999',
      username: 'qa_tester_1',
      role: 'admin',
    };

    const url = resolveParameterizedTemplate('{{BASE_URL}}/v1/users/{username}?role={{role}}', vars);
    expect(url).toBe('https://staging-api.inka.io/v1/users/qa_tester_1?role=admin');

    const jsonBody = resolveParameterizedTemplate(
      '{"user": "{username}", "token": "{{API_TOKEN}}", "nested": {"active": true}}',
      vars
    );
    expect(jsonBody).toBe(
      '{"user": "qa_tester_1", "token": "secret-jwt-999", "nested": {"active": true}}'
    );
  });

  it('extracts Policy Review folder requests, preserves canonical collection order, and parses pm.test assertions', () => {
    const mockApiAutomationCollectionItems = [
      {
        name: 'Authentication',
        item: [
          {
            name: 'Login Agent',
            request: {
              method: 'POST',
              url: { raw: '{{BASE_URL}}/v1/auth/login' },
              body: { mode: 'raw', raw: '{"email":"{{AGENT_EMAIL}}"}' },
            },
          },
        ],
      },
      {
        name: 'Policy Review',
        item: [
          {
            name: 'Submit Policy for Underwriting Review',
            request: {
              method: 'POST',
              url: { raw: '{{BASE_URL}}/v1/policies/{policyId}/review' },
              description: 'Submits policy payload for review rules check',
              body: { mode: 'raw', raw: '{"policyType":"TERM_LIFE","coverageAmount":500000}' },
            },
            event: [
              {
                listen: 'test',
                script: {
                  exec: [
                    'pm.test("Status code is 200", function () { pm.response.to.have.status(200); });',
                    'pm.test("Review status is PENDING_APPROVAL or APPROVED", function () {});',
                  ],
                },
              },
            ],
          },
          {
            name: 'Get Policy Review Decision',
            request: {
              method: 'GET',
              url: '{{BASE_URL}}/v1/policies/{policyId}/review/status',
            },
            event: [
              {
                listen: 'test',
                script: {
                  exec: ['tests["Decision payload contains reviewerId"] = true;'],
                },
              },
            ],
          },
        ],
      },
    ];

    const allItems = mapPostmanCollectionToRequestItems(mockApiAutomationCollectionItems);
    expect(allItems).toHaveLength(3);
    expect(allItems[0].folderPath).toBe('Authentication');
    expect(allItems[0].requiredVariables).toEqual(['BASE_URL', 'AGENT_EMAIL']);
    expect(allItems[1].folderPath).toBe('Policy Review');
    expect(allItems[1].requiredVariables).toEqual(['BASE_URL']);
    expect(allItems[2].folderPath).toBe('Policy Review');

    const policyReviewItems = mapPostmanCollectionToRequestItems(
      mockApiAutomationCollectionItems,
      'Policy Review'
    );
    expect(policyReviewItems).toHaveLength(2);
    // Canonical collection order is preserved (2 and 3) so selectedRequestOrders matches
    expect(policyReviewItems[0].order).toBe(2);
    expect(policyReviewItems[0].method).toBe('POST');
    expect(policyReviewItems[0].name).toBe('Submit Policy for Underwriting Review');
    expect(policyReviewItems[0].assertions).toEqual([
      'Status code is 200',
      'Review status is PENDING_APPROVAL or APPROVED',
    ]);
    expect(policyReviewItems[0].bodyPreview).toContain('TERM_LIFE');

    expect(policyReviewItems[1].order).toBe(3);
    expect(policyReviewItems[1].method).toBe('GET');
    expect(policyReviewItems[1].assertions).toEqual(['Decision payload contains reviewerId']);
  });

  it('extractPostmanAssertions handles empty or non-test events gracefully', () => {
    expect(extractPostmanAssertions(undefined)).toEqual([]);
    expect(extractPostmanAssertions([{ listen: 'prerequest', script: { exec: ['pm.test("ignored")'] } }])).toEqual([]);
  });

  it('supports multi-pass nested variable interpolation (e.g. {{base_api_url}} -> {{host}}/api)', () => {
    const vars = {
      host: 'https://uat-api.inkasure.com',
      base_api_url: '{{host}}/v1',
    };
    expect(
      resolveParameterizedTemplate('{{base_api_url}}/core/review-policy-document', vars)
    ).toBe('https://uat-api.inkasure.com/v1/core/review-policy-document');
  });

  it('executes Postman pm.test() and pm.expect() scripts, captures pass/fail assertions, and updates variables', () => {
    const events = [
      {
        listen: 'test',
        script: {
          exec: [
            'pm.test("Status code is 200", function () {',
            '  pm.response.to.have.status(200);',
            '});',
            'pm.test("Response is valid JSON and has policy_name", function () {',
            '  const jsonData = pm.response.json();',
            '  pm.expect(jsonData).to.be.an("object");',
            '  pm.expect(jsonData).to.have.property("policy_name", "Health Shield Plus");',
            '  pm.expect(jsonData.score).to.be.above(80);',
            '  pm.environment.set("review_id", jsonData.review_id);',
            '});',
            'pm.test("Failing assertion example", function () {',
            '  const jsonData = pm.response.json();',
            '  pm.expect(jsonData.status).to.equal("REJECTED");',
            '});',
          ],
        },
      },
    ];

    const res = runPostmanTestScripts({
      events,
      statusCode: 200,
      statusText: 'OK',
      durationMs: 185,
      responseText: JSON.stringify({
        review_id: 'rev-991',
        policy_name: 'Health Shield Plus',
        status: 'APPROVED',
        score: 95,
      }),
      responseHeaders: { 'content-type': 'application/json' },
      variables: { base_api_url: 'https://uat-api.inkasure.com' },
    });

    expect(res.assertions).toHaveLength(3);
    expect(res.assertions[0]).toEqual({ name: 'Status code is 200', passed: true });
    expect(res.assertions[1]).toEqual({
      name: 'Response is valid JSON and has policy_name',
      passed: true,
    });
    expect(res.assertions[2].name).toBe('Failing assertion example');
    expect(res.assertions[2].passed).toBe(false);
    expect(res.assertions[2].error).toContain('APPROVED');
    expect(res.updatedVariables.review_id).toBe('rev-991');
  });

  it('transforms Postman requests into clean steps with multi-line assertion checklists and detects independent vs journey modes', () => {
    const policyReviewRequests = [
      {
        order: 1,
        name: 'Policy Review with Policy Name - Health',
        folderPath: 'Policy Review',
        method: 'POST',
        url: '{{base_api_url}}/core/review-policy-document',
        bodyPreview: '{"product_name":"HDFC Ergo Optima Secure","sum_insured":2000000}',
        assertions: [
          'Status code is 200',
          'Response time isbelow 60s',
          'Status is success',
          'Policy details are correct',
        ],
      },
      {
        order: 2,
        name: 'Policy Review with Policy Name - Health Policy Upload',
        folderPath: 'Policy Review',
        method: 'POST',
        url: '{{base_api_url}}/core/review-policy-document',
        bodyPreview: '{"policy_document":"https://policy-review-docs.s3.ap-south-1.amazonaws.com/sample.pdf"}',
        assertions: ['Status code is 200', 'Policy details are correct'],
      },
      {
        order: 3,
        name: 'Policy Review with Policy Name - Super Top-Up',
        folderPath: 'Policy Review',
        method: 'POST',
        url: '{{base_api_url}}/core/review-policy-document',
        bodyPreview: '{"product_name":"ICICI Lombard Activate Booster","sum_insured":10000000}',
        assertions: ['Status code is 200', 'Coverage flag type is Super Top-Up Policy'],
      },
    ];

    expect(detectRecommendedPostmanStructureMode(policyReviewRequests)).toBe('independent');

    const flowTitle = buildJourneyCaseTitle('Policy Review', policyReviewRequests, 'API Automation');
    expect(flowTitle).toBe('Policy Review — Health / Health Policy Upload / Super Top-Up');

    const requestSteps = formatPostmanRequestAsStep(policyReviewRequests[0], 1);
    // The first entry is the request action; each assertion becomes its own verify step.
    expect(requestSteps[0].step).toBe(
      'Execute "Policy Review with Policy Name - Health" API request (POST /core/review-policy-document)'
    );
    expect(requestSteps[0].data).toBe(
      JSON.stringify({ product_name: 'HDFC Ergo Optima Secure', sum_insured: 2000000 }, null, 2)
    );
    expect(requestSteps.map((s) => s.step)).toEqual([
      'Execute "Policy Review with Policy Name - Health" API request (POST /core/review-policy-document)',
      'Verify: Status code is 200',
      'Verify: Response time isbelow 60s',
      'Verify: Status is success',
      'Verify: Policy details are correct',
    ]);
    expect(requestSteps.slice(1).map((s) => s.expectedResult)).toEqual([
      'Check that Status code is 200',
      'Check that Response time isbelow 60s',
      'Check that Status is success',
      'Check that Policy details are correct',
    ]);

    // Module folder with unrelated requests (e.g. IP Details) is detected as 'independent'
    const ipDetailsModuleRequests = [
      {
        order: 1,
        name: 'Super Top-Up Premium Calculator',
        folderPath: 'IP Details',
        method: 'POST',
        url: '{{base_api_url}}/core/premium/calculator',
      },
      {
        order: 2,
        name: 'Get Network Hospitals - IP Details',
        folderPath: 'IP Details',
        method: 'POST',
        url: '{{base_api_url}}/core/static/get-network-hospitals',
      },
      {
        order: 3,
        name: 'Raise Claim',
        folderPath: 'IP Details',
        method: 'POST',
        url: '{{base_api_url}}/core/raise-claim',
      },
      {
        order: 4,
        name: 'Vaani - Session Start - Homepage',
        folderPath: 'IP Details',
        method: 'POST',
        url: '{{base_bot_api_url}}/api/agent/launch',
      },
    ];
    expect(detectRecommendedPostmanStructureMode(ipDetailsModuleRequests, 'IP Details')).toBe(
      'independent'
    );

    // Multi-endpoint lifecycle flow (Create -> Upload -> Approve) detected as 'journey'
    const purchaseJourneyRequests = [
      {
        order: 1,
        name: 'Create Quote Draft',
        folderPath: 'Purchase',
        method: 'POST',
        url: '{{base_api_url}}/quotes',
      },
      {
        order: 2,
        name: 'Upload KYC Document',
        folderPath: 'Purchase',
        method: 'POST',
        url: '{{base_api_url}}/kyc/upload',
      },
      {
        order: 3,
        name: 'Approve & Issue Policy',
        folderPath: 'Purchase',
        method: 'POST',
        url: '{{base_api_url}}/policies/issue',
      },
    ];
    expect(detectRecommendedPostmanStructureMode(purchaseJourneyRequests, 'Purchase')).toBe(
      'journey'
    );
  });

  it('supports Datadog Synthetics executionRule=skipped without network call', async () => {
    const res = await executeDatadogSyntheticsRun(
      {
        site: 'datadoghq.com',
        apiKey: 'dd-api-key-test',
        appKey: 'dd-app-key-test',
      },
      {
        publicIds: ['abc-123-def', 'xyz-789-uvw'],
        executionRule: 'skipped',
      }
    );

    expect(res.provider).toBe('datadog');
    expect(res.overallStatus).toBe('SKIP');
    expect(res.steps).toHaveLength(2);
    expect(res.stepResults['1'].status).toBe('skip');
    expect(res.stepResults['2'].status).toBe('skip');
  });
});
