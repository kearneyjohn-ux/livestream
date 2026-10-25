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
  saveCars(storage, [{ car: '12', driver: 'A', nav: 'B', cls: 'C', stream: 'twitch.tv/x', note: 'Delayed', start: '2026-10-25T09:00:00+08:00', rotate: 180 }]);
  assert.deepEqual(loadCars(storage), [{ car: '12', driver: 'A', nav: 'B', cls: 'C', stream: 'twitch.tv/x', note: 'Delayed', start: '2026-10-25T09:00:00+08:00', rotate: 180 }]);
  saveCars(storage, []);
  assert.deepEqual(loadCars(storage), []);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: 'not json' })), DEFAULT_CARS);
  assert.deepEqual(loadCars(memoryStorage({ [STORE_KEY]: '[{"car":" 7 ","driver":3},{"driver":"no number"}]' })), [
    { car: '7', driver: '', nav: '', cls: '', stream: '', note: '', start: '', rotate: 0 },
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
  assert.equal(findCar(cars, '479').start, '2026-10-25T13:47:00+08:00', "the team's start time is picked up");
  assert.equal(findCar(cars, '467').start, '2026-10-25T14:38:00+08:00');
});

test('Start times written as messages give way to real start times; other messages stay', () => {
  const cars = loadCars(memoryStorage({
    'gopro-split-cars-team': '3',
    [STORE_KEY]: JSON.stringify([
      { car: '467', stream: 'twitch.tv/westlimemotorsport467', note: 'Starts 7:03 am AWST (Perth) · 10:03 am AEDT (Sydney)' },
      { car: '479', stream: 'twitch.tv/westlimemotorsport479', note: 'Starts at 6:46am WA time' },
      { car: '646', note: 'Back after lunch' },
    ]),
  }));
  assert.equal(findCar(cars, '467').note, '');
  assert.equal(findCar(cars, '467').start, '2026-10-25T14:38:00+08:00');
  assert.equal(findCar(cars, '479').note, '');
  assert.equal(findCar(cars, '479').start, '2026-10-25T13:47:00+08:00');
  assert.equal(findCar(cars, '646').note, 'Back after lunch');
});

test('A start time cleared on the device stays cleared', () => {
  const storage = memoryStorage({ [STORE_KEY]: JSON.stringify([{ car: '467', stream: 'x' }]) });
  let cars = loadCars(storage);
  assert.equal(findCar(cars, '467').start, '2026-10-25T14:38:00+08:00');
  saveCars(storage, cars.map((c) => ({ ...c, start: '' })));
  cars = loadCars(storage);
  assert.equal(findCar(cars, '467').start, '');
});

test("Car 467's camera is upside down; a device that already turned a car keeps its choice", () => {
  const cars = loadCars(memoryStorage({
    'gopro-split-cars-team': '4',
    [STORE_KEY]: JSON.stringify([
      { car: '467', stream: 'twitch.tv/westlimemotorsport467' },
      { car: '479', stream: 'twitch.tv/westlimemotorsport479', rotate: 90 },
    ]),
  }));
  assert.equal(findCar(cars, '467').rotate, 180);
  assert.equal(findCar(cars, '479').rotate, 90);
  assert.equal(findCar(DEFAULT_CARS, '479').rotate, 0);
});

test("Car 479's earlier start time is replaced by the new one; a device's own time stays", () => {
  const cars = loadCars(memoryStorage({
    'gopro-split-cars-team': '5',
    [STORE_KEY]: JSON.stringify([
      { car: '479', stream: 'twitch.tv/westlimemotorsport479', start: '2026-10-25T06:46:00+08:00' },
      { car: '467', stream: 'twitch.tv/westlimemotorsport467', start: '2026-10-25T08:15:00+08:00' },
    ]),
  }));
  assert.equal(findCar(cars, '479').start, '2026-10-25T13:47:00+08:00');
  assert.equal(findCar(cars, '467').start, '2026-10-25T08:15:00+08:00');
});

test("Car 467's earlier start time is replaced by the new one", () => {
  const cars = loadCars(memoryStorage({
    'gopro-split-cars-team': '6',
    [STORE_KEY]: JSON.stringify([{ car: '467', stream: 'twitch.tv/westlimemotorsport467', start: '2026-10-25T07:03:00+08:00', rotate: 180 }]),
  }));
  assert.equal(findCar(cars, '467').start, '2026-10-25T14:38:00+08:00');
  assert.equal(findCar(cars, '467').rotate, 180);
});
