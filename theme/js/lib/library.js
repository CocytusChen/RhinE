"use strict";
// Media library index for the Archive view.
//
// Source: the media library; when it has no folders (or is empty) the contents of all playlists, so the view is useful
// without a configured library.
// Albums come from the SQLite cache at once (<profile>\audio-archive-cache\library.db, so the view can paint before
// the library has loaded) and then from the library worker (js/workers/library.js), which runs one batched
// title-format pass on its own thread; library changes re-run it after a short pause and only changed rows are
// written. Albums are grouped by genre, decade, artist initial or not at all, and sorted within each group by artist,
// title, year or date added. SHOW TRACKS lists every track as its own item instead (LIB.unit), with its album's cover.
// Covers: 256 px thumbnails with a blurred 48 px copy, made by the worker and cached on disk; at most THUMB_MAX are
// kept in memory (least recently drawn go first).

const LIB = { albums: [], groups: [], live: false, gen: 0, tracks: 0, ms: null, source: "library",
              groupBy: getSetting("archiveGroup", "genre"), sortBy: getSetting("archiveSort", "artist"),
              unit: getSetting("archiveUnit", "albums"), items: [], albumMap: new Map() };
const LIB_LISTENERS = [];   // fn(kind): "catalog" when the albums or groups changed, "cover" when a thumbnail arrived
const LIB_DB = fb.ProfilePath + "audio-archive-cache\\library.db";
let libHandles = null, libWorker = null, libTimer = 0;
const libNotify = kind => LIB_LISTENERS.forEach(f => f(kind));

function libStart() {
    if (utils.IsFile(LIB_DB)) {
        const db = utils.OpenDatabase(LIB_DB);
        if (db) {
            try { setAlbums(db.Query("SELECT data FROM albums").map(r => JSON.parse(r.data))); }
            catch (e) { console.log("audio-archive library cache: " + e); }
            finally { db.Close(); }
        }
    }
    libWorker = new Worker({ file: THEME_ROOT + "js\\workers\\library.js" }, "audio-archive-library");
    libWorker.onmessage = e => libMessage(e.data);
    libWorker.onerror = e => console.log("audio-archive library worker: " + e.message);
    libIndex();
}

// the theme's own playlists (lib/bus.js) are not part of the archive
function playlistItems() {
    const list = fb.CreateHandleList();
    for (let i = 0; i < plman.PlaylistCount; i++) if (!OWN_PLAYLISTS.has(plman.GetPlaylistName(i))) list.AddRange(plman.GetPlaylistItems(i));
    list.Sort();   // also removes duplicates
    return list;
}

// (re)index once the media library has loaded; fresh: look again for covers of albums known to have none
function libIndex(fresh = false) {
    window.ClearTimeout(libTimer);
    if (fresh === true) CUE_SHEETS.clear();   // Re-index library: read the CUE sheets again too
    let list = null;
    if (fb.IsLibraryEnabled()) {
        if (!fb.IsLibraryInitialised()) { libTimer = window.SetTimeout(() => libIndex(fresh), 500); return; }
        list = fb.GetLibraryItems();
    }
    LIB.source = list && list.Count ? "library" : "playlists";
    const gen = ++LIB.gen, post = handles => { libHandles = handles; libWorker.postMessage({ type: "index", gen, handles, fresh: fresh === true }); };
    withCueTracks(LIB.source === "library" ? list : playlistItems(), gen, post);
}

