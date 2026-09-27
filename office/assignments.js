// Assignment names the intended job. Only Trader has a running implementation.
export const ASSIGNMENTS = [
  { key: 'trader', label: 'Trader', detail: 'MetaTrader EA · strategy and FTMO guards' },
  { key: 'risk_manager', label: 'Risk manager', detail: 'Planned · portfolio-level risk review' },
  { key: 'coordinator', label: 'Coordinator', detail: 'Planned · supervise sessions and assignments' },
  { key: 'analyst', label: 'Analyst', detail: 'Planned · review trades and feedback' },
];
export const assignmentOf = (robot) => ASSIGNMENTS.find((a) => a.key === robot.assignment) || ASSIGNMENTS[0];
export const isTrader = (robot) => assignmentOf(robot).key === 'trader';
