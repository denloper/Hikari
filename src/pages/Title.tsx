import { useEffect, useMemo, useState } from "react";
import type { AnimeTitle, CatalogGenre, EpisodeRef, LastWatch, RelatedTitle, ShikiListStatus, ShikiRate, Translation } from "../../shared/types";
import { PosterCard, catalogTitle } from "../components/PosterCard";
import { IconBack, IconHeart, IconPlay } from "../components/icons";
import { cssPoster, displayName, formatNextAir, kindLabel, posterSrc, shikiPoster, statusLabel, yearOf } from "../lib/format";
import { matchGenre, titleGenres } from "../lib/genres";
import { pickTranslation, sortTranslations } from "../lib/studio";

export function TitlePage(props: {
  animeId: number;
  onBack: () => void;
  onOpen: (id: number) => void;
  onGenre: (genre: CatalogGenre) => void;
  onPlay: (
    anime: AnimeTitle,
    translation: Translation,
    episode: EpisodeRef,
    season: number,
    translations: Translation[]
  ) => void;
}) {
  const [anime, setAnime] = useState<AnimeTitle | null>(null);
  const [trs, setTrs] = useState<Translation[]>([]);
  const [trId, setTrId] = useState("");
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState<number>(1);
  const [fav, setFav] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [rate, setRate] = useState<ShikiRate | null>(null);
  const [shikiOn, setShikiOn] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [last, setLast] = useState<LastWatch | null>(null);
  const [related, setRelated] = useState<RelatedTitle[]>([]);
  const [preferredStudio, setPreferredStudio] = useState("");
  const [opBusy, setOpBusy] = useState(false);
  const [opMsg, setOpMsg] = useState("");
  const [backdrop, setBackdrop] = useState("");

  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
    let dead = false;
    (async () => {
      setBusy(true);
      setErr("");
      setAnime(null);
      setTrs([]);
      setRelated([]);
      setBackdrop("");
      try {
        const title = await window.hikari.getAnime(props.animeId);
        if (dead) return;
        setAnime(title);
        setBackdrop(`hikari://splash/${title.id}`);
        setFav(await window.hikari.isFavorite(props.animeId));
        const acc = await window.hikari.getShikiAccount();
        const shikiRate = acc ? await window.hikari.getShikiRate(props.animeId).catch(() => null) : null;
        if (!dead) {
          setShikiOn(Boolean(acc));
          setRate(shikiRate);
        }
        const watch = await window.hikari.getLastWatch(props.animeId);
        const [list, links, cfg] = await Promise.all([
          window.hikari.getTranslations(title),
          window.hikari.getRelated(props.animeId).catch(() => []),
          window.hikari.getConfig().catch(() => null)
        ]);
        if (dead) return;
        const studio = cfg?.preferredStudio || "";
        setPreferredStudio(studio);
        setLast(watch);
        setRelated(links);
        const ordered = sortTranslations(list, studio);
        setTrs(ordered);
        const picked = pickTranslation(ordered, watch?.translationId, studio);
        if (picked) {
          setTrId(picked.id);
          const ep = watch?.episode ?? picked.seasons[0]?.episodes[0]?.number ?? 1;
          setSeason(picked.seasons[0]?.number ?? 1);
          setEpisode(ep);
        }
      } catch (ex) {
        if (!dead) setErr(ex instanceof Error ? ex.message : "Ошибка загрузки");
      } finally {
        if (!dead) setBusy(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [props.animeId]);

  const current = useMemo(() => trs.find((t) => t.id === trId), [trs, trId]);
  const seasons = current?.seasons ?? [];
  const seasonObj = seasons.find((s) => s.number === season) ?? seasons[0];
  const episodes = seasonObj?.episodes ?? [];
  const currentEp = episodes.find((e) => e.number === episode) ?? episodes[0];
  const art = anime ? posterSrc(anime.poster, anime.posterLocal, anime.id) : "";
  const continueAt = last?.translationId === trId ? last.episode : undefined;
  const longDesc = Boolean(anime?.description && anime.description.length > 280);

  async function toggleFav() {
    if (!anime) return;
    const next = await window.hikari.toggleFavorite({
      animeId: anime.id,
      title: displayName(anime.russian, anime.name),
      poster: art,
      score: anime.score
    });
    setFav(next);
  }

  function play(ep: EpisodeRef) {
    if (!anime || !current) return;
    setEpisode(ep.number);
    props.onPlay(anime, current, ep, seasonObj?.number ?? 1, trs);
  }

  async function openGenre(genre: CatalogGenre) {
    if (genre.id > 0) {
      props.onGenre(genre);
      return;
    }
    try {
      const meta = await window.hikari.getCatalogMeta();
      const hit = matchGenre(meta.genres, genre.name);
      if (hit) props.onGenre(hit);
    } catch {
      /* каталог жанров мог не ответить */
    }
  }

  async function downloadOpening() {
    if (!anime || !current || !currentEp) return;
    setOpBusy(true);
    setOpMsg("");
    try {
      const item = await window.hikari.enqueueDownload({
        source: current.source,
        ref: currentEp.ref,
        anilibriaEpisodeId: current.source === "anilibria" ? currentEp.ref : undefined,
        animeId: anime.id,
        title: displayName(anime.russian, anime.name),
        episode: currentEp.number,
        filename: `${displayName(anime.russian, anime.name)} ${currentEp.number} OP`,
        clip: "opening"
      });
      setOpMsg(item.status === "error" ? item.error || "Не удалось скачать" : "Опенинг в очереди · Библиотека → Скачанное");
    } catch (ex) {
      setOpMsg(ex instanceof Error ? ex.message : "Не удалось скачать опенинг");
    } finally {
      setOpBusy(false);
    }
  }

  if (busy && !anime) {
    return (
      <div className="page">
        <p className="muted">Открываю тайтл…</p>
      </div>
    );
  }
  if (!anime) {
    return (
      <div className="page">
        <button className="ghost" type="button" onClick={props.onBack}>
          <IconBack /> Назад
        </button>
        <p className="error">{err || "Тайтл не найден"}</p>
      </div>
    );
  }

  return (
    <div className="page title-page">
      {backdrop ? (
        <div className="title-page-backdrop" aria-hidden="true">
          <img
            src={backdrop}
            alt=""
            onError={() => {
              if (backdrop !== art) setBackdrop(art);
              else setBackdrop("");
            }}
          />
        </div>
      ) : null}
      <button className="ghost" type="button" onClick={props.onBack}>
        <IconBack /> Назад в каталог
      </button>
      <div className="title-hero" style={{ marginTop: 16 }}>
        {backdrop || art ? (
          <div className="title-hero-bg" style={{ backgroundImage: cssPoster(backdrop || art) }} />
        ) : null}
        <div className="title-hero-grid">
          {art ? (
            <img
              className="poster"
              src={art}
              alt=""
              onError={(e) => {
                const fallback = shikiPoster(anime.id);
                if (fallback && e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
              }}
            />
          ) : (
            <div className="poster" />
          )}
          <div>
            <h1>{displayName(anime.russian, anime.name)}</h1>
            {anime.name && anime.russian && anime.name !== anime.russian ? <p className="muted">{anime.name}</p> : null}
            <div className="meta-row">
              <span className="pill">
                <span className="score">{anime.score}</span>
              </span>
              {anime.rating ? <span className="pill">{anime.rating}</span> : null}
              <span className="pill">{kindLabel(anime.kind) || "TV"}</span>
              <span className="pill">{statusLabel(anime.status)}</span>
              {yearOf(anime.airedOn) ? <span className="pill">{yearOf(anime.airedOn)}</span> : null}
              {anime.episodes ? <span className="pill">{anime.episodes} эп.</span> : null}
              {anime.nextEpisodeAt || (anime.status === "ongoing" && anime.nextEpisode) ? (
                <span className="pill pill-next">след. {formatNextAir(anime.nextEpisodeAt, anime.nextEpisode)}</span>
              ) : null}
            </div>
            <div className="chips">
              {titleGenres(anime).map((g) => (
                <button
                  key={`${g.id}:${g.name}`}
                  className="chip chip-link"
                  type="button"
                  title={`Другие аниме: ${g.name}`}
                  onClick={() => void openGenre(g)}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <p className={`desc ${!descOpen && longDesc ? "clamp" : ""}`}>
              {anime.description || "Описание появится, когда будет доступно."}
            </p>
            {longDesc ? (
              <button className="text-btn" type="button" onClick={() => setDescOpen((v) => !v)}>
                {descOpen ? "Свернуть" : "Ещё"}
              </button>
            ) : null}
            <div className="toolbar">
              <button
                className="primary"
                type="button"
                disabled={!currentEp || !current}
                onClick={() => currentEp && play(currentEp)}
              >
                <span className="row">
                  <IconPlay />{" "}
                  {busy && !current
                    ? "Ищу озвучки…"
                    : continueAt && continueAt > 1
                      ? `Продолжить · ${continueAt} эп.`
                      : "Смотреть"}
                </span>
              </button>
              <button
                className="ghost"
                type="button"
                disabled={!currentEp || !current || opBusy}
                onClick={() => void downloadOpening()}
              >
                {opBusy ? "Опенинг…" : "Скачать опенинг"}
              </button>
              <button className="ghost" type="button" onClick={() => void toggleFav()}>
                <span className="row">
                  <IconHeart filled={fav} /> {fav ? "В избранном" : "В избранное"}
                </span>
              </button>
              {shikiOn ? (
                <>
                  <select
                    className="filter-select"
                    value={rate?.status || ""}
                    onChange={(e) => {
                      const status = e.target.value as ShikiListStatus | "";
                      if (!status) return;
                      void window.hikari
                        .setShikiRate(anime.id, { status })
                        .then(setRate)
                        .catch(() => undefined);
                    }}
                  >
                    <option value="">{rate ? "Список" : "На Шикимори"}</option>
                    <option value="watching">Смотрю</option>
                    <option value="planned">Запланировано</option>
                    <option value="completed">Просмотрено</option>
                    <option value="on_hold">Отложено</option>
                    <option value="dropped">Брошено</option>
                  </select>
                  <select
                    className="filter-select"
                    value={rate?.score || 0}
                    onChange={(e) => {
                      void window.hikari
                        .setShikiRate(anime.id, { score: Number(e.target.value) })
                        .then(setRate)
                        .catch(() => undefined);
                    }}
                  >
                    <option value={0}>Оценка</option>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
            {busy && !trs.length ? (
              <p className="muted">Ищу озвучки…</p>
            ) : current ? (
              <p className="muted">
                {current.title}
                {current.lastEpisode ? ` · ${current.lastEpisode} эп.` : ""}
                {trs.length > 1 ? ` · ещё ${trs.length - 1} в плеере` : ""}
              </p>
            ) : (
              <p className="empty">Нет озвучки и японского оригинала.</p>
            )}
          </div>
        </div>
      </div>
      {err ? <p className="error">{err}</p> : null}
      {opMsg ? <p className="muted">{opMsg}</p> : null}
      {related.length ? (
        <>
          <h3>Связанное</h3>
          <div className="rail">
            {related.slice(0, 16).map((row) => (
              <PosterCard
                key={`${row.relation}-${row.anime.id}`}
                title={catalogTitle(row.anime.russian, row.anime.name)}
                animeId={row.anime.id}
                poster={posterSrc(row.anime.poster, row.anime.posterLocal, row.anime.id)}
                badge={row.relation}
                onClick={() => props.onOpen(row.anime.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
