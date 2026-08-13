import { z } from 'zod';

import { ENVS } from '../constants/env-keys.constant.js';
import { LOG_LEVELS } from '../constants/log-levels.constant.js';
import { NODE_ENVS } from '../constants/node-envs.constant.js';
import '../load-env.js';

const required = z.string().min(1);

export const envSchema = z.object({
  [ENVS.NODE_ENV]: z.enum(NODE_ENVS).default('development'),
  [ENVS.PORT]: z.coerce.number().int().min(1).max(65_535).default(3000),
  [ENVS.LOG_LEVEL]: z.enum(LOG_LEVELS).default('info'),
  [ENVS.CORS_ORIGINS]: z.string().min(1).optional(),

  [ENVS.APP_SSM_PREFIX]: z.string().min(1).optional(),

  [ENVS.RENS_SLAS_CLIENT_ID]: required,
  [ENVS.RENS_SLAS_CLIENT_SECRET]: required,
  [ENVS.RENS_SHORT_CODE]: required,
  [ENVS.RENS_ORG_ID]: required,
  [ENVS.RENS_SITE_ID]: required,
  [ENVS.RENS_REDIRECT_URI]: z.url(),

  [ENVS.MONDOU_SLAS_CLIENT_ID]: required,
  [ENVS.MONDOU_SLAS_CLIENT_SECRET]: required,
  [ENVS.MONDOU_SHORT_CODE]: required,
  [ENVS.MONDOU_ORG_ID]: required,
  [ENVS.MONDOU_SITE_ID]: required,
  [ENVS.MONDOU_REDIRECT_URI]: z.url(),
});
