/**
 * Variables & Parameters Parsing and Resolution Engine
 *
 * Syntax Distinction:
 * - {{VARIABLE_KEY}}: Environment Variables (Infrastructure-dependent, resolves via Environment -> Default)
 * - {param_name}:     Dataset Parameters (Data-driven scenario values, resolves via current iteration row)
 */

export function extractEnvironmentVariableKeys(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g);
  return [...new Set(Array.from(matches).map((m) => m[1]))];
}

export function extractDatasetParameterKeys(text?: string | null): string[] {
  if (!text) return [];
  // Single brace not preceded or followed by another brace
  const matches = text.matchAll(/(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})/g);
  return [...new Set(Array.from(matches).map((m) => m[1]))];
}

export function extractAllTokens(text?: string | null): {
  envVars: string[];
  params: string[];
} {
  return {
    envVars: extractEnvironmentVariableKeys(text),
    params: extractDatasetParameterKeys(text),
  };
}

// Backwards-compatible alias
export function extractVariableKeys(text: string): string[] {
  return extractEnvironmentVariableKeys(text);
}

export function isValidVariableKey(key: string): boolean {
  return /^[A-Z0-9_]+$/.test(key);
}

export function isValidParameterKey(key: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(key);
}

/**
 * Precedence Rule:
 * 1. Local Case Variable (if test case defined an override)
 * 2. Environment-Specific Value (for the selected environment)
 * 3. Project Default Fallback (Variable.default_value)
 * 4. Missing (unresolved)
 */
export function resolveVariableValue(
  key: string,
  testCaseId?: string | null,
  localVarsMap?: Map<string, Map<string, string>>,
  envValuesMap?: Map<string, string>,
  defaultsMap?: Map<string, string>,
  snapshot?: Record<string, string>
): { value: string | undefined; source: 'snapshot' | 'local' | 'environment' | 'default' | 'missing' } {
  if (snapshot && snapshot[key] !== undefined) {
    return { value: snapshot[key], source: 'snapshot' };
  }

  if (testCaseId && localVarsMap) {
    const locals = localVarsMap.get(testCaseId);
    if (locals && locals.has(key) && locals.get(key) !== '') {
      return { value: locals.get(key)!, source: 'local' };
    }
  }

  if (envValuesMap && envValuesMap.has(key) && envValuesMap.get(key) !== '') {
    return { value: envValuesMap.get(key)!, source: 'environment' };
  }

  if (defaultsMap && defaultsMap.has(key) && defaultsMap.get(key) !== '') {
    return { value: defaultsMap.get(key)!, source: 'default' };
  }

  return { value: undefined, source: 'missing' };
}

/**
 * Interpolates text by substituting:
 * 1. {{ENV_VAR}} with resolved environment variables
 * 2. {param} with active iteration dataset parameters
 */
export function interpolateStepText(
  text?: string | null,
  resolvedEnvVars?: Record<string, string> | null,
  iterationParams?: Record<string, any> | null
): string {
  if (!text) return '';

  let output = text;

  // 1. Resolve {{ENV_VAR}}
  if (resolvedEnvVars) {
    output = output.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
      if (resolvedEnvVars[key] !== undefined) {
        return resolvedEnvVars[key];
      }
      return match;
    });
  }

  // 2. Resolve {param}
  if (iterationParams) {
    output = output.replace(/(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})/g, (match, key) => {
      if (iterationParams[key] !== undefined && iterationParams[key] !== null) {
        return String(iterationParams[key]);
      }
      return match;
    });
  }

  return output;
}

export function buildResolvedVariables(
  projectId: string,
  environmentId: string,
  steps: { test_case_id: string; step: string; expected_result?: string | null; data?: string | null }[],
  localVarsMap: Map<string, Map<string, string>>,
  globalVars: Map<string, string>,
  envValues: Map<string, string>,
  defaults: Map<string, string>
): Record<string, string> {
  const snapshot: Record<string, string> = {};

  for (const step of steps) {
    const combinedText = `${step.step || ''} ${step.expected_result || ''} ${step.data || ''}`;
    const keys = extractEnvironmentVariableKeys(combinedText);

    for (const key of keys) {
      if (snapshot[key] !== undefined) continue;

      const resolution = resolveVariableValue(
        key,
        step.test_case_id,
        localVarsMap,
        envValues,
        defaults
      );

      if (resolution.value !== undefined) {
        snapshot[key] = resolution.value;
      }
    }
  }

  return snapshot;
}
