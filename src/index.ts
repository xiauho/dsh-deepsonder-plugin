import type { Context } from '@deepseek-ai/cordis'

import type { FileSystemPort } from './domain/fs-port.js'
import { ProjectManager } from './host/project-manager.js'
import { registerRoutes } from './host/routes.js'

export const name = 'deepsonder'

// webServer 提供同源 JSON API；fs 是 DSH 的沙箱/权限感知文件系统。
export const inject = ['webServer', 'fs']

export function apply(ctx: Context) {
  const webServer = (ctx as unknown as { webServer: Parameters<typeof registerRoutes>[0] }).webServer
  const fs = (ctx as unknown as { fs: FileSystemPort }).fs
  const manager = new ProjectManager(fs)

  ctx.effect(() => {
    const disposeRoutes = registerRoutes(webServer, manager)
    return () => {
      void manager.close()
      disposeRoutes()
    }
  }, 'deepsonder: routes')

  console.log('[deepsonder] host plugin loaded (phase 1)')
}
