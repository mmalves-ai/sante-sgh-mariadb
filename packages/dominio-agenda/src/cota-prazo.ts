// Cotas e prazos de marcação (02-AGE linha 47). Regras puras, usadas pela tela (validação na hora), pelo servidor
// (antes de gravar) e pela porta da agenda na marcação, dentro da mesma transação:
// - a restrição da agenda por convênio, plano ou item (sexo, idade, retorno, encaixe): a regra confirmada recusa; a
//   estimada (extraída do texto da agenda e ainda não revista) só alerta;
// - o prazo de aviso: a antecedência mínima (em horas) e a máxima (em dias) entre a marcação e o horário, e o texto
//   de aviso ao paciente; vale o prazo mais específico (agenda e item, item, agenda, geral);
// - a cota de marcação por período (dia, semana, mês ou vigência) e recorte (agenda, convênio, especialidade, tipo
//   de marcação, item), em quantidade ou percentual das vagas da janela, com a ação ao esgotar (bloquear, alertar,
//   encaminhar à lista de espera ou exigir autorização).
import type { AgendaEstruturada } from '@sgh/contratos';
import { agendaAtendePaciente, type PerguntaRestricao } from './estruturada.js';

export const PERIODICIDADES_COTA = ['dia', 'semana', 'mes', 'vigencia'] as const;
export type PeriodicidadeCota = (typeof PERIODICIDADES_COTA)[number];
export const ACOES_COTA = ['bloquear', 'alertar', 'lista_espera', 'exigir_autorizacao'] as const;
export type AcaoCota = (typeof ACOES_COTA)[number];

