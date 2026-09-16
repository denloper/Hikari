import { useEffect, useState } from "react";
import type { ContinueItem, DownloadItem, DownloadStatus, LibraryItem, ShikiAccount, WatchStats } from "../../shared/types";
import { ContinueRail } from "../components/ContinueCard";
import { PosterCard, SkeletonGrid } from "../components/PosterCard";

function Shelf(props: { title: string; items: LibraryItem[]; onOpen: (id: number) => void }) {
  if (!props.items.length) return null;
  return (
    <>
      <h2>{props.title}</h2>
      <div className="rail">
        {props.items.slice(0, 16).map((it) => (
          <PosterCard
            key={`${props.title}-${it.animeId}`}
            title={it.title}
            animeId={it.animeId}
            poster={it.poster}
            score={it.score}
            subtitle={[it.episode ? `эп. ${it.episode}` : "", it.translationTitle].filter(Boolean).join(" · ")}
            onClick={() => props.onOpen(it.animeId)}
          />
        ))}
      </div>
    </>
  );
}

function dlLabel(status: DownloadStatus): string {
  if (status === "queued") return "в очереди";
  if (status === "downloading") return "качаю";
  if (status === "done") return "готово";
  return "ошибка";
}

export function LibraryPage(props: { onOpen: (id: number) => void; onPlayContinue: (item: ContinueItem) => void }) {
  const [fav, setFav] = useState<LibraryItem[]>([]);
  const [hist, setHist] = useState<LibraryItem[]>([]);
  const [cont, setCont] = useState<ContinueItem[]>([]);
  const [watching, setWatching] = useState<LibraryItem[]>([]);
  const [planned, setPlanned] = useState<LibraryItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [account, setAccount] = useState<ShikiAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    void (async () => {
      setFav(await window.hikari.getFavorites());
      setHist(await window.hikari.getHistory());
      setCont(await window.hikari.getContinueWatching().catch(() => []));
      setDownloads(await window.hikari.listDownloads().catch(() => []));
      setStats(await window.hikari.getWatchStats().catch(() => null));
      const acc = await window.hikari.getShikiAccount();
      setAccount(acc);
      if (acc) {
        try {
          const [w, p] = await Promise.all([
            window.hikari.getShikiList("watching"),
            window.hikari.getShikiList("planned")
          ]);
          setWatching(w);
          setPlanned(p);
        } catch (ex) {
          setErr(ex instanceof Error ? ex.message : "Списки Шикимори недоступны");
        }
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    return window.hikari.onDownloadsChanged(() => {
      void window.hikari.listDownloads().then(setDownloads).catch(() => undefined);
    });
  }, []);

  const empty = ready && !fav.length && !hist.length && !watching.length && !planned.length && !downloads.length && !cont.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Библиотека</h1>
          <p>
            {account
              ? `Полки на этом ПК и списки ${account.nickname}.`
              : "Избранное и история на этом компьютере."}
          </p>
        </div>
      </div>
      {stats ? (
        <div className="stats-strip">
          <div>
            <strong>{stats.hours}</strong>
            <span>часов</span>
          </div>
          <div>
            <strong>{stats.episodes}</strong>
            <span>серий</span>
          </div>
          <div>
            <strong>{stats.titles}</strong>
            <span>тайтлов</span>
          </div>
          <div>
            <strong>{stats.completed}</strong>
            <span>просмотрено</span>
          </div>
        </div>
      ) : null}
      {err ? <p className="error">{err}</p> : null}
      {!ready ? <SkeletonGrid count={8} /> : null}
      {ready && downloads.length ? (
        <>
          <div className="section-head">
            <h2>Скачанное</h2>
            <button className="ghost" type="button" onClick={() => void window.hikari.openDownloadFolder()}>
              Папка
            </button>
          </div>
          <div className="download-list">
            {downloads.map((row) => (
              <button
                key={row.id}
                className="download-row"
                type="button"
                disabled={row.status !== "done"}
                onClick={() => void window.hikari.openDownload(row.id)}
              >
                <span className="name">{row.filename}</span>
                <span className={`dl-status ${row.status}`}>{row.error || dlLabel(row.status)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {ready && cont.length ? (
        <>
          <h2>Продолжить</h2>
          <ContinueRail items={cont} onPlay={props.onPlayContinue} />
        </>
      ) : null}
      {ready ? <Shelf title="Избранное" items={fav} onOpen={props.onOpen} /> : null}
      {ready && account ? <Shelf title="Смотрю" items={watching} onOpen={props.onOpen} /> : null}
      {ready && account ? <Shelf title="Запланировано" items={planned} onOpen={props.onOpen} /> : null}
      {ready ? <Shelf title="История" items={hist} onOpen={props.onOpen} /> : null}
      {empty ? (
        <div className="empty-card">
          <p className="empty" style={{ padding: 0 }}>
            Пока пусто — добавьте тайтл сердечком на карточке.
          </p>
        </div>
      ) : null}
    </div>
  );
}
