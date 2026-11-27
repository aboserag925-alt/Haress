/* Haress cinematic intro — once per tab session; tap/click/keyboard skips it. */
(() => {
  "use strict";

  const SESSION_KEY = "haress_intro_seen_v1";
  const DURATION_MS = 5350;
  let alreadySeen = false;

  try {
    alreadySeen = sessionStorage.getItem(SESSION_KEY) === "1";
  } catch (_) {
    /* If storage is blocked, show once for this page load only. */
    alreadySeen = false;
  }
  if (alreadySeen || !document.body) return;

  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}

  const splash = document.createElement("div");
  splash.className = "haress-splash";
  splash.setAttribute("role", "dialog");
  splash.setAttribute("aria-label", "حارس - استراحة أهل الأثر");
  splash.setAttribute("aria-modal", "true");

  splash.innerHTML = `
    <div class="haress-splash__scene" dir="rtl">
      <svg class="haress-splash__emblem" viewBox="0 0 240 278" role="img" aria-label="درع حرس الحدود">
        <defs>
          <linearGradient id="haressShieldFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#197653"/>
            <stop offset=".52" stop-color="#0d563e"/>
            <stop offset="1" stop-color="#073a31"/>
          </linearGradient>
          <linearGradient id="haressGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff0bd"/>
            <stop offset=".32" stop-color="#d7b36a"/>
            <stop offset=".7" stop-color="#f4dda0"/>
            <stop offset="1" stop-color="#a77d39"/>
          </linearGradient>
        </defs>
        <path class="haress-splash__shield-fill"
          d="M120 12 L207 43 L201 133 C196 190 163 231 120 260 C77 231 44 190 39 133 L33 43 Z"/>
        <path class="haress-splash__shield-outline"
          d="M120 12 L207 43 L201 133 C196 190 163 231 120 260 C77 231 44 190 39 133 L33 43 Z"/>
        <path class="haress-splash__inner-line"
          d="M120 27 L192 53 L187 132 C183 180 157 214 120 240 C83 214 57 180 53 132 L48 53 Z"/>
        <text class="haress-splash__shield-text" x="120" y="151" text-anchor="middle"
          direction="rtl" unicode-bidi="plaintext">حرس الحدود</text>
      </svg>
      <p class="haress-splash__subtitle">حارس · استراحة أهل الأثر</p>
    </div>
    <span class="haress-splash__glint" aria-hidden="true"></span>
    <button class="haress-splash__skip" type="button" aria-label="تخطّي المقدمة">تخطّي المقدمة</button>
  `;

  document.body.appendChild(splash);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    splash.classList.add("is-leaving");
    window.setTimeout(() => splash.remove(), 900);
    document.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      close();
    }
  };

  splash.addEventListener("click", close);
  document.addEventListener("keydown", onKeyDown);
  window.setTimeout(close, DURATION_MS);
})();
