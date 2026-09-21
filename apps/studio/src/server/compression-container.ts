import { Container } from '@cloudflare/containers'

export class CompressionContainer extends Container<Cloudflare.Env> {
  defaultPort = 8080
  sleepAfter = '5m'
  enableInternet = false
}

