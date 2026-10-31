// Test-only fence participant: a real protocol process. Modes:
//   shared  — acquire a shared admission, signal ready, hold until the exit file appears
//   late    — wait for the go file (set after an exclusive is held), then try to
//             acquire shared and report the refusal code
import { acquireMigrationShared } from '../../packages/orchestration/src/migration-fence.mjs'
import { readFile, writeFile } from 'node:fs/promises'

const [home, mode, readyPath, gatePath, exitPath] = process.argv.slice(2)
if (mode === 'late') {
  for (;;) { try { await readFile(gatePath); break } catch { await new Promise(r => setTimeout(r, 20)) } }
  try { await acquireMigrationShared(home); await writeFile(readyPath, 'ACQUIRED') }
  catch (error) { await writeFile(readyPath, error.code ?? 'ERROR') }
  process.exit(0)
}
const shared = await acquireMigrationShared(home)
await writeFile(readyPath, String(process.pid))
for (;;) {
  try { await readFile(exitPath); break } catch { await new Promise(r => setTimeout(r, 20)) }
  if (process.env.FENCE_HOLDER_EXIT === '1') break
}
await shared.release()
process.exit(0)
