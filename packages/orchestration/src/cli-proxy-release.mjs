// Pinned upstream release, not an ambient executable or a floating latest download.
// https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.72
// Source: e96d4c4818851cf0e96d27b2bc8b67379e449d9e (MIT).
export const CLI_PROXY_VERSION = '8.0.72'
export const CLI_PROXY_RELEASE = Object.freeze({
  'win32-x64': ['windows_amd64.zip', '9c98651a4a35e05fd87193bf722710f32ff87d13ff8b7177d0cfd200f4b51749'],
  'win32-arm64': ['windows_aarch64.zip', '07666c498620f3f2825c30e9ff1b1b3b10abe6d00a998c9f8b59d437ed9bf225'],
  'darwin-x64': ['darwin_amd64.tar.gz', '27591f4c829cd3a2ce9daed541328103f6439841d25aefca82207d79126a90af'],
  'darwin-arm64': ['darwin_aarch64.tar.gz', 'ae008afd4ad52603f220200afc6417102591ba0a847d128cb65e904f86ac7918'],
  'linux-x64': ['linux_amd64.tar.gz', 'ce8e57a10e081c1deff48e214ca1932b0c2df51ab35d3628f6a1638c4be90ff7'],
  'linux-arm64': ['linux_aarch64.tar.gz', '51a001340f5bea352f935f97f5d2477a06a8349a4fa396d6f6923cef25573b5f'],
})
export function cliProxyArtifact(platform = process.platform, arch = process.arch) {
  const pinned = CLI_PROXY_RELEASE[platform + '-' + arch]
  if (!pinned) throw Object.assign(new Error('当前系统暂不支持订阅登录组件。'), { code: 'SUBSCRIPTION_PLATFORM_UNSUPPORTED' })
  const filename = `CLIProxyAPI_${CLI_PROXY_VERSION}_${pinned[0]}`
  return { version: CLI_PROXY_VERSION, filename, sha256: pinned[1], binary: platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api',
    url: `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLI_PROXY_VERSION}/${filename}` }
}
