import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const fakeReact = {
  createElement: (...args) => ({ args }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
  useEffect: () => undefined,
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

globalThis.window = {
  __ModuleLoader__: {
    load: (spec) => {
      console.log('[smoke] load', spec.id)
      const plugin = spec.factory((id) => {
        if (id === 'react') return fakeReact
        throw new Error(`unknown module: ${id}`)
      })
      console.log('[smoke] plugin keys', Object.keys(plugin))
      plugin.apply({
        slots: {
          inject: (name, factory) => {
            console.log('[smoke] inject', name)
            factory()
          },
          register: (options) => {
            console.log('[smoke] register', options.name, options.key ?? options.id ?? '')
            return () => undefined
          },
        },
      })
      console.log('[smoke] apply ok')
    },
  },
  addEventListener: () => undefined,
  localStorage: { getItem: () => null, setItem: () => undefined },
  confirm: () => false,
}

globalThis.document = {
  createElement: () => ({ style: {}, appendChild: () => undefined, setAttribute: () => undefined }),
  documentElement: { style: {} },
  body: { appendChild: () => undefined },
}

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
vm.runInThisContext(code, { filename: 'lib/client.js' })
