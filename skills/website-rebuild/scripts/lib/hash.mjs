/**
 * lib/hash.mjs — the one sha256 spelling.
 *
 * 23 call sites in 19 files each wrote `createHash("sha256").update(x).digest("hex")`
 * by hand, and three of them re-implemented the streaming file form. None was
 * wrong; the point is that a ledger row, an inventory line and a verify-mirror
 * check must agree on what "the sha256 of this file" means, and one spelling
 * cannot disagree with itself (verification-gates.md §2.1.1).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Hex sha256 of a string or Buffer. */
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** First `n` hex chars — the short form used for ids in generated file names. */
export const sha256Short = (data, n = 12) => sha256(data).slice(0, n);

/** Hex sha256 of a file, streamed — for ledgers over media the size of a movie. */
export function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(p)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}
