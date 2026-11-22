// Template hash: SHA-256 of an ErgoTree's template (the bytes after the header, the size and the constants table),
// the identity explorers index contracts by; constants (a tracker NFT id, a key) do not change it. NOT blake2b256
// (research/KNOWLEDGE.md §d.5, correction 15). Parsing (header, constants, template) is src/chain/decode.ts.

import { sha256 } from "@noble/hashes/sha256";
import { parseAddress, parseErgoTree, type ParsedErgoTree } from "@/chain/decode";
import { toHexStr } from "../core/format";

export type TemplateRole = "current" | "legacy" | "superseded" | "repo-only";

export interface KnownTemplate {
  id: string;
  short: string;
  role: TemplateRole;
  kind: string;
  /** SHA-256 of the template bytes, hex. */
  hash: string;
  name: { en: string; ru: string };
}

/** Every Basis reserve template known (KNOWLEDGE §d.5; the same list as the chain seed). AtC4 and W52 share one. */
export const KNOWN_TEMPLATES: readonly KnownTemplate[] = [
  { id: "erg-v2025-09", short: "2WbQ", role: "repo-only", kind: "erg", hash: "7a41b8d04a882ca037a40209886f72732dba2a9c11100c48b408530ad83a3d77", name: { en: "Basis ERG reserve, first P2S", ru: "ERG-резерв Basis, первый P2S" } },
  { id: "erg-v2025-10-atc4", short: "AtC4", role: "repo-only", kind: "erg", hash: "f3b6fd57c6e4a7ba9338eead829f352a31d51a3090dd1021304221783a5e4a0d", name: { en: "Basis ERG reserve, Oct 2025 (same template as W52, header 0x19)", ru: "ERG-резерв Basis, октябрь 2025 (шаблон как у W52, заголовок 0x19)" } },
  { id: "erg-v2025-10-w52", short: "W52", role: "legacy", kind: "erg", hash: "f3b6fd57c6e4a7ba9338eead829f352a31d51a3090dd1021304221783a5e4a0d", name: { en: "Basis ERG reserve W52 (first mainnet reserves)", ru: "ERG-резерв Basis W52 (первые резервы в mainnet)" } },
  { id: "erg-v2026-02-rtqx", short: "RtQx", role: "legacy", kind: "erg", hash: "8776b62deda4f7eb419b9a1a96358889527ab6f410e5067d342420283ce887cf", name: { en: "Basis ERG reserve RtQx (first mainnet redemption)", ru: "ERG-резерв Basis RtQx (первое погашение в mainnet)" } },
  { id: "erg-v2026-07-4zhb", short: "4ZhB", role: "legacy", kind: "erg", hash: "35cd32afbbbb8a65f6ac06bc0ff34405bca2898335d97fee277e2945d548970e", name: { en: "Basis ERG reserve 4ZhB (TUI tests, strict insert)", ru: "ERG-резерв Basis 4ZhB (тесты TUI, строгий insert)" } },
  { id: "erg-v2026-07-3pqn", short: "3PQn", role: "legacy", kind: "erg", hash: "0a2f8340e45f12e40746d0f8dbf08095357aa43ca63c269b10a3927421e2b577", name: { en: "Basis ERG reserve 3PQn (refund via R7, strict insert)", ru: "ERG-резерв Basis 3PQn (возврат через R7, строгий insert)" } },
  { id: "erg-v2026-07-pb9o", short: "pB9o", role: "legacy", kind: "erg", hash: "1c6a62022e749a48201f1f08c1542845e5b0079818f19659216cff688a085ab3", name: { en: "Basis ERG reserve pB9o (node-compiled, refund + insertOrUpdate)", ru: "ERG-резерв Basis pB9o (скомпилирован узлом, возврат + insertOrUpdate)" } },
  { id: "token-v2026-08-qk8q", short: "Qk8Q", role: "repo-only", kind: "token", hash: "07ec843129c38a36d11223c3ee13db602ee1f48584b4e3838fd15e264d7b091b", name: { en: "Basis token reserve, first P2S", ru: "Токен-резерв Basis, первый P2S" } },
  { id: "token-v2026-08-96hr", short: "96Hr", role: "legacy", kind: "token", hash: "47b6c65a3e229d4443999cb0433070c27d4b10f9bbfc068862d3ede62ff135ca", name: { en: "Basis token reserve 96Hr (USE tests, refund + insertOrUpdate)", ru: "Токен-резерв Basis 96Hr (тесты USE, возврат + insertOrUpdate)" } },
  { id: "token-v2026-08-fjrq", short: "Fjrq", role: "repo-only", kind: "token", hash: "7e4a39ab37b97e2bf8786d7c1a7019525eb5d1f8265f4686afde99916af1cf50", name: { en: "Basis token reserve, P2S in scala/specs/basis.md", ru: "Токен-резерв Basis, P2S из scala/specs/basis.md" } },
  { id: "erg-v2026-10-c3", short: "2XoR", role: "current", kind: "erg", hash: "6e7d9a0e012e556d78a84cb373eca1b279695e7b48731b9158fd0ddd3faeff01", name: { en: "Basis ERG reserve (post-review C3)", ru: "ERG-резерв Basis (после ревью C3)" } },
  { id: "token-v2026-10-c3", short: "EUNi", role: "superseded", kind: "token", hash: "bf293fe9e6375c92f4679ad626e9c797fcc767981f58be97792711f732b92b4c", name: { en: "Basis token reserve post-C3 (superseded)", ru: "Токен-резерв Basis после C3 (заменён)" } },
  { id: "token-v2026-10-c3-raw", short: "EUNi raw", role: "superseded", kind: "token", hash: "f9b69748b990319233bad289c69c0c75d411194ed7c2a835e2274ce0c6e449b5", name: { en: "Raw compiler output of basis-token.es post-C3", ru: "Сырой вывод компилятора basis-token.es после C3" } },
  { id: "multitoken-v2026-10", short: "8LeD", role: "current", kind: "multitoken", hash: "8699a5572dd93d3fc1d6b33157d26bb1451c4cdd4e969e6e08e50b18e32f4feb", name: { en: "Basis multi-token reserve", ru: "Мультитокен-резерв Basis" } },
];

