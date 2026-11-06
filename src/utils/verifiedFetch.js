export const createVerifiedFetch = (tokenProvider, fetchRequest = (...args) => globalThis.fetch(...args)) => async (url, options = {}) => {
  const token = await tokenProvider();
  const headers = new Headers(options.headers);
  if (token) headers.set('X-Firebase-AppCheck', token);
  return fetchRequest(url, { ...options, headers });
};
