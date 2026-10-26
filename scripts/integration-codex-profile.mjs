import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bridge = join(ROOT, 'packages/capability-broker/src/stdio-bridge.mjs')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** Developer-only config parser check. This never executes a model or starts the bridge. */
export async function probeCodexProfiles(entry) {
  entry = await realpath(entry)
  const packageRoot = resolve(dirname(entry), '..')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@openai/codex', 'Use the already-verified official Codex package')
  assert.equal(await realpath(resolve(packageRoot, manifest.bin.codex)), entry)
  const parent = join(ROOT, 'tmp/integration/codex-profiles')
  await mkdir(parent, { recursive: true })
  const run = await mkdtemp(join(parent, 'probe-'))
  const cwd = join(run, 'workspace')
  await mkdir(cwd)
  const existingConfig = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  const fingerprint = async () => {
    try { return hash(await readFile(existingConfig)) } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error }
  }
  const before = await fingerprint()
  const invoke = (home, args) => {
    const env = { CODEX_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, NO_COLOR: '1' }
    for (const key of ['PATH','Path','SystemRoot','windir','TEMP','TMP','TMPDIR','ComSpec']) if (process.env[key]) env[key] = process.env[key]
    return spawnSync(process.execPath, [entry, ...args], { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024*1024 })
  }
  const configs = []
  let cliVersion
  for (const name of ['bot_a','bot_b']) {
    const home = join(run, name)
    await mkdir(home)
    const text = `model = "gpt-fixture-${name}"\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(bridge)}]\nenabled = true\nrequired = true\nenabled_tools = [${JSON.stringify(`ping_${name}`)}]\n`
    await writeFile(join(home, 'config.toml'), text)
    const version = invoke(home, ['--version'])
    assert.equal(version.status, 0)
    cliVersion ??= version.stdout.trim()
    const list = invoke(home, ['mcp','list','--json'])
    assert.equal(list.status, 0, 'Codex configuration must parse without a real model request')
    const servers = JSON.parse(list.stdout)
    assert.deepEqual(servers.map(server => server.name), [name], 'No other profile/global MCP server may appear')
    const get = invoke(home, ['mcp','get',name,'--json'])
    assert.equal(get.status, 0)
    const server = JSON.parse(get.stdout)
    assert.equal(server.name, name)
    assert.deepEqual(server.enabled_tools, [`ping_${name}`])
    assert.equal(server.transport.command, process.execPath)
    assert.deepEqual(server.transport.args, [bridge])
    const other = invoke(home, ['mcp','get',name === 'bot_a' ? 'bot_b' : 'bot_a','--json'])
    assert.notEqual(other.status, 0, 'Another Bot profile must remain absent')
    configs.push({ name, configSha256: hash(Buffer.from(text)), listedServers: servers.map(server => server.name), allowedTools: server.enabled_tools })
  }
  assert.equal(await fingerprint(), before, 'Existing Codex config must remain byte-identical')
  const result = { status:'passed-config-only', packageVersion:manifest.version, cliVersion, entrySha256:hash(await readFile(entry)), configs,
    existingUserConfigUnchanged:true, actualModelCalls:0,
    limitations:['Only installed Codex mcp list/get parsing and CODEX_HOME isolation verified', 'No Codex model execution or bridge startup through Codex tested', 'Managed bridge currently requires a direct private parent IPC channel; CLI-grandchild bootstrap remains to implement', 'Per-CLI homes alone are not OS isolation', 'Other official CLIs and remote CLI launch remain unverified'] }
  await writeFile(join(run,'summary.json'), JSON.stringify(result,null,2)+'\n')
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--entry') {
    process.stderr.write('Usage: node scripts/integration-codex-profile.mjs --entry <verified-official-codex-bin-js>\n'); process.exitCode=1
  } else probeCodexProfiles(resolve(process.argv[3])).then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
    .catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1})
}
