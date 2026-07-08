// Shared application-wide constants.

// Shift check-in tuning.
// GPS check-in: worker must be within this many metres of the shift coordinates.
export const CHECKIN_RADIUS_METERS = 200;
// Worker may check in starting this many minutes before the shift start time.
export const CHECKIN_GRACE_MINUTES = 30;
// Reject GPS check-ins whose reported accuracy is worse (larger) than this many
// metres — a fix that loose can't prove the worker is inside the geofence.
export const CHECKIN_MAX_ACCURACY_METERS = 100;
// Rotation period of the on-site QR check-in code. The QR re-renders this often,
// so a photographed/shared code is useless within ~one cycle.
export const CHECKIN_QR_STEP_SECONDS = 30;

// Check-in methods a worker may pick. `manual` is intentionally excluded — it is
// a business/admin override, not a worker-selectable bypass.
export const WORKER_CHECKIN_METHODS = ["gps", "qr"];
// All check-in verification methods (mirrors checkin_method_enum in the DB).
export const CHECKIN_METHODS = ["manual", "gps", "qr", "pin"];

// Business escrow.
// Starting balance seeded into a business wallet on first use. Placeholder funding
// until the MFS top-up/checkout flow (bKash/Nagad corporate) is built — a business
// must have enough balance to escrow a shift's full cost before it can be published.
export const BUSINESS_WALLET_SEED_BALANCE = 500;
// Smallest single wallet top-up (BDT).
export const MIN_BUSINESS_TOPUP = 100;
// MFS/channels a business may top up from. Real gateway authorization is wired
// later — for now a top-up is an instant manual credit (no external capture).
export const BUSINESS_TOPUP_METHODS = ["bkash", "nagad", "bank_transfer"];

// Platform commission (%) charged on top of the total worker pay of a shift.
// Shown to the business in the cost breakdown at creation. Only escrow of the
// worker pay is captured today — real fee collection is wired with the gateway.
export const PLATFORM_FEE_PERCENT = 10;
// Requesting more workers than this on a single shift is flagged as a large
// request (surfaced to admin review) — all shifts already require approval, this
// just marks the outsized ones.
export const LARGE_REQUEST_WORKER_THRESHOLD = 20;

// Shift cancellation penalty (business deletes/cancels a shift that already has
// hired workers). A free cancel refunds the full escrow; a penalising cancel pays
// each hired worker `pay_amount * rate` as compensation and returns the remainder.
// Every value here tunes the rate engine (src/utils/cancellationPenalty.js) — no
// business logic lives in the numbers, so they can be adjusted freely.
//
// A scheduled/prebooked shift cancelled earlier than this many hours before start
// is free; within the window (or an instant shift at any time) a penalty applies.
export const CANCEL_FREE_NOTICE_HOURS = 24;
// Absolute clamp on the computed per-worker penalty rate (fraction of pay_amount).
export const PENALTY_MIN_RATE = 0.1;
export const PENALTY_MAX_RATE = 0.75;
// Timing base rate: PENALTY_TIMING_MIN_RATE at the free-notice boundary rising to
// PENALTY_TIMING_MAX_RATE at (or past) the shift start time.
export const PENALTY_TIMING_MIN_RATE = 0.2;
export const PENALTY_TIMING_MAX_RATE = 0.55;
// Instant shifts have no notice window — their base floors here.
export const PENALTY_INSTANT_BASE = 0.4;
// Max upward swing each adjustment factor (hiring duration, worker reliability,
// business reliability, demand) can add to the base rate.
export const PENALTY_FACTOR_WEIGHT = 0.1;
// Hours-since-hire at which the "long commitment" factor reaches full weight.
export const PENALTY_DURATION_SATURATION_HOURS = 48;
// Applicants-per-slot ratio at which the demand factor reaches full weight.
export const PENALTY_DEMAND_SATURATION_RATIO = 3;
// reliability_score is stored on a 0–5 scale; unrated profiles (score <= 0) are
// treated as neutral rather than punished/rewarded.
export const RELIABILITY_MAX_SCORE = 5;
export const RELIABILITY_NEUTRAL_NORM = 0.5;

// App operating timezone. Shift `shift_date`/`start_time`/`end_time` columns store
// Bangladesh wall-clock (UTC+6, no DST) with no zone info. This offset converts
// those naive values into real UTC instants when comparing against `now`
// (check-in/out window, cancellation timing, shift expiry). See utils/shiftTime.js.
export const APP_TZ_OFFSET_MINUTES = 360;

// Chat tuning.
// Max length of a single chat message body.
export const CHAT_MESSAGE_MAX_LENGTH = 2000;
// Length of the conversation preview snippet stored for the inbox.
export const CHAT_PREVIEW_LENGTH = 140;
// Conversation participant roles (also stored as sender_role on each message).
export const CHAT_ROLES = ["worker", "business"];
