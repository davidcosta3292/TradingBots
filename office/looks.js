// How each robot looks in the office. A robot's owner picks its colour and
// one piece of gear; until then robots get distinct defaults by their place
// in the list (sorted by name).

export const COLORS = ['#E3A82B', '#3FB6C8', '#E0679B', '#7BD389', '#8A6CF0', '#5B8DEF', '#F08A4B', '#E9E6DF'];
export const EYES = ['#9FE8FF', '#3DDC84', '#E3A82B', '#F08A4B', '#E0679B', '#EDEBE6'];

export const GEAR = [
  { key: 'headset', label: 'Headset' },
  { key: 'cap', label: 'Cap' },
  { key: 'tie', label: 'Tie' },
  { key: 'visor', label: 'Visor' },
  { key: 'antennas', label: 'Antennas' },
  { key: 'glasses', label: 'Glasses' },
  { key: 'crown', label: 'Crown' },
  { key: 'badge', label: 'Badge' },
  { key: 'none', label: 'None' },
];

const GEAR_KEYS = GEAR.map((g) => g.key);

export function lookOf(robot, index) {
  const look = robot.look || {};
  return {
    color: /^#[0-9a-f]{6}$/i.test(look.color || '') ? look.color : COLORS[index % COLORS.length],
    gear: GEAR_KEYS.includes(look.gear) ? look.gear : GEAR_KEYS[index % (GEAR_KEYS.length - 1)],
    eyes: EYES.includes(look.eyes) ? look.eyes : EYES[0],
  };
}