/** Real trees to try: the two current contracts (KNOWLEDGE Appendix A, byte for byte) and the legacy pB9o. */
export const SAMPLE_TREES: ReadonlyArray<{ id: string; hex: string }> = [
  {
    id: "erg-v2026-10-c3",
    hex:
    "1bf90521041404140402050004000400041004200500040004420400040004000410050004420500040004420442010104e021050004020500058084af5f04040500040605000480a3050100d807d601" +
    "7ee4e3000204d6029d72017300d603c2a7d604e4c6a70407d605b2a59e7201730100d606edededed93b1b5a4d9010663eded93c272067203e6c67206040793e4c6720604077204730293c27205720393" +
    "db63087205db6308a793e4c672050407720493e4c67205060ee4c6a7060ed607e5c6a707057303959372027304d816d608b2db6501fe730500d609e4c6a7060ed60adb07027204d60be4e30107d60ccb" +
    "b3720adb0702720bd60de4e30305d60ee4e30405d60fe3070ed610e6720fd6117a720ed6129572107cb4e4dc640ae4c6a7056402720ce4720f730673077308d61399c1a7c17205d6148602720cb37211" +
    "7a9a72127213d615e4e3050ed616db6a01ddd617e4e3020ed618b472177309730ad619b3b3b3720c7a720d72117209d61ae4e3060ed61bb1721ad61c91721b730bd61de4c672080407ea02d1edededed" +
    "ededed7206938cb2db63087208730c00017209937ce4dc640ae4c67208056402720ce4e3080e720d92720e9572107cb4e4dc640ae4c6a7056402720ce4720f730d730e730f93957210e4dc6410e4c6a7" +
    "05640283013c0e0e72147215e4dc640ce4c6a705640283013c0e0e72147215e4c672050564939f72167bb472177310b17217a0ee72189f72047bcbb3b372187219720aeded917213731190721399720d" +
    "721295721c95721cd801d61eb4721a73127313939f72167bb4721a7314721ba0ee721e9f721d7bcbb3b3721e7219db0702721d73159199a38cc7720801731693e5c67205070573177207cd720b959372" +
    "027318d1ededed720693e4c672050564e4c6a7056493e5c672050705731972079299c17205c1a7731a95937202731bea02d1edededed720692c17205c1a793e4c672050564e4c6a7056492e4c6720507" +
    "057ea305937207731ccd720495937202731dea02d1ed917207731e927ea3059a72077e731f05cd7204d17320",
  },
  {
    id: "multitoken-v2026-10",
    hex:
    "1b8b072a0414041404000402040404000400040204020500040004000410042005000402040004420400040004000410050004420500040004420442010104e021050004020500040205020404040205" +
    "00040605000480a3050100d80fd6017ee4e3000204d6029d72017300d603b2a59e7201730100d604db63087203d605db6308a7d606b27205730200d607b27205730300d6088c720701d609ededed93b1" +
    "72047304938cb27204730500018c720601938cb27204730600028c720602938cb27204730700017208d60ac2a7d60be4c6a70407d60cededed93b1b5a4d9010c63eded93c2720c720ae6c6720c040793" +
    "e4c6720c0407720b730893c27203720a93e4c672030407720b93e4c67203060ee4c6a7060ed60d92c17203c1a7d60e8c720702d60fe5c6a70705730995937202730ad818d610b2db6501fe730b00d611" +
    "e4c6a7060ed612db0702720bd613e4e30107d614b37212db07027213d615cbb372147208d616e4e30305d617e4e30405d618e3070ed619e67218d61acb7214d61b7a7217d61c9572197cb4e4dc640ae4" +
    "c6a7056402721ae47218730c730d730ed61d99720e8cb27204730f0002d61e8602721ab3721b7a9a721c721dd61fe4e3050ed620db6a01ddd621e4e3020ed622b4722173107311d623b3b3b372157a72" +
    "16721b7211d624e4e3060ed625b17224d6269172257312d627e4c672100407ea02d1ededededededededed720c7209720d938cb2db63087210731300017211937ce4dc640ae4c672100564027215e4e3" +
    "080e72169272179572197cb4e4dc640ae4c6a7056402721ae4721873147315731693957219e4dc6410e4c6a705640283013c0e0e721e721fe4dc640ce4c6a705640283013c0e0e721e721fe4c6720305" +
    "64939f72207bb472217317b17221a0ee72229f720b7bcbb3b3722272237212eded91721d731890721d997216721c957226957226d801d628b472247319731a939f72207bb47224731b7225a0ee72289f" +
    "72277bcbb3b372287223db07027227731c9199a38cc7721001731d93e5c672030705731e720fcd721395937202731fd1ededededed720c7209720d93e4c672030564e4c6a7056493e5c6720307057320" +
    "720f92998cb2720473210002720e7322959372027323ea02d1edededededed720c7209928cb2720473240002720e720d93e4c672030564e4c6a7056492e4c6720307057ea30593720f7325cd720b9593" +
    "72027326ea02d1ed91720f7327927ea3059a720f7e732805cd720bd17329",
  },
  {
    id: "erg-v2026-07-pb9o",
    hex:
    "1bac052004140414050004000400041004200500040004420400040004000410050004420500040004420442010104e021050004020500058084af5f04040500040605000480a3050100d806d6017ee4" +
    "e3000204d6029d72017300d603b2a59e7201730100d604e4c6a70407d605ededed93c27203c2a793db63087203db6308a793e4c672030407720493e4c67203060ee4c6a7060ed606e5c6a70705730295" +
    "9372027303d813d607b2db6501fe730400d608db07027204d609e4e30107d60acbb37208db07027209d60be4e30305d60ce4e30405d60de3070ed60ee6720dd60f7a720cd61095720e7cb4e4dc640ae4" +
    "c6a7056402720ae4720d730573067307d61199c1a7c17203d612db6a01ddd613e4e3020ed614b4721373087309d615b3b3720a7a720b720fd616e4e3060ed617b17216d618917217730ad619e4c67207" +
    "0407ea02d1ededededededed7205938cb2db63087207730b0001e4c6a7060e937ce4dc640ae4c67207056402720ae4e3080e720b91720c95720e7cb4e4dc640ae4c6a7056402720ae4720d730c730d73" +
    "0e93e4dc6410e4c6a705640283013c0e0e8602720ab3720f7a9a72107211e4e3050ee4c672030564939f72127bb47213730fb17213a0ee72149f72047bcbb3b3721472157208eded9172117310907211" +
    "99720b7210957218957218d801d61ab4721673117312939f72127bb4721673137217a0ee721a9f72197bcbb3b3721a7215db0702721973149199a38cc7720701731593e5c67203070573167206cd7209" +
    "959372027317d1ededed720593e4c672030564e4c6a7056493e5c672030705731872069299c17203c1a7731995937202731aea02d1edededed720592c17203c1a793e4c672030564e4c6a7056492e4c6" +
    "720307057ea305937206731bcd720495937202731cea02d1ed917206731d927ea3059a72067e731e05cd7204d1731f",
  },
];

