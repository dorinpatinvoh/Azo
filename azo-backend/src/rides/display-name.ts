/**
 * Calcule le nom d'affichage d'un utilisateur pour le radar et les courses.
 *
 * Règle : « Kossi A. » — prénom + espace + première lettre du nom en majuscule suivie d'un point.
 * Fallback si pas de nom de famille : prénom seul. Si rien : null (le mobile affiche « Client AZƆ̀ »).
 *
 * La source préférée est `firstName`/`lastName` explicites. Sinon on décompose `fullName`.
 */
export function buildDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): { displayName: string | null; firstName: string | null } {
  const firstName =
    user.firstName?.trim() ||
    (user.fullName?.trim() ? user.fullName.trim().split(/\s+/)[0] : null) ||
    null;

  const lastName =
    user.lastName?.trim() ||
    (user.fullName?.trim() && user.fullName.trim().split(/\s+/).length > 1
      ? user.fullName.trim().split(/\s+/).slice(-1)[0]
      : null) ||
    null;

  if (!firstName) return { displayName: null, firstName: null };
  const initial = lastName ? `${lastName[0].toUpperCase()}.` : null;
  const displayName = initial ? `${firstName} ${initial}` : firstName;
  return { displayName, firstName };
}

/**
 * Même logique pour le Zem (source : ProviderProfile.fullName, repli User.fullName).
 */
export function buildDriverDisplayName(driver: {
  providerFullName?: string | null;
  userFullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): { displayName: string | null; firstName: string | null } {
  const source = {
    firstName: driver.firstName,
    lastName: driver.lastName,
    fullName: driver.providerFullName ?? driver.userFullName,
  };
  return buildDisplayName(source);
}
