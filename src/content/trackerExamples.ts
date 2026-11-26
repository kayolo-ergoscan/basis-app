// Working examples against ErgoScan's tracker at its public address: read routes only, each run once against the live
// tracker on 26 November 2026. The answers are the real ones, shortened: long hex in the middle ("d90cffd7…6f0c03"),
// lists cut to their first item. Both Learn pages that show examples (/learn/developers, /learn/api) render this list.
//
// The commands are code (the same in both languages): copyable as written, with <placeholders> only for keys.

import { ERGOSCAN_TRACKER_URL } from "./clients";
import { t, type Text } from "./types";

export interface TrackerExample {
  /** The catalogue entry this call belongs to (apiEndpoints id, /learn/api#ep-<id>). */
  endpoint: string;
  /** What the call answers, in a few words. */
  title: Text;
  /** The curl command, as typed. */
  curl: string;
  /** The live answer (shortened as the file head says). */
  response: string;
  /** One line on how to read the answer. */
  read: Text;
}

/** The day the answers below were read from the live tracker. */
export const TRACKER_EXAMPLES_DATE = "2026-11-26";

const T = ERGOSCAN_TRACKER_URL;

export const trackerExamples: TrackerExample[] = [
  {
    endpoint: "tracker-state",
    title: t("Is the tracker up, and what did it commit?", "Работает ли трекер и что он зафиксировал"),
    curl: `curl -s ${T}/tracker/state`,
    response: `{
  "success": true,
  "data": {
    "local_digest": "d90cffd7…6f0c03",
    "confirmed_digest": "d90cffd7…6f0c03",
    "confirmed_box_id": "825fdd09…dd1888",
    "confirmed_height": 1924582,
    "pending_digest": null,
    "pending_tx_id": null,
    "pending_submitted_height": null,
    "tracker_box_id": "825fdd09…dd1888"
  },
  "error": null
}`,
    read: t(
      "When local_digest equals confirmed_digest, every note the tracker holds is in its last digest on Ergo.",
      "Если local_digest равен confirmed_digest, все расписки трекера уже в его последнем дайджесте в Ergo.",
    ),
  },
  {
    endpoint: "key-status",
    title: t("What one key owes, and its reserve", "Сколько должен один ключ и какой у него резерв"),
    curl: `curl -s ${T}/key-status/<key>`,
    response: `{
  "success": true,
  "data": {
    "issuer_pubkey": "023316d2…1b1207",
    "note_count": 1,
    "last_updated": 1795673380225,
    "has_pending_refund": false,
    "denominations": [{
      "denomination": "erg", "symbol": "ERG", "decimals": 9,
      "total_debt": 100000000,
      "collateral": 600000000,
      "collateralization_ratio": 6.0,
      "note_count": 1,
      "reserve_box_id": "62054904…0b6d06",
      "has_pending_refund": false
    }]
  },
  "error": null
}`,
    read: t(
      "Amounts are nanoERG: this key still owes 0.1 ERG and has 0.6 ERG in its reserve, six times its debt.",
      "Суммы в nanoERG: этот ключ ещё должен 0,1 ERG, а в его резерве 0,6 ERG — в шесть раз больше долга.",
    ),
  },
  {
    endpoint: "note-state",
    title: t("One payer → receiver note: its total and what can be redeemed", "Расписка одной пары: итог и что можно погасить"),
    curl: `curl -s -X POST ${T}/notes/state \\
  -H 'content-type: application/json' \\
  -d '{"issuer_pubkey":"<payer key>","recipient_pubkey":"<your key>","denomination":"erg"}'`,
    response: `{
  "success": true,
  "data": {
    "issuer_pubkey": "023316d2…1b1207",
    "recipient_pubkey": "02148f7e…bc7cd8",
    "local": 600000000,
    "confirmed": 600000000,
    "pending": null,
    "already_redeemed": 500000000,
    "redeemable": true,
    "redeemable_amount": 100000000,
    "status": "confirmed"
  },
  "error": null
}`,
    read: t(
      "local is the note's running total. status \"confirmed\" means that total is in a digest on Ergo; redeemable_amount is what is left to redeem.",
      "local — накопленный итог расписки. status «confirmed» значит, что этот итог уже в дайджесте в Ergo; redeemable_amount — сколько осталось погасить.",
    ),
  },
  {
    endpoint: "reserves",
    title: t("Every reserve the tracker follows", "Все резервы, за которыми следит трекер"),
    curl: `curl -s ${T}/reserves`,
    response: `{
  "success": true,
  "data": [
    {
      "box_id": "62054904…0b6d06",
      "owner_pubkey": "023316d2…1b1207",
      "collateral_amount": 600000000,
      "total_debt": 100000000,
      "pending_redemption_amount": 0,
      "tracker_nft_id": "f5178dc4…e3f29f",
      "last_updated_height": 1923985,
      "last_updated_timestamp": 1795673380225,
      "collateralization_ratio": 6.0,
      "refund_initiation_height": 0
    },
    "…"
  ],
  "error": null
}`,
    read: t(
      "A refund_initiation_height above 0 means the owner has started taking the reserve back.",
      "refund_initiation_height больше 0 значит, что владелец начал забирать резерв.",
    ),
  },
];
