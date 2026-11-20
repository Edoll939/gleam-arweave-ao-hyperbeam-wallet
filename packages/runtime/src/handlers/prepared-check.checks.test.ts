import { describe, expect, it } from "vitest";
import { l1TransferTags } from "@gleam/core/src/ao/l1-transfer.ts";
import { prepareTransfer } from "@gleam/core/src/ao/transfer.ts";
import { buildUnsignedDataItem } from "@gleam/core/src/arweave/data-item.ts";
import type { ArweaveTransactionJson } from "@gleam/core/src/arweave/transaction.ts";
import { bytesToBase64Url } from "@gleam/core/src/vault/base64.ts";
import type { UnsignedPayload } from "@gleam/core/src/vault/signing.ts";
import { nameTargetTags } from "@gleam/core/src/ao/name-target.ts";
import { assertNameTargetMatches, assertTransferMatches, checkDataItem, checkTransaction, summarize } from "./prepared-check";

/**
 * Direct tests for the prepared-bytes checks: the last line before any
 * signer runs. The approval and transfer suites exercise the happy paths
 * end to end; these pin the refusals — a payload that differs from what
 * the user approved must throw, never sign.
 */

// A 512-byte RSA modulus in base64url, the shape a data-item owner takes.
const OWNER = "o".repeat(683);
const PROCESS_ID = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const OTHER = "aNoThEr_AdDrEsS-0123456789abcdefghijklmnopq";
const FEE = "1000";

const encoder = new TextEncoder();

function tag(name: string, value: string): { name: string; value: string } {
  return { name: bytesToBase64Url(encoder.encode(name)), value: bytesToBase64Url(encoder.encode(value)) };
}

function encodeTags(tags: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return tags.map((entry) => tag(entry.name, entry.value));
}

function tx(overrides: Partial<ArweaveTransactionJson> = {}): UnsignedPayload {
  return {
    kind: "transaction",
    transaction: {
      format: 2,
      id: "",
      last_tx: "",
      owner: OWNER,
      tags: [],
      target: "",
      quantity: "0",
      data: "",
      data_size: "0",
      data_root: "",
      reward: "0",
      signature: "",
      ...overrides,
    },
  };
}

function l1TokenTx(overrides: Partial<ArweaveTransactionJson> = {}): UnsignedPayload {
  return tx({
    target: PROCESS_ID,
    quantity: "0",
    reward: FEE,
    tags: encodeTags(l1TransferTags(RECIPIENT, "7")),
    ...overrides,
  });
}

function aoItem(recipient: string, quantity: string, processId: string = PROCESS_ID): UnsignedPayload {
  return { kind: "dataItem", raw: prepareTransfer(OWNER, processId, recipient, quantity) };
}

