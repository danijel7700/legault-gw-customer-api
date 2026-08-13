export interface SfccHttpOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export interface SfccUpstreamInfo {
  readonly upstreamStatus?: number | undefined;
  readonly upstreamCode?: string | undefined;
  readonly upstreamBody?: string | undefined;
}
