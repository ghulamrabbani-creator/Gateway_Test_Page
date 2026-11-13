// Bump RELEASE on every push so the header shows which build is live.
// History: R1 initial · R2 full-order fetch + browser/callback logging · R3 HPP URL fix + defaults · R4 release badge, processor/CVV insights
export const RELEASE = 'R4';
export const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7);
