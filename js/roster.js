// The list of cars to pick from for each camera. No DOM, so it runs in Node for the tests.
// Cars are matched by car number, which must be unique.

export const STORE_KEY = 'gopro-split-cars';

// `stream` is the car's live stream link, filled in when the car is picked for a camera.
// `note` is shown on the car's feed while its camera isn't live, e.g. a start time.
export const DEFAULT_CARS = [
  { car: '646', driver: 'Sam Commins', nav: 'Baxter Cook', cls: 'SXS Pro', stream: '', note: '' },
  { car: '467', driver: 'Andrew Commins', nav: 'Anthony Cook', cls: 'Extreme 2WD', stream: 'twitch.tv/westlimemotorsport467', note: 'Starts at 7:03am WA time · 10:03am Sydney time' },
  { car: '479', driver: 'Nick Commins', nav: 'Lachlan Bennie', cls: 'Extreme 2WD', stream: 'twitch.tv/westlimemotorsport479', note: 'Starts at 6:46am WA time · 9:46am Sydney time' },
];

// Bumped when the team's starting details change (e.g. new start times), so each device
// picks the change up once, while anything edited on the device afterwards is kept.
const TEAM_VERSION = 2;
const VERSION_KEY = 'gopro-split-cars-team';
// Earlier versions of the team's messages, replaced whenever they're found.
const OLD_TEAM_NOTES = ['Starts at 6:46am WA time'];

export function normalizeCar(c) {
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { car: text(c?.car, 6), driver: text(c?.driver, 40), nav: text(c?.nav, 40), cls: text(c?.cls, 30), stream: text(c?.stream, 300), note: text(c?.note, 80) };
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
          return normalizeCar({ ...c, stream: c?.stream ?? team?.stream, note: stale ? team?.note : c.note });
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
