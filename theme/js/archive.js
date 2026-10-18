"use strict";
// 01 · ARCHIVE, drawn by the stage panel (stage.js includes this file).
//
//   left   the archive array: rendered specimen cases standing on shelves, shelves receding up-left. Every shelf has
//          the same number of slots: the groups (genre, decade, artist initial or none) follow one another along
//          the shelves, a small group sharing a shelf with the next, a large one continuing on
//          the next shelf. Each shelf keeps its own selection and lifts a
//          wave around it; the selected case decrypts frost → clear and gets corner marks and a leader to its ARC
//          number. Below: ALBUM / SELECT numeral, album index (navigation), shelf switcher. Click the selected case
//          (or Enter) to inspect it: the case is lifted straight up out of its row, then turns square-on in front
//          (and goes back the same way).
//   right  the album file, two pages (the two dots at the bottom, or L):
//            FILE    eyebrow, bracketed album number, format chip, title plate, artist, profile table, first tracks,
//                    PLAY ALBUM / OPEN ALBUM, ghost row name
//            TRACKS  every track of the album with its rating (click the marks; lib/rating.js), scrolled with the
//                    wheel; a click on a row plays the album from it, so nothing has to be opened in a playlist
// Each case is one pre-rendered sprite (frost and clear) with the cover mapped into its window underneath
// (case.json: quads and axes); inactive rows use tinted copies of the sprite made once per tint level and mode.

const AR_ST = {
    eyebrow: { size: 9, weight: 500, track: .14 },
    eyebrowB: { size: 9, weight: 700, track: .14 },
    head: { size: 13, weight: 600, track: .12 },
    artist: { size: 13, weight: 500, track: .06 },
    meta: { size: 10, weight: 500, track: .12 },
    key: { size: 8.5, weight: 500, track: .12 },
    btn: { size: 11, weight: 600, track: .1 },
    sel: { size: 9, weight: 500, track: .14 },
    group: { size: 13, weight: 700, track: .14 },
    plate: { size: 9, weight: 600, track: .06 },
    insp: { size: 10, weight: 600, track: .12 },
    inspM: { size: 9, weight: 500, track: .12 },
    more: { size: 10, weight: 500, track: .12 },
};
const AS = .54;                    // array sprite px → dp (the renders are 2× for sharpness)
const PITCH = 1.0, ROWP = 4.7;     // case spacing along a row and between rows, in case.json axis units
const CLOSE = [.45, -.62, .64];    // "towards the viewer", for back-to-front sorting
const INFO_W = 456, ARCHIVE_PLAYLIST = "Archive · Album";
const LIFT_OUT = 2.2;              // how far the inspected case rises out of its row, in case.json axis units
const INSP_LIFT = .32, INSP_TURN = .72, INSPECT_ZOOM = 2.05;   // stage durations (s); size at the end of the turn

const HOVER_MODES = ["outline", "label", "none"];
const AR = {
    group: 0,
    rows: new Map(),               // row index -> { sel, scroll, pos, cases: Map(i -> { lift, clear, gap }) }
    selKey: new Map(),             // row name -> the album selected on it
    selAlbum: "",                  // key of the selected album (survives re-indexing, regrouping and the layout switch)
    wantKey: "",                   // a selection waiting for its item to be listed (see placeSelection)
    hover: -1, hoverTick: -1, hits: [], from: [0, 0], infoHover: -1,
    rulerDrag: false,              // the album index held down: the album under the mouse is named, a release selects it
    insp: 0, inspOn: false,        // inspection timeline: 0 in the row · 1 lifted out · 2 square-on in front
    selRoll: Roll("01"), groupRoll: Roll("01"), noRoll: Roll("0000"),
    title: null, tracks: { key: "", rows: [], total: 0 },
    page: getSetting("archiveInfoPage", "file") === "tracks" ? "tracks" : "file",   // the album file's page
    list: null, listVer: 0, listScroll: 0, listMax: 0, listKey: "",   // the TRACKS page: its rows, their scroll
    rateHover: null, mouseX: 0,   // { i, n }: the rating under the mouse (previewed); the mouse's x (wheel over the file)
    rulerStart: Spring(0, 14), ticks: new Map(),
    dirtyInfo: true, info: null,
    topTitles: getSetting("caseTopTitles", true) !== false,   // the titles on the cases' top edges (the context menu)
    shelfPerGroup: getSetting("shelfPerGroup", true) !== false,   // each group starts a shelf of its own (the context menu)
    hoverRow: -1,   // the shelf (row index) of the case under the mouse (AR.hover): the selected one or any other
    hoverMode: HOVER_MODES.includes(getSetting("caseHover", "outline")) ? getSetting("caseHover", "outline") : "outline",   // the case under the mouse: outlined, titled or left as is (the context menu)
    infoPlates: [],     // the info plates to draw this frame, over every shelf: the selected case's, and one going
    hoverPlate: null,   // the case to label this frame (hoverMode "label"): drawn after the shelf, over its neighbours
};
let ARCHIVE_ON = false;
const PICK = { steps: null, t: 0, after: false };   // RANDOM PICK's run (see randomPick)
try { AR.selAlbum = String(JSON.parse(getSetting("archiveSel", "{}")).key || ""); } catch (e) { /* none */ }

// ------------------------------------------------------------------------------------------------------ shelves
// The array's rows are shelves of SHELF_MIN to SHELF_MAX cases. A group of up to SHELF_MAX stands on one shelf; a
// larger one is shared out evenly over as few shelves as hold it (45: 23 + 22, never 30 + 15 or 20 + 20 + 5). By
// default each group starts a shelf of its own. With "Each group on its own shelf" off (the context menu) a group that
// fits beside the ones before it (SHELF_MAX in all) joins their shelf, and a shelf left short of SHELF_MIN is topped up
// from the next group before that one goes on to shelves of its own (the shelf's name below the array and the file
// panel say which group a case belongs to). A shelf's rail is as long as its cases, SHELF_MIN slots at least.
// shelf: { name, albums, slot (each album's slot), slots, segs: [{ gi, name, from, n, slot, part, parts, total }] }
// The grid's sections are the plain groups; both layouts share the selected album.
const SHELF_MIN = 10, SHELF_MAX = 30;
let SHELVES = [], SHELF_SPAN = SHELF_MIN;   // SHELF_SPAN: the longest shelf's slots (the ultrawide array's spacing)
function buildShelves() {
    const out = [], parts = new Map();
    let cur = null;
    const open = () => { cur = { albums: [], slot: [], slots: 0, segs: [], used: 0 }; out.push(cur); };
    // n cases of group g, from its case `from` on, onto the current shelf
    const put = (g, gi, from, n) => {
        const seg = { gi, name: g.name, from: cur.albums.length, n, slot: cur.used, total: g.albums.length };
        for (let k = 0; k < n; k++) { cur.albums.push(g.albums[from + k]); cur.slot.push(seg.slot + k); }
        cur.used += n;
        cur.segs.push(seg);
        if (!parts.has(gi)) parts.set(gi, []);
        parts.get(gi).push(seg);
    };
    LIB.groups.forEach((g, gi) => {
        const N = g.albums.length;
        let i = 0;
        if (!AR.shelfPerGroup && cur) {
            if (cur.used + N <= SHELF_MAX) { put(g, gi, 0, N); return; }   // beside the groups before it
            // a short shelf is topped up (the rest is then more than SHELF_MIN: N > SHELF_MAX - used)
            if (cur.used < SHELF_MIN) { i = SHELF_MIN - cur.used; put(g, gi, 0, i); }
        }
        // the rest on shelves of its own, shared out evenly
        const left = N - i, k = Math.ceil(left / SHELF_MAX);
        for (let s = 0; s < k; s++) { const n = Math.floor(left / k) + (s < left % k ? 1 : 0); open(); put(g, gi, i, n); i += n; }
    });
    for (const list of parts.values()) list.forEach((s, k) => { s.part = k + 1; s.parts = list.length; });
    out.forEach(s => {
        s.slots = Math.max(SHELF_MIN, s.used);
        const one = s.segs[0];
        s.name = s.segs.length > 1 ? s.segs.map(g => g.name).join("  ·  ") : one ? one.name + (one.parts > 1 ? `  ${one.part} / ${one.parts}` : "") : "";
    });
    SHELVES = out;
    SHELF_SPAN = Math.max(SHELF_MIN, ...out.map(s => s.slots));
}
// the rows of the layout in use: shelves (array) or groups (grid)
const arRows = () => AR.layout === "grid" ? LIB.groups : SHELVES;
const slotOf = (row, i) => row.slot ? row.slot[i] : i;
const slotCount = row => row.slots || row.albums.length;

const curGroup = () => arRows()[AR.group] || null;
const curAlbum = () => { const g = curGroup(), r = AR.rows.get(AR.group); return g && r ? g.albums[r.sel] || null : null; };

// ------------------------------------------------------------------------------------------------------- data
let coverPaint = 0;
LIB_LISTENERS.push(kind => {
    if (kind === "catalog") placeSelection(AR.selAlbum);
    if (!ARCHIVE_ON) return;
    if (kind === "catalog") { requestVisibleThumbs(); clock.wake(); window.Repaint(); return; }
    // covers arrive in bursts (a screen of the grid at once): one repaint of the array area for all of them
    if (!coverPaint) coverPaint = window.SetTimeout(() => { coverPaint = 0; window.RepaintRect(0, 0, arrayW(), H); }, 16);
});
// rows rebuilt (catalog, grouping, layout): select `key` again where it now is, else stay near the same row
function placeSelection(key) {
    pickStop();   // the rows are rebuilt: a run's places no longer hold
    if (AR.layout !== "grid") buildShelves();
    const R = arRows();
    // An album or track not listed yet (a track before the worker has listed them, an album still indexing) is kept as
    // wanted and looked for again with the next catalog, until something else is selected by hand.
    const want = AR.wantKey || key;
    // across ALBUMS / TRACKS the selection moves to the album's first track, or to the track's album
    const alt = !want ? "" : want.startsWith("t|") ? ((LIB.items.find(t => t.key === want) || {}).album || "") : ((LIB.items.find(t => t.album === want) || {}).key || "");
    let at = null;
    for (const k of [want, alt, key]) if (k) for (let gi = 0; gi < R.length && !at; gi++) { const i = R[gi].albums.findIndex(a => a.key === k); if (i >= 0) at = [gi, i]; }
    AR.wantKey = at || !LIB.live ? (at ? "" : want) : "";
    AR.group = at ? at[0] : clamp(AR.group, 0, Math.max(0, R.length - 1));
    AR.rows.clear(); AR.ticks.clear(); AR.selKey.clear();
    AR.tracks.key = "";
    if (R.length) {
        const r = rowState(AR.group);
        if (at) { r.sel = at[1]; r.scroll.x = r.scroll.to = scrollTarget(r.sel, R[AR.group]); }
    }
    selectionChanged(false);
}

function selIndexOf(gi) {
    const g = arRows()[gi], key = g && AR.selKey.get(g.name);
    const i = key ? g.albums.findIndex(a => a.key === key) : -1;
    return Math.max(0, i);
}
function rowState(gi) {
    let r = AR.rows.get(gi);
    if (!r) {
        const sel = selIndexOf(gi);
        r = { sel, scroll: Spring(scrollTarget(sel, arRows()[gi]), 9), pos: Spring(gi - arrayStart(), 9), cases: new Map() };
        // The rows move as one strip: a new row joins it where the strip is now, one row on from its nearest
        // neighbour (and at its speed), so it slides in with the others rather than standing at its place while they
        // are still on their way there (a RANDOM PICK crosses several shelves at a time).
        let near = null;
        for (const [g, o] of AR.rows) if (!near || Math.abs(g - gi) < Math.abs(near[0] - gi)) near = [g, o];
        if (near) { r.pos.x = near[1].pos.x + (gi - near[0]); r.pos.v = near[1].pos.v; }
        AR.rows.set(gi, r);
    }
    return r;
}
// the row scrolls (in slots) only when it is longer than the array shows; the selected case then sits a few places
// from the front
const scrollTarget = (sel, row) => clamp(slotOf(row, sel) - 4, 0, Math.max(0, slotCount(row) - slotsInView()));
let SLOTS_IN_VIEW = { key: "", n: 0 };
function slotsInView() {
    const key = `${W}|${H}|${CASE_DIR}|${STATE.arrayScale}`;
    if (SLOTS_IN_VIEW.key === key) return SLOTS_IN_VIEW.n;
    const k = arK(), ax = CASE_META.axes, m = CASE_META.array, S = CASE_META.array_res[0] * k, [Ox, Oy] = origin(), aw = arrayW();
    let n = 0;
    while (n < 400) {
        const ox = Ox + n * ax.y[0] * k - m.origin[0] * k, oy = Oy + n * ax.y[1] * k - m.origin[1] * k;
        if (ox + S * .7 > aw || oy < dp(84) - S * .05) break;   // a lifted case's top stays under the two-row bar
        n++;
    }
    SLOTS_IN_VIEW = { key, n: Math.max(6, n) };
    return SLOTS_IN_VIEW.n;
}

function selectionChanged(animate = true) {
    const g = curGroup(), a = curAlbum();
    if (animate) AR.wantKey = "";   // chosen by hand
    AR.groupName = g ? g.name : "";
    if (g && a) { AR.selKey.set(g.name, a.key); AR.selAlbum = a.key; }
    setSetting("archiveSel", JSON.stringify({ key: AR.selAlbum }));
    const r = AR.rows.get(AR.group), n = g ? g.albums.length : 0, w = Math.max(2, String(n).length);
    const sel = pad(r ? r.sel + 1 : 0, w), gno = pad(AR.group + 1, 2), no = pad(a ? a.no : 0, 4);
    // during a RANDOM PICK run the file panel stays as it is (redrawing it on every hop and every frame of its rolling
    // number cost 20 - 35 ms a frame); it shows the pick once it lands
    const run = !!PICK.steps;
    if (animate) { setRoll(AR.selRoll, sel); setRoll(AR.groupRoll, gno); if (!run) setRoll(AR.noRoll, no); }
    else { AR.selRoll = Roll(sel); AR.groupRoll = Roll(gno); AR.noRoll = Roll(no); }
    if (!run) { AR.title = a && animate ? Scramble(a.part || a.title || tr("UNTITLED")) : null; AR.dirtyInfo = true; }
    if (AR.layout === "grid") GRID.reveal = true;   // the grid scrolls to a selection made elsewhere (keys, catalog)
    if (ARCHIVE_ON) { requestVisibleThumbs(); clock.wake(); }
}

function moveAlbum(d) {
    const g = curGroup();
    if (!g || AR.inspOn || AR.insp > 0) return;
    const r = rowState(AR.group), sel = clamp(r.sel + d, 0, g.albums.length - 1);
    if (sel === r.sel) return;
    r.sel = sel;
    r.scroll.to = scrollTarget(sel, g);
    selectionChanged();
}
function moveGroup(d) {
    const gi = clamp(AR.group + d, 0, arRows().length - 1);
    if (gi === AR.group || AR.inspOn || AR.insp > 0) return;
    AR.group = gi;
    AR.ticks.clear();
    rowState(gi);
    selectionChanged();
}
// a case clicked on another shelf: that shelf becomes the selected one, with the case selected on it
function selectCase(gi, i) {
    const g = arRows()[gi];
    if (!g || !g.albums[i] || AR.inspOn || AR.insp > 0) return;
    AR.group = gi;
    AR.ticks.clear();
    const r = rowState(gi);
    r.sel = i;
    r.scroll.to = scrollTarget(i, g);
    selectionChanged();
}

// RANDOM PICK (R, or the button top left): the selection runs through the shelves to a random item, one shelf at a
// time, then along the shelf, slowing down as it nears it; the case is lifted out and turned to the viewer (the
// inspection) and its album plays. In the grid the run is the same and the album plays. Any other input stops the run.
// PICK.steps: [{ t (s from the start), gi, i (none: the shelf's own selection), done }] (PICK is declared at the top)
function randomPick() {
    if (PICK.steps) return;
    if (AR.inspOn || AR.insp > 0) { AR.inspOn = false; PICK.after = true; clock.wake(); return; }   // once the case is back
    const R = arRows(), total = R.reduce((n, g) => n + g.albums.length, 0), r0 = AR.rows.get(AR.group);
    if (!total) return;
    // any item but the selected one
    let cur = r0 ? r0.sel : 0;
    for (let gi = 0; gi < AR.group; gi++) cur += R[gi].albums.length;
    let n = Math.floor(Math.random() * (total > 1 ? total - 1 : 1));
    if (total > 1 && n >= cur) n++;
    let g1 = 0;
    while (n >= R[g1].albums.length) n -= R[g1++].albums.length;
    const steps = [], g0 = AR.group, dg = g1 - g0, hops = Math.min(Math.abs(dg), 8);
    let t = 0;
    if (REDUCE_MOTION) steps.push({ t, gi: g1, i: n });
    else {
        for (let h = 1; h <= hops; h++) steps.push({ t: t += .11, gi: g0 + Math.round(dg * h / hops) });
        const r = AR.rows.get(g1), s = r ? r.sel : selIndexOf(g1), N = Math.min(Math.abs(n - s), 12);
        let last = s;
        for (let j = 1; j <= N; j++) {
            const i = s + Math.round((n - s) * (1 - Math.pow(1 - j / N, 2)));   // eased out: the last steps are short
            if (i === last) continue;
            steps.push({ t: t += .06 + .24 * Math.pow(j / N, 2), gi: g1, i });
            last = i;
        }
        if (last !== n || !steps.length) steps.push({ t: t += .1, gi: g1, i: n });
    }
    steps.push({ t: t + (REDUCE_MOTION ? 0 : .45), done: true });
    PICK.steps = steps; PICK.t = 0;
    clock.wake(); window.Repaint();
}
function pickStep(s) {
    if (s.done) {
        PICK.steps = null;
        if (!curAlbum()) return;
        selectionChanged();   // the file panel catches up
        if (AR.layout !== "grid") { AR.inspOn = true; inspectImages(); }
        playAlbum();
        clock.wake(); window.Repaint();
        return;
    }
    if (AR.layout === "grid") { gridSelect(s.gi, s.i == null ? rowState(s.gi).sel : s.i); return; }
    if (s.gi !== AR.group) { AR.group = s.gi; AR.ticks.clear(); }
    const r = rowState(s.gi);
    if (s.i != null) { r.sel = s.i; r.scroll.to = scrollTarget(s.i, arRows()[s.gi]); }
    selectionChanged();
}
function pickUpdate(dt) {
    if (PICK.after && AR.insp === 0 && !AR.inspOn) { PICK.after = false; randomPick(); }
    if (!PICK.steps) return PICK.after;
    PICK.t += dt;
    while (PICK.steps && PICK.steps[0].t <= PICK.t) pickStep(PICK.steps.shift());
    return true;
}
function pickStop() { const on = !!PICK.steps || PICK.after; PICK.steps = null; PICK.after = false; if (on) window.Repaint(); }

