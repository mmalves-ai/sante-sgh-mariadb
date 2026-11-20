// Rescisão do contrato de trabalho (M53-F4; ficha do M53, seções 1, 6 a 8, regras 7 e 8; CLT arts. 477 a 487, Lei
// 12.506/2011, Lei 4.090/1962, Lei 8.036/1990 art. 18): a modalidade do desligamento (sem justa causa, justa causa,
// pedido de demissão, acordo do art. 484-A, término ou antecipação do contrato a termo, culpa recíproca, rescisão
// indireta, falecimento), o aviso prévio (indenizado, trabalhado, dispensado ou não cumprido) com os dias da Lei
// 12.506/2011 e a projeção, e o termo calculado: saldo de salário e variáveis do mês, aviso, férias vencidas e
// proporcionais com o terço, 13º proporcional menos o adiantamento, indenização do art. 479 e a multa do FGTS (um
// processamento `rescisao` com a memória por rubrica). O desligamento (data e motivo) é registrado no colaborador (M52);
// aqui ele é lido. Valores em centavos; nenhuma resposta traz CPF ou nome: só vínculo (ID), matrícula, datas e valores.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type {
  CabecalhoProcessoFolha,
  ColaboradorCalculado,
  ConferenciaCalculoFolha,
  LinhaCalculoFolha,
  PendenciaCalculo,
  ResumoProcessoFolha,
} from './folha-calculo.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);

// ── Modalidade e aviso prévio ─────────────────────────────────────────────────────────────────────────────────

/**
 * A modalidade da rescisão (o que define as verbas), com o código do motivo do desligamento do eSocial (tabela 19)
 * entre parênteses:
 * - sem-justa-causa (02): aviso do empregador, 13º e férias proporcionais, multa de 40% do FGTS;
 * - justa-causa (01): saldo de salário e férias vencidas; sem aviso, sem proporcionais, sem multa;
 * - pedido-demissao (07): aviso do empregado (30 dias: trabalhado, dispensado ou não cumprido, com desconto);
 *   13º e férias proporcionais (Súmula 261 do TST); sem multa;
 * - acordo (33, art. 484-A): metade do aviso indenizado, proporcionais inteiros, multa de 20%;
 * - termino-contrato (06): fim do contrato a termo (experiência) na data: proporcionais, sem aviso nem multa;
 * - antecipada-empregador (03): antecipação do termo pelo empregador: indenização do art. 479 (metade dos dias até o
 *   termo) e multa de 40%;
 * - antecipada-empregado (04): antecipação do termo pelo empregado: proporcionais, sem multa (a indenização do art. 480
 *   é lançamento à parte);
 * - culpa-reciproca (05): metade do aviso, do 13º e das férias proporcionais (Súmula 14 do TST), multa de 20%;
 * - rescisao-indireta (17): como a sem justa causa (art. 483);
 * - falecimento (10): saldo, 13º e férias (vencidas e proporcionais) aos dependentes; sem aviso nem multa.
 */
export const MODALIDADES_RESCISAO = [
  'sem-justa-causa',
  'justa-causa',
  'pedido-demissao',
  'acordo',
  'termino-contrato',
  'antecipada-empregador',
  'antecipada-empregado',
  'culpa-reciproca',
  'rescisao-indireta',
  'falecimento',
] as const;
export type ModalidadeRescisao = (typeof MODALIDADES_RESCISAO)[number];

/** O código do motivo do desligamento no eSocial (tabela 19) de cada modalidade (para o S-2299 da etapa do eSocial). */
export const MOTIVO_ESOCIAL_DA_MODALIDADE: Readonly<Record<ModalidadeRescisao, string>> = {
  'sem-justa-causa': '02',
  'justa-causa': '01',
  'pedido-demissao': '07',
  acordo: '33',
  'termino-contrato': '06',
  'antecipada-empregador': '03',
  'antecipada-empregado': '04',
  'culpa-reciproca': '05',
  'rescisao-indireta': '17',
  falecimento: '10',
};

