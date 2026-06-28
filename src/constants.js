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

// Chat tuning.
// Max length of a single chat message body.
export const CHAT_MESSAGE_MAX_LENGTH = 2000;
// Length of the conversation preview snippet stored for the inbox.
export const CHAT_PREVIEW_LENGTH = 140;
// Conversation participant roles (also stored as sender_role on each message).
export const CHAT_ROLES = ["worker", "business"];