describe("assertTransferMatches: AR sends", () => {
  const approved = { recipient: RECIPIENT, amount: "10", token: null, fee: FEE };

  it("accepts the exact send", () => {
    expect(() =>
      assertTransferMatches(approved, tx({ target: RECIPIENT, quantity: "10", reward: FEE })),
    ).not.toThrow();
  });

  it("refuses a different recipient", () => {
    expect(() =>
      assertTransferMatches(approved, tx({ target: OTHER, quantity: "10", reward: FEE })),
    ).toThrow(/doesn't match/);
  });

  it("refuses a different amount", () => {
    expect(() =>
      assertTransferMatches(approved, tx({ target: RECIPIENT, quantity: "11", reward: FEE })),
    ).toThrow(/doesn't match/);
  });

  it("refuses a different fee", () => {
    expect(() =>
      assertTransferMatches(approved, tx({ target: RECIPIENT, quantity: "10", reward: "999" })),
    ).toThrow(/doesn't match/);
  });

  it("refuses extra tags on a plain AR send", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        tx({ target: RECIPIENT, quantity: "10", reward: FEE, tags: [tag("action", "transfer")] }),
      ),
    ).toThrow(/doesn't match/);
  });
});

describe("assertTransferMatches: L1 token sends", () => {
  const approved = { recipient: RECIPIENT, amount: "7", token: PROCESS_ID, fee: FEE };

  it("accepts a zero-AR transfer whose reward is the whole fee", () => {
    expect(() => assertTransferMatches(approved, l1TokenTx())).not.toThrow();
  });

  it("accepts the activation winston taken out of the fee", () => {
    expect(() =>
      assertTransferMatches(approved, l1TokenTx({ quantity: "1", reward: "999" })),
    ).not.toThrow();
  });

  it("refuses a value of more than the activation winston", () => {
    expect(() =>
      assertTransferMatches(approved, l1TokenTx({ quantity: "2", reward: "998" })),
    ).toThrow(/doesn't match/);
  });

  it("refuses a reward short of the fee", () => {
    expect(() => assertTransferMatches(approved, l1TokenTx({ reward: "999" }))).toThrow(/doesn't match/);
  });

  it("refuses a reward over the fee", () => {
    expect(() => assertTransferMatches(approved, l1TokenTx({ reward: "1001" }))).toThrow(/doesn't match/);
  });

  it("refuses the activation winston on top of the full fee", () => {
    expect(() =>
      assertTransferMatches(approved, l1TokenTx({ quantity: "1", reward: FEE })),
    ).toThrow(/doesn't match/);
  });

  it("refuses a different recipient in the tags", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        l1TokenTx({ tags: encodeTags(l1TransferTags(OTHER, "7")) }),
      ),
    ).toThrow(/doesn't match/);
  });

  it("refuses a different quantity in the tags", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        l1TokenTx({ tags: encodeTags(l1TransferTags(RECIPIENT, "8")) }),
      ),
    ).toThrow(/doesn't match/);
  });

  it("refuses the transfer tags in a different order", () => {
    const tags = l1TransferTags(RECIPIENT, "7");
    expect(() =>
      assertTransferMatches(approved, l1TokenTx({ tags: encodeTags([tags[2]!, tags[1]!, tags[0]!]) })),
    ).toThrow(/doesn't match/);
  });
});

describe("assertTransferMatches: collectible sends", () => {
  const approved = {
    recipient: RECIPIENT,
    amount: "1",
    token: PROCESS_ID,
    fee: FEE,
    collectible: { id: PROCESS_ID },
  };

  it("accepts the exact collectible send", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        tx({
          target: PROCESS_ID,
          quantity: "0",
          reward: FEE,
          tags: encodeTags(l1TransferTags(RECIPIENT, "1")),
        }),
      ),
    ).not.toThrow();
  });

  it("refuses a different asset", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        tx({
          target: OTHER,
          quantity: "0",
          reward: FEE,
          tags: encodeTags(l1TransferTags(RECIPIENT, "1")),
        }),
      ),
    ).toThrow(/doesn't match/);
  });

  it("refuses a different recipient", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        tx({
          target: PROCESS_ID,
          quantity: "0",
          reward: FEE,
          tags: encodeTags(l1TransferTags(OTHER, "1")),
        }),
      ),
    ).toThrow(/doesn't match/);
  });
});

