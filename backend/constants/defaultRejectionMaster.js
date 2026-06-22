const DEFAULT_REJECTION_CATEGORIES = [
  {
    code: "CR",
    name: "Casting Defects",
    reasons: [
      "Warm Up",
      "Non-Filling",
      "Pre Filling",
      "Cold Shot",
      "Crack",
      "Chip-off",
      "Shrinkage",
      "Ejector Pin Deep",
      "Bend",
      "Black Mark",
      "Dent",
      "Extra Metal",
      "Runner Broken",
      "Excess Fettling",
      "Flow Mark",
      "Soldering",
      "Catching",
      "White-Rust",
      "Peel Off",
      "Casting Damage",
      "Biscuit Thickness NG",
      "Cast Pressure NG",
      "Air Bubble",
      "Core Pin Broken",
      "Core Pin Bend",
      "Under Cut",
      "Gate Broken",
      "Laser Marking NG",
    ],
  },
  {
    code: "CRAM",
    name: "Cram Defects",
    reasons: [
      "Blow Hole",
      "Blow Hole M14",
      "LT Oil Gallery-1 NG",
      "LT Oil Gallery-2 NG",
      "Body Leak",
      "Bend",
      "Chipoff",
      "Cold Shut",
      "Crack",
      "Blister",
      "Iron Particle",
      "Non-filling",
      "Porosity",
      "Black Mark",
      "Ejector Pin Depression",
      "Casting Damage",
      "Shrinkage",
      "Peel-off",
      "Flow Mark",
      "Scratch Mark",
      "Laser Marking NG",
      "Setting part",
      "Over Fettling",
      "Tool Broken",
      "Power Failure Part",
      "Unclean",
      "Dent",
      "Oval/Soldering",
      "Overcut",
      "Bubble",
    ],
  },
  {
    code: "MR",
    name: "MR Defects",
    reasons: [
      "Dia Over Size",
      "Dia Under Size",
      "Chattering",
      "Toolmark",
      "Dent",
      "Dimension NG",
      "Tapping NG",
      "Setting Part",
      "Power Cut",
      "Air Pressure Low",
      "Machine Alarm",
      "Laser Marking NG",
      "Extra Rework",
      "Roughness NG",
      "Chamfer NG",
      "Profile NG",
      "Position NG",
      "Receiving Gauge NG",
      "Step Mark",
      "Scratch Mark",
    ],
  },
];

const DEFAULT_PART_NAME = "OIL PAN K-12";

const DEFAULT_PART_IMAGE_URL = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520">
  <defs>
    <linearGradient id="body" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#4b5563"/>
      <stop offset="55%" stop-color="#1f2937"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <radialGradient id="well" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#6b7280"/>
      <stop offset="100%" stop-color="#111827"/>
    </radialGradient>
  </defs>
  <rect width="900" height="520" fill="#e5e7eb"/>
  <g transform="translate(70 65)">
    <path d="M70 60 C130 20 250 15 350 35 C450 55 555 25 675 50 C720 60 760 100 770 155 L790 285 C798 345 745 390 680 400 L160 420 C85 420 38 365 45 300 L58 150 C62 110 38 85 70 60Z" fill="url(#body)" stroke="#0f172a" stroke-width="8"/>
    <path d="M210 135 C275 95 385 95 445 135 C505 175 500 285 435 330 C365 380 245 355 200 290 C165 238 160 168 210 135Z" fill="url(#well)" stroke="#030712" stroke-width="6" opacity=".9"/>
    <path d="M535 145 C600 105 690 130 720 195 C750 260 700 335 625 345 C555 355 500 305 492 240 C486 195 502 165 535 145Z" fill="url(#well)" stroke="#030712" stroke-width="6" opacity=".85"/>
    <path d="M130 250 C165 230 220 245 235 285 C250 325 215 365 170 365 C120 365 90 325 103 285 C108 270 117 258 130 250Z" fill="#374151" stroke="#030712" stroke-width="5"/>
    <g fill="#d1d5db" stroke="#111827" stroke-width="3">
      <circle cx="90" cy="85" r="13"/><circle cx="170" cy="55" r="12"/><circle cx="275" cy="45" r="12"/>
      <circle cx="405" cy="60" r="12"/><circle cx="535" cy="55" r="12"/><circle cx="675" cy="80" r="13"/>
      <circle cx="745" cy="170" r="12"/><circle cx="760" cy="305" r="12"/><circle cx="660" cy="375" r="13"/>
      <circle cx="500" cy="390" r="12"/><circle cx="330" cy="398" r="12"/><circle cx="165" cy="390" r="13"/>
      <circle cx="75" cy="310" r="12"/><circle cx="80" cy="180" r="12"/>
    </g>
    <g opacity=".35" stroke="#f9fafb" stroke-width="3">
      <path d="M115 115 C250 70 330 85 460 105"/>
      <path d="M500 105 C610 80 705 110 740 200"/>
      <path d="M145 380 C300 335 500 350 680 360"/>
    </g>
  </g>
</svg>
`)}`;

const DEFAULT_REJECTION_VIEWS = [
  { code: "TOP", name: "Top View", image_url: DEFAULT_PART_IMAGE_URL },
  { code: "BOTTOM", name: "Bottom View", image_url: DEFAULT_PART_IMAGE_URL },
  { code: "LEFT", name: "Left Side", image_url: DEFAULT_PART_IMAGE_URL },
  { code: "RIGHT", name: "Right Side", image_url: DEFAULT_PART_IMAGE_URL },
  { code: "FRONT", name: "Front", image_url: DEFAULT_PART_IMAGE_URL },
  { code: "REAR", name: "Rear", image_url: DEFAULT_PART_IMAGE_URL },
];

const DEFAULT_REJECTION_ZONES = [
  { code: "A", name: "Zone A", x_percent: 28, y_percent: 24, width_percent: 10, height_percent: 10 },
  { code: "B", name: "Zone B", x_percent: 18, y_percent: 50, width_percent: 10, height_percent: 10 },
  { code: "C", name: "Zone C", x_percent: 72, y_percent: 50, width_percent: 10, height_percent: 10 },
  { code: "D", name: "Zone D", x_percent: 48, y_percent: 72, width_percent: 10, height_percent: 10 },
];

module.exports = {
  DEFAULT_REJECTION_CATEGORIES,
  DEFAULT_REJECTION_VIEWS,
  DEFAULT_REJECTION_ZONES,
  DEFAULT_PART_NAME,
  DEFAULT_PART_IMAGE_URL,
};
