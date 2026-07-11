import { logger } from "../config/logger.js";
import { HANDSHAKE_SWEEP_INTERVAL_MINUTES } from "../constants.js";
import { sweepHandshakes } from "../modules/payment/handshake.service.js";

// In-process scheduler for the unsupervised completion path. Every pass is
// idempotent and claim-guarded, so overlapping passes and restarts are safe;
// the boot-time run covers anything that came due while the server was down.

let timer = null;
let running = false;

/** One guarded pass — never lets a sweep error kill the process. */
const runSweep = async () => {
  if (running) return; // previous pass still going — skip, next tick catches up
  running = true;
  try {
    await sweepHandshakes();
  } catch (err) {
    logger.error(`Handshake sweep failed: ${err.message}`);
  } finally {
    running = false;
  }
};

/** Starts the periodic sweeper (call once at boot). Runs immediately, then on an interval. */
export const startHandshakeSweeper = () => {
  if (timer) return;
  runSweep();
  timer = setInterval(runSweep, HANDSHAKE_SWEEP_INTERVAL_MINUTES * 60 * 1000);
  timer.unref(); // never keep the process alive just for the sweeper
  logger.info(`Handshake sweeper started | every ${HANDSHAKE_SWEEP_INTERVAL_MINUTES}m`);
};

/** Stops the sweeper (tests / graceful shutdown). */
export const stopHandshakeSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
