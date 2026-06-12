import { NavLink } from "react-router-dom";

// Fixed bottom tab bar for the V2 mobile layout. Renders the five most-used
// destinations per role so athletes don't need the hamburger drawer for the
// core loop (everything else stays in the drawer). Hidden at md+ where the
// top nav shows full links, and hidden whenever a full-screen overlay
// (e.g. Session focus mode, z-50) is open above it.

type IconProps = { className?: string };

const svgProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const IconHome = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </svg>
);

const IconCalendar = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
);

const IconBarbell = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11" />
  </svg>
);

const IconCalculator = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
  </svg>
);

const IconTrendingUp = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </svg>
);

const IconClipboardCheck = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
    <path d="M9 13l2 2 4-4" />
  </svg>
);

const IconUsers = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
    <path d="M16.5 4.9a3.5 3.5 0 0 1 0 6.2M18 15.2c2 .7 3 2.3 3 4.8" />
  </svg>
);

type Tab = {
  to: string;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
};

const ATHLETE_TABS: Tab[] = [
  { to: "/", label: "Home", Icon: IconHome },
  { to: "/program-outline", label: "Lifts", Icon: IconCalendar },
  { to: "/session", label: "Session", Icon: IconBarbell },
  { to: "/calculator", label: "Calc", Icon: IconCalculator },
  { to: "/progress", label: "Progress", Icon: IconTrendingUp },
];

const COACH_TABS: Tab[] = [
  { to: "/", label: "Home", Icon: IconHome },
  { to: "/attendance", label: "Attend", Icon: IconClipboardCheck },
  { to: "/session", label: "Session", Icon: IconBarbell },
  { to: "/roster", label: "Roster", Icon: IconUsers },
  { to: "/calculator", label: "Calc", Icon: IconCalculator },
];

export default function BottomTabBarV2({ coach }: { coach: boolean }) {
  const tabs = coach ? COACH_TABS : ATHLETE_TABS;
  const activeColor = coach ? "text-v2-info-300" : "text-v2-accent-300";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-v2-surface-800 bg-v2-surface-950/95 backdrop-blur md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="grid grid-cols-5">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              [
                "flex min-h-touch-lg flex-col items-center justify-center gap-1 px-1 pt-1.5 pb-1 transition-colors duration-v2-quick focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-v2-accent-500",
                isActive
                  ? `${activeColor} font-bold`
                  : "text-v2-ink-500 font-semibold hover:text-v2-ink-200",
              ].join(" ")
            }
          >
            <Icon />
            <span className="font-v2-body text-v2-xs leading-none">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
