import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRequestHandler<Params = Record<string, string>> = (
  req: Request<Params>,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<Params = Record<string, string>>(
  handler: AsyncRequestHandler<Params>,
): RequestHandler<Params> {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch((error: unknown) => {
      next(error);
    });
  };
}
