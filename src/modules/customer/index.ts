export { customerRouter } from './routes/customer.routes.js';
export { CUSTOMER_ID_HEADER } from './validations/customer.validation.js';
export type { CustomerIdentity, CustomerProfile } from './types/customer.types.js';

export { createCustomerRepository } from './repositories/customer.repository.js';
export {
  CustomerNotFoundError,
  CustomerVersionConflictError,
  DuplicateExternalIdError,
} from './errors/customer.error.js';
export type {
  CreateAddressInput,
  CreateCustomerInput,
  CreateProfileInput,
  CustomerRepository,
  ExternalIdInput,
  UpdateProfileInput,
  UpdateProfileOptions,
  UpsertAddressInput,
  UpsertFromSfccInput,
  UpsertFromSfccResult,
} from './repositories/types/customer.repository.types.js';
