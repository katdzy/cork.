/**
 * Demo photography, generated.
 *
 * The starter board ships with real-looking images rather than grey
 * placeholders — each one is a small hand-composed SVG scene with film grain
 * and a colour grade, so the demo works offline and always looks intentional.
 */

const soft = (id: string, dev: number) =>
  `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${dev}"/></filter>`;

/**
 * Film finish: a speck pattern, a warm wash and a vignette.
 * Deliberately pattern-based rather than feTurbulence — noise filters are
 * ruinously slow when a dozen photos paint at once.
 */
const finish = (w: number, h: number, seed: number, warm = '#f0c088', amount = 0.4) => `
  <rect width="${w}" height="${h}" fill="url(#speck${seed})" opacity="${amount}" style="mix-blend-mode:overlay"/>
  <rect width="${w}" height="${h}" fill="${warm}" opacity="0.1" style="mix-blend-mode:soft-light"/>
  <rect width="${w}" height="${h}" fill="url(#vig${seed})"/>
  <defs>
    <pattern id="speck${seed}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(${(seed % 7) * 11})">
      <rect width="9" height="9" fill="#808080"/>
      <circle cx="1.8" cy="2.4" r="0.9" fill="#ffffff" opacity="0.55"/>
      <circle cx="6.2" cy="6.8" r="0.8" fill="#000000" opacity="0.45"/>
      <circle cx="7.4" cy="1.6" r="0.5" fill="#ffffff" opacity="0.3"/>
      <circle cx="3.2" cy="7.2" r="0.5" fill="#000000" opacity="0.25"/>
    </pattern>
    <radialGradient id="vig${seed}" cx="50%" cy="45%" r="72%">
      <stop offset="55%" stop-color="#2a1c10" stop-opacity="0"/>
      <stop offset="100%" stop-color="#2a1c10" stop-opacity="0.3"/>
    </radialGradient>
  </defs>`;

const toUri = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s{2,}/g, ' ').trim())}`;

const wrap = (w: number, h: number, body: string) =>
  toUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  );

/* ---------------------------------------------------------------- beach */
export const beach = () => {
  const w = 900;
  const h = 640;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4e9ec0"/><stop offset="52%" stop-color="#bcdadd"/>
        <stop offset="100%" stop-color="#f6e2be"/>
      </linearGradient>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1f6f88"/><stop offset="60%" stop-color="#3d92a0"/>
        <stop offset="100%" stop-color="#83bfba"/>
      </linearGradient>
      <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e6d3ab"/><stop offset="100%" stop-color="#cdb488"/>
      </linearGradient>
      ${soft('b1', 26)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sky)"/>
    <circle cx="676" cy="168" r="54" fill="#fff3d2" opacity="0.92" filter="url(#b1)"/>
    <circle cx="676" cy="168" r="26" fill="#fffaf0"/>
    <ellipse cx="230" cy="150" rx="150" ry="34" fill="#ffffff" opacity="0.42" filter="url(#b1)"/>
    <ellipse cx="520" cy="112" rx="110" ry="24" fill="#ffffff" opacity="0.3" filter="url(#b1)"/>
    <rect y="356" width="${w}" height="150" fill="url(#sea)"/>
    <path d="M0 356 H900 V372 H0Z" fill="#2f6b7d" opacity="0.5"/>
    <g fill="#ffffff" opacity="0.5">
      <rect x="60" y="430" width="180" height="4" rx="2"/><rect x="330" y="462" width="240" height="5" rx="2"/>
      <rect x="620" y="418" width="200" height="4" rx="2"/><rect x="180" y="486" width="300" height="5" rx="2"/>
    </g>
    <path d="M0 500 Q450 470 900 506 V640 H0Z" fill="url(#sand)"/>
    <path d="M0 500 Q450 470 900 506 V520 Q450 492 0 518Z" fill="#ffffff" opacity="0.55"/>
    <g fill="#3b2d22" opacity="0.88">
      <circle cx="336" cy="436" r="12"/>
      <rect x="324" y="450" width="24" height="42" rx="11"/>
      <rect x="327" y="488" width="8" height="36" rx="4"/>
      <rect x="338" y="488" width="8" height="36" rx="4"/>
      <rect x="313" y="454" width="7" height="30" rx="3.5" transform="rotate(14 316 454)"/>
      <rect x="351" y="454" width="7" height="30" rx="3.5" transform="rotate(-16 354 454)"/>

      <circle cx="392" cy="444" r="11"/>
      <rect x="381" y="457" width="22" height="40" rx="10"/>
      <rect x="384" y="493" width="7.5" height="32" rx="3.7"/>
      <rect x="394" y="493" width="7.5" height="32" rx="3.7"/>
      <rect x="371" y="460" width="6.5" height="28" rx="3.2" transform="rotate(20 374 460)"/>
      <rect x="405" y="460" width="6.5" height="28" rx="3.2" transform="rotate(-24 408 460)"/>
    </g>
    <ellipse cx="336" cy="526" rx="24" ry="5" fill="#6f5738" opacity="0.3"/>
    <ellipse cx="392" cy="527" rx="22" ry="5" fill="#6f5738" opacity="0.28"/>

    <g>
      <rect x="676" y="452" width="5" height="76" rx="2.5" fill="#8a6d4a"/>
      <path d="M604 456 a76 46 0 0 1 152 0z" fill="#cf6a56"/>
      <path d="M604 456 a76 46 0 0 1 38-40 a44 40 0 0 0-2 40z" fill="#f2ece0" opacity="0.9"/>
      <path d="M718 416 a76 46 0 0 1 38 40 h-36 a44 40 0 0 0-2-40z" fill="#f2ece0" opacity="0.9"/>
      <path d="M604 456 h152" stroke="#8f4436" stroke-width="3" opacity="0.5"/>
    </g>
    ${finish(w, h, 21, '#ffd7a0')}`,
  );
};

