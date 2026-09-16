import { useEffect, useMemo, useState } from "react";
import type { EpisodeRef } from "../../shared/types";
import { IconCheck } from "./icons";

const CHUNK = 12;

export function EpisodeGrid(props: {
  episodes: EpisodeRef[];
  current?: number;
  continueAt?: number;
  watched?: Set<number>;
  compact?: boolean;
  onPick: (ep: EpisodeRef) => void;
}) {
  const { episodes } = props;
  const [jump, setJump] = useState("");
  const groups = useMemo(() => {
    if (episodes.length <= CHUNK) return [{ from: 1, to: episodes.length, items: episodes }];
    const out: { from: number; to: number; items: EpisodeRef[] }[] = [];
    for (let i = 0; i < episodes.length; i += CHUNK) {
      const items = episodes.slice(i, i + CHUNK);
      out.push({ from: items[0].number, to: items[items.length - 1].number, items });
    }
    return out;
  }, [episodes]);

  const startGroup = useMemo(() => {
    const mark = props.current ?? props.continueAt;
    if (mark == null) return 0;
    const idx = groups.findIndex((g) => g.items.some((e) => e.number === mark));
    return idx >= 0 ? idx : 0;
  }, [groups, props.current, props.continueAt]);

  const [group, setGroup] = useState(startGroup);
  useEffect(() => {
    setGroup(startGroup);
  }, [startGroup, episodes.length]);

  if (!episodes.length) {
    return <p className="empty">Серии ещё не вышли.</p>;
  }

  const shown = groups[group]?.items ?? episodes;

  function goJump() {
    const n = Number(jump);
    if (!n) return;
    const ep = episodes.find((e) => e.number === n);
    if (ep) props.onPick(ep);
  }

  return (
    <div className={`ep-panel ${props.compact ? "compact" : ""}`}>
      {groups.length > 1 ? (
        <div className="ep-toolbar">
          <div className="chips">
            {groups.map((g, i) => (
              <button
                key={`${g.from}-${g.to}`}
                className={`chip ${group === i ? "active" : ""}`}
                type="button"
                onClick={() => setGroup(i)}
              >
                {g.from}–{g.to}
              </button>
            ))}
          </div>
          <form
            className="ep-jump"
            onSubmit={(e) => {
              e.preventDefault();
              goJump();
            }}
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder="№"
              inputMode="numeric"
            />
            <button className="ghost" type="submit">
              К серии
            </button>
          </form>
        </div>
      ) : null}
      <div className="ep-rows">
        {shown.map((ep) => {
          const current = props.current === ep.number;
          const cont = props.continueAt === ep.number;
          const done = props.watched?.has(ep.number) && !current;
          return (
            <button
              key={`${ep.number}-${ep.ref}`}
              className={`ep-row ${current ? "current" : ""} ${cont ? "continue" : ""}`}
              onClick={() => props.onPick(ep)}
              type="button"
            >
              <span className="ep-num">{Number.isInteger(ep.number) ? ep.number : ep.number}</span>
              <span className="ep-title">{ep.title || `Серия ${ep.number}`}</span>
              {done ? (
                <span className="ep-mark done" title="Просмотрено">
                  <IconCheck />
                </span>
              ) : cont ? (
                <span className="ep-mark now">продолжить</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
