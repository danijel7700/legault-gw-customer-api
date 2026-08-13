export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}