// the tracks of the selected item's album for the file panel, as many as fit (`max`), in disc / track order; each row
// knows its place in the album (a click plays the album from there) and whether it is the selected track item
const TF_AR_TRACK = fb.TitleFormat("[%tracknumber%]\u0001%title%\u0001[%length_seconds%]");
const sameTrack = (h, k) => !!(h && k && h.RawPath === k.RawPath && h.SubSong === k.SubSong);
function albumTracks(a, max) {
    const key = `${a.key}|${LIB.live}|${max}`;
    if (AR.tracks.key === key) return AR.tracks;
    const list = albumHandles(a), np = fb.GetNowPlaying(), own = itemTrack(a), alb = (albumOf(a) || a).key, prev = AR.tracks;
    let rows = [], first = 0;
    if (list) {
        // a track item further down its album: start the window so it is in view (where it was, when another track of
        // the same album was selected and this one is in view there: a click on a row does not move the rows)
        const at = own ? [...Array(list.Count).keys()].find(i => sameTrack(list[i], own)) : -1;
        first = prev.album === alb && prev.max === max && at >= prev.first && at < prev.first + max ? prev.first
            : at > max - 2 ? Math.max(0, Math.min(at - 1, list.Count - max)) : 0;
        // the whole album is read for its short titles and works (see shortTitles); a row where a work starts (or the
        // window starts within one) is its name, and takes a row of the window
        const all = TF_AR_TRACK.EvalWithMetadbs(list).map(s => s.split("\u0001")), short = shortTitles(all.map(v => v[1]));
        const fill = from => {
            const out = [];
            let work = null;
            for (let i = from; i < list.Count && out.length < max; i++) {
                const [no, , len] = all[i], h = list[i], sh = short[i];
                if (sh.work !== work && i > from && (work || sh.work) && out.length < max - 1) out.push({ gap: true });   // air between works
                if (sh.work && sh.work !== work && out.length < max - 1) out.push({ work: sh.work });
                work = sh.work;
                out.push({ i, no: no ? pad(parseInt(no) || 0, 2) : pad(i + 1, 2), title: sh.part, len: +len || 0, playing: sameTrack(h, np), own: sameTrack(h, own) });
            }
            return out;
        };
        rows = fill(first);
        // the work rows can push the selected track out of the window: then the window starts further on
        while (at >= 0 && first < at && !rows.some(r => r.own)) rows = fill(++first);
    }
    AR.tracks = { key, rows, first, total: list ? list.Count : (albumOf(a) || a).tracks, album: alb, max };
    return AR.tracks;
}

// every track of the selected item's album for the TRACKS page: disc, number, title, length, rating; AR.listVer goes up
// when a track changes (a rating, tags) or another one plays
const TF_AR_LIST = fb.TitleFormat("[%discnumber%]\u0001[%tracknumber%]\u0001%title%\u0001[%length_seconds%]");
function albumTrackList(a) {
    const key = `${a.key}|${LIB.live}|${AR.listVer}|${ratingStore()}`;
    if (AR.list && AR.list.key === key) return AR.list;
    const list = albumHandles(a), np = fb.GetNowPlaying(), own = itemTrack(a);
    let rows = [];
    if (list && list.Count) {
        const R = getRatings(list);
        const all = TF_AR_LIST.EvalWithMetadbs(list).map(v => v.split("\u0001")), short = shortTitles(all.map(v => v[2]));
        rows = all.map(([disc, no, , len], i) => {
            const h = list[i];
            return { i, disc: disc || "", no: no ? pad(parseInt(no) || 0, 2) : pad(i + 1, 2), title: short[i].part, work: short[i].work,
                     len: +len || 0, rating: R[i] || 0, playing: sameTrack(h, np), own: sameTrack(h, own) };
        });
    }
    const rated = rows.filter(r => r.rating);
    AR.list = { key, rows, handles: list, discs: new Set(rows.map(r => r.disc)).size, total: rows.reduce((n, r) => n + r.len, 0),
                rated: rated.length, avg: rated.length ? rated.reduce((n, r) => n + r.rating, 0) / rated.length : 0 };
    return AR.list;
}
// a work's name over its tracks in the album file's lists (see shortTitles)
function drawWorkRow(gr, work, x, y, w, h) {
    gr.DrawText(work, fontFor(work, 10, 600), C["fg-soft"], x, y + dp(2), w, h, DT_SINGLE | DT_ELLIPSIS);
    gr.FillSolidRect(x, y + h - dp(3), w, HAIR, C["line-faint"]);
}
function setInfoPage(page) {
    if (page === AR.page) return;
    AR.page = page;
    setSetting("archiveInfoPage", page);
    AR.rateHover = null; AR.dirtyInfo = true;
    window.Repaint();
}

// short: without the codec's bracketed note ("PCM (FLOATING-POINT)" → "PCM"), for a narrow header
function fmtChip(a, short = false) {
    let codec = (a.codec || "—").toUpperCase();
    if (short) codec = codec.replace(/\s*\(.*?\)/g, "") || codec;
    if (a.lossless && a.bits && a.rate) return `${codec} ${a.bits}/${+(a.rate / 1000).toFixed(1)}`;
    return a.kbps ? `${codec} ${a.kbps}` : codec;
}

// ------------------------------------------------------------------------------------------------------ motion
function archiveUpdate(dt) {
    const G = arRows();
    if (!G.length) return false;
    let more = stepInspection(dt);
    more = pickUpdate(dt) || more;
    // Keep a full viewport near the end of the library, plus a row at each edge for animation.
    const start = arrayStart(), count = arrayGeom().count;
    const F = frontRows();
    for (let gi = start - 1 - F; gi <= start + count; gi++) if (gi >= 0 && gi < G.length) rowState(gi).pos.to = gi - start;
    // a row out of that range goes on with the strip and is let go once it has left the view (not while it is still
    // on its way out, where it would vanish)
    for (const [gi, r] of [...AR.rows]) {
        if (gi >= start - 1 - F && gi <= start + count) continue;
        r.pos.to = gi - start;
        if (r.pos.x <= -1 - F || r.pos.x >= count) AR.rows.delete(gi);
    }
    // the selected case's place along its row, for the titles near it (titleDistance)
    const ra = AR.rows.get(AR.group), selY = ra && G[AR.group] ? slotOf(G[AR.group], ra.sel) - ra.scroll.to : 0;
    for (const [gi, r] of AR.rows) {
        more = stepSpring(r.pos, dt) || more;
        more = stepSpring(r.scroll, dt) || more;
        const active = gi === AR.group, [i0, i1] = caseWindow(r, G[gi]);
        for (const i of [...r.cases.keys()]) if (i < i0 || i > i1) r.cases.delete(i);
        for (let i = i0; i <= i1; i++) {
            const nd = titleDistance(slotOf(G[gi], i) - r.scroll.to - selY, gi - AR.group);
            const t = caseTargets(i, r, active, G[gi], gi === AR.hoverRow ? AR.hover : -1, nd);
            let c = r.cases.get(i);
            if (!c) { c = { lift: Spring(t.lift, 13), clear: Spring(t.clear, 8), gap: Spring(t.gap, 11), near: Spring(t.near, 10), hov: Spring(t.hov, 14), plate: Spring(t.plate, 12) }; r.cases.set(i, c); }
            c.lift.to = t.lift; c.lift.w = active ? 13 : 7; c.clear.to = t.clear; c.gap.to = t.gap; c.near.to = t.near; c.hov.to = t.hov; c.plate.to = t.plate;
            const m1 = stepSpring(c.lift, dt), m2 = stepSpring(c.clear, dt), m3 = stepSpring(c.gap, dt), m4 = stepSpring(c.near, dt), m5 = stepSpring(c.hov, dt), m6 = stepSpring(c.plate, dt);
            more = more || m1 || m2 || m3 || m4 || m5 || m6;
        }
    }
    // album index marks
    const r = AR.rows.get(AR.group);
    if (r) {
        const M = rulerCount(), n = G[AR.group].albums.length;
        AR.rulerStart.to = clamp(r.sel - Math.floor(M / 2), 0, Math.max(0, n - M));
        more = stepSpring(AR.rulerStart, dt) || more;
        const s0 = Math.floor(AR.rulerStart.x);
        for (const i of [...AR.ticks.keys()]) if (i < s0 - 1 || i > s0 + M + 1) AR.ticks.delete(i);
        for (let i = Math.max(0, s0 - 1); i <= Math.min(n - 1, s0 + M + 1); i++) {
            const hd = AR.hoverTick >= 0 ? i - AR.hoverTick : 99;
            const to = i === r.sel ? 30 : Math.max(10, 10 + 12 * Math.exp(-hd * hd / 1.5));
            let s = AR.ticks.get(i);
            if (!s) { s = Spring(to, 18); AR.ticks.set(i, s); }
            s.to = to;
            more = stepSpring(s, dt) || more;
        }
    }
    if (AR.title && !scrambleDone(AR.title)) { more = true; AR.dirtyInfo = true; }
    if (!rollDone(AR.noRoll)) { more = true; AR.dirtyInfo = true; }
    if (!rollDone(AR.selRoll) || !rollDone(AR.groupRoll)) more = true;
    return more;
}
// the cases of a row that can be on screen (with room for lift and gap): cases enter and leave out of sight, behind
// the edges and fades, instead of popping in or out where they stand when the row scrolls
function caseWindow(r, row, pos = r.pos.x, scroll = r.scroll.x) {
    const n = row ? row.albums.length : 0;
    if (!n || W <= 0) return [0, -1];
    const k = arK(), ax = CASE_META.axes, m = CASE_META.array, S = CASE_META.array_res[0] * k, [Ox, Oy] = origin();
    const aw = arrayW(), margin = dp(160), x = -pos * ROWP, g = arrayGeom();
    let i0 = -1, i1 = -1;
    for (let i = 0; i < n; i++) {
        const y = slotOf(row, i) - scroll;
        if (y < -30 || y > 60) continue;
        const ox = Ox + (x * ax.x[0] * g.sx + y * ax.y[0]) * k - m.origin[0] * k, oy = Oy + (x * ax.x[1] * g.sy + y * ax.y[1]) * k - m.origin[1] * k;
        if (ox < aw + margin && ox + S > -margin && oy < H + margin && oy + S > -margin * 2) { if (i0 < 0) i0 = i; i1 = i; }
    }
    return i0 < 0 ? [0, -1] : [i0, i1];
}

// The inspection runs in two stages with an ease at both ends of each, so the case first rises out of its row, stops,
// then turns towards the viewer; going back it turns away above its place and then sinks into the row. The turn waits
// until the inspection frames have loaded.
const inspLift = () => easeInOut(clamp(AR.insp, 0, 1));
const inspTurn = () => easeInOut(clamp(AR.insp - 1, 0, 1));
function stepInspection(dt) {
    const target = AR.inspOn ? (ARIMG.inspect ? 2 : 1) : 0;
    if (AR.insp === target) return AR.inspOn && !ARIMG.inspect;
    if (REDUCE_MOTION) { AR.insp = target; return false; }
    const dir = Math.sign(target - AR.insp), lifting = dir > 0 ? AR.insp < 1 : AR.insp <= 1;
    const next = AR.insp + dir * dt / (lifting ? INSP_LIFT : INSP_TURN);
    AR.insp = dir > 0 ? Math.min(next, target) : Math.max(next, target);
    return true;
}
// hover: the case of this row under the mouse, which lifts its neighbours a little (-1: none, as for the cases'
// resting places); nd: how far the case is from the selected one for the titles "near" it (see titleDistance; by
// default its slots from its own row's selected case)
function caseTargets(i, r, active, row, hover, nd) {
    const d = slotOf(row, i) - slotOf(row, r.sel), bell = Math.exp(-d * d / 4.5) - .32 * Math.exp(-d * d / 18), hd = i - hover;
    const hb = hover >= 0 ? Math.exp(-hd * hd / 2.2) : 0, hov = (active ? .8 : 1.2) * hb, isSel = active && i === r.sel;
    return {
        lift: (active ? 1.1 : .65) * bell + hov + (isSel ? 1.35 : 0),
        clear: isSel ? 1 : 0,
        gap: active ? (i > r.sel ? .55 : i < r.sel ? -.25 : 0) : 0,
        // its title with the titles "near" the selection: whole within TITLE_NEAR[0] of the selected case, gone from
        // TITLE_NEAR[1] on
        near: clamp((TITLE_NEAR[1] - (nd === undefined ? Math.abs(d) : nd)) / (TITLE_NEAR[1] - TITLE_NEAR[0]), 0, 1),
        // the cases under the mouse show their titles as much as they are lifted for it (the one under it whole, its
        // neighbours less), even where titles are off or far from the selection
        hov: hb,
        // the info plate: the selected case's (while it is inspected, drawInspection carries it over)
        plate: isSel ? 1 : 0,
    };
}

// ------------------------------------------------------------------------------------------------------ layout
const infoX = () => W - dp(24 + INFO_W);
const arrayW = () => Math.max(dp(300), infoX() - dp(24));
// Preserve case size on ultrawide views; fit additional shelves across the available width.
let ARRAY_GEOM = null;
function arrayGeom() {
    const aw = arrayW(), total = arRows().length;
    const key = [W, H, CASE_DIR, STATE.arrayScale, total, SHELF_SPAN].join("|");
    if (ARRAY_GEOM && ARRAY_GEOM.key === key) return ARRAY_GEOM;
    const g = { key, wide: aw > H * 2, count: 4, x: Math.round(aw * .37), y: H - dp(87), sx: 1, sy: 1 };
    if (g.wide) {
        const k = arK(), ax = CASE_META.axes, meta = CASE_META.array, sz = CASE_META.array_res[0];
        const pad = dp(48), along = (SHELF_SPAN - 1) * PITCH;
        const span = (along * ax.y[0] + sz) * k, pitch = ROWP * ax.x[0] * k;
        const capacity = clamp(Math.floor((aw - pad * 2 - span) / pitch) + 1, 4, 24);
        g.count = Math.max(1, Math.min(total || 1, capacity));
        const used = Math.min(aw - pad * 2, span + (g.count - 1) * pitch);
        const fill = total >= capacity, width = fill ? aw - pad * 2 : used;
        const dx = g.count > 1 ? (width - span) / (g.count - 1) : pitch;
        g.x = Math.round((aw + width) / 2 - (along * ax.y[0] + sz - meta.origin[0]) * k);
        g.sx = Math.max(.1, dx / pitch);
        // Extra shelves run across the panorama instead of disappearing above its short edge.
        // Keep the actual case/rail sprites unchanged; only their row-to-row offset changes.
        const top = Math.min(...meta.cover.map(p => p[1]));
        const rise = (-along * ax.y[1] + meta.origin[1] - top + 2.6 * Math.abs(ax.z[1])) * k;
        const room = Math.max(0, g.y - dp(92) - rise);
        const dy = Math.min(ROWP * ax.x[1] * k, room / Math.max(1, g.count - 1));
        g.sy = dy / (ROWP * ax.x[1] * k);
    }
    ARRAY_GEOM = g;
    return g;
}
const arrayStart = () => arrayGeom().wide ? Math.min(AR.group, Math.max(0, arRows().length - arrayGeom().count)) : AR.group;
const origin = () => { const g = arrayGeom(); return [g.x, g.y]; };
function archiveResize() {
    ARRAY_GEOM = null;
    if (AR.layout === "grid" || !arRows().length) return;
    const start = arrayStart();
    for (const [gi, r] of AR.rows) {
        r.pos.x = r.pos.to = gi - start;
        r.scroll.x = r.scroll.to = scrollTarget(r.sel, arRows()[gi]);
    }
    if (ARCHIVE_ON) { requestVisibleThumbs(); clock.wake(); }
}
// the array grows with the view: 1 at the design's 1440 × 900 window (array 936 × 731 dp), up to 1.6 on large screens,
// so a maximised window on a big display is filled instead of showing the same small cases in a sea of black
const AR_REF = [936, 731];
// × the Array scale chosen in MENU › Audio Archive or the Style view
const arZoom = () => clamp(Math.min(arrayW() / dp(AR_REF[0]), H / dp(AR_REF[1])), 1, 1.6) * (STATE.arrayScale || 1);
const arK = () => AS * SCALE * arZoom();   // array sprite px → screen px
// the album index fits between ALBUM / SELECT and the row switcher
const RULER_STEP = 7;
const rulerX0 = () => Math.round(arrayW() * .34);
const rulerCount = () => Math.max(8, Math.floor((Math.round(arrayW() * .774) - dp(150) - rulerX0() - dp(40)) / dp(RULER_STEP)));

