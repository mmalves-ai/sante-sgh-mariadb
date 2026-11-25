// Parâmetros, preferências e alçada do faturamento (F3.7, 06-FAT linha 38).
// - Parâmetros tipados do faturamento no catálogo de parâmetros (parametro_definicao, chave `faturamento.*`), com valor
//   por rede ou estabelecimento e vigência (parametro_valor): a rotina diária das contas (ligada e hora de início), o
//   prazo do recurso de glosa e o dia-limite do fechamento da competência. Sem linha de valor, vale o padrão daqui.
// - Preferências do faturista: os mesmos parâmetros tipados no nível do usuário (`faturamento.preferencia.*`), sempre
//   da própria conta da sessão (tela inicial do faturamento, itens por página, visão agrupada por paciente).
// - Alçada do faturamento: por faixa de valor e cargo (os níveis da alçada de aprovação, como no ajuste da conta) e
//   quem pede nunca aprova, mesmo com alçada (separação de funções; nunca há autoaprovação no faturamento).
import { conferirAlcadaDoValor, type NivelAlcadaAjuste } from '../conta/ajustes.js';

export type TipoParametroFaturamento = 'booleano' | 'inteiro' | 'lista';

export interface DefinicaoParametroFaturamento {
  readonly chave: string;
  readonly tipo: TipoParametroFaturamento;
  readonly padrao: string;
  readonly minimo?: number;
  readonly maximo?: number;
  readonly opcoes?: readonly string[];
  /** Verdadeiro: preferência do faturista (nível usuário); falso: parâmetro da rede ou do estabelecimento. */
  readonly preferencia: boolean;
}

/** As telas que o faturista pode escolher como inicial do faturamento. */
export const TELAS_INICIAIS_FATURISTA = ['contas', 'worklist', 'guias', 'auditoria', 'glosas'] as const;
export type TelaInicialFaturista = (typeof TELAS_INICIAIS_FATURISTA)[number];

export const PARAMETROS_FATURAMENTO: readonly DefinicaoParametroFaturamento[] = [
  { chave: 'faturamento.rotinaDiaria', tipo: 'booleano', padrao: 'true', preferencia: false },
  {
    chave: 'faturamento.rotinaDiariaHora',
    tipo: 'inteiro',
    padrao: '0',
    minimo: 0,
    maximo: 23,
    preferencia: false,
  },
  {
    chave: 'faturamento.prazoRecursoGlosaDias',
    tipo: 'inteiro',
    padrao: '30',
    minimo: 1,
    maximo: 180,
    preferencia: false,
  },
  {
    chave: 'faturamento.fechamentoDiaLimite',
    tipo: 'inteiro',
    padrao: '5',
    minimo: 1,
    maximo: 28,
    preferencia: false,
  },
  {
    chave: 'faturamento.preferencia.telaInicial',
    tipo: 'lista',
    padrao: 'contas',
    opcoes: TELAS_INICIAIS_FATURISTA,
    preferencia: true,
  },
  {
    chave: 'faturamento.preferencia.itensPorPagina',
    tipo: 'inteiro',
    padrao: '50',
    minimo: 10,
    maximo: 200,
    preferencia: true,
  },
  {
    chave: 'faturamento.preferencia.agruparPorPaciente',
    tipo: 'booleano',
    padrao: 'true',
    preferencia: true,
  },
];

const DEFINICAO = new Map(PARAMETROS_FATURAMENTO.map((d) => [d.chave, d]));

export function definicaoParametroFaturamento(chave: string): DefinicaoParametroFaturamento | null {
  return DEFINICAO.get(chave) ?? null;
}

/** O valor cabe no tipo e na faixa do parâmetro? Devolve a mensagem da recusa, ou nulo. */
export function conferirValorParametroFaturamento(chave: string, valor: string): string | null {
  const d = DEFINICAO.get(chave);
  if (!d) return 'Parâmetro do faturamento desconhecido.';
  const v = valor.trim();
  if (d.tipo === 'booleano') return v === 'true' || v === 'false' ? null : 'Use sim ou não.';
  if (d.tipo === 'lista') return d.opcoes?.includes(v) ? null : 'Escolha uma das opções da lista.';
  if (!/^-?\d+$/.test(v)) return 'Informe um número inteiro.';
  const n = Number(v);
  if ((d.minimo !== undefined && n < d.minimo) || (d.maximo !== undefined && n > d.maximo))
    return `Use um valor de ${d.minimo} a ${d.maximo}.`;
  return null;
}

export interface ParametrosFaturamento {
  readonly rotinaDiaria: boolean;
  readonly rotinaDiariaHora: number;
  readonly prazoRecursoGlosaDias: number;
  readonly fechamentoDiaLimite: number;
}

export interface PreferenciasFaturista {
  readonly telaInicial: TelaInicialFaturista;
  readonly itensPorPagina: number;
  readonly agruparPorPaciente: boolean;
}

/** O valor efetivo de cada chave: o gravado, se for válido; senão, o padrão do catálogo. */
function efetivo(chave: string, valores: Readonly<Record<string, string | null | undefined>>): string {
  const d = DEFINICAO.get(chave)!;
  const v = valores[chave];
  return v !== null && v !== undefined && conferirValorParametroFaturamento(chave, v) === null
    ? v.trim()
    : d.padrao;
}

