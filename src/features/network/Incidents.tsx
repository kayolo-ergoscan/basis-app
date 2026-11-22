// /network/incidents (FEATURES T09, O06, O07): NFT burns and locks with their tx, the Basis-named NFTs that prove
// nothing, and the look-alike "USE" token told apart by id (never by name).
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Table, Tag, useIsPhone, type Column } from "@/ui";
import { USE_LOOKALIKE_ID, USE_TOKEN_ID, type Observatory, type SeedAffected } from "@/chain";
import { amount, date, ergs, height as fmtH, sid, tokenUnit, type Lang } from "./fmt";
import { AsOf, Block, IdLink, NftTile, UntrustedName } from "./parts";

export function IncidentsPage({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const inc = obs.incidents;
  const lk = inc.lookalike;
  const real = obs.tokens[USE_TOKEN_ID], fake = obs.tokens[USE_LOOKALIKE_ID];
  type LkRow = { id: string; label: string; dp: number; s: { reserves: number; unspentReserves: number; depositedRaw: string; unspentRaw: string; redeemedRaw: string; redemptions: number }; fake: boolean };
  const lkRows: LkRow[] = [
    { id: lk.real, label: t("chain.token.use"), dp: real?.decimals ?? 3, s: lk.realStats, fake: false },
    { id: lk.token, label: tokenUnit("use-lookalike", lang), dp: fake?.decimals ?? 6, s: lk, fake: true },
  ];
  const f = (raw: string, dp: number) => amount(BigInt(raw), dp);
  const lkCols: Column<LkRow>[] = [
    { key: "t", label: t("network.in.lk.token"), lead: true, render: (r) => <span className="nw-inl">{r.fake ? <Tag tone="warn" glyph="!">{r.label}</Tag> : <Tag tone="metal">{r.label}</Tag>}</span> },
    { key: "id", label: t("network.in.lk.id"), render: (r) => <IdLink id={r.id} kind="token" a={8} b={6} copy /> },
    { key: "dp", label: t("network.in.lk.dp"), align: "right", render: (r) => <span className="num">{r.dp}</span> },
    { key: "res", label: t("network.in.lk.reserves"), align: "right", render: (r) => <span className="num">{r.s.reserves} · {r.s.unspentReserves}</span> },
    { key: "dep", label: t("network.in.lk.deposited"), align: "right", render: (r) => <span className="num">{f(r.s.depositedRaw, r.dp)}</span> },
    { key: "left", label: t("network.in.lk.left"), align: "right", render: (r) => <span className="num">{f(r.s.unspentRaw, r.dp)}</span> },
    { key: "red", label: t("network.in.lk.redeemed"), align: "right", render: (r) => <span className="num">{f(r.s.redeemedRaw, r.dp)}</span> },
    { key: "n", label: t("network.in.lk.redemptions"), align: "right", render: (r) => <span className="num">{r.s.redemptions}</span> },
  ];
  return (
    <>
      <header className="nw-head">
        <div>
          <div className="eyebrow label">{t("network.in.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.in.h1"))}</h1>
          <p className="t-lede">{t("network.in.lede")}</p>
        </div>
        <AsOf h={obs.height} live={obs.heightLive} />
      </header>

      <Block label={t("network.in.burns")} aside={<span className="label num">{inc.burns.length}</span>}>
        <p className="t-small">{t("network.in.burnsSub")}</p>
        <div className="nw-incs">
          {inc.burns.map((b) => (
            <article key={b.nft} className="nw-incc burn">
              <header>
                <NftTile nft={b.nft} silent size="md" />
                <Link to={`/network/tracker/${b.nft}`} className="nw-incc-id"><span className="hex">{sid(b.nft, 8, 4)}</span><UntrustedName name={b.name} /></Link>
                <span className="mark" aria-hidden="true">✕</span>
              </header>
              <p className="nw-incc-l">{t("network.in.burnLine", { h: fmtH(b.height) })} · {date(b.at, lang)}</p>
              <IdLink id={b.tx} kind="tx" a={8} b={6} to={obs.index.redemptions.has(b.tx) ? `/network/tx/${b.tx}` : undefined} />
              <Affected a={b.affected} />
            </article>
          ))}
        </div>
      </Block>

      <Block label={t("network.in.locks")} aside={<span className="label num">{inc.locks.length}</span>}>
        <p className="t-small">{t("network.in.locksSub")}</p>
        <div className="nw-incs">
          {inc.locks.map((l) => (
            <article key={l.nft} className="nw-incc lock">
              <header>
                <NftTile nft={l.nft} silent size="md" />
                <Link to={`/network/tracker/${l.nft}`} className="nw-incc-id"><span className="hex">{sid(l.nft, 8, 4)}</span><UntrustedName name={l.name} /></Link>
                <span className="mark" aria-hidden="true">⊘</span>
              </header>
              <p className="nw-incc-l">{t("network.in.lockLine", { id: sid(l.reserve), h: fmtH(l.height) })} · {date(l.at, lang)}</p>
              <div className="nw-rv-tags">
                <Tag tone={l.releasable ? "watch" : "plain"} glyph={l.releasable ? "↩" : "✕"}>{l.releasable ? t("network.in.releasable") : t("network.in.notReleasable")}</Tag>
                <Tag>{l.everTracker ? t("network.in.everTracker") : t("network.in.neverTracker")}</Tag>
              </div>
              <IdLink id={l.reserve} kind="box" a={8} b={6} to={obs.index.reserves.has(l.reserve) ? `/network/reserve/${l.reserve}` : undefined} />
              <Affected a={l.affected} />
            </article>
          ))}
        </div>
      </Block>

      <div className="nw-inc2">
        <Block label={t("network.in.names")} className="nw-names">
          <div className="nw-names-n"><span className="t-measure-l num">{inc.basisNamedNfts.count}</span><span className="t-small">NFT</span></div>
          <p>{t("chain.basisNames", { count: inc.basisNamedNfts.count })}</p>
          <p className="t-small">{t("network.in.namesRange", { names: inc.basisNamedNfts.names, from: date(inc.basisNamedNfts.from, lang), to: date(inc.basisNamedNfts.to, lang) })}</p>
          <p className="t-small">{t("network.in.namesHow")}</p>
        </Block>
        <Block label={t("network.in.lookalike")} className="nw-lk">
          <p>{t("chain.token.lookalike")}</p>
          <div className="nw-tablecard"><Table<LkRow> columns={lkCols} rows={lkRows} rowKey={(r) => r.id} stack={phone} caption={t("network.in.lookalike")} /></div>
        </Block>
      </div>
    </>
  );
}

function Affected({ a }: { a: SeedAffected }) {
  const t = useT();
  return (
    <dl className="nw-aff">
      <div><dt>{t("network.in.aff.reserves")}</dt><dd className="num">{a.reserves}</dd></div>
      <div><dt>{t("network.in.aff.unspent")}</dt><dd className="num">{a.unspent}</dd></div>
      <div><dt>{t("network.in.aff.locked")}</dt><dd className="num">{a.locked}</dd></div>
      <div><dt>{t("network.in.aff.refundOnly")}</dt><dd className="num">{a.refundOnly}</dd></div>
      <div><dt>{t("network.in.aff.erg")}</dt><dd className="num">{ergs(BigInt(a.nano))}</dd></div>
    </dl>
  );
}
