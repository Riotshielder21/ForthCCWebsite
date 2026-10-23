export const BOATHOUSE_LIMITS = { code: 40, note: 300 };

const text = (value) => typeof value === 'string' ? value.trim() : '';

/** Checks the boathouse access code an admin saves; the note says where it applies (e.g. "side door padlock"). */
export const validateBoathouseCode = (body = {}) => {
  const code = text(body.code);
  const note = text(body.note);
  if (!code || code.length > BOATHOUSE_LIMITS.code || /[\u0000-\u001f\u007f]/.test(code)) {
    return { error: `Enter the boathouse code (up to ${BOATHOUSE_LIMITS.code} characters).` };
  }
  if (note.length > BOATHOUSE_LIMITS.note || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    return { error: `Keep the note under ${BOATHOUSE_LIMITS.note} characters.` };
  }
  return { value: { code, note } };
};
