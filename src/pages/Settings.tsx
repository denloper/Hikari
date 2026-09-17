import { useEffect, useRef, useState } from "react";
import type { AppConfig, OpeningGroup, ShikiAccount, UpdateState } from "../../shared/types";
import { IconFolder } from "../components/icons";
import { STUDIO_PRESETS, studiosMatch } from "../lib/studio";

function updateHint(state: UpdateState, version: string): string {
  if (state.status === "checking") return "Проверяю GitHub…";
  if (state.status === "available") return `Найдена ${state.version}. Скачиваю…`;
  if (state.status === "downloading") return `Скачиваю ${state.version} — ${state.percent ?? 0}%`;
  if (state.status === "ready") return `Hikari ${state.version} скачана. Перезапустите, чтобы поставить.`;
  if (state.status === "none") return version === "dev" ? "В режиме разработки обновления не ставятся." : "Это последняя версия.";
  if (state.status === "error") return state.error || "Не удалось проверить обновление.";
  return "Проверка при старте и каждые 6 часов. Можно запустить вручную.";
}

export function SettingsPage(props: { onOpenTheme?: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [account, setAccount] = useState<ShikiAccount | null>(null);
  const [saved, setSaved] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [code, setCode] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const opacityTimer = useRef(0);
  const searchTimer = useRef(0);
  const [opQuery, setOpQuery] = useState("");
  const [opGroups, setOpGroups] = useState<OpeningGroup[]>([]);
  const [opBusy, setOpBusy] = useState(false);
  const [opErr, setOpErr] = useState("");

  useEffect(() => {
    void window.hikari.getConfig().then(setCfg);
    void window.hikari.getShikiAccount().then(setAccount);
    void window.hikari.getAppVersion().then(setAppVersion);
    void window.hikari.getUpdateState().then(setUpdate);
    return window.hikari.onUpdateState(setUpdate);
  }, []);

  if (!cfg) return <div className="page">Загрузка настроек…</div>;
  const current = cfg;

  async function save() {
    const next = await window.hikari.saveConfig(current);
    setCfg(next);
    setSaved("Сохранено");
    window.setTimeout(() => setSaved(""), 2200);
  }

  async function login() {
    setLoginBusy(true);
    setLoginErr("");
    try {
      await save();
      setAccount(await window.hikari.shikiLogin());
    } catch (ex) {
      setLoginErr(ex instanceof Error ? ex.message : "Не удалось войти");
    } finally {
      setLoginBusy(false);
    }
  }

  async function loginCode() {
    if (!code.trim()) return;
    setLoginBusy(true);
    setLoginErr("");
    try {
      await save();
      setAccount(await window.hikari.shikiLoginWithCode(code.trim()));
      setCode("");
    } catch (ex) {
      setLoginErr(ex instanceof Error ? ex.message : "Неверный код");
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <p>Ключи лежат только в %APPDATA%\Hikari.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <h3>Обновления</h3>
          <p className="hint">Сейчас стоит {appVersion || "…"}. Новые версии приходят с GitHub Releases.</p>
          <p className="hint">{updateHint(update, appVersion)}</p>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button className="ghost" type="button" onClick={() => void window.hikari.checkForUpdate()}>
              Проверить
            </button>
            {update.status === "ready" ? (
              <button className="primary" type="button" onClick={() => void window.hikari.installUpdate()}>
                Перезапустить и поставить
              </button>
            ) : null}
          </div>
        </section>
        <section className="settings-card">
          <h3>Shikimori</h3>
          <div className="field">
            <label>User-Agent</label>
            <p className="hint">Имя OAuth-приложения на shikimori.one/oauth/applications</p>
            <input
              value={cfg.shikimoriUserAgent}
              onChange={(e) => setCfg({ ...cfg, shikimoriUserAgent: e.target.value })}
              placeholder="Hikari"
            />
          </div>
          <div className="field">
            <label>Client ID</label>
            <input
              value={cfg.shikimoriClientId}
              onChange={(e) => setCfg({ ...cfg, shikimoriClientId: e.target.value })}
              placeholder="из карточки приложения"
            />
          </div>
          <div className="field">
            <label>Client Secret</label>
            <input
              type="password"
              value={cfg.shikimoriClientSecret}
              onChange={(e) => setCfg({ ...cfg, shikimoriClientSecret: e.target.value })}
              placeholder="из карточки приложения"
            />
          </div>
          <p className="hint">
            Redirect URI приложения: <code>http://127.0.0.1:36511/oauth</code>. Scope: user_rates.
          </p>
          {account ? (
            <div className="toolbar">
              <span className="saved">Вошли как {account.nickname}</span>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  void window.hikari.shikiLogout().then(() => setAccount(null));
                }}
              >
                Выйти
              </button>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button className="primary" type="button" disabled={loginBusy} onClick={() => void login()}>
                  {loginBusy ? "Жду браузер…" : "Войти через браузер"}
                </button>
              </div>
              <div className="field">
                <label>Или вставить код</label>
                <div className="row">
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code из адреса после входа" />
                  <button className="ghost" type="button" disabled={loginBusy} onClick={() => void loginCode()}>
                    Войти
                  </button>
                </div>
              </div>
            </>
          )}
          {loginErr ? <p className="error">{loginErr}</p> : null}
        </section>
        <section className="settings-card">
          <h3>Оформление</h3>
          <p className="hint">Тёмная и светлая тема, свой акцент и насыщенность — как палитра в Discord.</p>
          <button className="primary" type="button" onClick={() => props.onOpenTheme?.()}>
            Настроить тему
          </button>
        </section>
        <section className="settings-card">
          <h3>Картинка в картинке</h3>
          <div className="field">
            <label>Прозрачность окна</label>
            <p className="hint">Действует сразу на открытый PiP. 0% — обычное окно, 80% — почти стекло.</p>
            <div className="range-row">
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={100 - (cfg.pipOpacity ?? 100)}
                onChange={(e) => {
                  const pipOpacity = Math.min(100, Math.max(20, 100 - (Number(e.target.value) || 0)));
                  setCfg({ ...cfg, pipOpacity });
                  window.clearTimeout(opacityTimer.current);
                  opacityTimer.current = window.setTimeout(() => {
                    void window.hikari.getConfig().then((disk) => window.hikari.saveConfig({ ...disk, pipOpacity }));
                  }, 200);
                }}
              />
              <span>{100 - (cfg.pipOpacity ?? 100)}%</span>
            </div>
          </div>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={cfg.pipSkipButtons !== false}
                onChange={(e) => {
                  const pipSkipButtons = e.target.checked;
                  setCfg({ ...cfg, pipSkipButtons });
                  void window.hikari.getConfig().then((disk) => window.hikari.saveConfig({ ...disk, pipSkipButtons }));
                }}
              />
              Скип на 10 секунд (−10 / +10)
            </label>
            <p className="hint">Кнопки в PiP при наведении. Стрелки клавиатуры делают то же самое.</p>
          </div>
        </section>
        <section className="settings-card">
          <h3>Фоновый опенинг</h3>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={cfg.ambientOpEnabled}
                onChange={(e) => {
                  const ambientOpEnabled = e.target.checked;
                  setCfg({ ...cfg, ambientOpEnabled });
                  void window.hikari.getConfig().then((disk) => window.hikari.saveConfig({ ...disk, ambientOpEnabled }));
                }}
              />
              Играть опенинг в фоне
            </label>
            <p className="hint">Пока смотрите серию — опенинга нет. Источник: AnimeThemes.</p>
          </div>
          <div className="field">
            <label>Найти опенинг</label>
            <input
              value={opQuery}
              onChange={(e) => {
                const q = e.target.value;
                setOpQuery(q);
                window.clearTimeout(searchTimer.current);
                if (q.trim().length < 2) {
                  setOpGroups([]);
                  setOpErr("");
                  return;
                }
                searchTimer.current = window.setTimeout(() => {
                  setOpBusy(true);
                  setOpErr("");
                  void window.hikari
                    .searchOpenings(q.trim())
                    .then((groups) => {
                      setOpGroups(groups);
                      if (!groups.length) setOpErr("Не нашёл опенинг с аудио.");
                    })
                    .catch(() => setOpErr("AnimeThemes не ответил."))
                    .finally(() => setOpBusy(false));
                }, 400);
              }}
              placeholder="название тайтла, например Frieren"
            />
            {opBusy ? <p className="hint">Ищу…</p> : null}
            {opErr ? <p className="hint">{opErr}</p> : null}
            <div className="op-results">
              {opGroups.map((group) => (
                <div key={group.animeTitle} className="op-group">
                  <strong>{group.animeTitle}</strong>
                  <div className="op-list">
                    {group.tracks.map((track) => (
                      <button
                        key={track.id}
                        className={`chip${cfg.ambientOpUrl === track.audioUrl ? " active" : ""}`}
                        type="button"
                        onClick={() => {
                          const patch = {
                            ambientOpEnabled: true,
                            ambientOpTitle: track.animeTitle,
                            ambientOpLabel: track.label,
                            ambientOpUrl: track.audioUrl
                          };
                          setCfg({ ...cfg, ...patch });
                          void window.hikari.getConfig().then((disk) => window.hikari.saveConfig({ ...disk, ...patch }));
                        }}
                      >
                        {track.label}
                        {track.song ? ` · ${track.song}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {cfg.ambientOpTitle ? (
              <p className="hint">
                Сейчас: {cfg.ambientOpTitle}
                {cfg.ambientOpLabel ? ` — ${cfg.ambientOpLabel}` : ""}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label>Громкость</label>
            <div className="range-row">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cfg.ambientOpVolume ?? 35}
                onChange={(e) => {
                  const ambientOpVolume = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                  setCfg({ ...cfg, ambientOpVolume });
                  void window.hikari.getConfig().then((disk) => window.hikari.saveConfig({ ...disk, ambientOpVolume }));
                }}
              />
              <span>{cfg.ambientOpVolume ?? 35}%</span>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <h3>Discord</h3>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={cfg.discordRpc}
                onChange={(e) => setCfg({ ...cfg, discordRpc: e.target.checked })}
              />
              Показывать статус в Discord
            </label>
            <p className="hint">Друзья видят тайтл и серию. Discord должен быть запущен на ПК.</p>
          </div>
        </section>
        <section className="settings-card">
          <h3>Плеер</h3>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={cfg.adblock}
                onChange={(e) => setCfg({ ...cfg, adblock: e.target.checked })}
              />
              Блокировать рекламу
            </label>
            <p className="hint">
              Баннеры и трекеры в Kodik, Яндекс.Директ, AdFox. EasyList подгружается в фоне.
            </p>
          </div>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={cfg.episodeNotify}
                onChange={(e) => setCfg({ ...cfg, episodeNotify: e.target.checked })}
              />
              Уведомлять о новых сериях
            </label>
            <p className="hint">Смотрю на Шикимори и избранное. Первый проход только запоминает текущий эп.</p>
          </div>
          <div className="field">
            <label>Любимая студия</label>
            <p className="hint">Её озвучка выбирается сама, если нет своей истории по тайтлу.</p>
            <input
              value={cfg.preferredStudio}
              onChange={(e) => setCfg({ ...cfg, preferredStudio: e.target.value })}
              placeholder="AniLibria, AniDUB…"
            />
            <div className="chips" style={{ marginTop: 8 }}>
              {STUDIO_PRESETS.map((name) => (
                <button
                  key={name}
                  className={`chip ${studiosMatch(cfg.preferredStudio, name) ? "active" : ""}`}
                  type="button"
                  onClick={() => setCfg({ ...cfg, preferredStudio: studiosMatch(cfg.preferredStudio, name) ? "" : name })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="settings-card">
          <h3>Загрузки</h3>
          <div className="field">
            <label>Папка по умолчанию</label>
            <p className="hint">Серии кладутся сюда без диалога. Пусто — Видео\Hikari.</p>
            <div className="row">
              <input value={cfg.downloadFolder} readOnly placeholder="Видео\Hikari" />
              <button
                className="ghost"
                type="button"
                onClick={async () => {
                  const folder = await window.hikari.pickDownloadFolder();
                  if (folder) setCfg({ ...cfg, downloadFolder: folder });
                }}
              >
                <span className="row">
                  <IconFolder /> Обзор
                </span>
              </button>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <h3>Субтитры</h3>
          <div className="field">
            <label>Папка ASS / SRT</label>
            <p className="hint">Автопоиск файла вида id_номер.ass рядом с серией.</p>
            <div className="row">
              <input value={cfg.subtitleFolder} readOnly placeholder="не выбрана" />
              <button
                className="ghost"
                type="button"
                onClick={async () => {
                  const folder = await window.hikari.pickSubtitleFolder();
                  if (folder) setCfg({ ...cfg, subtitleFolder: folder });
                }}
              >
                <span className="row">
                  <IconFolder /> Обзор
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => void save()}>
          Сохранить
        </button>
        {saved ? <span className="saved">{saved}</span> : null}
      </div>
    </div>
  );
}
