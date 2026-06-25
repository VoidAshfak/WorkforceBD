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
