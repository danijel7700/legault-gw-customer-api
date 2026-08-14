import {
  ConflictError,
  ErrorCode,
  NotFoundError,
  PreconditionFailedError,
} from '../../../shared/errors/index.js';
import type { ExternalSystem } from '../../../database/schemas/customer/index.js';

export class CustomerNotFoundError extends NotFoundError {
  constructor(customerId: string) {
    super('Customer record not found', {
      code: ErrorCode.CUSTOMER_RECORD_NOT_FOUND,
      details: { customerId },
    });
  }
}

export class CustomerVersionConflictError extends PreconditionFailedError {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(customerId: string, expectedVersion: number, actualVersion: number) {
    super('Customer was modified by another request', {
      code: ErrorCode.CUSTOMER_VERSION_CONFLICT,
      details: { customerId, expectedVersion, actualVersion },
    });

    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class DuplicateExternalIdError extends ConflictError {
  readonly system: ExternalSystem;
  readonly idType: string;

  constructor(system: ExternalSystem, idType: string, existingCustomerId: string) {
    super('External id already belongs to another customer', {
      code: ErrorCode.DUPLICATE_EXTERNAL_ID,
      details: { system, idType, existingCustomerId },
    });

    this.system = system;
    this.idType = idType;
  }
}
