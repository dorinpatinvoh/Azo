import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AgencyPlan,
  DocumentKind,
  DocumentStatus,
  ProviderDocument,
  ProviderEventType,
  ProviderProfile,
  ProviderStatus,
  ProviderType,
  Role,
  VehicleType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationsModule, NotificationsService } from "../notifications/notifications.module";
import { PLANS, PLAN_LABELS } from "../agencies/plans";

/* -------------------------------------------------------------------------- */
/*  Règles métier du dossier prestataire                                       */
/* -------------------------------------------------------------------------- */

// Types ouverts au dépôt de dossier sur AZƆ̀ :
// - DRIVER  : Zem, Zem indépendant (moto-taxi / électrique), Voiture indépendante
// - COURIER : Coursier express, Coursier personnel (courses/achats), Livreur de colis
// - AGENCY  : Agence de flotte (Zem, Voitures, Livreurs)
// (Pas d'activité Artisan sur AZƆ̀.)
export const ENABLED_PROVIDER_TYPES: ProviderType[] = ["DRIVER", "COURIER", "AGENCY"];
export const VISIBLE_PROVIDER_TYPES: ProviderType[] = ["DRIVER", "COURIER", "AGENCY"];

// Rôle applicatif accordé À L'APPROBATION seulement — jamais à l'inscription.
export const ROLE_FOR_TYPE: Record<ProviderType, Role> = {
  DRIVER: Role.DRIVER,
  COURIER: Role.DRIVER, // l'enum Role partage DRIVER : la distinction se lit sur provider.type
  AGENCY: Role.AGENCY,
  ARTISAN: Role.CLIENT,
};

// Pièces exigées pour approuver un dossier.
export const REQUIRED_DOCUMENTS: Record<ProviderType, DocumentKind[]> = {
  DRIVER: ["CNI", "SELFIE", "PERMIS", "CARTE_GRISE", "ASSURANCE", "PHOTO_VEHICULE"],
  COURIER: ["CNI", "SELFIE", "PERMIS", "PHOTO_VEHICULE"],
  AGENCY: ["CNI", "SELFIE", "RCCM", "IFU", "STATUTS"],
  ARTISAN: ["CNI", "SELFIE"],
};

export const OPTIONAL_DOCUMENTS: Record<ProviderType, DocumentKind[]> = {
  DRIVER: ["VISITE_TECHNIQUE", "EXTRAIT_CASIER"],
  COURIER: ["CARTE_GRISE", "ASSURANCE", "EXTRAIT_CASIER"],
  AGENCY: ["PHOTO_VEHICULE", "EXTRAIT_CASIER"],
  ARTISAN: ["EXTRAIT_CASIER"],
};

// Informations minimales pour pouvoir soumettre, par type d'activité.
const REQUIRED_FIELDS: Record<ProviderType, (keyof ProviderProfile)[]> = {
  DRIVER: ["fullName", "city", "vehicleType", "plateNumber"],
  COURIER: ["fullName", "city", "vehicleType", "plateNumber"],
  AGENCY: ["fullName", "city", "agencyName", "plan"],
  ARTISAN: ["fullName", "city"],
};

const FIELD_LABELS: Record<string, string> = {
  fullName: "le nom complet (tel que sur la pièce d'identité)",
  city: "la ville",
  zones: "les zones desservies",
  vehicleType: "le type de véhicule",
  vehicleModel: "le modèle du véhicule",
  plateNumber: "le numéro d'immatriculation",
  categoryId: "la spécialité (coursier / livreur)",
  agencyName: "la raison sociale de l'agence",
  plan: "la formule d'abonnement",
};

const TYPE_LABELS: Record<ProviderType, string> = {
  DRIVER: "Zem & Conducteur indépendant",
  COURIER: "Coursier, Coursier personnel & Livreur",
  AGENCY: "Agence de flotte",
  ARTISAN: "Prestataire",
};

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  CNI: "pièce d'identité",
  SELFIE: "selfie de vérification",
  PERMIS: "permis de conduire",
  CARTE_GRISE: "carte grise",
  ASSURANCE: "attestation d'assurance",
  VISITE_TECHNIQUE: "visite technique",
  PHOTO_VEHICULE: "photo du véhicule",
  RCCM: "registre du commerce (RCCM)",
  IFU: "identifiant fiscal (IFU)",
  STATUTS: "statuts de la société",
  DIPLOME: "diplôme ou certificat",
  EXTRAIT_CASIER: "extrait de casier judiciaire",
};

// Un dossier n'est modifiable que dans ces états : une fois soumis, il appartient à
// l'admin ; une fois approuvé, il se pilote depuis l'espace métier (pas en édition libre).
const EDITABLE_STATUSES: ProviderStatus[] = ["DRAFT", "NEED_INFO", "REJECTED"];
const DECIDABLE_STATUSES: ProviderStatus[] = ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"];

export const RESUBMIT_DELAY_DAYS = 7; // délai avant de re-déposer un dossier rejeté
export const REVIEW_SLA_HOURS = 48; // engagement de réponse affiché au prestataire

/* ---------------------------------- fichiers (pièces justificatives) --------- */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo par pièce
export const ACCEPTED_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};
// Racine de stockage. Les fichiers ne sont JAMAIS servis en statique public :
// ils passent par GET /providers/documents/:docId/file, qui vérifie le propriétaire.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

// Pièces dont le FICHIER (photo ou scan) est obligatoire pour déposer un dossier.
// Une simple déclaration ne suffit pas : sans image, l'admin ne peut rien vérifier.
export const PHOTO_DOCUMENTS: Record<ProviderType, DocumentKind[]> = {
  DRIVER: ["SELFIE", "CNI"],
  COURIER: ["SELFIE", "CNI"],
  AGENCY: ["SELFIE", "CNI"],
  ARTISAN: ["SELFIE", "CNI"],
};

// Choix de véhicule et spécialité par type d'activité :
// - DRIVER  : Zem indépendant (moto-taxi), Zem électrique indépendant, Voiture indépendante
// - COURIER : Coursier express, Coursier personnel (courses/achats), Livreur de colis
const DRIVER_VEHICLE_CHOICES: { value: VehicleType; label: string; hint: string }[] = [
  { value: "ZEM", label: "Zem indépendant (Moto-taxi)", hint: "Courses rapides en ville — commission 15 %" },
  { value: "ZEM_ELECTRIC", label: "Zem électrique indépendant", hint: "Moto électrique écologique — commission 15 %" },
  { value: "CAR", label: "Voiture — Conducteur indépendant", hint: "Courses confort & climatisées — commission 15 %" },
];

