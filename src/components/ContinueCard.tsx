import type { ContinueItem } from "../../shared/types";
import { progressRatio } from "../lib/format";
import { IconPlay } from "./icons";

export function ContinueCard(props: { item: ContinueItem; onClick: () => void }) {
  const { item } = props;
  const ratio = progressRatio(item.positionSec, item.durationSec);
  const sub = [item.episode ? `эп. ${item.episode}` : "", item.translationTitle].filter(Boolean).join(" · ");
  return (
    <button className="continue-card" type="button" onClick={props.onClick}>
      <div className="continue-art">
        {item.poster ? <img src={item.poster} alt="" /> : <div className="poster" />}
        <span className="continue-play">
          <IconPlay />
        </span>
      </div>
      <div className="continue-meta">
        <div className="name">{item.title}</div>
        {sub ? <div className="sub">{sub}</div> : null}
        <div className="progress-track" aria-hidden>
          <i style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 6 : 0)}%` }} />
        </div>
      </div>
    </button>
  );
}

export function ContinueRail(props: { items: ContinueItem[]; onPlay: (item: ContinueItem) => void }) {
  if (!props.items.length) return null;
  return (
    <div className="continue-rail">
      {props.items.slice(0, 12).map((item) => (
        <ContinueCard key={item.animeId} item={item} onClick={() => props.onPlay(item)} />
      ))}
    </div>
  );
}
