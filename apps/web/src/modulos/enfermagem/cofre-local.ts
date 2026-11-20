// Cache cifrado da beira do leito (ficha do M25, seção 4; cap-09 §9.7): sem rede, o tablet mostra os horários lidos
// por último e guarda, na ordem, os atos permitidos sem rede (checagem, sinal vital e anotação simples) até a
// sincronização. Tudo fica cifrado (AES-GCM, chave do aparelho que não sai do navegador: não exportável, guardada
// no banco do navegador) e é do DONO (rede, estabelecimento e login da sessão): outro profissional no mesmo aparelho
// não lê nada. Cada registro vale no máximo o prazo do cache do tablet (parâmetro da unidade); vencido, é apagado na
// leitura. Sair, a sessão expirar ou trocar de estabelecimento apagam tudo (apagarCofreLocal).
// Sem banco do navegador ou sem cifra (navegador antigo, página fora de contexto seguro, teste), fica só na memória
// da aba: nada em texto claro vai ao banco do navegador, e registro persistido sem cifra é descartado na leitura.

export interface DonoCofre {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly login: string;
}

interface Registro {
  readonly dono: string;
  readonly chave: string;
  readonly guardadoEm: number;
  readonly iv?: Uint8Array;
  readonly dados: ArrayBuffer | string;
}

export const BANCO_COFRE = 'sgh-beira-leito';
const LOJA = 'cofre';
const LOJA_CHAVE = 'chave';
const memoria = new Map<string, Registro>();
let chaveMemoria: CryptoKey | null = null;

export function idDono(d: DonoCofre): string {
  return [d.rede, d.estabelecimento, d.login].map((x) => encodeURIComponent(x)).join('|');
}

function idb(): IDBFactory | null {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
}
function sutil(): SubtleCrypto | null {
  return (globalThis.crypto as Crypto | undefined)?.subtle ?? null;
}

function abrir(): Promise<IDBDatabase | null> {
  const f = idb();
  if (!f) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const r = f.open(BANCO_COFRE, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(LOJA);
        r.result.createObjectStore(LOJA_CHAVE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function pedido<T>(
  db: IDBDatabase,
  loja: string,
  modo: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(loja, modo);
      const r = f(t.objectStore(loja));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** A chave do aparelho (não exportável): nasce na primeira vez e fica no banco do navegador. */
async function chaveDoAparelho(db: IDBDatabase | null): Promise<CryptoKey | null> {
  const s = sutil();
  if (!s) return null;
  if (db) {
    const lida = await pedido<CryptoKey>(
      db,
      LOJA_CHAVE,
      'readonly',
      (x) => x.get('aes') as IDBRequest<CryptoKey>,
    );
    if (lida) return lida;
  } else if (chaveMemoria) return chaveMemoria;
  try {
    const nova = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    if (db) await pedido(db, LOJA_CHAVE, 'readwrite', (x) => x.put(nova, 'aes'));
    else chaveMemoria = nova;
    return nova;
  } catch {
    return null;
  }
}

async function cifrar(k: CryptoKey | null, valor: unknown): Promise<Pick<Registro, 'iv' | 'dados'>> {
  const texto = JSON.stringify(valor);
  const s = sutil();
  if (!k || !s) return { dados: texto };
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const dados = await s.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(texto));
  return { iv, dados };
}

async function decifrar<T>(k: CryptoKey | null, r: Registro): Promise<T | null> {
  try {
    if (typeof r.dados === 'string') return JSON.parse(r.dados) as T;
    const s = sutil();
    if (!k || !s || !r.iv) return null;
    const claro = await s.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource }, k, r.dados);
    return JSON.parse(new TextDecoder().decode(claro)) as T;
  } catch {
    return null;
  }
}

/** Só registro cifrado (AES-GCM com IV) pode ir ao banco do navegador. */
const cifrado = (r: Registro) => typeof r.dados !== 'string' && !!r.iv;

const chaveDe = (dono: DonoCofre, chave: string) => `${idDono(dono)}#${chave}`;

/** Guarda um valor cifrado do dono. */
export async function guardar(
  dono: DonoCofre,
  chave: string,
  valor: unknown,
  agora = Date.now(),
): Promise<void> {
  const db = await abrir();
  const k = await chaveDoAparelho(db);
  const r: Registro = {
    dono: idDono(dono),
    chave,
    guardadoEm: agora,
    ...(await cifrar(db ? k : null, valor)),
  };
  if (db && cifrado(r)) {
    const ok = await pedido(db, LOJA, 'readwrite', (x) => x.put(r, chaveDe(dono, chave)));
    db.close();
    if (ok !== null) return;
  } else db?.close();
  memoria.set(chaveDe(dono, chave), r);
}

/** Lê um valor do dono; vencido (prazo em horas), é apagado e volta nulo. */
export async function lerGuardado<T>(
  dono: DonoCofre,
  chave: string,
  prazoHoras: number,
  agora = Date.now(),
): Promise<T | null> {
  const id = chaveDe(dono, chave);
  const db = await abrir();
  let persistido = db
    ? await pedido<Registro>(db, LOJA, 'readonly', (x) => x.get(id) as IDBRequest<Registro>)
    : null;
  if (db && persistido && !cifrado(persistido)) {
    await pedido(db, LOJA, 'readwrite', (x) => x.delete(id));
    persistido = null;
  }
  const r = persistido ?? memoria.get(id) ?? null;
  if (!r) {
    db?.close();
    return null;
  }
  if (r.dono !== idDono(dono) || agora - r.guardadoEm > prazoHoras * 3_600_000) {
    if (db) await pedido(db, LOJA, 'readwrite', (x) => x.delete(id));
    memoria.delete(id);
    db?.close();
    return null;
  }
  const k = typeof r.dados === 'string' ? null : await chaveDoAparelho(db);
  db?.close();
  return decifrar<T>(k, r);
}

export async function apagarGuardado(dono: DonoCofre, chave: string): Promise<void> {
  const id = chaveDe(dono, chave);
  memoria.delete(id);
  const db = await abrir();
  if (db) {
    await pedido(db, LOJA, 'readwrite', (x) => x.delete(id));
    db.close();
  }
}

/** Sair, a sessão expirar ou trocar de estabelecimento: nada da beira do leito fica no aparelho. */
export async function apagarCofreLocal(): Promise<void> {
  memoria.clear();
  chaveMemoria = null;
  const db = await abrir();
  if (db) {
    await pedido(db, LOJA, 'readwrite', (x) => x.clear());
    await pedido(db, LOJA_CHAVE, 'readwrite', (x) => x.clear());
    db.close();
  }
}
