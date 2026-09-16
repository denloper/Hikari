import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AnimeCard,
  CatalogGenre,
  CatalogKind,
  CatalogMeta,
  CatalogOrder,
  CatalogStatus,
  ContinueItem
} from "../../shared/types";
import { ContinueRail } from "../components/ContinueCard";
import { PosterCard, SkeletonGrid, catalogSubtitle, catalogTitle } from "../components/PosterCard";
import { IconFilter } from "../components/icons";
import { matchGenre } from "../lib/genres";
import { formatNextAir, posterSrc } from "../lib/format";

const PINNED_GENRES = [
  "Романтика",
  "Комедия",
  "Драма",
  "Фэнтези",
  "Приключения",
  "Экшен",
  "Повседневность",
  "Сёнен",
  "Сёдзё",
  "Сёдзе",
  "Гарем",
  "Сэйнэн",
  "Исекай",
  "Ужасы",
  "Детектив",
  "Спорт"
];

const KINDS: { id: CatalogKind; label: string }[] = [
  { id: "tv", label: "TV" },
  { id: "movie", label: "Фильм" },
  { id: "ova", label: "OVA" },
  { id: "ona", label: "ONA" },
  { id: "special", label: "Спешл" }
];

const STATUSES: { id: CatalogStatus; label: string }[] = [
  { id: "ongoing", label: "Онгоинг" },
  { id: "released", label: "Вышло" },
  { id: "anons", label: "Анонс" }
];

const ORDERS: { id: CatalogOrder; label: string }[] = [
  { id: "popularity", label: "Популярные" },
  { id: "ranked", label: "По рейтингу" },
  { id: "aired_on", label: "По дате" }
];

const SCORES = [7, 8, 9];

