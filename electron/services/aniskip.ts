import type { StreamSkip, StreamSkips } from "../../shared/types";
import { httpJson } from "./http";

/** Шикимори id совпадает с MAL — AniSkip принимает его как mal_id. */
export async function fetchSkipTimes(malId: number, episode: number): Promise<StreamSkips> {
  if (malId <= 0 || episode <= 0) return {};
  try {
    const res = await httpJson<{
      results?: { interval?: { startTime?: number; endTime?: number }; skipType?: string }[];
    }>(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types=op&types=ed`, { timeoutMs: 8000 });
    const opening = pickInterval(res.results, "op");
    const ending = pickInterval(res.results, "ed");
    return { opening, ending };
  } catch {
    return {};
  }
}

/** Метки опенинга по MAL/Shikimori id. */
export async function fetchOpeningSkip(malId: number, episode: number): Promise<StreamSkip | null> {
  return (await fetchSkipTimes(malId, episode)).opening ?? null;
}

function pickInterval(
  rows: { interval?: { startTime?: number; endTime?: number }; skipType?: string }[] | undefined,
  type: "op" | "ed"
): StreamSkip | undefined {
  const hit = (rows ?? []).find((row) => {
    const kind = String(row.skipType || "").toLowerCase();
    return kind === type || kind === `${type}-recap` || kind.startsWith(`${type}`);
  });
  const start = Number(hit?.interval?.startTime);
  const end = Number(hit?.interval?.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return { start, end };
}