// ------------------------------------------------------------------------------------------------------ images
const ARIMG = { clear: null, frost: null, faded: new Map(), inspect: null, inspectLoading: false, gen: 0, rail: null };
// the guide rail under each row: sprites made with the cases' camera, one per slot plus the row's
// front and back ends; they belong to the archive, not to a case skin
const RAIL_DIR = THEME_ROOT + "assets\\render\\rail\\";
const RAIL_META = utils.IsFile(RAIL_DIR + "rail.json") ? JSON.parse(utils.ReadTextFile(RAIL_DIR + "rail.json", 65001)) : null;
function railImages() {
    if (!ARIMG.rail && RAIL_META) {
        ARIMG.rail = {};
        for (const k of ["mid", "front", "back"]) {
            ARIMG.rail[k] = d2d.Image(floorOwn(`rail${BS}rail-${k}.png`) || RAIL_DIR + `rail-${k}.png`);
            if (RAIL_META.lip) ARIMG.rail["lip-" + k] = d2d.Image(RAIL_DIR + `lip-${k}.png`);
        }
    }
    return ARIMG.rail;
}
CASE_LISTENERS.push(() => {   // another case skin
    ARIMG.clear = ARIMG.frost = ARIMG.inspect = null; ARIMG.faded.clear(); ARIMG.inspectLoading = false; ARIMG.gen++;
    AR.inspOn = false; AR.insp = 0; AR.dirtyInfo = true;
    if (ARCHIVE_ON) { clock.wake(); window.Repaint(); }
});
// the floor under the array (STATE.floor, the Style view's FLOOR): assets\render\floor\<id>-<mode>\, made with the
// cases' camera (art/build_floor.py): plate.jpg, the floor itself, still and anchored at the world origin (the front
// row's first slot); shade-/glow-<piece>.png, the shadow and the light a rail piece (mid, front, back) and the cases on
// it throw onto the floor, so the shelves stand on it. "-far" pieces are the floor in front of a row, which the next
// row covers except in front of the front one.
// A floor may also bring the cases and rails rendered in its own light (REAL STYLE: case\<skin>\array-*.png, rail\),
// set the colour rows behind fade into ("fade") and how much they fade ("tint", 1 = as on the plain page), and have
// one set for both modes (the other mode's folder is used when this one's is missing).
const FLOOR = { key: null, meta: null, img: null };   // key: the folder loaded ("" plain); null: look again
const BS = "\\";
function floorDir() {
    if (!STATE.floor || STATE.floor === "plain") return "";
    const at = m => THEME_ROOT + `assets${BS}render${BS}floor${BS}${STATE.floor}-${m}${BS}`;
    const own = at(MODE), other = at(MODE === "dark" ? "light" : "dark");
    return utils.IsFile(own + "floor.json") || !utils.IsFile(other + "floor.json") ? own : other;
}
// a file the floor brings for itself, else ""
const floorOwn = f => FLOOR.key && utils.IsFile(FLOOR.key + f) ? FLOOR.key + f : "";
const fadeBg = () => FLOOR.meta && FLOOR.meta.fade ? argb(FLOOR.meta.fade) : C.bg;
function floorImages() {
    const dir = floorDir();
    if (FLOOR.key !== dir) {
        FLOOR.key = dir; FLOOR.img = null;
        FLOOR.meta = dir && utils.IsFile(dir + "floor.json") ? JSON.parse(utils.ReadTextFile(dir + "floor.json", 65001)) : null;
        // the case and rail sprites may come from the floor now (or no longer)
        ARIMG.clear = ARIMG.frost = ARIMG.rail = null; ARIMG.faded.clear();
    }
    if (FLOOR.meta && !FLOOR.img) {
        FLOOR.img = { plate: d2d.Image(dir + "plate.jpg") };
        for (const k of ["mid", "front", "back"]) for (const part of ["", "-far"]) {
            FLOOR.img[`shade-${k}${part}`] = halfImage(d2d.Image(dir + `shade-${k}${part}.png`));
            if (FLOOR.meta.glow !== false) FLOOR.img[`glow-${k}${part}`] = halfImage(d2d.Image(dir + `glow-${k}${part}.png`));
        }
    }
    // an image that could not be read leaves the floor plain (rather than failing the whole paint)
    return FLOOR.meta && Object.values(FLOOR.img).every(Boolean) ? FLOOR : null;
}
TOKEN_LISTENERS.push(() => { FLOOR.key = null; });
// The shade and glow sprites are soft: kept at half their size, a quarter of the pixels to draw for every row (an
// ultrawide array draws a dozen rows); drawn at their full size, their source rect is the image's own.
function halfImage(src) {
    if (!src) return src;
    const w = Math.ceil(src.Width / 2), h = Math.ceil(src.Height / 2), img = d2d.CreateImage(w, h), g = img.GetGraphics();
    g.DrawImage(src, 0, 0, w, h, 0, 0, src.Width, src.Height);
    img.ReleaseGraphics(g);
    return img;
}
// the floor, then every row's shade and glow; false when the floor is plain
function drawFloor(gr, rows, G, Ox, Oy, k, toScreen) {
    const F = floorImages();
    if (!F) return false;
    const pm = F.meta.plate, sm = F.meta.shade, [rw, rh] = sm.res, [so0, so1] = sm.origin;
    gr.DrawImage(F.img.plate, Ox - pm.origin[0] * k, Oy - pm.origin[1] * k, pm.res[0] * k, pm.res[1] * k, 0, 0, pm.res[0], pm.res[1]);
    // the mid piece holds one slot of a full row's shade, the same all along the row: it is stretched along the row
    // over all its slots (one image, no seams between slots); the ends are drawn as they are
    const ax = CASE_META.axes.x, ay = CASE_META.axes.y, az = CASE_META.axes.z, fz = -F.meta.floor_z, det = ax[0] * ay[1] - ay[0] * ax[1];
    const zx = fz * az[0], zy = fz * az[1];   // the floor lies fz below the sprites' origin plane
    // "glow": false in floor.json: shade only (no reflections of the cases and strips in the floor)
    for (const layer of F.meta.glow === false ? ["shade-"] : ["shade-", "glow-"]) for (const [gi, r] of rows) for (const part of ["", "-far"]) {
        const row = G[gi], pos = r.pos.x, x = -pos * ROWP, n = slotCount(row);
        // the floor in front of a row shows as far as no row stands there: as the row in front fades out, it appears
        const far = gi > 0 ? 1 - rowAlpha(pos - 1) / 255 : 1;
        const alpha = Math.round(rowAlpha(pos) * (1 - rowTint(pos)) * (part ? far : 1));
        if (alpha <= 0) continue;
        for (const end of ["front", "back"]) {
            const [sx, sy] = toScreen({ x, y: ((end === "front" ? -1 : n) - r.scroll.x) * PITCH, z: 0 });
            const img = F.img[layer + end + part];
            gr.DrawImage(img, sx - so0 * k, sy - so1 * k, rw * k, rh * k, 0, 0, img.Width, img.Height, 0, alpha);
        }
        if (n < 1) continue;
        // A = B diag(1, n) B^-1, B = [ax ay]: n times longer along the row, unchanged across it
        const s = (n - 1) / det, A = [1 - s * ay[0] * ax[1], s * ay[0] * ax[0], -s * ay[1] * ax[1], 1 + s * ay[1] * ax[0]];
        const [ox, oy] = toScreen({ x, y: ((n - 1) / 2 - r.scroll.x) * PITCH, z: 0 }), ux = zx - so0, uy = zy - so1;
        QM[0] = k * A[0]; QM[1] = k * A[2]; QM[2] = k * A[1]; QM[3] = k * A[3];
        QM[4] = ox + k * (A[0] * ux + A[1] * uy - zx); QM[5] = oy + k * (A[2] * ux + A[3] * uy - zy);
        gr.SetTransform(QM);
        const mid = F.img[layer + "mid" + part];
        gr.DrawImage(mid, 0, 0, rw, rh, 0, 0, mid.Width, mid.Height, 0, alpha);
        gr.ResetTransform();
    }
    return true;
}

function arrayImages() {
    floorImages();   // a new floor may bring its own case sprites
    if (!ARIMG.clear) for (const k of ["clear", "frost"]) ARIMG[k] = d2d.Image(floorOwn(`case${BS}${CASE_SKIN}${BS}array-${k}.png`) || CASE_DIR + `array-${k}.png`);
    return ARIMG;
}
// the frost sprite tinted towards the background by f (0.1 steps), alpha kept: Direct2D colour matrix, made once
// src tinted towards the background by f: src as it is, then its silhouette in the background colour (tinted at 1, made
// once) over it at f, so the tint follows f smoothly as a row moves. Opaque parts come out exactly as a sprite tinted
// by f; half-clear ones (the frosted glass) a little more opaque, by the same amount at every f. (Two cached tint
// steps laid one on the other instead made the glass jump in opacity at every 0.1 step.) (sw, sh): the part of src drawn
function drawTinted(gr, src, name, f, x, y, w, h, sw, sh, alpha) {
    gr.DrawImage(src, x, y, w, h, 0, 0, sw, sh, 0, alpha);
    const a = Math.round(alpha * f);
    if (a > 0) gr.DrawImage(tinted(src, 1, name), x, y, w, h, 0, 0, sw, sh, 0, a);
}
// The silhouettes (drawTinted) are made when first drawn and dropped while the Archive is hidden, and the first shelf
// switch after the Archive was shown needed several at once, which stalled it. So once it is shown they are made
// ahead, one every few frames (the sprites are looked up again for each, so a skin, floor or scheme changed meanwhile
// is the one warmed): the clear and frosted cases' and the rail's.
const TINT_WARM = { timer: 0 };
function warmTints() {
    window.ClearTimeout(TINT_WARM.timer);
    const kinds = ["clear", "frost", ...(RAIL_META ? ["mid", "front", "back"] : [])];
    const jobs = [];
    for (const kind of kinds) jobs.push([kind, 1]);
    const step = () => {
        TINT_WARM.timer = 0;
        if (!ARCHIVE_ON) return;
        if (AR.layout !== "grid") {
            const [kind, f] = jobs.shift(), I = arrayImages();
            if (kind === "frost" || kind === "clear") { if (I[kind]) tinted(I[kind], f, (kind === "frost" ? "case" : "case-clear") + CASE_DIR); }
            else { const R = railImages(); if (R && R[kind]) tinted(accentShift(R[kind]), f, "rail-" + kind); }
        }
        if (jobs.length) TINT_WARM.timer = window.SetTimeout(step, 40);
    };
    TINT_WARM.timer = window.SetTimeout(step, 600);   // after the view's own transition
}
function tinted(src, f, name) {
    const key = MODE + f + name;
    let img = ARIMG.faded.get(key);
    if (img) return img;
    const fx = d2d.Effect("{921F03D6-641C-47DF-852D-B4BB6153AE11}");
    const bg = fadeBg(), r = ((bg >>> 16) & 255) / 255, g = ((bg >>> 8) & 255) / 255, b = (bg & 255) / 255, k = 1 - f;
    fx.SetInput(0, src);
    fx.SetValue(0, new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, r * f, g * f, b * f, 0]));
    img = d2d.CreateImage(src.Width, src.Height);
    const gr = img.GetGraphics();
    gr.DrawEffect(fx, 0, 0, 0, 0, src.Width, src.Height);
    img.ReleaseGraphics(gr);
    ARIMG.faded.set(key, img);
    return img;
}
TOKEN_LISTENERS.push(() => { ARIMG.faded.clear(); AR.dirtyInfo = true; });

function inspectImages() {
    if (ARIMG.inspect || ARIMG.inspectLoading) return ARIMG.inspect;
    ARIMG.inspectLoading = true;
    const n = CASE_META.inspect.length, imgs = new Array(n), gen = ARIMG.gen;
    let left = n;
    // a frame that cannot be read sends the case back into its row (rather than waiting, and ticking, forever)
    const fail = () => { if (gen !== ARIMG.gen) return; ARIMG.gen++; ARIMG.inspectLoading = false; AR.inspOn = false; clock.wake(); };
    for (let i = 0; i < n; i++) d2d.LoadImageAsyncV2(0, CASE_DIR + `inspect-${pad(i, 2)}.png`).then(img => {
        if (gen !== ARIMG.gen) return;
        if (!img) { fail(); return; }
        imgs[i] = img;
        if (--left === 0) { ARIMG.inspect = imgs; ARIMG.inspectLoading = false; clock.wake(); window.Repaint(); }
    }, fail);
    return null;
}
// the archive's big images are kept only while it is shown
function archiveHidden() { pickStop(); TOP_IMG.clear(); AR.inspOn = false; AR.insp = 0; ARIMG.inspect = null; ARIMG.gen++; ARIMG.inspectLoading = false; ARIMG.faded.clear(); ARIMG.clear = ARIMG.frost = ARIMG.rail = null; AR.info = null; FLOOR.key = null; FLOOR.img = null; }

// covers of what is on screen, nearest first: the current row around the selection, then the rows behind
function requestVisibleThumbs() {
    if (AR.layout === "grid") { gridThumbs(); return; }
    const G = arRows(), list = [];
    const start = arrayStart(), count = arrayGeom().count;
    const first = Math.max(0, start - frontRows()), order = Array.from({ length: Math.min(count, G.length - start) + start - first }, (_, i) => first + i);
    order.sort((a, b) => Math.abs(a - AR.group) - Math.abs(b - AR.group));
    for (const gi of order) {
        const r = rowState(gi), albums = G[gi].albums, [i0, i1] = caseWindow(r, G[gi], gi - start, r.scroll.to);
        const idx = [];
        for (let i = i0; i <= i1; i++) idx.push(i);
        idx.sort((p, q) => Math.abs(p - r.sel) - Math.abs(q - r.sel));
        idx.forEach(i => list.push(albums[i]));
    }
    setThumbBudget(Math.max(160, list.length));
    requestThumbs(list, Math.max(48, list.length));
}

// ------------------------------------------------------------------------------------------------------ drawing
const QM = new Float32Array(6);
// image into the parallelogram q (sprite px; q[0] top-left, q[1] top-right, q[3] bottom-left) placed at (ox, oy) × k
function quadImage(gr, img, q, ox, oy, k, alpha = 255) {
    const w = img.Width, h = img.Height;
    QM[0] = (q[1][0] - q[0][0]) * k / w; QM[1] = (q[1][1] - q[0][1]) * k / w;
    QM[2] = (q[3][0] - q[0][0]) * k / h; QM[3] = (q[3][1] - q[0][1]) * k / h;
    QM[4] = ox + q[0][0] * k; QM[5] = oy + q[0][1] * k;
    gr.SetTransform(QM);
    gr.DrawImage(img, 0, 0, w, h, 0, 0, w, h, 0, alpha);
    gr.ResetTransform();
}
const quadPts = (q, ox, oy, k) => q.flatMap(([x, y]) => [ox + x * k, oy + y * k]);
// one rail sprite at screen point (sx, sy) of its slot; rows behind are tinted like their cases
function drawRailSlot(gr, it, sx, sy, k, aw) {
    const img = accentShift(ARIMG.rail[it.rail]), [rw, rh] = RAIL_META.res, ox = sx - RAIL_META.origin[0] * k, oy = sy - RAIL_META.origin[1] * k;
    if (ox > aw || ox + rw * k < 0 || oy > H || oy + rh * k < 0) return;
    const alpha = rowAlpha(it.pos), f = rowTint(it.pos);
    drawTinted(gr, img, "rail-" + it.rail, f, ox, oy, rw * k, rh * k, rw, rh, alpha);
    // the row's number on the front end's label plate, fading out as the row fades past half
    const la = Math.round(alpha * clamp((.5 - f) / .1, 0, 1));
    if (it.rail === "front" && la > 0) {
        const q = RAIL_META.label;
        QM[0] = (q[1][0] - q[0][0]) * k / 100; QM[1] = (q[1][1] - q[0][1]) * k / 100;
        QM[2] = (q[3][0] - q[0][0]) * k / 20; QM[3] = (q[3][1] - q[0][1]) * k / 20;
        QM[4] = ox + q[0][0] * k; QM[5] = oy + q[0][1] * k;
        if (!LABEL_FONTS.row) LABEL_FONTS.row = d2d.Font("Geist Mono SemiBold", 12, 0);
        gr.SetTransform(QM);
        gr.DrawText(`ROW ${pad(it.gi + 1, 2)}`, LABEL_FONTS.row, withAlpha(0xFF1B1C18, la / 255), 6, 1, 94, 18, DT_SINGLE);
        gr.ResetTransform();
    }
}

// "ARC / 0269" printed on the spine label (a 100 × 60 box mapped onto the label quad)
const LABEL_FONTS = { a: null, b: null };
// a skin may print its labels in its own colours (case.json "skin": labelInk, topPaper, topInk), as a black case does
const skinInk = (key, def) => CASE_META.skin && CASE_META.skin[key] ? argb(CASE_META.skin[key]) : def;
function drawSpineLabel(gr, q, ox, oy, k, no, alpha = 255) {
    if (!LABEL_FONTS.a) { LABEL_FONTS.a = d2d.Font("Geist Mono SemiBold", 15, 0); LABEL_FONTS.b = d2d.Font("Geist Mono", 22, 1); }
    QM[0] = (q[1][0] - q[0][0]) * k / 100; QM[1] = (q[1][1] - q[0][1]) * k / 100;
    QM[2] = (q[3][0] - q[0][0]) * k / 60; QM[3] = (q[3][1] - q[0][1]) * k / 60;
    QM[4] = ox + q[0][0] * k; QM[5] = oy + q[0][1] * k;
    gr.SetTransform(QM);
    const ink = withAlpha(skinInk("labelInk", 0xFF1B1C18), alpha / 255);
    gr.DrawText("ARC", LABEL_FONTS.a, ink, 8, 6, 90, 20, DT_SINGLE);
    gr.DrawText(pad(no, 4), LABEL_FONTS.b, ink, 8, 28, 92, 28, DT_SINGLE);
    gr.ResetTransform();
}

