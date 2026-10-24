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
  saveCars(storage, [{ car: '12', driver: 'A', nav: 'B', cls: 'C', stream: 'twitch.tv/x', note: 'Starts 9am' }]);
  assert.deepEqual(loadCars(storage), [{ car: '12', driver: 'A', nav: 'B', cls: 'C', stream: 'twitch.tv/x', note: 'Starts 9am' }]);
  saveCars(storage, []);
  assert.deepEqual(loadCars(storage), []);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: 'not json' })), DEFAULT_CARS);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: '[{"car":" 7 ","driver":3},{"driver":"no number"}]' })), [
    { car: '7', driver: '', nav: '', cls: '', stream: '', note: '' },
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

test("Cars saved before stream links get the team's links, but a removed link stays removed", () => {
  const old = memoryStorage({
    [STORE_KEY]: JSON.stringify([
      { car: '467', driver: 'Andrew Commins', nav: 'Anthony Cook', cls: 'Extreme 2WD' },
      { car: '101', driver: 'Jo' },
      { car: '479', driver: 'Nick Commins', stream: '' },
    ]),
  });
  const cars = loadCars(old);
  assert.equal(findCar(cars, '467').stream, 'twitch.tv/westlimemotorsport467');
  assert.equal(findCar(cars, '101').stream, '');
  assert.equal(findCar(cars, '479').stream, '', 'an emptied link is not filled back in');
  assert.equal(findCar(cars, '479').note, 'Starts at 6:46am WA time · 9:46am Sydney time', "the team's message is picked up");
  assert.equal(findCar(cars, '467').note, 'Starts at 7:03am WA time · 10:03am Sydney time');
});

test('A device showing an earlier team message gets the current one, but its own messages stay', () => {
  const cars = loadCars(memoryStorage({
    [STORE_KEY]: JSON.stringify([
      { car: '479', driver: 'Nick Commins', stream: 'twitch.tv/westlimemotorsport479', note: 'Starts at 6:46am WA time' },
      { car: '467', driver: 'Andrew Commins', stream: 'twitch.tv/westlimemotorsport467', note: 'Back after lunch' },
    ]),
  }));
  assert.equal(findCar(cars, '479').note, 'Starts at 6:46am WA time · 9:46am Sydney time');
  assert.equal(findCar(cars, '467').note, 'Back after lunch');
});

test("New team start times reach a device once, even over an empty message, but a later clear sticks", () => {
  const storage = memoryStorage({
    [STORE_KEY]: JSON.stringify([
      { car: '467', driver: 'Andrew Commins', stream: 'twitch.tv/westlimemotorsport467', note: '' },
      { car: '479', driver: 'Nick Commins', stream: 'twitch.tv/westlimemotorsport479', note: 'Starts at 6:46am WA time' },
    ]),
  });
  let cars = loadCars(storage);
  assert.equal(findCar(cars, '467').note, 'Starts at 7:03am WA time · 10:03am Sydney time');
  assert.equal(findCar(cars, '479').note, 'Starts at 6:46am WA time · 9:46am Sydney time');
  // Cleared on the device afterwards: stays cleared.
  saveCars(storage, cars.map((c) => (c.car === '467' ? { ...c, note: '' } : c)));
  cars = loadCars(storage);
  assert.equal(findCar(cars, '467').note, '');
});
