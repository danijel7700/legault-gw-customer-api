import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { logger } from '../shared/logger/logger.js';

import { ENVS } from './constants/env-keys.constant.js';

export interface SsmParamRule {
  readonly envName: string;
  readonly paramEnvName: string;
  readonly withDecryption?: boolean;
}

export interface ResolveSsmParamsOptions {
  readonly client?: SSMClient;
}

export interface ResolveAppSsmSecretsOptions {
  readonly withDecryption?: boolean;
  readonly optional?: boolean;
  readonly client?: SSMClient;
}

interface FetchSpec {
  readonly envName: string;
  readonly parameterName: string;
  readonly withDecryption: boolean;
  readonly optional?: boolean;
}

export function getAppSsmPrefix(): string | undefined {
  return process.env[ENVS.APP_SSM_PREFIX];
}

export async function resolveSsmParams(
  rules: readonly SsmParamRule[],
  options: ResolveSsmParamsOptions = {},
): Promise<void> {
  assertNoDuplicateTargets(rules);

  const specs: FetchSpec[] = [];

  for (const rule of rules) {
    const parameterName = process.env[rule.paramEnvName];

    if (!parameterName) {
      continue;
    }

    specs.push({
      envName: rule.envName,
      parameterName,
      withDecryption: rule.withDecryption ?? false,
    });
  }

  await fetchAndApply(specs, options.client);
}

export async function resolveAppSsmSecrets(
  prefix: string | undefined,
  envNames: readonly string[],
  options: ResolveAppSsmSecretsOptions = {},
): Promise<void> {
  if (process.env[ENVS.NODE_ENV] !== 'production') {
    return;
  }

  if (!prefix || envNames.length === 0) {
    return;
  }

  const withDecryption = options.withDecryption ?? false;
  const optional = options.optional ?? false;

  const specs: FetchSpec[] = envNames.map((envName) => ({
    envName,
    parameterName: `${prefix}/${toParameterName(envName)}`,
    withDecryption,
    optional,
  }));

  await fetchAndApply(specs, options.client);
}

async function fetchAndApply(
  specs: readonly FetchSpec[],
  injectedClient?: SSMClient,
): Promise<void> {
  if (specs.length === 0) {
    return;
  }

  const ownsClient = !injectedClient;
  const client = injectedClient ?? new SSMClient({ region: process.env.AWS_REGION });

  try {
    const resolved = await Promise.all(specs.map((spec) => fetchOne(client, spec)));

    for (const item of resolved) {
      if (item === null) {
        continue;
      }

      const { spec, value } = item;

      if (process.env[spec.envName]) {
        logger.warn(
          { envName: spec.envName, parameterName: spec.parameterName },
          'Env var is already set in the environment; overwriting with the value from SSM',
        );
      }

      process.env[spec.envName] = value;
    }
  } finally {
    if (ownsClient) {
      client.destroy();
    }
  }
}

async function fetchOne(
  client: SSMClient,
  spec: FetchSpec,
): Promise<{ spec: FetchSpec; value: string } | null> {
  let value: string | undefined;

  try {
    const response = await client.send(
      new GetParameterCommand({ Name: spec.parameterName, WithDecryption: spec.withDecryption }),
    );

    value = response.Parameter?.Value;
  } catch (error: unknown) {
    if (spec.optional === true && isParameterNotFound(error)) {
      logger.warn({ envName: spec.envName }, 'Optional parameter not found in SSM; skipping');

      return null;
    }

    throw new Error(
      `Failed to resolve SSM parameter "${spec.parameterName}" for env var ${spec.envName} ` +
        `(${errorName(error)}): ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (value === undefined || value === '') {
    if (spec.optional === true) {
      logger.warn({ envName: spec.envName }, 'Optional parameter returned no value; skipping');

      return null;
    }

    throw new Error(
      `SSM parameter "${spec.parameterName}" for env var ${spec.envName} returned no value`,
    );
  }

  return { spec, value };
}

function toParameterName(envName: string): string {
  return envName.toLowerCase().replaceAll('_', '-');
}

function assertNoDuplicateTargets(rules: readonly SsmParamRule[]): void {
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.envName)) {
      throw new Error(`Duplicate envName "${rule.envName}" in SSM bootstrap rules`);
    }

    seen.add(rule.envName);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isParameterNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { name?: string; __type?: string };

  return candidate.name === 'ParameterNotFound' || candidate.__type === 'ParameterNotFound';
}
