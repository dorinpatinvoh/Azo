/** Notifications traduites côté serveur (fr, en, es, de) : catalogue complet, interpolation, envoi dans la langue de l'utilisateur. */
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/common/guards/jwt-auth.guard", () => ({ JwtAuthGuard: class JwtAuthGuard {} }));

import { NotificationsService } from "../src/notifications/notifications.module";
import { NOTIFICATION_TEXTS, interpolate, translateNotification } from "../src/notifications/notification-texts";

const LANGS = ["fr", "en", "es", "de"] as const;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogue des notifications", () => {
  it("chaque message existe dans les quatre langues, avec un titre ou un corps", () => {
    for (const [key, entry] of Object.entries(NOTIFICATION_TEXTS)) {
      for (const lang of LANGS) {
        const pair = entry[lang];
        expect(pair).toBeDefined();
        expect((pair.title ?? "") + (pair.body ?? "")).not.toBe("");
      }
      // si le français a un titre / un corps, les autres langues aussi
      for (const lang of ["en", "es", "de"] as const) {
        expect(Boolean(entry[lang].title)).toBe(Boolean(entry.fr.title));
        expect(Boolean(entry[lang].body)).toBe(Boolean(entry.fr.body));
      }
      void key;
    }
  });

  it("les paramètres {…} sont les mêmes dans toutes les langues", () => {
    for (const [key, entry] of Object.entries(NOTIFICATION_TEXTS)) {
      for (const field of ["title", "body"] as const) {
        const reference = placeholders(entry.fr[field] ?? "");
        for (const lang of ["en", "es", "de"] as const) {
          expect({ key, field, lang, params: placeholders(entry[lang][field] ?? "") }).toEqual({ key, field, lang, params: reference });
        }
      }
    }
  });
});

describe("interpolation", () => {
  it("remplace les paramètres, vide ceux qui manquent", () => {
    expect(interpolate("{a} et {b}", { a: 1, b: "deux" })).toBe("1 et deux");
    expect(interpolate("{a} {z}", { a: 1 })).toBe("1 ");
  });
  it("un segment [[ … ]] n'apparaît que si tous ses paramètres sont renseignés", () => {
    expect(interpolate("Fin.[[ Position : {link}]]", { link: "https://x" })).toBe("Fin. Position : https://x");
    expect(interpolate("Fin.[[ Position : {link}]]", { link: "" })).toBe("Fin.");
    expect(interpolate("Fin.[[ Position : {link}]]", {})).toBe("Fin.");
  });
});

describe("translateNotification", () => {
  it("traduit titre et corps avec les paramètres", () => {
    expect(translateNotification("en", "NOTIFICATION_RIDE_COMPLETED_CLIENT", "NOTIFICATION_RIDE_COMPLETED_CLIENT_BODY", { amount: 1500 })).toEqual({
      title: "Ride completed",
      body: "1500 FCFA debited from your wallet.",
    });
  });
  it("un _BODY sans entrée propre reprend le corps du message de base", () => {
    const r = translateNotification("de", "NOTIFICATION_RIDE_MATCHED", "NOTIFICATION_RIDE_MATCHED_BODY");
    expect(r.title).toBe("Fahrer gefunden");
    expect(r.body).toContain("Fahrer");
  });
  it("corps distinct quand la clé de corps a sa propre entrée (arrêt de course)", () => {
    expect(translateNotification("es", "NOTIFICATION_RIDE_STOP_UPDATED", "NOTIFICATION_RIDE_STOP_DECLINED_BODY")).toEqual({
      title: "Solicitud de parada actualizada",
      body: "El otro participante rechazó la parada. La carrera continúa.",
    });
  });
  it("SOS : la position n'apparaît que si elle est connue", () => {
    const withPos = translateNotification("en", "NOTIFICATION_SOS_ADMIN_CLIENT", undefined, { ref: "#abc123", link: "https://maps/q" });
    const withoutPos = translateNotification("en", "NOTIFICATION_SOS_ADMIN_CLIENT", undefined, { ref: "#abc123", link: "" });
    expect(withPos.body).toContain("Location: https://maps/q");
    expect(withoutPos.body).toBe("The customer triggered the SOS alert during ride #abc123.");
  });
  it("clé inconnue, langue inconnue, message de chat : rien à traduire (texte d'origine gardé)", () => {
    expect(translateNotification("en", "NOTIFICATION_INCONNUE")).toEqual({ title: null, body: null });
    expect(translateNotification("pt", "NOTIFICATION_RIDE_MATCHED")).toEqual({ title: null, body: null });
    expect(translateNotification("en", "NOTIFICATION_CHAT_MESSAGE", undefined, { peer: "Kossi" })).toEqual({ title: null, body: null });
  });
});

describe("envoi d'une notification", () => {
  function make(language: string | null | "throw") {
    const created: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockImplementation(() => (language === "throw" ? Promise.reject(new Error("db")) : Promise.resolve(language ? { language } : null))),
      },
      notification: { create: jest.fn().mockImplementation(({ data }) => { created.push(data); return Promise.resolve(data); }) },
      devicePushToken: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new NotificationsService(prisma), created, prisma };
  }
  const send = (service: NotificationsService) =>
    service.push("u1", "Course terminée", "1500 FCFA débités de ton portefeuille.", "payment", {
      titleKey: "NOTIFICATION_RIDE_COMPLETED_CLIENT",
      bodyKey: "NOTIFICATION_RIDE_COMPLETED_CLIENT_BODY",
      params: { amount: 1500 },
    });

  it("enregistre le message dans la langue de l'utilisateur et garde les clés", async () => {
    const { service, created } = make("en");
    await send(service);
    expect(created[0]).toMatchObject({ title: "Ride completed", body: "1500 FCFA debited from your wallet.", titleKey: "NOTIFICATION_RIDE_COMPLETED_CLIENT" });
  });

  it("le français garde le texte de l'appelant", async () => {
    const { service, created } = make("fr");
    await send(service);
    expect(created[0]).toMatchObject({ title: "Course terminée", body: "1500 FCFA débités de ton portefeuille." });
  });

  it("langue illisible ou base en panne : texte d'origine, l'envoi ne casse pas", async () => {
    for (const lang of [null, "throw"] as const) {
      const { service, created } = make(lang);
      await send(service);
      expect(created[0].title).toBe("Course terminée");
    }
  });

  it("sans clé de traduction, la langue n'est même pas lue", async () => {
    const { service, prisma } = make("en");
    await service.push("u1", "Titre", "Corps", "info");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
