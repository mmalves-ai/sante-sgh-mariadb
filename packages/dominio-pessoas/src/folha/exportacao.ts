// Montagem do lote da competência para a folha externa (M53-F0; ficha do M53, seções 1 e 6, regras 4 a 6): quem vai
// (os vínculos da folha na competência: CLT, estatutário, residente e estagiário; o cooperado, a PJ e o terceiro são do
// repasse ou da contratada, nunca da folha), com a lotação e o lado assistencial (conselho), os afastamentos em vigor
// que tocam a competência, os eventos de ponto do período fechado (regra 5) e os plantões realizados aprovados. Sem
// salário nem rubrica (regra 4: contratual é da folha externa). Os totais saem do conteúdo (regra 6).
//
// Pendências barram o lote inteiro (nada é gravado): ponto não fechado, CPF ilegível, tipo de integração ausente, nenhum
// colaborador, competência já lançada ou ainda por começar. A lista leva só os IDs dos vínculos.
import {
  type AfastamentoExportado,
  type CodigoPendenciaExportacao,
  type ColaboradorExportado,
  cpfValido,
  type LoteExportacaoFolha,
  type ModalidadePlantao,
  MODALIDADES_PLANTAO,
  type PendenciaExportacaoFolha,
  type PlantaoExportado,
  type TipoVinculoTrabalho,
  TIPOS_VINCULO_TRABALHO,
  VERSAO_LEIAUTE_FOLHA_INTERFACE,
  VINCULOS_PRESTADOR,
} from '@sgh/contratos';
import { ultimoDiaDaCompetencia } from '../ponto/fechamento.js';
import { exportarEventosPonto, type FechamentoPontoVinculo } from '../ponto/exportacao.js';
import { totalizarExportacao } from './lote.js';

/** O vínculo como a exportação o recebe (o CPF já decifrado pela API; null se não pôde ser lido). */
export interface VinculoParaFolha {
  readonly id: number;
  readonly cpf: string | null;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly centroCusto: number;
  readonly unidade: number | null;
  readonly cbo: string | null;
  readonly conselho: ColaboradorExportado['conselho'];
}

export interface AfastamentoParaFolha {
  readonly vinculo: number;
  readonly motivo: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: string;
}

export interface PlantaoParaFolha {
  readonly vinculo: number;
  readonly plantao: number;
  readonly modalidade: string;
  /** Instantes locais (AAAA-MM-DDTHH:MM, horário de Brasília). */
  readonly inicio: string;
  readonly fim: string;
  readonly minutos: number;
}

export interface EntradaLoteFolha {
  readonly lote: number;
  readonly empresa: number;
  readonly estabelecimento: string;
  readonly competencia: string;
  /** Instante da geração com o fuso (ISO 8601). */
  readonly geradoEm: string;
  readonly hoje: string;
  readonly vinculos: readonly VinculoParaFolha[];
  readonly afastamentos: readonly AfastamentoParaFolha[];
  /** O fechamento vigente por vínculo (ausente: período não fechado). */
  readonly fechamentos: ReadonlyMap<number, Readonly<Record<string, number>>>;
  /** Os minutos por tipo de hora (POTPHORA) do mesmo fechamento, por vínculo (regra 5; informativo). */
  readonly horas?: ReadonlyMap<number, Readonly<Record<string, number>>>;
  readonly plantoes: readonly PlantaoParaFolha[];
  readonly eventosDisponiveis: ReadonlySet<number>;
  readonly competenciaLancada: boolean;
}

export interface ResultadoLoteFolha {
  /** O lote, só quando não há pendência. */
  readonly lote: LoteExportacaoFolha | null;
  readonly pendencias: readonly PendenciaExportacaoFolha[];
  /** A conta impressa dos totais (com pendência, a do que sairia). */
  readonly conta: string;
}

/** Fuso do horário local dos plantões (Brasília, sem horário de verão desde 2019). */
export const FUSO_LOCAL_FOLHA = '-03:00';

export function periodoDaCompetencia(competencia: string): { inicio: string; fim: string } {
  return { inicio: `${competencia}-01`, fim: ultimoDiaDaCompetencia(competencia) };
}

/** O vínculo entra na folha (não é prestador) e existia em algum dia da competência. */
export function vinculoNaFolha(
  v: Pick<VinculoParaFolha, 'tipo' | 'admissao' | 'desligamento'>,
  competencia: string,
): boolean {
  const { inicio, fim } = periodoDaCompetencia(competencia);
  if (!(TIPOS_VINCULO_TRABALHO as readonly string[]).includes(v.tipo)) return false;
  if ((VINCULOS_PRESTADOR as readonly string[]).includes(v.tipo)) return false;
  return v.admissao <= fim && (v.desligamento === null || v.desligamento >= inicio);
}

const pend = (
  codigo: CodigoPendenciaExportacao,
  vinculos: readonly number[] = [],
  valor = 0,
): PendenciaExportacaoFolha => ({ codigo, vinculos, valor });

const milhar = (n: number) => n.toLocaleString('pt-BR');

