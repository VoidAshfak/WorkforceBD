// Shared application-wide constants.

// Shift check-in tuning.
// GPS check-in: worker must be within this many metres of the shift coordinates.
export const CHECKIN_RADIUS_METERS = 200;
// Worker may check in starting this many minutes before the shift start time.
export const CHECKIN_GRACE_MINUTES = 30;

// Allowed check-in verification methods (mirrors checkin_method_enum in the DB).
export const CHECKIN_METHODS = ["manual", "gps", "qr", "pin"];