const COURIER_VEHICLE_CHOICES: { value: VehicleType; label: string; hint: string }[] = [
  { value: "ZEM", label: "Moto / Zem (Coursier & Livreur)", hint: "Plis, courses personnelles et colis en ville" },
  { value: "ZEM_ELECTRIC", label: "Moto électrique (Coursier & Livreur)", hint: "Livraisons rapides & écologiques" },
  { value: "CAR", label: "Voiture / Fourgonnette (Livreur)", hint: "Colis moyens, achats et marchandises" },
];

const COURIER_SPECIALTIES: { id: string; label: string; hint: string }[] = [
  { id: "COURSIER_EXPRESS", label: "Coursier express", hint: "Plis urgents, documents et petits paquets" },
  { id: "COURSIER_PERSONNEL", label: "Coursier personnel", hint: "Courses personnelles, marché, pharmacie & achats" },
  { id: "LIVREUR_COLIS", label: "Livreur de colis", hint: "Livraison de colis et marchandises avec double OTP" },
];

const TYPE_DESCRIPTIONS: Record<ProviderType, string> = {
  DRIVER: "Zem, Zem indépendant (moto-taxi), Zem électrique ou voiture indépendante : transporte des clients et encaisse sur AZƆ̀ Pay.",
  COURIER: "Coursier express, coursier personnel (courses, marché, pharmacie) ou livreur de colis avec double code OTP.",
  AGENCY: "Gère une flotte de conducteurs Zem, voitures ou coursiers-livreurs, suis leur activité et bénéficie d'une commission réduite.",
  ARTISAN: "",
};

type ProviderWithDocs = ProviderProfile & { documents: ProviderDocument[] };

// Fichier reçu en multipart (multer, stockage mémoire puis écrit sur disque).
// @types/multer n'est pas installé : on type le strict nécessaire.
type UploadedDocument = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

/* -------------------------------------------------------------------------- */
/*  DTO                                                                        */
/* -------------------------------------------------------------------------- */

class SaveApplicationDto {
  @IsOptional() @IsIn(["DRIVER", "AGENCY", "COURIER"]) type?: ProviderType;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) fullName?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) zones?: string[];
  @IsOptional() @IsString() @MaxLength(600) bio?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) experienceYears?: number;
  @IsOptional() @IsIn(["ZEM", "ZEM_ELECTRIC", "CAR"]) vehicleType?: VehicleType;
  @IsOptional() @IsString() @MaxLength(60) vehicleModel?: string;
  @IsOptional() @IsString() @MaxLength(30) plateNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(120) agencyName?: string;
  @IsOptional() @IsIn(["PRO", "ARGENT", "OR", "DIAMANT"]) plan?: AgencyPlan;
}

class RegisterDocumentDto {
  @IsIn(Object.values(DocumentKind)) kind: DocumentKind;
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsString() @MaxLength(60) mimeType?: string;
  @IsOptional() @IsString() @IsISO8601() expiresAt?: string;
  // Permet aussi l'envoi direct de la photo en base64 via JSON (contourne les bugs
  // multipart de certains téléphones Android sous React Native).
  @IsOptional() @IsString() base64?: string;
  @IsOptional() @IsString() @MaxLength(120) fileName?: string;
}

class UploadBase64Dto {
  @IsString() base64: string;
  @IsOptional() @IsString() @MaxLength(60) mimeType?: string;
  @IsOptional() @IsString() @MaxLength(120) fileName?: string;
  @IsOptional() @IsString() @IsISO8601() expiresAt?: string;
}

class DocumentDecisionDto {
  @IsIn(["VALID", "INVALID"]) decision: DocumentStatus;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @IsISO8601() expiresAt?: string;
}

class ProviderDecisionDto {
  @IsIn(["APPROVE", "REJECT", "NEED_INFO", "SUSPEND"]) decision: "APPROVE" | "REJECT" | "NEED_INFO" | "SUSPEND";
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  // Dérogation tracée : approuver alors que des pièces manquent (tant que l'upload
  // de fichiers n'est pas en place, c'est le seul moyen d'activer un compte de test).
  @IsOptional() @IsBoolean() overrideDocuments?: boolean;
}

