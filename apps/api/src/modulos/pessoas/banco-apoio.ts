// Apoio comum das portas próprias da gestão de pessoas sobre o banco do cliente (@sgh/nucleo): conversão de linhas,
// relógio no fuso do estabelecimento, instantes locais <-> UTC, a trilha das correções e a saída de integração.
// Melhoria: o relógio e os instantes seguem o fuso do estabelecimento (estabelecimento.fuso_horario), não o do servidor.
import {
  type Carimbo,
  type ContextoNucleo,
  ErroOperacao,
  type Escritor,
  gravarOutbox,
  gravarTrilha,
  type Leitor,
  recusa,
} from '@sgh/nucleo';
import type { CifraCpf } from './cifra-cpf.js';
import type { CorrecaoRegistrada } from './tipos-pessoas.js';

export type Linha = Record<string, unknown>;
/** O que a porta usa da cifra do CPF (o CPF fica em claro no modelo; a tela só vê o HMAC e o cifrado). */
export type CifraDoCpf = Pick<CifraCpf, 'hmac' | 'cifrar' | 'decifrar'>;

export const n = (v: unknown) => Number(v ?? 0);
export const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
export const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
export const marcadores = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATE do banco → "AAAA-MM-DD". */
export const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** DATETIME do banco (UTC) → Date. */
export const instante = (v: unknown): Date | null =>
  v instanceof Date ? v : v ? new Date(`${String(v).replace(' ', 'T')}Z`) : null;
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Instante no horário local do fuso: "AAAA-MM-DDTHH:MM". */
export function localNoFuso(d: Date, fuso: string = FUSO_PADRAO): string {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return f.format(d).replace(' ', 'T');
}

/** "AAAA-MM-DDTHH:MM" local do fuso → instante UTC. */
export function utcDoLocal(local: string, fuso: string = FUSO_PADRAO): Date {
  const alvo = Date.parse(`${local.slice(0, 16)}:00Z`);
  let t = alvo;
  for (let i = 0; i < 2; i++) t += alvo - Date.parse(`${localNoFuso(new Date(t), fuso)}:00Z`);
  return new Date(t);
}

/** Deslocamento "±HHMM" ou "±HH:MM" → minutos. */
export function minutosDoDeslocamento(fuso: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(fuso.trim());
  if (!m) throw recusa('fuso-invalido', 'O deslocamento do horário da marcação é inválido.');
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

export function deslocamentoNormalizado(fuso: string): string {
  const min = minutosDoDeslocamento(fuso);
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export async function fusoDoEstabelecimento(l: Leitor, estabelecimento: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [estabelecimento],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

export function exigirEstabelecimento(c: ContextoNucleo): number {
  if (c.estabelecimento === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return c.estabelecimento;
}

export const contextoDe = (c: ContextoNucleo): ContextoNucleo => ({
  cliente: c.cliente,
  estabelecimento: c.estabelecimento,
  usuario: c.usuario,
  correlacao: c.correlacao,
  ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
});

export const carimboDe = (c: ContextoNucleo): Carimbo => ({ usuario: c.usuario, agora: new Date() });

/** Operação que o modelo do banco ainda não comporta (pedido de DDL registrado no lote; nada é gravado). */
export function modeloPendente(operacao: string, detalhe: string): ErroOperacao {
  return new ErroOperacao(409, 'modelo-pendente', `${operacao} indisponível`, detalhe);
}

export const desatualizado = () =>
  recusa('desatualizado', 'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo.');

/** A mudança (valor anterior e novo) na trilha da mesma transação, sob o registro. */
export async function registrarCorrecaoNaTrilha(
  e: Escritor,
  c: ContextoNucleo,
  x: {
    tabela: string;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
  },
): Promise<void> {
  await gravarTrilha(e, {
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    acao: 'alteracao',
    entidade: x.tabela,
    entidadeId: x.registro,
    dadosAntes: x.antes,
    dadosDepois: { operacao: x.operacao, valores: x.depois },
    motivo: x.motivo.slice(0, 500),
    correlacao: c.correlacao,
    ocorridoEm: new Date(),
  });
}

const json = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    return JSON.parse(String(v)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** As correções registradas pela trilha (só as que levam a operação), da mais nova à mais antiga. */
export async function correcoesDaTrilha(
  l: Leitor,
  estabelecimento: number,
  tabela: string,
  registros: readonly number[],
  fuso: string,
): Promise<CorrecaoRegistrada[]> {
  if (registros.length === 0) return [];
  const linhas = await l.consultar(
    `SELECT t.id, t.entidade, t.entidade_id, t.dados_antes, t.dados_depois, t.motivo, t.ocorrido_em, u.login
       FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
      WHERE t.estabelecimento_id = ? AND t.entidade = ? AND t.entidade_id IN (${marcadores(registros.length)})
        AND t.acao = 'alteracao' AND JSON_VALUE(t.dados_depois, '$.operacao') IS NOT NULL
      ORDER BY t.id DESC`,
    [estabelecimento, tabela, ...registros],
  );
  return linhas.map((r) => {
    const depois = json(r['dados_depois']);
    return {
      id: n(r['id']),
      tabela: texto(r['entidade']),
      registro: n(r['entidade_id']),
      operacao: texto(depois['operacao']),
      antes: json(r['dados_antes']),
      depois: (depois['valores'] as Record<string, unknown> | undefined) ?? {},
      motivo: texto(r['motivo']),
      por: texto(r['login']),
      em: localNoFuso(instante(r['ocorrido_em']) ?? new Date(), fuso),
    };
  });
}

/** Ponto de integração no formato do núcleo (minúsculas, sem espaço). */
const pontoDe = (tipo: string) =>
  tipo
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 80) || 'pessoas';

export async function saidaIntegracao(
  e: Escritor,
  c: ContextoNucleo,
  ev: { tipo: string; chave: string; carga: Record<string, string | number> },
): Promise<string> {
  const id = await gravarOutbox(e, {
    estabelecimento: c.estabelecimento,
    ponto: pontoDe(ev.tipo),
    entidade: null,
    entidadeId: null,
    chave: ev.chave,
    carga: ev.carga,
    usuario: c.usuario,
    agora: new Date(),
  });
  return String(id);
}