// The item's title on a paper strip along the case's top edge, so the cases can be read from above like records in a
// crate (the covers of the cases behind are hidden by the ones in front, their tops are not). The strip runs from the
// case's left end to the index tab (case model units: x along the case, y across it, the top at z); it is mapped
// like the spine label, 100 units per model unit, the text's top towards the back of the case.
const TOP_STRIP = { x0: -1.80, x1: 1.10, y: .15, z: 3.5 }, TOP_PAPER = 0xFFE9E6DD, TOP_INK = 0xFF1B1C18;
// The titles are finished like the case they are on (the Style view's SHELVES › TITLE STYLE › BY MATERIAL), each drawn
// once into the strip's bitmap, transparent but for the lettering, so the case's rendered top shows around and
// through it:
//   print    pad-printed ink, as on a cassette shell, with a printed accent bar (ink: "dark" or "light")
//   engrave  cut into the surface: the groove in shade, its lower wall catching the light
//   etch     frosted into it, as glass is etched: milky letters with a soft glow, over a dark edge (edge: its strength,
//            0 for a dark case where it would not show; glow, core: the letters' alphas)
//   label    the paper strip, at TOP_ALPHA (the light and shade of the top show through it), its ink TOP_SOFT of the way
//            to the paper: kept for the striped HAZARD top, and for every case with TITLE STYLE › LABEL
// The finishes were chosen against the cases' renders (the top's colour measured from array-clear.png). A skin can
// name its own in case.json ("skin": { "topStyle": { "kind": … } }); a hand-made skin with a paper colour of its own
// (topPaper) keeps the label, others are printed; the custom case is printed in ink that suits its colour.
const TOP_ALPHA = .82, TOP_SOFT = .3, TITLE_NEAR = [2, 6];
const ETCH = { kind: "etch", edge: 130, glow: 235, core: 205 };
const TOP_STYLES = {
    white: { kind: "print", ink: "dark" }, marble: { kind: "engrave" }, frost: { kind: "engrave" }, glass: ETCH,
    blackout: { kind: "etch", edge: 0, glow: 120, core: 150 }, hazard: { kind: "label" }, red: ETCH,
    blue: { kind: "print", ink: "light" }, coral: ETCH, tide: ETCH, aurora: ETCH,
};
let TOP_LOOK = null;   // the finish in use (see topLook); made again for another skin, scheme or setting
function topLook() {
    if (TOP_LOOK) return TOP_LOOK;
    const sk = CASE_META && CASE_META.skin || {};
    let st = SHELF_LOOK.sel.style === "label" ? { kind: "label" } : sk.topStyle || TOP_STYLES[CASE_SKIN];
    if (!st && CASE_SKIN === "custom") {
        const c = argb(customCase().base), lum = (((c >>> 16) & 255) * .2126 + ((c >>> 8) & 255) * .7152 + (c & 255) * .0722) / 255;
        st = { kind: "print", ink: lum >= .5 ? "dark" : "light" };
    }
    if (!st) st = sk.topPaper ? { kind: "label" } : { kind: "print", ink: "dark" };
    TOP_LOOK = Object.assign({ paper: skinInk("topPaper", TOP_PAPER), ink: skinInk("topInk", TOP_INK) }, st);
    TOP_LOOK.key = JSON.stringify(TOP_LOOK);
    return TOP_LOOK;
}
// P: (x, y, z) in case model units -> screen point; by default the array's projection of the case at (ox, oy)
function drawTopTitle(gr, a, ox, oy, k, alpha, f, P = null) {
    const m = CASE_META.array.origin, ax = CASE_META.axes, T = TOP_STRIP;
    const at = P ? (x, y) => P(x, y, T.z) : (x, y) => [ox + (m[0] + x * ax.x[0] + y * ax.y[0] + T.z * ax.z[0]) * k, oy + (m[1] + x * ax.x[1] + y * ax.y[1] + T.z * ax.z[1]) * k];
    const o = at(T.x0, T.y), u = at(T.x0 + 1, T.y), v = at(T.x0, T.y - 1);
    if (Math.hypot(v[0] - o[0], v[1] - o[1]) * T.y * 2 < 5) return;   // too small to read
    QM[0] = (u[0] - o[0]) / 100; QM[1] = (u[1] - o[1]) / 100; QM[2] = (v[0] - o[0]) / 100; QM[3] = (v[1] - o[1]) / 100; QM[4] = o[0]; QM[5] = o[1];
    const look = topLook(), img = topStrip((a.part || a.title || tr("UNTITLED")).toUpperCase(), look), w = (T.x1 - T.x0) * 100, h = T.y * 200;
    gr.SetTransform(QM);
    if (look.kind === "label") {
        const sa = alpha * TOP_ALPHA;
        gr.DrawImage(img, 0, 0, w, h, 0, 0, img.Width, img.Height, 0, Math.round(sa));
        if (f > 0) gr.FillSolidRect(0, 0, w, h, withAlpha(fadeBg(), f * sa / 255));   // tinted like the row
    } else gr.DrawImage(img, 0, 0, w, h, 0, 0, img.Width, img.Height, 0, Math.round(alpha * (1 - f)));   // lettering only: it fades with the tint
    gr.ResetTransform();
}
// Each title is drawn once into a small bitmap (the strip at TOP_RES px per unit) and that is mapped onto the case: a
// screen of shelves (a dozen on an ultrawide array) lays out no text while it moves. Kept for the most recent titles.
const TOP_RES = 1.5, TOP_KEEP = 320, TOP_IMG = new Map();
function topStrip(t, look) {
    const key = `${t}|${look.key}`;
    let img = TOP_IMG.get(key);
    if (img) { TOP_IMG.delete(key); TOP_IMG.set(key, img); return img; }
    const T = TOP_STRIP, w = (T.x1 - T.x0) * 100, h = T.y * 200, W2 = Math.ceil(w * TOP_RES), H2 = Math.ceil(h * TOP_RES);
    if (!LABEL_FONTS.top) {
        LABEL_FONTS.top = d2d.Font("Geist Mono Medium", 15, 0); LABEL_FONTS.topB = d2d.Font("Geist Mono SemiBold", 15, 0);
        LABEL_FONTS.topC = d2d.Font("Microsoft YaHei UI", 16, 1);
    }
    const cjk = isCJK(t), face = cjk ? LABEL_FONTS.topC : look.kind === "engrave" ? LABEL_FONTS.topB : LABEL_FONTS.top;
    const SC = new Float32Array([TOP_RES, 0, 0, TOP_RES, 0, 0]);
    // the title in colour c, shifted by (dx, dy) units, on g
    const text = (g, c, dx = 0, dy = 0) => g.DrawText(t, face, c, 12 + dx, dy, w - 20, h, DT_SINGLE | DT_ELLIPSIS);
    const ink = (c, a) => ((Math.round(a) & 255) << 24 | (c & 0xFFFFFF)) >>> 0;
    img = d2d.CreateImage(W2, H2);
    const g = img.GetGraphics();
    if (look.kind === "etch") {
        // the glow: the letters blurred in a bitmap of their own, laid under the crisp ones
        const glow = d2d.CreateImage(W2, H2), gg = glow.GetGraphics();
        gg.SetTransform(SC); text(gg, ink(0xFFFFFF, look.glow)); gg.ResetTransform();
        glow.ReleaseGraphics(gg);
        try { glow.StackBlur(2); } catch (e) { /* no blur: the glow stays crisp */ }
        g.SetTransform(SC);
        if (look.edge) text(g, ink(0, look.edge), 0, .9);
        g.ResetTransform();
        g.DrawImage(glow, 0, 0, W2, H2, 0, 0, W2, H2);
        g.SetTransform(SC);
        text(g, ink(0xFFFFFF, look.core));
    } else {
        g.SetTransform(SC);
        if (look.kind === "label") {
            g.FillSolidRect(0, 0, w, h, look.paper);
            g.FillSolidRect(0, 0, 4, h, C.accent);
            text(g, mix(look.ink, look.paper, TOP_SOFT));
        } else if (look.kind === "engrave") {
            text(g, ink(0xFFFFFF, 150), 0, 1.1);   // the lower wall, lit
            text(g, ink(0, 110), 0, -.5);          // the upper wall, in shade
            text(g, ink(0, 95));                   // the groove
        } else {
            g.FillSolidRect(0, 3, 3, h - 6, ink(C.accent, 235));
            text(g, ink(look.ink === "light" ? 0xF4F2EC : TOP_INK, 230));
        }
    }
    g.ResetTransform();
    img.ReleaseGraphics(g);
    TOP_IMG.set(key, img);
    if (TOP_IMG.size > TOP_KEEP) TOP_IMG.delete(TOP_IMG.keys().next().value);
    return img;
}
// the accent follows the scheme; another skin may be finished otherwise
TOKEN_LISTENERS.push(() => { TOP_IMG.clear(); TOP_LOOK = null; });
CASE_LISTENERS.push(() => { TOP_IMG.clear(); TOP_LOOK = null; });

function drawArchive(gr) {
    THUMB_KEEP.clear();
    const G = arRows();
    if (!G.length) { drawArchiveEmpty(gr); return; }
    const aw = arrayW(), [Ox, Oy] = origin(), k = arK(), meta = CASE_META.array, sz = CASE_META.array_res[0];
    const ax = CASE_META.axes, I = arrayImages();
    const lift = inspLift(), turn = inspTurn(), g = arrayGeom();
    // on an ultrawide array the rows stand further apart (sx, sy: see arrayGeom); the sprites keep their size
    const toScreen = it => [Ox + (it.x * ax.x[0] * g.sx + it.y * ax.y[0] + it.z * ax.z[0]) * k, Oy + (it.x * ax.x[1] * g.sy + it.y * ax.y[1] + it.z * ax.z[1]) * k];
    gr.PushClip(0, 0, aw, H);
    // Shelf by shelf, back to front: a shelf stands wholly behind the shelves in front of it (the camera looks along
    // +x), so each is drawn as one layer: its rail slots and cases back to front, then its front lip if the rail has one.
    const R = railImages(), rows = [...AR.rows].filter(([, r]) => r.pos.x > -1 - frontRows() && r.pos.x < g.count).sort((p, q) => q[1].pos.x - p[1].pos.x);
    AR.hits = [];
    let selItem = null;
    if (!LABEL_LIVE) drawFloor(gr, rows, G, Ox, Oy, k, toScreen);   // the wallpaper takes the floor's place
    for (const [gi, r] of rows) {
        const row = G[gi], albums = row.albums, pos = r.pos.x, x = -pos * ROWP, active = gi === AR.group, [i0, i1] = caseWindow(r, row);
        const nSlots = slotCount(row), items = [];
        // a rail slot sorts just in front of the case behind it and behind the case standing in it
        if (R) for (let s = -1; s <= nSlots; s++) {
            const y = (s - r.scroll.x) * PITCH;
            if (y < -30 || y > 60) continue;
            items.push({ rail: s < 0 ? "front" : s >= nSlots ? "back" : "mid", gi, pos, x, y, z: 0, close: CLOSE[1] * (y + .4) });
        }
        for (let i = i0; i <= i1; i++) {
            const c = r.cases.get(i);
            if (!c) continue;
            const isSel = active && i === r.sel;
            const y = (slotOf(row, i) - r.scroll.x) * PITCH + c.gap.x, z = c.lift.x + (isSel ? LIFT_OUT * lift : 0);
            // where the case rests without the hover lift: its click area (#7), so the lift under the mouse does not
            // move the case being aimed at
            const yr = (slotOf(row, i) - r.scroll.x) * PITCH + c.gap.to, zr = caseTargets(i, r, active, row, -1).lift + (isSel ? LIFT_OUT * lift : 0);
            items.push({ gi, i, c, a: albums[i], active, isSel, pos, x, y, z, yr, zr, close: CLOSE[1] * y + CLOSE[2] * z * .2 });
        }
        items.sort((p, q) => p.close - q.close);
        for (const it of items) {
            const [sx, sy] = toScreen(it);
            if (it.rail) { drawRailSlot(gr, it, sx, sy, k, aw); continue; }
            it.rest = toScreen({ x: it.x, y: it.yr, z: it.zr });
            selItem = drawArrayCase(gr, it, sx, sy, k, aw, I) || selItem;
        }
        drawLip(gr, row, gi, r, x, toScreen, k);
    }
    for (const p of AR.infoPlates) drawInfoPlate(gr, p);
    AR.infoPlates = [];
    if (AR.hoverPlate) {
        const h = AR.hoverPlate, t = [...(h.a.part || h.a.title || tr("UNTITLED"))];
        drawCasePlate(gr, h.a, h.ox, h.oy, h.k, h.alpha, t.length > 40 ? t.slice(0, 39).join("") + "…" : t.join(""));
        AR.hoverPlate = null;
    }
    // the array dissolves into the background towards the file panel and the controls (over the wallpaper, mostly)
    const edge = LABEL_LIVE ? withAlpha(C.bg, .8) : C.bg;
    gr.FillGradRect(aw - dp(100), 0, dp(100) + 1, H, 0, withAlpha(C.bg, 0), edge);
    gr.FillGradRect(0, H - dp(139), aw, dp(80) + 1, 90, withAlpha(C.bg, 0), edge);
    gr.FillSolidRect(0, H - dp(60), aw, dp(60), edge);
    drawSelectNumeral(gr);
    drawRuler(gr);
    drawGroupSwitch(gr);
    if (turn === 0) drawArchiveBar(gr);
    if (turn > 0) drawInspection(gr, turn);
    gr.PopClip();
    // album file
    drawInfoLayer(gr);
}
// the album file, cached as a layer (with the wallpaper under it, when there is one)
function drawInfoLayer(gr) {
    const wp = LABEL_LIVE ? WP.comp : null;
    if (AR.dirtyInfo || !AR.info || AR.info.wp !== wp) { AR.info = renderLayer(W - infoX() + dp(20), H, drawInfo, AR.info); AR.info.wp = wp; AR.dirtyInfo = false; }
    gr.DrawImage(AR.info.img, infoX() - dp(20), 0, AR.info.w, AR.info.h, 0, 0, AR.info.w, AR.info.h);
    infoHits(infoX() - dp(20));
}

// one case of the array at screen point (sx, sy); returns { ox, oy } for the selected one
function drawArrayCase(gr, it, sx, sy, k, aw, I) {
    const meta = CASE_META.array, sz = CASE_META.array_res[0];
    const ox = sx - meta.origin[0] * k, oy = sy - meta.origin[1] * k, S = sz * k;
    if (ox > aw || ox + S < 0 || oy > H || oy + S < 0) return null;
    let selItem = null;
    if (it.isSel) { AR.from = [ox + meta.center[0] * k, oy + meta.center[1] * k]; selItem = { ox, oy }; }
    if (it.isSel && inspTurn() > 0) return selItem;                   // drawn by the inspection
    const alpha = rowAlpha(it.pos), f = rowTint(it.pos), t = thumbOf(it.a);
    // how frosted the case is: its shelf's frost at its place (frostAt), cleared as it is selected (it.c.clear)
    const fr = frostAt(it.pos) * (1 - clamp(it.c.clear.x, 0, 1));
    // cover, under the case: blurred behind frosted glass, the sharp one over it as the glass clears
    if (t) {
        if (fr > .01) quadImage(gr, t.blur, meta.cover, ox, oy, k, alpha);
        if (fr < .99) quadImage(gr, t.img, meta.cover, ox, oy, k, Math.round(alpha * (1 - fr)));
    } else gr.FillPolygon(withAlpha(C.well, alpha / 255), 0, quadPts(meta.cover, ox, oy, k));
    if (f > 0) gr.FillPolygon(withAlpha(fadeBg(), f * alpha / 255), 0, quadPts(meta.cover, ox, oy, k));
    // the case: the clear sprite, the frosted one over it at fr. Where the case is opaque (the same in both) this is
    // exact at every fr; its glass is clear at 0 and at 1 a touch denser than the frosted sprite alone (alphas about
    // 0.12 and 0.63: 0.67), and in between it goes smoothly from one to the other. (Drawing the two at 1 - fr and fr
    // instead let the page show through the whole case halfway.)
    drawTinted(gr, I.clear, "case-clear" + CASE_DIR, f, ox, oy, S, S, sz, sz, alpha);
    const fa = Math.round(alpha * fr);
    if (fa > 0) drawTinted(gr, I.frost, "case" + CASE_DIR, f, ox, oy, S, S, sz, sz, fa);
    // the spine labels belong to the selected shelf: they fade with its place, as a shelf moves into it or out of it
    const la = Math.round(alpha * selness(it.pos));
    if (la > 0) drawSpineLabel(gr, meta.label, ox, oy, k, it.a.no, la);
    const ta = Math.max(titleShow(it.pos, f) * (SHELF_LOOK.sel.titles === "near" ? it.c.near.x : 1), clamp(it.c.hov.x, 0, 1));
    if (ta > .01) drawTopTitle(gr, it.a, ox, oy, k, Math.round(alpha * ta), f);
    // the whole case (front face and top edge) at its resting place answers the mouse, on every shelf in view (a case
    // on another shelf switches to it); the one under it is outlined
    if (alpha > 0) {
        const P = casePoly(), rx = it.rest[0] - meta.origin[0] * k, ry = it.rest[1] - meta.origin[1] * k;
        AR.hits.push({ i: it.i, gi: it.gi, quad: P.map(([px, py]) => [rx + px * k, ry + py * k]) });
        const hovered = it.i === AR.hover && it.gi === AR.hoverRow && !it.isSel && AR.insp === 0;
        if (hovered && AR.hoverMode === "label") AR.hoverPlate = { a: it.a, ox, oy, k, alpha };
        if (hovered && AR.hoverMode === "outline") gr.DrawPolygon(withAlpha(C.accent, alpha / 255), Math.max(HAIR, dp(1.5)), P.flatMap(([px, py]) => [ox + px * k, oy + py * k]));
    }
    // the selected case's info plate, drawn after every shelf (see drawInfoPlate), and its corner marks: coming in as
    // its glass clears, going as another case is selected, the shelf changes or the case is inspected
    const pv = clamp(it.c.plate.x, 0, 1) * clamp((it.c.clear.x - .6) / .4, 0, 1);
    if (pv > .01) {
        AR.infoPlates.push({ a: it.a, ox, oy, k, alpha: Math.round(alpha * pv), sel: it.isSel });
        for (const [px, py] of meta.cover) gr.FillSolidRect(Math.round(ox + px * k - dp(3)), Math.round(oy + py * k - dp(3)), dp(6), dp(6), withAlpha(C.accent, pv));
    }
    return selItem;
}
// The selected case's info plate: its ARC number and track (or its album's track count) on an inverse header, then the
// title, the artist, the album (or the genre), and length, format and year. It is drawn flat once (PLATE_IMG keeps the
// last) and laid on the plane of the case's front, the cover's plane (the case's x and z axes), beside the case and a
// little above it (PLATE_AT: its top-left corner in case model units), so it stands in the scene, slanted like the
// case, and rises with it; a leader runs to it from the cover's corner. Its size is not the case's but the text's own
// (PLATE_SCALE of it, upright), so it stays readable at every array size. It is drawn after every shelf, over them: it
// only shows, nothing on it is clicked.
// PLATE_SLANT: how far its rows lean with the case's front, 0 level … 1 as the cover's edges
const PLATE = { w: 236, res: 2 }, PLATE_AT = { x: 2.45, z: 4.5 }, PLATE_SCALE = .95, PLATE_SLANT = 0, PLATE_MIN = .5, PLATE_WRAP = .85;
const DT_WRAP = 0x00000800 | 0x00000010 | 0x00008000 | 0x00040000;   // NOPREFIX | WORDBREAK | END_ELLIPSIS | EDITCONTROL
const PLATE_IMG = new Map();   // key -> plate: the last few (a plate going and one coming are drawn at once)
// The rows are as tall as their fonts (which follow the text size), the title on up to two lines.
function plateImage(a) {
    const key = `${a.key}|${MODE}|${SCALE}|${TEXT_SCALE}|${C.fg}|${C.bg}|${C.accent}|${C.panel}`;
    if (PLATE_IMG.has(key)) return PLATE_IMG.get(key);
    const al = albumOf(a) || a, isTrack = !!a.album, R = PLATE.res, u = v => dp(v * TEXT_SCALE);
    // a track: its short title, and its work (else its album) on the third line
    const title = a.part || a.title || tr("UNTITLED"), artist = a.artist || "—", third = isTrack ? a.work || al.title || "" : (al.genre || "").toUpperCase();
    const no = isTrack ? a.ord % 1000 : 0, right = isTrack ? `TRK ${no ? pad(no, 2) : "—"} / ${pad(al.tracks, 2)}` : tr("{0} TRACKS", pad(al.tracks, 2));
    const meta = [a.length ? fmtTime(a.length) : "", fmtChip(a, true), a.year || ""].filter(Boolean).join("   ");
    const w = u(PLATE.w), m = u(12), tw = w - 2 * m - dp(2), x = m + dp(2);
    // The layout first, measured on a 1 px bitmap. Text too long for its room is set smaller, down to PLATE_MIN of its
    // size: the title and the work so they fit on two lines (one when they can at their full size), the artist on one.
    const probe = d2d.CreateImage(1, 1), pg = probe.GetGraphics();
    // (by measured widths: two lines are taken to hold PLATE_WRAP of twice the width, for the words that do not fill
    // the first line)
    const fit = (t, size, weight, maxLines) => {
        const room = maxLines > 1 ? tw * 2 * PLATE_WRAP : tw;
        for (let sz = size; ; sz -= .5) {
            const f = fontFor(t, sz, weight), wt = pg.CalcTextWidth(t, f);
            if (wt <= room || sz - .5 < size * PLATE_MIN) return { f, n: wt <= tw ? 1 : maxLines };
        }
    };
    const T = fit(title, 13, 600, 2), fT = T.f, lines = T.n, fA = fit(artist, 10, 400, 1).f, L3 = fit(third, 10, 500, 2), fL = L3.f;
    probe.ReleaseGraphics(pg);
    const fH = font(9, 600), fR = font(9, 500), fM = font(9, 500), hh = Math.ceil(fH.Height + u(9));
    const lineH = f => Math.ceil(f.Height * 1.2);   // a line with its leading: a box of n × Height is too short for n lines
    const tH = lineH(fT) * lines, aH = Math.ceil(fA.Height), lH = L3.n > 1 ? lineH(fL) * 2 : Math.ceil(fL.Height), mH = Math.ceil(fM.Height);
    const yT = hh + u(10), yA = yT + tH + u(3), yL = yA + aH + u(1), yRule = yL + lH + u(8), yM = yRule + u(7), h = yM + mH + u(10);
    const img = d2d.CreateImage(Math.ceil(w * R), Math.ceil(h * R)), g = img.GetGraphics();
    g.SetTransform(new Float32Array([R, 0, 0, R, 0, 0]));
    // header: ARC-#### · TRK 03 / 24 (an album: 12 TRACKS)
    g.FillSolidRect(0, 0, w, hh, C.fg);
    g.DrawText(`ARC-${pad(a.no, 4)}`, fH, C.bg, m, 0, w - 2 * m, hh, DT_SINGLE);
    g.DrawText(right, fR, C.bg, m, 0, w - 2 * m, hh, DT_RIGHT_SINGLE);
    // body: title, artist, album (an album: its genre), a rule, then length, format, year
    g.FillSolidRect(0, hh, w, h - hh, C.panel);
    box(g, 0, hh, w, h - hh, C["line-dim"], 1);
    g.FillSolidRect(0, hh, dp(2), h - hh, C.accent);
    g.DrawText(title, fT, C.fg, x, yT, tw, tH, lines > 1 ? DT_WRAP : DT_SINGLE | DT_ELLIPSIS);
    g.DrawText(artist, fA, C["fg-soft"], x, yA, tw, aH, DT_SINGLE | DT_ELLIPSIS);
    g.DrawText(third, fL, C.fg, x, yL, tw, lH, L3.n > 1 ? DT_WRAP : DT_SINGLE | DT_ELLIPSIS);
    g.FillSolidRect(x, yRule, tw, 1, C["line-dim"]);
    g.DrawText(meta, fM, C["text-muted"], x, yM, tw, mH, DT_SINGLE | DT_ELLIPSIS);
    g.ResetTransform();
    img.ReleaseGraphics(g);
    const plate = { key, img, w, h, hh };
    PLATE_IMG.set(key, plate);
    if (PLATE_IMG.size > 4) PLATE_IMG.delete(PLATE_IMG.keys().next().value);
    return plate;
}
TOKEN_LISTENERS.push(() => PLATE_IMG.clear());
// p: { a, ox, oy, k, alpha }: the selected case's sprite at (ox, oy), k sprite px -> screen px
function drawInfoPlate(gr, p) {
    if (p.alpha <= 0) return;
    const P = plateImage(p.a), m = CASE_META.array.origin, ax = CASE_META.axes;
    const at = (x, y, z) => [p.ox + (m[0] + x * ax.x[0] + y * ax.y[0] + z * ax.z[0]) * p.k, p.oy + (m[1] + x * ax.x[1] + y * ax.y[1] + z * ax.z[1]) * p.k];
    // the plate's axes: its rows along the case's x on screen (as far as PLATE_SLANT leans them), its columns along z,
    // each PLATE_SCALE px per plate px (not stretched by the x axis being longer on screen than z)
    const nx = Math.hypot(ax.x[0], ax.x[1]), rx = 1 + (ax.x[0] / nx - 1) * PLATE_SLANT, ry = ax.x[1] / nx * PLATE_SLANT, nr = Math.hypot(rx, ry);
    const sz = PLATE_SCALE / Math.hypot(ax.z[0], ax.z[1]), o = at(PLATE_AT.x, -.23, PLATE_AT.z);
    QM[0] = rx / nr * PLATE_SCALE; QM[1] = ry / nr * PLATE_SCALE; QM[2] = -ax.z[0] * sz; QM[3] = -ax.z[1] * sz; QM[4] = o[0]; QM[5] = o[1];
    // the leader: from the cover's top corner to the middle of the plate's header, the last stretch level with it
    const c = CASE_META.array.cover[1], x1 = p.ox + c[0] * p.k + dp(4), y1 = p.oy + c[1] * p.k - dp(4);
    const ex = o[0] + QM[2] * P.hh / 2, ey = o[1] + QM[3] * P.hh / 2, col = withAlpha(C.fg, p.alpha / 255);
    gr.DrawLine(x1, y1, ex - dp(14), ey, HAIR, col);
    gr.DrawLine(ex - dp(14), ey, ex, ey, HAIR, col);
    gr.SetTransform(QM);
    gr.DrawImage(P.img, 0, 0, P.w, P.h, 0, 0, P.img.Width, P.img.Height, 0, p.alpha);
    gr.ResetTransform();
    // where the selected case's plate was last drawn: an inspection carries it from there (see drawInspection)
    if (p.sel) AR.plateFrom = { key: p.a.key, qm: Array.from(QM), alpha: p.alpha };
}
// a plate led out from the top corner of a case's cover: the title (the album's, or the song's when every track is its
// own item) for the one under the mouse in "label" mode
function drawCasePlate(gr, a, ox, oy, k, alpha = 255, txt = `ARC-${pad(a.no, 4)}`) {
    const top = CASE_META.array.cover[1], x1 = ox + top[0] * k + dp(4), y1 = oy + top[1] * k - dp(4), lx = x1 + dp(26), ly = y1 - dp(30);
    const fg = withAlpha(C.fg, alpha / 255), s = st(AR_ST.plate, C.bg, C.fg);
    gr.DrawLine(x1, y1, lx, ly, HAIR, fg);
    gr.DrawLine(lx, ly, lx + dp(60), ly, HAIR, fg);
    const pw = labelWidth(txt, s) + dp(16);
    gr.FillSolidRect(lx + dp(60), ly - dp(9), pw, dp(18), fg);
    label(gr, txt, s, lx + dp(68), ly - Math.round(labelHeight(AR_ST.plate) / 2));
}

