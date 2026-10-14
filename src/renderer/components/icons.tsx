// icons.tsx
// Every icon in one place, so screens stop carrying their own copies.
// Glyphs are Tabler Icons (outline set), https://github.com/tabler/tabler-icons,
// MIT License, Copyright (c) 2020-2026 Paweł Kuna. Bundled at build time; no network.
// The Sceneform mark below is our own artwork.
import type { SVGProps } from "react";
import {
    IconAlertCircle as TAlertCircle,
    IconAlignLeft as TAlignLeft,
    IconBook2 as TBook2,
    IconCalendar as TCalendar,
    IconChartBar as TChartBar,
    IconChevronLeft as TChevronLeft,
    IconChevronRight as TChevronRight,
    IconDeviceDesktop as TDeviceDesktop,
    IconDots as TDots,
    IconFile as TFile,
    IconFolder as TFolder,
    IconHeart as THeart,
    IconLayoutColumns as TLayoutColumns,
    IconLayoutDashboard as TLayoutDashboard,
    IconLayoutSidebar as TLayoutSidebar,
    IconLayoutSidebarRight as TLayoutSidebarRight,
    IconList as TList,
    IconMapPin as TMapPin,
    IconMaximize as TMaximize,
    IconMinimize as TMinimize,
    IconMinus as TMinus,
    IconPencil as TPencil,
    IconPhoto as TPhoto,
    IconPlus as TPlus,
    IconSearch as TSearch,
    IconSettings as TSettings,
    IconSquare as TSquare,
    IconSquares as TSquares,
    IconTrash as TTrash,
    IconUpload as TUpload,
    IconUsers as TUsers,
    IconWorld as TWorld,
    IconX as TX,
} from "@tabler/icons-react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** One stroke weight for every icon in the app (Tabler's default). */
export const ICON_STROKE = 2;

export const SceneformMark = ({ size = 20, ...p }: P) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210" width={size} height={size} fill="currentColor" fillRule="evenodd" aria-hidden {...p}>
        <g transform="matrix(1.279759 0 0 1.279759 -1169.548844 -4805.351632)">
            <path transform="matrix(.257941 .257941 -.140463 .140463 1261.644564 3363.971014)" d="M513.484 2251.98c-62.5 88.077-113.242 226.896-113.242 377.473s50.742 289.396 113.242 377.473c-208.333 0-377.473-169.14-377.473-377.473S305.151 2251.98 513.484 2251.98Z"/>
            <path transform="matrix(.282588 0 0 .282588 764.180803 3079.207964)" d="M954.296 2660.166s16.075 87.543 41.979 113.447c25.905 25.904 113.447 41.979 113.447 41.979s-87.542 16.074-113.447 41.979c-25.904 25.904-41.979 113.446-41.979 113.446s-16.074-87.542-41.979-113.446c-25.904-25.905-113.446-41.979-113.446-41.979s87.542-16.075 113.446-41.979c25.905-25.904 41.979-113.447 41.979-113.447Z"/>
        </g>
    </svg>
);

export const IconCalendar = ({ size = 16, ...p }: P) => <TCalendar size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconFolder = ({ size = 16, ...p }: P) => <TFolder size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconOutline = ({ size = 16, ...p }: P) => <TList size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconPeople = ({ size = 16, ...p }: P) => <TUsers size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconCanvas = ({ size = 16, ...p }: P) => <TLayoutDashboard size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconBook = ({ size = 16, ...p }: P) => <TBook2 size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconGear = ({ size = 16, ...p }: P) => <TSettings size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconFile = ({ size = 16, ...p }: P) => <TFile size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconLines = ({ size = 16, ...p }: P) => <TAlignLeft size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconPin = ({ size = 16, ...p }: P) => <TMapPin size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconImage = ({ size = 16, ...p }: P) => <TPhoto size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconChevronLeft = ({ size = 13, ...p }: P) => <TChevronLeft size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconChevronRight = ({ size = 13, ...p }: P) => <TChevronRight size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconPlus = ({ size = 13, ...p }: P) => <TPlus size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconMinus = ({ size = 13, ...p }: P) => <TMinus size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconSearch = ({ size = 15, ...p }: P) => <TSearch size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconHeart = ({ size = 16, ...p }: P) => <THeart size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconFocus = ({ size = 13, ...p }: P) => <TMaximize size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconUnfocus = ({ size = 12, ...p }: P) => <TMinimize size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconTrash = ({ size = 13, ...p }: P) => <TTrash size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconExport = ({ size = 14, ...p }: P) => <TUpload size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconSidebar = ({ size = 14, ...p }: P) => <TLayoutSidebar size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconInspector = ({ size = 14, ...p }: P) => <TLayoutSidebarRight size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconAlert = ({ size = 12, ...p }: P) => <TAlertCircle size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconGlobe = ({ size = 16, ...p }: P) => <TWorld size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconMonitor = ({ size = 16, ...p }: P) => <TDeviceDesktop size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconPen = ({ size = 16, ...p }: P) => <TPencil size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconDots = ({ size = 16, ...p }: P) => <TDots size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconChart = ({ size = 16, ...p }: P) => <TChartBar size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconPreview = ({ size = 14, ...p }: P) => <TLayoutColumns size={size} stroke={ICON_STROKE} aria-hidden {...p} />;

// Window controls (custom title bar on Windows/Linux).
export const IconWindowMinimize = ({ size = 14, ...p }: P) => <TMinus size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconWindowMaximize = ({ size = 14, ...p }: P) => <TSquare size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconWindowRestore = ({ size = 14, ...p }: P) => <TSquares size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
export const IconWindowClose = ({ size = 14, ...p }: P) => <TX size={size} stroke={ICON_STROKE} aria-hidden {...p} />;
