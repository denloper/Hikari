import type { Translation } from "../../shared/types";
import { sourceLabel, translationKind } from "../lib/format";
import { translationMatchesStudio } from "../lib/studio";

export function TranslationList(props: {
  items: Translation[];
  currentId?: string;
  preferredStudio?: string;
  compact?: boolean;
  onPick: (t: Translation) => void;
}) {
  if (!props.items.length) {
    return (
      <p className="empty">
        Нет озвучки и японского оригинала. Студии: AniLibria, AnimeVost, Студийная банда, Dreamerscast, YummyAnime. Оригинал с
        субтитрами подставляется сам, если студий нет.
      </p>
    );
  }
  return (
    <div className={`tr-list${props.compact ? " compact" : ""}`}>
      {props.items.map((t) => {
        const quality = t.quality ? (/p$/i.test(t.quality) ? t.quality : `${t.quality}p`) : "";
        const fav = props.preferredStudio ? translationMatchesStudio(t, props.preferredStudio) : false;
        const bits = [
          fav ? "любимая" : "",
          translationKind(t.type),
          quality,
          t.lastEpisode ? `эп. ${t.lastEpisode}` : "",
          sourceLabel(t.source)
        ].filter(Boolean);
        return (
          <button
            key={t.id}
            className={`tr-row ${props.currentId === t.id ? "active" : ""}`}
            onClick={() => props.onPick(t)}
            type="button"
          >
            <span className="tr-name">{t.title}</span>
            <span className="tr-meta">{bits.join(" · ")}</span>
          </button>
        );
      })}
    </div>
  );
}
