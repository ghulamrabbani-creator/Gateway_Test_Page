// Bump RELEASE on every push so the header shows which build is live.
// History: R1 initial · R2 full-order fetch + browser/callback logging · R3 HPP URL fix + defaults · R4 release badge, processor/CVV insights · R5 order lookup, drop-in in page · R6 redesign (transaction-slip insights) · R7 saved cards redesign, save-result check, processor from pay txn · R8 MPGS direct (Hosted Session, 3DS, pay/auth/capture/void/refund, MPGS tokens + MIT, network-token check), checkout redesign
export const RELEASE = 'R8';
export const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7);
