const PALETTE = Object.freeze({
  blue: '#1769c2', red: '#c93638', green: '#2b8b64', black: '#232a32',
  white: '#e8edf2', silver: '#9aa6b2', yellow: '#d69a27', orange: '#d46b2d',
})

function requestedColor(text) {
  const match = String(text || '').match(/\b(blue|red|green|black|white|silver|yellow|orange)\b/i)
  return match ? PALETTE[match[1].toLowerCase()] : PALETTE.blue
}

export function vehicleConceptSvg(request) {
  const text = String(request || '')
  const body = requestedColor(text)
  const subaru = /\b(?:subaru|wrx)\b/i.test(text)
  const title = subaru ? 'SUBARU WRX' : 'RALLY SPORT SEDAN'
  const model = subaru ? '2.4L TURBO / SYMMETRICAL AWD' : 'RALLY-BRED / ALL-WHEEL DRIVE'
  const badge = subaru ? 'WRX' : 'RALLY SPORT'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<title>${title} — Nori VectorCraft side-profile concept</title>
<defs>
 <linearGradient id="paint" x1="0" y1="0" x2="0.12" y2="1"><stop stop-color="#79b4f0"/><stop offset=".24" stop-color="${body}"/><stop offset=".72" stop-color="#0d4f9d"/><stop offset="1" stop-color="#07366f"/></linearGradient>
 <linearGradient id="glass" x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="#e8f5fc"/><stop offset=".45" stop-color="#91b7cd"/><stop offset="1" stop-color="#243b50"/></linearGradient>
 <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4f7fa"/><stop offset=".45" stop-color="#8996a3"/><stop offset="1" stop-color="#d7dde3"/></linearGradient>
</defs>
<desc>Original front three-quarter Subaru WRX rally illustration: compact four-door sedan, long hood with hood scoop, angular hexagonal grille, wide fenders, low stance, tall rear rally wing and multi-spoke wheels. Concept artwork, not a photograph or an OEM rendering.</desc>
<rect width="1200" height="800" fill="#eef2f6"/>
<path d="M0 585H1200" stroke="#d6dee7" stroke-width="2"/>
<text x="74" y="68" fill="#26384a" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="4">N.O.R.I. / VECTORCRAFT</text>
<text x="1126" y="68" text-anchor="end" fill="#64788d" font-family="Arial,sans-serif" font-size="14" letter-spacing="2">ORIGINAL CONCEPT ART</text>
<text x="76" y="132" fill="#17283b" font-family="Arial,sans-serif" font-size="42" font-weight="700" letter-spacing="2">${title} · RALLY SPEC</text>
<text x="79" y="163" fill="#697c8f" font-family="Arial,sans-serif" font-size="15" letter-spacing="3">${model} / FOUR-DOOR SPORT SEDAN</text>
<ellipse cx="609" cy="574" rx="462" ry="31" fill="#738397" opacity=".22"/>

<path d="M118 500 Q127 465 165 450 L327 417 L411 342 Q454 299 509 292 L697 292 Q750 293 788 329 L874 415 L1003 439 Q1050 449 1070 479 L1082 522 L1068 548 L1001 555 L217 555 L141 548 L119 530Z" fill="url(#paint)" stroke="#142638" stroke-width="8" stroke-linejoin="round"/>
<path d="M374 409 L441 350 Q468 327 508 322 L566 322 L566 408Z" fill="url(#glass)" stroke="#172b3d" stroke-width="7" stroke-linejoin="round"/>
<path d="M581 322 L687 322 Q724 323 750 349 L806 409 L581 409Z" fill="url(#glass)" stroke="#172b3d" stroke-width="7" stroke-linejoin="round"/>
<path d="M573 320 L573 493 M814 409 L824 493" fill="none" stroke="#112639" stroke-width="8"/>
<path d="M469 425 L469 452 M687 425 L687 452" fill="none" stroke="#d8e4ed" stroke-width="5" opacity=".8"/>
<path d="M349 418 L405 418 M817 417 L864 417" fill="none" stroke="#c5d5e2" stroke-width="5"/>
<path d="M436 309 Q464 289 501 291 L543 292 L536 309 L463 317Z" fill="#102c47" stroke="#17344f" stroke-width="4"/>
<path d="M463 304 L521 299 L516 306 L467 312Z" fill="#86a9c2" opacity=".78"/>
<path d="M154 466 Q248 438 348 431 L429 407" fill="none" stroke="#c5e0fa" stroke-width="7" opacity=".72"/>
<path d="M158 485 Q283 461 369 458" fill="none" stroke="#75a9da" stroke-width="4" opacity=".65"/>
<path d="M851 427 Q940 444 1018 459" fill="none" stroke="#a9d4fa" stroke-width="6" opacity=".7"/>
<path d="M126 469 L190 454 L207 499 L190 531 L128 520Z" fill="#111a22" stroke="#d9e2e9" stroke-width="5" stroke-linejoin="round"/>
<path d="M137 472 L187 462 L199 499 L184 520 L137 514Z" fill="#202b35" stroke="#667786" stroke-width="2"/>
<path d="M143 477 L182 469 M141 486 L187 478 M141 495 L191 487 M141 504 L191 496 M143 513 L187 505" stroke="#697a87" stroke-width="3" opacity=".72"/>
<ellipse cx="165" cy="494" rx="15" ry="9" fill="#163f69" stroke="#d2dee8" stroke-width="2"/>
<g fill="#e7eef4"><path d="M158 489l2 2-2 2-2-2z M166 487l2 2-2 2-2-2z M172 490l2 2-2 2-2-2z M157 496l2 2-2 2-2-2z M165 494l2 2-2 2-2-2z M172 498l2 2-2 2-2-2z"/></g>
<path d="M195 456 L270 437 Q282 435 290 441 L277 461 L203 475Z" fill="#e9f5fb" stroke="#142638" stroke-width="4"/>
<path d="M201 458 L270 441 L259 449 L205 468Z" fill="#9ac9e8"/>
<path d="M128 522 L167 524 L169 538 L126 536Z" fill="#d8e7f2" stroke="#152739" stroke-width="3"/>
<path d="M1011 444 L1052 455 L1065 488 L1015 477Z" fill="#ed4048" stroke="#16293b" stroke-width="4"/>
<path d="M1022 453 L1048 462 L1054 475 L1022 468Z" fill="#ffb7a8"/>
<path d="M1005 542 L1070 532 L1066 551 L1000 558Z" fill="#111c27"/>
<ellipse cx="1033" cy="551" rx="11" ry="6" fill="#909ca6" stroke="#293946" stroke-width="3"/>
<ellipse cx="1057" cy="548" rx="11" ry="6" fill="#909ca6" stroke="#293946" stroke-width="3"/>
<path d="M355 421 L342 523 M566 414 L560 523 M824 414 L838 523 M342 523 Q581 536 842 523" fill="none" stroke="#123b66" stroke-width="4" opacity=".9"/>
<path d="M404 455h35 M635 455h35 M858 455h35" stroke="#e2edf5" stroke-width="5" stroke-linecap="round"/>
<path d="M260 536 Q586 549 930 536" fill="none" stroke="#142638" stroke-width="12"/>
<path d="M481 488 L544 480 L532 501 L470 506Z" fill="#0e3f76" opacity=".95"/>
<text x="496" y="500" fill="#eef6fc" font-family="Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="1">WRX</text>
<path d="M910 491 L953 489" stroke="#dbe6ed" stroke-width="4"/>
<path d="M948 421 L956 402 L1044 416 L1042 426 Q993 412 948 421Z" fill="#152534" stroke="#0e1b27" stroke-width="4" stroke-linejoin="round"/>
<path d="M961 414 Q1006 413 1035 421" fill="none" stroke="#7590a8" stroke-width="3"/>
<path d="M229 548 A94 94 0 0 1 419 548 M746 548 A94 94 0 0 1 936 548" fill="none" stroke="#151c23" stroke-width="23"/>
<path d="M241 542 A83 83 0 0 1 407 542 M758 542 A83 83 0 0 1 924 542" fill="none" stroke="#48515a" stroke-width="4"/>
<path d="M414 445 L449 438 L442 457 L410 461Z M715 446 L748 442 L744 460 L711 462Z" fill="#18222b" stroke="#30404c" stroke-width="2"/>
<path d="M420 449l17-4 M418 455l18-4 M720 450l17-3 M718 456l18-3" stroke="#8b9aa5" stroke-width="2"/>
<g fill="#202832" stroke="#0c1218" stroke-width="8"><circle cx="324" cy="549" r="76"/><circle cx="841" cy="549" r="76"/></g>
<g fill="url(#rim)" stroke="#4d5b68" stroke-width="4"><circle cx="324" cy="549" r="49"/><circle cx="841" cy="549" r="49"/></g>
<g stroke="#52616e" stroke-width="8" stroke-linecap="round">
 <path d="M324 506V592 M281 549H367 M294 519L354 579 M354 519L294 579 M304 508L344 590 M344 508L304 590"/>
 <path d="M841 506V592 M798 549H884 M811 519L871 579 M871 519L811 579 M821 508L861 590 M861 508L821 590"/>
</g>
<g fill="#1769c2"><circle cx="324" cy="549" r="13"/><circle cx="841" cy="549" r="13"/></g>
<g fill="#f4f6f8"><circle cx="324" cy="549" r="4"/><circle cx="841" cy="549" r="4"/></g>
<path d="M86 620H1114" stroke="#d2dbe4" stroke-width="2"/>
<text x="82" y="670" fill="#17283b" font-family="Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="4">${badge}</text>
<text x="84" y="700" fill="#66798d" font-family="Arial,sans-serif" font-size="14" letter-spacing="2">FOUR-DOOR TURBO SEDAN / HOOD SCOOP / HEX GRILLE / RALLY WING</text>
<text x="1113" y="680" text-anchor="end" fill="#526375" font-family="Arial,sans-serif" font-size="13" letter-spacing="2">ORIGINAL EDITABLE VECTOR STUDY</text>
</svg>`
}

export function vehicleConceptOutputPath(request) {
  const text = String(request || '')
  return /\b(?:subaru|wrx)\b/i.test(text)
    ? 'nori-wrx-concept-20261015.svg'
    : 'nori-vehicle-concept-20261015.svg'
}
