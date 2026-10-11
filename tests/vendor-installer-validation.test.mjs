import test from 'node:test'
import assert from 'node:assert/strict'
import { officialMiniMaxInstaller, verifiedVendorScript, miniMaxFallbackPlan } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

// The vendor starts its Windows script with PowerShell comment-based help.
const powershell = `<#
.SYNOPSIS
  Zero-dependency MiniMax Code CLI installer for Windows PowerShell 5.1+.
#>
$PackageName = '@minimax-ai/code'
$InstallDir = $env:MCODE_INSTALL_DIR
`

test('MiniMax Windows help comments are accepted while HTML is still rejected', () => {
  assert.equal(officialMiniMaxInstaller(Buffer.from(powershell)), powershell)
  assert.equal(officialMiniMaxInstaller(Buffer.from(`\uFEFF${powershell}`)), powershell)
  assert.equal(officialMiniMaxInstaller(Buffer.from(`\uFEFF${powershell}`, 'utf16le')), powershell)
  for (const html of ['<html>@minimax-ai/code</html>', '<!DOCTYPE html><p>@minimax-ai/code</p>',
    '<!-- error --><html>@minimax-ai/code</html>']) {
    assert.throws(() => officialMiniMaxInstaller(Buffer.from(html)), /已拒绝执行/)
  }
  assert.throws(() => officialMiniMaxInstaller(Buffer.from('<# unrelated script #>\nWrite-Host hi')), /已拒绝执行/)
})

test('shared vendor validation accepts PowerShell help and rejects substituted pages', () => {
  const markers = { mustInclude: ['@minimax-ai/code', 'MCODE_INSTALL_DIR'] }
  assert.equal(verifiedVendorScript(Buffer.from(powershell), markers), powershell)
  assert.throws(() => verifiedVendorScript(Buffer.from('<html>@minimax-ai/code MCODE_INSTALL_DIR</html>'), markers), /HTML/)
  assert.throws(() => verifiedVendorScript(Buffer.from('<# some other program #>'), markers), /缺少/)
})

test('MiniMax legacy update keeps the discovered native root and immutable source choices', () => {
  const preferences = { registry: 'https://registry.npmjs.org/', methods: {}, scriptUrls: {}, allowScriptInstall: true }
  const found = miniMaxFallbackPlan(preferences, { installed: true, installDir: 'D:/Tools/MiniMax' }, 'C:/npm', { platform: 'win32', home: 'C:/User' })
  assert.equal(found.plan.installDir, 'D:/Tools/MiniMax')
  assert.equal(found.plan.binDir, 'D:/Tools/MiniMax')
  assert.equal(found.plan.env.MCODE_INSTALL_DIR, 'D:/Tools/MiniMax')
  assert.deepEqual(preferences.methods, {})
  assert.equal(found.executionPreferences.methods['minimax-code'], 'script-powershell')
  const first = miniMaxFallbackPlan(preferences, { installed: false, installDir: 'D:/Missing' }, 'C:/npm', { platform: 'win32', home: 'C:/User' })
  assert.match(first.plan.installDir, /C:[\\/]User[\\/]\.minimax-code$/)
  assert.throws(() => miniMaxFallbackPlan({ ...preferences, allowScriptInstall: false }, null, 'C:/npm', { platform: 'win32' }), /关闭/)
})
