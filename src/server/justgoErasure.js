const baseUrl = 'https://api.justgo.com/api/v2.2/';
const guid = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('JustGo unlinking needs a confirmed organisation and member ID. Reconcile the JustGo link before erasure.');
  }
  return value.toLowerCase();
};

export const hasJustgoLink = (record) => Boolean(record.justgoMemberId || record.justgoSyncStatus === 'synced'
  || record.renewalMethod === 'justgo' || record.affiliationNumber);

// The Cloud Run API has no Python runtime; use only the same documented v2.2 endpoints as the operator client.
export const createJustgoErasure = ({ env = process.env, fetchImpl = fetch } = {}) => {
  const request = async (method, path, body, token) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
    } catch {
      throw new Error('JustGo request could not be confirmed. Member records were kept; reconcile the FCC link and retry.');
    }
    // Remote error bodies can echo personal data or the API secret; do not return or log them.
    if (!response.ok) throw new Error(`JustGo returned HTTP ${response.status}. FCC unlinking was not confirmed.`);
    let result;
    try { result = await response.json(); }
    catch { throw new Error('JustGo returned an invalid response. FCC unlinking was not confirmed.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || (result.statusCode !== undefined && (!Number.isInteger(result.statusCode) || result.statusCode < 200 || result.statusCode >= 300))) {
      throw new Error('JustGo did not confirm a successful response. Reconcile the FCC link before retrying.');
    }
    return result;
  };

  const prepare = async (records) => {
    const linked = records.filter(hasJustgoLink);
    if (!linked.length) return { unlink: async () => ({ unlinked: 0, alreadyUnlinked: 0 }) };
    if (env.JUSTGO_API_ENABLED !== 'true' || env.JUSTGO_API_WRITES_ENABLED !== 'true' || !env.JUSTGO_API_SECRET?.trim()) {
      throw new Error('JustGo unlinking is not configured or enabled. Enable the JustGo API and writes with its secret before erasure.');
    }
    const organisationId = guid(env.JUSTGO_ORGANISATION_ID);
    const ids = [...new Set(linked.map((record) => guid(record.justgoMemberId)))];
    const auth = (await request('POST', 'Auth', { secret: env.JUSTGO_API_SECRET })).data;
    if (!auth?.accessToken || typeof auth.accessToken !== 'string' || String(auth.tokenType).toLowerCase() !== 'bearer'
      || !Number.isInteger(auth.expiresIn) || auth.expiresIn <= 0) {
      throw new Error('JustGo Auth did not return a valid bearer token.');
    }
    const member = async (id) => {
      const data = (await request('GET', `Members/${id}`, undefined, auth.accessToken)).data;
      if (!data || typeof data !== 'object' || Array.isArray(data) || guid(data.id) !== id
        || !Object.hasOwn(data, 'organisations') || (data.organisations !== null && !Array.isArray(data.organisations))) {
        throw new Error('JustGo did not return the requested member and confirmed club links.');
      }
      const organisations = data.organisations || [];
      if (organisations.some((entry) => !entry || typeof entry !== 'object'
        || typeof entry.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id))) {
        throw new Error('JustGo returned invalid club links. FCC removal cannot be confirmed.');
      }
      const links = organisations.filter((entry) => entry.id.toLowerCase() === organisationId);
      if (links.length > 1 || (links.length && typeof links[0].isPrimary !== 'boolean')) {
        throw new Error('JustGo did not confirm whether FCC is the primary or additional club. Reconcile before erasure.');
      }
      return links[0] || null;
    };
    // Validate every person's ID, club and primary/additional status before cancelling any payments.
    for (const id of ids) await member(id);
    return {
      unlink: async () => {
        let unlinked = 0, alreadyUnlinked = 0;
        for (const id of ids) {
          const link = await member(id);
          if (!link) { alreadyUnlinked += 1; continue; }
          await request('DELETE', 'Organisations/DeleteMember', {
            organisationId, memberId: id, isAdditionalClub: !link.isPrimary
          }, auth.accessToken);
          if (await member(id)) throw new Error('JustGo still lists the FCC link after removal. Member records were kept; reconcile before retrying.');
          unlinked += 1;
        }
        return { unlinked, alreadyUnlinked };
      }
    };
  };
  return { prepare };
};
