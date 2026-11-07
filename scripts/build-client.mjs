import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

const result = await build({
  entryPoints: [path.join(root, 'src/client/index.ts')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  sourcemap: false,
  logLevel: 'info',
})

const code = result.outputFiles[0].text

// DSH 的浏览器半只认 __ModuleLoader__.load({ id, factory }) 形态。
// esbuild 先产出 CommonJS，再整体包进 factory，React 由宿主的 require 提供。
const banner = `console.log('[deepsonder] client bundle evaluated');
window.__ModuleLoader__.load({
  id: 'dsh-deepsonder-plugin',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    try {
      console.log('[deepsonder] client factory invoked');
`
const footer = `
    return module.exports.default(require);
    } catch (error) {
      console.error('[deepsonder] client factory failed', error);
      throw error;
    }
  },
});
`

await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(path.join(root, 'lib/client.js'), banner + code + footer, 'utf8')
console.log('[deepsonder] client bundle written to lib/client.js')
