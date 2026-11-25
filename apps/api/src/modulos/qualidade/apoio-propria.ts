// Apoio comum das portas próprias da qualidade (M48) sobre o MariaDB do cliente, pelo @sgh/nucleo: o núcleo mínimo, a
// leitura no estabelecimento da sessão, o relógio no fuso do estabelecimento, as conversões de vocabulário (o contrato
// em camelCase, o banco em snake_case), a conta pelo login e a recusa do que o modelo ainda não cobre.
// Melhoria: o relógio é o do fuso do estabelecimento (estabelecimento.fuso_horario), não o do servidor do banco.
// Melhoria: o que o modelo próprio ainda não cobre recusa com `modelo-pendente` (409), sem gravar nada pela metade; a
// LEITURA do que ainda não tem mapeamento falha fechada (503 `modelo-pendente`), nunca vazio ou zero como se fosse dado.
// Melhoria: os feriados dos prazos casam a UF e o município do endereço do estabelecimento (nada de feriado estadual ou
// municipal de outro lugar) e não contam o ponto facultativo (o prazo regulatório corre nele: só o feriado o suspende).
import { ErroOperacao, type Leitor, type NucleoProprio, recusa, type TxOperacao } from '@sgh/nucleo';
import { lerFeriadosDoPeriodo } from '../agenda/dias-sem-expediente-leitor.js';
import type { ContextoPortaM18, LiberacaoGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';

/** O mínimo do núcleo que as portas da qualidade usam. */
export type NucleoQualidade = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export type Linha = Record<string, unknown>;
export type L = Pick<Leitor, 'consultar' | 'uma'>;

export const n = (v: unknown): number => Number(v ?? 0);
export const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const textoN = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
export const verdadeiro = (v: unknown): boolean => v === true || v === 1 || v === '1';
const doisDigitos = (x: number) => String(x).padStart(2, '0');

/** Instante do banco (DATETIME, lido como Date local do servidor de aplicação) no formato `AAAA-MM-DDTHH:mm:ss`. */
export function instante(v: unknown): string {
  if (v instanceof Date)
    return `${v.getFullYear()}-${doisDigitos(v.getMonth() + 1)}-${doisDigitos(v.getDate())}T${doisDigitos(
      v.getHours(),
    )}:${doisDigitos(v.getMinutes())}:${doisDigitos(v.getSeconds())}`;
  return String(v ?? '')
    .replace(' ', 'T')
    .slice(0, 19);
}
export const instanteN = (v: unknown): string | null => (v === null || v === undefined ? null : instante(v));
export function dataIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return instante(v).slice(0, 10);
}
/** O instante local da tela (`AAAA-MM-DDTHH:mm[:ss]`) para o DATETIME do banco. */
export const paraBanco = (v: string): string => v.replace('T', ' ').slice(0, 19);

/** "emAnalise" → "em_analise" (o vocabulário do contrato para o do banco). */
export const cobra = (v: string): string => v.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
/** "em_analise" → "emAnalise" (o vocabulário do banco para o do contrato). */
export const camelo = (v: unknown): string =>
  texto(v).replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

export const marcas = (k: number): string => Array.from({ length: k }, () => '?').join(', ');

/** O JSON gravado (coluna JSON do MariaDB, lida como texto ou objeto). */
export function json<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined) return padrao;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
}

export function estabelecimentoDaSessao(c: ContextoPortaM18): number {
  if (c.estabelecimento === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return c.estabelecimento;
}

/** Lê no banco do cliente, com o estabelecimento da sessão (somente leitura). */
export function lerNoEstabelecimento<T>(
  nucleo: NucleoQualidade,
  c: ContextoPortaM18,
  fn: (l: Leitor, est: number) => Promise<T>,
): Promise<T> {
  let est: number;
  try {
    est = estabelecimentoDaSessao(c);
  } catch (e) {
    return Promise.reject(e);
  }
  return nucleo.lerSomente({ cliente: c.cliente, correlacao: c.correlacao || 'qualidade' }, (l) =>
    fn(l, est),
  );
}

/** O instante local do estabelecimento (`AAAA-MM-DDTHH:mm:ss`), pelo fuso do cadastro. */
export async function relogioDoEstabelecimento(l: L, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  const fuso = r?.fuso_horario || FUSO_PADRAO;
  const rel = relogioNoFuso(fuso);
  const segundos = doisDigitos(new Date().getSeconds());
  return `${rel.hoje}T${rel.hora}:${segundos}`;
}

/** Os setores funcionais ativos do estabelecimento (a unidade onde o incidente ou a observação aconteceu). */
export async function setoresDoEstabelecimento(
  l: L,
  est: number,
): Promise<{ codigo: number; nome: string }[]> {
  const linhas = await l.consultar(
    `SELECT id, nome FROM setor_funcional
      WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
      ORDER BY nome, id`,
    [est],
    { teto: 1000 },
  );
  return linhas.map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) }));
}

/**
 * Os feriados do período que valem no estabelecimento: os nacionais, os estaduais da UF do município do endereço, os
 * municipais desse município e os do próprio estabelecimento (o calendário único do cliente; ativos e não excluídos). O ponto
 * facultativo fica de fora por decisão explícita: o prazo regulatório e o de análise correm nele (não é feriado legal).
 * Sem município no endereço, valem só os nacionais e os do estabelecimento.
 */
export async function feriadosDoEstabelecimento(
  l: L,
  est: number,
  de: string,
  ate: string,
): Promise<{ data: string; nome: string }[]> {
  return lerFeriadosDoPeriodo(l, est, de, ate);
}

/** O id da conta pelo login (ativa ou não; null: não existe). */
export async function usuarioPeloLogin(l: L, login: string | null | undefined): Promise<number | null> {
  if (!login) return null;
  const r = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
    login.trim(),
  ]);
  return r ? Number(r.id) : null;
}

/** O id da conta pelo login, ou recusa (a gravação não guarda login solto). */
export async function exigirUsuario(tx: TxOperacao, login: string): Promise<number> {
  const id = await usuarioPeloLogin(tx, login);
  if (id === null) throw recusa('usuario-inexistente', 'A conta informada não existe neste cliente.');
  return id;
}

/** O que o modelo próprio ainda não cobre (pedido ao orquestrador): nada é lido nem gravado pela metade. */
export function modeloPendente(o: string): ErroOperacao {
  return new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda o mapeamento para o modelo próprio do banco: por enquanto fica em consulta, sem gravar.`,
  );
}

/** A liberação de uma porta que ainda não grava no modelo próprio (a tela fica em consulta, com o motivo). */
export function liberacaoPendente(o: string): LiberacaoGravacao {
  return { pode: false, codigo: 'modelo-pendente', motivo: modeloPendente(o).problema.detail ?? null };
}

/**
 * A LEITURA do que ainda aguarda o mapeamento: falha fechada (503 `modelo-pendente`), para a tela mostrar "indisponível"
 * e nunca "nenhum registro" ou zero como se fosse o dado do hospital.
 */
export function leituraPendente(o: string): ErroOperacao {
  return new ErroOperacao(
    503,
    'modelo-pendente',
    'Consulta aguardando o modelo do banco',
    `${o} aguarda o mapeamento para o modelo próprio do banco: a consulta está indisponível (não é "nenhum registro").`,
  );
}

/** A leitura falhou por aguardar o mapeamento (`leituraPendente`)? */
export function ehLeituraPendente(e: unknown): boolean {
  return e instanceof ErroOperacao && e.problema.codigo === 'modelo-pendente';
}
