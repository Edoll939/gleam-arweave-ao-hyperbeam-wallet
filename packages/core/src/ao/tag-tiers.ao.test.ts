import { describe, expect, it } from "vitest";
import { tierTags } from "./tag-tiers";

const WALLET = "ECvThiUQHWJj-8HsiyF6C8_mgFbr6seluRs2GKyXa7Y";
const PROCESS = "VvF0Z3xMswxr2CVdLFei2a1NwYffiQ8nIQiPJ1gxJKY";

const tag = (name: string, value: string) => ({ name, value });

describe("tierTags", () => {
  it("sorts a Credit-Notice into headline, addresses, app and protocol tags", () => {
    const tiers = tierTags([
      tag("SDK", "aoconnect"),
      tag("Data-Protocol", "ao"),
      tag("Action", "Credit-Notice"),
      tag("From-Process", PROCESS),
      tag("Quantity", "1"),
      tag("Recipient", WALLET),
      tag("App-Name", "PermaTell"),
      tag("Variant", "ao.TN.1"),
      tag("Type", "Message"),
    ]);
    expect(tiers.headline).toEqual({ tag: tag("Action", "Credit-Notice"), quantity: tag("Quantity", "1") });
    expect(tiers.addresses).toEqual([tag("From-Process", PROCESS), tag("Recipient", WALLET)]);
    expect(tiers.app).toEqual([tag("App-Name", "PermaTell")]);
    expect(tiers.protocol).toEqual([tag("SDK", "aoconnect"), tag("Data-Protocol", "ao"), tag("Variant", "ao.TN.1"), tag("Type", "Message")]);
  });

  it("heads a message with no Action by its Type, unless the Type is Message", () => {
    expect(tierTags([tag("Type", "Process"), tag("Name", "Cool")]).headline).toEqual({ tag: tag("Type", "Process"), quantity: null });
    expect(tierTags([tag("Type", "Message"), tag("Name", "Cool")]).headline).toBeNull();
  });

  it("leaves Quantity an app tag when the headline is a Type", () => {
    const tiers = tierTags([tag("Type", "Process"), tag("Quantity", "5")]);
    expect(tiers.app).toEqual([tag("Quantity", "5")]);
  });

  it("does not headline an Action given twice, in any case, and no Type heads it instead", () => {
    const tiers = tierTags([tag("action", "Transfer"), tag("Action", "Vote"), tag("Action", "Burn"), tag("Type", "Process")]);
    expect(tiers.headline).toBeNull();
    expect(tiers.app).toEqual([tag("action", "Transfer"), tag("Action", "Vote"), tag("Action", "Burn"), { ...tag("Type", "Process"), unusual: { expected: "Message" } }]);
  });

  it("does not headline a Quantity given twice, in any case: both copies stay app tags", () => {
    const tiers = tierTags([tag("Action", "Transfer"), tag("Quantity", "1"), tag("quantity", "1000000"), tag("Recipient", WALLET)]);
    expect(tiers.headline).toEqual({ tag: tag("Action", "Transfer"), quantity: null });
    expect(tiers.app).toEqual([tag("Quantity", "1"), tag("quantity", "1000000")]);
    expect(tiers.addresses).toEqual([tag("Recipient", WALLET)]);
  });

  it("does not headline a Type given twice, in any case, when the copies conflict", () => {
    const tiers = tierTags([tag("Type", "Process"), tag("type", "Other")]);
    expect(tiers.headline).toBeNull();
    expect(tiers.app).toEqual([
      { ...tag("Type", "Process"), unusual: { expected: "Message" } },
      { ...tag("type", "Other"), unusual: { expected: "Message" } },
    ]);
  });

  it("does not headline a Type given twice even when the copies agree", () => {
    const tiers = tierTags([tag("Type", "Process"), tag("type", "Process")]);
    expect(tiers.headline).toBeNull();
    expect(tiers.app).toHaveLength(2);
  });

  it("still heads a message by its Type when the other Type copy is Message", () => {
    const tiers = tierTags([tag("Type", "Message"), tag("Type", "Process")]);
    expect(tiers.headline).toEqual({ tag: tag("Type", "Process"), quantity: null });
    expect(tiers.protocol).toEqual([tag("Type", "Message")]);
  });

  it("lifts a protocol tag with an unexpected value into app tags, marked", () => {
    const tiers = tierTags([tag("Action", "Vote"), tag("Variant", "ao.TN.2"), tag("Type", "Process"), tag("data-protocol", "x")]);
    expect(tiers.protocol).toEqual([]);
    expect(tiers.app).toEqual([
      { ...tag("Variant", "ao.TN.2"), unusual: { expected: "ao.TN.1 / ao.N.1" } },
      { ...tag("Type", "Process"), unusual: { expected: "Message" } },
      { ...tag("data-protocol", "x"), unusual: { expected: "ao" } },
    ]);
  });

  it("reads HyperBEAM's lowercase names, and treats two Actions as ambiguous rather than preferring one case", () => {
    const tiers = tierTags([tag("action", "Transfer"), tag("quantity", "5"), tag("type", "Message"), tag("variant", "ao.N.1")]);
    expect(tiers.headline).toEqual({ tag: tag("action", "Transfer"), quantity: tag("quantity", "5") });
    expect(tiers.protocol).toEqual([tag("type", "Message"), tag("variant", "ao.N.1")]);
    expect(tierTags([tag("action", "A"), tag("Action", "B")]).headline).toBeNull();
    expect(tierTags([tag("type", "Process")]).headline?.tag).toEqual(tag("type", "Process"));
  });

  it("shows client tags and any Reference with the protocol tags", () => {
    const tags = [tag("Reference", "t783"), tag("Reference", "7"), tag("Client", "Wander"), tag("Client-Version", "1.41.3"), tag("ao-types", 'integer=("nonce")'), tag("require-codec", "application/json")];
    expect(tierTags(tags).protocol).toEqual(tags);
  });

  it("treats an EVM address as an address", () => {
    const evm = "0x1271AFf75eb491053884BF93af63a9cadB96C1aB";
    expect(tierTags([tag("Target", evm), tag("Note", "0x1234")]).addresses).toEqual([tag("Target", evm)]);
  });

  it("treats HyperBEAM's ao.N.1 variant as a protocol tag", () => {
    expect(tierTags([tag("Variant", "ao.N.1")]).protocol).toEqual([tag("Variant", "ao.N.1")]);
  });

  it("places every tag exactly once", () => {
    const tags = [tag("Action", "A"), tag("Quantity", "1"), tag("Target-Id", PROCESS), tag("SDK", "x"), tag("Note", "hi"), tag("Variant", "odd")];
    const tiers = tierTags(tags);
    const placed = [tiers.headline?.tag, tiers.headline?.quantity, ...tiers.addresses, ...tiers.app, ...tiers.protocol].filter(Boolean);
    expect(placed).toHaveLength(tags.length);
  });

  it("places every tag exactly once when the Type headline is suppressed", () => {
    const tags = [tag("Type", "Process"), tag("type", "Other"), tag("Note", "hi")];
    const tiers = tierTags(tags);
    const placed = [tiers.headline?.tag, tiers.headline?.quantity, ...tiers.addresses, ...tiers.app, ...tiers.protocol].filter(Boolean);
    expect(placed).toHaveLength(tags.length);
    expect(tiers.headline).toBeNull();
  });

  it("never headlines a Quantity name carrying hidden characters", () => {
    const tiers = tierTags([tag("Action", "Vote"), tag("Quantity\u202E", "5"), tag("Quantity\u200B", "7")]);
    expect(tiers.headline).toEqual({ tag: tag("Action", "Vote"), quantity: null });
    expect(tiers.app).toEqual([tag("Quantity\u202E", "5"), tag("Quantity\u200B", "7")]);
  });

  it("headlines every case variant of Quantity", () => {
    for (const name of ["Quantity", "quantity", "QUANTITY", "QuAnTiTy"]) {
      expect(tierTags([tag("Action", "Vote"), tag(name, "5")]).headline?.quantity).toEqual(tag(name, "5"));
    }
  });
});
