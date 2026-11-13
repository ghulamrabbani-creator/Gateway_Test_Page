import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, saveConfig, saveCreds, ENVS } from '@/lib/config';
import { hashPassword } from '@/lib/crypto';

export async function POST(req) {
  try {
    requireUser('admin');
    const body = await req.json();
    const patch = {};
    if (body.envs) {
      patch.envs = {};
      for (const e of ENVS) if (body.envs[e]) patch.envs[e] = { apiBase: body.envs[e].apiBase, sdkUrl: body.envs[e].sdkUrl, hppUrl: body.envs[e].hppUrl };
    }
    for (const k of ['allowDemoOnProduction', 'offerMoto', 'merchantName', 'publicBaseUrl']) if (k in body) patch[k] = body[k];
    if ('currencies' in body) patch.currencies = String(body.currencies).split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c));
    if ('motoExtra' in body) {
      try { patch.motoExtra = body.motoExtra ? JSON.parse(body.motoExtra) : {}; } catch { throw new HttpError(400, 'MOTO extra fields must be valid JSON'); }
    }
    if (body.demoPassword || body.adminPassword) {
      const cfg = await getConfig();
      patch.users = { ...(cfg.users || {}) };
      if (body.demoPassword) patch.users.demo = hashPassword(body.demoPassword);
      if (body.adminPassword) patch.users.admin = hashPassword(body.adminPassword);
    }
    if (body.creds) for (const e of ENVS) if (body.creds[e]) await saveCreds(e, body.creds[e].publicKey, body.creds[e].apiPassword);
    await saveConfig(patch);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
