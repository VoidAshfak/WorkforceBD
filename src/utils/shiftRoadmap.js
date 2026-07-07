// Shift status roadmap (the "journey bar"). The full lifecycle lives in
// shift_status_enum; this is the ordered, worker/business-facing subset shown as
// a progress track. `draft` is pre-journey and `cancelled` is an off-path
// terminal state — both handled specially by buildRoadmap.

/** Ordered milestones of a shift's happy path. */
export const SHIFT_ROADMAP = [
  { key: "pending_approval", label: "Under review" },
  { key: "published", label: "Published" },
  { key: "applications_open", label: "Applications open" },
  { key: "worker_selected", label: "Workers selected" },
  { key: "worker_confirmed", label: "Workers confirmed" },
  { key: "worker_arriving", label: "Arriving" },
  { key: "checked_in", label: "Checked in" },
  { key: "active", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "paid", label: "Paid" },
  { key: "closed", label: "Closed" },
];

// Statuses that aren't their own milestone map onto an existing step's position.
const ROADMAP_ALIAS = { payment_pending: "completed" };

// Full lifecycle ordering (superset of the roadmap: adds the pre/terminal states
// that don't render as milestones). Drives forward-only status transitions so a
// lifecycle event can advance a shift but never rewind it.
export const STATUS_RANK = {
  draft: 0,
  pending_approval: 1,
  published: 2,
  applications_open: 3,
  worker_selected: 4,
  worker_confirmed: 5,
  worker_arriving: 6,
  checked_in: 7,
  active: 8,
  completed: 9,
  payment_pending: 10,
  paid: 11,
  closed: 12,
};

/**
 * Whether moving `current` → `target` advances the shift lifecycle. False for an
 * equal/earlier target, an unknown status, or a cancelled shift (off-path, frozen).
 * @param {string} current a shift_status_enum value
 * @param {string} target a shift_status_enum value
 * @returns {boolean}
 */
export const isForwardTransition = (current, target) => {
  if (current === "cancelled") return false;
  const c = STATUS_RANK[current];
  const t = STATUS_RANK[target];
  return c != null && t != null && t > c;
};

/**
 * Resolves the roadmap index a status sits at (-1 for pre/off-path states).
 * @param {string} status
 */
const roadmapIndex = (status) => {
  const key = ROADMAP_ALIAS[status] ?? status;
  return SHIFT_ROADMAP.findIndex((s) => s.key === key);
};

/**
 * Builds the journey-bar view for a shift status: every milestone flagged
 * `reached`/`current`, plus the raw status and a cancelled marker.
 * @param {string} status a shift_status_enum value
 * @returns {{ current: string, is_cancelled: boolean, is_draft: boolean, steps: Array<{ key: string, label: string, reached: boolean, current: boolean }> }}
 */
export const buildRoadmap = (status) => {
  const idx = roadmapIndex(status);
  const isCancelled = status === "cancelled";
  const isDraft = status === "draft";
  return {
    current: status,
    is_cancelled: isCancelled,
    is_draft: isDraft,
    steps: SHIFT_ROADMAP.map((s, i) => ({
      key: s.key,
      label: s.label,
      reached: idx >= 0 && i <= idx,
      current: i === idx,
    })),
  };
};
