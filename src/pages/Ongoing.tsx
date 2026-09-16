import { useEffect, useRef, useState } from "react";
import type { AnimeCard, ScheduleDay } from "../../shared/types";
import { PosterCard, SkeletonGrid, catalogSubtitle, catalogTitle } from "../components/PosterCard";
import { formatNextAir, posterSrc } from "../lib/format";

const SHORT_DAYS = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function todayWeekday(): number {
  const js = new Date().getDay();
  return js === 0 ? 7 : js;
}

function scheduleSubtitle(card: AnimeCard): string {
  const next = formatNextAir(card.nextEpisodeAt, card.nextEpisode);
  if (next) return next;
  if (card.lastEpisode) return `вышел эп. ${card.lastEpisode}`;
  return catalogSubtitle(card.kind, card.airedOn);
}

export function OngoingPage(props: { onOpen: (id: number) => void }) {
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(todayWeekday());
  const sections = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr("");
    void window.hikari
      .getSchedule()
      .then((list) => {
        if (!alive) return;
        setDays(list);
      })
      .catch((ex) => {
        if (!alive) return;
        setErr(ex instanceof Error ? ex.message : "Не удалось загрузить расписание");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const today = todayWeekday();
  const total = days.reduce((sum, day) => sum + day.items.length, 0);
  const ordered = [...days].sort((a, b) => {
    const ra = (a.weekday - today + 7) % 7;
    const rb = (b.weekday - today + 7) % 7;
    return ra - rb;
  });

  function jump(weekday: number) {
    setActive(weekday);
    sections.current[weekday]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Онгоинги</h1>
          <p>Расписание выходов: понедельник — воскресенье.</p>
        </div>
      </div>

      {days.length ? (
        <div className="day-nav">
          {days.map((day) => (
            <button
              key={day.weekday}
              className={`chip ${active === day.weekday ? "active" : ""} ${day.weekday === today ? "chip-today" : ""}`}
              type="button"
              disabled={!day.items.length}
              onClick={() => jump(day.weekday)}
            >
              {SHORT_DAYS[day.weekday]}
              {day.items.length ? <span className="chip-count">{day.items.length}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {err ? <p className="error">{err}</p> : null}
      {busy && !total ? <SkeletonGrid /> : null}
      {!busy && !total ? <p className="empty">Расписание на эту неделю пустое.</p> : null}

      {ordered.map((day) => (
        <section
          key={day.weekday}
          className="day-section"
          ref={(el) => {
            sections.current[day.weekday] = el;
          }}
        >
          <div className="day-section-head">
            <h2>{day.weekday === today ? `Сегодня · ${day.label}` : day.label}</h2>
            <span className="muted">{day.items.length ? `${day.items.length} тайтл.` : "нет выходов"}</span>
          </div>
          {day.items.length ? (
            <div className="grid">
              {day.items.map((a) => (
                <PosterCard
                  key={a.id}
                  title={catalogTitle(a.russian, a.name)}
                  animeId={a.id}
                  poster={posterSrc(a.poster, a.posterLocal, a.id)}
                  score={a.score}
                  badge={a.lastEpisode ? `эп. ${a.lastEpisode}` : a.nextEpisode ? `эп. ${a.nextEpisode}` : undefined}
                  subtitle={scheduleSubtitle(a)}
                  onClick={() => props.onOpen(a.id)}
                />
              ))}
            </div>
          ) : (
            <p className="empty day-empty">В этот день выходов нет.</p>
          )}
        </section>
      ))}
    </div>
  );
}
