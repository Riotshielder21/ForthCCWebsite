/** Preserve this paid period and every other line, then remove the selected item at its end. */
export const volunteerCancellationPhases = (subscription, schedule, stripeItemId) => {
  if (subscription.discounts?.length || subscription.automatic_tax?.enabled || subscription.default_tax_rates?.length || subscription.pending_update) {
    throw new Error('This subscription has additional billing settings. Arrange its cancellation in Stripe.');
  }
  const items = subscription.items?.data || [];
  if (!items.some((item) => item.id === stripeItemId)) throw new Error('The benefit is no longer on this subscription.');
  const end = subscription.current_period_end || items[0]?.current_period_end;
  const cutoff = subscription.cancel_at;
  if (!Number.isFinite(end) || !Number.isFinite(cutoff)) throw new Error('The paid period and club-year cutoff must be recorded in Stripe.');
  const start = schedule.current_phase?.start_date || schedule.phases?.[0]?.start_date;
  if (!Number.isFinite(start)) throw new Error('The current Stripe schedule start is not recorded.');
  const boundary = Math.min(end, cutoff);
  const params = [['end_behavior', 'cancel'], ['proration_behavior', 'none'],
    ['phases[0][start_date]', String(start)],
    ['phases[0][end_date]', String(boundary)], ['phases[0][proration_behavior]', 'none']];
  if (subscription.trial_end && subscription.trial_end > start) params.push(['phases[0][trial_end]', String(Math.min(subscription.trial_end, boundary))]);
  const add = (phase, entries) => entries.forEach((item, index) => {
    if (!item.price?.id) throw new Error('The subscription has no reusable Stripe price.');
    params.push([`phases[${phase}][items][${index}][price]`, item.price.id],
      [`phases[${phase}][items][${index}][quantity]`, String(item.quantity || 1)]);
  });
  add(0, items);
  const remaining = items.filter((item) => item.id !== stripeItemId);
  if (remaining.length && cutoff > boundary) {
    params.push(['phases[1][start_date]', String(boundary)], ['phases[1][end_date]', String(cutoff)],
      ['phases[1][proration_behavior]', 'none']);
    add(1, remaining);
  }
  return { params, endsAt: boundary };
};

const priceIdOf = (price) => price?.id || price || '';

/**
 * Rebuilds a schedule from its current phase on without the given prices, so a cancelled item is neither billed now
 * nor added back when a later phase starts. Phases left empty end the schedule early (it then cancels). Returns null
 * when the current phase would be empty, meaning the whole subscription should be cancelled instead.
 */
export const scheduleWithoutPrices = (schedule, priceIds) => {
  const drop = new Set(priceIds.filter(Boolean));
  const from = schedule.current_phase?.start_date ?? schedule.phases?.[0]?.start_date;
  const phases = [];
  for (const phase of (schedule.phases || []).filter((candidate) => candidate.start_date >= from)) {
    const items = (phase.items || []).filter((item) => !drop.has(priceIdOf(item.price)));
    if (!items.length) break;
    phases.push({ ...phase, items });
  }
  if (!phases.length) return null;
  const params = [['end_behavior', phases.length < (schedule.phases || []).filter((candidate) => candidate.start_date >= from).length ? 'cancel' : schedule.end_behavior || 'cancel'],
    ['proration_behavior', 'none']];
  phases.forEach((phase, index) => {
    params.push([`phases[${index}][start_date]`, String(phase.start_date)], [`phases[${index}][end_date]`, String(phase.end_date)],
      [`phases[${index}][proration_behavior]`, 'none']);
    if (phase.trial_end && phase.trial_end > phase.start_date) params.push([`phases[${index}][trial_end]`, String(phase.trial_end)]);
    phase.items.forEach((item, position) => params.push([`phases[${index}][items][${position}][price]`, priceIdOf(item.price)],
      [`phases[${index}][items][${position}][quantity]`, String(item.quantity || 1)]));
  });
  return params;
};