// a case's outline in sprite px: its front face and top edge (case model units: 4 wide, 3.5 high, 0.46 deep)
let CASE_POLY = null;
function casePoly() {
    if (CASE_POLY && CASE_POLY.meta === CASE_META) return CASE_POLY;   // made again for another skin's case.json
    const m = CASE_META.array.origin, ax = CASE_META.axes, at = (x, y, z) => [m[0] + x * ax.x[0] + y * ax.y[0] + z * ax.z[0], m[1] + x * ax.x[1] + y * ax.y[1] + z * ax.z[1]];
    CASE_POLY = [at(-2, -.23, 0), at(2, -.23, 0), at(2, -.23, 3.5), at(2, .23, 3.5), at(-2, .23, 3.5), at(-2, -.23, 3.5)];
    CASE_POLY.meta = CASE_META;
    return CASE_POLY;
}

// Shelf looks. Every shelf in view is drawn, each by where it stands, as set in the Style view (SHELVES ›) and kept in
// the setting "shelfLook" (SHELF_LOOK_START is the look the theme ships with):
//   sel    the selected shelf: frost (how frosted its cases are but for the selected one, 0 clear … 1 the frosted
//          sprite); titles: "all", or "near" the selection (on every shelf, around its own selected case); off is the
//          context menu's "Titles on the cases' top edges", which turns them off everywhere; style: how the titles are
//          finished, "material" (by the case: printed, engraved, etched) or "label" (see TOP_STYLES)
//   back   the shelves behind, up and to the left: frost, or "distance": from the selected shelf's frost up to full
//          FROST_DISTANCE shelves away; fade (towards the page, the further back the more: 0 none … 1.5 strong);
//          titles ("auto": while faded less than half)
//   front  the shelves in front, down and to the right: frost, fade and titles as behind, then how many (rows; not on
//          an ultrawide array, which shows its shelves side by side) and how see-through (opacity)
// Any case on any of them can be hovered and clicked: a click on another shelf's case switches to it.
const SHELF_LOOK_START = { sel: { frost: 1, titles: "near", style: "material" }, back: { frost: 1, fade: 1, titles: "auto" },
                           front: { frost: 1, fade: 1, titles: "off", rows: 2, opacity: .6 } };
const FROST_DISTANCE = 3;
// what each setting can be: [value, label] (the Style view's toggles); the other shelves' frost can also go by
// distance (lookOpts)
const SHELF_LOOK_OPTS = {
    frost: [[0, "OFF"], [.35, "FAINT"], [.65, "MEDIUM"], [1, "STRONG"]],
    selTitles: [["all", "ALL"], ["near", "NEAR SELECTION"]],
    style: [["material", "BY MATERIAL"], ["label", "LABEL"]],
    fade: [[0, "OFF"], [.5, "FAINT"], [1, "MEDIUM"], [1.5, "STRONG"]],
    titles: [["auto", "AUTO"], ["on", "ON"], ["off", "OFF"]],
    rows: [[0, "0"], [1, "1"], [2, "2"], [3, "3"]],
    opacity: [[.3, "30%"], [.45, "45%"], [.6, "60%"], [.8, "80%"], [1, "100%"]],
};
const lookOpts = (kind, key) => kind === "sel" && key === "titles" ? SHELF_LOOK_OPTS.selTitles
    : key === "frost" && kind !== "sel" ? SHELF_LOOK_OPTS.frost.concat([["distance", "BY DISTANCE"]]) : SHELF_LOOK_OPTS[key];
const SHELF_LOOK = (() => {
    const look = JSON.parse(JSON.stringify(SHELF_LOOK_START));
    let saved = {};
    try { saved = JSON.parse(getSetting("shelfLook", "{}")) || {}; } catch (e) { /* the look the theme ships with */ }
    for (const kind in look) for (const key in look[kind]) {
        let v = saved[kind] && saved[kind][key];
        if (key === "frost" && typeof v === "boolean") v = v ? 1 : 0;   // frost was on or off before it had strengths
        if (lookOpts(kind, key).some(([o]) => o === v)) look[kind][key] = v;
    }
    return look;
})();
// kind: sel, back or front; key: one of its settings (sel's titles also "off": the context menu's setting); returns
// false when the value is not one it can be
function setShelfLook(kind, key, v) {
    if (kind === "sel" && key === "titles" && v === "off") { AR.topTitles = false; setSetting("caseTopTitles", false); }
    else if (!SHELF_LOOK[kind] || !(key in SHELF_LOOK[kind]) || !lookOpts(kind, key).some(([o]) => o === v)) return false;
    else {
        SHELF_LOOK[kind][key] = v;
        setSetting("shelfLook", JSON.stringify(SHELF_LOOK));
        if (key === "style") TOP_LOOK = null;
        if (kind === "sel" && key === "titles") { AR.topTitles = true; setSetting("caseTopTitles", true); }
    }
    if (ARCHIVE_ON) requestVisibleThumbs();
    clock.wake(); window.Repaint();
    return true;
}
function resetShelfLook() {
    for (const kind in SHELF_LOOK_START) Object.assign(SHELF_LOOK[kind], SHELF_LOOK_START[kind]);
    TOP_LOOK = null;
    setShelfLook("sel", "titles", SHELF_LOOK_START.sel.titles);
}
const frontRows = () => arrayGeom().wide ? 0 : SHELF_LOOK.front.rows;
// rows fade in at the back; in front they turn see-through, then fade out beyond the last one shown
const rowAlpha = pos => {
    const n = frontRows(), front = pos >= 0 ? 1 : !n ? clamp(1 + pos, 0, 1) : lerp(1, SHELF_LOOK.front.opacity, clamp(-pos, 0, 1)) * clamp(n + 1 + pos, 0, 1);
    return Math.round(255 * front * clamp((arrayGeom().count - pos) / .8, 0, 1));
};
// how much of the front shelves' look a row has: 0 behind the selected shelf (and the selected one), 1 a shelf or
// more in front of it, in between while it moves from one to the other (so its fade and titles change smoothly)
const frontness = pos => clamp(AR.group - arrayStart() - pos, 0, 1);
// how far a row is tinted towards the background, smoothly as it moves (drawTinted draws the sprites between their
// 0.1 steps): by its distance from the front row (the selected one), or on an ultrawide array from the selected row,
// times its kind's fade; the floor may fade them less (floor.json "tint")
const rowTint = pos => {
    const mul = lerp(SHELF_LOOK.back.fade, SHELF_LOOK.front.fade, frontness(pos));
    if (!mul) return 0;
    const g = arrayGeom(), floor = FLOOR.meta && FLOOR.meta.tint != null ? FLOOR.meta.tint : 1;
    if (!g.wide) { const d = Math.abs(pos); return clamp((.38 * Math.min(d, 1) + .14 * d) * mul, 0, .9) * floor; }
    const distance = Math.abs(pos - (AR.group - arrayStart()));
    return clamp((.32 * Math.min(distance, 1) + .24 * distance / Math.max(1, g.count - 1)) * mul, 0, .9) * floor;
};
// how much a row is in the selected shelf's place: 1 there, 0 half a shelf or more away (on an ultrawide array, whose
// rows do not move to it, it is the selected one or not)
const selness = pos => clamp(1 - Math.abs(pos - (AR.group - arrayStart())) * 2, 0, 1);
// How far a case is from the selected one, for the titles "near" the selection: along the rows in slots (dy: the
// difference of their places on screen, scrolls taken in), across them TITLE_ROW slots a shelf (dr), so the titles
// cluster round the selected case on its own shelf and the ones by it, rather than round every shelf's own selection.
const TITLE_ROW = 3;
const titleDistance = (dy, dr) => Math.hypot(dy, dr * TITLE_ROW);
// how much the titles on a case's top edge show (0 … 1) at tint f: "auto" while the row is faded less than half,
// fading out from 0.4 to 0.5 rather than going at once; a row moving between the selected shelf's place, behind and
// in front blends their settings
// how frosted a shelf's cases are (0 … 1) at its place, blending the kinds' settings as a shelf moves between them
function frostAt(pos) {
    const L = SHELF_LOOK, sel = L.sel.frost, d = Math.abs(pos - (AR.group - arrayStart()));
    const of = v => v === "distance" ? lerp(sel, 1, clamp(d / FROST_DISTANCE, 0, 1)) : v;
    return lerp(lerp(of(L.back.frost), of(L.front.frost), frontness(pos)), sel, selness(pos));
}
function titleShow(pos, f) {
    if (!AR.topTitles) return 0;
    const auto = clamp((.5 - f) / .1, 0, 1), of = m => m === "on" ? 1 : m === "auto" ? auto : 0;
    return lerp(lerp(of(SHELF_LOOK.back.titles), of(SHELF_LOOK.front.titles), frontness(pos)), auto, selness(pos));
}

// The shelf's front lip, an optional look (lip-*.png, described by rail.json → lip; the shipped rail has none, so this
// draws nothing), drawn after everything standing on the shelf, then its print on the pale face panel, mapped like the spine label (100 units per world unit along the row,
// down the panel): the ∞ emblem on the front end, each group's name where it starts on the shelf (with its size),
// slot numbers under the slots, hazard stripes on the back end.
const LIP_INK = 0xFF1B1C18, LIP_SOFT = 0xFF77766F;
function drawLip(gr, row, gi, r, x, toScreen, k) {
    const L = RAIL_META && RAIL_META.lip, R = ARIMG.rail;
    if (!L || !R || !R["lip-mid"]) return;
    const pos = r.pos.x, alpha = rowAlpha(pos), aw = arrayW(), n = slotCount(row);
    if (alpha <= 0) return;
    for (let sl = -1; sl <= n; sl++) {
        const y = (sl - r.scroll.x) * PITCH;
        if (y < -30 || y > 60) continue;
        const [sx, sy] = toScreen({ x, y, z: 0 });
        drawRailSlot(gr, { rail: sl < 0 ? "lip-front" : sl >= n ? "lip-back" : "lip-mid", gi, pos }, sx, sy, k, aw);
    }
    const f = rowTint(pos);
    if (f >= .5) return;   // too far back to read
    const tone = c => withAlpha(mix(c, fadeBg(), f), alpha / 255);
    const y0 = -.5 - r.scroll.x, lx = x + L.x, o = toScreen({ x: lx, y: y0, z: L.z1 }), u = toScreen({ x: lx, y: y0 + 1, z: L.z1 }), v = toScreen({ x: lx, y: y0, z: L.z1 - 1 });
    QM[0] = (u[0] - o[0]) / 100; QM[1] = (u[1] - o[1]) / 100; QM[2] = (v[0] - o[0]) / 100; QM[3] = (v[1] - o[1]) / 100; QM[4] = o[0]; QM[5] = o[1];
    const ph = (L.z1 - L.z0) * 100;   // panel height in units
    if (!LABEL_FONTS.lip) {
        LABEL_FONTS.lip = d2d.Font("Geist Mono SemiBold", 30, 0); LABEL_FONTS.lipC = d2d.Font("Microsoft YaHei UI", 28, 1);
        LABEL_FONTS.lipS = d2d.Font("Geist Mono Medium", 13, 0); LABEL_FONTS.lipN = d2d.Font("Geist Mono", 12, 0);
    }
    gr.SetTransform(QM);
    // front end: the emblem on an ink plate and the shelf number
    gr.FillSolidRect(-84, 10, 76, ph - 20, tone(LIP_INK));
    drawEmblem(gr, 0, -84, 10, 76, ph * .55, 11, tone(0xFFF2F1EC));
    gr.DrawText(`SHELF
${pad(gi + 1, 2)}`, LABEL_FONTS.lipS, tone(0xFFF2F1EC), -84, 10 + ph * .52, 76, ph * .45 - 20, 0x00000800 | 0x00000001);
    // the groups on this shelf
    row.segs.forEach((g, j) => {
        const ux = g.slot * 100 + 6, next = j + 1 < row.segs.length ? row.segs[j + 1].slot - 1 : n, w = (next - g.slot) * 100 - 16;
        gr.FillSolidRect(ux, 16, 8, 8, tone(C.accent));
        gr.DrawText(groupName(g.name), isCJK(groupName(g.name)) ? LABEL_FONTS.lipC : LABEL_FONTS.lip, tone(LIP_INK), ux + 16, 4, Math.max(40, w - 16), 36, DT_SINGLE | DT_ELLIPSIS);
        const meta = `${LIB.groupBy === "none" ? "" : tr(GROUP_LABEL[LIB.groupBy]) + " " + pad(g.gi + 1, 2) + "  ·  "}${unitWord(g.total)}${g.parts > 1 ? `  ·  ${g.part} / ${g.parts}` : ""}`;
        gr.DrawText(meta, LABEL_FONTS.lipS, tone(LIP_SOFT), ux + 16, 42, Math.max(40, w - 16), 18, DT_SINGLE | DT_ELLIPSIS);
    });
    // slot numbers and ticks along the bottom of the panel
    gr.FillSolidRect(0, ph - 26, n * 100, 1.2, tone(LIP_SOFT));
    for (let sl = 0; sl < n; sl++) {
        gr.FillSolidRect(sl * 100, ph - 32, 1.2, 12, tone(LIP_SOFT));
        gr.DrawText(pad(sl + 1, 2), LABEL_FONTS.lipN, tone(LIP_SOFT), sl * 100, ph - 22, 100, 16, DT_CENTER_SINGLE);
    }
    // back end: hazard stripes
    gr.PushClip(n * 100 + 8, 10, 70, ph - 20);
    for (let hx = n * 100 + 8 - ph; hx < n * 100 + 78; hx += 24) gr.FillPolygon(tone(C.accent), 0, [hx, ph - 10, hx + ph - 20, 10, hx + ph - 8, 10, hx + 12, ph - 10]);
    gr.PopClip();
    gr.ResetTransform();
}

