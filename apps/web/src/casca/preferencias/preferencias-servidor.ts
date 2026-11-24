// Preferências guardadas na conta (01-ADM L84): seguem o usuário em qualquer computador. O navegador guarda só a
// cópia para abrir sem piscar; a conta é a fonte. Leitura e gravação pela API (/api/acesso/preferencias/minhas).
import { erroDaResposta } from '../erros/problem-details.js';
import { tokenCsrf } from '../../api.js';
import type { DensidadeEscolhida, Preferencias, Tema } from './preferencias.js';

/** Densidade guardada na conta: a "normal" é o padrão do sistema; a casca a desenha como a sua padrão (compacta). */
export type DensidadeDaConta = 'compacta' | 'normal' | 'confortavel';

export interface TelaDoMenu {
  readonly codigo: string;
  readonly titulo: string;
  readonly rota: string;
}

export interface VisaoTela {
  readonly tela: string;
  readonly nome: string;
  readonly colunas: string[];
  readonly ordenacao: { coluna: string; direcao: 'asc' | 'desc' }[];
  readonly filtros: Record<string, unknown> | null;
  readonly itensPorPagina: number | null;
  readonly padrao: boolean;
}

export interface PreferenciasDaConta {
  readonly guardadas: boolean;
  readonly geral: {
    tema: Tema;
    densidade: DensidadeDaConta;
    textoAmpliado: boolean;
    tipoAtendimentoPadrao: string | null;
  };
  readonly telaInicial: TelaDoMenu | null;
  readonly telasDoMenu: TelaDoMenu[];
  readonly visoes: VisaoTela[];
  readonly visaoInicialPorTela: Record<string, string>;
}

const URL = '/api/acesso/preferencias/minhas';

function chave(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return `pref-${c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function cabecalhos(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-csrf': tokenCsrf(),
    'idempotency-key': chave(),
  };
}

export async function lerPreferenciasDaConta(
  tela?: string,
  buscar: typeof fetch = fetch,
): Promise<PreferenciasDaConta> {
  const r = await buscar(tela ? `${URL}?tela=${encodeURIComponent(tela)}` : URL, {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as PreferenciasDaConta;
}

export async function gravarPreferenciasDaConta(
  corpo: Partial<{
    tema: Tema;
    densidade: DensidadeDaConta;
    textoAmpliado: boolean;
    telaInicial: string | null;
    tipoAtendimentoPadrao: string | null;
  }>,
  buscar: typeof fetch = fetch,
): Promise<void> {
  const r = await buscar(URL, { method: 'PUT', headers: cabecalhos(), body: JSON.stringify(corpo) });
  if (!r.ok) throw await erroDaResposta(r);
}

/** Grava a visão de uma tela (colunas na ordem, ordenação, itens por página); a tela abre nela na próxima vez. */
export async function gravarVisaoDaTela(
  tela: string,
  visao: Omit<VisaoTela, 'tela' | 'filtros' | 'padrao' | 'nome'> & {
    nome?: string;
    padrao?: boolean;
    filtros?: Record<string, unknown>;
  },
  buscar: typeof fetch = fetch,
): Promise<void> {
  const r = await buscar(`${URL}/telas/${encodeURIComponent(tela)}`, {
    method: 'PUT',
    headers: cabecalhos(),
    body: JSON.stringify(visao),
  });
  if (!r.ok) throw await erroDaResposta(r);
}

/** A visão com que a tela abre (a marcada como padrão), ou nula: a tela usa as colunas de fábrica. */
export async function visaoInicialDaTela(
  tela: string,
  buscar: typeof fetch = fetch,
): Promise<VisaoTela | null> {
  const p = await lerPreferenciasDaConta(tela, buscar);
  const nome = p.visaoInicialPorTela[tela];
  return p.visoes.find((v) => v.tela === tela && v.nome === nome) ?? null;
}

/**
 * Como a casca desenha a densidade da conta: "normal" (padrão do sistema) usa o desenho padrão da casca, o compacto.
 * Só o desenho: a conta continua guardando "normal" (a tela de preferências nunca a regrava sem a pessoa mudar).
 */
export function densidadeParaCasca(d: string): DensidadeEscolhida {
  return d === 'confortavel' ? 'confortavel' : 'compacta';
}

/** Traduz a preferência da conta para a da casca (só para desenhar; nada volta para a conta). */
export function daConta(p: PreferenciasDaConta['geral']): Preferencias {
  return { tema: p.tema, densidade: densidadeParaCasca(p.densidade), fonteAmpliada: p.textoAmpliado };
}

/** O que gravar: só os campos em que a escolha difere do que a conta guarda (nada, se a pessoa não mudou nada). */
export function mudancasParaConta<T extends Record<string, unknown>>(
  guardado: T,
  escolhido: Partial<T>,
): Partial<T> {
  const r: Partial<T> = {};
  for (const k of Object.keys(escolhido) as (keyof T)[])
    if (escolhido[k] !== undefined && escolhido[k] !== guardado[k]) r[k] = escolhido[k];
  return r;
}

let destinoJaDecidido = false;

/**
 * Ao abrir o início pela primeira vez na carga da página: aplica as preferências da conta e devolve a tela inicial
 * escolhida (ou nulo para ficar no início). Falha de leitura não impede a entrada.
 */
export async function destinoInicialDaConta(
  aplicar: (p: Preferencias) => void,
  buscar: typeof fetch = fetch,
): Promise<string | null> {
  if (destinoJaDecidido) return null;
  destinoJaDecidido = true;
  try {
    const p = await lerPreferenciasDaConta(undefined, buscar);
    if (p.guardadas) aplicar(daConta(p.geral));
    const rota = p.telaInicial?.rota ?? null;
    return rota && rota !== '/inicio' ? rota : null;
  } catch {
    return null;
  }
}

/** Só para testes: volta a decidir o destino. */
export function reiniciarDestinoInicial(): void {
  destinoJaDecidido = false;
}
