import { requireUser, errorResponse } from '@/lib/auth';
import { logBrowser } from '@/lib/orders';

// Receives the data object the Geidea checkout SDK passes to onSuccess / onError / onCancel.
export async function POST(req) {
  try {
    const user = requireUser();
    const { ref, outcome, data } = await req.json();
    await logBrowser(ref, `Checkout SDK → ${outcome}`, data, user, `GeideaCheckout ${outcome} callback (browser)`);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