/**
 * O aviso prévio:
 * - indenizado: o empregador paga os dias e o contrato se projeta até o fim deles (OJ 82 e 83 da SDI-1 do TST);
 * - trabalhado: os 30 dias foram trabalhados até o desligamento; os dias da Lei 12.506/2011 além dos 30 saem indenizados;
 * - dispensado: o empregado pediu demissão e o empregador dispensou o cumprimento (nada a pagar nem a descontar);
 * - nao-cumprido: o empregado pediu demissão e não cumpriu o aviso: desconto dos 30 dias (art. 487 §2);
 * - nenhum: a modalidade não tem aviso (justa causa, contrato a termo, falecimento).
 */
export const AVISOS_PREVIOS = ['indenizado', 'trabalhado', 'dispensado', 'nao-cumprido', 'nenhum'] as const;
export type AvisoPrevio = (typeof AVISOS_PREVIOS)[number];

/** Os avisos que cada modalidade aceita (o primeiro é o padrão da tela). */
export const AVISOS_DA_MODALIDADE: Readonly<Record<ModalidadeRescisao, readonly AvisoPrevio[]>> = {
  'sem-justa-causa': ['indenizado', 'trabalhado'],
  'justa-causa': ['nenhum'],
  'pedido-demissao': ['trabalhado', 'dispensado', 'nao-cumprido'],
  acordo: ['indenizado', 'trabalhado'],
  'termino-contrato': ['nenhum'],
  'antecipada-empregador': ['nenhum'],
  'antecipada-empregado': ['nenhum'],
  'culpa-reciproca': ['indenizado', 'trabalhado'],
  'rescisao-indireta': ['indenizado'],
  falecimento: ['nenhum'],
};

/** O tipo de rescisão do cadastro (domínio do motivo do desligamento do colaborador), com a modalidade sugerida. */
export interface TipoRescisaoFolha {
  readonly id: number;
  readonly nome: string;
  /** A modalidade que o tipo sugere (null: o DP escolhe). */
  readonly modalidade: ModalidadeRescisao | null;
}

// ── Rescisão registrada ───────────────────────────────────────────────────────────────────────────────────────

/** `calculada`: a que vale (uma por vínculo); `substituida`: um cálculo novo a trocou; `cancelada`: retirada, com motivo. */
export const SITUACOES_RESCISAO = ['calculada', 'substituida', 'cancelada'] as const;
export type SituacaoRescisao = (typeof SITUACOES_RESCISAO)[number];

