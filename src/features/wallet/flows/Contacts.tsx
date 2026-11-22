// Contacts (K10 and the people side of P01): residents you keep close, with a label, a note and a star; each
// one opens Pay or Request with them filled in. Notes stay the record; contacts are only names you chose.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { AgentTag, Empty, Field, Icon, Key, KeyField, TextInput } from "@/ui";
import { RESIDENTS, town, useTown, useTownView, worldText, YOU, type Contact } from "@/world";
import { useFmt, useNameOf, useOutcomeToast } from "../lib/hooks";
import { resolveParty, walletModel, type Unit } from "../lib/model";
import { Frame, PartySeal } from "../parts/bits";

export function ContactsPage({ page }: { page: boolean }) {
  const t = useT();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const contacts = useTown((s) => s.contacts);
  const [add, setAdd] = useState("");
  const others = RESIDENTS.filter((r) => r.id !== "op" && !contacts.some((c) => c.id === r.id));
  const pasted = town.economy ? resolveParty(town.economy, add) : null;
  const list = useMemo(() => contacts.slice().sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (a.label || a.id).localeCompare(b.label || b.id)), [contacts]);
  const resolve = (s: string) => {
    const eco = town.economy;
    const id = eco ? resolveParty(eco, s) : null;
    return id && eco ? { name: nameOf(id), pk: eco.p(id).pub, agent: eco.p(id).kind === "agent" } : null;
  };
  return (
    <Frame page={page} title={t("wallet.ct.title")} sub={t("wallet.ct.sub")} labelId="wl-ct-h" className="wl-flow wl-ct">
      {list.length === 0 ? (
        <Empty title={t("wallet.ct.none.t")} text={t("wallet.ct.none.b")} />
      ) : (
        <ul className="rows wl-contacts">
          {list.map((c) => (
            <ContactRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      <section className="wl-ct-add" aria-labelledby="wl-ct-add">
        <h2 className="label" id="wl-ct-add">
          <b>{t("wallet.ct.add")}</b>
        </h2>
        <div className="wl-chips">
          {others.map((r) => (
            <button key={r.id} type="button" className="wl-chip" onClick={() => void town.contacts.add(r.id).then(show)}>
              <PartySeal id={r.id} size="sm" />
              {nameOf(r.id)}
              <Icon name="plus" size={14} />
            </button>
          ))}
        </div>
        <Field label={t("wallet.pick.paste")} help={add && !pasted ? t("wallet.pick.unknown") : t("wallet.ct.pasteHelp")}>
          <KeyField value={add} onChange={setAdd} resolve={resolve} placeholder="02… / 03…" />
        </Field>
        {pasted && pasted !== YOU && (
          <Key size="sm" variant="primary" icon="plus" onClick={() => void town.contacts.add(pasted).then((o) => (show(o), setAdd("")))}>
            {t("wallet.ct.addOne", { name: nameOf(pasted) })}
          </Key>
        )}
      </section>
    </Frame>
  );
}

function ContactRow({ c }: { c: Contact }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const [edit, setEdit] = useState(false);
  const [label, setLabel] = useState(c.label ?? "");
  const [note, setNote] = useState(c.note ?? "");
  const rel = useTownView(
    (eco) => {
      const rows = walletModel(eco, "erg").rows.filter((r) => r.other === c.id && r.unit.id === "erg");
      return { in: rows.find((r) => r.dir === "in")?.claim ?? 0n, out: rows.find((r) => r.dir === "out")?.outstanding ?? 0n, agent: eco.participants.get(c.id)?.kind === "agent" };
    },
    [c.id],
  );
  const name = c.label || nameOf(c.id);
  const erg: Unit = { id: "erg", symbol: "ERG", decimals: 9 };
  return (
    <li className="row wl-contact">
      <PartySeal id={c.id} />
      <span className="wl-row-mid">
        <span className="who">
          {c.favorite && <span className="wl-star" aria-label={t("wallet.ct.fav")}>★</span>}
          {name}
          {rel?.agent && <AgentTag small />}
          {c.label && <span className="t-small"> · {nameOf(c.id)}</span>}
        </span>
        <span className="what">
          {rel && (rel.in > 0n || rel.out > 0n)
            ? [rel.in > 0n ? f.prose(t("wallet.ct.owesYou", { v: f.amt(rel.in, erg, { unit: true }) })) : null, rel.out > 0n ? f.prose(t("wallet.ct.youOwe", { v: f.amt(rel.out, erg, { unit: true }) })) : null].filter(Boolean).join(" · ")
            : c.note || worldText(`world.cast.${c.id}.about`, {}, t.lang)}
        </span>
        {edit && (
          <span className="wl-ct-edit">
            <Field label={t("wallet.ct.label")}>
              <TextInput value={label} onChange={(v) => setLabel(v.slice(0, 32))} />
            </Field>
            <Field label={t("wallet.ct.note")}>
              <TextInput value={note} onChange={(v) => setNote(v.slice(0, 80))} />
            </Field>
            <span className="wl-act">
              <Key size="sm" variant="primary" onClick={() => void town.contacts.update(c.id, { label, note }).then((o) => (show(o), setEdit(false)))}>
                {t("wallet.ct.save")}
              </Key>
              <Key size="sm" variant="danger" onClick={() => void town.contacts.remove(c.id).then(show)}>
                {t("wallet.ct.remove")}
              </Key>
            </span>
          </span>
        )}
      </span>
      <span className="wl-ct-keys">
        <Key size="sm" variant="quiet" icon="pay" to={`/wallet/pay?to=${c.id}`} aria-label={t("wallet.ct.pay", { name })} />
        <Key size="sm" variant="quiet" icon="request" to={`/wallet/request?from=${c.id}`} aria-label={t("wallet.ct.request", { name })} />
        <Key size="sm" variant="quiet" aria-pressed={!!c.favorite} aria-label={t(c.favorite ? "wallet.ct.unfav" : "wallet.ct.fav")} onClick={() => void town.contacts.update(c.id, { favorite: !c.favorite }).then(show)}>
          {c.favorite ? "★" : "☆"}
        </Key>
        <Key size="sm" variant="quiet" icon="settings" aria-expanded={edit} aria-label={t("wallet.ct.edit", { name })} onClick={() => setEdit(!edit)} />
      </span>
    </li>
  );
}