// CUE sheets. foobar2000's media library leaves *.CUE out by default (Preferences › Media Library › Exclude), so an
// album kept as one image file (WAV, FLAC, APE …) with a .cue beside it arrives as a single hour-long track. A long
// track is looked for in the .cue files of its folder (a FILE line naming it); when one names it, the sheet's tracks
// take its place (read by fb.AddLocationsAsync: no playlist is touched). When the sheet's tracks are listed already
// (the library includes .cue files, or they were added to a playlist), the image itself is left out.
// The scan runs in slices of about CUE_SLICE_MS between paints, so a large library of CUE albums never holds the panel
// up (1.7.1 read every folder in one go, and JSplitter called the panel unresponsive, #24). What a folder holds is kept
// for the session; a library change in a folder (or Re-index library) reads it again.
const CUE_MIN_S = 600;     // a file shorter than this is a track, not an album image
const CUE_SLICE_MS = 25;
const CUE_MAX_CHARS = 1 << 20;   // a CUE sheet is a few KB: anything bigger is not one
const CUE = { task: -1, gen: 0, base: null, post: null, timer: 0, images: null };
const CUE_SHEETS = new Map();    // folder (lower case, ending in \) -> [{ path, files }]
// the names a sheet's FILE lines give (lower case, each with and without its extension: a sheet may still name the
// file before it was converted)
function cueFileNames(text) {
    const files = new Set();
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
        if (!m) continue;
        const name = (m[1] || m[2]).replace(/^.*[\\/]/, "").toLowerCase();
        files.add(name); files.add(name.replace(/\.[^.]+$/, ""));
    }
    return files;
}
// A sheet that is not UTF-8 is in some Windows code page: often a Japanese or Chinese one (EAC writes the system's),
// which need not be this computer's. Read as UTF-8, such a sheet does not even show its FILE lines (JSplitter returns
// no replacement characters to look for), so each reading is tried in turn, UTF-8 first: the first whose FILE lines
// name files that are in the folder wins; with none, the first one that names any file stands.
const CUE_CODEPAGES = [65001, 0, 932, 936, 950, 949, 1252, 1251];
function cueSheetsIn(folder) {
    const key = folder.toLowerCase();
    if (CUE_SHEETS.has(key)) return CUE_SHEETS.get(key);
    const sheets = [];
    let here = null;   // the folder's files, lower case, with and without extension (read once)
    try {
        for (const path of utils.Glob(folder + "*.cue")) {
            if (!here) { here = new Set(); for (const p of utils.Glob(folder + "*")) { const n = p.slice(p.lastIndexOf("\\") + 1).toLowerCase(); here.add(n); here.add(n.replace(/\.[^.]+$/, "")); } }
            let files = null;
            for (const cp of CUE_CODEPAGES) {
                const text = utils.ReadTextFile(path, cp);
                if (text.length > CUE_MAX_CHARS) break;
                const f = cueFileNames(text);
                if (!files && f.size) files = f;
                if ([...f].some(n => here.has(n))) { files = f; break; }
            }
            if (files) sheets.push({ path, files });
        }
    } catch (e) { /* unreadable folder: no sheets */ }
    CUE_SHEETS.set(key, sheets);
    return sheets;
}
// a library change in these files' folders: read those folders' sheets again at the next index
function cueForget(handles) {
    if (!handles || !handles.Count) return;
    for (let i = 0; i < handles.Count; i++) { const p = handles[i].Path; CUE_SHEETS.delete(p.slice(0, p.lastIndexOf("\\") + 1).toLowerCase()); }
}
// post(list) once the long tracks have been looked for in their folders' sheets: list with the images replaced
function withCueTracks(list, gen, post) {
    window.ClearTimeout(CUE.timer);
    const n = list.Count, listed = new Set(), cands = [], drop = new Set(), sheets = new Set(), images = new Map(), t0 = Date.now();
    let i = 0, k = 0, folders = 0;
    const slice = () => {
        CUE.timer = 0;
        if (gen !== LIB.gen) return;   // a newer index has started
        const until = Date.now() + CUE_SLICE_MS;
        // 1: the listed sheets, and the long tracks with a path on disk
        for (; i < n && Date.now() < until; i++) {
            const h = list[i], p = h.Path;
            if (/\.cue$/i.test(p)) listed.add(p.toLowerCase());
            else if (h.Length >= CUE_MIN_S && /^([a-z]:\\|\\\\)/i.test(p)) cands.push([i, p]);
        }
        // 2: each long track's folder, read once
        for (; i >= n && k < cands.length && Date.now() < until; k++) {
            const [at, p] = cands[k], cut = p.lastIndexOf("\\"), name = p.slice(cut + 1).toLowerCase(), folder = p.slice(0, cut + 1);
            if (!CUE_SHEETS.has(folder.toLowerCase())) folders++;
            const sheet = cueSheetsIn(folder).find(s => s.files.has(name) || s.files.has(name.replace(/\.[^.]+$/, "")));
            if (!sheet) continue;
            drop.add(at);
            const sp = sheet.path.toLowerCase();
            if (listed.has(sp)) continue;
            sheets.add(sheet.path);
            (images.get(sp) || images.set(sp, []).get(sp)).push(list[at]);   // back in if the sheet gives no tracks
        }
        if (i < n || k < cands.length) { CUE.timer = window.SetTimeout(slice, 0); return; }
        if (cands.length) console.log(`audio-archive library: CUE check, ${cands.length} long tracks, ${folders} folders read, ${drop.size} images, ${Date.now() - t0} ms`);
        if (!drop.size) { post(list); return; }
        const base = fb.CreateHandleList();
        for (let j = 0; j < n; j++) if (!drop.has(j)) base.Add(list[j]);
        if (!sheets.size) { post(base); return; }
        Object.assign(CUE, { gen, base, post, images, task: fb.AddLocationsAsync([...sheets]) });
    };
    slice();
}
// on_locations_added, forwarded by the panel (stage.js): the sheets' tracks join the list
function libLocationsAdded(task, handles) {
    if (task !== CUE.task || CUE.gen !== LIB.gen) return false;
    // a sheet foobar2000 could not read (or whose FILE it could not find, e.g. a code page this computer does not use)
    // gives no tracks: its image stays an album of its own
    const got = new Set();
    for (let i = 0; i < handles.Count; i++) if (handles[i].Length > 0) got.add(handles[i].Path.toLowerCase());
    for (const [sp, imgs] of CUE.images) if (!got.has(sp)) for (const h of imgs) CUE.base.Add(h);
    CUE.base.AddRange(handles);
    CUE.base.Sort();
    CUE.post(CUE.base);
    CUE.task = -1; CUE.base = CUE.post = CUE.images = null;
    return true;
}
const libChanged = () => { window.ClearTimeout(libTimer); libTimer = window.SetTimeout(() => libIndex(), 1500); };
function on_library_items_added(handles) { cueForget(handles); libChanged(); }
function on_library_items_removed() { libChanged(); }
function on_library_items_changed(handles) { cueForget(handles); libChanged(); }
const playlistsChanged = () => { if (LIB.source === "playlists") libChanged(); };
function on_playlist_items_added(i) { plDirty(i); if (!OWN_PLAYLISTS.has(plman.GetPlaylistName(i))) playlistsChanged(); }
function on_playlist_items_removed(i) { plDirty(i); if (!OWN_PLAYLISTS.has(plman.GetPlaylistName(i))) playlistsChanged(); }
function on_playlists_changed() { plDirty(); playlistsChanged(); }