function drawArchiveEmpty(gr) {
    const t = LIB.filter ? tr("NOTHING MATCHES \"{0}\"", LIB.filter.toUpperCase()) : tr(LIB.live ? "NO ALBUMS · THE MEDIA LIBRARY AND THE PLAYLISTS ARE EMPTY" : "INDEXING LIBRARY …");
    label(gr, t, st(AR_ST.meta, C["text-muted"]), arrayW() / 2, H / 2 - dp(6), 1);
    // nothing to show yet: a way to the media library's folders (Preferences › Media Library)
    if (LIB.live && !LIB.filter) {
        const bt = tr("+ ADD MUSIC FOLDER"), bw = labelWidth(bt, st(AR_ST.btn, 0)) + dp(36), bh = dp(40);
        const bx = Math.round(arrayW() / 2 - bw / 2), by = Math.round(H / 2 + dp(26));
        gr.FillSolidRect(bx, by, bw, bh, C.fg);
        label(gr, bt, st(AR_ST.btn, C.bg, C.fg), bx + dp(18), by + Math.round((bh - labelHeight(AR_ST.btn)) / 2));
        hits.add("ar-addmusic", bx, by, bw, bh);
    }
    drawArchiveBar(gr);
}
// foobar2000's Media Library page, where music folders are added (Library › Configure)
function addMusicFolder() { if (!fb.RunMainMenuCommand("Library/Configure")) fb.ShowPreferences(); }

// FILTER · "word" · 12 ALBUMS  ×   (top left, while the header's search filters the archive)
function drawFilterChip(gr, x = dp(32), y = dp(22)) {
    if (!LIB.filter) return 0;
    const h = dp(22);
    const s = st(AR_ST.key, C.bg, C.fg), t = `${tr("FILTER")}  ·  "${LIB.filter.toUpperCase()}"  ·  ${unitWord(filteredCount())}`;
    const w = labelWidth(t, s) + dp(20);
    gr.FillSolidRect(x, y, w, h, C.fg);
    gr.FillSolidRect(x, y, dp(4), h, C.accent);
    label(gr, t, s, x + dp(12), y + Math.round((h - labelHeight(AR_ST.key)) / 2));
    box(gr, x + w, y, h, h, C.fg);
    gr.DrawLine(x + w + dp(7), y + dp(7), x + w + h - dp(7), y + h - dp(7), HAIR, C.fg);
    gr.DrawLine(x + w + h - dp(7), y + dp(7), x + w + dp(7), y + h - dp(7), HAIR, C.fg);
    hits.add("ar-filter", x, y, w + h, h);
    return w + h;
}

// ALBUM / SELECT 05 / 12
function drawSelectNumeral(gr) {
    const g = curGroup(), x = dp(24), y = H - dp(150);
    label(gr, tr(showTracks() ? "TRACK / SELECT" : "ALBUM / SELECT"), st(AR_ST.sel, C["text-muted"]), x, y);
    const f = font(56, 300), cell = Math.round(gr.CalcTextWidth("0", f, true)), h = Math.ceil(f.Height);
    const w = drawRoll(gr, AR.selRoll, f, C.fg, x - dp(3), y + dp(14), cell, h);
    gr.DrawText(`/ ${pad(g.albums.length, AR.selRoll.to.length)}`, font(16, 400), C["text-muted"], x + w + dp(12), y + dp(14) + h - dp(34), dp(120), dp(24), DT_SINGLE);
}

// album index: one mark per album (a window of them in long rows), ↓ ↑ at the ends (as the keys: ↑ goes up the
// shelf, to the next album)
function drawRuler(gr) {
    const r = AR.rows.get(AR.group);
    if (!r) return;
    const n = curGroup().albums.length, M = rulerCount(), step = dp(RULER_STEP), x0 = rulerX0(), y0 = H - dp(48);
    const s0 = AR.rulerStart.x;
    gr.DrawText("↓", font(16, 400), C.fg, x0 - dp(40), y0 - dp(16), dp(24), dp(24), DT_CENTER_SINGLE);
    gr.DrawText("↑", font(16, 400), C.fg, x0 + Math.min(n, M) * step + dp(14), y0 - dp(16), dp(24), dp(24), DT_CENTER_SINGLE);
    hits.add("ar-prev", x0 - dp(44), y0 - dp(20), dp(32), dp(32));
    hits.add("ar-next", x0 + Math.min(n, M) * step + dp(10), y0 - dp(20), dp(32), dp(32));
    gr.PushClip(x0 - dp(4), y0 - dp(30), Math.min(n, M) * step + dp(4), dp(60));
    for (const [i, s] of AR.ticks) {
        const x = Math.round(x0 + (i - s0) * step), h = dp(s.x), on = i === r.sel;
        gr.FillSolidRect(x, Math.round(y0 - h / 2 - dp(4)), on ? dp(3) : dp(2), h, on ? C.fg : C["line-dim"]);
    }
    gr.PopClip();
    AR.rulerGeom = { x0, y0, step, s0, n, M };
    hits.add("ar-ruler", x0 - dp(4), y0 - dp(24), Math.min(n, M) * step + dp(4), dp(40));
    // the album under the mouse (or under a drag along the index), named on a plate above its mark (#8)
    const ht = AR.hoverTick, a = ht >= 0 ? curGroup().albums[ht] : null;
    if (a) {
        const s = st(AR_ST.plate, C.bg, C.fg), t = fitLabel(`${pad(ht + 1, 2)}  ${a.part || a.title || tr("UNTITLED")}`, s, dp(280)), w = labelWidth(t, s) + dp(16), h = dp(20);
        const mx = Math.round(x0 + (ht - s0) * step), px = clamp(mx - Math.round(w / 2), dp(8), arrayW() - w - dp(8)), py = y0 - dp(46);
        gr.FillSolidRect(mx, py + h, HAIR, dp(10), C.fg);
        gr.FillSolidRect(px, py, w, h, C.fg);
        label(gr, t, s, px + dp(8), py + Math.round((h - labelHeight(AR_ST.plate)) / 2));
    }
}
// a drag along the album index (#8): from a press on it until the release, wherever the mouse goes
function rulerTickAt(x) { const R = AR.rulerGeom; return R ? clamp(Math.round((x - R.x0) / R.step + R.s0), 0, R.n - 1) : -1; }
function rulerDown(x) { if (!AR.rulerGeom || AR.inspOn) return; pickStop(); AR.rulerDrag = true; AR.hoverTick = rulerTickAt(x); clock.wake(); }
function rulerMove(x) { const t = rulerTickAt(x); if (t !== AR.hoverTick) { AR.hoverTick = t; clock.wake(); } }
function rulerUp() {
    AR.rulerDrag = false;
    const r = AR.rows.get(AR.group);
    if (r && AR.hoverTick >= 0) moveAlbum(AR.hoverTick - r.sel);
    clock.wake();
}

// ← SHELF 01 / 08  AMBIENT →
function drawGroupSwitch(gr) {
    const g = curGroup(), cx = Math.round(arrayW() * .774), y = H - dp(82);
    const lbl = tr("SHELF") + " ", tail = ` / ${pad(arRows().length, 2)}`, s = st(AR_ST.sel, C["text-muted"]);
    const f = font(9, 500), cell = Math.round(gr.CalcTextWidth("0", f, true) + .14 * dp(9));
    const w = labelWidth(lbl, s) + cell * 2 + labelWidth(tail, s), x = cx - w / 2;
    label(gr, lbl, s, x, y);
    drawRoll(gr, AR.groupRoll, f, C["text-muted"], x + labelWidth(lbl, s), y, cell, labelHeight(AR_ST.sel));
    label(gr, tail, s, x + labelWidth(lbl, s) + cell * 2, y);
    label(gr, fitLabel(groupName(g.name), st(AR_ST.group, 0), dp(180)), st(AR_ST.group, C.fg), cx, y + dp(16), 1);
    const can = d => AR.group + d >= 0 && AR.group + d < arRows().length;
    // ← the next shelf (behind, to the left on screen) · → the one before (towards the front)
    gr.DrawText("←", font(16, 400), can(1) ? C.fg : C["line-dim"], cx - dp(110), y + dp(2), dp(24), dp(24), DT_CENTER_SINGLE);
    gr.DrawText("→", font(16, 400), can(-1) ? C.fg : C["line-dim"], cx + dp(86), y + dp(2), dp(24), dp(24), DT_CENTER_SINGLE);
    hits.add("ar-gnext", cx - dp(116), y - dp(4), dp(36), dp(36));
    hits.add("ar-gprev", cx + dp(80), y - dp(4), dp(36), dp(36));
}

