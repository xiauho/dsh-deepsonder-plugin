import type { Context } from '@deepseek-ai/cordis'

import { registerRoutes } from './host/routes.js'

export const name = 'deepsonder'

// 宿主必须提供 Web 服务器，浏览器半通过同源 fetch 访问这些路由。
export const inject = ['webServer']

export function apply(ctx: Context) {
  const webServer = (ctx as unknown as { webServer: Parameters<typeof registerRoutes>[0] }).webServer
  ctx.effect(() => registerRoutes(webServer), 'deepsonder: routes')
  console.log('[deepsonder] host plugin loaded (stage 0)')
}
