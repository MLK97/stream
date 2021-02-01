const Component = require('choo/component')
const compare = require('nanocomponent/compare')
const html = require('choo/html')
const Loader = require('@resonate/play-count-component')
const ReportProblem = require('../report-problem')
const Playlist = require('@resonate/playlist-component')
const adapter = require('@resonate/schemas/adapters/v1/track')
const nanostate = require('nanostate')
const clone = require('shallow-clone')
const renderMessage = require('../../elements/message')
const imagePlaceholder = require('@resonate/svg-image-placeholder')

/*
 * Render a list of albums as playlists
 * This component is meant to be used with data from v1 Resonate API
 */

class Albums extends Component {
  constructor (id, state, emit) {
    super(id)

    this.state = state
    this.emit = emit

    this.local = state.components[id] = Object.create({
      machine: nanostate('idle', {
        idle: { start: 'loading' },
        loading: { resolve: 'data', reject: 'error', reset: 'idle' },
        data: { reset: 'idle', start: 'loading' },
        error: { reset: 'idle', start: 'loading' }
      }),
      events: nanostate.parallel({
        loader: nanostate('off', {
          on: { toggle: 'off' },
          off: { toggle: 'on' }
        })
      })
    })

    this.local.items = []

    this.local.machine.event('notFound', nanostate('notFound', {
      notFound: { start: 'idle' }
    }))

    this.local.events.on('loader:toggle', () => {
      if (this.element) this.rerender()
    })

    this.local.machine.on('notFound', () => {
      if (this.element) this.rerender()
    })

    this.local.machine.on('error', () => {
      if (this.element) this.rerender()
    })
  }

  createElement (props) {
    const { items = [], name } = props

    this.local.name = name
    this.local.items = clone(items)

    const machine = {
      idle: () => {},
      loading: {
        off: () => {},
        on: () => {
          const loader = new Loader('loader', this.state, this.emit).render({
            count: 3,
            options: { animate: true, repeat: true, reach: 9, fps: 10 }
          })

          return html`
            <div class="flex flex-column flex-auto items-center justify-center h5">
              ${loader}
            </div>
          `
        }
      }[this.local.events.state.loader],
      data: () => {
        const cids = this.local.items.map((item, index) => `${this._name}-album-playlist-${index}`)
        for (const cid of cids) {
          this.state.cache(Playlist, cid)
          const component = this.state.components[cid]
          component.machine.emit('start')
          component.machine.emit('resolve')
        }
        return html`
          <ul class="list ma0 pa0">
            ${this.local.items.map((album, index) => {
              const cid = `${this._name}-album-playlist-${index}`
              const src = album.tracks.length ? album.tracks[0].artwork.large : ''

              return html`
                <div class="flex flex-column flex-auto mb6">
                  <article class="flex flex-column flex-row-l flex-auto">
                    <div class="flex flex-column mw5-m mw5-l mb2 w-100">
                      <div class="db aspect-ratio aspect-ratio--1x1 bg-dark-gray">
                        <span role="img" style="background:url(${src || imagePlaceholder(400, 400)}) no-repeat;" class="bg-center cover aspect-ratio--object z-1">
                        </span>
                      </div>
                    </div>
                    <div class="flex flex-column flex-auto pt3-l pl5-l">
                      <header>
                        <div class="flex flex-column">
                          <h3 class="ma0 lh-title f3 fw4 normal">${album.name}</h3>
                          <div>
                            ${!album.various
                              ? html`<a href="/artist/${album.uid}" class="link dark-gray">${album.artist}</a>`
                              : html`<span>${album.artist}</span>`}
                          </div>
                        </div>
                      </header>
                      ${this.state.cache(Playlist, cid).render({
                        type: 'album',
                        various: album.various,
                        playlist: album.tracks.length ? album.tracks.map(adapter) : []
                      })}
                    </div>
                  </article>
                  <div class="flex flex-auto justify-end mr3-l mr5-l">
                    ${this.state.cache(ReportProblem, `report-problem-${cid}`).render({
                      context: {
                        type: 'release',
                        title: album.name,
                        artist: album.artist
                      }
                    })}
                  </div>
                </div>
              `
            })}
          </ul>
        `
      },
      notFound: () => renderMessage({ message: `${name} has yet to upload music on Resonate.` }),
      error: () => renderMessage({ message: 'Failed to fetch albums' })
    }[this.local.machine.state]

    return html`
      <div class="flex flex-column flex-auto w-100">
        ${machine()}
      </div>
    `
  }

  update (props) {
    return compare(this.local.items, props.items) ||
      this.local.name !== props.name
  }
}

module.exports = Albums
