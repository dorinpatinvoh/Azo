import { PlacesService } from "../src/places/places.module";

describe("Lieux : quartiers et villages d'Abomey-Calavi et de Cotonou", () => {
  const make = () => {
    const service = new PlacesService();
    // services de cartes en ligne indisponibles : seule la base de quartiers et villages répond
    (service as any).getJson = jest.fn().mockRejectedValue(new Error("hors ligne"));
    return service;
  };

  it("retrouve un village reculé par son nom, sans accent", async () => {
    const { results } = await make().search("kplassouhoue");
    expect(results.some((r: any) => r.title === "Kplassouhoué")).toBe(true);
    expect(results[0].subtitle).toContain("Kpanroun");
  });

  it("liste les quartiers d'un arrondissement quand on tape son nom", async () => {
    const { results } = await make().search("Kpanroun");
    expect(results.length).toBeGreaterThan(3);
    expect(results.every((r: any) => typeof r.latitude === "number" && typeof r.longitude === "number")).toBe(true);
  });

  it("trie par proximité de la personne quand sa position est connue", async () => {
    const { results } = await make().search("Houèto", "6.436", "2.307");
    expect(results[0].title).toBe("Houèto-Centre");
  });

  it("donne l'adresse du quartier connu le plus proche d'un point", async () => {
    const r = await make().reverseGeocode(6.4360192, 2.3066871);
    expect(r.address).toContain("Houèto-Centre");
  });

  it("sans quartier connu proche ni service en ligne, indique la ville la plus proche", async () => {
    const r = await make().reverseGeocode(6.4969, 2.6289);
    expect(r.address).toMatch(/Porto-Novo|Position/);
  });
});
