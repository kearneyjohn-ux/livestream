import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CARS, loadCars, saveCars, findCar, upsertCar, removeCar, carLabel, STORE_KEY } from '../js/roster.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), data };
}

test('A new device starts with the team cars', () => {
  const cars = loadCars(memoryStorage());
  assert.deepEqual(cars, DEFAULT_CARS);
  assert.equal(carLabel(cars[0]), '646 · Sam Commins / Baxter Cook · SXS Pro');
  cars[0].driver = 'changed';
  assert.equal(DEFAULT_CARS[0].driver, 'Sam Commins', 'the starting list is not changed by edits');
});

test('The list is saved, including an empty one', () => {
  const storage = memoryStorage();
  saveCars(storage, [{ car: '12', driver: 'A', nav: 'B', cls: 'C' }]);
  assert.deepEqual(loadCars(storage), [{ car: '12', driver: 'A', nav: 'B', cls: 'C' }]);
  saveCars(storage, []);
  assert.deepEqual(loadCars(storage), []);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: 'not json' })), DEFAULT_CARS);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: '[{"car":" 7 ","driver":3},{"driver":"no number"}]' })), [
    { car: '7', driver: '', nav: '', cls: '' },
  ]);
});

test('Adding, editing and removing cars', () => {
  let cars = DEFAULT_CARS;
  assert.equal(upsertCar(cars, { car: ' ' }).error, 'Give the car a number.');
  assert.equal(upsertCar(cars, { car: '646' }).error, "There's already a car 646.");

  ({ cars } = upsertCar(cars, { car: '101', driver: 'New Driver', cls: 'Pro Lite' }));
  assert.equal(cars.length, 4);
  assert.equal(findCar(cars, '101').driver, 'New Driver');

  // Editing keeps its own number free, but can't take another car's.
  assert.equal(upsertCar(cars, { car: '467', driver: 'X' }, '101').error, "There's already a car 467.");
  ({ cars } = upsertCar(cars, { car: '101', driver: 'Renamed' }, '101'));
  assert.equal(findCar(cars, '101').driver, 'Renamed');
  ({ cars } = upsertCar(cars, { car: '102', driver: 'Renumbered' }, '101'));
  assert.equal(findCar(cars, '101'), null);
  assert.equal(cars.length, 4);

  cars = removeCar(cars, '102');
  assert.deepEqual(cars, DEFAULT_CARS);
  assert.equal(findCar(cars, ''), null);
});
