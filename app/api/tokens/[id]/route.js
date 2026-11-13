import { requireUser, errorResponse } from '@/lib/auth';
import { db } from '@/lib/db';

// Removes the card from this shop's list only. It does not delete the token at Geidea.
export async function DELETE(req, { params }) {
  try {
    requireUser();
    await db().from('tokens').delete().eq('id', Number(params.id));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
