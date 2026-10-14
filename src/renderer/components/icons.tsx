// icons.tsx
// Every icon in one place, so screens stop carrying their own copies.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16, sw = 1.8) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
});

export const SceneformMark = ({ size = 20, ...p }: P) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210" width={size} height={size} fill="currentColor" fillRule="evenodd" aria-hidden {...p}>
        <g transform="matrix(1.279759 0 0 1.279759 -1169.548844 -4805.351632)">
            <path transform="matrix(.257941 .257941 -.140463 .140463 1261.644564 3363.971014)" d="M513.484 2251.98c-62.5 88.077-113.242 226.896-113.242 377.473s50.742 289.396 113.242 377.473c-208.333 0-377.473-169.14-377.473-377.473S305.151 2251.98 513.484 2251.98Z"/>
            <path transform="matrix(.282588 0 0 .282588 764.180803 3079.207964)" d="M954.296 2660.166s16.075 87.543 41.979 113.447c25.905 25.904 113.447 41.979 113.447 41.979s-87.542 16.074-113.447 41.979c-25.904 25.904-41.979 113.446-41.979 113.446s-16.074-87.542-41.979-113.446c-25.904-25.905-113.446-41.979-113.446-41.979s87.542-16.075 113.446-41.979c25.905-25.904 41.979-113.447 41.979-113.447Z"/>
        </g>
    </svg>
);

export const IconCalendar = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);

export const IconFolder = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
);
export const IconOutline = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);
export const IconPeople = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="18" cy="9" r="2.4" /><path d="M15.8 20a4.6 4.6 0 0 1 8.7-2" /></svg>
);
export const IconCanvas = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="5" rx="1" /><rect x="13" y="10" width="8" height="11" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /></svg>
);
export const IconBook = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5v-18Z" /><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /></svg>
);
export const IconGear = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V20a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H20a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z" /></svg>
);
export const IconFile = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /></svg>
);
export const IconLines = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
export const IconPin = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const IconImage = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>
);
export const IconChevronLeft = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2.2)} {...p}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconChevronRight = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2)} {...p}><path d="M9 18l6-6-6-6" /></svg>
);
export const IconPlus = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2.4)} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2.4)} {...p}><path d="M5 12h14" /></svg>
);
export const IconSearch = ({ size = 15, ...p }: P) => (
    <svg {...base(size, 2)} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const IconHeart = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 21s-7.5-4.6-10-9.3C.4 8.1 2 4.5 5.6 4.1c2-.2 3.7.8 4.9 2.4a1.1 1.1 0 0 0 1 .5c.4 0 .8-.2 1-.5 1.2-1.6 2.9-2.6 4.9-2.4C21 4.5 22.6 8.1 22 11.7 19.5 16.4 12 21 12 21Z" /></svg>
);
export const IconFocus = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2)} {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></svg>
);
export const IconUnfocus = ({ size = 12, ...p }: P) => (
    <svg {...base(size, 2.2)} {...p}><path d="M9 15v4a1 1 0 0 1-1 1H4M15 15v4a1 1 0 0 0 1 1h4M9 9V5a1 1 0 0 0-1-1H4M15 9V5a1 1 0 0 1 1-1h4" /></svg>
);
export const IconTrash = ({ size = 13, ...p }: P) => (
    <svg {...base(size, 2)} {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
);
export const IconExport = ({ size = 14, ...p }: P) => (
    <svg {...base(size, 2)} {...p}><path d="M12 3v12M7 8l5-5 5 5M5 21h14" /></svg>
);
export const IconSidebar = ({ size = 14, ...p }: P) => (
    <svg {...base(size, 1.8)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
);
export const IconInspector = ({ size = 14, ...p }: P) => (
    <svg {...base(size, 1.8)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
);
export const IconAlert = ({ size = 12, ...p }: P) => (
    <svg {...base(size, 2.5)} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg>
);
export const IconGlobe = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></svg>
);
export const IconMonitor = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" /></svg>
);
export const IconPen = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M14.5 3.5a2.1 2.1 0 0 1 3 3L7 17l-4 1 1-4Z" /></svg>
);
export const IconDots = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
);
export const IconChart = ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconPreview = ({ size = 14, ...p }: P) => (
    <svg {...base(size, 1.8)} {...p}><rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="3" width="8" height="18" rx="1" /><path d="M15 7h4M15 10h4M15 13h3" /></svg>
);
