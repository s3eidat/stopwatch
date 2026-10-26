/* Stopwatch & Timer — elapsed time always comes from Date.now() differences, never from counting ticks. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var sw = Object.assign({ acc: 0, startedAt: null, laps: [] }, S3.store("sw.state") || {});
  var tm = Object.assign({ duration: 300000, remaining: 300000, endAt: 0, running: false }, S3.store("sw.timer") || {});
  var tab = S3.store("sw.tab") || "sw";
  var ringing = false, alarmTimer = null, audio;
  var baseTitle = document.title;

  // ---------- pure helpers ----------
  function pad(n, w) { return String(n).padStart(w || 2, "0"); }
  function fmt(ms) { // h:mm:ss.cc or mm:ss.cc
    ms = Math.max(0, Math.floor(ms));
    var cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60) + "." + pad(cs);
  }
  function fmtS(ms) { // countdown: whole seconds, rounded up
    var s = Math.ceil(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60);
  }
  function elapsed(st, now) { return st.acc + (st.startedAt != null ? now - st.startedAt : 0); }
  function lapStats(totals) {
    var laps = totals.map(function (t, i) { return t - (i ? totals[i - 1] : 0); }), best = -1, worst = -1;
    if (laps.length >= 2) {
      best = 0; worst = 0;
      laps.forEach(function (l, i) { if (l < laps[best]) best = i; if (l > laps[worst]) worst = i; });
    }
    return { laps: laps, best: best, worst: worst };
  }
  function csv(totals) {
    var st = lapStats(totals);
    return "Lap,Lap time,Total\n" + st.laps.map(function (l, i) { return (i + 1) + "," + fmt(l) + "," + fmt(totals[i]); }).join("\n") + "\n";
  }
  function tmRemaining(t, now) { return t.running ? Math.max(0, t.endAt - now) : t.remaining; }

  function saveSw() { S3.store("sw.state", sw); }
  function saveTm() { S3.store("sw.timer", tm); }

  // ---------- rendering ----------
  function setDigits(text) {
    var dot = text.lastIndexOf("."), el = $("#digits");
    el.textContent = dot > 0 ? text.slice(0, dot) : text;
    if (dot > 0) el.appendChild(S3.h("small", { text: text.slice(dot) }));
  }
  function draw() {
    var now = Date.now(), face = $("#face");
    if (tm.running && tmRemaining(tm, now) <= 0) finishTimer();
    if (tab === "sw") {
      var e = elapsed(sw, now);
      setDigits(fmt(e));
      var cur = e - (sw.laps.length ? sw.laps[sw.laps.length - 1] : 0);
      $("#sub").textContent = sw.laps.length ? "Lap " + (sw.laps.length + 1) + " · " + fmt(cur) : " ";
      face.classList.toggle("running", sw.startedAt != null);
      face.classList.remove("ringing");
      document.title = sw.startedAt != null ? fmt(e).replace(/\.\d+$/, "") + " — Stopwatch" : baseTitle;
    } else {
      var r = tmRemaining(tm, now);
      setDigits(fmtS(r));
      $("#barFill").style.width = (tm.duration ? (1 - r / tm.duration) * 100 : 0) + "%";
      $("#sub").textContent = ringing ? "Time's up!" : tm.running ? "Ends at " + new Date(tm.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : tm.remaining < tm.duration ? "Paused" : " ";
      face.classList.toggle("running", tm.running);
      face.classList.toggle("ringing", ringing);
      document.title = ringing ? "⏰ Time's up!" : tm.running ? fmtS(r) + " — Timer" : baseTitle;
    }
  }
  function loop() { draw(); if ((tab === "sw" && sw.startedAt != null) || (tab === "tm" && tm.running)) requestAnimationFrame(loop); }
  // Background tabs pause rAF; this keeps the timer's alarm and title honest.
  setInterval(draw, 250);

  function renderSw() {
    var on = sw.startedAt != null;
    $("#swGo").textContent = on ? "Stop" : elapsed(sw, Date.now()) ? "Resume" : "Start";
    $("#swGo").classList.toggle("danger", on); $("#swGo").classList.toggle("primary", !on);
    $("#lap").disabled = !on;
    var st = lapStats(sw.laps), tb = $("#laps");
    tb.innerHTML = "";
    for (var i = st.laps.length - 1; i >= 0; i--) {
      tb.appendChild(S3.h("tr", { "class": i === st.best ? "best" : i === st.worst ? "worst" : "" }, [
        S3.h("td", { text: String(i + 1) }), S3.h("td", { text: fmt(st.laps[i]) + (i === st.best ? "  best" : i === st.worst ? "  slowest" : "") }), S3.h("td", { text: fmt(sw.laps[i]) })
      ]));
    }
    $("#lapWrap").hidden = !st.laps.length; $("#noLaps").hidden = !!st.laps.length;
    $("#lapCount").textContent = st.laps.length ? st.laps.length + " total" : "";
    var avg = st.laps.length ? st.laps.reduce(function (a, b) { return a + b; }, 0) / st.laps.length : 0;
    $("#lapStats").innerHTML = st.laps.length >= 2 ?
      ['<div class="stat"><b>' + S3.esc(fmt(st.laps[st.best])) + "</b><span>best lap</span></div>",
       '<div class="stat"><b>' + S3.esc(fmt(st.laps[st.worst])) + "</b><span>slowest lap</span></div>",
       '<div class="stat"><b>' + S3.esc(fmt(avg)) + "</b><span>average</span></div>"].join("") : "";
    draw();
  }
  function renderTm() {
    $("#tmGo").textContent = tm.running ? "Pause" : tm.remaining < tm.duration && tm.remaining > 0 ? "Resume" : "Start";
    $("#silence").hidden = !ringing;
    $("#tmGo").hidden = ringing;
    var secs = Math.round(tm.duration / 1000);
    $$("#presets button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.s === secs)); });
    draw();
  }
  function setTab(v) {
    tab = v; S3.store("sw.tab", v);
    $$("#tab button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === v)); });
    $("#swCtl").hidden = v !== "sw"; $("#tmCtl").hidden = v !== "tm"; $("#tmSet").hidden = v !== "tm"; $("#bar").hidden = v !== "tm";
    renderSw(); renderTm(); loop();
  }

  // ---------- stopwatch actions ----------
  function swToggle() {
    var now = Date.now();
    if (sw.startedAt != null) { sw.acc = elapsed(sw, now); sw.startedAt = null; S3.done(); } else sw.startedAt = now;
    saveSw(); renderSw(); loop();
  }
  function swLap() { if (sw.startedAt == null) return; sw.laps.push(elapsed(sw, Date.now())); saveSw(); renderSw(); }
  function swReset() { sw = { acc: 0, startedAt: null, laps: [] }; saveSw(); renderSw(); }

  // ---------- timer actions ----------
  function readInputs() {
    var h = Math.min(99, Math.max(0, parseInt($("#th").value, 10) || 0)), m = Math.min(59, Math.max(0, parseInt($("#tmn").value, 10) || 0)), s = Math.min(59, Math.max(0, parseInt($("#ts").value, 10) || 0));
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  function writeInputs(ms) { var s = Math.round(ms / 1000); $("#th").value = Math.floor(s / 3600); $("#tmn").value = Math.floor(s / 60) % 60; $("#ts").value = s % 60; }
  function setDuration(ms) { stopAlarm(); tm = { duration: ms, remaining: ms, endAt: 0, running: false }; saveTm(); renderTm(); }
  function tmToggle() {
    var now = Date.now();
    unlockAudio();
    if (tm.running) { tm.remaining = tmRemaining(tm, now); tm.running = false; }
    else {
      if (tm.remaining <= 0 || tm.remaining === tm.duration) { var d = readInputs(); if (!d) { S3.toast("Set a time first", "error"); return; } tm.duration = tm.remaining = d; }
      tm.endAt = now + tm.remaining; tm.running = true;
    }
    saveTm(); renderTm(); loop();
  }
  function tmReset() { stopAlarm(); tm.remaining = tm.duration = readInputs() || tm.duration; tm.running = false; saveTm(); renderTm(); }
  function finishTimer() {
    tm.running = false; tm.remaining = 0; saveTm();
    ringing = true; renderTm(); S3.done();
    if ($("#sound").checked) {
      var n = 0;
      beep(); alarmTimer = setInterval(function () { if (++n >= 30) stopAlarm(); else beep(); }, 1000);
    }
  }
  function stopAlarm() { ringing = false; clearInterval(alarmTimer); alarmTimer = null; }

  function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (e) { /* no audio */ } }
  function beep() {
    try {
      unlockAudio();
      [0, 0.18, 0.36].forEach(function (d) {
        var o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + d;
        o.type = "square"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        o.connect(g).connect(audio.destination); o.start(at); o.stop(at + 0.15);
      });
    } catch (e) { /* no audio */ }
  }

  // ---------- wiring ----------
  $$("#tab button").forEach(function (b) { b.addEventListener("click", function () { setTab(b.dataset.v); }); });
  $("#swGo").addEventListener("click", swToggle);
  $("#lap").addEventListener("click", swLap);
  $("#swReset").addEventListener("click", swReset);
  $("#tmGo").addEventListener("click", tmToggle);
  $("#tmReset").addEventListener("click", tmReset);
  $("#silence").addEventListener("click", function () { stopAlarm(); tm.remaining = tm.duration; saveTm(); renderTm(); });
  $$("#presets button").forEach(function (b) { b.addEventListener("click", function () { writeInputs(+b.dataset.s * 1000); setDuration(+b.dataset.s * 1000); }); });
  ["#th", "#tmn", "#ts"].forEach(function (id) { $(id).addEventListener("change", function () { if (!tm.running) { writeInputs(readInputs()); setDuration(readInputs()); } }); });
  $("#sound").checked = S3.store("sw.sound") !== false;
  $("#sound").addEventListener("change", function () { S3.store("sw.sound", $("#sound").checked); });
  function toggleFs() {
    var face = $("#face");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (face.requestFullscreen) face.requestFullscreen().catch(function () { S3.toast("Fullscreen isn't available here", "error"); });
  }
  $("#fs").addEventListener("click", toggleFs);
  function exportCsv() { return sw.laps.length ? csv(sw.laps) : null; }
  $("#copyCsv").addEventListener("click", function () { var c = exportCsv(); if (c) S3.copy(c); else S3.toast("No laps to copy yet", "error"); });
  $("#saveCsv").addEventListener("click", function () { var c = exportCsv(); if (c) { S3.download(c, "laps.csv", "text/csv"); S3.done(); } else S3.toast("No laps to export yet", "error"); });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (ringing && (k === " " || k === "escape")) { e.preventDefault(); $("#silence").click(); return; }
    if (e.code === "Space") { e.preventDefault(); if (tab === "sw") swToggle(); else tmToggle(); }
    else if (k === "l" && tab === "sw") swLap();
    else if (k === "r") { if (tab === "sw") swReset(); else tmReset(); }
    else if (k === "f") toggleFs();
  });

  writeInputs(tm.duration);
  setTab(tab);

  window.S3_DEMO = function () {
    var now = Date.now();
    sw = { acc: 0, startedAt: now - 274380, laps: [52310, 101940, 155020, 211700] };
    setTab("sw");
  };

  window.S3_SELFTEST = function () {
    var a = fmt(3723456) === "1:02:03.45" && fmt(65430) === "01:05.43" && fmt(0) === "00:00.00" && fmtS(1001) === "00:02" && fmtS(3600000) === "1:00:00";
    var st = { acc: 1000, startedAt: 5000, laps: [] }, b = elapsed(st, 8000) === 4000 && elapsed({ acc: 1500, startedAt: null }, 99999) === 1500;
    var ls = lapStats([10000, 18000, 30000, 39000]); // laps 10, 8, 12, 9 seconds
    var c = ls.best === 1 && ls.worst === 2 && ls.laps.join() === "10000,8000,12000,9000" && lapStats([5000]).best === -1;
    var d = csv([1000, 2500]) === "Lap,Lap time,Total\n1,00:01.00,00:01.00\n2,00:01.50,00:02.50\n";
    var e = tmRemaining({ running: true, endAt: 10000 }, 4000) === 6000 && tmRemaining({ running: true, endAt: 10000 }, 12000) === 0;
    return a && b && c && d && e;
  };
})();