export interface RecusaCotaPrazo {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo?: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// ---------------------------------------------------------------- cota

export interface CotaMarcacao {
  readonly id?: number;
  readonly agenda: number | null;
  readonly fontePagadora: number | null;
  readonly especialidade: number | null;
  readonly tipoMarcacao: number | null;
  readonly item: number | null;
  readonly periodicidade: PeriodicidadeCota;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly quantidadeMaxima: number | null;
  readonly percentualMaximo: number | null;
  readonly acao: AcaoCota;
  readonly ativo: boolean;
}

/** Validação do cadastro da cota (null = ok): as mesmas condições dos CHECK da tabela, com a mensagem ao usuário. */
export function validarCota(c: CotaMarcacao): RecusaCotaPrazo | null {
  if (
    c.agenda === null &&
    c.fontePagadora === null &&
    c.especialidade === null &&
    c.tipoMarcacao === null &&
    c.item === null
  )
    return {
      codigo: 'cota-sem-recorte',
      mensagem: 'Escolha ao menos um recorte: agenda, convênio, especialidade, tipo de marcação ou item.',
      campo: 'agenda',
    };
  if (!PERIODICIDADES_COTA.includes(c.periodicidade))
    return {
      codigo: 'periodicidade-invalida',
      mensagem: 'Período da cota desconhecido.',
      campo: 'periodicidade',
    };
  if (!ACOES_COTA.includes(c.acao))
    return { codigo: 'acao-invalida', mensagem: 'Ação ao esgotar desconhecida.', campo: 'acao' };
  if (c.quantidadeMaxima === null && c.percentualMaximo === null)
    return {
      codigo: 'cota-sem-limite',
      mensagem: 'Informe a quantidade máxima ou o percentual das vagas.',
      campo: 'quantidadeMaxima',
    };
  if (c.quantidadeMaxima !== null && (!Number.isInteger(c.quantidadeMaxima) || c.quantidadeMaxima < 0))
    return {
      codigo: 'quantidade-invalida',
      mensagem: 'A quantidade máxima é um número inteiro, zero ou mais.',
      campo: 'quantidadeMaxima',
    };
  if (c.percentualMaximo !== null && !(c.percentualMaximo >= 0 && c.percentualMaximo <= 100))
    return {
      codigo: 'percentual-invalido',
      mensagem: 'O percentual das vagas vai de 0 a 100.',
      campo: 'percentualMaximo',
    };
  if (!dataValida(c.vigenciaInicio))
    return {
      codigo: 'vigencia-invalida',
      mensagem: 'Informe o início da vigência.',
      campo: 'vigenciaInicio',
    };
  if (c.vigenciaFim !== null && (!dataValida(c.vigenciaFim) || c.vigenciaFim < c.vigenciaInicio))
    return {
      codigo: 'vigencia-invertida',
      mensagem: 'O fim da vigência não pode ser antes do início.',
      campo: 'vigenciaFim',
    };
  return null;
}

/** O que a marcação é, para saber quais cotas e prazos a alcançam. */
export interface AlvoCota {
  readonly agenda: number;
  readonly fontePagadora: number;
  readonly especialidade: number | null;
  readonly tipoMarcacao: number | null;
  readonly item: number | null;
  /** Dia do horário marcado (AAAA-MM-DD): a vigência e a janela da cota são contadas por ele. */
  readonly data: string;
}

const casa = (regra: number | null, valor: number | null) => regra === null || regra === valor;

/** A cota vale para esta marcação: ativa, vigente no dia do horário e com todos os recortes iguais aos da marcação. */
export function cotaAlcanca(c: CotaMarcacao, a: AlvoCota): boolean {
  return (
    c.ativo &&
    c.vigenciaInicio <= a.data &&
    (c.vigenciaFim === null || c.vigenciaFim >= a.data) &&
    casa(c.agenda, a.agenda) &&
    casa(c.fontePagadora, a.fontePagadora) &&
    casa(c.especialidade, a.especialidade) &&
    casa(c.tipoMarcacao, a.tipoMarcacao) &&
    casa(c.item, a.item)
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Janela em que a cota é contada, pelo dia do horário: o dia; a semana de segunda a domingo; o mês; ou a vigência
 * inteira (sem fim, até o último dia representável).
 */
export function janelaDaCota(
  c: Pick<CotaMarcacao, 'periodicidade' | 'vigenciaInicio' | 'vigenciaFim'>,
  data: string,
): { inicio: string; fim: string } {
  const d = new Date(`${data}T00:00:00Z`);
  switch (c.periodicidade) {
    case 'dia':
      return { inicio: data, fim: data };
    case 'semana': {
      const desdeSegunda = (d.getUTCDay() + 6) % 7;
      const ini = new Date(d.getTime() - desdeSegunda * 86_400_000);
      return { inicio: iso(ini), fim: iso(new Date(ini.getTime() + 6 * 86_400_000)) };
    }
    case 'mes': {
      const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return { inicio: iso(ini), fim: iso(fim) };
    }
    default:
      return { inicio: c.vigenciaInicio, fim: c.vigenciaFim ?? '9999-12-31' };
  }
}

/** Limite da cota na janela: o menor entre a quantidade e o percentual das vagas (arredondado para baixo). */
export function limiteDaCota(
  c: Pick<CotaMarcacao, 'quantidadeMaxima' | 'percentualMaximo'>,
  vagasNaJanela: number,
): number {
  const porPercentual =
    c.percentualMaximo === null ? null : Math.floor((vagasNaJanela * c.percentualMaximo) / 100 + 1e-9);
  if (c.quantidadeMaxima === null) return porPercentual ?? 0;
  return porPercentual === null ? c.quantidadeMaxima : Math.min(c.quantidadeMaxima, porPercentual);
}

export interface UsoDaCota {
  readonly cota: CotaMarcacao;
  /** Marcações já feitas na janela, no recorte da cota (sem as canceladas). */
  readonly usadas: number;
  /** Vagas da grade na janela, no recorte da cota (base do percentual). */
  readonly vagas: number;
}

export type DecisaoCota =
  | { readonly ok: true; readonly alertas: readonly string[] }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

const ORDEM_ACAO: Record<AcaoCota, number> = {
  bloquear: 0,
  lista_espera: 1,
  exigir_autorizacao: 2,
  alertar: 3,
};

/**
 * Decide a marcação diante das cotas que a alcançam: a que esgota com a ação mais forte vence (bloquear, lista de
 * espera, exigir autorização, alertar). O administrador pode tudo: passa com o alerta do que esgotou. A autorização
 * dada (por quem tem a permissão de manter a agenda) também passa a cota que exige autorização.
 */
export function decidirCotas(
  usos: readonly UsoDaCota[],
  p: { readonly administrador?: boolean; readonly autorizado?: boolean } = {},
): DecisaoCota {
  const esgotadas = usos
    .map((u) => ({ ...u, limite: limiteDaCota(u.cota, u.vagas) }))
    .filter((u) => u.usadas + 1 > u.limite)
    .sort((x, y) => ORDEM_ACAO[x.cota.acao] - ORDEM_ACAO[y.cota.acao]);
  const texto = (u: (typeof esgotadas)[number]) =>
    `A cota de marcação (${u.cota.periodicidade === 'vigencia' ? 'na vigência' : `por ${u.cota.periodicidade === 'mes' ? 'mês' : u.cota.periodicidade}`}) chegou ao limite: ${u.usadas} de ${u.limite}.`;
  const alertas: string[] = [];
  for (const u of esgotadas) {
    const passa =
      p.administrador === true ||
      u.cota.acao === 'alertar' ||
      (u.cota.acao === 'exigir_autorizacao' && p.autorizado === true);
    if (passa) {
      alertas.push(texto(u));
      continue;
    }
    if (u.cota.acao === 'bloquear')
      return {
        ok: false,
        codigo: 'cota-esgotada',
        mensagem: `${texto(u)} Escolha outro período ou outra agenda.`,
      };
    if (u.cota.acao === 'lista_espera')
      return {
        ok: false,
        codigo: 'cota-esgotada-lista-espera',
        mensagem: `${texto(u)} Inclua o paciente na lista de espera: ele é chamado quando a cota abrir.`,
      };
    return {
      ok: false,
      codigo: 'cota-exige-autorizacao',
      mensagem: `${texto(u)} A marcação passa só com a autorização do gestor da agenda.`,
    };
  }
  return { ok: true, alertas };
}

// ---------------------------------------------------------------- prazo de aviso

export interface PrazoAviso {
  readonly id?: number;
  readonly agenda: number | null;
  readonly item: number | null;
  readonly antecedenciaMinimaHoras: number;
  readonly antecedenciaMaximaDias: number | null;
  readonly textoAviso: string | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export function validarPrazo(p: PrazoAviso): RecusaCotaPrazo | null {
  if (
    !Number.isInteger(p.antecedenciaMinimaHoras) ||
    p.antecedenciaMinimaHoras < 0 ||
    p.antecedenciaMinimaHoras > 8760
  )
    return {
      codigo: 'antecedencia-minima-invalida',
      mensagem: 'A antecedência mínima vai de 0 a 8760 horas.',
      campo: 'antecedenciaMinimaHoras',
    };
  if (
    p.antecedenciaMaximaDias !== null &&
    (!Number.isInteger(p.antecedenciaMaximaDias) ||
      p.antecedenciaMaximaDias < 1 ||
      p.antecedenciaMaximaDias > 3650)
  )
    return {
      codigo: 'antecedencia-maxima-invalida',
      mensagem: 'A antecedência máxima vai de 1 a 3650 dias.',
      campo: 'antecedenciaMaximaDias',
    };
  if (p.antecedenciaMaximaDias !== null && p.antecedenciaMaximaDias * 24 < p.antecedenciaMinimaHoras)
    return {
      codigo: 'antecedencia-incoerente',
      mensagem: 'A antecedência máxima não pode ser menor que a mínima: nenhum horário seria aceito.',
      campo: 'antecedenciaMaximaDias',
    };
  if (p.antecedenciaMinimaHoras === 0 && p.antecedenciaMaximaDias === null && !(p.textoAviso ?? '').trim())
    return {
      codigo: 'prazo-vazio',
      mensagem: 'Informe a antecedência mínima, a máxima ou o texto do aviso.',
      campo: 'antecedenciaMinimaHoras',
    };
  if ((p.textoAviso ?? '').length > 1000)
    return { codigo: 'aviso-longo', mensagem: 'O aviso tem até 1000 caracteres.', campo: 'textoAviso' };
  for (const [campo, v] of [
    ['vigenciaInicio', p.vigenciaInicio],
    ['vigenciaFim', p.vigenciaFim],
  ] as const)
    if (v !== null && !dataValida(v))
      return { codigo: 'vigencia-invalida', mensagem: 'Data no formato AAAA-MM-DD.', campo };
  if (p.vigenciaInicio !== null && p.vigenciaFim !== null && p.vigenciaFim < p.vigenciaInicio)
    return {
      codigo: 'vigencia-invertida',
      mensagem: 'O fim da vigência não pode ser antes do início.',
      campo: 'vigenciaFim',
    };
  return null;
}

/** O prazo que vale para a marcação: o mais específico (agenda e item, item, agenda, geral); empate, o mais novo. */
export function prazoQueVale(
  prazos: readonly PrazoAviso[],
  a: { readonly agenda: number; readonly item: number | null; readonly data: string },
): PrazoAviso | null {
  const peso = (p: PrazoAviso) => (p.item !== null ? 2 : 0) + (p.agenda !== null ? 1 : 0);
  const vale = prazos
    .filter(
      (p) =>
        p.ativo &&
        casa(p.agenda, a.agenda) &&
        casa(p.item, a.item) &&
        (p.vigenciaInicio === null || p.vigenciaInicio <= a.data) &&
        (p.vigenciaFim === null || p.vigenciaFim >= a.data),
    )
    .sort((x, y) => peso(y) - peso(x) || (y.id ?? 0) - (x.id ?? 0));
  return vale[0] ?? null;
}

export type DecisaoPrazo =
  | { readonly ok: true; readonly aviso: string | null }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

/**
 * Confere a antecedência da marcação (instantes em milissegundos). O encaixe é a via da urgência do dia: não cobra a
 * antecedência mínima, só a máxima. O administrador pode tudo: passa, com o aviso.
 */
export function decidirPrazo(
  prazo: PrazoAviso | null,
  p: {
    readonly agora: number;
    readonly inicio: number;
    readonly encaixe: boolean;
    readonly administrador?: boolean;
  },
): DecisaoPrazo {
  if (!prazo) return { ok: true, aviso: null };
  const aviso = prazo.textoAviso?.trim() ? prazo.textoAviso.trim() : null;
  if (p.administrador) return { ok: true, aviso };
  const horas = (p.inicio - p.agora) / 3_600_000;
  if (!p.encaixe && horas < prazo.antecedenciaMinimaHoras)
    return {
      ok: false,
      codigo: 'antecedencia-minima',
      mensagem: `Este horário pede ao menos ${prazo.antecedenciaMinimaHoras} horas de antecedência: escolha um horário mais adiante${prazo.antecedenciaMinimaHoras > 0 ? ' ou marque como encaixe' : ''}.`,
    };
  if (prazo.antecedenciaMaximaDias !== null && horas > prazo.antecedenciaMaximaDias * 24)
    return {
      ok: false,
      codigo: 'antecedencia-maxima',
      mensagem: `A agenda abre marcação até ${prazo.antecedenciaMaximaDias} dias à frente: escolha um horário mais próximo.`,
    };
  return { ok: true, aviso };
}

// ---------------------------------------------------------------- restrição da agenda na marcação

export type DecisaoRestricao =
  | { readonly ok: true; readonly alertas: readonly string[] }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

/**
 * Aplica a restrição da agenda (padrão e regras por convênio, plano e item) na marcação. Só a regra confirmada
 * recusa; a estimada, ainda não revista, vira alerta para quem marca.
 */
export function restricaoNaMarcacao(a: AgendaEstruturada, p: PerguntaRestricao): DecisaoRestricao {
  const confirmadas = { ...a, restricoes: a.restricoes.filter((r) => r.situacaoRevisao === 'confirmada') };
  const firme = agendaAtendePaciente(confirmadas, p);
  if (!firme.permitido)
    return { ok: false, codigo: 'restricao-agenda', mensagem: firme.impedimentos.join(' ') };
  const tudo = agendaAtendePaciente(a, p);
  return {
    ok: true,
    alertas: tudo.permitido ? [] : [`Regra da agenda ainda a confirmar: ${tudo.impedimentos.join(' ')}`],
  };
}

// ---------------------------------------------------------------- item principal da marcação

export type DecisaoItem =
  | { readonly ok: true; readonly item: number | null }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

/**
 * O item agendável principal da marcação (02-AGE 47), que leva a restrição, o prazo e a cota por item até ela:
 * - o informado tem de estar entre os itens da agenda;
 * - o da marcação remarcada segue se a agenda de destino o oferece; senão vale a regra seguinte;
 * - sem informado, vale o único item da agenda; agenda sem item ou com vários fica sem item (sem recusa).
 */
export function itemDaMarcacao(
  itensDaAgenda: readonly number[],
  p: { readonly informado: number | null; readonly anterior?: number | null },
): DecisaoItem {
  if (p.informado !== null) {
    if (!itensDaAgenda.includes(p.informado))
      return {
        ok: false,
        codigo: 'item-fora-da-agenda',
        mensagem: 'A agenda não oferece este item: escolha um item da agenda ou outra agenda.',
      };
    return { ok: true, item: p.informado };
  }
  const anterior = p.anterior ?? null;
  if (anterior !== null && itensDaAgenda.includes(anterior)) return { ok: true, item: anterior };
  const unicos = [...new Set(itensDaAgenda)];
  return { ok: true, item: unicos.length === 1 ? unicos[0]! : null };
}
