// The request link's name and memo: in the fragment only, capped, plain text; an old link reads as before.
import { describe, expect, it } from "vitest";
import { TRACKER_NFT } from "@/mainnet/tx";
import { parseRequest, requestLink } from "@/mainnet/flows";
import { MEMO_MAX, NAME_MAX, cleanLabel, labelledRequestLink, labelsOf, openRequest } from "./reqlink";

const TO = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const REQ = { to: TO, amount: 500_000_000n, nft: TRACKER_NFT };
const ORIGIN = "https://basis.ergoscan.me";
const hashOf = (link: string) => link.slice(link.indexOf("#"));

describe("request link labels", () => {
  it("without labels the link is exactly the request link", () => {
    expect(labelledRequestLink(ORIGIN, REQ, {})).toBe(requestLink(ORIGIN, REQ));
    expect(labelledRequestLink(ORIGIN, REQ, { name: "  ", memo: "​" })).toBe(requestLink(ORIGIN, REQ));
  });

  it("name and memo go after # and come back as plain text; the request reads the same", () => {
    const link = labelledRequestLink(ORIGIN, REQ, { name: "Лена · ergo-tools", memo: "За обед (пятница) & чай" });
    const [path, hash] = link.split("#");
    expect(path).toBe(`${ORIGIN}/wallet/mainnet/pay`);
    expect(hash.startsWith(requestLink(ORIGIN, REQ).split("#")[1] + "&")).toBe(true);
    // nothing in the link breaks a Markdown link: no spaces, no parentheses
    expect(link).not.toMatch(/[\s()]/);
    expect(labelsOf("#" + hash)).toEqual({ name: "Лена · ergo-tools", memo: "За обед (пятница) & чай" });
    expect(parseRequest("#" + hash)).toEqual(parseRequest(hashOf(requestLink(ORIGIN, REQ))));
  });

  it("an old link has no labels", () => {
    expect(labelsOf(hashOf(requestLink(ORIGIN, REQ)))).toEqual({ name: null, memo: null });
    expect(labelsOf("")).toEqual({ name: null, memo: null });
  });

  it("caps the length and drops control, format and bidi characters", () => {
    expect(Array.from(cleanLabel("я".repeat(100), NAME_MAX))).toHaveLength(NAME_MAX);
    expect(Array.from(cleanLabel("m".repeat(100), MEMO_MAX))).toHaveLength(MEMO_MAX);
    expect(cleanLabel("Le‮na\u0000 \n\t pay​", 40)).toBe("Le na pay");
    const long = labelsOf(`#to=${TO}&name=${"x".repeat(500)}&memo=${"y".repeat(500)}`);
    expect(long.name).toHaveLength(NAME_MAX);
    expect(long.memo).toHaveLength(MEMO_MAX);
  });

  it("openRequest keeps only the request's fields and the cleaned labels", () => {
    const o = openRequest(`#to=${TO}&amount=500000000&nft=${TRACKER_NFT}&junk=1&name=%20Lena%20&memo=lunch`);
    expect(o?.req).toEqual(REQ);
    expect(o?.labels).toEqual({ name: "Lena", memo: "lunch" });
    expect(o?.hash).toBe(`#to=${TO}&amount=500000000&nft=${TRACKER_NFT}&name=Lena&memo=lunch`);
    expect(openRequest("#to=nope")).toBeNull();
    expect(openRequest(`#to=${TO}&nft=${"00".repeat(32)}`)).toBeNull();
  });
});
