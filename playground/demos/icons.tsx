import type { SVGProps } from 'react';

const base = (
  props: SVGProps<SVGSVGElement>,
  children: React.ReactNode,
  viewBox = '0 0 24 24',
) => (
  <svg
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) =>
  base(p, <path d="M15 18l-6-6 6-6" />);

export const EllipsisIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>,
  );

export const BellIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>,
  );

export const HouseIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>,
  );

export const SearchIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>,
  );

export const GearIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.22.65.22 1v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
  );

export const HeartIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" />,
  );

export const ShareIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </>,
  );

export const PlusIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
  );

export const CloseIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>,
  );

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => base(p, <path d="m5 12.5 5 5L19 7" />);

export const SunIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  );

export const MoonIcon = (p: SVGProps<SVGSVGElement>) =>
  base(p, <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);

export const ListIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>,
  );

export const GridIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>,
  );

export const InfoIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </>,
  );

export const DownloadIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </>,
  );

export const HackerNewsIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <path d="M7 4l5 8 5-8" />
      <path d="M12 12v8" />
    </>,
  );

export const WeiboIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="11" cy="12" r="7.5" />
      <path d="M14.5 4.6c2.6-.3 5.1 1 6.4 3.1" />
      <path d="M14.8 8.4c1.5-.1 2.9.7 3.6 2" />
    </>,
  );

export const WikipediaIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
    </>,
  );

export const SolidotIcon = (p: SVGProps<SVGSVGElement>) =>
  base(p, <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />);

export const NprIcon = (p: SVGProps<SVGSVGElement>) =>
  base(
    p,
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </>,
  );
