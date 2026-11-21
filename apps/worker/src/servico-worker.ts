// Peças comuns dos serviços periódicos do worker sobre o banco próprio de cada cliente (lote F2.2 05-15): a regra de
// ligar o serviço pelo ambiente, os estabelecimentos ativos do cliente com o fuso, a chave de recurso ligada para o
// estabelecimento inteiro (escopo hospital, com os pré-requisitos cumpridos: a regra pura do domínio), a volta por
// cliente e estabelecimento, o dia e a hora civis no fuso e o conflito de gravação concorrente.
// Melhoria: a chave e os pré-requisitos vêm das tabelas próprias (liberacao_chave, recurso_prerequisito) pelo id do
// estabelecimento e a decisão é a mesma regra da API (recursoLigadoNoEstabelecimento); nada de lista fixa de bancos.
// Melhoria: o fuso é o do cadastro do estabelecimento (estabelecimento.fuso_horario), não um fuso fixo do processo.
// Melhoria: só o estabelecimento em atividade entra na volta (ativo e sem fim de atividade vencido no fuso dele).
import { recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { ErroOperacao, type Executor, ehTravaOcupada, errnoDe, type Leitor, restricaoUnicaViolada } from '@sgh/nucleo';
import { clientesDoWorker, type NucleoClientes } from './clientes-worker.js';

export const FUSO_PADRAO_WORKER = 'America/Sao_Paulo';

/** O serviço roda? Fora de dev/ci, sempre (salvo <VARIAVEL>=desligado); em dev/ci, só com <VARIAVEL>=ligado. */
export function servicoLigado(env: NodeJS.ProcessEnv, variavel: string): boolean {
  const pedido = (env[variavel] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** O que as portas próprias do worker usam do NucleoProprio (os testes trocam). */
export interface NucleoWorker {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly estabelecimento?: number | null; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** O que os serviços usam do núcleo: os clientes da plataforma e o encerramento. */
export interface NucleoServico extends NucleoClientes {
  encerrar(): Promise<void>;
}

export interface AlvoEstabelecimento {
  readonly cliente: string;
  readonly id: number;
  readonly codigo: string;
  readonly fuso: string;
}

const diaIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * Os estabelecimentos em atividade do cliente, com o fuso do cadastro: não excluídos, ativos e sem fim de atividade
 * anterior ao dia civil de hoje no fuso de cada um (o encerrado ou desativado não recebe censo, reservas nem avisos).
 */
export async function estabelecimentosAtivos(
  l: Leitor,
  cliente: string,
  agora: Date = new Date(),
): Promise<AlvoEstabelecimento[]> {
  const linhas = await l.consultar(
    'SELECT id, codigo, fuso_horario, fim_atividade FROM estabelecimento WHERE excluido_em IS NULL AND ativo = TRUE ORDER BY codigo',
    [],
    { teto: 1000 },
  );
  return linhas
    .map((x) => ({
      alvo: {
        cliente,
        id: Number(x['id']),
        codigo: String(x['codigo']),
        fuso: typeof x['fuso_horario'] === 'string' && x['fuso_horario'] ? x['fuso_horario'] : FUSO_PADRAO_WORKER,
      },
      fim: diaIso(x['fim_atividade']),
    }))
    .filter((x) => x.fim === null || x.fim >= diaEHoraLocal(agora, x.alvo.fuso).data)
    .map((x) => x.alvo);
}

type Chaves = Parameters<typeof recursoLigadoNoEstabelecimento>[0];
type Registrados = Parameters<typeof recursoLigadoNoEstabelecimento>[2];

/** O recurso ligado para o estabelecimento inteiro, com os pré-requisitos declarados cumpridos na hora. */
export async function recursoLigadoAqui(l: Leitor, chave: string, estabelecimento: number, agora: Date): Promise<boolean> {
  const chaves = await l.consultar(
    "SELECT escopo, valor, ligada FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ? AND tipo = 'recurso'",
    [estabelecimento, chave],
    { teto: 1000 },
  );
  const pre = await l.consultar(
    'SELECT tipo, situacao, validade FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ?',
    [estabelecimento, chave],
    { teto: 100 },
  );
  return recursoLigadoNoEstabelecimento(
    chaves.map((c) => ({
      escopo: String(c['escopo']),
      valor: String(c['valor']),
      ligada: c['ligada'] === null || c['ligada'] === undefined ? null : Boolean(Number(c['ligada'])),
    })) as unknown as Chaves,
    recursoDesligado(chave)?.prerequisitos ?? [],
    pre.map((p) => ({
      tipo: String(p['tipo']),
      situacao: String(p['situacao']),
      validade: diaIso(p['validade']),
    })) as unknown as Registrados,
    agora,
  );
}

/** Data civil (AAAA-MM-DD) e hora do dia "HH:MM" de um instante no fuso (a forma do contrato do movimento do censo). */
export function diaEHoraLocal(v: Date, fuso: string): { readonly data: string; readonly dia: Date; readonly hora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(v)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const data = `${p['year']}-${p['month']}-${p['day']}`;
  return { data, dia: new Date(`${data}T00:00:00Z`), hora: `${p['hour']}:${p['minute']}` };
}

/** Deslocamento (ms) do fuso num instante: hora de parede menos UTC. */
function deslocamento(t: number, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return Date.UTC(+p['year']!, +p['month']! - 1, +p['day']!, +p['hour']!, +p['minute']!, +p['second']!) - t;
}

/** O instante da hora `hora` (0 a 24) do dia civil `data` no fuso. */
export function instanteLocal(data: string, hora: number, fuso: string): Date {
  const parede = Date.parse(`${data}T00:00:00Z`) + hora * 3_600_000;
  const t1 = parede - deslocamento(parede, fuso);
  return new Date(parede - deslocamento(t1, fuso));
}

/** Códigos do núcleo de gravação concorrente (a recusa de regra de negócio não entra). */
const CODIGOS_CONCORRENCIA = new Set(['conflito-versao', 'registro-duplicado', 'registro-em-edicao', 'requisicao-em-andamento']);

/** Outro consumidor gravou antes ou está gravando (chave única, trava ocupada, impasse ou 409 do executor). */
export function conflitoConcorrente(x: unknown): boolean {
  let y: unknown = x;
  for (let i = 0; i < 5 && y; i++) {
    if (restricaoUnicaViolada(y) !== null || ehTravaOcupada(y)) return true;
    const errno = errnoDe(y);
    if (errno === 1062 || errno === 1213 || errno === 1205) return true;
    if (y instanceof ErroOperacao && CODIGOS_CONCORRENCIA.has(String(y.problema.codigo))) return true;
    y = (y as { cause?: unknown }).cause;
  }
  return false;
}

export interface Volta<R> {
  readonly cliente: string;
  readonly estabelecimento: string;
  readonly resultado: R;
}

/**
 * Uma volta do serviço: por cliente (a lista do ambiente ou os da plataforma) e por estabelecimento ativo. A falha de
 * um estabelecimento ou de um cliente vai ao `falhou` (só códigos) e não para os outros.
 */
export async function voltaPorEstabelecimento<P extends { estabelecimentos(): Promise<AlvoEstabelecimento[]> }, R>(
  nucleo: NucleoClientes,
  env: NodeJS.ProcessEnv,
  correlacao: string,
  fabrica: (cliente: string) => P,
  fn: (porta: P, est: AlvoEstabelecimento) => Promise<R>,
  falhou: (cliente: string, estabelecimento: string | null, erro: unknown) => void,
): Promise<Volta<R>[]> {
  const r: Volta<R>[] = [];
  let clientes: string[];
  try {
    clientes = await clientesDoWorker(nucleo, env, correlacao);
  } catch (e) {
    falhou('', null, e);
    return r;
  }
  for (const cliente of clientes) {
    let porta: P;
    let ests: AlvoEstabelecimento[];
    try {
      porta = fabrica(cliente);
      ests = await porta.estabelecimentos();
    } catch (e) {
      falhou(cliente, null, e);
      continue;
    }
    for (const est of ests) {
      try {
        r.push({ cliente, estabelecimento: est.codigo, resultado: await fn(porta, est) });
      } catch (e) {
        falhou(cliente, est.codigo, e);
      }
    }
  }
  return r;
}
