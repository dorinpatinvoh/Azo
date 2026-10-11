type RegistrationProfile = {
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  npiHash?: string | null;
  npiCipher?: string | null;
  npiLast4?: string | null;
};

export function isRegistrationComplete(user: RegistrationProfile): boolean {
  return Boolean(
    user.firstName &&
      user.lastName &&
      user.gender &&
      user.npiHash &&
      user.npiCipher &&
      user.npiLast4
  );
}

export function toUserProfile<T extends RegistrationProfile>(user: T) {
  const { npiHash, npiCipher, npiLast4, ...safeUser } = user;
  return {
    ...safeUser,
    npiMasked: npiLast4 ? `••••••${npiLast4}` : null,
    profileComplete: isRegistrationComplete(user),
  };
}
