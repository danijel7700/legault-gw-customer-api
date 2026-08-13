export type ValidationSource = 'body' | 'params' | 'query' | 'headers';

export interface ValidatedData {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  headers?: unknown;
}

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}