export interface TemplateSegment {
  part: "header" | "size" | "count" | "constant" | "template";
  from: number;
  length: number;
  /** constant: index, type and value. */
  index?: number;
  type?: string;
  display?: string;
}

export interface TemplateAnalysis {
  input: "hex" | "address";
  address?: { network: string; type: string; checksumOk: boolean };
  tree: ParsedErgoTree;
  bytes: Uint8Array;
  segments: TemplateSegment[];
  template: Uint8Array;
}

/** ErgoTree hex or a P2S / P2PK address → the tree's parts. Throws with a plain message on bad input. */
export function analyzeTemplate(input: string): TemplateAnalysis {
  const s = input.trim().replace(/\s+/g, "");
  if (!s) throw new Error("empty");
  let hex = s;
  let address: TemplateAnalysis["address"];
  if (!/^[0-9a-fA-F]+$/.test(s)) {
    const a = parseAddress(s);
    address = { network: a.network, type: a.type, checksumOk: a.checksumOk };
    if (a.type === "P2SH") throw new Error("p2sh");
    hex = a.type === "P2PK" ? "0008cd" + a.content : a.content;
  }
  const tree = parseErgoTree(hex.toLowerCase());
  const bytes = hexBytes(hex);
  const segments: TemplateSegment[] = [{ part: "header", from: 0, length: 1 }];
  let i = 1;
  if (tree.hasSize) {
    const end = vlqEnd(bytes, i);
    segments.push({ part: "size", from: i, length: end - i });
    i = end;
  }
  if (tree.segregated) {
    const end = vlqEnd(bytes, i);
    segments.push({ part: "count", from: i, length: end - i });
    i = end;
    tree.constants.forEach((c, k) => {
      const next = k + 1 < tree.constants.length ? tree.constants[k + 1].offset : tree.templateOffset;
      segments.push({ part: "constant", from: c.offset, length: next - c.offset, index: k, type: c.type, display: c.display });
    });
  }
  segments.push({ part: "template", from: tree.templateOffset, length: bytes.length - tree.templateOffset });
  return { input: address ? "address" : "hex", address, tree, bytes, segments, template: bytes.subarray(tree.templateOffset) };
}

/** SHA-256 through WebCrypto (crypto.subtle), falling back to noble where it is missing (old browsers, tests). */
export async function sha256Hex(bytes: Uint8Array): Promise<{ hex: string; via: "webcrypto" | "noble" }> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    try {
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return { hex: toHexStr(new Uint8Array(await subtle.digest("SHA-256", copy))), via: "webcrypto" };
    } catch {
      /* fall through */
    }
  }
  return { hex: toHexStr(sha256(bytes)), via: "noble" };
}

export function knownTemplates(hash: string): KnownTemplate[] {
  const h = hash.toLowerCase();
  return KNOWN_TEMPLATES.filter((k) => k.hash === h);
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function vlqEnd(b: Uint8Array, i: number): number {
  while (i < b.length && b[i] & 0x80) i++;
  return i + 1;
}
