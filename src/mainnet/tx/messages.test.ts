// The signed messages, byte for byte against basis_core `worked_examples_of_the_signed_messages` (6113b8d
// crates/basis_core/src/types.rs): issuer G, receiver 2G, tracker NFT 0x5a × 32, 2026-11-22T00:00:00Z.
import { describe, expect, it } from "vitest";
import { bigToBytes, bytesToHex, hexToBytes } from "../../protocol/bytes";
import { debtKey } from "../../protocol/note";
import { EXT, ISSUER_A, R3, RECEIVER_B } from "./fixtures/chain";
import { TRACKER_NFT, TRACKER_PK } from "./constants";
import { BUILD_REQUEST_DOMAIN, BUILD_REQUEST_ERG_BYTES, INBOX_DOMAIN, INBOX_MESSAGE_BYTES, NOTE_MESSAGE_BYTES, buildRequestMessage, inboxMessage, noteMessage, signBasis, signInbox, verifyBasis } from "./messages";
import { extensionValue } from "./model";

const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const G2 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const NFT = "5a".repeat(32);
const TS = 1_795_305_600_000n;

describe("basis_core worked examples", () => {
  it("the ERG debt key", () => {
    expect(bytesToHex(debtKey(G, G2))).toBe("87262ce92e4cc9c99666eb41bcab2a75ed76c937b50f9e441b4f5806138228ee");
  });

  it("the token debt key", () => {
    expect(bytesToHex(debtKey(G, G2, `token:${"7c".repeat(32)}`))).toBe("9166c9c9b26e3c9832d9285becd4a22fa265552a51ee77f0d6d5ae79ae6281be");
  });

  it("the 80-byte note message", () => {
    const m = noteMessage({ issuer: G, recipient: G2, totalDebt: 1_000_000_000n, timestamp: TS, trackerNft: NFT });
    expect(m.length).toBe(NOTE_MESSAGE_BYTES);
    expect(bytesToHex(m)).toBe(
      "87262ce92e4cc9c99666eb41bcab2a75ed76c937b50f9e441b4f5806138228ee" + "000000003b9aca00" + "000001a2008d7400" + "5a".repeat(32),
    );
  });

  it("the 131-byte build request", () => {
    const m = buildRequestMessage({ trackerNft: NFT, issuer: G, recipient: G2, amount: 500_000_000n, requestTimestamp: TS + 60_000n });
    expect(m.length).toBe(BUILD_REQUEST_ERG_BYTES);
    expect(bytesToHex(m)).toBe(
      "62617369732d6275696c642d7631" + "5a".repeat(32) + G + G2 + "657267" + "000000001dcd6500" + "000001a2008e5e60",
    );
  });

  it("the 198-byte token build request", () => {
    const m = buildRequestMessage({ trackerNft: NFT, issuer: G, recipient: G2, denomination: `token:${"7c".repeat(32)}`, amount: 500_000_000n, requestTimestamp: TS + 60_000n });
    expect(m.length).toBe(198);
    expect(new TextDecoder().decode(m.subarray(112, 182))).toBe(`token:${"7c".repeat(32)}`);
  });

  it("refuses malformed fields", () => {
    expect(() => noteMessage({ issuer: G.toUpperCase(), recipient: G2, totalDebt: 1n, timestamp: 1n, trackerNft: NFT })).toThrow();
    expect(() => noteMessage({ issuer: G, recipient: G2, totalDebt: 1n << 63n, timestamp: 1n, trackerNft: NFT })).toThrow();
    expect(() => noteMessage({ issuer: G, recipient: G2, totalDebt: 1n, timestamp: -1n, trackerNft: NFT })).toThrow();
    expect(() => buildRequestMessage({ trackerNft: NFT.slice(2), issuer: G, recipient: G2, amount: 1n, requestTimestamp: 1n })).toThrow();
    expect(() => buildRequestMessage({ trackerNft: NFT, issuer: G, recipient: G2, denomination: "token:zz" as `token:${string}`, amount: 1n, requestTimestamp: 1n })).toThrow();
    expect(() => buildRequestMessage({ trackerNft: NFT, issuer: G, recipient: G2, amount: 1n << 64n, requestTimestamp: 1n })).toThrow();
  });
});

describe("mainnet signatures over the note message", () => {
  const ext = (k: number) => extensionValue(R3.unsigned.inputs[0], k)!;
  const message = noteMessage({ issuer: ISSUER_A, recipient: RECEIVER_B, totalDebt: 600_000_000n, timestamp: 1_795_357_991_710n, trackerNft: TRACKER_NFT });

  it("R3 #3 and #4 are the note's total and timestamp", () => {
    expect(ext(3)).toBe("0580989abc04");
    expect(ext(4)).toBe("05bc8ce7bac068");
    expect(EXT.R3.entries.length).toBe(9);
  });

  it("R3 #2 is the issuer's signature and #6 the tracker's, over the same 80 bytes", () => {
    expect(verifyBasis(ISSUER_A, message, hexToBytes(ext(2)).subarray(2))).toBe(true);
    expect(verifyBasis(TRACKER_PK, message, hexToBytes(ext(6)).subarray(2))).toBe(true);
    expect(verifyBasis(TRACKER_PK, message, hexToBytes(ext(2)).subarray(2))).toBe(false);
    expect(verifyBasis(ISSUER_A, message.subarray(0, 79), hexToBytes(ext(2)).subarray(2))).toBe(false);
  });

  it("signBasis signs and refuses a key that does not match", () => {
    const secret = bigToBytes(2n, 32);
    const sig = signBasis(message, secret, G2);
    expect(sig.length).toBe(65);
    expect(verifyBasis(G2, message, sig)).toBe(true);
    expect(() => signBasis(message, secret, G)).toThrow();
    expect(() => signBasis(message, new Uint8Array(31), G2)).toThrow();
  });
});

