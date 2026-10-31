import {resumeMigrationConfigurationCommit} from '../../packages/orchestration/src/migration-configuration-commit.mjs'
const [privateOutput,phase,boundary]=process.argv.slice(2)
await resumeMigrationConfigurationCommit({privateOutput,phase,recover:true,onStep:async(step,index)=>{if(step===boundary&&(index===0||index===-1))process.exit(86)}})
process.exitCode=87
