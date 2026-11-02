/** 内联 SVG 图标（16 网格、1.6 描边），取代字符图标，保证各平台渲染一致。 */
import type { ComponentChildren } from 'preact';

function Svg({ children, size = 16 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconBack = () => <Svg><path d="M10 3 5 8l5 5" /></Svg>;
export const IconChevron = () => <Svg><path d="m6 3.5 4.5 4.5L6 12.5" /></Svg>;
export const IconPlus = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>;
export const IconClose = () => <Svg><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const IconCheck = () => <Svg><path d="m3 8.5 3.5 3.5L13 4.5" /></Svg>;
export const IconUndo = () => <Svg><path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H6" /><path d="M6 3 3 6l3 3" /></Svg>;
export const IconRedo = () => <Svg><path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H10" /><path d="m10 3 3 3-3 3" /></Svg>;
export const IconPencil = () => <Svg><path d="M10.5 3 13 5.5 5.5 13H3v-2.5L10.5 3Z" /></Svg>;
export const IconTrash = () => <Svg><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>;
export const IconCopy = () => <Svg><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" /><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" /></Svg>;
export const IconMirror = () => <Svg><path d="M8 2v12M5 5 2 8l3 3M11 5l3 3-3 3" /></Svg>;
export const IconSwap = () => <Svg><path d="M3 5.5h9M9.5 3 12 5.5 9.5 8M13 10.5H4M6.5 8 4 10.5 6.5 13" /></Svg>;
export const IconImport = () => <Svg><path d="M8 3v7M5 7.5 8 10l3-2.5M3 11v2h10v-2" /></Svg>;
export const IconExport = () => <Svg><path d="M8 10V3M5 5.5 8 3l3 2.5M3 11v2h10v-2" /></Svg>;
export const IconArrowUp = () => <Svg><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></Svg>;
export const IconArrowDown = () => <Svg><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></Svg>;
export const IconReplay = () => <Svg><path d="M3 8a5 5 0 1 0 1.6-3.7L3 5.8" /><path d="M3 2.8v3h3" /></Svg>;
export const IconSidebar = () => <Svg><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M10 3v10" /></Svg>;
export const IconRobot = () => <Svg><rect x="3" y="3" width="10" height="10" rx="2" /><circle cx="8" cy="6" r="1" fill="currentColor" /></Svg>;
export const IconTerminal = () => <Svg><path d="m3 4.5 3.5 3.5L3 11.5M8 12h5" /></Svg>;
export const IconMore = () => <Svg><circle cx="3" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="13" cy="8" r=".9" fill="currentColor" /></Svg>;
export const IconPlay = () => <Svg><path d="M5 3.2v9.6L13 8Z" fill="currentColor" /></Svg>;
export const IconPause = () => <Svg><path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2.4" /></Svg>;
export const IconStop = () => <Svg><rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" /></Svg>;

/** 品牌标识：一段带首尾控制点的样条。 */
export function BrandMark() {
  return (
    <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--brand-solid)" />
      <path d="M14 48C26 12 38 56 50 16" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" />
      <circle cx="14" cy="48" r="6" fill="#fff" />
      <circle cx="50" cy="16" r="6" fill="#fff" />
    </svg>
  );
}
