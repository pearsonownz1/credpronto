export const ADMIN_NAV = [
  { href: "/admin", label: "Orders", exact: true },
  { href: "/admin/certification", label: "Certification", exact: false },
  { href: "/admin/review", label: "Needs review", exact: false },
  { href: "/admin/corrections", label: "Corrections", exact: false },
  { href: "/admin/preval", label: "Pre-evaluations", exact: false },
  { href: "/admin/refunds", label: "Refunds", exact: false },
  { href: "/admin/settings", label: "Settings", exact: false },
] as const;
