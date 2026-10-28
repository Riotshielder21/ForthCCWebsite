export const hasKeyAccess = (member) => Boolean(member && !member.keyAccess?.revokedAt && (
  member.keyAccess?.grantedAt
  || (member.privileges || []).some((privilege) => privilege.productId === 'keyhire' && !privilege.endedAt)
  || member.volunteer?.inducted === true
));
