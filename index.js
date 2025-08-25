'use strict'

/**
 * static files (404.html, sw.js, conf.js)
 */
const ASSET_URL = 'https://kiko923.github.io/ghweb/'
// 前缀，如果自定义路由为 example.com/gh/*，将 PREFIX 改为 '/gh/'（前后斜杠都要对）
const PREFIX = '/'
// 分支文件使用 jsDelivr 镜像的开关：0=源站，1=jsDelivr
const Config = { jsdelivr: 0 }

// 白名单：路径中包含以下任意子串才放行；为空表示放行全部
const whiteList = []

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  }),
}

// 匹配规则
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

function makeRes(body, status = 200, headers = {}) {
  headers['access-control-allow-origin'] = '*'
  return new Response(body, { status, headers })
}

function newUrl(urlStr) {
  try { return new URL(urlStr) } catch { return null }
}

addEventListener('fetch', (e) => {
  const ret = fetchHandler(e).catch((err) => makeRes('cfworker error:\n' + err.stack, 502))
  e.respondWith(ret)
})

function checkUrl(u) {
  for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
    if (u.search(i) === 0) return true
  }
  return false
}

/**
 * @param {FetchEvent} e
 */
async function fetchHandler(e) {
  const req = e.request
  const urlStr = req.url
  const urlObj = new URL(urlStr)

  // 支持 ?q=xxx 快捷重定向
  let path = urlObj.searchParams.get('q')
  if (path) return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)

  // cfworker 会把路径中的 `//` 合并成 `/`，这里恢复为绝对 URL 解析
  path = urlObj.href.substr(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

  if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0) {
    return httpHandler(req, path)
  } else if (path.search(exp2) === 0) {
    if (Config.jsdelivr) {
      const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
      return Response.redirect(newUrl, 302)
    } else {
      path = path.replace('/blob/', '/raw/')
      return httpHandler(req, path)
    }
  } else if (path.search(exp4) === 0) {
    if (Config.jsdelivr) {
      const newUrl = path
        .replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1')
        .replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
      return Response.redirect(newUrl, 302)
    } else {
      return httpHandler(req, path)
    }
  } else {
    return fetch(ASSET_URL + path)
  }
}

/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
  const reqHdrRaw = req.headers

  // 预检
  if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
    return new Response(null, PREFLIGHT_INIT)
  }

  const reqHdrNew = new Headers(reqHdrRaw)

  // 白名单检查
  let urlStr = pathname
  let flag = !Boolean(whiteList.length)
  for (let i of whiteList) {
    if (urlStr.includes(i)) { flag = true; break }
  }
  if (!flag) return new Response('blocked', { status: 403 })

  if (urlStr.search(/^https?:\/\//) !== 0) urlStr = 'https://' + urlStr

  // 解析并规范化路径（压缩多重斜杠）
  let urlObj = newUrl(urlStr)
  if (!urlObj) return makeRes('Bad URL', 400)
  urlObj = new URL(urlObj.href)
  urlObj.pathname = urlObj.pathname.replace(/\/{2,}/g, '/')

  /** @type {RequestInit} */
  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: 'manual',
    body: req.body,
  }
  return proxy(urlObj, reqInit)
}

/**
 * 代理上游，并处理相对重定向
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
  if (!urlObj) return makeRes('Bad upstream url', 502)

  const res = await fetch(urlObj.href, reqInit)
  const resHdrOld = res.headers
  const resHdrNew = new Headers(resHdrOld)
  const status = res.status

  // 处理 Location（支持相对地址）
  if (resHdrNew.has('location')) {
    const rawLoc = resHdrNew.get('location') || ''
    let absLoc
    try {
      absLoc = new URL(rawLoc, urlObj)
    } catch {
      return makeRes('Bad redirect location', 502)
    }

    if (checkUrl(absLoc.href)) {
      resHdrNew.set('location', PREFIX + absLoc.href)
    } else {
      reqInit.redirect = 'follow'
      return proxy(absLoc, reqInit)
    }
  }

  resHdrNew.set('access-control-expose-headers', '*')
  resHdrNew.set('access-control-allow-origin', '*')
  resHdrNew.delete('content-security-policy')
  resHdrNew.delete('content-security-policy-report-only')
  resHdrNew.delete('clear-site-data')

  return new Response(res.body, { status, headers: resHdrNew })
}