/* --------------------------------------------------------------- sunset */
export const sunset = () => {
  const w = 900;
  const h = 640;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3f3f6b"/><stop offset="30%" stop-color="#a1567a"/>
        <stop offset="58%" stop-color="#e07a54"/><stop offset="78%" stop-color="#f6b969"/>
        <stop offset="100%" stop-color="#f8dc9c"/>
      </linearGradient>
      <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9764f"/><stop offset="100%" stop-color="#5b3350"/>
      </linearGradient>
      ${soft('s1', 20)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sg)"/>
    <circle cx="470" cy="404" r="96" fill="#ffe9ad" opacity="0.55" filter="url(#s1)"/>
    <circle cx="470" cy="408" r="58" fill="#fff2c9"/>
    <g fill="#8d4a5c" opacity="0.5">
      <ellipse cx="240" cy="250" rx="190" ry="16"/><ellipse cx="640" cy="206" rx="150" ry="12"/>
      <ellipse cx="440" cy="308" rx="240" ry="14"/>
    </g>
    <rect y="452" width="${w}" height="188" fill="url(#water)"/>
    <g fill="#ffe0a8" opacity="0.5">
      <rect x="440" y="470" width="62" height="4" rx="2"/><rect x="424" y="492" width="96" height="5" rx="2"/>
      <rect x="446" y="518" width="58" height="4" rx="2"/><rect x="410" y="548" width="120" height="5" rx="2"/>
      <rect x="452" y="584" width="46" height="4" rx="2"/>
    </g>
    <g stroke="#4a2e3f" stroke-width="3" fill="none" opacity="0.75" stroke-linecap="round">
      <path d="M700 168 q10-9 20 0 q10-9 20 0"/><path d="M756 210 q8-7 16 0 q8-7 16 0"/>
      <path d="M660 226 q7-6 14 0 q7-6 14 0"/>
    </g>
    ${finish(w, h, 34, '#ffb877', 0.3)}`,
  );
};

/* -------------------------------------------------------------- concert */
export const concert = () => {
  const w = 900;
  const h = 640;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#241633"/><stop offset="60%" stop-color="#3b1c34"/>
        <stop offset="100%" stop-color="#120b18"/>
      </linearGradient>
      <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd88a" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#ff9c6e" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="beam2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8fd4ff" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#7a6cff" stop-opacity="0"/>
      </linearGradient>
      ${soft('c1', 18)}${soft('c2', 6)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#cbg)"/>
    <g filter="url(#c1)">
      <path d="M300 0 L210 470 L410 470 Z" fill="url(#beam)"/>
      <path d="M560 0 L470 460 L700 460 Z" fill="url(#beam2)"/>
      <path d="M760 0 L640 470 L880 470 Z" fill="url(#beam)" opacity="0.6"/>
    </g>
    <ellipse cx="450" cy="416" rx="250" ry="70" fill="#ffb877" opacity="0.28" filter="url(#c1)"/>
    <g fill="#1a1020" opacity="0.95">
      <path d="M368 400 c0-30 22-52 50-52 s50 22 50 52 c30 10 44 34 44 66 h-188 c0-32 14-56 44-66z"/>
    </g>
    <g fill="#ffd9a3" opacity="0.35" filter="url(#c2)">
      <circle cx="180" cy="180" r="7"/><circle cx="740" cy="140" r="5"/><circle cx="620" cy="250" r="8"/>
      <circle cx="120" cy="330" r="6"/><circle cx="820" cy="300" r="7"/><circle cx="330" cy="120" r="4"/>
    </g>
    <path d="M0 640 V520 q40-26 80-4 q34 20 62-6 q30-28 66-2 q30 22 58-8 q30-32 68-4 q32 24 62-6 q30-30 68-2 q32 26 62-6 q32-34 72-2 q34 28 66 0 q34-30 72 2 q26 24 66 6 V640Z" fill="#0d0714"/>
    <g stroke="#0d0714" stroke-width="12" stroke-linecap="round" opacity="0.9">
      <path d="M140 540 L128 470"/><path d="M300 528 L316 452"/><path d="M520 532 L534 462"/>
      <path d="M690 526 L676 458"/><path d="M810 540 L822 480"/>
    </g>
    ${finish(w, h, 47, '#ff9d6a', 0.34)}`,
  );
};

