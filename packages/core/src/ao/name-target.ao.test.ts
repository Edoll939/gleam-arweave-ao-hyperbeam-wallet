import { afterEach, describe, expect, it, vi } from "vitest";
import Arweave from "arweave";
import { base64UrlToBytes } from "../vault/base64";
import { assertHoldsName, estimateNameTargetFee, nameTargetTags, prepareNameTarget, readNameTarget } from "./name-target";

const jwk = await Arweave.init({}).wallets.generate();
const CARRIER = "cArRiEr_PrOcEsS-0123456789abcdefghijklmnopq";
const TARGET = "tArGeT_MaNiFeSt-0123456789abcdefghijklmnopq";
const HOLDER = "hOlDeR_AdDrEsS-0123456789abcdefghijklmnopqr";
const GATEWAY = "https://arweave.net";
const decoder = new TextDecoder();

afterEach(() => vi.restoreAllMocks());

function stubGateway() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("tx_anchor")) return new Response("b".repeat(64));
    if (url.includes("/price/")) return new Response("500");
    return new Response("OK");
  });
}

describe("prepareNameTarget", () => {
  it("builds a data-less 1-winston transaction to the carrier with exactly the set tags", async () => {
    stubGateway();
    const tx = await prepareNameTarget(GATEWAY, jwk.n, CARRIER, TARGET, "501");
    expect(tx).toMatchObject({ target: CARRIER, quantity: "1", reward: "500", data: "", data_size: "0" });
    expect(tx.tags.map((tag) => ({ name: decoder.decode(base64UrlToBytes(tag.name)), value: decoder.decode(base64UrlToBytes(tag.value)) }))).toEqual([
      { name: "action", value: "set" },
      { name: "reference-value", value: TARGET },
    ]);
  });

  it("refuses a malformed target before touching the network", async () => {
    const fetchSpy = stubGateway();
    await expect(prepareNameTarget(GATEWAY, jwk.n, CARRIER, "short", "501")).rejects.toThrow(/isn't an Arweave id/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a fee that can't carry the winston", async () => {
    stubGateway();
    await expect(prepareNameTarget(GATEWAY, jwk.n, CARRIER, TARGET, "0")).rejects.toThrow();
  });
});

describe("estimateNameTargetFee", () => {
  it("adds the winston to the reward", async () => {
    stubGateway();
    await expect(estimateNameTargetFee(GATEWAY, CARRIER)).resolves.toBe("501");
  });
});

describe("readNameTarget", () => {
  const shape = { target: CARRIER, quantity: "1", data_size: "0", tags: nameTargetTags(TARGET) };

  it("reads the exact set", () => {
    expect(readNameTarget(shape)).toEqual({ carrier: CARRIER, target: TARGET });
  });

  it.each([
    ["a quantity of 0", { quantity: "0" }],
    ["data", { data_size: "4" }],
    ["the tags swapped", { tags: [...nameTargetTags(TARGET)].reverse() }],
    ["an extra tag", { tags: [...nameTargetTags(TARGET), { name: "Assign-To", value: HOLDER }] }],
    ["an uppercase action", { tags: [{ name: "Action", value: "set" }, { name: "reference-value", value: TARGET }] }],
    ["a target that isn't an id", { tags: nameTargetTags("x") }],
  ])("reads nothing from %s", (_label, overrides) => {
    expect(readNameTarget({ ...shape, ...overrides })).toBeNull();
  });
});

describe("assertHoldsName", () => {
  function stubState(state: unknown) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(state));
  }

  it("passes for a balance of 1", async () => {
    stubState({ "execution-device": "carrier@1.0", balances: { [HOLDER]: 1 } });
    await expect(assertHoldsName(CARRIER, HOLDER, [GATEWAY])).resolves.toBeUndefined();
  });

  it("refuses a name escrowed into a sale", async () => {
    stubState({ "execution-device": "carrier@1.0", balances: {}, orders: { a: { creator: HOLDER, quantity: "1", status: "open" } } });
    await expect(assertHoldsName(CARRIER, HOLDER, [GATEWAY])).rejects.toThrow("This wallet no longer holds this name.");
  });

  it("refuses a name someone else holds", async () => {
    stubState({ "execution-device": "carrier@1.0", balances: { [TARGET]: 1 } });
    await expect(assertHoldsName(CARRIER, HOLDER, [GATEWAY])).rejects.toThrow("This wallet no longer holds this name.");
  });

  it("throws when no host returns the state, rather than reading it as held", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 502 }));
    await expect(assertHoldsName(CARRIER, HOLDER, [GATEWAY])).rejects.toThrow("Gleam couldn't check who holds this name. Try again.");
  });
});
