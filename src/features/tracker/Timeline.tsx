// The digest timeline (FEATURES T03): one row per commitment of the town tracker, newest first. A row shows the
// digest's fingerprint glyph, the block, the pairs that entered or rose, the sandbox transaction, its
// confirmations and the reverted flag. Choosing a row points the proof panel at that digest.
import { useT } from "@/app/lang";
import { Key, int, short, Table, Tag, type Column } from "@/ui";
import { DigestGlyph } from "@/viz";
import type { TimelineRow } from "./model";

export interface TimelineProps {
  rows: TimelineRow[];
  total: number;
  height: number;
  minDepth: number;
  selected: string | null;
  onSelect: (row: TimelineRow) => void;
  onMore: () => void;
  trackerId: string;
}

export function Timeline({ rows, total, height, minDepth, selected, onSelect, onMore, trackerId }: TimelineProps) {
  const t = useT();
  const more = Math.min(24, Math.max(0, total - rows.length));
  const columns: Column<TimelineRow>[] = [
    {
      key: "digest",
      label: t("tracker.tl.col.digest"),
      lead: true,
      render: (r) => (
        <span className="trk-tl-digest">
          <span aria-hidden="true" className="trk-tl-glyph">
            <DigestGlyph digest={r.digest} size={34} holo={r.current} stale={!r.current} />
          </span>
          <span className="trk-tl-dg">
            <code className="trk-code">{short(r.digest, 6, 6)}</code>
            <span className="trk-tl-tags">
              {r.current && <Tag tone="ok">{t("tracker.tl.current")}</Tag>}
              {r.genesis && <Tag>{t("tracker.tl.genesis")}</Tag>}
              {r.heartbeat && !r.genesis && <Tag>{t("tracker.tl.heartbeat")}</Tag>}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "block",
      label: t("tracker.tl.col.block"),
      align: "right",
      render: (r) => (
        <span className="trk-tl-block">
          <span className="num">{int(r.height)}</span>
          <span className="t-small dim">{height - r.height === 0 ? t("tracker.tl.now") : t.p("tracker.tl.ago", height - r.height, { n: int(height - r.height) })}</span>
        </span>
      ),
    },
    {
      key: "changes",
      label: t("tracker.tl.col.changes"),
      align: "right",
      render: (r) =>
        r.added.length + r.raised.length === 0 ? (
          <span className="dim">—</span>
        ) : (
          <span className="trk-tl-ch" title={t("tracker.tl.changesTitle", { a: int(r.added.length), r: int(r.raised.length) })}>
            {r.added.length > 0 && <span className="add" aria-hidden="true">+{int(r.added.length)}</span>}
            {r.raised.length > 0 && <span className="rse" aria-hidden="true">~{int(r.raised.length)}</span>}
            <span className="sr-only">{t("tracker.tl.changesTitle", { a: int(r.added.length), r: int(r.raised.length) })}</span>
          </span>
        ),
    },
    { key: "tree", label: t("tracker.tl.col.tree"), align: "right", render: (r) => <span className="num">{int(r.notes)}</span> },
    { key: "tx", label: t("tracker.tl.col.tx"), render: (r) => <code className="trk-code dim">{short(r.txId, 6, 4)}</code> },
    {
      key: "conf",
      label: t("tracker.tl.col.conf"),
      align: "right",
      render: (r) =>
        r.confirmedHeight === null && r.depth < minDepth ? (
          <span className="trk-tl-depth">{t("tracker.tl.depth", { d: int(r.depth), min: int(minDepth) })}</span>
        ) : (
          <span className="num">{int(r.depth)}</span>
        ),
    },
    { key: "rev", label: t("tracker.tl.col.reverted"), align: "right", render: () => <span className="dim">{t("tracker.tl.no.value")}</span> },
  ];
  return (
    <div className="trk-tl">
      <div className="trk-tl-head">
        <span className="label">{t.p("tracker.tl.count", total, { n: int(total) })}</span>
        <span className="label">{t("tracker.tl.hint")}</span>
      </div>
      <Table
        className="trk-tl-table"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.boxId}
        stack
        onRowClick={onSelect}
        selected={(r) => r.boxId === selected}
        caption={t("tracker.tl.caption", { id: trackerId })}
      />
      <div className="trk-tl-foot">
        {more > 0 && (
          <Key size="sm" variant="quiet" onClick={onMore}>
            {t("tracker.tl.more", { n: int(more) })}
          </Key>
        )}
        <p className="t-small dim">{t("tracker.tl.revertNote")}</p>
        <p className="t-small dim">{t("tracker.tl.txNote")}</p>
      </div>
    </div>
  );
}
