import { getSessionUser, isLocalDevRequest } from '../../_lib/auth';
import { getAdminEmails } from '../../_lib/db';
import { Env, jsonResponse } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  let isAdmin = false;

  if (user) {
    const admins = await getAdminEmails(env);
    isAdmin = admins.includes(user.email.toLowerCase());
  }

  return jsonResponse({
    user,
    isAdmin,
    devAuthEnabled: isLocalDevRequest(request, env),
    googleConfigured: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
  });
};