function libMessage(m) {
    if (m.gen !== LIB.gen) return;
    if (m.type === "catalog") {
        LIB.live = true; LIB.tracks = m.tracks; LIB.ms = m.ms;
        thumbPending.clear(); thumbAsked = "";
        setAlbums(m.albums, m.items);
        send("library", { files: m.tracks, albums: m.albums.length });
        console.log(`audio-archive library: ${m.tracks} tracks, ${m.albums.length} albums, index ${m.ms.index.toFixed(0)} ms, cache ${m.ms.cache.toFixed(0)} ms (${m.written} rows)`);
    } else if (m.type === "cover") {
        thumbPending.delete(m.key);
        if (m.img || LIB.live) THUMBS.set(m.key, m.img ? { img: m.img, blur: m.blur } : null);
        trimThumbs();
        libNotify("cover");
    }
}

// albums (and, once the worker has run, one item per track: they carry their album's number)
function setAlbums(albums, items = []) {
    albums.forEach(a => { a.no = 1 + parseInt(fnv(a.key), 16) % 9999; });
    LIB.albums = albums;
    LIB.albumMap = new Map(albums.map(a => [a.key, a]));
    items.forEach(t => { const a = LIB.albumMap.get(t.album); t.no = a ? a.no : 0; });
    LIB.items = items;
    groupAlbums();
}

