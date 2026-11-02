import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWithoutPrices } from './volunteerCancellation.js';

const schedule = {
  end_behavior: 'cancel',
  current_phase: { start_date: 200 },
  phases: [
    { start_date: 100, end_date: 200, items: [{ price: 'price_a' }, { price: 'price_b' }] },
    { start_date: 200, end_date: 300, items: [{ price: { id: 'price_a' } }, { price: 'price_b', quantity: 2 }] },
    { start_date: 300, end_date: 400, items: [{ price: 'price_a' }] }
  ]
};
const value = (params, name) => params.find(([key]) => key === name)?.[1];

test('cancelled prices are dropped from the current and later phases only', () => {
  const params = scheduleWithoutPrices(schedule, ['price_b']);
  assert.equal(value(params, 'phases[0][start_date]'), '200');
  assert.equal(value(params, 'phases[0][items][0][price]'), 'price_a');
  assert.equal(value(params, 'phases[0][items][1][price]'), undefined);
  assert.equal(value(params, 'phases[1][items][0][price]'), 'price_a');
  assert.equal(value(params, 'end_behavior'), 'cancel');
});

test('the schedule ends where no items remain', () => {
  const params = scheduleWithoutPrices({ ...schedule, end_behavior: 'release' }, ['price_a']);
  assert.equal(value(params, 'phases[0][items][0][price]'), 'price_b');
  assert.equal(value(params, 'phases[0][items][0][quantity]'), '2');
  assert.equal(value(params, 'phases[1][start_date]'), undefined);
  assert.equal(value(params, 'end_behavior'), 'cancel');
});

test('nothing is left when every price is cancelled', () => {
  assert.equal(scheduleWithoutPrices(schedule, ['price_a', 'price_b']), null);
});
