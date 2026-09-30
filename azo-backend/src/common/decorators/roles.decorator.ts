import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

export const ROLES_KEY = "roles";
// Usage : @Roles(Role.ADMIN) sur une route pour la restreindre
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