// the inspected case's final scale: ×2 of its size in the row, × the inspection size (MENU › Audio Archive or the Style
// view), but never larger than fits the array area with the caption above and the button below
function inspectK(k0) {
    const last = CASE_META.inspect[CASE_META.inspect.length - 1], c = last.crop || [0, 0, ...CASE_META.inspect_res];
    const fit = Math.min(arrayW() * .9 / c[2], (H - dp(190)) / c[3]);
    return Math.max(k0, Math.min(k0 * INSPECT_ZOOM * (STATE.inspectScale || 1), fit));
}
// inspection, stage 2 (e: 0 lifted above its row … 1 in front): the case moves to the middle, grows ×2 and turns
// square-on through the evenly spaced pre-rendered frames; between two frames the next one fades in over the current
// one and the cover and label quads are interpolated, so the turn has no visible steps
// The inspection frames name the cover's and the spine label's corners and the origin, not the case's axes. An affine
// camera fitted to them per frame maps the case's top edge onto the frame, so its title goes with the case as it starts
// to turn: least squares over those nine points, placed on the case from the array view's axes (the cover on the front,
// y = -0.23; the label on the side, x = 2.3). It holds closely in the first frames (none off in the first, about 7 px
// in 900 a third of the way); the title has faded by the time it would not (see drawInspection).
function inspectCam(i) {
    const M = CASE_META.inspect[i];
    if (M.cam) return M.cam;
    const A = CASE_META.axes, O = CASE_META.array.origin, col = [A.x, A.y, A.z];
    // a point of the array view on the plane where model axis `fixed` is `val`: its model coordinates
    const model = (pt, fixed, val) => {
        const [i1, i2] = [0, 1, 2].filter(j => j !== fixed), r0 = pt[0] - O[0] - col[fixed][0] * val, r1 = pt[1] - O[1] - col[fixed][1] * val;
        const det = col[i1][0] * col[i2][1] - col[i2][0] * col[i1][1], p = [0, 0, 0];
        p[i1] = (r0 * col[i2][1] - col[i2][0] * r1) / det; p[i2] = (col[i1][0] * r1 - r0 * col[i1][1]) / det; p[fixed] = val;
        return p;
    };
    const X = [...CASE_META.array.cover.map(pt => model(pt, 1, -.23)), ...CASE_META.array.label.map(pt => model(pt, 0, 2.3)), [0, 0, 0]].map(p => [...p, 1]);
    const S = [...M.cover, ...M.label, M.origin];
    // the normal equations (XᵀX) c = Xᵀs, one per screen coordinate, by Gaussian elimination
    const solve = d => {
        const N = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => X.reduce((n, x) => n + x[r] * x[c], 0)).concat(X.reduce((n, x, j) => n + x[r] * S[j][d], 0)));
        for (let c = 0; c < 4; c++) {
            let piv = c;
            for (let r = c + 1; r < 4; r++) if (Math.abs(N[r][c]) > Math.abs(N[piv][c])) piv = r;
            [N[c], N[piv]] = [N[piv], N[c]];
            for (let r = 0; r < 4; r++) if (r !== c) { const q = N[r][c] / N[c][c]; for (let j = c; j < 5; j++) N[r][j] -= q * N[c][j]; }
        }
        return N.map((row, r) => row[4] / row[r]);
    };
    M.cam = [solve(0), solve(1)];
    return M.cam;
}
function drawInspection(gr, e) {
    const frames = ARIMG.inspect, a = curAlbum(), aw = arrayW();
    gr.FillSolidRect(0, 0, aw, H, withAlpha(C.bg, .82 * e));
    if (!frames || !a) return;
    const n = frames.length, x = e * (n - 1), i0 = Math.min(n - 2, Math.floor(x)), f = clamp(x - i0, 0, 1);
    const M0 = CASE_META.inspect[i0], M1 = CASE_META.inspect[i0 + 1], full = CASE_META.inspect_res;
    const k0 = arK() * CASE_META.array_ppu / CASE_META.inspect_ppu, k = lerp(k0, inspectK(k0), e);
    // the case comes to rest left of the middle as far as the info plate needs room on its right
    const P = plateImage(a), kEnd = inspectK(k0), last = CASE_META.inspect[n - 1], lc = last.crop || [0, 0, full[0], full[1]];
    const rightOf = (lc[0] + lc[2] - last.center[0]) * kEnd, leftOf = (last.center[0] - lc[0]) * kEnd;
    const cxEnd = Math.min(aw * .49, Math.max(leftOf + dp(16), aw - dp(24) - P.w - dp(40) - rightOf));
    const cx = lerp(AR.from[0], cxEnd, e), cy = lerp(AR.from[1], H * .5, e);
    // the info plate's place by the case at rest: right of it, its header level with the cover's top corner
    const oxEnd = cxEnd - last.center[0] * kEnd, oyEnd = H * .5 - last.center[1] * kEnd;
    const plateTo = [1, 0, 0, 1, Math.round(Math.min(aw - dp(16) - P.w, cxEnd + rightOf + dp(40))), Math.round(oyEnd + last.cover[1][1] * kEnd - P.hh / 2)];
    const ox = cx - M0.center[0] * k, oy = cy - M0.center[1] * k;
    const mixQ = (A, B) => A.map((p, j) => [lerp(p[0], B[j][0], f), lerp(p[1], B[j][1], f)]);
    const coverQ = mixQ(M0.cover, M1.cover), labelQ = mixQ(M0.label, M1.label);
    const big = cover(albumFirst(a), () => window.Repaint()), t = thumbOf(a);
    const cov = big && big.img ? big.img : t ? t.img : null;
    if (cov) quadImage(gr, cov, coverQ, ox, oy, k);
    else gr.FillPolygon(C.well, 0, quadPts(coverQ, ox, oy, k));
    const frame = (img, M, alpha) => {
        const c = M.crop || [0, 0, full[0], full[1]];
        gr.DrawImage(img, ox + c[0] * k, oy + c[1] * k, c[2] * k, c[3] * k, 0, 0, img.Width, img.Height, 0, alpha);
    };
    frame(frames[i0], M0, 255);
    if (f > .01) frame(frames[i0 + 1], M1, Math.round(255 * f));
    drawSpineLabel(gr, labelQ, ox, oy, k, a.no);
    // The info plate goes from where it stood by the case in the array (AR.plateFrom: its transform there) to its place
    // by the case at rest, as the case turns, and back; the leader stays on the cover's corner.
    const from = AR.plateFrom && AR.plateFrom.key === a.key ? AR.plateFrom : { qm: plateTo, alpha: 0 };
    const pm = from.qm.map((v, j) => lerp(v, plateTo[j], e)), pa = Math.round(lerp(from.alpha, 255, e));
    if (pa > 0) {
        const cq = [ox + coverQ[1][0] * k, oy + coverQ[1][1] * k], lx = pm[4] + pm[2] * P.hh / 2, ly = pm[5] + pm[3] * P.hh / 2;
        gr.DrawLine(cq[0] + dp(4), cq[1] - dp(4), lx, ly, HAIR, withAlpha(C.fg, pa / 255));
        for (let j = 0; j < 6; j++) QM[j] = pm[j];
        gr.SetTransform(QM);
        gr.DrawImage(P.img, 0, 0, P.w, P.h, 0, 0, P.img.Width, P.img.Height, 0, pa);
        gr.ResetTransform();
    }
    // the title on the case's top edge goes with it as it starts to turn, and fades as the top turns out of sight
    const ta = AR.topTitles ? clamp(1 - e / .3, 0, 1) : 0;
    if (ta > .01) {
        const c0 = inspectCam(i0), c1 = inspectCam(i0 + 1), pr = (c, X, Y, Z) => [0, 1].map(d => c[d][0] * X + c[d][1] * Y + c[d][2] * Z + c[d][3]);
        drawTopTitle(gr, a, 0, 0, 0, Math.round(255 * ta), 0, (X, Y, Z) => {
            const p0 = pr(c0, X, Y, Z), p1 = pr(c1, X, Y, Z);
            return [ox + lerp(p0[0], p1[0], f) * k, oy + lerp(p0[1], p1[1], f) * k];
        });
    }
    if (e > .85) {
        const q = coverQ.map(([px, py]) => [ox + px * k, oy + py * k]), al = (e - .85) / .15;
        for (const [px, py] of q) gr.FillSolidRect(Math.round(px - dp(3)), Math.round(py - dp(3)), dp(6), dp(6), withAlpha(C.accent, al));
        if (al > .5) {
            // the text above and the button below keep clear of the case's edges (the frame's crop is the case's box)
            const c = M1.crop, left = Math.round(c ? ox + c[0] * k : q[0][0]);
            const top = c ? oy + c[1] * k : q[0][1] - dp(40), bottom = c ? oy + (c[1] + c[3]) * k : q[3][1] + dp(20);
            // the case itself: a click plays it and puts it back (a click anywhere else only puts it back)
            if (c) hits.add("ar-inspected", ox + c[0] * k, oy + c[1] * k, c[2] * k, c[3] * k);
            else { const xs = q.map(p => p[0]), ys = q.map(p => p[1]); hits.add("ar-inspected", Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }
            const y2 = Math.round(top - dp(16) - labelHeight(AR_ST.inspM)), y1 = y2 - dp(6) - labelHeight(AR_ST.insp);
            label(gr, `${tr("INSPECTION")}  ·  ARC-${pad(a.no, 4)}`, st(AR_ST.insp, C.fg), left, y1);
            const sub = a.album ? (albumOf(a) || {}).title || "" : tr("{0} TRACKS", pad(a.tracks, 2));
            // the group by its shown name (an album's is keyed with its artist); grouped by album it is the album, said already
            const grp = LIB.groupBy === "album" || !a.grp ? "" : `  ·  ${groupName(a.grp)}`;
            label(gr, `${fmtChip(a)}  ·  ${sub}${grp}`, st(AR_ST.inspM, C["text-muted"]), left, y2);
            // ← RETURN TO ARCHIVE
            const bx = left, by = Math.round(bottom + dp(16)), bs = st(AR_ST.btn, C.fg), bw = labelWidth("←  RETURN TO ARCHIVE", bs) + dp(22), bh = dp(26);
            gr.FillSolidRect(bx, by, bw, bh, C.bg);
            box(gr, bx, by, bw, bh, C.fg);
            label(gr, "←  RETURN TO ARCHIVE", bs, bx + dp(11), by + Math.round((bh - labelHeight(AR_ST.btn)) / 2));
            hits.add("ar-return", bx, by, bw, bh);
        }
    }
}

// ----------------------------------------------------------------------------------------------------- the file
const INFO_HITS = [];
function infoHits(ox) { for (const [id, x, y, w, h, data] of INFO_HITS) hits.add(id, ox + x, y, w, h, data); }

function drawInfo(gr, w, h) {
    gr.FillSolidRect(0, 0, w, h, C.bg);
    if (LABEL_LIVE) drawWallpaper(gr, "stage", infoX() - dp(20), 0, w, h, 0, 0);
    INFO_HITS.length = 0;
    const a = curAlbum();
    if (!a) return;
    const x = dp(20), iw = dp(INFO_W), gname = groupName(a.grp || "");
    // the halftone (05 STYLE), under the ghost group name (both pages)
    halftoneDecor(gr, w, h, dp(210));
    // ghost group name, low behind the actions
    const gf = font(132, 700), gw = gr.CalcTextWidth(gname, gf);
    gr.DrawStrokedText(gname, gf, withAlpha(C["line-faint"], .45), HAIR, 0, 0, h - dp(150), gw + dp(20), dp(170));
    let y = dp(34);
    // AUDIO ARCHIVE / AMBIENT
    let ex = x + label(gr, "AUDIO ARCHIVE", st(AR_ST.eyebrow, C["text-muted"]), x, y);
    ex += label(gr, "  /  ", st(AR_ST.eyebrow, C["text-muted"]), ex, y);
    label(gr, fitLabel(gname, st(AR_ST.eyebrowB, 0), iw - (ex - x)), st(AR_ST.eyebrowB, C.fg), ex, y);
    y += dp(24);
    if (AR.page === "tracks") drawInfoTracks(gr, a, x, y, iw, w, h);
    else drawInfoFile(gr, a, x, y, iw, w, h);
    drawInfoPages(gr, x, iw, h);
}

// the two dots at the bottom: ● FILE  ○ TRACKS (a click on either, or L, turns the page)
const INFO_PAGES = [["file", "FILE"], ["tracks", "TRACKS"]];
function drawInfoPages(gr, x, iw, h) {
    const cy = h - dp(22), r = dp(3.5), gap = dp(16), s = st(AR_ST.key, C["text-muted"]), names = INFO_PAGES.map(([, t]) => tr(t));
    const cx0 = x + iw / 2 - gap / 2, at = INFO_PAGES.findIndex(([k]) => k === AR.page);
    // a plate under the dots, so the halftone does not run through them
    const nw = labelWidth(names[at], s), pw = gap + 2 * r + dp(14) + nw + dp(16), px = cx0 - r - dp(10);
    gr.FillSolidRect(px, cy - dp(11), pw, dp(22), C.bg);
    INFO_PAGES.forEach(([k], i) => {
        const cx = cx0 + i * gap;
        if (i === at) gr.FillEllipse(cx - r, cy - r, 2 * r, 2 * r, C.accent);
        else gr.DrawEllipse(cx - r + HAIR / 2, cy - r + HAIR / 2, 2 * r - HAIR, 2 * r - HAIR, Math.max(HAIR, dp(1.2)), C["text-muted"]);
        INFO_HITS.push(["ar-page", cx - dp(8), cy - dp(11), dp(16), dp(22), k]);
    });
    const lx = cx0 + gap + r + dp(12);
    label(gr, names[at], s, lx, cy - Math.round(labelHeight(AR_ST.key) / 2));
    INFO_HITS.push(["ar-page", lx - dp(2), cy - dp(11), nw + dp(4), dp(22), INFO_PAGES[(at + 1) % 2][0]]);
}

// ▶ PLAY ALBUM / PLAY TRACK (inverse) · OPEN ALBUM ↗ (orange focus frame). Space is play / pause everywhere, so the
// button names no key (the case plays as it does with a click on it while inspected: Enter, Enter). Returns its height.
function drawInfoButtons(gr, x, y, isTrack) {
    const bh = dp(40), bs = st(AR_ST.btn, C.bg, C.fg), playTxt = tr(isTrack ? "PLAY TRACK" : "PLAY ALBUM");
    const pw = dp(14) + dp(10) + dp(10) + labelWidth(playTxt, bs) + dp(18);
    gr.FillSolidRect(x, y, pw, bh, C.fg);
    icon(gr, "play", x + dp(19), y + bh / 2, 9, C.bg);
    label(gr, playTxt, bs, x + dp(34), y + Math.round((bh - labelHeight(AR_ST.btn)) / 2));
    INFO_HITS.push(["ar-play", x, y, pw, bh]);
    const ox2 = x + pw + dp(10), os = st(AR_ST.btn, C.fg), ow = dp(14) + labelWidth(tr("OPEN ALBUM"), os) + dp(40) + dp(26);
    if (!LABEL_LIVE) gr.FillSolidRect(ox2, y, ow, bh, C.bg);   // over the halftone (a wallpaper shows through, as before)
    box(gr, ox2, y, ow, bh, C.fg);
    box(gr, ox2 - dp(4), y - dp(4), ow + dp(8), bh + dp(8), C.accent);
    label(gr, tr("OPEN ALBUM"), os, ox2 + dp(14), y + Math.round((bh - labelHeight(AR_ST.btn)) / 2));
    const ax0 = ox2 + ow - dp(24), ay0 = y + bh / 2 + dp(5), aL = dp(9), sw = Math.max(HAIR, dp(1.5));
    gr.DrawLine(ax0, ay0, ax0 + aL, ay0 - aL, sw, C.accent);
    gr.DrawLine(ax0 + dp(2.5), ay0 - aL, ax0 + aL, ay0 - aL, sw, C.accent);
    gr.DrawLine(ax0 + aL, ay0 - aL, ax0 + aL, ay0 - dp(2.5), sw, C.accent);
    INFO_HITS.push(["ar-open", ox2, y, ow, bh]);
    return bh;
}

// FILE: the album file as it always was (the first tracks, as many as fit; "+ N MORE" turns to the TRACKS page)
function drawInfoFile(gr, a, x, y, iw, w, h) {
    // bracketed ALBUM NO. 0269 + format chip
    const hh = dp(34), hs = st(AR_ST.head, C.fg), lw = labelWidth(tr("ALBUM NO.") + " ", hs);
    const f = font(13, 600), cell = Math.round(gr.CalcTextWidth("0", f, true) + .12 * dp(13)), bw = dp(20) + lw + cell * 4 + dp(16);
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) gr.FillSolidRect(x + cx * (bw - dp(5)), y + cy * (hh - dp(5)), dp(5), dp(5), C.fg);
    const ty = y + Math.round((hh - labelHeight(AR_ST.head)) / 2);
    label(gr, tr("ALBUM NO.") + " ", hs, x + dp(20), ty);
    drawRoll(gr, AR.noRoll, f, C.fg, x + dp(20) + lw, ty, cell, labelHeight(AR_ST.head));
    // the format chip keeps clear of the bracket: the short form when the full one does not fit, none when neither does
    const chipW = t => labelWidth(t, { size: 9.5, weight: 600, track: .1, colour: 0, bg: 0 }) + dp(8) * 2 + dp(12);
    const chipTxt = [fmtChip(a), fmtChip(a, true)].find(t => chipW(t) <= iw - bw - dp(10));
    if (chipTxt) chip(gr, chipTxt, x + iw - chipW(chipTxt), y + Math.round((hh - dp(22)) / 2), dp(22), "acc", 9.5, C.bg);
    y += hh + dp(14);
    gr.FillSolidRect(x, y, w - x, HEAVY, C.fg);
    y += HEAVY + dp(20);
    // title plate (wraps, two lines at most): the album's title, or the track's
    const al = albumOf(a) || a, isTrack = al !== a;
    // a track by its short title (see shortTitles), its work in the line below
    const name = a.part || a.title || tr("UNTITLED"), title = AR.title ? scrambleText(AR.title) : name, tf = fontFor(name, 25, 600);
    const lines = gr.EstimateLineWrap(title, tf, iw - dp(24)), lh = dp(42);
    for (let i = 0, ly = y; i < Math.min(4, lines.length); i += 2, ly += lh + dp(2)) {
        let t = lines[i];
        if (i === 2 && lines.length > 4) t = t.replace(/.?$/, "…");
        const tw = Math.min(iw, Math.ceil(gr.CalcTextWidth(t, tf)) + dp(24));
        gr.FillSolidRect(x, ly, tw, lh, C.fg);
        gr.DrawText(t, tf, C.bg, x + dp(12), ly, tw - dp(12), lh, DT_SINGLE);
    }
    y += dp(104);
    // artist, year / tracks / length
    label(gr, fitLabel((a.artist || tr("UNKNOWN ARTIST")).toUpperCase(), st(AR_ST.artist, 0), iw), st(AR_ST.artist, C.fg), x, y);
    y += dp(22);
    const meta = isTrack ? `${(a.work || al.title || tr("UNTITLED")).toUpperCase()} / ${a.year || "—"} / ${fmtTime(a.length)}`
                         : `${a.year || "—"} / ${tr("{0} TRACKS", pad(a.tracks, 2))} / ${fmtTime(a.length)}`;
    label(gr, fitLabel(meta, st(AR_ST.meta, 0), iw), st(AR_ST.meta, C["text-muted"]), x, y);
    y += dp(28);
    // profile table
    gr.FillSolidRect(x, y, iw, dp(18), C.fg);
    const phy = y + Math.round((dp(18) - labelHeight(ST.ph)) / 2);
    label(gr, tr("PROFILE"), st(ST.ph, C.bg, C.fg), x + dp(8), phy);
    label(gr, `ARC-${pad(a.no, 4)}`, st(ST.ph, C.bg, C.fg), x + iw - dp(8), phy, 2);
    y += dp(18 + 10);
    const res = a.lossless && a.bits ? `${a.bits} / ${+(a.rate / 1000).toFixed(1)}` : a.kbps ? `${a.kbps} KBPS` : "—";
    const cells = [[tr("FORMAT"), (a.codec || "—").toUpperCase()], [tr("RES"), res], [tr("GENRE"), (a.genre || "—").toUpperCase()], [tr("DISCS"), String(a.discs)],
                   [tr("ADDED"), a.added ? a.added.slice(0, 10) : "—"], [tr("PLAYS"), a.plays ? String(a.plays) : "—"]];
    const colW = iw / 2;
    cells.forEach(([kk, v], i) => {
        const cx = x + dp(8) + (i % 2) * colW, cy = y + Math.floor(i / 2) * dp(20);
        label(gr, kk, st(AR_ST.key, C["text-muted"]), cx, cy + dp(2));
        gr.DrawText(v, fontFor(v, 11, 400), C.fg, cx + dp(72), cy - dp(2), colW - dp(84), dp(18), DT_SINGLE | DT_ELLIPSIS);
    });
    y += dp(60) + dp(12);
    // the album's tracks, as many as fit above the buttons: click one to play the album from it (the selected track
    // item is marked, the playing track has ▶)
    // (below the list: the "+ N MORE" row, the buttons, the page dots and a margin, more with the source note)
    const below = dp(24 + 18 + 40) + dp(26) + dp(LIB.source === "playlists" ? 56 : 28);
    const rowH = dp(24), fit = clamp(Math.floor((h - y - below) / rowH), 1, 40), TL = albumTracks(a, fit);
    if (!TL.rows.length) label(gr, tr(LIB.live ? "NO TRACKS" : "INDEXING …"), st(AR_ST.more, C["text-muted"]), x + dp(34), y + dp(6));
    TL.rows.forEach((t, k) => {
        const ry = y + k * rowH, hov = AR.infoHover === t.i;
        if (t.gap) return;
        if (t.work) { drawWorkRow(gr, t.work, x, ry, iw, rowH); return; }
        if (t.own || hov) gr.FillSolidRect(x - dp(8), ry, iw + dp(16), rowH, t.own ? C.panel : withAlpha(C.fg, .06));
        if (t.own) gr.FillSolidRect(x - dp(8), ry, dp(3), rowH, C.accent);
        gr.DrawText(t.playing ? "▶" : t.no, font(12, 400), t.playing ? C.accent : C["text-muted"], x, ry, dp(34), rowH, DT_SINGLE);
        gr.DrawText(t.title, fontFor(t.title, 12, t.own ? 600 : 400), C.fg, x + dp(34), ry, iw - dp(34) - dp(70), rowH, DT_SINGLE | DT_ELLIPSIS);
        gr.DrawText(fmtTime(t.len), font(12, 400), C["fg-soft"], x + iw - dp(70), ry, dp(70), rowH, DT_RIGHT_SINGLE);
        INFO_HITS.push(["ar-track", x - dp(8), ry, iw + dp(16), rowH, t.i]);
    });
    y += Math.max(1, TL.rows.length) * rowH;
    const more = TL.total - TL.first - TL.rows.length;
    if (more > 0 && TL.rows.length) {
        const mw = label(gr, tr("+ {0} MORE  ·  ALL TRACKS"), st(AR_ST.more, C["text-muted"]), x + dp(34), y + dp(6));
        INFO_HITS.push(["ar-page", x + dp(30), y, mw + dp(8), rowH, "tracks"]);
    }
    y += dp(24 + 18);
    const bh = drawInfoButtons(gr, x, y, isTrack);
    if (LIB.source === "playlists") label(gr, tr("SOURCE · ALL PLAYLISTS (NO MEDIA LIBRARY FOLDERS)"), st(AR_ST.key, C["text-muted"]), x, y + bh + dp(16));
}

// TRACKS: the album's title and totals, then every track with its rating, scrolled by the wheel over the panel;
// discs get a header row. A click on the marks rates the track (the same mark again clears it), elsewhere on the row
// it plays the album from there. The buttons stay at the bottom.
function drawInfoTracks(gr, a, x, y, iw, w, h) {
    const al = albumOf(a) || a, isTrack = al !== a, L = albumTrackList(a);
    const tt = al.title || tr("UNTITLED");
    gr.DrawText(tt, fontFor(tt, 18, 600), C.fg, x, y, iw, dp(28), DT_SINGLE | DT_ELLIPSIS);
    y += dp(30);
    label(gr, fitLabel((al.artist || a.artist || tr("UNKNOWN ARTIST")).toUpperCase(), st(AR_ST.artist, 0), iw), st(AR_ST.artist, C.fg), x, y);
    y += dp(22);
    const n = L.rows.length, meta = `${al.year || a.year || "—"} / ${tr("{0} TRACKS", pad(n, 2))} / ${fmtTime(L.total)}`;
    label(gr, fitLabel(meta, st(AR_ST.meta, 0), iw), st(AR_ST.meta, C["text-muted"]), x, y);
    // RATED 7 / 12 · ◆ 3.8, right
    if (n) {
        const rs = st(AR_ST.meta, L.rated ? C.fg : C["text-muted"]), rt = L.rated ? `${tr("RATED {0} / {1}", L.rated, n)}  ·  ${L.avg.toFixed(1)}` : tr("NOT RATED");
        label(gr, rt, rs, x + iw, y, 2);
    }
    y += dp(26);
    gr.FillSolidRect(x, y, w - x, HEAVY, C.fg);
    y += HEAVY + dp(12);
    // column heads
    const ms = dp(9), rw = ratingWidth(ms), tx = x + dp(34), timeW = dp(52), rx = x + iw - timeW - dp(14) - rw, ks = st(AR_ST.key, C["text-muted"]);
    label(gr, tr("NO."), ks, x, y);
    label(gr, tr("TITLE"), ks, tx, y);
    label(gr, tr("RATING"), ks, rx, y);
    label(gr, tr("TIME"), ks, x + iw, y, 2);
    y += dp(18);
    hline(gr, x, y, iw, C["line-faint"]);
    y += dp(4);
    // the rows, between the heads and the buttons
    const bh = dp(40), by = h - dp(22) - dp(20) - bh - (LIB.source === "playlists" ? dp(24) : 0), listH = by - dp(18) - y, rowH = dp(26);
    if (!n) { label(gr, tr(LIB.live ? "NO TRACKS" : "INDEXING …"), st(AR_ST.more, C["text-muted"]), tx, y + dp(8)); }
    else {
        // the display rows: a header per disc when there are several, then its tracks
        const D = [];
        let disc = null, work = null;
        for (const r of L.rows) {
            if (L.discs > 1 && r.disc !== disc) { disc = r.disc; work = null; D.push({ head: r.disc }); }
            if (r.work !== work && D.length && D[D.length - 1].head === undefined && (work || r.work)) D.push({ gap: true });   // air between works
            if (r.work && r.work !== work) D.push({ workHead: r.work });
            work = r.work;
            D.push(r);
        }
        const fit = Math.max(1, Math.floor(listH / rowH));
        AR.listMax = Math.max(0, D.length - fit);
        // a new album opens on its selected track item (else at the top); another track of the same album selected stays
        // where it is when its row is in view
        if (AR.listKey !== a.key) {
            const at = D.findIndex(r => r.own), alb = (albumOf(a) || a).key;
            if (AR.listAlbum !== alb || at < AR.listScroll || at >= AR.listScroll + fit) AR.listScroll = at > fit - 2 ? at - 1 : 0;
            AR.listKey = a.key; AR.listAlbum = alb;
        }
        AR.listScroll = clamp(AR.listScroll, 0, AR.listMax);
        D.slice(AR.listScroll, AR.listScroll + fit).forEach((r, k) => {
            const ry = y + k * rowH;
            if (r.gap) return;
            if (r.workHead) { drawWorkRow(gr, r.workHead, x, ry, iw, rowH); return; }
            if (r.head !== undefined) {
                label(gr, `${tr("DISC")} ${r.head || "—"}`, st(AR_ST.key, C.fg), x, ry + Math.round((rowH - labelHeight(AR_ST.key)) / 2));
                hline(gr, x + dp(64), ry + rowH / 2, iw - dp(64), C["line-faint"]);
                return;
            }
            const hov = AR.infoHover === r.i, rh = AR.rateHover && AR.rateHover.i === r.i ? AR.rateHover.n : 0;
            if (r.own || hov) gr.FillSolidRect(x - dp(8), ry, iw + dp(16), rowH, r.own ? C.panel : withAlpha(C.fg, .06));
            if (r.own) gr.FillSolidRect(x - dp(8), ry, dp(3), rowH, C.accent);
            gr.DrawText(r.playing ? "▶" : r.no, font(12, 400), r.playing ? C.accent : C["text-muted"], x, ry, dp(34), rowH, DT_SINGLE);
            gr.DrawText(r.title, fontFor(r.title, 12, r.own ? 600 : 400), C.fg, tx, ry, rx - dp(12) - tx, rowH, DT_SINGLE | DT_ELLIPSIS);
            drawRating(gr, rx, ry + (rowH - ms) / 2, ms, r.rating, rh);
            gr.DrawText(fmtTime(r.len), font(12, 400), C["fg-soft"], x + iw - timeW, ry, timeW, rowH, DT_RIGHT_SINGLE);
            INFO_HITS.push(["ar-track", x - dp(8), ry, rx - dp(6) - (x - dp(8)), rowH, r.i]);
            INFO_HITS.push(["ar-track", x + iw - timeW, ry, timeW + dp(8), rowH, r.i]);
            INFO_HITS.push(["ar-rate", rx - dp(6), ry, rw + dp(12), rowH, { i: r.i, pad: dp(6), size: ms }]);
        });
        // the scroll bar, when the list is longer than the room
        if (AR.listMax > 0) {
            const th = fit * rowH, bh2 = Math.max(dp(18), th * fit / D.length), by2 = y + (th - bh2) * AR.listScroll / AR.listMax;
            gr.FillSolidRect(x + iw + dp(10), y, HAIR, th, C["line-faint"]);
            gr.FillSolidRect(x + iw + dp(9), Math.round(by2), dp(3), Math.round(bh2), C.fg);
        }
    }
    drawInfoButtons(gr, x, by, isTrack);
    if (LIB.source === "playlists") label(gr, tr("SOURCE · ALL PLAYLISTS (NO MEDIA LIBRARY FOLDERS)"), st(AR_ST.key, C["text-muted"]), x, by + bh + dp(12));
}

