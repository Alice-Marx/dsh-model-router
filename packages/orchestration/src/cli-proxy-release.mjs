// Pinned upstream release, not an ambient executable or a floating latest download.
// https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.77
// Source: a5e8f69e56309e1ef6d6872e667da81fdfbce2ce (MIT).
export const CLI_PROXY_VERSION = '8.0.77'
export const CLI_PROXY_RELEASE = Object.freeze({
  'win32-x64': ['windows_amd64.zip', 'b06dcf681e7628333cd0a376d96b22e29e8788a421d425736b5519c94dbb6d22', 760867403],
  'win32-arm64': ['windows_aarch64.zip', '3a681fabffaa46a26fd59ca1efbc24d19270e807d1e352b8a3acd4f0b5205bef', 760871978],
  'darwin-x64': ['darwin_amd64.tar.gz', 'cd07b96d300d9cceb0899b2a2f5471240249770f3f8f171a90445ceb3de27d6d', 760869747],
  'darwin-arm64': ['darwin_aarch64.tar.gz', '2e1f8fbf5c96e333a3f3067650c420315a220ae23465db8b3fcbc1893be40b38', 760864930],
  'linux-x64': ['linux_amd64.tar.gz', '1a7ea3f968c414ed9839facfdb1c0efe34cf3038b75b2e118db143d04de1aeb3', 760864746],
  'linux-arm64': ['linux_aarch64.tar.gz', '850a4cfb9400c7df9e04853cd0faf9be1342764dd05bb1e2617a365eb55ba62d', 760865593],
})
export function cliProxyArtifact(platform = process.platform, arch = process.arch) {
  const pinned = CLI_PROXY_RELEASE[platform + '-' + arch]
  if (!pinned) throw Object.assign(new Error('当前系统暂不支持订阅登录组件。'), { code: 'SUBSCRIPTION_PLATFORM_UNSUPPORTED' })
  const [suffix, sha256, assetId] = pinned
  const filename = `CLIProxyAPI_${CLI_PROXY_VERSION}_${suffix}`
  return { version: CLI_PROXY_VERSION, filename, sha256, binary: platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api',
    url: `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLI_PROXY_VERSION}/${filename}`,
    assetUrl: `https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/assets/${assetId}` }
}