const GROUP_BY = [["genre", "GENRE"], ["decade", "DECADE"], ["artist", "A–Z"], ["album", "ALBUM"], ["none", "NONE"]];
const SORT_BY = [["artist", "ARTIST"], ["title", "TITLE"], ["year", "YEAR"], ["added", "ADDED"]];
const GROUP_LABEL = { genre: "GENRE", decade: "DECADE", artist: "ARTIST", album: "ALBUM", none: "ALL" };
// a group's name as shown: the fixed ones and decades translated, genres as they are tagged, an album by its title (its
// group is keyed "TITLE\u0001ARTIST", so two albums of one title stay apart); a shelf's name, its groups' names joined
// (and a part's "2 / 3"), drops each one's artist alike
const groupName = g => g.includes("\u0001") ? g.replace(/\u0001.*?(?=  ·  |  \d+ \/ \d+$|$)/g, "") : /^\d{3}0S$/.test(g) ? tr("{0}S", g.slice(0, 4)) : tr(g);
function setGroupBy(by) {
    if (by === LIB.groupBy || !GROUP_LABEL[by]) return;
    LIB.groupBy = by;
    setSetting("archiveGroup", by);
    groupAlbums();
}
// ALBUMS or TRACKS: what the archive's cases and tiles stand for
function setUnit(u) {
    if (u === LIB.unit || (u !== "albums" && u !== "tracks")) return;
    LIB.unit = u;
    setSetting("archiveUnit", u);
    groupAlbums();
}
const showTracks = () => LIB.unit === "tracks" && LIB.items.length > 0;
const unitWord = n => tr(showTracks() ? (n === 1 ? "{0} TRACK" : "{0} TRACKS") : n === 1 ? "{0} ALBUM" : "{0} ALBUMS", fmtCount(n));
// the album a track item belongs to (an album is its own)
const albumOf = a => a && a.album ? LIB.albumMap.get(a.album) || null : a;
function setSortBy(by) {
    if (by === LIB.sortBy || !SORT_BY.some(([k]) => k === by)) return;
    LIB.sortBy = by;
    setSetting("archiveSort", by);
    groupAlbums();
}
// album order within a group; ties fall back to artist, then title
const lcs = s => String(s || "").toLowerCase();
const strCmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
function albumOrder(by) {
    // a track item goes by its album's artist and year, so the tracks of a soundtrack or a compilation (each with an
    // artist of its own) are not scattered across the group but stay together in disc / track order
    const of = p => albumOf(p) || p;
    const art = (p, q) => strCmp(lcs(of(p).artist), lcs(of(q).artist)), tit = (p, q) => strCmp(lcs(p.title), lcs(q.title));
    const yr = (p, q) => { const a = of(p).year, b = of(q).year; return (!a - !b) || strCmp(a, b); };   // undated last
    // tracks of one album stay in disc / track order where the order does not separate them
    const alb = (p, q) => p.album ? strCmp(p.album, q.album) || (p.ord - q.ord) : 0;
    if (by === "title") return (p, q) => tit(p, q) || art(p, q);
    if (by === "year") return (p, q) => yr(p, q) || art(p, q) || alb(p, q) || tit(p, q);
    if (by === "added") return (p, q) => (!p.added - !q.added) || strCmp(q.added, p.added) || art(p, q) || alb(p, q) || tit(p, q);   // newest first
    return (p, q) => art(p, q) || yr(p, q) || alb(p, q) || tit(p, q);
}

// The archive's search filter (the header's search field while the Archive is shown): every word must appear in the
// album's title, artist, genre or year, or in one of its tracks' titles and artists. The library worker sends that
// text, lower-cased, with each album; albums from the cache (before the worker has run) have their own fields only.
LIB.filter = "";
const searchText = a => a.text || (a.text = `${a.title} ${a.artist} ${a.genre || ""} ${a.year || ""}`.toLowerCase());
function setArchiveFilter(q) {
    q = String(q || "").trim().toLowerCase();
    if (q === LIB.filter) return;
    LIB.filter = q;
    groupAlbums();
}
onMessage("archive-filter", setArchiveFilter);
const filteredCount = () => LIB.groups.reduce((n, g) => n + g.albums.length, 0);