export function SearchPage(props: {
  onOpen: (id: number) => void;
  onPlayContinue: (item: ContinueItem) => void;
  onOpenOngoing?: () => void;
  initialGenre?: CatalogGenre | null;
}) {
  const [q, setQ] = useState("");
  const [genreId, setGenreId] = useState<number | undefined>(() =>
    props.initialGenre && props.initialGenre.id > 0 ? props.initialGenre.id : undefined
  );
  const [year, setYear] = useState<number | undefined>();
  const [kind, setKind] = useState<CatalogKind | undefined>();
  const [status, setStatus] = useState<CatalogStatus | undefined>();
  const [minScore, setMinScore] = useState<number | undefined>();
  const [order, setOrder] = useState<CatalogOrder | undefined>();
  const [items, setItems] = useState<AnimeCard[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [cont, setCont] = useState<ContinueItem[]>([]);
  const [latest, setLatest] = useState<AnimeCard[]>([]);
  const [meta, setMeta] = useState<CatalogMeta>({ genres: [], years: [] });
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(Boolean(props.initialGenre));
  const [splashShot, setSplashShot] = useState("");
  const loadSeq = useRef(0);

  const query = q.trim();
  const filterOn = Boolean(genreId || year || kind || status || minScore || order);
  const isHome = !query && !filterOn;

  const pinnedGenres = useMemo(() => {
    const byName = new Map(meta.genres.map((g) => [g.name, g]));
    return PINNED_GENRES.map((name) => byName.get(name)).filter((g): g is CatalogGenre => Boolean(g));
  }, [meta.genres]);

  const otherGenres = useMemo(() => {
    const pinned = new Set(pinnedGenres.map((g) => g.id));
    return meta.genres.filter((g) => !pinned.has(g.id));
  }, [meta.genres, pinnedGenres]);

  const recentYears = useMemo(() => meta.years.slice(0, 8), [meta.years]);
  const olderYears = useMemo(() => meta.years.slice(8), [meta.years]);
  const genreName = meta.genres.find((g) => g.id === genreId)?.name || props.initialGenre?.name;

  const heading = useMemo(() => {
    if (query && !filterOn) return `Результаты · ${query}`;
    const parts: string[] = [];
    if (genreName) parts.push(genreName);
    if (kind) parts.push(KINDS.find((k) => k.id === kind)?.label || kind);
    if (status) parts.push(STATUSES.find((s) => s.id === status)?.label || status);
    if (year) parts.push(String(year));
    if (minScore) parts.push(`от ${minScore}`);
    if (query) parts.push(`«${query}»`);
    return parts.length ? parts.join(" · ") : "Популярное";
  }, [filterOn, genreName, kind, minScore, query, status, year]);

  const filterLabel = useMemo(() => {
    if (!filterOn) return "Фильтры";
    return [genreName, year, kind && KINDS.find((k) => k.id === kind)?.label, status && STATUSES.find((s) => s.id === status)?.label]
      .filter(Boolean)
      .join(" · ");
  }, [filterOn, genreName, kind, status, year]);

  async function loadList(next: {
    query: string;
    genreId?: number;
    year?: number;
    kind?: CatalogKind;
    status?: CatalogStatus;
    minScore?: number;
    order?: CatalogOrder;
    page?: number;
    append?: boolean;
  }) {
    const seq = next.append ? loadSeq.current : ++loadSeq.current;
    if (next.append) setMoreBusy(true);
    else setBusy(true);
    setErr("");
    const text = next.query.trim();
    const nextPage = next.page ?? 1;
    try {
      const list = await window.hikari.listCatalog({
        query: text || undefined,
        genreId: next.genreId,
        year: next.year,
        kind: next.kind,
        status: next.status,
        minScore: next.minScore,
        order: next.order,
        page: nextPage
      });
      if (seq !== loadSeq.current) return;
      setPage(nextPage);
      setHasMore(list.length >= 50);
      setItems((prev) => {
        if (!next.append) return list;
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...list.filter((a) => !seen.has(a.id))];
      });
    } catch (ex) {
      if (seq !== loadSeq.current) return;
      setErr(ex instanceof Error ? ex.message : "Ошибка каталога");
    } finally {
      if (seq === loadSeq.current) {
        setBusy(false);
        setMoreBusy(false);
      }
    }
  }

  function currentFilters() {
    return { query: q, genreId, year, kind, status, minScore, order };
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void loadList(currentFilters());
  }

  function clearFilters() {
    setGenreId(undefined);
    setYear(undefined);
    setKind(undefined);
    setStatus(undefined);
    setMinScore(undefined);
    setOrder(undefined);
    setFiltersOpen(false);
  }

  useEffect(() => {
    void window.hikari.getContinueWatching().then(setCont).catch(() => undefined);
    void window.hikari.getCatalogMeta().then(setMeta).catch(() => undefined);
    void window.hikari.listLatestReleases().then(setLatest).catch(() => undefined);
  }, []);

  useEffect(() => {
    const seed = props.initialGenre;
    if (!seed) return;
    if (seed.id > 0) {
      setGenreId(seed.id);
      setFiltersOpen(true);
      return;
    }
    const hit = matchGenre(meta.genres, seed.name);
    if (hit) {
      setGenreId(hit.id);
      setFiltersOpen(true);
    }
  }, [props.initialGenre, meta.genres]);

  useEffect(() => {
    const text = q.trim();
    const wait = text ? 380 : 40;
    const t = window.setTimeout(() => void loadList(currentFilters()), wait);
    return () => window.clearTimeout(t);
  }, [q, genreId, year, kind, status, minScore, order]);

  const shown = isHome ? items.slice(0, 18) : items;
  const splash = isHome
    ? cont[0]
      ? {
          id: cont[0].animeId,
          title: cont[0].title,
          poster: cont[0].poster,
          kicker: cont[0].episode ? `Продолжить · эп. ${cont[0].episode}` : "Продолжить"
        }
      : latest[0]
        ? {
            id: latest[0].id,
            title: catalogTitle(latest[0].russian, latest[0].name),
            poster: posterSrc(latest[0].poster, latest[0].posterLocal, latest[0].id),
            kicker: latest[0].lastEpisode ? `Новая серия · ${latest[0].lastEpisode}` : "Новая серия"
          }
        : items[0]
          ? {
              id: items[0].id,
              title: catalogTitle(items[0].russian, items[0].name),
              poster: posterSrc(items[0].poster, items[0].posterLocal, items[0].id),
              kicker: "Популярное"
            }
          : null
    : null;

  useEffect(() => {
    if (!splash?.id) {
      setSplashShot("");
      return;
    }
    setSplashShot(`hikari://splash/${splash.id}`);
  }, [splash?.id]);

  return (
    <div className="page">
      <form className="catalog-search" onSubmit={onSubmit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти тайтл…" />
        <button
          className={`ghost ${filterOn || filtersOpen ? "on" : ""}`}
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <IconFilter /> {filterLabel}
        </button>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Ищу…" : "Найти"}
        </button>
      </form>

      {filtersOpen ? (
        <div className="filter-panel">
          <div className="filter-row">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`chip ${kind === k.id ? "active" : ""}`}
                type="button"
                onClick={() => setKind(kind === k.id ? undefined : k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                className={`chip ${status === s.id ? "active" : ""}`}
                type="button"
                onClick={() => setStatus(status === s.id ? undefined : s.id)}
              >
                {s.label}
              </button>
            ))}
            {ORDERS.map((o) => (
              <button
                key={o.id}
                className={`chip ${order === o.id ? "active" : ""}`}
                type="button"
                onClick={() => setOrder(order === o.id ? undefined : o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            {SCORES.map((n) => (
              <button
                key={n}
                className={`chip ${minScore === n ? "active" : ""}`}
                type="button"
                onClick={() => setMinScore(minScore === n ? undefined : n)}
              >
                оценка от {n}
              </button>
            ))}
          </div>
          <div className="filter-row">
            {recentYears.map((y) => (
              <button
                key={y}
                className={`chip ${year === y ? "active" : ""}`}
                type="button"
                onClick={() => setYear(year === y ? undefined : y)}
              >
                {y}
              </button>
            ))}
            {olderYears.length ? (
              <select
                className="filter-select"
                value={year && !recentYears.includes(year) ? String(year) : ""}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Другой год</option>
                {olderYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {meta.genres.length ? (
            <div className="filter-row">
              {pinnedGenres.map((g) => (
                <button
                  key={g.id}
                  className={`chip ${genreId === g.id ? "active" : ""}`}
                  type="button"
                  onClick={() => setGenreId(genreId === g.id ? undefined : g.id)}
                >
                  {g.name}
                </button>
              ))}
              {otherGenres.length ? (
                <select
                  className="filter-select"
                  value={genreId && otherGenres.some((g) => g.id === genreId) ? String(genreId) : ""}
                  onChange={(e) => setGenreId(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="">Ещё жанры</option>
                  {otherGenres.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
          <div className="toolbar" style={{ marginTop: 4 }}>
            <button className="ghost" type="button" onClick={() => props.onOpenOngoing?.()}>
              Онгоинги
            </button>
            {filterOn ? (
              <button className="ghost" type="button" onClick={clearFilters}>
                Сбросить
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {err ? <p className="error">{err}</p> : null}

      {splash ? (
        <button
          className={`hero${splashShot ? " has-shot" : ""}`}
          type="button"
          onClick={() => props.onOpen(splash.id)}
        >
          {splashShot ? (
            <img className="hero-shot" src={splashShot} alt="" onError={() => setSplashShot("")} />
          ) : null}
          {!splashShot && splash.poster ? <img className="hero-poster" src={splash.poster} alt="" /> : null}
          <div className="hero-body">
            <div className="hero-kicker">{splash.kicker}</div>
            <h2>{splash.title}</h2>
            <div className="toolbar">
              <span className="primary">Открыть</span>
            </div>
          </div>
        </button>
      ) : null}

      {isHome && cont.length ? (
        <>
          <h2>Продолжить</h2>
          <ContinueRail items={cont} onPlay={props.onPlayContinue} />
        </>
      ) : null}

      {isHome && latest.length ? (
        <>
          <h2>Новые серии</h2>
          <div className="rail">
            {latest.slice(0, 8).map((a) => (
              <PosterCard
                key={`new-${a.id}`}
                title={catalogTitle(a.russian, a.name)}
                animeId={a.id}
                poster={posterSrc(a.poster, a.posterLocal, a.id)}
                badge={a.lastEpisode ? `эп. ${a.lastEpisode}` : undefined}
                subtitle={formatNextAir(a.nextEpisodeAt, a.nextEpisode)}
                onClick={() => props.onOpen(a.id)}
              />
            ))}
          </div>
        </>
      ) : null}

      <h2>{heading}</h2>
      {busy && !items.length ? <SkeletonGrid count={8} /> : null}
      {!busy && !items.length ? <p className="empty">Ничего не найдено.</p> : null}
      {shown.length ? (
        <div className="grid">
          {shown.map((a) => (
            <PosterCard
              key={a.id}
              title={catalogTitle(a.russian, a.name)}
              animeId={a.id}
              poster={posterSrc(a.poster, a.posterLocal, a.id)}
              score={isHome ? undefined : a.score}
              badge={a.status === "ongoing" ? "онгоинг" : undefined}
              subtitle={isHome ? undefined : catalogSubtitle(a.kind, a.airedOn)}
              onClick={() => props.onOpen(a.id)}
            />
          ))}
        </div>
      ) : null}
      {!isHome && hasMore && shown.length ? (
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button
            className="ghost"
            type="button"
            disabled={moreBusy}
            onClick={() => void loadList({ ...currentFilters(), page: page + 1, append: true })}
          >
            {moreBusy ? "Загружаю…" : "Показать ещё"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
