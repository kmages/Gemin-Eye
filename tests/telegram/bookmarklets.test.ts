import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-vitest";
});

describe("generateScanToken / validateScanToken", () => {
  it("a freshly generated token validates", async () => {
    const { generateScanToken, validateScanToken } = await import(
      "../../server/telegram/bookmarklets"
    );
    const token = generateScanToken("12345", 7);
    expect(validateScanToken("12345", 7, token)).toBe(true);
  });

  it("rejects a token bound to a different chat or business", async () => {
    const { generateScanToken, validateScanToken } = await import(
      "../../server/telegram/bookmarklets"
    );
    const token = generateScanToken("12345", 7);
    expect(validateScanToken("12345", 8, token)).toBe(false);
    expect(validateScanToken("99999", 7, token)).toBe(false);
  });

  it("rejects a totally bogus token", async () => {
    const { validateScanToken } = await import("../../server/telegram/bookmarklets");
    expect(validateScanToken("12345", 7, "definitely-not-a-real-token")).toBe(false);
  });
});

describe("generateConnectToken / validateConnectTokenForOwner", () => {
  it("a freshly generated connect token validates for the same owner", async () => {
    const { generateConnectToken, validateConnectTokenForOwner } = await import(
      "../../server/telegram/bookmarklets"
    );
    const token = generateConnectToken(42, "user-abc");
    expect(validateConnectTokenForOwner(42, "user-abc", token)).toBe(true);
  });

  it("rejects when owner mismatches", async () => {
    const { generateConnectToken, validateConnectTokenForOwner } = await import(
      "../../server/telegram/bookmarklets"
    );
    const token = generateConnectToken(42, "user-abc");
    expect(validateConnectTokenForOwner(42, "user-xyz", token)).toBe(false);
  });
});
