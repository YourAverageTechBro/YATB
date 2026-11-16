export type R2PresignInput = Readonly<{
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  key: string
  method: 'PUT' | 'GET'
  contentType?: string
  expiresInSeconds: number
  now?: Date
}>

export async function presignR2Url(input: R2PresignInput): Promise<string> {
  const url = new URL(`${input.endpoint.replace(/\/$/, '')}/${input.bucket}/${input.key}`)
  const now = input.now ?? new Date()
  const amzDate = compactDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const signedHeaders = input.contentType ? 'content-type;host' : 'host'
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${input.accessKeyId}/${credentialScope}`)
  url.searchParams.set('X-Amz-Date', amzDate)
  url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds))
  url.searchParams.set('X-Amz-SignedHeaders', signedHeaders)
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join('&')
  const canonicalHeaders = input.contentType
    ? `content-type:${input.contentType}\nhost:${url.host}\n`
    : `host:${url.host}\n`
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hex(await sha256(canonicalRequest)),
  ].join('\n')
  const signingKey = await hmac(
    await hmac(
      await hmac(
        await hmac(new TextEncoder().encode(`AWS4${input.secretAccessKey}`), dateStamp),
        'auto',
      ),
      's3',
    ),
    'aws4_request',
  )
  url.searchParams.set('X-Amz-Signature', hex(await hmac(signingKey, stringToSign)))
  return url.toString()
}

function compactDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)))
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