/** "12 colaboradores; 1 afastamento; ponto 4 eventos = 9.600 min; plantões 2 = 1.440 min". */
export function contaDaExportacao(t: ReturnType<typeof totalizarExportacao>): string {
  const pl = (n: number, um: string, varios: string) => `${milhar(n)} ${n === 1 ? um : varios}`;
  return [
    pl(t.colaboradores, 'colaborador', 'colaboradores'),
    pl(t.afastamentos, 'afastamento', 'afastamentos'),
    `ponto ${pl(t.eventosPonto, 'evento', 'eventos')} = ${milhar(t.minutosPonto)} min`,
    `plantões ${milhar(t.plantoes)} = ${milhar(t.minutosPlantao)} min`,
  ].join('; ');
}

/** Monta o lote (regras 4 a 6) ou devolve as pendências que o barram. */
export function montarLoteFolha(e: EntradaLoteFolha): ResultadoLoteFolha {
  const { inicio, fim } = periodoDaCompetencia(e.competencia);
  const pendencias: PendenciaExportacaoFolha[] = [];
  if (e.competenciaLancada) pendencias.push(pend('competencia-lancada'));
  if (e.competencia > e.hoje.slice(0, 7)) pendencias.push(pend('competencia-futura'));

  const daFolha = e.vinculos.filter((v) => vinculoNaFolha(v, e.competencia)).sort((a, b) => a.id - b.id);
  if (daFolha.length === 0) pendencias.push(pend('sem-colaboradores'));
  const ids = new Set(daFolha.map((v) => v.id));

  const semCpf = daFolha.filter((v) => !v.cpf || !cpfValido(v.cpf)).map((v) => v.id);
  if (semCpf.length > 0) pendencias.push(pend('cpf-ilegivel', semCpf));

  const fechamentos: FechamentoPontoVinculo[] = daFolha.map((v) => ({
    vinculo: v.id,
    eventos: e.fechamentos.get(v.id) ?? null,
    horas: e.horas?.get(v.id) ?? null,
  }));
  const ponto = exportarEventosPonto(fechamentos, e.eventosDisponiveis);
  if (ponto.semFechamento.length > 0) pendencias.push(pend('ponto-nao-fechado', ponto.semFechamento));
  for (const i of ponto.indisponiveis) pendencias.push(pend('evento-indisponivel', i.vinculos, i.evento));

  const colaboradores: ColaboradorExportado[] = daFolha.map((v) => ({
    vinculo: v.id,
    cpf: v.cpf ?? '',
    matriculaExterna: v.matricula,
    tipoVinculo: v.tipo as TipoVinculoTrabalho,
    admissao: v.admissao,
    desligamento: v.desligamento,
    centroCusto: v.centroCusto,
    setor: v.unidade,
    cbo: v.cbo && /^\d{6}$/.test(v.cbo) ? v.cbo : null,
    conselho: v.conselho,
  }));

  const afastamentos: AfastamentoExportado[] = e.afastamentos
    .filter(
      (a) =>
        a.situacao === 'ativo' &&
        ids.has(a.vinculo) &&
        a.inicio <= fim &&
        (a.fim === null || a.fim >= inicio),
    )
    .map((a) => ({ vinculo: a.vinculo, motivo: a.motivo, inicio: a.inicio, fim: a.fim }))
    .sort((a, b) => a.vinculo - b.vinculo || a.inicio.localeCompare(b.inicio));

  const ccDe = new Map(daFolha.map((v) => [v.id, v.centroCusto]));
  const plantoes: PlantaoExportado[] = e.plantoes
    .filter(
      (p) =>
        ids.has(p.vinculo) &&
        (MODALIDADES_PLANTAO as readonly string[]).includes(p.modalidade) &&
        p.inicio.slice(0, 10) >= inicio &&
        p.inicio.slice(0, 10) <= fim,
    )
    .map((p) => ({
      vinculo: p.vinculo,
      plantao: p.plantao,
      modalidade: p.modalidade as ModalidadePlantao,
      inicio: `${p.inicio.slice(0, 16)}${FUSO_LOCAL_FOLHA}`,
      fim: `${p.fim.slice(0, 16)}${FUSO_LOCAL_FOLHA}`,
      minutos: p.minutos,
      centroCusto: ccDe.get(p.vinculo)!,
    }))
    .sort((a, b) => a.vinculo - b.vinculo || a.inicio.localeCompare(b.inicio) || a.plantao - b.plantao);

  const conteudo = {
    colaboradores,
    afastamentos,
    eventosPonto: [...ponto.eventos],
    horasPonto: [...ponto.horas],
    plantoes,
  };
  const totais = totalizarExportacao(conteudo);
  const conta = contaDaExportacao(totais);
  if (pendencias.length > 0) return { lote: null, pendencias, conta };
  return {
    lote: {
      leiaute: VERSAO_LEIAUTE_FOLHA_INTERFACE,
      lote: e.lote,
      empresa: e.empresa,
      estabelecimento: e.estabelecimento,
      competencia: e.competencia,
      periodo: { inicio, fim },
      geradoEm: e.geradoEm,
      ...conteudo,
      totais,
    },
    pendencias: [],
    conta,
  };
}

/**
 * JSON canônico (chaves em ordem, sem espaço): o mesmo lote dá sempre o mesmo texto, e o resumo SHA-256 dele prova que
 * o arquivo recriado no download é o que foi gerado.
 */
export function jsonCanonico(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(jsonCanonico).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}