export function normalizarParametrosFaturamento(
  valores: Readonly<Record<string, string | null | undefined>>,
): ParametrosFaturamento {
  return {
    rotinaDiaria: efetivo('faturamento.rotinaDiaria', valores) === 'true',
    rotinaDiariaHora: Number(efetivo('faturamento.rotinaDiariaHora', valores)),
    prazoRecursoGlosaDias: Number(efetivo('faturamento.prazoRecursoGlosaDias', valores)),
    fechamentoDiaLimite: Number(efetivo('faturamento.fechamentoDiaLimite', valores)),
  };
}

export function normalizarPreferenciasFaturista(
  valores: Readonly<Record<string, string | null | undefined>>,
): PreferenciasFaturista {
  return {
    telaInicial: efetivo('faturamento.preferencia.telaInicial', valores) as TelaInicialFaturista,
    itensPorPagina: Number(efetivo('faturamento.preferencia.itensPorPagina', valores)),
    agruparPorPaciente: efetivo('faturamento.preferencia.agruparPorPaciente', valores) === 'true',
  };
}

export interface RecusaPreferenciaFaturista {
  readonly campo: string;
  readonly mensagem: string;
}

/** Confere o pedido de preferências: só chaves de preferência, cada uma no seu tipo. Devolve as recusas. */
export function conferirPreferenciasFaturista(
  pedido: Readonly<Record<string, string>>,
): RecusaPreferenciaFaturista[] {
  const erros: RecusaPreferenciaFaturista[] = [];
  const chaves = Object.keys(pedido);
  if (!chaves.length) erros.push({ campo: 'preferencias', mensagem: 'Nenhuma preferência informada.' });
  for (const chave of chaves) {
    const d = DEFINICAO.get(chave);
    if (!d || !d.preferencia) {
      erros.push({ campo: chave, mensagem: 'Só as preferências do faturista são gravadas aqui.' });
      continue;
    }
    const m = conferirValorParametroFaturamento(chave, pedido[chave]!);
    if (m) erros.push({ campo: chave, mensagem: m });
  }
  return erros;
}

/**
 * A rotina diária roda neste ciclo? Precisa estar ligada no estabelecimento e a hora local já ter chegado à hora de
 * início. A trava do ambiente (dev e ci só com pedido explícito) continua valendo à parte.
 */
export function rotinaDiariaNaHora(p: ParametrosFaturamento, horaLocal: number): boolean {
  return p.rotinaDiaria && horaLocal >= p.rotinaDiariaHora;
}

const somarDias = (dia: string, dias: number): string => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Último dia para recorrer da glosa, contado do recebimento do demonstrativo (AAAA-MM-DD). */
export function prazoRecursoGlosa(recebidoEm: string, p: ParametrosFaturamento): string {
  return somarDias(recebidoEm, p.prazoRecursoGlosaDias);
}

/** Dia-limite para fechar a competência AAAA-MM: o dia do parâmetro no mês seguinte. */
export function limiteFechamentoCompetencia(competencia: string, p: ParametrosFaturamento): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(p.fechamentoDiaLimite).padStart(2, '0')}`;
}

export interface PedidoAlcadaFaturamento {
  readonly valor: number;
  readonly solicitante: number;
  readonly decisor: number | null;
  readonly perfisDoDecisor: readonly number[];
  readonly niveis: readonly NivelAlcadaAjuste[];
}

export interface ResultadoAlcadaFaturamento {
  readonly pode: boolean;
  readonly nivel: number | null;
  readonly motivo: string | null;
}

/**
 * Alçada do faturamento: quem pede não aprova (sempre); o valor precisa caber num nível que cubra o decisor (pelo
 * usuário ou por um dos cargos dele). Sem nível cadastrado, ninguém aprova: a alçada do faturamento é obrigatória.
 */
export function conferirAlcadaFaturamento(p: PedidoAlcadaFaturamento): ResultadoAlcadaFaturamento {
  if (p.decisor === null) return { pode: false, nivel: null, motivo: 'Decisão sem usuário identificado.' };
  if (!(p.valor >= 0)) return { pode: false, nivel: null, motivo: 'Valor inválido.' };
  if (p.decisor === p.solicitante)
    return {
      pode: false,
      nivel: null,
      motivo: 'Quem pede não aprova: peça a outro usuário com a alçada.',
    };
  if (!p.niveis.length)
    return {
      pode: false,
      nivel: null,
      motivo: 'Não há alçada do faturamento cadastrada neste estabelecimento.',
    };
  const r = conferirAlcadaDoValor(p.valor, p.niveis, p.decisor, p.perfisDoDecisor);
  return r.nivel
    ? { pode: true, nivel: r.nivel.nivel, motivo: null }
    : { pode: false, nivel: null, motivo: r.motivo };
}

/** Os documentos do faturamento que passam pela alçada (código do tipo de documento de aprovação). */
export const DOCUMENTOS_ALCADA_FATURAMENTO = [
  'fat_reabertura_competencia',
  'fat_aceite_glosa',
  'fat_cancelamento_conta',
] as const;
export type DocumentoAlcadaFaturamento = (typeof DOCUMENTOS_ALCADA_FATURAMENTO)[number];
