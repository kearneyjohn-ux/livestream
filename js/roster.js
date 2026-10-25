// The list of cars to pick from for each camera. No DOM, so it runs in Node for the tests.
// Cars are matched by car number, which must be unique.

export const STORE_KEY = 'gopro-split-cars';

// `stream` is the car's live stream link, filled in when the car is picked for a camera.
// `note` is shown on the car's feed while its camera isn't live.
// `start` is the car's start time (see start.js), shown until it passes.
// `rotate` is how the car's camera picture is turned (180 = mounted upside down).
export const DEFAULT_CARS = [
  { car: '646', driver: 'Sam Commins', nav: 'Baxter Cook', cls: 'SXS Pro', stream: '', note: '', start: '', rotate: 0 },
  { car: '467', driver: 'Andrew Commins', nav: 'Anthony Cook', cls: 'Extreme 2WD', stream: 'twitch.tv/westlimemotorsport467', note: '', start: '2026-10-25T14:38:00+08:00', rotate: 180 },
  { car: '479', driver: 'Nick Commins', nav: 'Lachlan Bennie', cls: 'Extreme 2WD', stream: 'twitch.tv/westlimemotorsport479', note: '', start: '2026-10-25T13:47:00+08:00', rotate: 0 },
];

// Bumped when the team's starting details change (e.g. new start times), so each device
// picks the change up once, while anything edited on the device afterwards is kept.
const TEAM_VERSION = 7;
const VERSION_KEY = 'gopro-split-cars-team';
// Earlier team start times, replaced by the current one wherever they're found (on a device
// or in a link) unless the device has set a different time of its own.
export const OLD_TEAM_STARTS = ['2026-10-25T06:46:00+08:00', '2026-10-25T07:03:00+08:00'];
// Earlier versions of the team's messages, replaced whenever they're found.
const OLD_TEAM_NOTES = [
  'Starts at 6:46am WA time',
  'Starts at 6:46am WA time · 9:46am Sydney time',
  'Starts at 7:03am WA time · 10:03am Sydney time',
  'Starts 6:46 am AWST (Perth) · 9:46 am AEDT (Sydney)',
  'Starts 7:03 am AWST (Perth) · 10:03 am AEDT (Sydney)',
];

export function normalizeCar(c) {
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { car: text(c?.car, 6), driver: text(c?.driver, 40), nav: text(c?.nav, 40), cls: text(c?.cls, 30), stream: text(c?.stream, 300), note: text(c?.note, 80), start: text(c?.start, 40), rotate: [90, 180, 270].includes(Number(c?.rotate)) ? Number(c.rotate) : 0 };
}

// This device's list, or the starting list the first time. Lists saved before cars had stream
// links or offline messages pick up the team's ones for the cars they still have.
export function loadCars(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORE_KEY));
    if (Array.isArray(saved)) {
      const catchUp = Number(storage.getItem(VERSION_KEY) || 0) < TEAM_VERSION;
      const cars = saved
        .map((c) => {
          const team = findCar(DEFAULT_CARS, String(c?.car ?? ''));
          const stale = c?.note == null || OLD_TEAM_NOTES.includes(c.note) || (catchUp && !c.note);
          const start = c?.start == null || OLD_TEAM_STARTS.includes(c.start) || (catchUp && !c.start) ? team?.start : c.start;
          const rotate = c?.rotate == null || (catchUp && !c.rotate) ? team?.rotate : c.rotate;
          return normalizeCar({ ...c, stream: c?.stream ?? team?.stream, note: stale ? team?.note : c.note, start, rotate });
        })
        .filter((c) => c.car);
      if (catchUp) {
        saveCars(storage, cars);
        storage.setItem(VERSION_KEY, String(TEAM_VERSION));
      }
      return cars;
    }
  } catch {}
  return DEFAULT_CARS.map((c) => ({ ...c }));
}

export function saveCars(storage, cars) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(cars));
  } catch {}
}

const sameNumber = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function findCar(cars, number) {
  return number ? cars.find((c) => sameNumber(c.car, number)) || null : null;
}

// Adds a car, or replaces the one numbered `oldNumber`. Returns { cars } or { error }.
export function upsertCar(cars, input, oldNumber = '') {
  const car = normalizeCar(input);
  if (!car.car) return { error: 'Give the car a number.' };
  if (cars.some((c) => sameNumber(c.car, car.car) && !(oldNumber && sameNumber(c.car, oldNumber)))) {
    return { error: `There's already a car ${car.car}.` };
  }
  if (!oldNumber) return { cars: [...cars, car] };
  return { cars: cars.map((c) => (sameNumber(c.car, oldNumber) ? car : c)) };
}

export function removeCar(cars, number) {
  return cars.filter((c) => !sameNumber(c.car, number));
}

export function crewText(c) {
  return [c.driver, c.nav].filter(Boolean).join(' / ');
}

// e.g. "646 · Sam Commins / Baxter Cook · SXS Pro"
export function carLabel(c) {
  return [c.car, crewText(c), c.cls].filter(Boolean).join(' · ');
}
