/** Streaming embed providers (shown to users as generic "Server 1/2/..." —
 *  brand names are never displayed).
 *  - VidZee: player.vidzee.wtf/embed/movie/{tmdb} + /embed/tv/{tmdb}/{s}/{e}
 *    (both verified live). No URL params documented.
 *  - CineSrc: cinesrc.st/embed/movie/{tmdb} and query-style
 *    /embed/tv/{tmdb}?s={s}&e={e} (docs + both verified live). Supports
 *    ?t={seconds} start time (resume), autonext/auto-skip intros.
 *  - Peachify: peachify.top/embed/movie/{tmdb} + /embed/tv/{tmdb}/{s}/{e}
 *    (verified live). ?startAt= resume, autoNext, multi-source fallback.
 *    Anti-sandbox detection: MUST run unsandboxed; popups revoked via
 *    Permissions-Policy instead (denyPopups flag).
 *  - BingeR: bingr.one/watch/movie/{tmdb} + /watch/tv/{tmdb}/{s}/{e}
 *    (both verified live). Full site wrapping the FilmU multi-source
 *    engine (FilmU/Videasy/Cinezo/Vidbolt/Vidrift), subtitles, TV
 *    auto-next; noScroll crops their page chrome. Anti-sandbox ->
 *    unsandboxed + popups revoked. Fullscreen must stay ALLOWED: their
 *    player requests it during playback startup and breaks without it.
 *  - VidBolt: vidbolt.xyz/movie/{tmdb} + /tv/{tmdb}/{s}/{e} (verified;
 *    embed-only by design). Multi-AUDIO (Hindi/Tamil/English + more)
 *    switchable in-player; postMessage events feed resume tracking.
 *    FilmU-family -> unsandboxed + popups revoked, fullscreen allowed.
 *  - VidOut (id "netout"): vidout.pages.dev - Netout's BARE PLAYER (no
 *    profile gate, no site chrome): /watch/movie/{tmdb} + /tv/{tmdb}/S{s}/E{e}
 *    (both verified live). Multi-audio (Hindi/Tamil/Telugu/Kannada/English),
 *    Skip Intro, Episodes drawer; the site default player.
 *    Runs VidCore inside with in-player server options; one-time profile
 *    tap on first load; unsandboxed (flags cascade to VidCore) + popups
 *    revoked; noScroll crops their chrome.
 *  - MultiMovies (Server 8): the sources on multimovies.beer, embedded
 *    AS-IS (their player, not ours), in the site's own source order:
 *    Cineverse (cineverse.modiplay.xyz/embed/{slug} - slug-keyed,
 *    movies only; slugs mirror multimovies slugs and are derived
 *    from the TMDB title at runtime), GDMirror (their "Recommended"
 *    tag: streams.iqsmartgames.com/embed - the exact keyed player their
 *    page loads (key on movies + TV; keyed mode shows their library
 *    file view, e.g. the V4/V3 releases on Spider-Man), Nxsha
 *    (web.nxsha.app/embed - documented embed API, movies + TV),
 *    screenscape (screenscape.me/embed - documented embed API, movies
 *    + TV, Hindi audio by default), Multiverse
 *    (multiverse.modiplay.xyz/embed/{tmdb} + /embed/tv/{tmdb}/{s}/{e}
 *    - TMDB-keyed, movies + TV)
 *    and Vidout (vidout.pages.dev - movies + TV). NB: cineverse.
 *    pages.dev is an unrelated info-only demo and multiverse.pages.dev
 *    is dead (HTTP 500) - neither is the site's player, never use them.
 *  - MegaPlay: megaplay.buzz/stream/ani/{anilistId}/{ep}/{sub|dub} - the
 *    anime-only server ("Anime 1" pill); AniList id resolved from the TMDB
 *    title at watch time (src/lib/anilist.ts). Embed-only on their side;
 *    their player rejects the sandbox attr -> unsandboxed + popups
 *    revoked, same as the other anti-sandbox players.
 *  - PVRPlay: pvrplay.online/watch/movie/{tmdb} + /watch/tv/{tmdb}/{s}/{e}
 *    (both resolve live). Full streaming SITE rather than an embed API - no
 *    customization params, their page chrome shows inside the frame, and
 *    framing permission is not guaranteed (Electron strips any frame-block
 *    headers via FRAME_HOSTS; on the open web it depends on their headers).
 *  - WebStreamr (Server 9, vlcOnly): the WebStreamrMBG Stremio addon -
 *    direct HTTP sources (4KHDHub/HDHub4u/MovieBox/VidSrc/VidZee/VixSrc
 *    sites, HubCloud/GDFlix/... extractors), resolved per title via our
 *    /api/webstreamr routes. Tap a source and it plays in the inbuilt
 *    site player (SitePlayer: ArtPlayer-based, Multiverse-style UI with
 *    Download + Open-in-VLC controls); VLC handoff per platform
 *    (desktop: bundled vlc.exe; Android: vlc intent; iOS: vlc-x-callback;
 *    PC web: desktop-app bridge + copy-link) covers whatever the browser
 *    can't decode (HEVC/Dolby). No iframe - the resolver generates every
 *    playable link itself (redirect-following, cookie sessions,
 *    generator-page scraping, sibling-index fallback, quota checks).
 *    Truly uncrackable pages open in a new tab. New/cam releases may
 *    have zero sources (empty state).
 *  - NetMirror (Server 10, vlcOnly Hindi-OTT lane): Indian OTT rips via
 *    our /api/netmirror routes - direct signed mp4s (360-1080p) + caption
 *    tracks with Hindi subs auto-loaded, played in the inbuilt site player
 *    (HindiSources list, own :site-nm resume namespace). Netflix-direct is
 *    verified live; NewTV Hotstar/Prime/Disney fan-out best-effort.
 *  - DesiDDL (Server 11, no-iframe Hindi-DDL lane): VegaMovies +
 *    MoviesDrive + HDMovie2 (newhdmovie2.best -> hdm.im -> GDFlix) DDL
 *    posts via /api/desiddl - search, IMDb-hit verify, hub links opened
 *    embedded on tap (user generates the link, it auto-plays in the site
 *    player; DdlSources list, own :site-dd
 *    resume namespace). Ported from the Megix CSX CloudStream providers.
 *  (2026-09-09 prune: pills past 11 removed - free embeds + NetMirror
 *  Direct/Playlists. Their code stays in-tree; re-append entries to
 *  restore. Full map: docs/servers.md.)
 *  (Server 12 Castle added after the prune, by request - Hindi-first
 *  API lane. Full map: docs/hindi-providers.md.)
 *  (Servers 13/14: MoviesMod DDL lane + AutoPlay zero-tap lane.)
 *  (Server 15: Nuvio Hindi lane - XDMovies + HindMoviez.)
 *  (Server 16: MovieRulz slast embed.)
 *  (Server 17: Laika laika422mon embed.)
 *  (Server 18: Licensed Anime - the licensors' own YouTube channels
 *   (Muse Asia / Ani-One Asia / Gundam Channel INTL) resolved per title
 *   and played in YouTube's own player. Anime-only pill "Anime 2 ·
 *   Official"; details in docs/licensed-anime.md.)
 *  (Server 19: StreamFlizo Anime - TMDB-native anime streaming API with
 *   multi-audio support (sub/dub/multi). Anime-only pill "Anime 3";
 *   endpoints: /stream/tmdb/{tmdb}/multi for movies and
 *   /stream/tmdb/{tmdb}/{season}/{episode}/multi for TV series.)
 *  (Server 20: 8StreamApi - Self-hosted Indian dubbed content API with
 *   Hindi/Tamil/Telugu/Bengali support. Requires backend deployment
 *   (GitHub: himanshu8443/8StreamApi) and custom API route implementation.
 *   Uses IMDB IDs with 2-step resolution: mediaInfo → getStream.)
 *  (Server 21: ScarperApi - Multi-source scraper API (KMMovies, NetMirror,
 *   AnimeSalt) with API key auth. Requires self-hosting (GitHub:
 *   junioralive/ScarperApi) and custom API route implementation.)
 *  (Server 22: 2Embed - embed-based Hindi dubbed lane with auto-updating
 *   links, 1080p quality, fully responsive player. Uses 2embed.online API:
 *   /embed/movie/{id} and /embed/tv/{id}/{season}/{episode}. No API key
 *   required. Works with Hindi-dubbed movies and series.)
 *  (Server 23: Videm - embed-based Hindi dubbed lane with automatic failover,
 *   quality & audio selection, subtitles, built for mobile. Uses videm.xyz API:
 *   /embed/movie/{id} and /embed/tv/{id}/{season}/{episode}. No API key
 *   required. Works with Hindi-dubbed movies and series.)
 *  (Server 24: HDHub - vlcOnly Hindi dubbed FSL/Pixeldrain lane - the watch
 *   page renders HindiSources with endpoint=/api/hdhub/stream; stubs never
 *   called). Combined HDHub + WebStreamr addon: FSLv2, Pixeldrain, HubCloud,
 *   4KHDHub, 10Gbps direct downloads with Hindi/English/Multi-Audio tracks.
 *   Fetches from both hdhub.thevolecitor.qzz.io and WebStreamr for maximum
 *   content availability. 2160p/1080p/720p/480p available. Uses IMDB/TMDB IDs
 *   via Stremio protocol. Hindi audio preferred in streams (DDP 2.0 Hindi +
 *   English DDP 5.1 dual). All formats playable in flexible embed player with
 *   audio language switching and download capability.)
 *  (Server 25: AllInOne (embed.filmu.in) - Free video embed API with TMDB ID
 *   support for movies/series and AniList ID support for anime. General server
 *   for all content types. Simple iframe embed with autoplay support. Verified
 *   endpoints: /movie/{tmdbId}, /tv/{tmdbId}/{season}/{episode}, and
 *   /anime/{anilistId}/{season}/{episode} for anime content. Anti-sandbox:
 *   MUST run unsandboxed; popups revoked via Permissions-Policy instead
 *   (denyPopups flag). Fullscreen allowed. Provides multi-server streaming with
 *   Hindi/regional content options. No API key required.)
 *  (Server 24: HDHub - vlcOnly Hindi dubbed FSL/Pixeldrain lane - the watch
 *   page renders HindiSources with endpoint=/api/hdhub/stream; stubs never
 *   called). Combined HDHub + WebStreamr addon: FSLv2, Pixeldrain, HubCloud,
 *   4KHDHub, 10Gbps direct downloads with Hindi/English/Multi-Audio tracks.
 *   Fetches from both hdhub.thevolecitor.qzz.io and WebStreamr for maximum
 *   content availability. 2160p/1080p/720p/480p available. Uses IMDB/TMDB IDs
 *   via Stremio protocol. Hindi audio preferred in streams (DDP 2.0 Hindi +
 *   English DDP 5.1 dual). All formats playable in flexible embed player with
 *   audio language switching and download capability.)
 *  (Server 25: AllInOne (embed.filmu.in) - Free video embed API with TMDB ID
 *   support for movies/series and AniList ID support for anime. General server
 *   for all content types. Simple iframe embed with autoplay support. Verified
 *   endpoints: /movie/{tmdbId}, /tv/{tmdbId}/{season}/{episode}, and
 *   /anime/{anilistId}/{season}/{episode} for anime content. Anti-sandbox:
 *   MUST run unsandboxed; popups revoked via Permissions-Policy instead
 *   (denyPopups flag). Fullscreen allowed. Provides multi-server streaming with
 *   Hindi/regional content options. No API key required.)
 *  To add another server later, append an entry to PROVIDERS — the watch
 *  page shows a server switcher automatically when there is more than one. */