/** Uma rescisão gravada (SGH_PES_RESCISAO), ligada ao processamento `rescisao` com as linhas e a memória. */
export interface RescisaoDoVinculo {
  readonly id: number;
  readonly vinculo: number;
  readonly empresa: number;
  readonly desligamento: string;
  /** O tipo de rescisão do desligamento registrado no colaborador. */
  readonly tipoRescisao: number | null;
  readonly modalidade: ModalidadeRescisao;
  readonly aviso: AvisoPrevio;
  /** Dias de aviso devidos (Lei 12.506/2011: 30 + 3 por ano completo, até 90; 30 no pedido de demissão). */
  readonly diasAviso: number;
  /** Dias de aviso pagos como indenização (projetam o contrato). */
  readonly diasIndenizados: number;
  /** A data projetada do fim do contrato (desligamento + dias indenizados). */
  readonly projecao: string;
  /** O termo do contrato a prazo (antecipação; art. 479); null nas demais. */
  readonly termo: string | null;
  /**
   * Saldo do FGTS para fins rescisórios usado na multa (informado pelo DP, ou a soma dos depósitos registrados).
   * null para quem não tem `pessoas.salario.ler`: o saldo e a multa revelam a remuneração (D-PERM-SAL-535).
   */
  readonly saldoFgts: number | null;
  readonly saldoFgtsInformado: boolean;
  /** A multa do FGTS; null sem `pessoas.salario.ler` (D-PERM-SAL-535, D-MULTA-LISTA-535). */
  readonly multaFgts: number | null;
  /** Pagamento até 10 dias depois do desligamento (art. 477 §6). */
  readonly pagamento: string;
  readonly situacao: SituacaoRescisao;
  readonly processo: number;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export const esquemaFiltroRescisoes = z
  .object({
    vinculo: id.optional(),
    empresa: smallint.optional(),
    /** Desligamentos de [de, ate]. */
    de: data.optional(),
    ate: data.optional(),
    situacao: z.enum(SITUACOES_RESCISAO).optional(),
  })
  .strict()
  .refine((x) => !(x.de && x.ate && x.de > x.ate), {
    message: 'O início do intervalo vem antes do fim.',
    path: ['ate'],
  });
export type FiltroRescisoes = z.infer<typeof esquemaFiltroRescisoes>;

export interface ListaRescisoes {
  readonly itens: readonly RescisaoDoVinculo[];
  readonly limitado: boolean;
}

// ── Cálculo ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Calcular a rescisão do colaborador desligado (`pessoas.rescisao.calcular`); `simular` devolve a prévia sem gravar. */
export const esquemaCalcularRescisao = z
  .object({
    vinculo: z.number().int().positive(),
    empresa: z.number().int().min(0).max(32_767),
    modalidade: z.enum(MODALIDADES_RESCISAO),
    aviso: z.enum(AVISOS_PREVIOS),
    /** O termo do contrato a prazo (obrigatório na antecipação pelo empregador, para a indenização do art. 479). */
    termo: data.nullable().default(null),
    /** Saldo do FGTS para fins rescisórios (extrato da conta vinculada); null: a soma dos depósitos registrados aqui. */
    saldoFgts: z.number().int().min(0).max(99_999_999_999).nullable().default(null),
    /** null: o desligamento + 10 dias (art. 477 §6). */
    pagamento: data.nullable().default(null),
    simular: z.boolean().default(false),
  })
  .strict();
export type CalcularRescisaoEntrada = z.infer<typeof esquemaCalcularRescisao>;

/**
 * Recusas do cálculo, antes da conta (a tela traduz por `folha.rescisao.recusa.<codigo>`):
 * - vinculo-ativo: o colaborador não tem desligamento registrado; vinculo-sem-rescisao: o vínculo não é CLT;
 * - aviso-invalido: o aviso não serve à modalidade; termo-obrigatorio: antecipação sem o termo do contrato;
 * - termo-invalido: o termo não vem depois do desligamento; pagamento-antes: pagamento antes do desligamento.
 */
export const RECUSAS_RESCISAO = [
  'vinculo-ativo',
  'vinculo-sem-rescisao',
  'aviso-invalido',
  'termo-obrigatorio',
  'termo-invalido',
  'pagamento-antes',
] as const;
export type RecusaRescisao = (typeof RECUSAS_RESCISAO)[number];

/**
 * Avisos do cálculo (não barram; a tela traduz por `folha.rescisao.aviso.<codigo>`):
 * - ponto-nao-fechado: o ponto do mês do desligamento não está fechado: as horas extras, o adicional noturno, as faltas e
 *   os atrasos do mês não entram (feche o ponto e calcule de novo);
 * - saldo-fgts-estimado: sem o saldo do extrato, a multa usa a soma dos depósitos registrados neste sistema;
 * - pagamento-fora-do-prazo: o pagamento passa de 10 dias depois do desligamento (art. 477 §6, multa do §8);
 * - ferias-programadas: há férias programadas sem recibo: ao gravar, elas são canceladas e os dias saem indenizados;
 * - competencias-sem-calculo: competência sem folha mensal calculada nos 12 meses anteriores (as médias contam só as
 *   calculadas);
 * - decimo-ja-pago: a parcela final do 13º do ano já foi paga ao colaborador (o 13º do ano não entra de novo).
 */
export const AVISOS_RESCISAO = [
  'ponto-nao-fechado',
  'saldo-fgts-estimado',
  'pagamento-fora-do-prazo',
  'ferias-programadas',
  'competencias-sem-calculo',
  'decimo-ja-pago',
] as const;
export type AvisoRescisao = (typeof AVISOS_RESCISAO)[number];

/** O que o cálculo apurou antes das verbas (para a tela mostrar a conta do aviso, da projeção e da multa). */
export interface ApuracaoRescisao {
  readonly desligamento: string;
  readonly competencia: string;
  readonly diasAviso: number;
  readonly diasIndenizados: number;
  readonly projecao: string;
  /** Anos completos de serviço até o desligamento (os 3 dias por ano da Lei 12.506/2011). */
  readonly anosCompletos: number;
  readonly diasSaldo: number;
  readonly avosDecimo: number;
  readonly avosDecimoAviso: number;
  readonly saldoFgts: number;
  readonly saldoFgtsInformado: boolean;
  /** O FGTS desta rescisão (mês e 13º): a base da multa é `saldoFgts + fgtsRescisao`. */
  readonly fgtsRescisao: number;
  /** Percentual da multa do FGTS em centésimos de ponto (4000 = 40%; 0: sem multa). */
  readonly percentualMulta: number;
  readonly multaFgts: number;
  readonly pagamento: string;
}

export interface ResultadoCalculoRescisao {
  readonly calculado: boolean;
  readonly simulado: boolean;
  readonly rescisao: RescisaoDoVinculo | null;
  readonly processo: ResumoProcessoFolha | null;
  /** A rescisão anterior do vínculo que esta substituiu (null: nenhuma). */
  readonly substituida: number | null;
  readonly apuracao: ApuracaoRescisao | null;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly avisos: readonly { readonly codigo: AvisoRescisao; readonly competencias: readonly string[] }[];
  readonly resumo: ColaboradorCalculado | null;
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly conferencia: ConferenciaCalculoFolha | null;
}

export interface DetalheRescisao {
  readonly rescisao: RescisaoDoVinculo;
  /** Sem `pessoas.salario.ler`, o cabeçalho vem sem os totais e sem o resumo (D-PERM-SAL-533). */
  readonly processo: CabecalhoProcessoFolha | null;
  /** Vazia sem `pessoas.salario.ler` (D-PERM-SAL-533): os valores do termo revelam o salário. */
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly linhasOcultas: boolean;
}

/** Cancelar a rescisão em vigor (o processamento vai a `descartada` junto), com motivo. */
export const esquemaCancelarRescisao = z
  .object({ versao: z.number().int().min(0), motivo: textoCp1252(200).trim().min(3) })
  .strict();
export type CancelarRescisaoEntrada = z.infer<typeof esquemaCancelarRescisao>;

/** Os colaboradores desligados de um intervalo, com a rescisão em vigor (para a fila do DP). */
export const esquemaFiltroDesligados = z
  .object({ de: data, ate: data })
  .strict()
  .refine((x) => x.de <= x.ate, { message: 'O início do intervalo vem antes do fim.', path: ['ate'] });
export type FiltroDesligados = z.infer<typeof esquemaFiltroDesligados>;

export interface DesligadoParaRescisao {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly desligamento: string;
  readonly tipoRescisao: number | null;
  /** A modalidade que o tipo de rescisão do desligamento sugere (null: o DP escolhe). */
  readonly modalidadeSugerida: ModalidadeRescisao | null;
  /** A rescisão em vigor (`calculada`); null: ainda não calculada. */
  readonly rescisao: number | null;
}

export interface ListaDesligados {
  readonly itens: readonly DesligadoParaRescisao[];
  readonly limitado: boolean;
}

/** O apoio da tela de rescisão: o que a sessão pode fazer, as modalidades e os tipos de rescisão do cadastro. */
export interface ApoioRescisao {
  readonly hoje: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly calcular: boolean;
    readonly verSalario: boolean;
    readonly motivo: string | null;
  };
  readonly empresas: readonly { readonly codigo: number; readonly rotulo: string }[];
  readonly modalidades: readonly {
    readonly modalidade: ModalidadeRescisao;
    readonly avisos: readonly AvisoPrevio[];
  }[];
  readonly tiposRescisao: readonly TipoRescisaoFolha[];
}

/**
 * As parcelas da multa do FGTS de uma rescisão gravada, tiradas das linhas do termo (D-MULTA-535): o FGTS desta
 * rescisão é a linha `fgts` (mês e 13º somados) e o percentual é a quantidade da linha `multaFgts`. A conta impressa é
 * `(saldo + FGTS desta rescisão) × percentual = multa`. Sem a linha da multa (modalidade sem multa ou linhas ocultas),
 * o percentual é 0.
 */
export function parcelasMultaFgts(
  linhas: readonly Pick<LinhaCalculoFolha, 'papel' | 'valor' | 'quantidade'>[],
): { readonly fgtsRescisao: number; readonly percentual: number } {
  const multa = linhas.find((l) => l.papel === 'multaFgts');
  const fgtsRescisao = linhas.filter((l) => l.papel === 'fgts').reduce((s, l) => s + l.valor, 0);
  return { fgtsRescisao, percentual: multa?.quantidade ?? 0 };
}
