export const SEED_PASSWORD = 'Password123!'

export const USERS = [
  { name: 'Jashim Uddin',  email: 'jashim@oitesla.test',  role: 'DRIVER'    },
  { name: 'Nusrat Jahan',  email: 'nusrat@oitesla.test',  role: 'PASSENGER' },
  { name: 'Rafiq Hasan',   email: 'rafiq@oitesla.test',   role: 'PASSENGER' },
  { name: 'Shirin Akter',  email: 'shirin@oitesla.test',  role: 'PASSENGER' },
] as const

export const VEHICLE = { name: 'Bullet', seatCapacity: 3 }

// Array order defines the SERIAL ids the seed assigns (Banani = 1, ...).
export const ZONES = [
  { name: 'Banani',       lat: 23.793700, lng: 90.406600 },
  { name: 'Gulshan 1',    lat: 23.780800, lng: 90.415400 },
  { name: 'Mohakhali',    lat: 23.777900, lng: 90.399700 },
  { name: 'Dhanmondi',    lat: 23.746100, lng: 90.374200 },
  { name: 'Mirpur',       lat: 23.822300, lng: 90.365400 },
  { name: 'Uttara',       lat: 23.875900, lng: 90.379500 },
  { name: 'Farmgate',     lat: 23.756900, lng: 90.389300 },
  { name: 'Bashundhara',  lat: 23.814100, lng: 90.424300 },
] as const

// Kilometres. Every pair is inserted in both directions by the seed.
export const DISTANCES: readonly [string, string, number][] = [
  ['Banani',      'Gulshan 1',   4.0],
  ['Banani',      'Mohakhali',   3.0],
  ['Banani',      'Dhanmondi',   8.0],
  ['Banani',      'Mirpur',      7.0],
  ['Banani',      'Uttara',      9.0],
  ['Banani',      'Farmgate',    6.0],
  ['Banani',      'Bashundhara', 6.5],
  ['Gulshan 1',   'Mohakhali',   2.0],
  ['Gulshan 1',   'Dhanmondi',   9.0],
  ['Gulshan 1',   'Mirpur',      9.5],
  ['Gulshan 1',   'Uttara',     11.0],
  ['Gulshan 1',   'Farmgate',    7.0],
  ['Gulshan 1',   'Bashundhara', 5.0],
  ['Mohakhali',   'Dhanmondi',   6.5],
  ['Mohakhali',   'Mirpur',      7.5],
  ['Mohakhali',   'Uttara',     11.5],
  ['Mohakhali',   'Farmgate',    4.0],
  ['Mohakhali',   'Bashundhara', 7.0],
  ['Dhanmondi',   'Mirpur',      8.0],
  ['Dhanmondi',   'Uttara',     16.0],
  ['Dhanmondi',   'Farmgate',    3.5],
  ['Dhanmondi',   'Bashundhara',12.0],
  ['Mirpur',      'Uttara',     12.0],
  ['Mirpur',      'Farmgate',    6.0],
  ['Mirpur',      'Bashundhara',13.0],
  ['Uttara',      'Farmgate',   14.0],
  ['Uttara',      'Bashundhara', 8.0],
  ['Farmgate',    'Bashundhara',10.0],
]
