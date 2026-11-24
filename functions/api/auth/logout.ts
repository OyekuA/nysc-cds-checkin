import { clearSessionCookie } from '../../_lib/auth';
import { Env, jsonResponse } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  return jsonResponse(
    { ok: true },
    200,
    { 'Set-Cookie': clearSessionCookie(request.url) }
  );
};
