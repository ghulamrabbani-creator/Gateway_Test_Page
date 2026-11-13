import { login, errorResponse } from '@/lib/auth';

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    const s = await login(username, password);
    if (!s) return Response.json({ error: 'Wrong username or password' }, { status: 401 });
    return Response.json(s);
  } catch (e) {
    return errorResponse(e);
  }
}
