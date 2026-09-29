// Trader runs in MT5; Fundamental Analyst runs as a separate news watcher.
export const ASSIGNMENTS = [
  { key: 'trader', label: 'Trader', detail: 'MetaTrader EA · strategy and FTMO guards' },
  { key: 'risk_manager', label: 'Risk manager', detail: 'Planned · portfolio-level risk review' },
  { key: 'coordinator', label: 'Coordinator', detail: 'Planned · supervise sessions and assignments' },
  { key: 'analyst', label: 'Fundamental Analyst', detail: 'Server news watch · each slot needs scheduling' },
];
export const assignmentOf = (robot) => ASSIGNMENTS.find((a) => a.key === robot.assignment) || ASSIGNMENTS[0];
export const isTrader = (robot) => assignmentOf(robot).key === 'trader';
export const isAnalyst = (robot) => assignmentOf(robot).key === 'analyst';
