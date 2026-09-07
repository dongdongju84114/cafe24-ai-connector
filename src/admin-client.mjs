import { Cafe24ApiError, callCafe24AdminGet } from './cafe24.mjs';

export async function callCafe24AdminWithToken({
  mallId,
  resourcePath,
  query,
  apiVersion,
  allowedPrefixes,
  getToken,
  invalidateToken = () => {},
  callAdminGet = callCafe24AdminGet
}) {
  const callAdmin = (accessToken) => callAdminGet({
    mallId,
    resourcePath,
    query,
    accessToken,
    apiVersion,
    allowedPrefixes
  });

  const token = await getToken(mallId);
  try {
    return await callAdmin(token.access_token);
  } catch (error) {
    if (!(error instanceof Cafe24ApiError) || error.status !== 401) {
      throw error;
    }

    invalidateToken(mallId, token.access_token);
    const refreshedToken = await getToken(mallId, {
      forceRefresh: true,
      rejectedAccessToken: token.access_token
    });
    return callAdmin(refreshedToken.access_token);
  }
}
