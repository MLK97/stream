const setTitle = require('../lib/title')
const isUrl = require('validator/lib/isURL')
const generateApi = require('../lib/api')
const adapter = require('@resonate/schemas/adapters/v1/track')
const cookies = require('browser-cookies')

/**
 * Logging
 */

const logger = require('nanologger')
const log = logger('stream2own')

const Playlist = require('@resonate/playlist-component')

function app () {
  return (state, emitter) => {
    Object.assign(state, {
      title: 'Resonate',
      resolved: false,
      api: generateApi(),
      apiv2: generateApi({
        version: 2
      }),
      library: {
        items: []
      },
      user: {},
      tracks: [],
      albums: [],
      notification: {
        permission: false
      },
      messages: []
    }) // initialize state

    function setMeta () {
      const title = {
        '/': 'Resonate',
        discovery: 'Discovery',
        faq: 'FAQ',
        login: 'Login',
        search: state.query.q ? state.query.q + ' • ' + 'Search' : 'Search',
        settings: 'Settings',
        'u/:id': 'Profile',
        'u/:id/library/:type': {
          favorites: 'Favorites',
          collection: 'Collection',
          history: 'History'
        }[state.params.type]
      }[state.route]

      if (!title) return

      state.shortTitle = title

      emitter.emit('meta', {
        title: setTitle(title),
        'twitter:card': 'summary_large_image',
        'twitter:title': setTitle(title),
        'twitter:site': '@resonatecoop'
      })
    }

    emitter.on('navigate:back', () => {
      return window.history.go(-1)
    })

    emitter.on('error', (err) => {
      log.error(err)
    })

    emitter.on('tracks:clear', () => {
      state.tracks = []
      emitter.emit(state.events.RENDER)
    })

    emitter.on('route:/', () => {})

    emitter.on('route:browse', () => {
      return emitter.emit('redirect', { dest: '/artists' })
    })

    emitter.on('route:u/:id/library/history', library)
    emitter.on('route:u/:id/library/:type', library)

    async function library () {
      if (!state.user.uid) {
        state.redirect = state.href
        return emitter.emit('redirect', { dest: '/login', message: 'You are not logged in…' })
      }

      const type = state.params.type || 'history'

      state.cache(Playlist, `playlist-${type}`)

      const { machine, events } = state.components[`playlist-${type}`]

      if (machine.state.request === 'loading') {
        return
      }

      state.library.items = []
      state.library.numberOfPages = 0

      emitter.emit(state.events.RENDER)

      const loaderTimeout = setTimeout(() => {
        events.emit('loader:on')
      }, 600)

      machine.emit('start')

      try {
        const pageNumber = state.query.page ? Number(state.query.page) : 1
        const request = state.api.users.tracks[type]

        if (typeof request !== 'function') {
          return emitter.emit(state.events.PUSHSTATE, '/')
        }

        const response = await request({
          uid: state.user.uid,
          limit: 50,
          page: pageNumber - 1
        })

        if (response.data) {
          state.library.items = response.data.map(adapter)
          state.library.numberOfPages = response.numberOfPages

          machine.emit('resolve')

          if (!state.tracks.length) {
            state.tracks = state.library.items
          }
        } else {
          machine.emit('404')
        }
      } catch (err) {
        machine.emit('reject')
        log.error(err)
      } finally {
        events.state.loader === 'on' && events.emit('loader:off')
        clearTimeout(loaderTimeout)
        emitter.emit(state.events.RENDER)
      }
    }

    emitter.on('refresh', () => {
      emitter.emit(`route:${state.route}`, false)
    })

    emitter.on('route:login', async () => {
      if (state.api.token || state.user.uid) {
        emitter.emit('redirect', { dest: '/', message: 'You are already logged in' })
      }
    })

    emitter.on('VISIBILITYCHANGE', (vis) => {
      if (vis === 'VISIBLE') {
        emitter.emit('auth', { reload: false })
        emitter.emit('update')
      }
    })

    emitter.on('auth', async (props = {}) => {
      const { reload = true, token, clientId, user } = props

      if (token && clientId && user) {
        state.api = generateApi({ token, clientId })
        state.apiv2 = generateApi({ token, clientId, version: 2 })
        state.clientId = clientId
        state.user = user
      }

      try {
        const payload = token ? { access_token: token } : {}
        const response = await state.api.auth.tokens(payload)

        if (response.status === 'ok' && response.data) {
          // ok
          const { accessToken: token, clientId, user } = response.data

          state.user = user
          state.clientId = clientId

          state.api = generateApi({ token, clientId })
          state.apiv2 = generateApi({ token, clientId, version: 2 })
          cookies.set('redirect_discovery', '1', { expires: 365 })
        } else if (response.status === 401) {
          // 401 unauthorized access
          emitter.emit('logout')
        } else {
          // Unhandled
          log.error('Unhandled response status')
        }
      } catch (err) {
        log.error(err)
      } finally {
        if (reload) emitter.emit('api:ok')
        emitter.emit(state.events.RENDER)
      }
    })

    emitter.on('logout', async (redirect = false) => {
      state.user = {}
      delete state.clientId
      cookies.erase('redirect_discovery')
      state.api = generateApi()
      state.apiv2 = generateApi({ version: 2 })

      try {
        await state.api.auth.logout()

        if (redirect) {
          emitter.emit('redirect', {
            dest: '/login',
            message: 'You are now logged out…'
          })
        }
      } catch (err) {
        emitter.emit('error', err)
      }
    })

    emitter.on(state.events.DOMCONTENTLOADED, () => {
      emitter.emit('auth')

      if (!navigator.onLine) {
        emitter.emit('notify', { message: 'Your browser is offline' })
      }

      setMeta()

      emitter.emit('update')

      emitter.on('OFFLINE', () => {
        emitter.emit('notify', { message: 'Your browser is offline' })
      })

      emitter.on('api:ok', () => {
        state.resolved = true
        emitter.emit(state.events.RENDER)
        log.info('api ok')
        emitter.emit(`route:${state.route}`)
      })
    })

    emitter.on(state.events.NAVIGATE, () => {
      setTimeout(() => window.scrollTo(0, 0), 0)
      setMeta()
      emitter.emit(`route:${state.route}`)

      const { machine } = state.components['player-footer']

      if (machine.state.fullscreen === 'on') {
        machine.emit('fullscreen:toggle')
      }
    })

    emitter.on('credits:set', async (credits) => {
      state.credits = credits
      window.localStorage.setItem('credits', credits)

      emitter.emit('notify', {
        timeout: 3000,
        message: 'You credits have been topped up'
      })

      emitter.emit(state.events.RENDER)
    })

    emitter.on('redirect', (props = {}) => {
      const {
        dest = '/',
        timeout = 3000,
        update = false,
        message = 'Redirecting...',
        silent = false
      } = props

      if (message && !silent) {
        emitter.emit('notify', { timeout, message })
      }

      if (isUrl(dest)) {
        return setTimeout(() => {
          window.location = dest
        }, timeout)
      }

      emitter.emit(state.events.REPLACESTATE, dest)

      if (update) {
        emitter.emit('update')
      }
    })
  }
}

module.exports = app