// groups: [{ name, albums }], sorted by name with the catch-all group last (album groups: in the order the albums are
// sorted in); each album also gets its group's name (a.grp), which the archive's shelves (several groups on one shelf)
// show. Grouped by album, each album is a group: with every track as its own item, its tracks make a shelf of their own.
function groupAlbums() {
    const by = LIB.groupBy, map = new Map(), albumOfGroup = new Map();
    const words = LIB.filter ? LIB.filter.split(/\s+/) : null;
    for (const a of showTracks() ? LIB.items : LIB.albums) {
        if (words) { const t = searchText(a); if (!words.every(w => t.includes(w))) continue; }
        let g;
        if (by === "none") g = "ALL ALBUMS";
        else if (by === "decade") g = /^\d{4}$/.test(a.year) ? a.year.slice(0, 3) + "0S" : "UNDATED";
        else if (by === "artist") { const c = String(a.artist || "").trim().charAt(0).toUpperCase(); g = /[A-Z]/.test(c) ? c : /\d/.test(c) ? "0–9" : "OTHER"; }
        else if (by === "album") { const al = albumOf(a) || a; g = `${al.title}\u0001${al.artist}`.toUpperCase(); if (!albumOfGroup.has(g)) albumOfGroup.set(g, al); }
        else g = String(a.genre || "").trim().toUpperCase() || "UNKNOWN";
        a.grp = g;
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(a);
    }
    const last = new Set(["UNDATED", "OTHER", "UNKNOWN"]), order = albumOrder(LIB.sortBy);
    LIB.groups = [...map.entries()]
        .sort(([x], [y]) => (by === "album" ? order(albumOfGroup.get(x), albumOfGroup.get(y)) : last.has(x) - last.has(y)) || strCmp(x, y))
        .map(([name, albums]) => ({ name, albums: albums.sort(order) }));
    libNotify("catalog");
}

// the album's tracks in disc / track order (null until the worker has indexed the library); a track item gives its
// album's
const TF_TRACK_ORDER = fb.TitleFormat("$num(%discnumber%,2)$num(%tracknumber%,4)%path%");
function albumHandles(a) {
    a = albumOf(a);
    if (!LIB.live || !a || !a.idx || !libHandles) return null;
    const list = fb.CreateHandleList();
    for (const i of a.idx) list.Add(libHandles[i]);
    list.OrderByFormat(TF_TRACK_ORDER, 1);
    return list;
}
const albumFirst = a => LIB.live && a && a.idx && libHandles ? libHandles[a.idx[0]] : null;
// a track item's own track (null for an album)
const itemTrack = a => a && a.album && LIB.live && libHandles ? libHandles[a.idx[0]] : null;

// ------------------------------------------------------------------------------------------------------ covers
// Thumbnails are keyed by album (a track item uses its album's: a.cover). THUMB_MAX grows with what the cover grid
// asks for (its screen and the screens around it), so covers fetched ahead of the scroll are not evicted again.
const THUMBS = new Map();   // album key -> { img, blur } or null (no artwork); insertion order = least recently used first
let THUMB_MAX = 160;
const thumbPending = new Set();
const THUMB_KEEP = new Set();   // keys drawn in the current frame are never evicted
const coverKey = a => a.cover || a.key;
const setThumbBudget = n => { THUMB_MAX = clamp(n, 160, 720); };

// the thumbnail of `a` if loaded (marks it as recently used); undefined while unknown
function thumbOf(a) {
    const k = coverKey(a), t = THUMBS.get(k);
    if (t !== undefined) { THUMBS.delete(k); THUMBS.set(k, t); THUMB_KEEP.add(k); }
    return t;
}
function trimThumbs() {
    for (const k of THUMBS.keys()) {
        if (THUMBS.size <= THUMB_MAX) break;
        if (!THUMB_KEEP.has(k)) THUMBS.delete(k);
    }
}
// asks the worker for the thumbnails of `albums` (nearest first, at most `max`) that are neither loaded nor on their way
let thumbAsked = "";
function requestThumbs(albums, max = 48) {
    const list = [], seen = new Set();
    for (const a of albums) {
        const k = coverKey(a);
        if (seen.has(k) || THUMBS.has(k) || thumbPending.has(k)) continue;
        seen.add(k);
        list.push({ key: k, i: a.idx ? a.idx[0] : -1 });
        if (list.length >= max) break;
    }
    const sig = list.map(j => j.key).join("");
    if (!list.length || sig === thumbAsked || !libWorker) return;
    thumbAsked = sig;
    // the worker replaces its queue, so whatever was pending and not asked again will not arrive
    thumbPending.clear();
    list.forEach(j => thumbPending.add(j.key));
    libWorker.postMessage({ type: "covers", gen: LIB.gen, list });
}
