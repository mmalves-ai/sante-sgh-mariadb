// Apoio comum das portas próprias da operadora (F2.2, lote 02-10) sobre o banco do cliente pelo @sgh/nucleo: o que a
// porta usa do NucleoProprio, as conversões do banco para os tipos de negócio, o estabelecimento da sessão por id, o
// contexto de uma gravação direta da tela (chave de idempotência única por chamada) e a tradução das restrições do
// banco em recusa de negócio (sem nome de coluna nem valor).
// Melhoria: as recusas por chave única e por referência saem com o código e o campo da ficha (antes, texto do driver).
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  restricaoViolada,
} from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';

/** O que as portas próprias da operadora usam do NucleoProprio (os testes trocam). */
export interface NucleoOperadora {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** O contexto mínimo das leituras e gravações (o ContextoNucleo da sessão com o código do estabelecimento). */
export interface ContextoSessao extends ContextoNucleo {
  readonly hospital: string;
}

// ---- conversões (banco → negócio) ----

export const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
export const textoObrigatorio = (v: unknown): string => texto(v) ?? '';
export const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
export const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
const dois = (n: number) => String(n).padStart(2, '0');
/** DATE do banco em AAAA-MM-DD (o driver entrega Date à meia-noite UTC ou texto). */
export const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? null
      : `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  const t = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
/** DATETIME(3) do banco em ISO sem fuso (o processo e o pool rodam em UTC). */
export const instanteIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19);
  const t = String(v).replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T/.test(t) ? t.slice(0, 19) : null;
};
export const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
/** Trecho para LIKE com os curingas escapados (a entrada nunca vira padrão). */
export const trechoLike = (t: string): string => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
export const inicioLike = (t: string): string => `${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Cadastro básico do cliente que falta (domínio sem a linha pedida): 409 com o motivo. */
export const dominioAusente = (dominio: string, campo: string): ErroOperacao =>
  recusa('dominio-nao-cadastrado', `O cadastro de ${dominio} do cliente não tem o código informado.`, {
    campos: [campo],
  });

/** Restrição do banco → recusa de negócio pelo nome da restrição (nunca o valor). */
export type MapaRestricoes = Readonly<
  Record<string, readonly [codigo: string, detalhe: string, campo: string]>
>;

export function traduzirRestricao(e: unknown, mapa: MapaRestricoes): unknown {
  const r = restricaoViolada(e);
  if (!r?.nome) return e;
  const m = mapa[r.nome];
  return m ? recusa(m[0], m[1], { campos: [m[2]] }) : e;
}

/** O estabelecimento da sessão pelo id (ou pelo código, quando o mapa da API ainda não o tinha). */
export async function estabelecimentoDaSessao(c: ContextoSessao, l: Leitor): Promise<number | null> {
  if (c.estabelecimento !== null) return c.estabelecimento;
  if (!c.hospital) return null;
  const r = await l.uma<{ id: unknown }>(
    'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [c.hospital],
  );
  return r ? Number(r['id']) : null;
}

/** Contexto de uma gravação direta da tela (sem Idempotency-Key própria: chave única por chamada). */
export function contextoDireto(
  cliente: string,
  estabelecimento: number,
  c: ContextoSessao,
  trilha: RegistroTrilhaTela | null,
): ContextoOperacao {
  return {
    cliente,
    estabelecimento,
    usuario: trilha?.usuario ?? c.usuario,
    correlacao: (trilha?.correlacao ?? c.correlacao).slice(0, 64) || 'operadora',
    chaveIdempotencia: `direta:${randomUUID()}`,
    ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
  };
}

/** Sem o estabelecimento da sessão no banco do cliente: a gravação é recusada (falha fechada). */
export const semEstabelecimento = (): ErroOperacao =>
  recusa(
    'estabelecimento-desconhecido',
    'O estabelecimento da sessão não está cadastrado no banco do cliente.',
  );
