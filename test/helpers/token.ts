import { SignJWT } from "jose";

export const TEST_SECRET = "test-secret-that-is-long-enough-for-hs256-0123456789";
export const TEST_ISSUER = "https://issuer.test/";
export const TEST_AUDIENCE = "geolocation-api";
export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";

export async function signToken(
  sub: string,
  overrides: { issuer?: string; audience?: string; secret?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(overrides.issuer ?? TEST_ISSUER)
    .setAudience(overrides.audience ?? TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "10m")
    .sign(new TextEncoder().encode(overrides.secret ?? TEST_SECRET));
}
