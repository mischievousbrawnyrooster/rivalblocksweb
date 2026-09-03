// The deathmatch instance of Blastworks: the same server, a different mode and
// port. This file exists so the npm script works on every platform — inline
// `MODE=x node ...` is a shell feature Windows does not have, and one
// environment variable is not worth a dependency to set.

process.env.MODE = 'deathmatch'
process.env.PORT = process.env.PORT || '8084'

await import('./blastworks-server.js')
