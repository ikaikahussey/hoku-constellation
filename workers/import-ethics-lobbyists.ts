import { runWorker } from './import'

runWorker('ethics_lobbyists').then(() => process.exit(0)).catch(() => process.exit(1))
