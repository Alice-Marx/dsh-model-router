import {CONTAINER_COMMAND_IMAGE} from '../../remote-computer-agent/src/container-task-contract.ts'

export const MACHINE_ID='machine-contract-fixture'
export const OTHER_MACHINE_ID='machine-contract-other'
export const ROOT_ID='project'
export const OTHER_ROOT_ID='other'

// Fixed trusted clock (absolute Unix epoch milliseconds). Every deadline in this
// fixture is expressed absolutely against it, never as a relative duration, so a
// lapsed request stays lapsed when the clock moves forward.
export const NOW=1793300000000
export const HORIZON=1800000
export const DEADLINE=NOW+60000
export const PAST_DEADLINE=NOW-1
export const FAR_DEADLINE=NOW+HORIZON+1

export const baselineConfig=(overrides={})=>({
  platform:'linux',
  isolation:'container',
  image:CONTAINER_COMMAND_IMAGE,
  executables:{node:'/usr/local/bin/node'},
  // The owner explicitly approves this alias as an interpreter. Absent means no
  // alias may resolve to an interpreter at all.
  interpreterAliases:['node'],
  machineId:MACHINE_ID,
  allowedRoots:[ROOT_ID],
  ...overrides,
})

export const baselineRequest=(overrides={})=>({
  workspaceRef:{kind:'remote',machineId:MACHINE_ID,rootId:ROOT_ID,relativePath:''},
  alias:'node',
  argv:['program.mjs'],
  deadline:DEADLINE,
  ...overrides,
})

export const withWorkspace=(request,patch)=>({...request,workspaceRef:{...request.workspaceRef,...patch}})
export const withConfig=(config,patch)=>({...config,...patch})
export const withClock={now:NOW}
