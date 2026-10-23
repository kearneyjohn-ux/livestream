// The list of cars to pick from for each camera. No DOM, so it runs in Node for the tests.
// Cars are matched by car number, which must be unique.

export const STORE_KEY = 'gopro-split-cars';

export const DEFAULT_CARS = [
  { car: '646', driver: 'Sam Commins', nav: 'Baxter Cook', cls: 'SXS Pro' },
  { car: '467', driver: 'Andrew Commins', nav: 'Anthony Cook', cls: 'Extreme 2WD' },
  { car: '479', driver: 'Nick Commins', nav: 'Lachlan Bennie', cls: 'Extreme 2WD' },
];

export function normalizeCar(c) {
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { car: text(c?.car, 6), driver: text(c?.driver, 40), nav: text(c?.nav, 40), cls: text(c?.cls, 30) };
}

// This device's list, or the starting list the first time.
export function loadCars(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORE_KEY));
    if (Array.isArray(saved)) return saved.map(normalizeCar).filter((c) => c.car);
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