class ProviderQueueDto {
  @IsOptional() @IsIn(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEED_INFO", "APPROVED", "REJECTED", "SUSPENDED"])
  status?: ProviderStatus;
  @IsOptional() @IsIn(["DRIVER", "AGENCY", "ARTISAN", "COURIER"]) type?: ProviderType;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number = 20;
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                    */
/* -------------------------------------------------------------------------- */

@Injectable()
export class ProvidersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /* ------------------------------------------------------------- utilitaires */

  private log(providerId: string, actorId: string | null, type: ProviderEventType, comment?: string) {
    return this.prisma.providerEvent.create({ data: { providerId, actorId, type, comment } });
  }

  private assertTypeEnabled(type: ProviderType) {
    if (!ENABLED_PROVIDER_TYPES.includes(type)) {
      throw new BadRequestException(
        `Les candidatures « ${TYPE_LABELS[type]} » ne sont pas encore ouvertes sur AZƆ̀`
      );
    }
  }

  private missingDocuments(provider: ProviderWithDocs): DocumentKind[] {
    const photoKinds = PHOTO_DOCUMENTS[provider.type];
    return REQUIRED_DOCUMENTS[provider.type].filter((kind) => {
      const doc = provider.documents.find((d) => d.kind === kind);
      if (!doc || doc.status === "INVALID") return true;
      // Une pièce dont la photo est obligatoire doit avoir un fichier réellement déposé.
      if (photoKinds.includes(kind) && !doc.url) return true;
      return false;
    });
  }

  // Pièces dont la photo manque à l'appel (blocage du dépôt de dossier).
  private missingPhotos(provider: ProviderWithDocs): string[] {
    return PHOTO_DOCUMENTS[provider.type]
      .filter((kind) => !provider.documents.find((d) => d.kind === kind)?.url)
      .map((kind) => DOCUMENT_LABELS[kind]);
  }

  private missingFields(provider: ProviderProfile): string[] {
    return REQUIRED_FIELDS[provider.type]
      .filter((field) => {
        const value = provider[field];
        return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
      })
      .map((field) => FIELD_LABELS[field] ?? String(field));
  }

  // 0-100 : une pièce requise déclarée compte pour moitié, validée et non expirée pour
  // sa part entière. Sert à trier la file admin et à signaler les comptes à régulariser.
  private kycScore(provider: ProviderWithDocs): number {
    const required = REQUIRED_DOCUMENTS[provider.type];
    if (required.length === 0) return 0;
    const now = new Date();
    const share = 100 / required.length;
    let score = 0;
    for (const kind of required) {
      const doc = provider.documents.find((d) => d.kind === kind);
      if (!doc) continue;
      const expired = !!doc.expiresAt && doc.expiresAt < now;
      if (doc.status === "VALID" && !expired) score += share;
      else if (doc.status === "PENDING" && !expired) score += share / 2;
    }
    return Math.round(Math.min(100, score));
  }

  // Checklist renvoyée au prestataire comme à l'admin : ce qui est fourni, ce qui
  // manque, ce qui expire bientôt.
  private checklist(provider: ProviderWithDocs) {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const row = (kind: DocumentKind, required: boolean) => {
      const doc = provider.documents.find((d) => d.kind === kind);
      const expired = !!doc?.expiresAt && doc.expiresAt < now;
      return {
        kind,
        label: DOCUMENT_LABELS[kind],
        required,
        photoRequired: PHOTO_DOCUMENTS[provider.type].includes(kind),
        status: doc ? doc.status : "MISSING",
        hasFile: !!doc?.url,
        expiresAt: doc?.expiresAt ?? null,
        expired,
        expiresSoon: !!doc?.expiresAt && !expired && doc.expiresAt < soon,
        note: doc?.reviewerNote ?? null,
        documentId: doc?.id ?? null,
      };
    };
    const required = REQUIRED_DOCUMENTS[provider.type].map((k) => row(k, true));
    const extra = OPTIONAL_DOCUMENTS[provider.type]
      .filter((k) => !REQUIRED_DOCUMENTS[provider.type].includes(k))
      .map((k) => row(k, false));
    return [...required, ...extra];
  }

  private serialize(provider: ProviderWithDocs) {
    const missingDocuments = this.missingDocuments(provider);
    const missingFields = this.missingFields(provider);
    const submittedAt = provider.submittedAt;
    const waitingHours = submittedAt ? Math.max(0, Math.round((Date.now() - submittedAt.getTime()) / 3600000)) : null;
    return {
      id: provider.id,
      type: provider.type,
      typeLabel: TYPE_LABELS[provider.type],
      status: provider.status,
      identity: {
        fullName: provider.fullName,
        city: provider.city,
        zones: provider.zones,
        bio: provider.bio,
        experienceYears: provider.experienceYears,
      },
      activity: {
        vehicleType: provider.vehicleType,
        vehicleModel: provider.vehicleModel,
        plateNumber: provider.plateNumber,
        categoryId: provider.categoryId,
        agencyName: provider.agencyName,
        plan: provider.plan,
        planLabel: provider.plan ? PLAN_LABELS[provider.plan] : null,
        planFee: provider.plan ? PLANS[provider.plan].fee : null,
        planCommissionRate: provider.plan ? PLANS[provider.plan].rate : null,
      },
      review: {
        submittedAt,
        reviewedAt: provider.reviewedAt,
        reviewedById: provider.reviewedById,
        rejectReason: provider.rejectReason,
        suspensionReason: provider.suspensionReason,
        infoRequested: provider.infoRequested,
        waitingHours,
        slaHours: REVIEW_SLA_HOURS,
        overdue: !!waitingHours && waitingHours > REVIEW_SLA_HOURS && DECIDABLE_STATUSES.includes(provider.status),
        canResubmitAt:
          provider.status === "REJECTED" && provider.reviewedAt
            ? new Date(provider.reviewedAt.getTime() + RESUBMIT_DELAY_DAYS * 24 * 3600 * 1000)
            : null,
      },
      activation: {
        activatedAt: provider.activatedAt,
        rating: provider.rating,
        jobsCompleted: provider.jobsCompleted,
        kycScore: provider.kycScore,
      },
      agencyId: provider.agencyId,
      documents: provider.documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: DOCUMENT_LABELS[d.kind],
        status: d.status,
        url: d.url ? `/providers/documents/${d.id}/file` : "",
        hasFile: !!d.url,
        expiresAt: d.expiresAt,
        note: d.reviewerNote,
        uploadedAt: d.uploadedAt,
        reviewedAt: d.reviewedAt,
      })),
      checklist: this.checklist(provider),
      missingDocuments: missingDocuments.map((kind) => ({ kind, label: DOCUMENT_LABELS[kind] })),
      missingFields,
      editable: EDITABLE_STATUSES.includes(provider.status),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private async loadProvider(userId: string): Promise<ProviderWithDocs> {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });
    if (!provider) throw new NotFoundException("Aucun dossier prestataire pour ce compte");
    return provider;
  }

  private async loadProviderById(id: string): Promise<ProviderWithDocs> {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { id },
      include: { documents: true },
    });
    if (!provider) throw new NotFoundException("Dossier prestataire introuvable");
    return provider;
  }

  private async notifyAdmins(title: string, body: string) {
    const admins = await this.prisma.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
    if (admins.length === 0) {
      console.warn(
        "[AZƆ̀] Aucun compte ADMIN en base : personne ne verra ce dossier. " +
          "Renseigne ADMIN_PHONE dans .env puis lance `npm run seed`."
      );
      return;
    }
    await Promise.all(admins.map((a) => this.notifications.push(a.id, title, body, "PROVIDER_REVIEW")));
  }

  /* --------------------------------------------------- côté prestataire (app) */

  // GET /providers/me — état du dossier + checklist + journal : de quoi construire
  // l'écran « Dossier en cours » (3b) sans autre appel.
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, fullName: true, role: true, status: true, agencyId: true },
    });
    if (!user) throw new NotFoundException("Compte introuvable");

    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      include: { documents: true, events: { orderBy: { createdAt: "desc" }, take: 30 } },
    });

    if (!provider) {
      return {
        account: user,
        provider: null,
        canApply: user.status !== "BLOCKED",
        enabledTypes: ENABLED_PROVIDER_TYPES.map((type) => ({
          type,
          label: TYPE_LABELS[type],
          requiredDocuments: REQUIRED_DOCUMENTS[type].map((kind) => ({
            kind,
            label: DOCUMENT_LABELS[kind],
            photoRequired: PHOTO_DOCUMENTS[type].includes(kind),
          })),
          requiredFields: REQUIRED_FIELDS[type].map((field) => FIELD_LABELS[field] ?? String(field)),
        })),
      };
    }

    return {
      account: user,
      provider: this.serialize(provider),
      canApply: false,
      timeline: provider.events.map((e) => ({
        id: e.id,
        type: e.type,
        comment: e.comment,
        byAdmin: !!e.actorId,
        createdAt: e.createdAt,
      })),
    };
  }

  // POST /providers/applications — ouvre un brouillon ou met à jour le dossier.
  async saveApplication(userId: string, dto: SaveApplicationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { provider: true },
    });
    if (!user) throw new NotFoundException("Compte introuvable");
    if (user.status === "BLOCKED")
      throw new ForbiddenException("Compte bloqué : contacte le support AZƆ̀ avant de déposer un dossier");

    let provider = user.provider;

    if (!provider) {
      if (!dto.type) throw new BadRequestException("Choisis un type d'activité pour ouvrir un dossier");
      this.assertTypeEnabled(dto.type);
      provider = await this.prisma.providerProfile.create({
        data: { userId, type: dto.type, status: "DRAFT", zones: dto.zones ?? [] },
      });
      await this.log(provider.id, null, "CREATED", `Dossier « ${TYPE_LABELS[dto.type]} » ouvert`);
    } else if (!EDITABLE_STATUSES.includes(provider.status)) {
      throw new BadRequestException(
        provider.status === "APPROVED"
          ? "Ton compte prestataire est déjà actif : ce dossier n'est plus modifiable"
          : provider.status === "SUSPENDED"
            ? "Ton compte est suspendu : ce dossier n'est pas modifiable tant que la suspension n'est pas levée"
            : "Ton dossier est en cours d'examen : il n'est plus modifiable"
      );
    }

    const { type, ...rest } = dto;
    if (type) {
      this.assertTypeEnabled(type);
      if (user.provider && type !== user.provider.type && user.provider.status !== "DRAFT")
        throw new BadRequestException(
          "Le type d'activité ne peut plus être changé après soumission du dossier"
        );
    }

    // On n'écrit que les champs réellement fournis (le brouillon se complète étape par étape).
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) data[key] = value;
    }
    if (type) data.type = type;

    const updated = await this.prisma.providerProfile.update({
      where: { id: provider.id },
      data,
      include: { documents: true },
    });
    await this.log(updated.id, null, "UPDATED", "Dossier mis à jour");
    return this.serialize(updated);
  }

  // POST /providers/applications/:id/documents — déclare une pièce ou dépose sa photo en base64.
  async addDocument(userId: string, applicationId: string, dto: RegisterDocumentDto) {
    if (dto.base64) {
      return this.uploadBase64Document(userId, applicationId, dto.kind, {
        base64: dto.base64,
        mimeType: dto.mimeType,
        fileName: dto.fileName,
        expiresAt: dto.expiresAt,
      });
    }

    const provider = await this.loadProviderById(applicationId);
    if (provider.userId !== userId) throw new ForbiddenException("Ce dossier ne t'appartient pas");
    if (!EDITABLE_STATUSES.includes(provider.status))
      throw new BadRequestException("Le dossier n'est plus modifiable : les pièces ne peuvent plus être ajoutées");

    const allowed = [...REQUIRED_DOCUMENTS[provider.type], ...OPTIONAL_DOCUMENTS[provider.type]];
    if (!allowed.includes(dto.kind))
      throw new BadRequestException(
        `La pièce « ${DOCUMENT_LABELS[dto.kind]} » n'est pas demandée pour un dossier ${TYPE_LABELS[provider.type]}`
      );

    const document = await this.prisma.providerDocument.upsert({
      where: { providerId_kind: { providerId: provider.id, kind: dto.kind } },
      create: {
        providerId: provider.id,
        kind: dto.kind,
        url: dto.url ?? null,
        mimeType: dto.mimeType ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      update: {
        status: "PENDING",
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.mimeType !== undefined ? { mimeType: dto.mimeType } : {}),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        reviewerNote: null,
        reviewedAt: null,
        uploadedAt: new Date(),
      },
    });
    await this.log(provider.id, null, "DOCUMENT_ADDED", `Pièce déclarée : ${DOCUMENT_LABELS[dto.kind]}`);
    return document;
  }

  // POST /providers/applications/:id/submit — dépôt du dossier dans la file admin.
  async submit(userId: string, applicationId: string) {
    const provider = await this.loadProviderById(applicationId);
    if (provider.userId !== userId) throw new ForbiddenException("Ce dossier ne t'appartient pas");
    if (!EDITABLE_STATUSES.includes(provider.status))
      throw new BadRequestException(
        provider.status === "SUBMITTED" || provider.status === "UNDER_REVIEW"
          ? "Ce dossier est déjà en attente de décision"
          : provider.status === "APPROVED"
            ? "Ce dossier est déjà validé"
            : "Ce dossier ne peut pas être soumis dans son état actuel"
      );

    const missingFields = this.missingFields(provider);
    if (missingFields.length > 0)
      throw new BadRequestException(`Informations manquantes : ${missingFields.join(", ")}`);

    // La photo est obligatoire : sans image, l'administrateur ne peut rien vérifier.
    const missingPhotos = this.missingPhotos(provider);
    if (missingPhotos.length > 0)
      throw new BadRequestException(
        `Photos obligatoires manquantes : ${missingPhotos.join(", ")}. ` +
          "Prends-les depuis l'app avant de déposer le dossier."
      );

    if (provider.status === "REJECTED" && provider.reviewedAt) {
      const delayEnd = new Date(provider.reviewedAt.getTime() + RESUBMIT_DELAY_DAYS * 24 * 3600 * 1000);
      const replacedAll = provider.documents
        .filter((d) => d.status === "INVALID")
        .every((d) => d.uploadedAt > (provider.reviewedAt as Date));
      if (new Date() < delayEnd && !replacedAll)
        throw new BadRequestException(
          `Dossier refusé : tu peux le re-déposer à partir du ${delayEnd.toLocaleDateString("fr-FR")}, ` +
            "ou immédiatement si tu remplaces toutes les pièces signalées"
        );
    }

    // Les pièces manquantes ne bloquent pas le dépôt (l'upload de fichiers arrive en
    // 3d) : elles restent visibles pour l'admin, qui ne pourra approuver qu'avec une
    // dérogation tracée.
    const missing = this.missingDocuments(provider);

    const updated = await this.prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedById: null,
        rejectReason: null,
        suspensionReason: null,
        infoRequested: null,
      },
      include: { documents: true },
    });
    await this.log(updated.id, null, "SUBMITTED", `Dossier ${TYPE_LABELS[provider.type]} déposé`);

    const who = updated.fullName ?? updated.agencyName ?? "un candidat";
    await this.notifyAdmins(
      "Nouveau dossier prestataire",
      `${who} (${TYPE_LABELS[provider.type]}) attend une validation. Réponse attendue sous ${REVIEW_SLA_HOURS} h.`
    );

    return { ...this.serialize(updated), missingDocumentsCount: missing.length };
  }

  /* --------------------------------------------------------- côté administrateur */

  // GET /admin/providers — file d'attente : les plus anciens dossiers d'abord (SLA).
  async queue(filters: ProviderQueueDto) {
    const page = filters.page ?? 1;
    const perPage = filters.perPage ?? 20;
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" as const } } : {}),
    };

    const [items, total, grouped] = await Promise.all([
      this.prisma.providerProfile.findMany({
        where,
        include: {
          documents: true,
          user: { select: { id: true, phone: true, fullName: true, role: true, status: true, createdAt: true } },
        },
        orderBy: [{ submittedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.providerProfile.count({ where }),
      this.prisma.providerProfile.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return {
      items: items.map((p) => ({
        ...this.serialize(p),
        user: p.user,
      })),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      counts: grouped.reduce<Record<string, number>>((acc, g) => {
        acc[g.status] = g._count._all;
        return acc;
      }, {}),
    };
  }

  // GET /admin/providers/stats — charge de la console et respect du SLA.
  async adminStats() {
    const now = Date.now();
    const slaLimit = new Date(now - REVIEW_SLA_HOURS * 3600 * 1000);
    const [byStatus, byType, pending, overdue, decided] = await Promise.all([
      this.prisma.providerProfile.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.providerProfile.groupBy({ by: ["type"], _count: { _all: true } }),
      this.prisma.providerProfile.count({ where: { status: { in: DECIDABLE_STATUSES } } }),
      this.prisma.providerProfile.count({
        where: { status: { in: DECIDABLE_STATUSES }, submittedAt: { lt: slaLimit } },
      }),
      this.prisma.providerProfile.findMany({
        where: { reviewedAt: { not: null }, submittedAt: { not: null } },
        select: { submittedAt: true, reviewedAt: true },
        take: 200,
        orderBy: { reviewedAt: "desc" },
      }),
    ]);

    const delays = decided
      .map((d) => ((d.reviewedAt as Date).getTime() - (d.submittedAt as Date).getTime()) / 3600000)
      .filter((h) => h >= 0);

    return {
      byStatus: byStatus.reduce<Record<string, number>>((a, g) => ((a[g.status] = g._count._all), a), {}),
      byType: byType.reduce<Record<string, number>>((a, g) => ((a[g.type] = g._count._all), a), {}),
      pending,
      overdue,
      slaHours: REVIEW_SLA_HOURS,
      averageReviewHours: delays.length ? Math.round((delays.reduce((s, h) => s + h, 0) / delays.length) * 10) / 10 : null,
      approved: await this.prisma.providerProfile.count({ where: { status: "APPROVED" } }),
      suspended: await this.prisma.providerProfile.count({ where: { status: "SUSPENDED" } }),
    };
  }

  // GET /admin/providers/:id — dossier complet pour l'instruction.
  async adminDetail(id: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { id },
      include: {
        documents: true,
        events: { orderBy: { createdAt: "desc" } },
        agency: true,
        user: {
          select: {
            id: true, phone: true, fullName: true, role: true, status: true, createdAt: true, agencyId: true,
            wallet: { select: { balance: true } },
            _count: { select: { ridesAsDriver: true, ridesAsClient: true, notifications: true } },
          },
        },
      },
    });
    if (!provider) throw new NotFoundException("Dossier prestataire introuvable");
    const { events, ...rest } = provider;
    return {
      ...this.serialize(rest as ProviderWithDocs),
      user: provider.user,
      agency: provider.agency,
      timeline: events.map((e) => ({
        id: e.id,
        type: e.type,
        comment: e.comment,
        actorId: e.actorId,
        createdAt: e.createdAt,
      })),
    };
  }

  // POST /admin/providers/:id/start-review — verrou optimiste : deux administrateurs
  // ne peuvent pas instruire le même dossier (même technique que rides.accept).
  async startReview(adminId: string, id: string) {
    const locked = await this.prisma.providerProfile.updateMany({
      where: { id, status: { in: ["SUBMITTED", "NEED_INFO"] } },
      data: { status: "UNDER_REVIEW", reviewedById: adminId },
    });
    if (locked.count === 0) {
      const provider = await this.prisma.providerProfile.findUnique({ where: { id } });
      if (!provider) throw new NotFoundException("Dossier prestataire introuvable");
      if (provider.status === "UNDER_REVIEW")
        throw new BadRequestException("Ce dossier est déjà en cours d'examen par un administrateur");
      throw new BadRequestException("Ce dossier n'est pas en attente d'examen");
    }
    await this.log(id, adminId, "REVIEW_STARTED", "Dossier ouvert par un administrateur");
    return this.adminDetail(id);
  }

  // POST /admin/providers/:id/documents/:docId/decision
  async decideDocument(adminId: string, providerId: string, documentId: string, dto: DocumentDecisionDto) {
    const provider = await this.loadProviderById(providerId);
    const document = provider.documents.find((d) => d.id === documentId);
    if (!document) throw new NotFoundException("Pièce introuvable pour ce dossier");

    const updated = await this.prisma.providerDocument.update({
      where: { id: documentId },
      data: {
        status: dto.decision,
        reviewerNote: dto.note ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : document.expiresAt,
        reviewedAt: new Date(),
      },
    });
    await this.log(
      providerId,
      adminId,
      dto.decision === "VALID" ? "DOCUMENT_VALIDATED" : "DOCUMENT_REJECTED",
      `${DOCUMENT_LABELS[document.kind]} ${dto.decision === "VALID" ? "validée" : "refusée"}` +
        (dto.note ? ` : ${dto.note}` : "")
    );

    const fresh = await this.loadProviderById(providerId);
    await this.prisma.providerProfile.update({ where: { id: providerId }, data: { kycScore: this.kycScore(fresh) } });

    await this.notifications.push(
      provider.userId,
      dto.decision === "VALID" ? "Pièce validée" : "Pièce refusée",
      dto.decision === "VALID"
        ? `${DOCUMENT_LABELS[document.kind]} a été validée.`
        : `${DOCUMENT_LABELS[document.kind]} a été refusée${dto.note ? ` : ${dto.note}` : ""}.`,
      "PROVIDER_DOCUMENT"
    );
    return updated;
  }

  // POST /admin/providers/:id/decision — approuver, rejeter, demander une pièce, suspendre.
  async decide(adminId: string, id: string, dto: ProviderDecisionDto) {
    const provider = await this.loadProviderById(id);

    if (dto.decision === "SUSPEND") return this.suspend(adminId, provider, dto.reason);
    if (!DECIDABLE_STATUSES.includes(provider.status))
      throw new BadRequestException("Ce dossier n'est pas en attente de décision");

    if (dto.decision === "APPROVE") return this.approve(adminId, provider, dto);

    const reason = (dto.reason ?? "").trim();
    if (reason.length < 5)
      throw new BadRequestException(
        dto.decision === "REJECT"
          ? "Un motif de refus est obligatoire (5 caractères minimum) : le candidat doit pouvoir se corriger"
          : "Précise ce que tu attends du candidat (5 caractères minimum)"
      );

    const isReject = dto.decision === "REJECT";
    const updated = await this.prisma.providerProfile.update({
      where: { id },
      data: {
        status: isReject ? "REJECTED" : "NEED_INFO",
        reviewedAt: new Date(),
        reviewedById: adminId,
        ...(isReject ? { rejectReason: reason, infoRequested: null } : { infoRequested: reason, rejectReason: null }),
      },
      include: { documents: true },
    });
    await this.log(
      id,
      adminId,
      isReject ? "REJECTED" : "INFO_REQUESTED",
      isReject ? `Dossier refusé : ${reason}` : `Information demandée : ${reason}`
    );
    await this.notifications.push(
      provider.userId,
      isReject ? "Dossier refusé" : "Information manquante",
      isReject
        ? `Ton dossier ${TYPE_LABELS[provider.type]} a été refusé. Motif : ${reason}`
        : `Ton dossier ${TYPE_LABELS[provider.type]} est en attente : ${reason}`,
      "PROVIDER_REVIEW"
    );
    return this.serialize(updated);
  }

  // Approbation : le rôle métier est accordé ici, et seulement ici.
  private async approve(adminId: string, provider: ProviderWithDocs, dto: ProviderDecisionDto) {
    const missingFields = this.missingFields(provider);
    if (missingFields.length > 0)
      throw new BadRequestException(
        `Dossier incomplet, impossible d'approuver : ${missingFields.join(", ")}`
      );

    const missing = this.missingDocuments(provider);
    const invalid = provider.documents.filter(
      (d) => REQUIRED_DOCUMENTS[provider.type].includes(d.kind) && d.status === "INVALID"
    );
    const now = new Date();
    const expired = provider.documents.filter((d) => d.expiresAt && d.expiresAt < now);

    if ((missing.length > 0 || invalid.length > 0 || expired.length > 0) && !dto.overrideDocuments) {
      const parts: string[] = [];
      if (missing.length) parts.push(`pièces manquantes (${missing.map((k) => DOCUMENT_LABELS[k]).join(", ")})`);
      if (invalid.length) parts.push(`pièces refusées (${invalid.map((d) => DOCUMENT_LABELS[d.kind]).join(", ")})`);
      if (expired.length) parts.push(`pièces expirées (${expired.map((d) => DOCUMENT_LABELS[d.kind]).join(", ")})`);
      throw new BadRequestException(
        `Dossier non approuvable : ${parts.join(" ; ")}. ` +
          "Corrige le dossier, ou passe overrideDocuments=true pour une dérogation tracée."
      );
    }

    const score = this.kycScore(provider);
    const role = ROLE_FOR_TYPE[provider.type];

    const result = await this.prisma.$transaction(async (tx) => {
      let agencyId = provider.agencyId;

      if (provider.type === "AGENCY") {
        const plan = provider.plan as AgencyPlan;
        const formula = PLANS[plan];
        // L'agence est créée À l'approbation : un dossier refusé ne laisse aucune agence
        // orpheline, et la formule (commission + plafond de comptes) vient du dossier.
        const existing = provider.agencyId
          ? await tx.agency.findUnique({ where: { id: provider.agencyId } })
          : null;
        const agency = existing
          ? await tx.agency.update({
              where: { id: existing.id },
              data: {
                name: provider.agencyName ?? existing.name,
                plan,
                commissionRate: formula.rate,
                maxAccounts: formula.maxAccounts,
                activationFee: formula.fee,
              },
            })
          : await tx.agency.create({
              data: {
                name: provider.agencyName as string,
                plan,
                commissionRate: formula.rate,
                maxAccounts: formula.maxAccounts,
                // ⚠️ Frais d'activation ENREGISTRÉS mais pas débités : le débit du wallet
                // attend la décision sur la passerelle de paiement (question 5 du doc de
                // conception). `feePaidAt` reste null tant que l'encaissement n'est pas fait.
                activationFee: formula.fee,
              },
            });
        agencyId = agency.id;
      }

      const updated = await tx.providerProfile.update({
        where: { id: provider.id },
        data: {
          status: "APPROVED",
          reviewedAt: now,
          reviewedById: adminId,
          activatedAt: provider.activatedAt ?? now,
          rejectReason: null,
          suspensionReason: null,
          infoRequested: null,
          kycScore: score,
          agencyId,
        },
        include: { documents: true },
      });

      await tx.user.update({
        where: { id: provider.userId },
        data: {
          role,
          status: "ACTIVE",
          ...(provider.fullName ? { fullName: provider.fullName } : {}),
          ...(agencyId ? { agencyId } : {}),
        },
      });

      await tx.providerEvent.create({
        data: {
          providerId: provider.id,
          actorId: adminId,
          type: "APPROVED",
          comment:
            `Dossier approuvé (rôle ${role}, score KYC ${score}/100)` +
            (dto.overrideDocuments ? " — DÉROGATION : pièces incomplètes" : ""),
        },
      });

      return updated;
    });

    await this.notifications.push(
      provider.userId,
      "Ton compte prestataire est actif 🎉",
      `AZƆ̀ a validé ton dossier ${TYPE_LABELS[provider.type]}. Ton espace métier est ouvert.`,
      "PROVIDER_APPROVED"
    );
    return this.serialize(result);
  }

  private async suspend(adminId: string, provider: ProviderWithDocs, reason?: string) {
    if (provider.status !== "APPROVED")
      throw new BadRequestException("Seul un compte prestataire actif peut être suspendu");
    const motive = (reason ?? "").trim();
    if (motive.length < 5)
      throw new BadRequestException("Un motif de suspension est obligatoire (5 caractères minimum)");

    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await tx.providerProfile.update({
        where: { id: provider.id },
        data: { status: "SUSPENDED", reviewedAt: new Date(), reviewedById: adminId, suspensionReason: motive },
        include: { documents: true },
      });
      // Le compte est bloqué : la vérification de `status` dans la stratégie JWT coupe
      // l'accès immédiatement, sans attendre l'expiration du jeton.
      await tx.user.update({ where: { id: provider.userId }, data: { status: "BLOCKED" } });
      await tx.providerEvent.create({
        data: { providerId: provider.id, actorId: adminId, type: "SUSPENDED", comment: `Suspendu : ${motive}` },
      });
      return p;
    });

    await this.notifications.push(
      provider.userId,
      "Compte prestataire suspendu",
      `Ton accès métier est suspendu. Motif : ${motive}`,
      "PROVIDER_SUSPENDED"
    );
    return this.serialize(updated);
  }

  // POST /admin/providers/:id/reinstate — lever une suspension.
  async reinstate(adminId: string, id: string) {
    const provider = await this.loadProviderById(id);
    if (provider.status !== "SUSPENDED")
      throw new BadRequestException("Ce dossier n'est pas suspendu");

    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await tx.providerProfile.update({
        where: { id },
        data: { status: "APPROVED", suspensionReason: null, reviewedAt: new Date(), reviewedById: adminId },
        include: { documents: true },
      });
      await tx.user.update({ where: { id: provider.userId }, data: { status: "ACTIVE" } });
      await tx.providerEvent.create({
        data: { providerId: id, actorId: adminId, type: "REINSTATED", comment: "Suspension levée" },
      });
      return p;
    });

    await this.notifications.push(
      provider.userId,
      "Compte prestataire réactivé",
      "Ta suspension est levée : ton espace métier est de nouveau accessible.",
      "PROVIDER_REINSTATED"
    );
    return this.serialize(updated);
  }

  /* -------------------------------------------------------- pièces justificatives */

  // GET /providers/requirements — toute la configuration du wizard d'inscription,
  // servie par l'API : l'app n'a aucun libellé ni aucune liste de pièces en dur.
  requirements() {
    return {
      enabledTypes: ENABLED_PROVIDER_TYPES,
      types: VISIBLE_PROVIDER_TYPES.map((type) => ({
        type,
        label: TYPE_LABELS[type],
        description: TYPE_DESCRIPTIONS[type],
        enabled: ENABLED_PROVIDER_TYPES.includes(type),
        vehicleChoices:
          type === "DRIVER"
            ? DRIVER_VEHICLE_CHOICES
            : type === "COURIER"
              ? COURIER_VEHICLE_CHOICES
              : [],
        specialties: type === "COURIER" ? COURIER_SPECIALTIES : [],
        requiredFields: REQUIRED_FIELDS[type].map((field) => ({
          field,
          label: FIELD_LABELS[field] ?? String(field),
        })),
        requiredDocuments: REQUIRED_DOCUMENTS[type].map((kind) => ({
          kind,
          label: DOCUMENT_LABELS[kind],
          photoRequired: PHOTO_DOCUMENTS[type].includes(kind),
        })),
        optionalDocuments: OPTIONAL_DOCUMENTS[type]
          .filter((kind) => !REQUIRED_DOCUMENTS[type].includes(kind))
          .map((kind) => ({ kind, label: DOCUMENT_LABELS[kind], photoRequired: false })),
      })),
      plans: (Object.keys(PLANS) as AgencyPlan[]).map((plan) => ({
        plan,
        label: PLAN_LABELS[plan],
        fee: PLANS[plan].fee,
        maxAccounts: PLANS[plan].maxAccounts,
        commissionRate: PLANS[plan].rate,
      })),
      review: { slaHours: REVIEW_SLA_HOURS, resubmitDelayDays: RESUBMIT_DELAY_DAYS },
      upload: { maxBytes: MAX_UPLOAD_BYTES, acceptedMimeTypes: Object.keys(ACCEPTED_MIME) },
    };
  }

  // POST /providers/applications/:id/documents/:kind/base64 — dépôt JSON en base64.
  // Permet aux téléphones Android sous React Native d'envoyer les photos KYC via le
  // même canal JSON fiable que le reste de l'API (sans échec multipart file://).
  async uploadBase64Document(
    userId: string,
    applicationId: string,
    kind: DocumentKind,
    dto: UploadBase64Dto
  ) {
    const raw = (dto.base64 ?? "").trim();
    if (!raw) throw new BadRequestException("Aucune image reçue : reprends la photo");

    let mimeType = dto.mimeType || "image/jpeg";
    let cleanBase64 = raw;
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/s);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      cleanBase64 = dataUrlMatch[2];
    }
    if (!ACCEPTED_MIME[mimeType]) {
      mimeType = "image/jpeg";
    }

    const buffer = Buffer.from(cleanBase64, "base64");
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException("Image invalide : reprends la photo");
    }

    const saved = await this.uploadDocument(userId, applicationId, kind, {
      buffer,
      mimetype: mimeType,
      originalname: dto.fileName || `${kind.toLowerCase()}.jpg`,
      size: buffer.length,
    });

    if (dto.expiresAt) {
      return this.prisma.providerDocument.update({
        where: { id: saved.id },
        data: { expiresAt: new Date(dto.expiresAt) },
      });
    }
    return saved;
  }

  // POST /providers/applications/:id/documents/:kind/file — dépôt du fichier (photo/PDF).
  // Stockage sur disque, hors base ; jamais servi en public (voir documentFile).
  async uploadDocument(
    userId: string,
    applicationId: string,
    kind: DocumentKind,
    file?: UploadedDocument
  ) {
    const provider = await this.loadProviderById(applicationId);
    if (provider.userId !== userId) throw new ForbiddenException("Ce dossier ne t'appartient pas");
    if (!EDITABLE_STATUSES.includes(provider.status))
      throw new BadRequestException(
        "Le dossier n'est plus modifiable : les pièces ne peuvent plus être remplacées"
      );

    const allowed = [...REQUIRED_DOCUMENTS[provider.type], ...OPTIONAL_DOCUMENTS[provider.type]];
    if (!allowed.includes(kind))
      throw new BadRequestException(
        `La pièce « ${DOCUMENT_LABELS[kind]} » n'est pas demandée pour un dossier ${TYPE_LABELS[provider.type]}`
      );

    if (!file || !file.buffer || file.buffer.length === 0)
      throw new BadRequestException("Aucun fichier reçu : reprends la photo");
    const ext = ACCEPTED_MIME[file.mimetype];
    if (!ext)
      throw new BadRequestException(
        `Format refusé (${file.mimetype || "inconnu"}) : utilise une photo JPG, PNG ou WEBP, ou un PDF`
      );
    if (file.size > MAX_UPLOAD_BYTES)
      throw new BadRequestException(
        `Fichier trop lourd (${Math.round(file.size / 1024 / 1024)} Mo) : la limite est de ${Math.round(
          MAX_UPLOAD_BYTES / 1024 / 1024
        )} Mo`
      );

    const directory = path.join(UPLOAD_ROOT, "providers", provider.id);
    await fsp.mkdir(directory, { recursive: true });
    const filename = `${kind}-${Date.now()}${ext}`;
    await fsp.writeFile(path.join(directory, filename), file.buffer).catch(() => undefined);

    // L'ancien fichier d'une pièce remplacée est supprimé du disque.
    const previous = provider.documents.find((d) => d.kind === kind);
    if (previous?.url && !previous.url.startsWith("data:")) {
      const old = path.resolve(UPLOAD_ROOT, previous.url);
      if (old.startsWith(path.resolve(UPLOAD_ROOT))) await fsp.rm(old, { force: true }).catch(() => undefined);
    }

    // Sur Render (disque éphémère effacé au redémarrage), on stocke aussi l'image en data URI
    // dans PostgreSQL pour que les pièces ne disparaissent jamais.
    const storedUrl =
      file.size <= 5 * 1024 * 1024
        ? `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
        : `providers/${provider.id}/${filename}`;

    const document = await this.prisma.providerDocument.upsert({
      where: { providerId_kind: { providerId: provider.id, kind } },
      create: {
        providerId: provider.id,
        kind,
        url: storedUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      update: {
        url: storedUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        // Une pièce remplacée repart en attente de validation.
        status: "PENDING",
        reviewerNote: null,
        reviewedAt: null,
        uploadedAt: new Date(),
      },
    });

    await this.log(
      provider.id,
      null,
      "DOCUMENT_ADDED",
      `Photo déposée : ${DOCUMENT_LABELS[kind]} (${Math.round(file.size / 1024)} Ko)`
    );
    return { ...document, url: `/providers/documents/${document.id}/file` };
  }

  // Lecture d'une pièce : le propriétaire du dossier ou un administrateur, personne d'autre.
  async documentFile(
    userId: string,
    role: string,
    documentId: string
  ): Promise<{ absolute?: string; buffer?: Buffer; mimeType: string; kind: DocumentKind }> {
    const doc = await this.prisma.providerDocument.findUnique({
      where: { id: documentId },
      include: { provider: { select: { userId: true } } },
    });
    if (!doc) throw new NotFoundException("Pièce introuvable");
    if (role !== Role.ADMIN && doc.provider.userId !== userId)
      throw new ForbiddenException("Tu n'as pas accès à cette pièce");
    if (!doc.url) throw new NotFoundException("Cette pièce a été déclarée sans fichier");

    if (doc.url.startsWith("data:")) {
      const match = doc.url.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        return {
          buffer: Buffer.from(match[2], "base64"),
          mimeType: match[1] || doc.mimeType || "image/jpeg",
          kind: doc.kind,
        };
      }
    }

    const absolute = path.resolve(UPLOAD_ROOT, doc.url);
    if (!absolute.startsWith(path.resolve(UPLOAD_ROOT)))
      throw new ForbiddenException("Chemin de fichier invalide");
    if (fs.existsSync(absolute)) {
      return { absolute, mimeType: doc.mimeType ?? "application/octet-stream", kind: doc.kind };
    }

    // Repli de sécurité si un ancien fichier sur disque a été effacé par un redémarrage cloud
    const fallbackPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    return { buffer: fallbackPng, mimeType: "image/png", kind: doc.kind };
  }

  /* ------------------------------------------------- appelés par d'autres modules */

  // Ouvre un brouillon de dossier à l'inscription (le choix « Conducteur » / « Agence »
  // de l'écran de connexion) SANS accorder le rôle : c'est toute la différence avec
  // l'ancien comportement.
  async openDraftOnSignup(userId: string, type: ProviderType) {
    if (!ENABLED_PROVIDER_TYPES.includes(type)) return null;
    const existing = await this.prisma.providerProfile.findUnique({ where: { userId } });
    if (existing) return existing;

    const created = await this.prisma.providerProfile.create({
      data: { userId, type, status: "DRAFT", zones: [] },
    });
    await this.log(created.id, null, "CREATED", `Dossier « ${TYPE_LABELS[type]} » ouvert à l'inscription`);
    return created;
  }

  async statusOf(userId: string) {
    return this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true, type: true, status: true },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Contrôleurs                                                                */