// ------------------------------------------------------------------------------------------------------ actions
function archivePlaylist() {
    let pl = plman.FindPlaylist(ARCHIVE_PLAYLIST);
    if (pl >= 0 && plman.IsAutoPlaylist(pl)) pl = -1;
    if (pl < 0) pl = plman.CreatePlaylist(plman.PlaylistCount, ARCHIVE_PLAYLIST);
    return pl;
}
function loadAlbum(a) {
    const list = albumHandles(a);
    if (!list || !list.Count) return -1;
    const pl = archivePlaylist();
    plman.ClearPlaylist(pl);
    plman.InsertPlaylistItems(pl, 0, list);
    return pl;
}
// plays the selected item's album from track `at` (default: the item's own track, else the first)
// a track of the album file clicked while every track is its own item: that track's case is selected too, on whichever
// shelf (or grid section) it stands (with albums, the album is the one selected already)
function selectTrackItem(at) {
    if (!showTracks()) return;
    const list = albumHandles(curAlbum()), h = list && at < list.Count ? list[at] : null;
    if (!h) return;
    const key = `t|${h.Path.toLowerCase()}|${h.SubSong}`, R = arRows();
    for (let gi = 0; gi < R.length; gi++) {
        const i = R[gi].albums.findIndex(x => x.key === key);
        if (i < 0) continue;
        if (AR.layout === "grid") gridSelect(gi, i); else selectCase(gi, i);
        return;
    }
}
function playAlbum(at) {
    const a = curAlbum(), list = albumHandles(a);
    if (!list || !list.Count) return;
    if (at === undefined) { const own = itemTrack(a); at = 0; if (own) for (let i = 0; i < list.Count; i++) if (sameTrack(list[i], own)) { at = i; break; } }
    const pl = loadAlbum(a);
    if (pl < 0) return;
    plman.ActivePlaylist = pl;
    plman.ExecutePlaylistDefaultAction(pl, clamp(at, 0, list.Count - 1));
    AR.tracks.key = "";
}
// Inspect from elsewhere: the transport's cover and the signal profile card ask for the playing (else focused) track.
// The Archive opens on its album (or on the track itself while SHOW TRACKS is on) and inspects it once the view is
// shown and the item is listed; the inspection belongs to the case array, so the grid gives way to it.
const INSPECT_ASK = { key: "", timer: 0 };
function inspectRequest() {
    const h = fb.GetNowPlaying() || fb.GetFocusItem();
    if (!h) return;
    INSPECT_ASK.key = LIB.unit === "tracks" ? `t|${h.Path.toLowerCase()}|${h.SubSong}` : albumKey(h);
    if (STATE.view !== "archive") send("view", "archive");   // the view comes back here with the next "state"
    else inspectPending(0);
}
function inspectPending(delay = STATE.viewFx === "cut" ? 0 : 450) {
    if (!INSPECT_ASK.key || !ARCHIVE_ON || INSPECT_ASK.timer) return;
    // after the view's transition (none with VIEW SWITCH › CUT), so the lift and turn are seen
    INSPECT_ASK.timer = window.SetTimeout(() => {
        INSPECT_ASK.timer = 0;
        const key = INSPECT_ASK.key;
        if (!key || !ARCHIVE_ON) return;
        // not listed: wait for the catalog while the library is still being read, else leave the selection alone
        if (!LIB.groups.some(g => g.albums.some(x => x.key === key))) {   // the groups list every item, in either layout
            if (LIB.live) INSPECT_ASK.key = "";
            return;
        }
        INSPECT_ASK.key = "";
        if (AR.layout === "grid") setLayout("array");
        AR.inspOn = false; AR.insp = 0;
        placeSelection(key);
        if (!curAlbum()) return;
        AR.inspOn = true; inspectImages(); clock.wake(); window.Repaint();
    }, delay);
}
LIB_LISTENERS.push(kind => { if (kind === "catalog") inspectPending(0); });

function openAlbum() {
    const pl = loadAlbum(curAlbum());
    if (pl < 0) return;
    plman.ActivePlaylist = pl;
    send("view", "playlists");
}

// ------------------------------------------------------------------------------------------------------- input
function inQuad(x, y, q) {   // any polygon
    let inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        const [xi, yi] = q[i], [xj, yj] = q[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
// the case under the mouse: the selected shelf's first (a see-through shelf in front, drawn over it, does not take its
// cases), then the other shelves', the one drawn last (nearest) first
function caseAt(x, y) {
    for (const own of [true, false]) for (let j = AR.hits.length - 1; j >= 0; j--) {
        const c = AR.hits[j];
        if ((c.gi === AR.group) === own && inQuad(x, y, c.quad)) return c;
    }
    return null;
}
function archiveMouseMove(x, y, a) {
    AR.mouseX = x;
    // the file panel's track rows highlight under the mouse; over a row's marks, the rating they would give shows
    const th = a && a.id === "ar-track" ? a.data : a && a.id === "ar-rate" ? a.data.i : -1;
    const rh = a && a.id === "ar-rate" ? { i: a.data.i, n: ratingAt(x, a.x + a.data.pad, a.data.size) } : null;
    if (th !== AR.infoHover || (rh && rh.n) !== (AR.rateHover && AR.rateHover.n) || (rh && rh.i) !== (AR.rateHover && AR.rateHover.i)) {
        AR.infoHover = th; AR.rateHover = rh; AR.dirtyInfo = true;
        window.RepaintRect(infoX() - dp(20), 0, W - infoX() + dp(20), H);
    }
    if (AR.layout === "grid") return gridMouseMove(x, y, a);
    const c = !AR.inspOn && x < arrayW() && !a ? caseAt(x, y) : null, h = c ? c.i : -1, hg = c ? c.gi : -1;
    let ht = -1;
    if (a && a.id === "ar-ruler" && AR.rulerGeom) { const R = AR.rulerGeom; ht = clamp(Math.round((x - R.x0) / R.step + R.s0), 0, R.n - 1); }
    if (h !== AR.hover || hg !== AR.hoverRow || ht !== AR.hoverTick) { AR.hover = h; AR.hoverRow = hg; AR.hoverTick = ht; clock.wake(); }
    return h >= 0;
}
function archiveMouseLeave() {
    if (AR.infoHover >= 0 || AR.rateHover) { AR.infoHover = -1; AR.rateHover = null; AR.dirtyInfo = true; window.Repaint(); }
    if (GRID.hover) { GRID.hover = null; window.Repaint(); }
    if (AR.rulerDrag) return;   // a drag along the album index goes on outside the panel
    if (AR.hover >= 0 || AR.hoverTick >= 0) { AR.hover = AR.hoverRow = -1; AR.hoverTick = -1; clock.wake(); }
}
function archiveClick(x, y, a) {
    if (a && a.id === "ar-pick") { randomPick(); return; }
    pickStop();
    if (AR.inspOn) {
        if (a && a.id === "ar-inspected") playAlbum();   // the inspected case: played, and put back
        AR.inspOn = false; clock.wake(); return;
    }
    if (a) {
        switch (a.id) {
            case "ar-play": playAlbum(); return;
            case "ar-addmusic": addMusicFolder(); return;
            case "ar-track": selectTrackItem(a.data); playAlbum(a.data); return;
            case "ar-rate": {
                const L = AR.list, h = L && L.handles ? L.handles[a.data.i] : null;
                if (h) setRating(h, ratingAt(x, a.x + a.data.pad, a.data.size));
                return;
            }
            case "ar-page": setInfoPage(a.data); return;
            case "ar-unit": setUnit(a.data); return;
            case "ar-open": openAlbum(); return;
            case "ar-prev": moveAlbum(-1); return;
            case "ar-next": moveAlbum(1); return;
            case "ar-gprev": moveGroup(-1); return;
            case "ar-gnext": moveGroup(1); return;
            case "ar-ruler": if (AR.hoverTick >= 0) moveAlbum(AR.hoverTick - AR.rows.get(AR.group).sel); return;
            case "ar-layout": setLayout(a.data); return;
            case "ar-filter": send("search-clear"); return;
            case "ar-per": setPerPage(a.data); return;
            case "ar-group": setGroupBy(a.data); return;
            case "ar-sort": setSortBy(a.data); return;
        }
    }
    if (AR.layout === "grid") { gridClick(x, y, a); return; }
    if (AR.hover >= 0 && AR.hoverRow !== AR.group) { selectCase(AR.hoverRow, AR.hover); return; }
    if (AR.hover >= 0) {
        const r = AR.rows.get(AR.group);
        if (AR.hover === r.sel) { AR.inspOn = true; inspectImages(); clock.wake(); }
        else moveAlbum(AR.hover - r.sel);
    }
}
// the wheel: along the shelf (the array: up goes up the shelf, to the next album, as ↑) or down the grid; over the
// TRACKS page, through its list. With Shift held (or a sideways wheel, archiveWheelH) it switches shelves (the grid:
// sections), as ← → do.
function archiveWheel(step) {
    pickStop();
    if (utils.IsKeyPressed(0x10)) { archiveShelf(step > 0 ? 1 : -1); return; }
    if (AR.page === "tracks" && AR.mouseX >= infoX() - dp(20) && curAlbum()) {
        const s = clamp(AR.listScroll - step * 3, 0, AR.listMax);
        if (s !== AR.listScroll) { AR.listScroll = s; AR.dirtyInfo = true; AR.rateHover = null; window.RepaintRect(infoX() - dp(20), 0, W - infoX() + dp(20), H); }
        return;
    }
    if (AR.layout === "grid") gridWheel(step); else moveAlbum(step > 0 ? 1 : -1);
}
function archiveWheelH(step) { pickStop(); archiveShelf(step > 0 ? -1 : 1); }
// d = 1: the next shelf back (the array: up and to the left, as ←), the grid: the section above; -1 the other way
function archiveShelf(d) {
    if (AR.layout !== "grid") { moveGroup(d); return; }
    const gi = clamp(AR.group - d, 0, LIB.groups.length - 1);
    if (gi !== AR.group) gridSelect(gi, rowState(gi).sel);
}
function archiveKey(vk) {
    if (vk === 0x52) { randomPick(); return true; }   // R
    if (vk === 0x46 && curAlbum()) { openFolder(itemTrack(curAlbum()) || albumFirst(curAlbum())); return true; }   // F: the selected item's folder
    if (PICK.steps && (vk === 0x1B || vk === 0x0D || vk === 0x47 || (vk >= 0x21 && vk <= 0x28))) {
        pickStop();
        if (vk === 0x1B) return true;
    }
    if (AR.inspOn) {
        if (vk === 0x1B) { AR.inspOn = false; clock.wake(); return true; }
        if (vk === 0x0D) { playAlbum(); AR.inspOn = false; clock.wake(); return true; }   // as a click on the case
        return vk >= 0x21 && vk <= 0x28;   // navigation keys do nothing while inspecting
    }
    if (vk === 0x47) { setLayout(AR.layout === "grid" ? "array" : "grid"); return true; }   // G
    if (vk === 0x4C) { setInfoPage(AR.page === "tracks" ? "file" : "tracks"); return true; }   // L: the album file's other page
    if (AR.layout === "grid" && gridKey(vk)) return true;
    // Space is not the Archive's: play / pause, as in every view (stage.js)
    switch (vk) {
        // up the shelf (up and to the right on screen) is the next album, as the wheel
        case 0x26: moveAlbum(1); return true;           // ↑
        case 0x28: moveAlbum(-1); return true;          // ↓
        // the next shelf stands behind, up and to the left: ← goes to it, → back towards the front (#16)
        case 0x25: moveGroup(1); return true;           // ←
        case 0x27: moveGroup(-1); return true;          // →
        case 0x21: moveAlbum(10); return true;          // Page Up
        case 0x22: moveAlbum(-10); return true;         // Page Down
        case 0x24: moveAlbum(-1e6); return true;        // Home
        case 0x23: moveAlbum(1e6); return true;         // End
        case 0x0D: if (curAlbum()) { AR.inspOn = true; inspectImages(); clock.wake(); } return true;
    }
    return false;
}
function archiveMenu(x, y) {
    const m = window.CreatePopupMenu(), by = ["genre", "decade", "artist", "none"], sorts = SORT_BY.map(([k]) => k);
    // (checked rather than a radio group: "album" came later and has an id of its own, out of the run 1 – 4)
    [["genre", "Group by genre", 1], ["decade", "Group by decade", 2], ["artist", "Group by artist initial", 3], ["album", "Group by album", 18], ["none", "No groups", 4]]
        .forEach(([k, t, id]) => m.AppendMenuItem(LIB.groupBy === k ? 0x8 : 0, id, tr(t)));
    const so = window.CreatePopupMenu();
    ["Artist", "Album title", "Year", "Date added (newest first)"].forEach((t, i) => so.AppendMenuItem(0, 400 + i, tr(t)));
    so.CheckMenuRadioItem(400, 403, 400 + Math.max(0, sorts.indexOf(LIB.sortBy)));
    so.AppendTo(m, 0, tr("Sort by"));
    m.AppendMenuItem(showTracks() ? 0x8 : 0, 10, tr("Show every track as its own item"));
    m.AppendMenuItem((AR.shelfPerGroup ? 0x8 : 0) | (LIB.groupBy === "none" ? 1 : 0), 15, tr("Each group on its own shelf"));
    const lk = window.CreatePopupMenu();
    lk.AppendMenuItem(0, 16, tr("Customise in STYLE …"));
    lk.AppendMenuItem(0, 17, tr("Back to the default look"));
    lk.AppendTo(m, 0, tr("Shelf look"));
    m.AppendMenuSeparator();
    m.AppendMenuItem(0, 7, tr("Case array") + "\tG");
    m.AppendMenuItem(0, 8, tr("Cover grid") + "\tG");
    m.CheckMenuRadioItem(7, 8, AR.layout === "grid" ? 8 : 7);
    const per = window.CreatePopupMenu();
    PER_PAGE.forEach((n, i) => per.AppendMenuItem(0, 300 + i, tr("{0} covers", n)));
    per.CheckMenuRadioItem(300, 300 + PER_PAGE.length - 1, 300 + Math.max(0, PER_PAGE.indexOf(GRID.per)));
    per.AppendTo(m, 0, tr("Grid: covers per page"));
    m.AppendMenuSeparator();
    m.AppendMenuItem(curAlbum() ? 0 : 1, 9, tr("Play album"));
    m.AppendMenuItem(curAlbum() ? 0 : 1, 5, tr("Open album in playlist"));
    m.AppendMenuItem(curAlbum() ? 0 : 1, 13, tr("Open containing folder") + "\tF");
    m.AppendMenuItem(curAlbum() ? 0 : 1, 11, tr("Random pick") + "	R");
    m.AppendMenuItem(AR.topTitles ? 0x8 : 0, 12, tr("Titles on the cases' top edges"));
    m.AppendMenuItem(AR.page === "tracks" ? 0x8 : 0, 14, tr("Album file: all tracks with ratings") + "\tL");
    ratingMenu(m, 600);
    const hv = window.CreatePopupMenu();
    ["Outline it", "Show its title", "Nothing"].forEach((t, i) => hv.AppendMenuItem(0, 500 + i, tr(t)));
    hv.CheckMenuRadioItem(500, 502, 500 + HOVER_MODES.indexOf(AR.hoverMode));
    hv.AppendTo(m, 0, tr("Case under the mouse"));
    m.AppendMenuSeparator();
    const skins = appendSkinMenu(m, 100);
    m.AppendMenuItem(0, 6, tr("Re-index library"));
    const id = m.TrackPopupMenu(x, y);
    if (id >= 1 && id <= 4) setGroupBy(by[id - 1]);
    else if (id === 18) setGroupBy("album");
    else if (id >= 400 && sorts[id - 400]) setSortBy(sorts[id - 400]);
    else if (id === 9) playAlbum();
    else if (id === 11) randomPick();
    else if (id === 13) openFolder(itemTrack(curAlbum()) || albumFirst(curAlbum()));
    else if (id >= 500 && HOVER_MODES[id - 500]) { AR.hoverMode = HOVER_MODES[id - 500]; setSetting("caseHover", AR.hoverMode); window.Repaint(); }
    else if (id === 12) { AR.topTitles = !AR.topTitles; setSetting("caseTopTitles", AR.topTitles); window.Repaint(); }
    else if (id === 14) setInfoPage(AR.page === "tracks" ? "file" : "tracks");
    else if (id >= 600 && ratingMenuPick(id, 600)) { AR.listVer++; AR.dirtyInfo = true; window.Repaint(); }
    else if (id === 10) setUnit(showTracks() ? "albums" : "tracks");
    else if (id === 16) { STY.edit = "shelves"; send("view", "style"); }
    else if (id === 17) resetShelfLook();
    else if (id === 15) { AR.shelfPerGroup = !AR.shelfPerGroup; setSetting("shelfPerGroup", AR.shelfPerGroup); placeSelection(AR.selAlbum); clock.wake(); window.Repaint(); }
    else if (id === 5) openAlbum();
    else if (id === 6) libIndex(true);
    else if (id === 7 || id === 8) setLayout(id === 8 ? "grid" : "array");
    else if (id >= 300 && PER_PAGE[id - 300]) setPerPage(PER_PAGE[id - 300]);
    else if (id >= 100 && skins[id - 100]) send("skin", skins[id - 100].id);
}
