/**
 * Proxy transparente hacia el backend NestJS.
 * El browser llama a /api/... en el mismo dominio (sin CORS).
 * Next.js reenvía server-to-server a BACKEND_URL (red interna Docker).
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

async function handler(
  request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join('/');
  const search = request.nextUrl.search;
  const url = `${BACKEND_URL}/api/${path}${search}`;

  // Reenviar headers relevantes (auth, content-type)
  const headers = new Headers();
  const forward = ['authorization', 'content-type', 'accept'];
  forward.forEach((key) => {
    const val = request.headers.get(key);
    if (val) headers.set(key, val);
  });

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Streaming del body (soporta JSON y multipart/form-data)
    init.body = request.body as BodyInit;
    // @ts-expect-error duplex es necesario para body streaming en Node 18+
    init.duplex = 'half';
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return NextResponse.json(
      { message: 'No se puede conectar con el servidor API' },
      { status: 503 },
    );
  }

  // Filtrar headers que el proxy ya maneja internamente.
  // fetch() descomprime gzip/br automáticamente, así que no reenviar
  // Content-Encoding ni Transfer-Encoding al browser (causarían doble-decode).
  const SKIP_HEADERS = new Set([
    'content-encoding',
    'transfer-encoding',
    'content-length', // el body ya fue re-codificado, el largo cambió
  ]);

  const resHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: resHeaders,
  });
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const OPTIONS = handler;