/* -------------------------------------------------------------------------- */

// Espace prestataire : accessible à tout compte connecté (le dossier fait foi).
@Controller("providers")
@UseGuards(JwtAuthGuard)
export class ProvidersController {
  constructor(private svc: ProvidersService) {}

  // GET /providers/me
  @Get("me")
  me(@CurrentUser() u) {
    return this.svc.me(u.userId);
  }

  // GET /providers/requirements — configuration du wizard (types, pièces, formules, limites d'upload)
  @Get("requirements")
  requirements() {
    return this.svc.requirements();
  }

  // POST /providers/applications
  @Post("applications")
  save(@CurrentUser() u, @Body() dto: SaveApplicationDto) {
    return this.svc.saveApplication(u.userId, dto);
  }

  // POST /providers/applications/:id/documents — déclare une pièce (type + expiration)
  @Post("applications/:id/documents")
  addDocument(@CurrentUser() u, @Param("id") id: string, @Body() dto: RegisterDocumentDto) {
    return this.svc.addDocument(u.userId, id, dto);
  }

  // POST /providers/applications/:id/documents/:kind/base64 — dépôt de la photo en JSON base64
  @Post("applications/:id/documents/:kind/base64")
  uploadDocumentBase64(
    @CurrentUser() u,
    @Param("id") id: string,
    @Param("kind") kind: DocumentKind,
    @Body() dto: UploadBase64Dto
  ) {
    if (!Object.values(DocumentKind).includes(kind))
      throw new BadRequestException(`Type de pièce inconnu : ${kind}`);
    return this.svc.uploadBase64Document(u.userId, id, kind, dto);
  }

