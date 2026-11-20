// Cópia local da digitação (ficha do M22, seção 5): o navegador guarda as respostas a cada troca de campo
// (IndexedDB), para não perder o que foi digitado se a conexão cair; o rascunho do servidor (as tabelas de rascunho
// do formulário, visível nos dois sistemas) é gravado em intervalos curtos e no "Salvar rascunho". A cópia local é
// apagada ao finalizar ou descartar. Sem IndexedDB (navegador antigo, teste), fica em memória da aba.
//
// Texto clínico no navegador: a cópia é do DONO (rede, estabelecimento e login da sessão), vai na chave e no valor,
// e só volta para ele (num terminal compartilhado, o próximo profissional não recebe a digitação do anterior; o
// paciente 123 de um estabelecimento não é o 123 de outro). Vale no máximo PRAZO_LOCAL_MS; vencida ou de outro
// dono, é apagada na leitura. Sair, a sessão expirar, trocar de estabelecimento ou entrar com outro usuário apagam
// tudo (apagarTudoLocal: o banco do navegador e a memória da aba).
import type { RespostaRegistro } from '@sgh/contratos';

export interface DonoLocal {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly login: string;
}

export interface RascunhoLocal {
  readonly paciente: number;
  readonly modelo: number;
  readonly atendimento: number | null;
  readonly dataHoraClinica: string;
  readonly justificativa: string;
  readonly respostas: readonly RespostaRegistro[];
  readonly rascunho: { readonly id: number; readonly versao: string } | null;
  readonly guardadoEm: string;
}

interface Guardado extends RascunhoLocal {
  readonly dono: DonoLocal;
}

export const BANCO_LOCAL = 'sgh-registro-clinico';
const LOJA = 'rascunhos';
/** Prazo da cópia local: 24 horas (depois disso, o rascunho do servidor é o que vale). */
export const PRAZO_LOCAL_MS = 24 * 3_600_000;
const memoria = new Map<string, Guardado>();

const mesmoDono = (a: DonoLocal, b: DonoLocal) =>
  a.rede === b.rede && a.estabelecimento === b.estabelecimento && a.login === b.login;

export function chaveLocal(
  dono: DonoLocal,
  paciente: number,
  modelo: number,
  rascunho: number | null,
): string {
  return [dono.rede, dono.estabelecimento, dono.login, paciente, modelo, rascunho ?? 'novo']
    .map((x) => encodeURIComponent(String(x)))
    .join('|');
}

function idb(): IDBFactory | null {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
}

function abrir(): Promise<IDBDatabase | null> {
  const f = idb();
  if (!f) return Promise.resolve(null);
  return new Promise((ok) => {
    try {
      const r = f.open(BANCO_LOCAL, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(LOJA)) r.result.createObjectStore(LOJA);
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

async function noBanco<T>(
  modo: IDBTransactionMode,
  fn: (l: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await abrir();
  if (!db) return null;
  return new Promise((ok) => {
    try {
      const tx = db.transaction(LOJA, modo);
      const req = fn(tx.objectStore(LOJA));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      ok(null);
    }
  });
}

export async function guardarLocal(dono: DonoLocal, chave: string, r: RascunhoLocal): Promise<void> {
  const valor = JSON.parse(JSON.stringify({ ...r, dono })) as Guardado;
  memoria.set(chave, valor);
  await noBanco('readwrite', (l) => l.put(valor, chave));
}

/** A cópia do dono, dentro do prazo; a de outro dono, vencida ou ilegível é apagada e não volta. */
export async function lerLocal(
  dono: DonoLocal,
  chave: string,
  agora: number = Date.now(),
): Promise<RascunhoLocal | null> {
  const doBanco = await noBanco<Guardado | undefined>('readonly', (l) => l.get(chave));
  const g = doBanco ?? memoria.get(chave) ?? null;
  if (!g) return null;
  const em = Date.parse(g.guardadoEm);
  if (!g.dono || !mesmoDono(g.dono, dono) || !Number.isFinite(em) || agora - em > PRAZO_LOCAL_MS) {
    await apagarLocal(chave);
    return null;
  }
  return {
    paciente: g.paciente,
    modelo: g.modelo,
    atendimento: g.atendimento,
    dataHoraClinica: g.dataHoraClinica,
    justificativa: g.justificativa,
    respostas: g.respostas,
    rascunho: g.rascunho,
    guardadoEm: g.guardadoEm,
  };
}

export async function apagarLocal(chave: string): Promise<void> {
  memoria.delete(chave);
  await noBanco('readwrite', (l) => l.delete(chave));
}

/** Apaga toda a cópia local (sair, sessão expirada, troca de estabelecimento ou de usuário). */
export async function apagarTudoLocal(): Promise<void> {
  memoria.clear();
  const f = idb();
  if (!f) return;
  await new Promise<void>((ok) => {
    try {
      const r = f.deleteDatabase(BANCO_LOCAL);
      r.onsuccess = () => ok();
      r.onerror = () => ok();
      r.onblocked = () => ok();
    } catch {
      ok();
    }
  });
}
