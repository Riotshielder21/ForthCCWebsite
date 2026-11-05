export const SAFEGUARDING_POLICIES = [
  {
    id: 'child-safeguarding-policy',
    title: 'Child Safeguarding Policy',
    detail: 'Generated from the current version of the club’s living policy document.',
    filename: 'Forth Canoe Club Child Safeguarding Policy.pdf',
    sourceUrl: 'https://docs.google.com/document/d/18-bISXFWMPdxBqsxrrDOCCsz_wCw2J83oK7NHZlEhVA/export?format=pdf'
  },
  {
    id: 'adult-safeguarding-policy',
    title: 'Adult Safeguarding Policy (February 2025)',
    detail: 'Club adult safeguarding policy.',
    filename: 'Forth Canoe Club Adult Safeguarding Policy.pdf',
    sourceUrl: 'https://drive.google.com/uc?export=download&id=1_wjQUd9lr0HuSTVNBbuoRpMyn8NwoGda'
  }
];

export const findSafeguardingPolicy = (id) => SAFEGUARDING_POLICIES.find((policy) => policy.id === id) || null;

export const safeguardingPolicyPath = (id, { download = false } = {}) =>
  `/api/safeguarding-documents/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;

export const contentDisposition = (filename, download) => {
  const ascii = filename.replace(/[^\x20-\x7E]|["\\]/g, '');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

export const isPdf = (bytes) => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