/** a named player inside a multi-player server (Server 8 embeds the
 *  multimovies.beer players this way - their players, TMDB-keyed) */
export type EmbedSubPlayer = {
  id: string;
  name: string; /* chip label (e.g. "Cineverse") */
  /** movies-only player - hidden on TV titles */
  movieOnly?: boolean;
  /** slug-keyed player (Cineverse): the watch page passes a slugified
   *  TMDB title as the id instead of the TMDB id */
  slugTitle?: boolean;
  /** iframe armor overrides (undefined = inherit the provider's).
   *  sandbox: false forces unsandboxed, a string forces that sandbox
   *  token list (PLAYER_SANDBOX for the default no-popups sandbox). */
  sandbox?: false | string;
  denyPopups?: boolean;
  noScroll?: boolean;
  denyFullscreen?: boolean;
  /** send no Referer from the frame (referrerPolicy="no-referrer") -
   *  for hotlink-guarded file hosts that allow empty referers but block
   *  unknown origins. */
  noReferrer?: boolean;
  movie: (id: string) => string;
  tv: (id: string, season: number, episode: number) => string;
};

export type EmbedProvider = {
  id: string;
  name: string;
  /** sub-players: when set, the watch page shows a player picker row
   *  and embeds the selected player instead of movie()/tv() */
  players?: EmbedSubPlayer[];
  /** prefer IMDb id (via TMDB external_ids) when available */
  prefersImdb?: boolean;
  /** query param name that sets the start time in seconds, if supported */
  startParam?: string;
  /** sandbox token list; overrides PLAYER_SANDBOX for this provider.
   *  false = no sandbox at all (last resort for anti-sandbox players). */
  sandbox?: false | string;
  /** render the iframe with scrolling="no" - for full-site providers whose
   *  inner page shows its own scrollbar and swallows wheel events (breaks
   *  scrolling of the host page). Inner page becomes unscrollable; wheel
   *  chains back to Yetflix. */
  noScroll?: boolean;
  /** add "popups 'none'" to the iframe Permissions-Policy - for unsandboxed
   *  providers (anti-sandbox players) so window.open dies without needing
   *  the sandbox attribute they reject. */
  denyPopups?: boolean;
  /** only show this provider on anime titles (watch page filters the pills) */
  animeOnly?: boolean;
  /** VLC server (WebStreamr): no iframe - the watch page renders the
   *  addon's source list and hands picked links to the installed VLC.
   *  movie()/tv() stubs below are never called. */
  vlcOnly?: boolean;
  /** pill label override (default "Server N") */
  label?: string;
  /** drop "fullscreen" from the iframe allow list - for players that
   *  auto-fullscreen the moment you press play; the Fullscreen API is
   *  denied to that frame entirely so playback stays inline. */
  denyFullscreen?: boolean;
  /** send no Referer from the frame (referrerPolicy="no-referrer") -
   *  for hotlink-guarded file hosts that allow empty referers but block
   *  unknown origins. */
  noReferrer?: boolean;
  movie: (id: string) => string;
  tv: (id: string, season: number, episode: number) => string;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** WordPress-style slug ("Spider-Man: Brand New Day" ->
 *  "spider-man-brand-new-day"). Cineverse embeds are slug-keyed and
 *  their slugs mirror multimovies slugs, so the watch page derives
 *  this from the TMDB title at runtime. */
export const slugify = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** default iframe armor: no popups, no modals, no top-navigation hijack.
 *  NB: omitting allow-popups is what REALLY kills popups (window.open
 *  returns null even on a user tap); the "popups 'none'" allow token is
 *  only a hint some engines honor. Unsandboxed providers rely on the
 *  browser's own popup blocker instead. */
export const PLAYER_SANDBOX =
  "allow-scripts allow-same-origin allow-downloads allow-forms allow-pointer-lock";

/** GDMirror site key: fixed site-wide (same key serves every title).
 *  BOTH movies + TV carry it: keyless/key-mismatched loads fall back to
 *  a generic third-party server lineup, while the keyed player shows
 *  their real library file view (verified 2026-09-08: Spider-Man 969681
 *  + Fight Club 550 serve their release files with the key). */
const GDMIRROR_KEY = "e11a7debaaa4f5d25b671706ffe4d2acb56efbd4";

export const PROVIDERS: EmbedProvider[] = [
  {
    id: "vidzee",
    name: "VidZee",
    movie: (id) => `https://player.vidzee.wtf/embed/movie/${id}`,
    tv: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "cinesrc",
    name: "CineSrc",
    startParam: "t",
    movie: (id) => `https://cinesrc.st/embed/movie/${id}`,
    tv: (id, s, e) => `https://cinesrc.st/embed/tv/${id}${qs({ s, e })}`,
  },
  {
    id: "peachify",
    name: "Peachify",
    startParam: "startAt",
    /* unsandboxed + popups revoked: their player rejects any sandbox, so
     * popup ads are killed via Permissions-Policy instead */
    denyPopups: true,
    /* anti-sandbox detection: every sandbox token config was rejected -
     * this provider requires a fully unsandboxed iframe. Popup/top-nav
     * threats are handled OUTSIDE the iframe instead: Electron (EasyList
     * blocker + popup guard on every webContents); browsers use their own
     * popup blockers. */
    sandbox: false,
    movie: (id) => `https://peachify.top/embed/movie/${id}${qs({ color: "E50914" })}`,
    tv: (id, s, e) =>
      `https://peachify.top/embed/tv/${id}/${s}/${e}${qs({ color: "E50914", autoNext: "true" })}`,
  },
  {
    id: "bingr",
    name: "BingeR",
    /* verified live: bingr.one/watch/movie/{tmdb} + /watch/tv/{tmdb}/{s}/{e}.
     * Full site with an integrated multi-source player (FilmU engine;
     * FilmU/Videasy/Cinezo/Vidbolt/Vidrift backends), subtitles, TV
     * auto-next + built-in episode list. noScroll: their page has content
     * below the player - crop it like PVRPlay so the iframe never shows
     * its own scrollbar or swallows wheel events. */
    noScroll: true,
    /* their FilmU engine shows "Playback blocked" under ANY sandbox
     * (same anti-sandbox class as Peachify) - must run unsandboxed.
     * Popup ads are still killed: "popups 'none'" on the iframe
     * Permissions-Policy + in the exe the EasyList blocker and the
     * deny-all window.open guard on every frame. */
    denyPopups: true,
    /* NB: fullscreen MUST stay allowed - their FilmU engine requests it
     * as part of its playback startup; denying it (denyFullscreen test)
     * broke playback outright. The auto-fullscreen-on-play behavior is
     * inherent to this player. */
    sandbox: false,
    movie: (id) => `https://bingr.one/watch/movie/${id}`,
    tv: (id, s, e) => `https://bingr.one/watch/tv/${id}/${s}/${e}`,
  },
  {
    id: "pvrplay",
    name: "PVRPlay",
    /* full site: their page scrollbar + wheel capture breaks host scrolling */
    noScroll: true,
    movie: (id) => `https://pvrplay.online/watch/movie/${id}`,
    tv: (id, s, e) => `https://pvrplay.online/watch/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidbolt",
    name: "VidBolt",
    /* docs: vidbolt.xyz - /movie/{tmdb} + /tv/{tmdb}/{s}/{e} (both routes
     * verified; embed-only by design - direct-tab playback is refused on
     * their side, which is exactly our use). Multi-AUDIO player: Hindi,
     * Tamil, English and more switchable inside the player - perfect for
     * the India-first catalog. Documented postMessage events
     * (ready/play/pause/timeupdate/ended) feed the resume tracker.
     * Same player family as BingeR's FilmU engine (it was one of its
     * backends) -> ships unsandboxed + popups revoked, the config that
     * family needs; fullscreen allowed (their startup uses it). */
    denyPopups: true,
    sandbox: false,
    movie: (id) => `https://vidbolt.xyz/movie/${id}`,
    tv: (id, s, e) => `https://vidbolt.xyz/tv/${id}/${s}/${e}`,
  },
  {
    /* id kept as "netout" for saved-prefs stability; the player itself
     * is VIDOUT (vidout.pages.dev) - Netout's bare player deployment.
     * Verified live: NO profile gate, Netflix-style chrome, Skip Intro,
     * Episodes drawer, Speed & Quality - and MULTI-AUDIO (Hindi, Tamil,
     * Telugu, Kannada, English seen on GOT) - ideal India-first default.
     * Routes (verified): movie /watch/movie/{tmdb} (served direct);
     * series/anime /tv/{tmdb}/S{s}/E{e} (canonical - /watch/tv/{id}/{s}/{e}
     * redirects there). Unsandboxed (this player family rejects sandbox
     * flags) + popups revoked; noScroll crops the description section
     * below the player. */
    id: "netout",
    name: "VidOut",
    denyPopups: true,
    sandbox: false,
    noScroll: true,
    movie: (id) => `https://vidout.pages.dev/watch/movie/${id}`,
    tv: (id, s, e) => `https://vidout.pages.dev/tv/${id}/S${s}/E${e}`,
  },
  {
    /* Server 8 - the multimovies.beer sources, embedded as-is (their
     * player), in the site's own source order. Nxsha + screenscape +
     * Vidout + GDMirror + Multiverse are TMDB-keyed (verified live
     * 2026-09-08); only Cineverse is slug-keyed (/embed/{slug}, slugs
     * mirror multimovies slugs). Same iframe armor throughout
     * (unsandboxed + popups revoked + noScroll): sandboxing was tried
     * on GDMirror and reverted - their player refuses to play
     * sandboxed. Sub-player armor overrides still supported. */
    id: "multimovies",
    name: "MultiMovies",
    denyPopups: true,
    sandbox: false,
    noScroll: true,
    players: [
      {
        /* REAL Cineverse: cineverse.modiplay.xyz/embed/{slug} - their
         * backend (verified 2026-09-08: /embed/obsession and
         * /embed/spider-man-brand-new-day serve the full player: 7
         * in-player servers, multi-audio, EN/HI/... subs). The watch
         * page passes a slugified TMDB title (slugTitle). Movies only
         * - no TV addressing found on their side. NB: the old
         * cineverse.pages.dev URL was a wrong, unrelated info-only
         * demo - never use it. */
        id: "cineverse",
        name: "Cineverse",
        movieOnly: true,
        slugTitle: true,
        movie: (slug) => `https://cineverse.modiplay.xyz/embed/${slug}`,
        tv: () => "",
      },
      {
        /* GDMIRROR (their "Recommended" tag): the EXACT player their
         * page loads - streams.iqsmartgames.com/embed/movie/{tmdb}
         * + /embed/tv/{tmdb}/{s}/{e}, both with the fixed site key
         * (verified 2026-09-08: this is the Request URL their own
         * GDMirror option makes). Keyed mode shows their real library
         * file view (Spider-Man 969681: V4 HEVC + V3 x264 releases;
         * Fight Club 550; Breaking Bad S1:E1 incl. Hindi-dubbed). Keyless
         * loads only get a generic third-party lineup - never drop the
         * key. Their /evid/{per-title-token} iframe wraps this same
         * backend (rpmshare mirror servers). No frame block. */
        id: "gdmirror",
        name: "GDMirror",
        /* NB: runs UNSANDBOXED like its Server 8 siblings - their player
         * breaks under any sandbox, so the sandbox experiment was
         * reverted (their ad popups are the price on the open web: the
         * browser's popup blocker + COOP same-origin blunt them; the
         * desktop app denies them outright at the network level). */
        movie: (id) => `https://streams.iqsmartgames.com/embed/movie/${id}?key=${GDMIRROR_KEY}`,
        tv: (id, s, e) =>
          `https://streams.iqsmartgames.com/embed/tv/${id}/${s}/${e}?key=${GDMIRROR_KEY}`,
      },
      {
        /* https://web.nxsha.app/embed docs: /embed/movie/{tmdb} +
         * /embed/tv/{tmdb}/{s}/{e} (TMDb or IMDb ids); multi-server
         * fallback + multi-lang in-player. Verified: Fight Club (550)
         * + Game of Thrones S1:E1 (1399/1/1) resolve by title. */
        id: "nxsha",
        name: "Nxsha",
        movie: (id) => `https://web.nxsha.app/embed/movie/${id}`,
        tv: (id, s, e) => `https://web.nxsha.app/embed/tv/${id}/${s}/${e}`,
      },
      {
        /* https://screenscape.me/embed docs: /embed?tmdb={id}&type=movie
         * + &type=tv&s={s}&e={e}; Hindi audio by default. Verified:
         * Spider-Man: Brand New Day (969681) resolves by title. */
        id: "screenscape",
        name: "screenscape",
        movie: (id) => `https://screenscape.me/embed?tmdb=${id}&type=movie`,
        tv: (id, s, e) => `https://screenscape.me/embed?tmdb=${id}&type=tv&s=${s}&e=${e}`,
      },
      {
        /* REAL Multiverse: multiverse.modiplay.xyz/embed/{tmdb} +
         * /embed/tv/{tmdb}/{s}/{e} - TMDB-keyed, movies + TV (verified
         * 2026-09-08: /embed/969681 renders "Spider-Man: Brand New Day
         * (2026)", /embed/550 "Fight Club (1999)", /embed/tv/1396/1/1
         * "Breaking Bad - S01E01": ArtPlayer 5.1.7, Hindi default
         * audio, HubCloud/GDFlix/Backup servers). NB: /embed/{slug}
         * only serves a static demo shell (renders even for bogus
         * slugs - never use it), /embed/{id}/{s}/{e} without the /tv/
         * segment redirects to their cover page, and the old
         * multiverse.pages.dev URL was wrong/dead - never use it. */
        id: "multiverse",
        name: "Multiverse",
        movie: (id) => `https://multiverse.modiplay.xyz/embed/${id}`,
        tv: (id, s, e) => `https://multiverse.modiplay.xyz/embed/tv/${id}/${s}/${e}`,
      },
      {
        id: "vidout",
        name: "Vidout",
        movie: (id) => `https://vidout.pages.dev/watch/movie/${id}`,
        tv: (id, s, e) => `https://vidout.pages.dev/tv/${id}/S${s}/E${e}`,
      },
    ],
    /* stubs (a sub-player always resolves, and Start over preserves
     * the picked one - these are never embedded; Nxsha because it is
     * TMDB-keyed like the signature expects) */
    movie: (id) => `https://web.nxsha.app/embed/movie/${id}`,
    tv: (id, s, e) => `https://web.nxsha.app/embed/tv/${id}/${s}/${e}`,
  },
  {
    /* Server 9 - WebStreamr (vlcOnly, see the header doc): movie()/tv()
     * are never called - the watch page renders VlcSources instead. */
    id: "webstreamr",
    name: "WebStreamr",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 10 - NetMirror (vlcOnly Hindi-OTT lane, no iframe - the watch
     * page renders HindiSources instead; stubs never called). Indian OTT
     * rips (Netflix/Hotstar/Prime/Disney) via our /api/netmirror routes:
     * direct signed mp4s + caption tracks, Hindi subs auto-loaded.
     * Verified live 2026-09-09: Fight Club 550 + RRR 579974 + Breaking
     * Bad 1396 S01E01 all exact-match with 360-1080p files. NewTV
     * Hotstar/Prime/Disney fan-out is code-complete but unverified. */
    id: "netmirror",
    name: "NetMirror",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 11 - DesiDDL (no-iframe Hindi-DDL lane - the watch page
     * renders DdlSources instead; stubs never called). VegaMovies +
     * MoviesDrive dual-audio posts (the Hindi blogs Server 9 doesn't
     * scrape) via our /api/desiddl routes: Typesense search, IMDb-hit
     * verify, nexdrive intermediates -> G-Direct / V-Cloud / HubCloud
     * links opened embedded on tap (user generates, file auto-plays).
     * Full chain re-verified live 2026-09-09 (Fight Club 1999 posts,
     * Lanterns S01 post, nexdrive + vcloud + hubcloud + GDFlix). HDMovie2
     * (newhdmovie2.best -> hdm.im -> GDFlix) rides the same lane (blog
     * tag "HDMovie2"). */
    id: "desiddl",
    name: "DesiDDL",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 12 - Castle (vlcOnly Hindi-first API lane - the watch page
     * renders HindiSources with endpoint=/api/castle/stream; stubs never
     * called). CastleTV app backend (api.hlowb.com, channel IndiaA):
     * search -> details -> getVideo2 (AES-128-CBC via WebCrypto), Hindi
     * track preferred + one fallback, 1080p/720p/480p + subtitle
     * tracks; own :site-cs resume namespace. Search + details decrypt
     * verified live 2026-09-09; the playback step is a verbatim port of
     * the TMDB-Embed-API provider with stage diagnostics for live debug
     * (full map: docs/hindi-providers.md). */
    id: "castle",
    name: "Castle",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 13 - MoviesMod (vlcOnly Hindi-dubbed DDL lane - the watch
     * page renders HindiSources with endpoint=/api/moviesmod/stream;
     * stubs never called). MoviesMod WP blog (moviesmod.zone): Dual /
     * Multi Audio Hindi WEB-DL + BluRay, 480p-2160p, movies + series.
     * Chain: blog search -> similarity+year match -> post page (h4 per
     * quality / h3 Season episode buttons) -> modrefer.in / modpro.blog
     * -> driveseed direct (fast path) or tech.* SID dance -> file page
     * -> Instant Download / Worker Bot / Direct / Resume Cloud final
     * CDN (workers.dev / r2 / video-leech -> GDrive unwrap). Hindi-ish
     * posts preferred; files are dual/multi-audio so no captions.
     * Ported from the NuvioStreamsAddon moviesmod provider + its
     * linkResolver (Feb 2026), blog verified alive 2026-09-09; playback
     * is a verbatim port with stage diagnostics for live debug. */
    id: "moviesmod",
    name: "MoviesMod",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 14 - AutoPlay (vlcOnly zero-tap lane - the watch page renders
     * AutoSources; stubs never called). WebStreamr with no taps: searches
     * the addon, ranks direct-file/Hindi/browser-friendly rows, resolves
     * and plays the best in SmartPlayer (ArtPlayer + hls.js + dash.js:
     * HLS/DASH/progressive, in-player quality/audio/server/subtitle
     * selectors, VLC + Download), auto-advancing on dead links. The
     * in-player source panel stays as the manual override. */
    id: "autoplay",
    name: "AutoPlay",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 15 - Nuvio (vlcOnly Hindi lane - the watch page renders
     * HindiSources with endpoint=/api/nuvio/stream; stubs never
     * called). XDMovies (search API + exact tmdb_id match -> HubCloud
     * FSL / HubCDN / Pixeldrain / StreamTape finals) + HindMoviez
     * (title search -> maxbutton/get-links/a.btn -> full extractor),
     * movies + series. Ported from phisher98/phisher-nuvio-providers. */
    id: "nuvio",
    name: "Nuvio",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 16 - MovieRulz embed (their slast player, verified live
     * 2026-09-09): slast430did.com/play/{imdb} - IMDb-keyed, movies +
     * TV on the SAME url (full in-player season/episode/audio
     * navigation incl. Hindi; Breaking Bad renders S1-S5 + 7 eps).
     * Framing open (no X-Frame-Options/CSP on their responses),
     * no Referer gate (renders with none). Default sandbox armor;
     * fullscreen allowed (player startup may need it). NB: slast*
     * is a rotating mirror family - if it dies, re-point at the
     * current iframe host movierrulz.com embeds. */
    id: "movierulz",
    name: "MovieRulz",
    prefersImdb: true,
    /* Ad armor: stock sandbox already kills popups + top-nav hijack;
     * drop allow-downloads (no drive-by "player update" zips), revoke
     * popups via Permissions-Policy too, send no referrer (starves
     * referer-gated ad tags). allow-same-origin KEPT: the slast API
     * + CDN need a real origin for their fetches. */
    sandbox: "allow-scripts allow-same-origin allow-forms allow-pointer-lock",
    denyPopups: true,
    noReferrer: true,
    movie: (id) => `https://slast430did.com/play/${id}`,
    tv: (id) => `https://slast430did.com/play/${id}`,
  },
  {
    /* Server 17 - Laika (replaces the Movieland lane): raw IndStream
     * player embed on laika422mon.com (same backend family as Server
     * 16's slast430did.com - verified 2026-09-09: BB tt0903747 S1-S5
     * + tt33094114 S2 render full players with Hindi audio). IMDb-keyed,
     * movies + TV same URL, in-player S/E. Same ad armor as 16. */
    id: "laika",
    name: "Laika",
    prefersImdb: true,
    sandbox: "allow-scripts allow-same-origin allow-forms allow-pointer-lock",
    denyPopups: true,
    noReferrer: true,
    movie: (id) => `https://laika422mon.com/play/${id}`,
    tv: (id) => `https://laika422mon.com/play/${id}`,
  },
  {
    /* Server 18 - Licensed Anime (vlcOnly lane - the watch page renders
     * LicensedAnimeSources; stubs never called). Resolves the title to
     * episodes on the RIGHTSHOLDERS' OWN YouTube channels - Muse Asia
     * (MUSE Communication Singapore, the SEA/India simulcast licensee),
     * Ani-One Asia (MediaLink HK) and Gundam Channel INTL
     * (Sunrise/Bandai Namco) - via /api/licensedanime/stream, then
     * embeds YouTube's privacy-enhanced player so the view counts for
     * the licensor. Matching is title-similarity + episode-number based
     * (src/lib/licensedanime.ts); set YOUTUBE_API_KEY to use the Data
     * API instead of the HTML channel-search fallback. Catalogue is
     * per-title and territorial, so misses are normal and the lane
     * shows an explicit empty state rather than guessing. */
    id: "licensedanime",
    name: "Licensed Anime",
    animeOnly: true,
    label: "Anime 2 · Official",
    vlcOnly: true,
    movie: () => "",
    tv: () => "",
  },
  {
    id: "megaplay",
    name: "MegaPlay",
    /* anime-only server (pill label: "Anime 1", shown only on anime
     * titles - the watch page filters the pills). Full HiAnime-library
     * embed (megaplay.buzz/api). TMDB carries no AniList ids, so the
     * watch page resolves the title via AniList GraphQL search and builds
     * /stream/ani/{anilistId}/{ep}/sub itself - the stubs below are never
     * called. Direct navigation is disabled on their side: embed-only,
     * which is exactly our use. */
    animeOnly: true,
    label: "Anime 1",
    /* their player hard-rejects the sandbox attribute ("Opss! Sandboxed
     * our player is not allowed. Remove sandbox to use it.") ->
     * unsandboxed + popups revoked, same treatment as Peachify/BingeR. */
    denyPopups: true,
    sandbox: false,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 19 - StreamFlizo Anime (anime-only server - pill label:
     * "Anime 3", shown only on anime titles). TMDB-native anime streaming
     * API with multi-audio support (sub/dub/multi options). Verified
     * endpoints: /stream/tmdb/{tmdb}/multi for movies and
     * /stream/tmdb/{tmdb}/{season}/{episode}/multi for TV series/anime.
     * Default sandbox armor; fullscreen allowed. Multi-language subtitle
     * support with low-latency adaptive streaming up to 1080p/60fps. */
    id: "streamflizo",
    name: "StreamFlizo",
    animeOnly: true,
    label: "Anime 3",
    movie: (id) => `https://streamflizoapi.top/stream/tmdb/${id}/multi`,
    tv: (id, s, e) => `https://streamflizoapi.top/stream/tmdb/${id}/${s}/${e}/multi`,
  },
  {
    /* Server 20 - 8StreamApi (vlcOnly Hindi/regional lane - the watch page
     * renders HindiSources with endpoint=/api/8stream/stream; stubs never
     * called). Self-hosted API providing Indian dubbed content (Hindi,
     * Tamil, Telugu, Bengali). Uses IMDB IDs with 2-step resolution:
     * mediaInfo endpoint returns file+key, then POST to getStream returns
     * the actual stream URL. Multi-language audio tracks available.
     * Requires self-hosting the 8StreamApi backend (GitHub:
     * himanshu8443/8StreamApi) - endpoints: /api/v1/mediaInfo?id={imdb},
     * /api/v1/getSeasonList?id={imdb} (TV), /api/v1/getStream (POST).
     * Implementation notes: src/app/api/8stream/route.ts needed to handle
     * the 2-step resolution and return playable URLs to the inbuilt player. */
    id: "8stream",
    name: "8Stream",
    vlcOnly: true,
    label: "8Stream",
    prefersImdb: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 21 - ScarperApi (vlcOnly multi-source lane - the watch page
     * renders HindiSources with endpoint=/api/scarper/stream; stubs never
     * called). Comprehensive scraper API supporting KMMovies (Bollywood,
     * Hollywood, dubbed movies), NetMirror, AnimeSalt, and more. Requires
     * API key authentication (x-api-key header) and self-hosting the
     * ScarperApi backend (GitHub: junioralive/ScarperApi). Endpoints:
     * /api/kmmovies, /api/kmmovies/search?q={query}, /api/kmmovies/details,
     * /api/kmmovies/magiclinks for download/stream links. Multi-quality
     * (480p-4K) with Hindi/regional audio tracks. Implementation notes:
     * src/app/api/scarper/route.ts needed to handle API auth, search,
     * details resolution, and return playable URLs to the inbuilt player. */
    id: "scarper",
    name: "Scarper",
    vlcOnly: true,
    label: "Scarper",
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 22 - 2Embed (embed-based Hindi dubbed lane - renders as
     * standard iframe embed, NOT HindiSources). Uses 2embed.online API:
     * /embed/movie/{id} and /embed/tv/{id}/{season}/{episode}
     * Features: auto-updates links, 1080p quality, fully responsive player.
     * No API key required. Works with Hindi-dubbed movies and series. */
    id: "embed2",
    name: "2Embed",
    movie: (id) => `https://www.2embed.online/embed/movie/${id}`,
    tv: (id, s, e) => `https://www.2embed.online/embed/tv/${id}/${s}/${e}`,
  },
  {
    /* Server 23 - Videm (embed-based Hindi dubbed lane - renders as
     * standard iframe embed, NOT HindiSources). Uses videm.xyz API:
     * /embed/movie/{id} and /embed/tv/{id}/{season}/{episode}
     * Features: automatic failover, quality & audio selection, subtitles,
     * built for mobile, no API key required.
     * Works with Hindi-dubbed movies and series. */
    id: "videm",
    name: "Videm",
    movie: (id) => `https://videm.xyz/embed/movie/${id}`,
    tv: (id, s, e) => `https://videm.xyz/embed/tv/${id}/${s}/${e}`,
  },
  {
    /* Server 24 - HDHub (vlcOnly Hindi dubbed FSL/Pixeldrain lane - the watch
     * page renders HindiSources with endpoint=/api/hdhub/stream; stubs never
     * called). Combined HDHub + WebStreamr addon: FSLv2, Pixeldrain, HubDrive,
     * HubCloud, 4KHDHub, 10Gbps direct downloads with Hindi/English/Multi-Audio
     * tracks.
     * Fetches from both hdhub.thevolecitor.qzz.io and WebStreamr for maximum
     * content availability. 2160p/1080p/720p/480p available. Uses IMDB/TMDB IDs
     * via Stremio protocol. Hindi audio preferred in streams (DDP 2.0 Hindi +
     * English DDP 5.1 dual). All formats playable in flexible embed player with
     * audio language switching and download capability. */
    id: "hdhub",
    name: "HDHub",
    vlcOnly: true,
    label: "Server 24 · HDHub",
    prefersImdb: true,
    movie: () => "",
    tv: () => "",
  },
  {
    /* Server 25 - AllInOne (embed.filmu.in) - Free video embed API with
     * TMDB ID support for movies/series and AniList ID support for anime.
     * Simple iframe embed with autoplay support.
     * Verified endpoints: /movie/{tmdbId}, /tv/{tmdbId}/{season}/{episode},
     * and /anime/{anilistId}/{season}/{episode} for anime content.
     * For anime titles, the watch page resolves AniList IDs via AniList GraphQL
     * (src/lib/anilist.ts) and uses the /anime/ endpoint; for regular TV series,
     * it uses the /tv/ endpoint with TMDB IDs.
     * Anti-sandbox: MUST run unsandboxed; popups revoked via
     * Permissions-Policy instead (denyPopups flag). Fullscreen allowed.
     * Provides multi-server streaming with Hindi/regional content options.
     * No API key required. General server for all content types. */
    id: "filmu",
    name: "AllInOne",
    label: "AllInOne",
    sandbox: false,
    denyPopups: true,
    movie: (id) => `https://embed.filmu.in/movie/${id}`,
    tv: (id, s, e) => `https://embed.filmu.in/tv/${id}/${s}/${e}`,
  },
  {
  id: "hubstream",
  name: "HubStream",
  label: "HubStream",
  sandbox: false,      // anti-sandbox player (like Peachify, BingeR)
  denyPopups: true,    // popups killed via Permissions-Policy
  noReferrer: true,    // avoids hotlink blocks
  movie: (id) => `https://hubstream.art/#movie-${id}`,
  tv: (id, s, e) => `https://hubstream.art/#tv-${id}-${s}-${e}`,
},
  {
    /* Server 26 - M2Box (vlcOnly lane - the watch page renders HindiSources
     * with endpoint=/api/m2box/stream; stubs never called). m2box.org (the
     * MovieBox web build) plays DIRECT signed MP4/HLS CDN streams through
     * its own origin-proxied BFF - our route mirrors exactly that chain:
     * title index from their public catalogs (home + trending; anonymous
     * keyword search is token-walled), similarity + year match on slugs/titles,
     * detail?detailPath -> subject/play (browser UA + title-page Referer are
     * REQUIRED or play answers hasResource:false), rows mapped like the addon
     * lanes. Movies play at se=0&ep=0; series use resource.seasons[]
     * (se starts at 1) with a fallback to the requested numbers. Covers
     * movies + series + anime (subjectType 2). 3-minute result cache
     * because play is rate-limited upstream. */
    id: "m2box",
    name: "M2Box",
    vlcOnly: true,
    label: "Server 26 · M2Box",
    movie: () => "",
    tv: () => "",
  },
];

export const getProvider = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export function embedUrl(
  provider: EmbedProvider,
  type: "movie" | "tv",
  id: number | string,
  opts: { s?: number; e?: number; startAt?: number } = {}
) {
  const base =
    type === "movie" ? provider.movie(String(id)) : provider.tv(String(id), opts.s ?? 1, opts.e ?? 1);
  const startAt =
    provider.startParam && opts.startAt && opts.startAt > 5 ? Math.floor(opts.startAt) : undefined;
  if (!startAt) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${provider.startParam}=${startAt}`;
}

/* ── Player postMessage events ──────────────────────────────────────────────
 * CineSrc documents loadedmetadata/ended/etc events (no periodic time
 * event); VidZee documents none. The parser stays
 * generic (JSON string or object, deep time-field scan) so continue-watching
 * tracking works automatically if/when they emit them.
 * NB: "progress" (%-fields) and epoch-ms "timestamp" fields are never read
 * as playback seconds. */

export type PlayerTime = { time: number; duration?: number; ended?: boolean; paused?: boolean };

const TIME_KEYS = [
  "currentTime", "current_time", "currenttime", "time", "position", "seconds", "elapsed",
];
const DURATION_KEYS = ["duration", "totalDuration", "total_duration", "length"];
const PLAYER_HOSTS = ["vidzee", "cinesrc", "peachify", "bingr", "pvrplay", "vidbolt", "netout", "vidout", "megaplay", "modiplay", "nxsha", "screenscape", "iqsmartgames", "netmirror", "slast", "laika", "streamflizoapi", "8-stream-api", "screenscapeapi", "filmu"];
/** playback seconds can never reach this; epoch-ms "timestamp" fields do */
const MAX_PLAUSIBLE_SECONDS = 1e7;

function scan(obj: unknown, depth = 0): Partial<PlayerTime> {
  if (!obj || typeof obj !== "object" || depth > 3) return {};
  const out: Partial<PlayerTime> = {};
  const rec = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    const kl = k.toLowerCase();
    if (kl === "timestamp") continue; // epoch-ms, not playback time
    if (TIME_KEYS.includes(kl) && typeof v === "number" && v >= 0 && v < MAX_PLAUSIBLE_SECONDS && out.time === undefined)
      out.time = v;
    else if (DURATION_KEYS.includes(kl) && typeof v === "number" && v > 0) out.duration = v;
    else if (kl === "type" || kl === "event" || kl === "eventname") {
      const s = String(v).toLowerCase();
      if (s.includes("end") || s.includes("complete")) out.ended = true;
      if (s.includes("pause")) out.paused = true;
    } else if (typeof v === "object") {
      const nested = scan(v, depth + 1);
      if (out.time === undefined && nested.time !== undefined) out.time = nested.time;
      if (out.duration === undefined && nested.duration !== undefined) out.duration = nested.duration;
      if (nested.ended) out.ended = true;
      if (nested.paused) out.paused = true;
    }
  }
  return out;
}

/** Extract playback time from a player postMessage event, if it is one */
export function parsePlayerEvent(event: MessageEvent): PlayerTime | null {
  if (typeof event.origin === "string" && !PLAYER_HOSTS.some((h) => event.origin.includes(h))) return null;
  let data: any = event.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const parsed = scan(data);
  return parsed.time !== undefined ? (parsed as PlayerTime) : null;
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};
