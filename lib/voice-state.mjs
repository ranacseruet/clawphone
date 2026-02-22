// @ts-check
/**
 * Voice call state management.
 *
 * Tracks pending replies for async voice call handling.
 * Twilio webhooks timeout quickly, so we respond immediately
 * and poll for the actual reply.
 */

/**
 * @typedef {object} PendingTurn
 * @property {string}  callSid
 * @property {string}  from
 * @property {string}  said
 * @property {string}  reply
 * @property {boolean} done
 * @property {number}  createdAt
 */

/** @type {Map<string, PendingTurn>} */
const pending = new Map();

/** @type {Map<string, string>} key: callSid, value: turn key */
const latestByCall = new Map();

/**
 * Create a new pending turn for a call.
 * Cancels any previous pending turn for the same call.
 * 
 * @param {Object} options
 * @param {string} options.key - Unique turn key
 * @param {string} options.callSid - Twilio call SID
 * @param {string} options.from - Caller phone number
 * @param {string} options.said - What the caller said
 */
export function createPendingTurn({ key, callSid, from, said }) {
  // Cancel any previous pending turn for this call
  const prevKey = latestByCall.get(callSid);
  if (prevKey) {
    pending.delete(prevKey);
  }

  pending.set(key, { callSid, from, said, done: false, reply: "", createdAt: Date.now() });
  latestByCall.set(callSid, key);
}

/**
 * Get a pending turn by key.
 * 
 * @param {string} key - Turn key
 * @returns {PendingTurn|undefined} The pending turn or undefined
 */
export function getPendingTurn(key) {
  return pending.get(key);
}

/**
 * Check if this key is still the latest for its call.
 * 
 * @param {string}  key     - Turn key
 * @param {string}  callSid - Call SID to check against
 * @returns {boolean} True if this is the latest turn
 */
export function isLatestTurn(key, callSid) {
  return latestByCall.get(callSid) === key;
}

/**
 * Mark a turn as complete with a reply.
 * 
 * @param {string} key - Turn key
 * @param {string} reply - The reply text
 */
export function completeTurn(key, reply) {
  const item = pending.get(key);
  if (item) {
    item.reply = reply || "Okay.";
    item.done = true;
    pending.set(key, item);
  }
}

/**
 * Clean up a completed turn.
 *
 * @param {string} key - Turn key
 */
export function deleteTurn(key) {
  const item = pending.get(key);
  pending.delete(key);

  if (item?.callSid) {
    const cur = latestByCall.get(item.callSid);
    if (cur === key) {
      latestByCall.delete(item.callSid);
    }
  }
}

/**
 * Remove pending turns older than maxAgeMs.
 * @param {number} [maxAgeMs]
 */
export function cleanupStaleTurns(maxAgeMs = 5 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, item] of pending) {
    if (item.createdAt < cutoff) {
      pending.delete(key);
      if (item.callSid && latestByCall.get(item.callSid) === key) {
        latestByCall.delete(item.callSid);
      }
    }
  }
}

/** @returns {number} */
export function pendingSize() { return pending.size; }
/** @returns {number} */
export function latestByCallSize() { return latestByCall.size; }

/**
 * Wait until all pending voice turns complete or timeout is reached.
 * Polls at most every `pollMs` ms, but never past the deadline.
 *
 * @param {number} [timeoutMs]  Max wait time in ms (default 30 s)
 * @param {number} [pollMs]     Poll interval in ms (default 500)
 * @returns {Promise<number>}   Remaining pending turns (0 = clean drain)
 */
export async function waitForVoiceDrain(timeoutMs = 30_000, pollMs = 500) {
  const deadline = Date.now() + timeoutMs;
  const undone = () => [...pending.values()].filter((t) => !t.done).length;
  while (undone() > 0 && Date.now() < deadline) {
    const wait = Math.min(pollMs, deadline - Date.now());
    if (wait <= 0) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  return undone();
}
