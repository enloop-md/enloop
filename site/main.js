// Enloop — the website's script. Three small jobs, each optional: the page
// reads complete without any of them.

// ── 1. Scale the mock screenshots ──
// Each `.fit` holds artwork laid out at a design width (`--dw`, in px). CSS
// already zooms it to the box; this sets the same ratio as a plain number
// for browsers that do not resolve the CSS expression.
const fits = [...document.querySelectorAll(".fit")];

function fit(box) {
  const art = box.firstElementChild;
  const designWidth = parseFloat(getComputedStyle(box).getPropertyValue("--dw"));
  if (!art || !designWidth || !box.clientWidth) return;
  art.style.zoom = String(box.clientWidth / designWidth);
}

if ("ResizeObserver" in window) {
  const observer = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
  fits.forEach((box) => observer.observe(box));
}
fits.forEach(fit);

// ── 2. Replay the loop ──
// One frame at a time is lit and re-typed, in order, round and round. Frames
// that are not lit stay finished, so the strip is a whole picture at every
// moment; the replay is skipped entirely when motion is reduced.
const loop = document.querySelector("[data-loop]");
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

if (loop && "IntersectionObserver" in window) {
  const beats = [...loop.querySelectorAll(".beat")];
  const TYPE_MS = 36;
  let timers = [];

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function settle(beat) {
    beat.classList.remove("is-active", "is-playing", "is-typing");
    const typed = beat.querySelector("[data-type]");
    if (typed && typed.dataset.text) typed.textContent = typed.dataset.text;
    beat.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("shown"));
    beat.querySelector("[data-moved]")?.classList.remove("is-before");
  }

  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    beats.forEach(settle);
  }

  function play(index) {
    timers.forEach(clearTimeout);
    timers = [];
    beats.forEach(settle);

    const beat = beats[index];
    const typed = beat.querySelector("[data-type]");
    const reveals = [...beat.querySelectorAll("[data-reveal]")];
    const moved = beat.querySelector("[data-moved]");
    let at = 400;

    beat.classList.add("is-active", "is-playing");
    reveals.forEach((el) => el.classList.remove("shown"));

    if (typed) {
      const text = (typed.dataset.text ??= typed.textContent);
      typed.textContent = "";
      beat.classList.add("is-typing");
      for (let n = 1; n <= text.length; n++) {
        later(() => (typed.textContent = text.slice(0, n)), at + n * TYPE_MS);
      }
      at += text.length * TYPE_MS + 380;
      later(() => beat.classList.remove("is-typing"), at);
    }

    if (moved) {
      moved.classList.add("is-before");
      later(() => moved.classList.remove("is-before"), 900);
      at = 1900;
    }

    reveals.forEach((el) => {
      later(() => el.classList.add("shown"), at);
      at += 240;
    });

    const hold = Math.max(Number(beat.dataset.ms) || 4000, at + 1300);
    later(() => play((index + 1) % beats.length), hold);
  }

  let onScreen = false;
  const sync = () => (onScreen && !calm.matches && !document.hidden ? play(0) : stop());

  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting === onScreen) return;
      onScreen = entry.isIntersecting;
      sync();
    },
    { threshold: 0.35 },
  ).observe(loop);
  calm.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
}

// ── 3. Copy buttons on the command blocks ──
if (navigator.clipboard) {
  document.querySelectorAll("[data-copy]").forEach((block) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(block.querySelector("code").textContent);
      button.textContent = "Copied";
      button.classList.add("done");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("done");
      }, 1400);
    });
    block.append(button);
  });
}
