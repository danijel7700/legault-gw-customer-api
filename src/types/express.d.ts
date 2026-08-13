import type { BrandConfig } from '../config/types/brand.types.js';
import type { RequestContext } from '../shared/types/request-context.types.js';
import type { ValidatedData } from '../shared/types/validation.types.js';

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
      validated: ValidatedData;
      brandConfig: BrandConfig;
    }
  }
}
