/**
 * Configuration loading for the benchmark harness.
 *
 * Reads the same variables the other samples and the functional test suite use,
 * so a run can be pointed at a different environment purely by swapping the
 * env file. `ATHENA_*` wins; `VITE_ATHENA_*` is accepted as a fallback because
 * the repo-root `.env` carries the functional suite's copy under that prefix.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  parseAudience,
  type AthenaAudience,
} from '@crispthinking/athena-classifier-sdk';

export const DEFAULT_ISSUER_URL = 'https://crispthinking.auth0.com/';
export const DEFAULT_GRPC_ADDRESS = 'api.athena-risk-intelligence.com:443';

export interface BenchmarkConfig {
  clientId: string;
  clientSecret: string;
  affiliate: string;
  issuerUrl: string;
  grpcAddress: string;
  audience: AthenaAudience;
  host: string;
  port: number;
}

/**
 * Loads an env file into `process.env` the way `set -a; source .env; set +a`
 * would, without clobbering variables already exported in the shell.
 *
 * @param envFile Path to the env file, relative to the working directory.
 * @throws If the caller named a file that does not exist.
 */
export function loadEnvFile(envFile: string): void {
  const path = resolve(envFile);
  if (!existsSync(path)) {
    throw new Error(`Env file not found: ${path}`);
  }
  // Node's loader does not overwrite variables that are already set, which is
  // what we want: an explicit `ATHENA_GRPC_ADDRESS=... npm start` should win
  // over whatever the file says.
  process.loadEnvFile(path);
  expandReferences();
}

/**
 * Resolves `${OTHER_VAR}` references in the values just loaded.
 *
 * `set -a; source .env; set +a` expands these; `process.loadEnvFile` does not,
 * and leaves the literal text in place. The repo env files chain their
 * `VITE_`-prefixed copies off the plain names that way, so without this the
 * address arrives as the string `${ATHENA_GRPC_ADDRESS}`.
 *
 * Runs to a fixed point so a reference to a reference resolves, with a depth
 * cap so a cycle cannot hang the harness. Anything still unresolved is left
 * as-is for the caller to reject.
 */
function expandReferences(): void {
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || !value.includes('${')) {
        continue;
      }
      const resolved = value.replace(pattern, (literal, name: string) => {
        const target = process.env[name];
        return target === undefined || target.includes('${')
          ? literal
          : target;
      });
      if (resolved !== value) {
        process.env[key] = resolved;
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
  }
}

/**
 * Reads a variable, preferring the plain name over the functional suite's
 * `VITE_`-prefixed copy.
 */
function read(name: string, viteName?: string): string | undefined {
  const direct = usable(process.env[name]);
  if (direct !== undefined) {
    return direct;
  }
  if (viteName !== undefined) {
    return usable(process.env[viteName]);
  }
  return undefined;
}

/**
 * Treats an empty value, or one still carrying an unresolved `${OTHER}`
 * reference, as unset.
 *
 * The repo env files define their `VITE_`-prefixed copies as references to the
 * plain names. When a plain name is absent the reference dangles, and passing
 * the literal `${ATHENA_GRPC_ADDRESS}` through as an address fails much later
 * with a bare "Invalid URL". Falling through to the documented default is both
 * more useful and more honest about what the harness actually connected to.
 */
function usable(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value.includes('${')) {
    return undefined;
  }
  return value;
}

/**
 * Splits a `host:port` gRPC address. Defaults to 443 when no port is given.
 */
function splitAddress(address: string): { host: string; port: number } {
  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: address, port: 443 };
  }
  const host = address.slice(0, lastColon);
  const port = Number.parseInt(address.slice(lastColon + 1), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port in gRPC address: ${address}`);
  }
  return { host, port };
}

/**
 * Builds the benchmark configuration from the environment.
 *
 * @throws If any required credential or the affiliate is missing, listing every
 *   missing variable at once rather than failing one at a time.
 */
export function loadConfig(): BenchmarkConfig {
  const clientId = read('ATHENA_CLIENT_ID', 'VITE_ATHENA_CLIENT_ID');
  const clientSecret = read(
    'ATHENA_CLIENT_SECRET',
    'VITE_ATHENA_CLIENT_SECRET',
  );
  const affiliate = read('ATHENA_AFFILIATE', 'VITE_ATHENA_AFFILIATE');

  const missing: string[] = [];
  if (clientId === undefined) missing.push('ATHENA_CLIENT_ID');
  if (clientSecret === undefined) missing.push('ATHENA_CLIENT_SECRET');
  if (affiliate === undefined) missing.push('ATHENA_AFFILIATE');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Pass --env-file, or source one of the repo env files first.',
    );
  }

  const issuerUrl =
    read('ATHENA_ISSUER_URL', 'VITE_OAUTH_ISSUER') ?? DEFAULT_ISSUER_URL;
  const grpcAddress =
    read('ATHENA_GRPC_ADDRESS', 'VITE_ATHENA_GRPC_ADDRESS') ??
    DEFAULT_GRPC_ADDRESS;
  const audience = parseAudience(
    read('ATHENA_AUDIENCE', 'VITE_ATHENA_AUDIENCE'),
  );

  const { host, port } = splitAddress(grpcAddress);

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    affiliate: affiliate as string,
    issuerUrl,
    grpcAddress,
    audience,
    host,
    port,
  };
}
