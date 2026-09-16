import type { StreamSkips } from "../../shared/types";

/** Какой скип сейчас активен (окно до конца минус 1.5 сек). */
export function activeSkip(skips: StreamSkips | undefined, time: number): { kind: "op" | "ed"; to: number } | null {
  const op = skips?.opening;
  const ed = skips?.ending;
  if (op && time >= op.start && time < Math.max(op.start, op.end - 1.5)) {
    return { kind: "op", to: op.end };
  }
  if (ed && time >= ed.start && time < Math.max(ed.start, ed.end - 1.5)) {
    return { kind: "ed", to: ed.end };
  }
  return null;
}

export function mergeSkips(a?: StreamSkips, b?: StreamSkips): StreamSkips | undefined {
  const opening = a?.opening || b?.opening;
  const ending = a?.ending || b?.ending;
  if (!opening && !ending) return undefined;
  return { opening, ending };
}
