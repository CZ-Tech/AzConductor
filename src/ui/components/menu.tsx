/**
 * 弹出菜单：基于原生 Popover API（顶层渲染，不被卡片 overflow 裁切；点击外部 / Esc 由浏览器负责关闭）。
 * 菜单面板留在触发按钮旁的 DOM 中，只是用 fixed 定位贴到按钮上。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { IconCheck } from './icons';

const GAP = 6;

function placeNear(panel: HTMLElement, trigger: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const s = panel.style;
  // 不测量面板：按按钮所在象限选择向哪边展开，避免首帧闪动
  const openUp = r.bottom > innerHeight * 0.62;
  const alignRight = r.left + r.width / 2 > innerWidth / 2;
  s.top = openUp ? 'auto' : `${r.bottom + GAP}px`;
  s.bottom = openUp ? `${innerHeight - r.top + GAP}px` : 'auto';
  s.left = alignRight ? 'auto' : `${r.left}px`;
  s.right = alignRight ? `${innerWidth - r.right}px` : 'auto';
}

function menuItems(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)')];
}

export function Menu(p: { label: string; children: ComponentChildren; icon: ComponentChildren; class?: string }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);

  // 滚动或缩放时收起：fixed 面板不会跟随按钮移动
  useEffect(() => {
    const close = (e: Event) => {
      const el = panel.current;
      if (el && openRef.current && !(e.target instanceof Node && el.contains(e.target))) el.hidePopover();
    };
    addEventListener('scroll', close, true);
    addEventListener('resize', close);
    return () => { removeEventListener('scroll', close, true); removeEventListener('resize', close); };
  }, []);

  const onBeforeToggle = (e: Event) => {
    const el = panel.current;
    const t = trigger.current;
    if (el && t && (e as ToggleEvent).newState === 'open') placeNear(el, t);
  };
  const onToggle = (e: Event) => {
    const open = (e as ToggleEvent).newState === 'open';
    openRef.current = open;
    trigger.current?.setAttribute('aria-expanded', String(open));
    if (open && panel.current) menuItems(panel.current)[0]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const el = panel.current;
    if (!el) return;
    e.stopPropagation(); // 菜单内按键不触发编辑器快捷键
    const items = menuItems(el);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const target = e.key === 'ArrowDown' ? items[(i + 1) % items.length]
      : e.key === 'ArrowUp' ? items[(i - 1 + items.length) % items.length]
      : e.key === 'Home' ? items[0]
      : e.key === 'End' ? items[items.length - 1]
      : undefined;
    if (target) { e.preventDefault(); target.focus(); }
  };

  return (
    <>
      <button ref={trigger} type="button" class={`icon ghost ${p.class ?? ''}`} popovertarget={id} aria-haspopup="menu"
        aria-expanded="false" aria-label={p.label} title={p.label}>{p.icon}</button>
      <div ref={panel} id={id} class="menu" popover="auto" role="menu" aria-label={p.label}
        onBeforeToggle={onBeforeToggle} onToggle={onToggle} onKeyDown={onKeyDown}>{p.children}</div>
    </>
  );
}

export interface MenuItemProps {
  children: ComponentChildren;
  onSelect: () => void;
  icon?: ComponentChildren;
  danger?: boolean;
  disabled?: boolean;
  /** 设置后作为单选项（radio）或开关（checkbox）显示勾选状态，选择后菜单保持打开 */
  checked?: boolean;
  kind?: 'radio' | 'checkbox';
  class?: string;
}

export function MenuItem(p: MenuItemProps) {
  const role = p.kind === 'radio' ? 'menuitemradio' : p.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem';
  return (
    <button type="button" role={role} class={`menu-item${p.danger ? ' danger' : ''} ${p.class ?? ''}`} disabled={p.disabled}
      aria-checked={p.kind ? (p.checked ? 'true' : 'false') : undefined}
      onClick={(e) => {
        if (!p.kind) (e.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover();
        p.onSelect();
      }}>
      <span class="menu-icon">{p.icon}</span>
      <span class="menu-text">{p.children}</span>
      {p.kind && p.checked && <span class="menu-check"><IconCheck /></span>}
    </button>
  );
}

export const MenuSeparator = () => <hr class="menu-sep" />;
export const MenuLabel = ({ children }: { children: ComponentChildren }) => <div class="menu-label">{children}</div>;
