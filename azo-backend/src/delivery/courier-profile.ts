import { maskPlate } from "../rides/plate";
import { buildDriverDisplayName } from "../rides/display-name";

type CourierUser = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  provider: {
    fullName: string | null;
    city: string | null;
    zones: string[];
    bio: string | null;
    experienceYears: number | null;
    vehicleType: string | null;
    vehicleModel: string | null;
    plateNumber: string | null;
    status: string;
    kycScore: number;
    rating: number;
    ratingCount: number;
    jobsCompleted: number;
    agencyName: string | null;
    categoryId: string | null;
  } | null;
};

/** Profil public d'un coursier ou livreur, montré au client avant qu'il le choisisse : jamais de téléphone ni de pièce d'identité. */
export function buildPublicCourierProfile(user: CourierUser) {
  const p = user.provider;
  const { displayName } = buildDriverDisplayName({
    providerFullName: p?.fullName,
    userFullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  return {
    displayName,
    photoUrl: null,
    verified: p?.status === "APPROVED" && (p.kycScore ?? 0) >= 80,
    rating: p && p.ratingCount >= 1 ? Math.round(p.rating * 10) / 10 : null,
    ratingCount: p?.ratingCount ?? 0,
    jobsCompleted: p?.jobsCompleted ?? 0,
    experienceYears: p?.experienceYears ?? null,
    memberSince: user.createdAt.toISOString(),
    city: p?.city ?? null,
    zones: p?.zones ?? [],
    bio: p?.bio ? p.bio.replace(/<[^>]*>/g, "").slice(0, 200) : null,
    vehicleType: p?.vehicleType ?? null,
    vehicleModel: p?.vehicleModel ?? null,
    plateMasked: maskPlate(p?.plateNumber),
    agencyName: p?.agencyName ?? null,
    specialty: p?.categoryId === "COURSIER_PERSONNEL" ? "Coursier personnel" : "Livreur express",
  };
}

export const COURIER_PROFILE_SELECT = {
  fullName: true,
  firstName: true,
  lastName: true,
  createdAt: true,
  provider: {
    select: {
      fullName: true, city: true, zones: true, bio: true, experienceYears: true, vehicleType: true, vehicleModel: true,
      plateNumber: true, status: true, kycScore: true, rating: true, ratingCount: true, jobsCompleted: true,
      agencyName: true, categoryId: true,
    },
  },
} as const;
