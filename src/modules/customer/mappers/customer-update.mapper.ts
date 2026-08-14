import type { Mutable } from '../../../shared/types/utility.types.js';
import type { UpdateProfileInput } from '../repositories/types/customer.repository.types.js';
import type {
  PhoneType,
  SfccCustomerUpdate,
  UpdateMemberProfileRequest,
} from '../types/customer.types.js';

const DEFAULT_PHONE_TYPE: PhoneType = 'mobile';

interface PhoneColumns {
  readonly phoneHome?: string | null;
  readonly phoneMobile?: string | null;
}

function toPhoneColumns(request: UpdateMemberProfileRequest): PhoneColumns {
  if (request.phone === undefined) {
    return {};
  }

  if (request.phone === null) {
    return { phoneHome: null, phoneMobile: null };
  }

  return (request.phoneType ?? DEFAULT_PHONE_TYPE) === 'home'
    ? { phoneHome: request.phone, phoneMobile: null }
    : { phoneHome: null, phoneMobile: request.phone };
}

export function toSfccCustomerUpdate(request: UpdateMemberProfileRequest): SfccCustomerUpdate {
  const update: Mutable<SfccCustomerUpdate> = { ...toPhoneColumns(request) };

  if (request.firstName !== undefined) {
    update.firstName = request.firstName;
  }
  if (request.lastName !== undefined) {
    update.lastName = request.lastName;
  }
  if (request.postalCode !== undefined) {
    update.postalCode = request.postalCode;
  }
  if (request.preferredStore !== undefined) {
    update.preferredStore = request.preferredStore;
  }

  return update;
}

export function toUpdateProfileInput(request: UpdateMemberProfileRequest): UpdateProfileInput {
  const patch: Mutable<UpdateProfileInput> = { ...toPhoneColumns(request) };

  if (request.firstName !== undefined) {
    patch.firstName = request.firstName;
  }
  if (request.lastName !== undefined) {
    patch.lastName = request.lastName;
  }
  if (request.postalCode !== undefined) {
    patch.postalCode = request.postalCode;
  }
  if (request.preferredStore !== undefined) {
    patch.preferredStore = request.preferredStore;
  }

  return patch;
}
