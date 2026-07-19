import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {children}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
      <rect fill="currentColor" height="22" rx="2" width="26" x="3" y="5" />
      <path d="M3 14.5h26M16 5v22" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="14.5" fill="var(--accent)" r="2.5" />
    </svg>
  );
}

export function RunIcon() {
  return <Icon><path d="m8 5 11 7-11 7V5Z" fill="currentColor" /></Icon>;
}

export function ShareIcon() {
  return <Icon><path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M5 13v7h14v-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></Icon>;
}

export function FocusIcon() {
  return <Icon><path d="M8 4H4v4m12-4h4v4M8 20H4v-4m12 4h4v-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></Icon>;
}

export function CloseIcon() {
  return <Icon size={14}><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></Icon>;
}

export function FileIcon() {
  return <Icon size={15}><path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" /><path d="M14 3v5h4" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" /></Icon>;
}

export function LinkIcon() {
  return <Icon><path d="m9.5 14.5 5-5M8 17H6.5a4.5 4.5 0 0 1 0-9H10m4 0h3.5a4.5 4.5 0 0 1 0 9H14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></Icon>;
}

export function ImportIcon() {
  return <Icon><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></Icon>;
}

export function ExportIcon() {
  return <Icon><path d="M12 16V5m0 0L8 9m4-4 4 4M5 20h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></Icon>;
}

export function SidebarIcon() {
  return <Icon><path d="M4 4h16v16H4V4Zm5 0v16" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" /></Icon>;
}

export function AddIcon() {
  return <Icon size={14}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></Icon>;
}
