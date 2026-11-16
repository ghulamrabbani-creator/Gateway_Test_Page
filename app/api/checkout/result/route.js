import { requireUser, errorResponse } from '@/lib/auth';
import { logBrowser } from '@/lib/orders';

// Receives the data object the Geidea checkout SDK passes to onSuccess / onError / onCancel.
export async function POST(req) {
  try {
    const user = requireUser();
    const { ref, outcome, data, action } = await req.json();
    // R21: the direct routes also log browser-side steps here (Hosted Session update, Cardinal DDC) with their own label
    const label = action ? String(action).slice(0, 120) : `Checkout SDK → ${outcome}`;
    await logBrowser(ref, label, data, user, action ? `${label}` : `GeideaCheckout ${outcome} callback (browser)`);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
