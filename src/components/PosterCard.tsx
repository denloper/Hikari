import { useEffect, useState } from "react";
import { displayName, kindLabel, posterSrc, yearOf } from "../lib/format";

function showScore(score?: string): boolean {
  if (!score || score === "—") return false;
  const n = Number(String(score).replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

export function PosterCard(props: {
  title: string;
  subtitle?: string;
  poster?: string;
  animeId?: number;
  score?: string;
  badge?: string;
  onClick: () => void;
}) {
  const initial = posterSrc(props.poster, undefined, props.animeId);
  const [src, setSrc] = useState(initial);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    setSrc(posterSrc(props.poster, undefined, props.animeId));
    setTries(0);
  }, [props.poster, props.animeId]);

  return (
    <button className="poster-card" type="button" onClick={props.onClick}>
      <div className="poster-card-art">
        {src ? (
          <img
            src={src}
            alt=""
            onError={() => {
              const id = props.animeId ?? 0;
              if (!id || tries >= 2) {
                setSrc("");
                return;
              }
              const next = tries + 1;
              window.setTimeout(() => {
                setTries(next);
                setSrc(`hikari://poster/${id}?r=${Date.now()}`);
              }, 900 * next);
            }}
          />
        ) : (
          <div className="poster" />
        )}
        {showScore(props.score) ? <span className="poster-score">{props.score}</span> : null}
        {props.badge ? <span className="poster-badge">{props.badge}</span> : null}
      </div>
      <div className="poster-card-meta">
        <div className="name">{props.title}</div>
        {props.subtitle ? <div className="sub">{props.subtitle}</div> : null}
      </div>
    </button>
  );
}

export function catalogSubtitle(kind: string, airedOn: string): string {
  return [kindLabel(kind), yearOf(airedOn)].filter(Boolean).join(" · ");
}

export function catalogTitle(russian?: string, name?: string): string {
  return displayName(russian, name);
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-poster" />
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}