/* -------------------------------------------------------------- friends */
export const friends = () => {
  const w = 900;
  const h = 700;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e2c8a0"/><stop offset="55%" stop-color="#cfa87c"/>
        <stop offset="100%" stop-color="#9d7550"/>
      </linearGradient>
      ${soft('f1', 14)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#room)"/>
    <ellipse cx="450" cy="200" rx="420" ry="200" fill="#ffe6bd" opacity="0.5" filter="url(#f1)"/>
    <g stroke="#8a6642" stroke-width="3" fill="none" opacity="0.55"><path d="M-20 96 Q220 152 460 92 Q700 34 920 108"/></g>
    <g fill="#ffe3a8" opacity="0.9" filter="url(#f1)">
      <circle cx="80" cy="120" r="9"/><circle cx="220" cy="140" r="9"/><circle cx="360" cy="120" r="9"/>
      <circle cx="500" cy="96" r="9"/><circle cx="640" cy="82" r="9"/><circle cx="780" cy="104" r="9"/>
    </g>
    <g fill="#43301f">
      <g opacity="0.82"><circle cx="150" cy="430" r="54"/><path d="M62 700 c0-86 40-140 88-140 s88 54 88 140z"/></g>
      <g opacity="0.86"><circle cx="762" cy="440" r="52"/><path d="M678 700 c0-84 38-136 84-136 s84 52 84 136z"/></g>
      <g opacity="0.93"><circle cx="292" cy="386" r="62"/><path d="M190 700 c0-98 46-158 102-158 s102 60 102 158z"/></g>
      <g opacity="0.96"><circle cx="608" cy="398" r="58"/><path d="M512 700 c0-94 44-152 96-152 s96 58 96 152z"/></g>
      <g opacity="1"><circle cx="446" cy="356" r="70"/><path d="M330 700 c0-110 52-178 116-178 s116 68 116 178z"/></g>
    </g>
    <g fill="#2f2114" opacity="0.9">
      <rect x="0" y="640" width="900" height="60" rx="4"/>
      <rect x="196" y="596" width="34" height="46" rx="5" fill="#6b5136"/>
      <rect x="520" y="590" width="30" height="52" rx="4" fill="#6b5136"/>
      <rect x="648" y="600" width="36" height="42" rx="6" fill="#6b5136"/>
    </g>
    ${finish(w, h, 58, '#ffce8f', 0.3)}`,
  );
};

/* ---------------------------------------------------------------- coffee */
export const coffee = () => {
  const w = 800;
  const h = 800;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="tbl" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#a97c50"/><stop offset="50%" stop-color="#8f6741"/>
        <stop offset="100%" stop-color="#6f4e30"/>
      </linearGradient>
      <radialGradient id="brew" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stop-color="#6b3f21"/><stop offset="80%" stop-color="#3f2312"/>
      </radialGradient>
      ${soft('k1', 24)}${soft('k2', 3)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#tbl)"/>
    <g opacity="0.28" stroke="#5d3f26" stroke-width="2">
      <path d="M0 120 Q400 150 800 110"/><path d="M0 330 Q400 300 800 350"/>
      <path d="M0 560 Q400 590 800 540"/><path d="M0 720 Q400 700 800 740"/>
    </g>
    <path d="M0 0 L470 0 L250 800 L0 800 Z" fill="#fff0cf" opacity="0.34" filter="url(#k1)"/>
    <ellipse cx="418" cy="452" rx="176" ry="172" fill="#2c1a0c" opacity="0.3" filter="url(#k1)"/>
    <circle cx="404" cy="436" r="168" fill="#f6efe2"/>
    <circle cx="404" cy="436" r="168" fill="none" stroke="#d9cdb8" stroke-width="3"/>
    <path d="M556 400 q52 6 48 44 q-4 38-54 34" fill="none" stroke="#f2eadb" stroke-width="17" stroke-linecap="round"/>
    <circle cx="404" cy="436" r="112" fill="#fbf6ec"/>
    <circle cx="404" cy="436" r="94" fill="url(#brew)"/>
    <circle cx="404" cy="436" r="94" fill="none" stroke="#2a170a" stroke-width="2" opacity="0.35"/>
    <path
      d="M404 496 c-46-22-62-48-52-70 c8-18 34-20 48-2 c14-18 40-16 48 2 c10 22-6 48-44 70z"
      fill="#e5cba6"
      opacity="0.92"
      filter="url(#k2)"
    />
    <ellipse cx="404" cy="392" rx="52" ry="16" fill="#f0dcbe" opacity="0.6" filter="url(#k2)"/>
    <g transform="rotate(28 640 430)">
      <rect x="612" y="330" width="15" height="122" rx="7" fill="#cfd4d8"/>
      <ellipse cx="619" cy="470" rx="26" ry="34" fill="#dde2e6"/>
      <ellipse cx="619" cy="470" rx="17" ry="24" fill="#c2c9ce"/>
    </g>
    <g transform="rotate(-14 640 660)">
      <rect x="540" y="600" width="260" height="190" rx="6" fill="#efe6d2"/>
      <rect x="540" y="600" width="18" height="190" fill="#b8593f"/>
      <g stroke="#a8977c" stroke-width="3" stroke-linecap="round">
        <path d="M584 646 h188"/><path d="M584 682 h168"/><path d="M584 718 h196"/><path d="M584 754 h120"/>
      </g>
    </g>
    <g transform="rotate(12 120 640)" fill="#6f8a5f" opacity="0.9">
      <path d="M96 700 q-40-52 4-96 q44 44 4 96z"/><path d="M132 706 q52-30 44-88 q-58 20-44 88z"/>
    </g>
    ${finish(w, h, 63, '#ffcf95', 0.26)}`,
  );
};

