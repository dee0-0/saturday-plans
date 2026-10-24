/*
 * Map pin: 3 Swiss places a day. Tap the map where you think each one is (pinch to zoom,
 * tap again or drag to move the pin), confirm, and see the real spot and how far off you
 * were. The closer pin wins each place; whoever wins more places wins the day. The other
 * one's pins show once you both pinned all three. Leaflet loads on demand when the step
 * opens. Looks from match.css + quick.css + pin.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="pin"]');
  if (!section) return;

  const ledeEl = $("#pin-lede");
  const statusEl = $("#pin-status");
  const headEl = $("#pin-head");
  const promptEl = $("#pin-prompt");
  const boardEl = $("#pin-board");
  const mapEl = $("#pin-map");
  const noteEl = $("#pin-map-note");
  const legendEl = $("#pin-legend");
  const revealEl = $("#pin-reveal");
  const actionButton = $("#pin-action");
  const rowsEl = $("#pin-rows");
  const errorEl = $("#pin-error");
  const retryButton = $("#pin-retry");
  const statsEl = $("#pin-stats");

  const POLL_MS = 15000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-pin-draft-preview" : "date-letter-pin-draft";
  const LEAFLET = {
    js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    jsHash: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
    css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    cssHash: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
  };
  // Switzerland's corners, how far the map may pan, and where a pin may go (as the Worker checks).
  const SWISS = [[45.818, 5.956], [47.808, 10.492]];
  const LIMITS = [[45.7, 5.8], [47.9, 10.6]];
  const AREA = [[45, 5], [48.6, 11.4]];
  const MAX_ZOOM = 11;
  const NEAR_KM = 10;
  // Switzerland's border (OpenStreetMap, simplified to about 300 m), as an encoded polyline (1e-3 degrees).
  const OUTLINE = "gbyAgsJDAE_@UUCSHcAJMa@a@Bm@Ea@NKBkAk@cB_@Ai@eAIW@_@g@yAe@]MFIG?\\Q?Z^DVGLs@j@W]WFSx@_BaAwAcDWuDoAyDBeIt@uGjAd@RGTXF`@RHh@Y?WXGFg@^SRa@AUTMp@RL\\ZPBRPAb@b@l@Qd@h@n@IRc@Gm@JYDaB^HXXRST?HVb@NNe@IGE][]@WNBF]j@YRc@\\GNs@RANWR^PQHg@`@@\\ORa@XEHYREP]FDXQ?a@[a@Ke@BSHBPYDi@_@GO_@I?GaAHOYg@i@a@HO?[LOIg@FWNIJq@]_@DQK_@a@a@G}@UFQk@KKFQISLSA]KGYJUQ@y@VEDM@eBKo@d@a@Dc@JUXDTY?]a@YFi@f@}@Sk@RsASYSPu@[SHIa@c@]CgCDW_@W?UM@KMKJYm@q@X_AYUqCc@MMy@UU]He@_@QXeAZSn@[HMt@SE[w@UMSa@Jm@KkAMYUEKSO@KUA]IE?Sc@AEQDUYy@QKYDQt@c@c@?c@s@sA?s@M]IkAf@g@PNV@TULHPOPRn@QRNd@EXTBR\\DJXbAw@RZHEFe@XKZ{Bf@OZo@f@SBYHAB]VRRa@TCAgARSDi@NMHw@q@w@f@c@Nm@Aa@KKp@{AZEXTCPFLDMVNRh@ZXd@LESFeAt@iAFSC_@XI\\JX[?MVSRBRS^CDUJVd@d@VBYwAT[Ma@FSXDFm@Ia@c@CU]k@GAUs@m@BVW??PSN@TOJ?n@QEMRIIWDQp@EMM@?WOGKa@m@HY\\MC_@YQu@@SGc@UAUU}@`@a@mA?Qc@YQk@QI@k@QWy@MKa@]CIu@aACCMQCe@s@WDQYSGOLOOWFCXSLa@OSNMKWBe@~@[@Ge@UWk@FWOOy@?wAIQHQRHPODQPIJk@QWYAQQU{@n@D@VFA?YRELLrAH~@]JNL?VeAXYn@Qp@_AGSTc@?_ANQ@_@ScAMOPSBm@k@_@K?GPQUOHS[AM`@aAKOQaAU]E_@Be@U_@Om@\\c@QQGo@HBRQVg@@UP?d@^Rg@JFHIJPTGNeATq@b@Ib@`@Xs@Wq@FiAI[SIc@s@YZk@Pi@hAe@VQASCQi@a@@O]Ce@g@IMJ@X[HGZJVCPLL?h@MD@^[HCZQ?YW]Tg@KSLESSCQ?ORKa@YUGSGEOJCa@KISFc@IJs@i@aCPk@WQK]XKV[b@`@`@GFOM]Nc@f@QD]I[PYKWMCDo@Pi@Mi@f@eASKCW[MSDm@Y]FSOs@zAFvAc@Ra@AWTIUa@SEYSE]b@g@sAg@D[`@QMGc@]S[@KSIDOOo@@UJ}@i@m@E]bAGx@GF]Ii@x@EXPX@p@fAd@Fd@RDPUJ@?\\HFUnBVAl@^TQd@B?lA\\p@DzALb@g@b@EfAYAq@bADVE^[VFTGNDj@Yp@QfAk@EKNu@i@UDQb@MQGFC^LLD`@Uv@[l@@hAKJ?n@ITKAAf@MJBhAPVE^OZZvAa@d@TnACPLHMFFJYFi@sAUIeAL}@h@c@HsDyAQ]c@Se@_AeAc@[c@GgA[[QBWf@y@Nc@]IhA[XPJANg@XYf@{ADQ|BiChEmArGFrACv@DT[p@FV]vAOlC|@bDN~AMd@i@LI`@WMIJ?UJ?CSS?@p@QHAn@IMMh@IMOHDRNC?ZP\\T@Dq@LGFW@R`@FANYz@Gz@m@OKb@OL_@YCa@[ZEXPd@CJYHEIYNIn@O?PT`@C@I\\h@SXQGMNUMEDIb@FNGHDXOL\\JDYNCFZMRLt@LJIRHr@|@`ARKNBARHDNp@VVZ_@R\\NKAWXi@@WGQPBRSCGCLEMIBN_@IA@mAGESNEKJQOBIi@Na@Ug@@QNARe@HCTXAXIUOHPXx@Qb@j@Gh@SGCQW`@SrAT@ANJADx@TRBVb@SGk@LKP|@HbAS`ATZIhBc@~@_@?GJ?t@KNBd@NTYLEZt@pAC^VX@r@f@THRKj@ZzAKf@CpAZ^M~@QHUG_@d@Cn@Lp@Kf@d@VV\\p@lEGn@q@dAEuAMMHCIG_@b@[k@Pd@Ix@f@t@AZM?I^ZFCd@JPL?p@rBVEMa@LWZPEHB\\KF\\WPAJPP\\B\\QROx@`@VEOVu@PRD^XPTb@D`@C|@Op@Dv@JPCT\\dAe@ZFhAOr@q@Mi@[CWEBFlA[bAP\\?d@Ld@GDKdAK\\PlANKTDRKAOTBBGJV@f@TJDn@t@B@p@BILPNI\\z@f@HMo@Hi@IeBGi@Qg@Dc@LAB]X?FWLPDGNT@fAVKTLJX?d@HDAl@HR`@Ud@HNQrAtC^LZ`AFEB[PNp@vAh@`CVKLHA^Rl@NELZ^u@Zj@Bf@Nb@n@d@Tj@?p@Rf@^fCOPdArARh@lA_AlAHb@`@`@BFRTGVm@\\J`@j@PdA`@RB`@HG@VXd@d@tBtAjBv@`BF?b@lAj@z@|@}A`@XEJh@p@x@^^n@TARWv@j@LcAROBQEBj@iACQZUl@h@FTTB\\^d@?Pb@JAJUBFJSZGXl@QXJ\\IR\\`@OVNh@RTAVLE?b@NJFGJPPs@JITLCJv@b@LC";
  const KINDS = {
    city: ["City", "building-2"],
    town: ["Town", "house"],
    village: ["Village", "house"],
    lake: ["Lake", "waves"],
    mountain: ["Mountain", "mountain-snow"],
    pass: ["Mountain pass", "route"],
    waterfall: ["Waterfall", "droplets"],
    castle: ["Castle", "castle"],
    glacier: ["Glacier", "snowflake"],
    gorge: ["Gorge", "mountain"],
    sight: ["Sight", "landmark"]
  };

  let data = null;
  let saving = false;
  let pending = null;      // { index, lat, lng }: my pin before I confirm it
  let reveal = null;       // index of the place I just confirmed (its result shows until "Next")
  let focus = null;        // the place the result map zooms to (null = all of them)
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let drawn = { head: "", prompt: "", reveal: "", rows: "", stats: "", legend: "", map: "" };
  let lastAction = "";

  // Leaflet and the map, made once.
  let leafletPromise = null;
  let L = null;
  let map = null;
  let layers = null;
  let mineMarker = null;
  let mapFailed = false;
  let sized = false;
  let fittedFor = "";

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "map-pin") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const kmText = (value) => `${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const kindOf = (kind) => KINDS[kind] || ["Place", "map-pin"];
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function saveDraft() {
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data?.day, author: me(), ...pending })); } catch { /* Optional. */ }
  }

  function readDraft(index) {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      if (!draft || draft.day !== data?.day || draft.author !== me() || draft.index !== index) return null;
      return Number.isFinite(draft.lat) && Number.isFinite(draft.lng) ? { index, lat: draft.lat, lng: draft.lng } : null;
    } catch { return null; }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional. */ }
  }

  // Where a pin is or will be: the CARTO light map when a key is set in config.js (CARTO wants
  // one since September 2026), otherwise swisstopo's aerial photos (free, no key). Neither has labels.
  function cartoKey() {
    try { return typeof CONFIG !== "undefined" && typeof CONFIG.cartoKey === "string" ? CONFIG.cartoKey.trim() : ""; } catch { return ""; }
  }

  function decodeOutline() {
    const points = [];
    let at = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = OUTLINE.charCodeAt(at++) - 63;
        result |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (at < OUTLINE.length) {
      lat += next();
      lng += next();
      points.push([lat / 1000, lng / 1000]);
    }
    return points;
  }

  /* -------------------------------- Leaflet -------------------------------- */
  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      // The stylesheet first (the map needs it to lay out its tiles), but never wait on it forever.
      const css = new Promise((done) => {
        let link = document.querySelector("link[data-pin-leaflet]");
        if (link) { done(); return; }
        link = document.createElement("link");
        Object.assign(link, { rel: "stylesheet", href: LEAFLET.css, integrity: LEAFLET.cssHash, crossOrigin: "" });
        link.dataset.pinLeaflet = "";
        link.onload = done;
        link.onerror = done;
        window.setTimeout(done, 6000);
        document.head.append(link);
      });
      const script = document.createElement("script");
      Object.assign(script, { src: LEAFLET.js, integrity: LEAFLET.jsHash, crossOrigin: "", async: true });
      script.onload = () => css.then(() => (window.L?.map ? resolve(window.L) : reject(new Error("Leaflet is missing."))));
      script.onerror = () => {
        script.remove();
        reject(new Error("Leaflet didn't load."));
      };
      document.head.append(script);
    }).catch((error) => {
      leafletPromise = null; // try again next time
      throw error;
    });
    return leafletPromise;
  }

  function markerIcon(type, label = "") {
    if (type === "real") {
      return L.divIcon({
        className: "pin-icon",
        html: `<span class="pin-marker is-real"><span>${escape(label)}</span></span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
    }
    return L.divIcon({
      className: "pin-icon",
      html: `<span class="pin-marker is-${type}"><svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 38.5S3 25.6 3 15.4a12 12 0 0 1 24 0C27 25.6 15 38.5 15 38.5Z"/><circle cx="15" cy="15.2" r="4.4"/></svg></span>`,
      iconSize: [30, 40],
      iconAnchor: [15, 39]
    });
  }

  function fitCountry(animate) {
    map.fitBounds(SWISS, { padding: [6, 6], animate: animate && !reduced() });
  }

  // The lowest zoom shows all of Switzerland. Measured again when the map's size changes;
  // a map made while its page was still hidden gets its view once it has a size.
  function updateMinZoom() {
    if (!map || !mapEl.clientWidth || !mapEl.clientHeight) return;
    map.invalidateSize({ pan: false });
    const zoom = map.getBoundsZoom(SWISS, false, L.point(12, 12));
    map.setMinZoom(Math.max(4, Math.min(zoom, 9)));
    if (!sized) {
      sized = true;
      fittedFor = "";
      drawn.map = "";
      fitCountry(false);
      if (data) drawMap();
    }
  }

  function makeMap() {
    if (map) return map;
    const carto = cartoKey();
    map = L.map(mapEl, {
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      maxZoom: MAX_ZOOM,
      maxBounds: LIMITS,
      maxBoundsViscosity: 1,
      doubleClickZoom: false,
      boxZoom: false,
      bounceAtZoomLimits: false,
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: !reduced(),
      fadeAnimation: !reduced(),
      markerZoomAnimation: !reduced()
    });
    map.setView([46.8, 8.23], 7, { animate: false });
    L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
    if (carto) {
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(carto)}`, {
        subdomains: "abcd",
        maxZoom: MAX_ZOOM,
        bounds: AREA,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
      }).addTo(map);
    } else {
      L.tileLayer("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg", {
        maxZoom: MAX_ZOOM,
        detectRetina: true,
        bounds: AREA,
        attribution: '&copy; <a href="https://www.swisstopo.admin.ch/en/home.html" target="_blank" rel="noopener">swisstopo</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
    }
    mapEl.classList.toggle("is-photo", !carto);
    // A soft veil outside Switzerland and its border line.
    const border = decodeOutline();
    L.polygon([[[43.5, 2], [50.5, 2], [50.5, 14.5], [43.5, 14.5]], border], { stroke: false, fillColor: "#fff", fillOpacity: carto ? 0.5 : 0.38, interactive: false }).addTo(map);
    L.polygon(border, { className: "pin-border", color: carto ? "#dc4f83" : "#fff", weight: 2, opacity: 0.9, fill: false, interactive: false }).addTo(map);
    layers = L.layerGroup().addTo(map);
    updateMinZoom();
    map.on("click", (event) => dropPin(event.latlng));
    mapEl.addEventListener("keydown", (event) => {
      // Keyboard: arrows move the map, + and - zoom, Enter drops the pin in the middle.
      if (event.target !== mapEl || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      dropPin(map.getCenter());
    });
    if ("ResizeObserver" in window) new ResizeObserver(() => updateMinZoom()).observe(mapEl);
    else window.addEventListener("resize", updateMinZoom);
    return map;
  }

  async function ensureMap() {
    if (map) return map;
    noteEl.hidden = false;
    noteEl.textContent = "Loading the map…";
    try {
      L = await loadLeaflet();
      makeMap();
      mapFailed = false;
      noteEl.hidden = true;
      drawn.map = "";
      render();
    } catch {
      mapFailed = true;
      noteEl.textContent = "Couldn’t load the map. Check your connection and try again.";
      retryButton.hidden = false;
    }
    return map;
  }

  /* -------------------------------- Playing -------------------------------- */
  const playing = () => Boolean(data && (!data.mine.done || reveal !== null));

  function dropPin(latlng) {
    if (!data || saving || reveal !== null || data.mine.done || data.next === null) return;
    pending = { index: data.next, lat: clamp(latlng.lat, AREA[0][0], AREA[1][0]), lng: clamp(latlng.lng, AREA[0][1], AREA[1][1]) };
    saveDraft();
    showError("");
    drawMine(true);
    renderAction();
    renderPrompt();
  }

  // My pin while I'm still choosing: tap again or drag it to move it.
  function drawMine(dropped = false) {
    if (!map || !pending) return;
    if (!mineMarker) {
      mineMarker = L.marker([pending.lat, pending.lng], { icon: markerIcon("mine"), draggable: true, keyboard: false, autoPan: true, title: "Your pin" });
      mineMarker.on("dragend", () => {
        const at = mineMarker.getLatLng();
        if (reveal !== null || !pending) return;
        pending = { ...pending, lat: clamp(at.lat, AREA[0][0], AREA[1][0]), lng: clamp(at.lng, AREA[0][1], AREA[1][1]) };
        saveDraft();
      });
    }
    mineMarker.setLatLng([pending.lat, pending.lng]);
    if (!layers.hasLayer(mineMarker)) mineMarker.addTo(layers);
    const element = mineMarker.getElement()?.querySelector(".pin-marker");
    if (dropped && element && !reduced()) {
      element.classList.remove("is-dropped");
      void element.offsetWidth;
      element.classList.add("is-dropped");
    }
  }

  async function confirmPin() {
    if (!data || saving || !pending || pending.index !== data.next) return;
    saving = true;
    renderAction();
    showError("");
    const identity = identitySeq;
    const { index, lat, lng } = pending;
    try {
      const result = await app().apiRequest("/games/pin", "POST", { author: me(), day: data.day, index, lat, lng });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      pending = null;
      reveal = index;
      data = result;
      render();
      games()?.reward?.(result.awarded);
      if (result.mine.done) {
        const res = result.result;
        postActivity({
          kind: "pin.played",
          text: res
            ? (res.winner === me() ? "won today’s map pin" : res.winner === "tie" ? "played map pin: a tie" : "played map pin: you won")
            : `pinned today’s 3 places${result.mine.near ? `, ${result.mine.near} within ${NEAR_KM} km` : ""}`,
          step: "pin",
          icon: "map-pin",
          push: true
        });
        games()?.refresh?.();
      }
      revealEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      renderAction();
      showError(error.status ? error.message : "Couldn’t send your pin. Check your connection and try again.");
      if (error.status === 409) {
        pending = null;
        clearDraft();
        load();
      }
    }
  }

  function nextPlace() {
    reveal = null;
    focus = null;
    render();
    const target = data.mine.done ? headEl : promptEl;
    target.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  /* -------------------------------- Drawing -------------------------------- */
  function offMessage(km) {
    if (km <= 1) return "Bullseye!";
    if (km <= NEAR_KM) return "So close!";
    if (km <= 30) return "Not bad at all.";
    if (km <= 80) return "Right part of the country.";
    return "A bit of a trip from there.";
  }

  function placeTitle(place, label) {
    const [kind, icon] = kindOf(place?.kind);
    return `<p class="pin-name"><span class="pin-kind">${iconHtml(icon)}</span><span class="pin-name-copy"><small>${escape(label)} · ${escape(kind)}</small><strong>${escape(place?.name || "")}</strong></span></p>`;
  }

  function promptHtml() {
    const index = reveal ?? data.next;
    const place = data.places[index];
    if (!place) return "";
    const progress = Array.from({ length: data.count }, (_, at) => `<span class="${at < index || (at === index && reveal !== null) ? "is-done" : at === index ? "is-current" : ""}"></span>`).join("");
    let hint = "";
    if (reveal === null) {
      hint = pending
        ? `<p class="pin-hint is-set">${iconHtml("map-pin-check")}Pin dropped. Tap again or drag it to move it, then confirm.</p>`
        : `<p class="pin-hint">${iconHtml("hand")}Tap the map where it is. Pinch to zoom in.</p>`;
    }
    return `<div class="match-progress" aria-hidden="true">${progress}</div>${placeTitle(place, `Place ${index + 1} of ${data.count}`)}${hint}`;
  }

  function revealHtml() {
    const place = data.places[reveal];
    const mine = data.mine.pins[reveal];
    if (!place || !mine) return "";
    const near = mine.km <= NEAR_KM;
    return `<p class="pin-off${near ? " is-near" : ""}"><strong>${escape(kmText(mine.km))}</strong> off · ${escape(offMessage(mine.km))}</p>
      ${near ? `<p class="pin-bonus">${iconHtml("heart")}Within ${NEAR_KM} km: a bonus heart once you both played</p>` : ""}
      <p class="quick-why">${iconHtml("lightbulb")}${escape(place.clue || "")}</p>`;
  }

  function headHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    if (!res) {
      return `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">${escape(kmText(data.mine.km))} off in total</p>
          <p class="match-waiting-copy">Waiting for ${them} to pin today’s places. No hints!</p></div></div>`;
    }
    const score = `${res.points[me()]} : ${res.points[other()]}`.replace(/\.5/g, "½");
    const message = res.winner === "tie" ? "A tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
    // More places won decides the day; the total distance is only for fun.
    return `<div class="match-score"><p class="match-score-big"><strong>${escape(score)}</strong>places won</p>
        <p class="match-score-msg">${escape(message)}</p>
        <p class="pin-total">${iconHtml("ruler")}Off in total: you ${escape(kmText(res.km[me()]))} · ${them} ${escape(kmText(res.km[other()]))}</p></div>`;
  }

  function rowsHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    return data.places.map((place, index) => {
      const mine = data.mine.pins[index];
      const theirs = data.theirs?.pins?.[index];
      const row = res?.places?.[index];
      const mark = (who) => (row?.winner === who || row?.winner === "tie" ? " is-win" : "");
      const near = (pin) => (pin?.near ? `<em class="price-spot">Within ${NEAR_KM} km</em>` : "");
      return `<li><button class="pin-row${focus === index ? " is-focus" : ""}" type="button" data-focus="${index}" aria-pressed="${focus === index}">
          <span class="pin-row-num">${index + 1}</span>
          <span class="pin-row-copy">
            <strong>${escape(place?.name || "")}</strong>
            <small>${escape(place?.clue || "")}</small>
            <span class="price-guesses">
              <span class="price-guess${mark(me())}">You: ${escape(kmText(mine?.km))}${near(mine)}</span>
              <span class="price-guess${mark(other())}">${them}: ${theirs ? `${escape(kmText(theirs.km))}${near(theirs)}` : "…"}</span>
            </span>
          </span>
        </button></li>`;
    }).join("");
  }

  function legendHtml() {
    const theirs = Boolean(data.theirs);
    return `<span><i class="pin-dot is-mine"></i>You</span>${theirs ? `<span><i class="pin-dot is-theirs"></i>${escape(nameOf(other()))}</span>` : ""}<span><i class="pin-dot is-real"></i>Real spot</span>${theirs || data.mine.done ? `<span class="pin-legend-tip">Tap a place to zoom in</span>` : ""}`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Within ${NEAR_KM} km</dt><dd><strong>${Number(stats.near?.[me()]) || 0} : ${Number(stats.near?.[other()]) || 0}</strong><small>close pins</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>days together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  // The map's markers and lines for what's on screen. Redrawn only when that changes.
  function drawMap() {
    if (!map || !sized) return;
    const mode = playing() ? (reveal !== null ? `reveal:${reveal}` : `play:${data.next}`) : `result:${focus}`;
    const key = JSON.stringify([data.day, mode, data.mine.pins, data.theirs?.pins || null, me()]);
    if (drawn.map === key) {
      if (mode.startsWith("play")) drawMine();
      return;
    }
    drawn.map = key;
    layers.clearLayers();
    const real = (place, label) => L.marker([place.lat, place.lng], { icon: markerIcon("real", label), keyboard: false, interactive: false, zIndexOffset: 500 }).addTo(layers);
    const pinAt = (pin, type) => L.marker([pin.lat, pin.lng], { icon: markerIcon(type), keyboard: false, interactive: false }).addTo(layers);
    const line = (pin, place, type) => L.polyline([[pin.lat, pin.lng], [place.lat, place.lng]], { className: `pin-line is-${type}`, color: type === "theirs" ? "#7c5cc4" : "#ad315f", weight: 2.5, dashArray: "5 6", interactive: false }).addTo(layers);
    const fit = (points, maxZoom) => {
      if (fittedFor === key) return;
      fittedFor = key;
      // Room for the pin heads above their points, the zoom buttons and the credits.
      map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [34, 52], paddingBottomRight: [62, 40], maxZoom, animate: !reduced() });
    };
    if (mode.startsWith("play")) {
      pending = pending?.index === data.next ? pending : readDraft(data.next);
      if (pending) drawMine();
      if (!fittedFor.startsWith(`play:${data.day}:${data.next}`)) {
        fittedFor = `play:${data.day}:${data.next}`;
        fitCountry(true);
      }
      return;
    }
    if (mode.startsWith("reveal")) {
      const place = data.places[reveal];
      const mine = data.mine.pins[reveal];
      line(mine, place, "mine");
      pinAt(mine, "mine");
      real(place, "");
      L.tooltip({ permanent: true, direction: "center", className: "pin-km", interactive: false })
        .setLatLng([(mine.lat + place.lat) / 2, (mine.lng + place.lng) / 2])
        .setContent(escape(kmText(mine.km)))
        .addTo(layers);
      fit([[mine.lat, mine.lng], [place.lat, place.lng]], 9);
      return;
    }
    const points = [];
    data.places.forEach((place, index) => {
      if (!place || !Number.isFinite(place.lat)) return;
      if (focus !== null && focus !== index) return;
      const mine = data.mine.pins[index];
      const theirs = data.theirs?.pins?.[index];
      if (theirs) { line(theirs, place, "theirs"); pinAt(theirs, "theirs"); points.push([theirs.lat, theirs.lng]); }
      if (mine) { line(mine, place, "mine"); pinAt(mine, "mine"); points.push([mine.lat, mine.lng]); }
      real(place, String(index + 1));
      points.push([place.lat, place.lng]);
    });
    if (points.length) fit(points, focus === null ? 8 : 10);
  }

  function renderPrompt() {
    put(promptEl, "prompt", playing() ? promptHtml() : "");
  }

  function renderAction() {
    let label = "";
    let icon = "";
    let disabled = false;
    if (playing()) {
      if (reveal !== null) {
        label = data.mine.done ? "See today’s result" : "Next place";
        icon = data.mine.done ? "flag" : "arrow-right";
      } else {
        label = saving ? "Pinning…" : "Confirm pin";
        icon = "map-pin-check";
        disabled = saving || !pending || !map;
      }
    }
    actionButton.hidden = !label;
    actionButton.disabled = disabled;
    const html = label ? `${escape(label)} ${iconHtml(icon)}` : "";
    if (html !== lastAction) {
      actionButton.innerHTML = html;
      lastAction = html;
      icons(actionButton);
    }
  }

  function render() {
    if (!data) return;
    statusEl.hidden = true;
    const play = playing();
    ledeEl.hidden = !play || data.mine.pins.length > 0 || reveal !== null;
    ledeEl.textContent = data.theirsDone
      ? `${nameOf(other())} already played. Your turn! Closer pin wins each place, more places wins the day.`
      : "Three Swiss places a day: tap the map where each one is. The closer pin wins the place, and more places wins the day.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    boardEl.hidden = false;
    promptEl.hidden = !play;
    renderPrompt();
    revealEl.hidden = !play || reveal === null;
    put(revealEl, "reveal", play && reveal !== null ? revealHtml() : "");
    headEl.hidden = play;
    put(headEl, "head", play ? "" : headHtml());
    rowsEl.hidden = play;
    put(rowsEl, "rows", play ? "" : rowsHtml());
    legendEl.hidden = !map || (play && reveal === null);
    put(legendEl, "legend", legendEl.hidden ? "" : legendHtml());
    renderAction();
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats || play;
    put(statsEl, "stats", play ? "" : stats);
    mapEl.setAttribute("aria-label", play && reveal === null ? "Map of Switzerland. Tap where the place is to drop your pin; arrow keys move the map, plus and minus zoom, Enter drops the pin in the middle." : "Map of Switzerland with the real spots and the pins");
    mapEl.classList.toggle("is-placing", play && reveal === null);
    if (map) drawMap();
    else if (!mapFailed) ensureMap();
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (saving) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s places…";
      boardEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/pin?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || saving) return;
      if (data?.day !== result.day) {
        reveal = null;
        focus = null;
        pending = null;
      }
      data = result;
      if (!quiet && !mapFailed) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Map pin needs the latest server update first." : "Couldn’t load today’s places. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "pin") return;
      load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    data = null;
    saving = false;
    pending = null;
    reveal = null;
    focus = null;
    fittedFor = "";
    drawn = { head: "", prompt: "", reveal: "", rows: "", stats: "", legend: "", map: "" };
    layers?.clearLayers();
    headEl.innerHTML = "";
    promptEl.innerHTML = "";
    revealEl.innerHTML = "";
    rowsEl.innerHTML = "";
    statsEl.innerHTML = "";
    actionButton.hidden = true;
    showError("");
    if (app()?.step === "pin") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  actionButton.addEventListener("click", () => {
    if (reveal !== null) nextPlace();
    else confirmPin();
  });
  rowsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus]");
    if (!button || !data) return;
    const index = Number(button.dataset.focus);
    focus = focus === index ? null : index;
    render();
    boardEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  });
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    showError("");
    if (mapFailed) {
      mapFailed = false;
      ensureMap();
    }
    load();
  });
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "pin") {
      load();
      startPolling();
      // The map was hidden with its page: measure it again once it shows.
      if (map) window.requestAnimationFrame(() => updateMinZoom());
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "pin") load({ quiet: true });
  });
})();