describe("assertTransferMatches: AO sends", () => {
  const approved = { recipient: RECIPIENT, amount: "7", token: PROCESS_ID, fee: "0" };

  it("accepts the exact transfer message", () => {
    expect(() => assertTransferMatches(approved, aoItem(RECIPIENT, "7"))).not.toThrow();
  });

  it("refuses a different recipient", () => {
    expect(() => assertTransferMatches(approved, aoItem(OTHER, "7"))).toThrow(/doesn't match/);
  });

  it("refuses a different quantity", () => {
    expect(() => assertTransferMatches(approved, aoItem(RECIPIENT, "8"))).toThrow(/doesn't match/);
  });

  it("refuses a different token process", () => {
    expect(() => assertTransferMatches(approved, aoItem(RECIPIENT, "7", OTHER))).toThrow(/doesn't match/);
  });

  it("refuses an item whose transfer tags have no single reading", () => {
    const raw = buildUnsignedDataItem(OWNER, {
      data: new Uint8Array(),
      target: PROCESS_ID,
      tags: [
        { name: "Action", value: "Transfer" },
        { name: "Recipient", value: RECIPIENT },
        { name: "Recipient", value: OTHER },
        { name: "Quantity", value: "7" },
      ],
    });
    expect(() => assertTransferMatches(approved, { kind: "dataItem", raw })).toThrow(/doesn't match/);
  });
});

describe("checkTransaction", () => {
  const expected = {
    target: RECIPIENT,
    quantity: "10",
    tags: [{ name: "App-Name", value: "test" }],
    data: encoder.encode("hello"),
    reward: FEE,
  };

  function matching(): UnsignedPayload {
    return tx({
      target: RECIPIENT,
      quantity: "10",
      reward: FEE,
      tags: [tag("App-Name", "test")],
      data: bytesToBase64Url(encoder.encode("hello")),
    });
  }

  it("accepts the exact transaction", () => {
    expect(() => checkTransaction(matching(), expected)).not.toThrow();
  });

  it("refuses the tags in a different order", () => {
    const payload = tx({
      target: RECIPIENT,
      quantity: "10",
      reward: FEE,
      tags: [tag("App-Name", "test"), tag("Type", "post")],
      data: bytesToBase64Url(encoder.encode("hello")),
    });
    expect(() =>
      checkTransaction(payload, {
        ...expected,
        tags: [
          { name: "Type", value: "post" },
          { name: "App-Name", value: "test" },
        ],
      }),
    ).toThrow(/doesn't match/);
  });

  it("refuses an extra tag", () => {
    const payload = tx({
      target: RECIPIENT,
      quantity: "10",
      reward: FEE,
      tags: [tag("App-Name", "test"), tag("Type", "post")],
      data: bytesToBase64Url(encoder.encode("hello")),
    });
    expect(() => checkTransaction(payload, expected)).toThrow(/doesn't match/);
  });

  it("refuses different data", () => {
    const payload = tx({
      target: RECIPIENT,
      quantity: "10",
      reward: FEE,
      tags: [tag("App-Name", "test")],
      data: bytesToBase64Url(encoder.encode("goodbye")),
    });
    expect(() => checkTransaction(payload, expected)).toThrow(/doesn't match/);
  });

  it("refuses a different reward when one was approved", () => {
    expect(() =>
      checkTransaction(tx({ target: RECIPIENT, quantity: "10", reward: "999", tags: [tag("App-Name", "test")], data: bytesToBase64Url(encoder.encode("hello")) }), expected),
    ).toThrow(/doesn't match/);
  });

  it("accepts any reward when none was approved", () => {
    expect(() =>
      checkTransaction(matching(), {
        target: RECIPIENT,
        quantity: "10",
        tags: [{ name: "App-Name", value: "test" }],
        data: encoder.encode("hello"),
      }),
    ).not.toThrow();
  });
});

describe("checkDataItem", () => {
  const anchor = "a".repeat(32);
  const expected = {
    target: PROCESS_ID,
    tags: [{ name: "Action", value: "Transfer" }],
    data: encoder.encode("ping"),
    anchor,
  };

  function matching(): UnsignedPayload {
    return {
      kind: "dataItem",
      raw: buildUnsignedDataItem(OWNER, {
        data: encoder.encode("ping"),
        target: PROCESS_ID,
        tags: [{ name: "Action", value: "Transfer" }],
        anchor,
      }),
    };
  }

  it("accepts the exact item", () => {
    expect(() => checkDataItem(matching(), expected)).not.toThrow();
  });

  it("refuses a different anchor", () => {
    const payload: UnsignedPayload = {
      kind: "dataItem",
      raw: buildUnsignedDataItem(OWNER, {
        data: encoder.encode("ping"),
        target: PROCESS_ID,
        tags: [{ name: "Action", value: "Transfer" }],
        anchor: "b".repeat(32),
      }),
    };
    expect(() => checkDataItem(payload, expected)).toThrow(/doesn't match/);
  });

  it("refuses a different target", () => {
    const payload: UnsignedPayload = {
      kind: "dataItem",
      raw: buildUnsignedDataItem(OWNER, {
        data: encoder.encode("ping"),
        target: OTHER,
        tags: [{ name: "Action", value: "Transfer" }],
        anchor,
      }),
    };
    expect(() => checkDataItem(payload, expected)).toThrow(/doesn't match/);
  });
});

describe("summarize", () => {
  it("keeps a message's leading byte order mark", () => {
    const data = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]);
    expect(summarize({ kind: "message", data })).toEqual({ kind: "message", text: "\uFEFFA", size: 4 });
  });

  it("shows a clean L1 token transfer with the fee including the activation winston", () => {
    expect(summarize(l1TokenTx({ quantity: "1", reward: "999" }))).toEqual({
      kind: "l1TokenTransfer",
      process: PROCESS_ID,
      recipient: RECIPIENT,
      quantity: "7",
      fee: FEE,
    });
  });

  it("shows a transfer with duplicated tags as a plain transaction with a warning", () => {
    const summary = summarize(
      l1TokenTx({
        tags: encodeTags([
          { name: "action", value: "transfer" },
          { name: "recipient", value: RECIPIENT },
          { name: "quantity", value: "7" },
          { name: "quantity", value: "8" },
        ]),
      }),
    );
    expect(summary).toEqual({
      kind: "transaction",
      recipient: PROCESS_ID,
      quantity: "0",
      fee: FEE,
      dataSize: "0",
      unreadableTokenTransfer: true,
    });
  });
});

describe("assertNameTargetMatches", () => {
  // The fee the review showed: the reward plus the 1 winston the set carries.
  const approved = { carrier: PROCESS_ID, target: RECIPIENT, fee: "1001" };
  const setTx = (overrides: Partial<ArweaveTransactionJson> = {}) =>
    tx({ target: PROCESS_ID, quantity: "1", reward: FEE, tags: encodeTags(nameTargetTags(RECIPIENT)), ...overrides });

  it("accepts the exact set", () => {
    expect(() => assertNameTargetMatches(approved, setTx())).not.toThrow();
  });

  it("refuses a different carrier", () => {
    expect(() => assertNameTargetMatches(approved, setTx({ target: OTHER }))).toThrow(/recipient/);
  });

  it("refuses a different target in the tags", () => {
    expect(() => assertNameTargetMatches(approved, setTx({ tags: encodeTags(nameTargetTags(OTHER)) }))).toThrow(/tags/);
  });

  it("refuses any quantity but 1 winston", () => {
    expect(() => assertNameTargetMatches(approved, setTx({ quantity: "0" }))).toThrow(/amount/);
    expect(() => assertNameTargetMatches(approved, setTx({ quantity: "2" }))).toThrow(/amount/);
  });

  it("refuses a reward that isn't the fee less the winston", () => {
    expect(() => assertNameTargetMatches(approved, setTx({ reward: "1001" }))).toThrow(/fee/);
  });

  it("refuses an extra tag", () => {
    expect(() =>
      assertNameTargetMatches(approved, setTx({ tags: encodeTags([...nameTargetTags(RECIPIENT), { name: "Assign-To", value: OTHER }]) })),
    ).toThrow(/tags/);
  });

  it("refuses data", () => {
    expect(() => assertNameTargetMatches(approved, setTx({ data: "AA", data_size: "1" }))).toThrow(/data/);
  });

  it("refuses a data item", () => {
    expect(() => assertNameTargetMatches(approved, aoItem(RECIPIENT, "1"))).toThrow();
  });

  it("summarizes the set from its bytes, with the winston in the fee", () => {
    expect(summarize(setTx())).toEqual({ kind: "nameTarget", carrier: PROCESS_ID, target: RECIPIENT, fee: "1001" });
  });

  it("summarizes a set with an extra tag as a plain transaction", () => {
    const extra = setTx({ tags: encodeTags([...nameTargetTags(RECIPIENT), { name: "x", value: "y" }]) });
    expect(summarize(extra).kind).toBe("transaction");
  });
});