/* -------------------------------------------------------------- roadtrip */
export const roadtrip = () => {
  const w = 900;
  const h = 620;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="dsky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6fa9c9"/><stop offset="60%" stop-color="#c8d9d6"/>
        <stop offset="100%" stop-color="#f2ddb8"/>
      </linearGradient>
      <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7d7469"/><stop offset="100%" stop-color="#4e4740"/>
      </linearGradient>
      ${soft('r1', 18)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#dsky)"/>
    <ellipse cx="180" cy="120" rx="130" ry="30" fill="#ffffff" opacity="0.5" filter="url(#r1)"/>
    <ellipse cx="640" cy="86" rx="150" ry="26" fill="#ffffff" opacity="0.4" filter="url(#r1)"/>
    <path d="M0 330 L160 232 L268 302 L392 214 L520 320 L640 250 L780 318 L900 258 V360 H0Z" fill="#8b7f8e" opacity="0.75"/>
    <path d="M0 352 L120 300 L240 350 L360 296 L500 356 L660 306 L820 352 L900 322 V400 H0Z" fill="#6e6474" opacity="0.85"/>
    <rect y="386" width="${w}" height="234" fill="#c9a877"/>
    <path d="M0 620 L372 386 L470 386 L900 620Z" fill="url(#road)"/>
    <g fill="#f4e6c4" opacity="0.9">
      <rect x="418" y="392" width="7" height="18" rx="3"/><rect x="412" y="426" width="9" height="24" rx="4"/>
      <rect x="400" y="472" width="12" height="32" rx="5"/><rect x="382" y="532" width="16" height="42" rx="6"/>
    </g>
    <g fill="#5a6d4a" opacity="0.9">
      <path d="M760 386 v-46 h10 v46z"/><path d="M765 300 q-30 10-24 34 q26 8 24-34z"/><path d="M765 300 q30 10 24 34 q-26 8-24-34z"/>
      <path d="M112 386 v-38 h9 v38z"/><path d="M116 320 q-26 8-20 28 q22 8 20-28z"/><path d="M116 320 q26 8 20 28 q-22 8-20-28z"/>
    </g>
    ${finish(w, h, 71, '#ffd39b', 0.28)}`,
  );
};

/* -------------------------------------------------- photobooth strip art */
export const photobooth = () => {
  const w = 300;
  const h = 940;
  const frame = (y: number, pose: string) => `
    <rect x="20" y="${y}" width="260" height="196" fill="#20201f"/>
    <g clip-path="url(#clip${y})">
      <rect x="20" y="${y}" width="260" height="196" fill="#3a3835"/>
      <rect x="20" y="${y}" width="260" height="196" fill="url(#lift)"/>
      ${pose}
    </g>
    <clipPath id="clip${y}"><rect x="20" y="${y}" width="260" height="196"/></clipPath>`;

  const pair = (y: number, dx1: number, dy1: number, dx2: number, dy2: number) => `
    <g fill="#151413" opacity="0.94">
      <circle cx="${112 + dx1}" cy="${y + 78 + dy1}" r="40"/>
      <path d="M${52 + dx1} ${y + 200} c0-52 27-84 60-84 s60 32 60 84z"/>
      <circle cx="${196 + dx2}" cy="${y + 86 + dy2}" r="38"/>
      <path d="M${140 + dx2} ${y + 200} c0-50 25-80 56-80 s56 30 56 80z"/>
    </g>`;

  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="lift" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="#111"/>
    ${frame(24, pair(24, 0, 0, 0, 0))}
    ${frame(252, pair(252, -6, 6, 8, -4))}
    ${frame(480, pair(480, 10, -6, -6, 8))}
    ${frame(708, pair(708, -2, 10, 4, 10))}
    ${finish(w, h, 83, '#e8d8c0', 0.4)}`,
  );
};