// The inbox request (GET /notes/recipient/{key}), byte for byte against basis_core `worked_example_of_the_inbox_message`
// (crates/basis_core/src/types.rs, branch inbox): tracker NFT 0x5a × 32, recipient 2G, valid until 2026-11-23T00:00:00Z.
describe("the inbox request", () => {
  const UNTIL = 1_795_392_000n;

  it("is the 87-byte message of basis_core", () => {
    const m = inboxMessage(NFT, G2, UNTIL);
    expect(m.length).toBe(INBOX_MESSAGE_BYTES);
    expect(INBOX_MESSAGE_BYTES).toBe(87);
    expect(bytesToHex(m)).toBe("62617369732d696e626f782d7631" + NFT + G2 + "000000006b038200");
    expect(new TextDecoder().decode(m.subarray(0, 14))).toBe(INBOX_DOMAIN);
  });

  it("can never be a note, a build request or another tracker's inbox request", () => {
    // the tags have the same length and differ at byte 6 ("i" against "b"); the lengths never meet: 87 against 80
    // (every note) and 131 or 198 (every build request)
    expect(INBOX_DOMAIN.length).toBe(BUILD_REQUEST_DOMAIN.length);
    expect(INBOX_DOMAIN.slice(0, 6)).toBe(BUILD_REQUEST_DOMAIN.slice(0, 6));
    expect(INBOX_DOMAIN[6]).not.toBe(BUILD_REQUEST_DOMAIN[6]);
    expect([NOTE_MESSAGE_BYTES, 131, 198]).not.toContain(INBOX_MESSAGE_BYTES);
    const keys = [G, G2, "03" + "ff".repeat(31) + "fe"];
    const nfts = [NFT, "00".repeat(32), TRACKER_NFT];
    const numbers = [0n, 1n, UNTIL, TS, (1n << 63n) - 1n];
    const tokens = ["erg", `token:${"7c".repeat(32)}`] as const;
    for (const nft of nfts) {
      for (const k of keys) {
        for (const until of [1n, UNTIL, (1n << 64n) - 1n]) {
          const inbox = bytesToHex(inboxMessage(nft, k, until));
          expect(inbox.length).toBe(2 * INBOX_MESSAGE_BYTES);
          for (const other of nfts) if (other !== nft) expect(bytesToHex(inboxMessage(other, k, until))).not.toBe(inbox);
          for (const other of keys) {
            for (const n of numbers) {
              for (const d of tokens) {
                const note = noteMessage({ issuer: other, recipient: k, totalDebt: n, timestamp: n, trackerNft: nft, denomination: d });
                const build = buildRequestMessage({ trackerNft: nft, issuer: other, recipient: k, denomination: d, amount: n, requestTimestamp: n });
                expect(note.length).toBe(NOTE_MESSAGE_BYTES);
                expect([131, 198]).toContain(build.length);
                expect(bytesToHex(note)).not.toBe(inbox);
                expect(bytesToHex(build)).not.toBe(inbox);
              }
            }
          }
        }
      }
    }
  });

  it("signInbox gives only until and the signature, which covers the inbox message alone", () => {
    const secret = bigToBytes(2n, 32);
    const token = signInbox(secret, G2, NFT, UNTIL);
    expect(Object.keys(token).sort()).toEqual(["sig", "until"]);
    expect(token.until).toBe("1795392000");
    expect(token.sig).toMatch(/^[0-9a-f]{130}$/);
    expect(verifyBasis(G2, inboxMessage(NFT, G2, UNTIL), token.sig)).toBe(true);
    // not valid for another tracker, another time, another key, a note or a build request over the same fields
    expect(verifyBasis(G2, inboxMessage(TRACKER_NFT, G2, UNTIL), token.sig)).toBe(false);
    expect(verifyBasis(G2, inboxMessage(NFT, G2, UNTIL + 1n), token.sig)).toBe(false);
    expect(verifyBasis(G, inboxMessage(NFT, G, UNTIL), token.sig)).toBe(false);
    expect(verifyBasis(G2, noteMessage({ issuer: G, recipient: G2, totalDebt: UNTIL, timestamp: UNTIL, trackerNft: NFT }), token.sig)).toBe(false);
    expect(verifyBasis(G2, buildRequestMessage({ trackerNft: NFT, issuer: G, recipient: G2, amount: UNTIL, requestTimestamp: UNTIL }), token.sig)).toBe(false);
    // the secret is in no field
    expect(JSON.stringify(token)).not.toContain(bytesToHex(secret));
  });

  it("refuses a key that does not match, a bad key or NFT and a time out of range", () => {
    const secret = bigToBytes(2n, 32);
    expect(() => signInbox(secret, G, NFT, UNTIL)).toThrow();
    expect(() => signInbox(secret, G2.toUpperCase(), NFT, UNTIL)).toThrow();
    expect(() => signInbox(secret, G2, NFT.toUpperCase(), UNTIL)).toThrow();
    expect(() => signInbox(secret, G2, "5a".repeat(31), UNTIL)).toThrow();
    expect(() => signInbox(secret, G2, NFT, 0n)).toThrow();
    expect(() => signInbox(secret, G2, NFT, 1n << 64n)).toThrow();
    expect(() => inboxMessage(NFT, G2, -1n)).toThrow();
  });
});