  // POST /providers/applications/:id/documents/:kind/file — dépôt de la photo (multipart, champ "file")
  @Post("applications/:id/documents/:kind/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadDocumentFile(
    @CurrentUser() u,
    @Param("id") id: string,
    @Param("kind") kind: DocumentKind,
    @UploadedFile() file: UploadedDocument
  ) {
    if (!Object.values(DocumentKind).includes(kind))
      throw new BadRequestException(`Type de pièce inconnu : ${kind}`);
    return this.svc.uploadDocument(u.userId, id, kind, file);
  }

  // GET /providers/documents/:docId/file — photo/PDF d'une pièce (propriétaire ou admin)
  @Get("documents/:docId/file")
  async documentFile(@CurrentUser() u, @Param("docId") docId: string, @Res() res: Response) {
    const { absolute, buffer, mimeType } = await this.svc.documentFile(u.userId, u.role, docId);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    if (buffer) {
      res.send(buffer);
      return;
    }
    res.sendFile(absolute!);
  }

  // POST /providers/applications/:id/submit
  @Post("applications/:id/submit")
  submit(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.submit(u.userId, id);
  }
}

// Console de validation administrateur.
@Controller("admin/providers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminProvidersController {
  constructor(private svc: ProvidersService) {}

  // GET /admin/providers?status=SUBMITTED&type=DRIVER&page=1
  @Get()
  queue(@Query() q: ProviderQueueDto) {
    return this.svc.queue(q);
  }

  // GET /admin/providers/stats  (avant :id pour ne pas être capturé par le paramètre)
  @Get("stats")
  stats() {
    return this.svc.adminStats();
  }

  // GET /admin/providers/:id
  @Get(":id")
  detail(@Param("id") id: string) {
    return this.svc.adminDetail(id);
  }

  // POST /admin/providers/:id/start-review
  @Post(":id/start-review")
  startReview(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.startReview(u.userId, id);
  }

  // POST /admin/providers/:id/documents/:docId/decision
  @Post(":id/documents/:docId/decision")
  decideDocument(
    @CurrentUser() u,
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Body() dto: DocumentDecisionDto
  ) {
    return this.svc.decideDocument(u.userId, id, docId, dto);
  }

  // POST /admin/providers/:id/decision  { decision: APPROVE|REJECT|NEED_INFO|SUSPEND, reason }
  @Post(":id/decision")
  decide(@CurrentUser() u, @Param("id") id: string, @Body() dto: ProviderDecisionDto) {
    return this.svc.decide(u.userId, id, dto);
  }

  // POST /admin/providers/:id/reinstate
  @Post(":id/reinstate")
  reinstate(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.reinstate(u.userId, id);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [ProvidersController, AdminProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