/* ------------------------------------------------------ postcard picture */
export const postcardArt = () => {
  const w = 760;
  const h = 500;
  return wrap(
    w,
    h,
    `<defs>
      <linearGradient id="psky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5c93b8"/><stop offset="70%" stop-color="#bcd6dd"/>
        <stop offset="100%" stop-color="#eddcbd"/>
      </linearGradient>
      ${soft('p1', 12)}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#psky)"/>
    <circle cx="150" cy="104" r="44" fill="#fff3d0" opacity="0.9" filter="url(#p1)"/>
    <path d="M0 300 L150 168 L268 262 L400 140 L540 268 L660 190 L760 258 V500 H0Z" fill="#6d7f92"/>
    <path d="M400 140 L470 204 L400 204Z" fill="#f2f4f6" opacity="0.9"/>
    <path d="M150 168 L196 212 L150 212Z" fill="#f2f4f6" opacity="0.85"/>
    <path d="M0 330 L180 250 L340 340 L520 260 L700 348 L760 320 V500 H0Z" fill="#4f6350"/>
    <path d="M0 420 Q380 380 760 424 V500 H0Z" fill="#3c4f3f"/>
    <g fill="#2f3f33" opacity="0.9">
      <path d="M96 500 v-70 h8 v70z"/><path d="M100 380 q-34 16-28 44 q30 10 28-44z"/><path d="M100 380 q34 16 28 44 q-30 10-28-44z"/>
    </g>
    ${finish(w, h, 91, '#ffd8a4', 0.26)}`,
  );
};

/* ---------------------------------------------------------- little bloom */
export const bloom = () => {
  const w = 420;
  const h = 420;
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 360) / 8;
    return `<ellipse cx="210" cy="128" rx="40" ry="76" fill="#e9b7bd" opacity="0.92" transform="rotate(${a} 210 210)"/>`;
  }).join('');
  return wrap(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="#e7e0cd"/>
     <circle cx="210" cy="210" r="150" fill="#f3ead6"/>
     ${petals}
     <circle cx="210" cy="210" r="42" fill="#e0b45c"/>
     <circle cx="210" cy="210" r="42" fill="url(#dots)" opacity="0.5"/>
     <defs><pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse">
       <circle cx="3" cy="3" r="1.6" fill="#a97d2c"/></pattern>
     </defs>
     ${finish(w, h, 97, '#ffd9b0', 0.24)}`,
  );
};
