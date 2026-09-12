import { readFile } from 'node:fs/promises'

const http = await readFile('src/server/media-http.server.ts', 'utf8')
const store = await readFile('src/server/media.server.ts', 'utf8')
const domain = await readFile('src/domain/media.ts', 'utf8')

const forbidden = [
  'request.arrayBuffer(',
  'request.blob(',
  'request.formData(',
  'request.text(',
  'body.arrayBuffer(',
  'object.arrayBuffer(',
  'object.blob(',
]

for (const expression of forbidden) {
  if (http.includes(expression) || store.includes(expression)) {
    throw new Error(`Media boundary buffers a streamed body with ${expression}`)
  }
}

if (!http.includes('request.body') || !store.includes('.uploadPart(partNumber, body)')) {
  throw new Error('Multipart uploads are not streamed from the request into R2.')
}
if (!http.includes('new Response(object.body')) {
  throw new Error('Media downloads are not streamed from R2 into the response.')
}
if (!domain.includes('32 * 1024 * 1024')) {
  throw new Error('The reviewed 32 MiB multipart bound changed.')
}

console.log('Media routes stream bounded parts and responses without application buffering.')
