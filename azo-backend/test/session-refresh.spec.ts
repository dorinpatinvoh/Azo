import { of, lastValueFrom } from "rxjs";
import { SessionRefreshInterceptor } from "../src/auth/session-refresh.interceptor";
import { REFRESHED_TOKEN_HEADER, SESSION_REFRESH_BELOW_SECONDS } from "../src/auth/session";

function ctx(user: any) {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
  return {
    headers,
    context: {
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => ({ user }), getResponse: () => res }),
    } as any,
  };
}
const now = () => Math.floor(Date.now() / 1000);

describe("SessionRefreshInterceptor", () => {
  it("renouvelle le jeton quand la moitié de la durée est écoulée", async () => {
    const jwt: any = { signAsync: jest.fn().mockResolvedValue("nouveau-jeton") };
    const { context, headers } = ctx({ userId: "u1", role: "DRIVER", phone: "+22901", exp: now() + SESSION_REFRESH_BELOW_SECONDS - 60 });
    const out = await lastValueFrom(new SessionRefreshInterceptor(jwt).intercept(context, { handle: () => of({ ok: true }) }));
    expect(out).toEqual({ ok: true });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "u1", role: "DRIVER", phone: "+22901" });
    expect(headers[REFRESHED_TOKEN_HEADER]).toBe("nouveau-jeton");
  });

  it("ne touche à rien tant que le jeton est encore récent", async () => {
    const jwt: any = { signAsync: jest.fn() };
    const { context, headers } = ctx({ userId: "u1", role: "CLIENT", phone: "+22901", exp: now() + SESSION_REFRESH_BELOW_SECONDS + 3600 });
    await lastValueFrom(new SessionRefreshInterceptor(jwt).intercept(context, { handle: () => of(1) }));
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(headers[REFRESHED_TOKEN_HEADER]).toBeUndefined();
  });

  it("laisse partir la réponse si le renouvellement échoue", async () => {
    const jwt: any = { signAsync: jest.fn().mockRejectedValue(new Error("boom")) };
    const { context, headers } = ctx({ userId: "u1", role: "CLIENT", phone: "+22901", exp: now() + 10 });
    const out = await lastValueFrom(new SessionRefreshInterceptor(jwt).intercept(context, { handle: () => of("données") }));
    expect(out).toBe("données");
    expect(headers[REFRESHED_TOKEN_HEADER]).toBeUndefined();
  });

  it("ignore les requêtes sans utilisateur connecté", async () => {
    const jwt: any = { signAsync: jest.fn() };
    const { context } = ctx(undefined);
    await lastValueFrom(new SessionRefreshInterceptor(jwt).intercept(context, { handle: () => of(1) }));
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
