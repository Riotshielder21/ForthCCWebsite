export const BOATHOUSE_LIMITS = { code: 40, note: 300 };
export const BOATHOUSE_ACCESS_POINTS = [
  { key: 'gate', label: 'Gate' },
  { key: 'alarm', label: 'Alarm' },
  { key: 'lockbox', label: 'Lockbox' }
];

const text = (value) => typeof value === 'string' ? value.trim() : '';

/** Reads the current schema and maps the former single code to the gate during migration. */
export const boathouseAccessFromSettings = (data = {}) => Object.fromEntries(
  BOATHOUSE_ACCESS_POINTS.flatMap(({ key }) => [
    [`${key}Code`, data[`${key}Code`] ?? (key === 'gate' ? data.code : '') ?? ''],
    [`${key}Note`, data[`${key}Note`] ?? (key === 'gate' ? data.note : '') ?? '']
  ])
);

/** Validates all three access codes and their optional notes. */
export const validateBoathouseCode = (body = {}) => {
  const value = {};
  for (const { key, label } of BOATHOUSE_ACCESS_POINTS) {
    const code = text(body[`${key}Code`]);
    const note = text(body[`${key}Note`]);
    if (!code || code.length > BOATHOUSE_LIMITS.code || /[\u0000-\u001f\u007f]/.test(code)) {
      return { error: `Enter the ${label.toLowerCase()} code (up to ${BOATHOUSE_LIMITS.code} characters).` };
    }
    if (note.length > BOATHOUSE_LIMITS.note || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
      return { error: `Keep the ${label.toLowerCase()} note under ${BOATHOUSE_LIMITS.note} characters.` };
    }
    value[`${key}Code`] = code;
    value[`${key}Note`] = note;
  }
  return { value };
};
