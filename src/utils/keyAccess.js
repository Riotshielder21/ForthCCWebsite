export const hasKeyAccess = (member) => Boolean(member && !member.keyAccess?.revokedAt && (
  member.keyAccess?.grantedAt
  || member.volunteer?.inducted === true
));
