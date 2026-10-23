export const adminListPageSize = (height) => Math.max(7, Math.min(10, Math.floor((height - 240) / 64)));

export const listPage = (count, pageSize, requestedStart) => {
  const lastStart = Math.max(0, (Math.ceil(count / pageSize) - 1) * pageSize);
  const start = Math.min(lastStart, Math.max(0, Math.floor(requestedStart / pageSize) * pageSize));
  return { start, end: Math.min(count, start + pageSize), hasPrevious: start > 0, hasMore: start + pageSize < count };
};
