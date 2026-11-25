// Regras do acordo com a fonte pagadora (06-FAT linha 1), puras: o que cada uma das seis regras precisa para ser
// gravada. A API valida aqui antes de gravar e a tela valida na hora (o mesmo código), e o banco reconfere pelos CHECK.
// 1) Percentual ou valor fixo por componente (honorário, custo operacional, anestesia, filme, mat/med...).
// 2) Desconto ou acréscimo por grupo de despesa: um sentido só, com pelo menos um regime e uma parcela.
// 3) Percentual por via de acesso na cirurgia múltipla (ordem do procedimento a partir de 1).
// 4) Item isento: um alvo só (item ou grupo) e o motivo.
// 5) Teto de cobrança: o alvo conforme a abrangência, um limite positivo e o destino do excedente quando transfere.
// 6) Alto custo: um alvo só, a regra e o preço negociado quando a regra é o preço negociado.
// Nada se apaga: a regra trocada se encerra pela vigência (incluir e encerrar), e o histórico fica.
// Toda validação devolve { campo: mensagem }; vazio é válido.

export type ErrosRegra = Record<string, string>;

export const COMPONENTES_PERCENTUAL = [
  'honorario',
  'custo_operacional',
  'anestesia',
  'filme',
  'horario_especial',
  'matmed',
  'nao_credenciado',
  'procedimento_segundo',
  'procedimento_demais',
  'limite_opme',
  'total',
] as const;
export const TIPOS_PACIENTE_REGRA = ['todos', 'internado', 'externo'] as const;
export const REGIMES_DESCONTO = ['ambulatorial', 'externo', 'internacao', 'urgencia', 'domiciliar'] as const;
export const PARCELAS_DESCONTO = ['honorario', 'custo_operacional', 'filme'] as const;
export const CRITERIOS_ORDEM_VIA = ['maior_valor', 'ordem_lancamento', 'maior_porte'] as const;
export const ABRANGENCIAS_TETO = ['item', 'grupo', 'conta', 'custo_paciente_mes'] as const;
export const ACOES_TETO = [
  'bloquear_atendimento',
  'bloquear_lancamento',
  'alertar',
  'transferir_excedente',
] as const;
export const REGRAS_ALTO_CUSTO = ['cobranca_a_parte', 'exige_autorizacao', 'preco_negociado'] as const;

export const TIPOS_REGRA_ACORDO = ['percentual', 'desconto', 'via', 'isento', 'teto', 'alto-custo'] as const;
export type TipoRegraAcordo = (typeof TIPOS_REGRA_ACORDO)[number];

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dentro = (v: string, lista: readonly string[]) => lista.includes(v);
const temValor = (v: number | null | undefined): v is number => v !== null && v !== undefined;

export interface VigenciaEntrada {
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string | null;
}

/** O início é uma data e o fim, quando houver, não vem antes dele. */
export function validarVigenciaRegra(e: VigenciaEntrada): ErrosRegra {
  const erros: ErrosRegra = {};
  if (!DATA.test(e.vigenciaInicio ?? '')) erros['vigenciaInicio'] = 'Informe o início da vigência.';
  else if (e.vigenciaFim && !DATA.test(e.vigenciaFim)) erros['vigenciaFim'] = 'O fim da vigência é uma data.';
  else if (e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

export interface EntradaPercentualCobranca extends VigenciaEntrada {
  readonly tabelaId: number | null;
  readonly componente: string;
  readonly tipoPaciente: string;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly percentual: number | null;
  readonly valorFixo: number | null;
  readonly quantidadeFixa: number | null;
}

/** Percentual de 0 a 999, valor e quantidade não negativos, ao menos um dos três e no máximo um alvo (item ou grupo). */
export function validarPercentualCobranca(e: EntradaPercentualCobranca): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (!temValor(e.tabelaId)) erros['tabelaId'] = 'Escolha a tabela de preço sobre a qual a regra incide.';
  if (!dentro(e.componente, COMPONENTES_PERCENTUAL)) erros['componente'] = 'Escolha a parcela do preço.';
  if (!dentro(e.tipoPaciente, TIPOS_PACIENTE_REGRA)) erros['tipoPaciente'] = 'Escolha o tipo de paciente.';
  if (!temValor(e.percentual) && !temValor(e.valorFixo) && !temValor(e.quantidadeFixa))
    erros['percentual'] = 'Informe o percentual, o valor fixo ou a quantidade fixa.';
  else if (temValor(e.percentual) && (e.percentual < 0 || e.percentual > 999))
    erros['percentual'] = 'O percentual vai de 0 a 999.';
  if (temValor(e.valorFixo) && e.valorFixo < 0) erros['valorFixo'] = 'O valor fixo não pode ser negativo.';
  if (temValor(e.quantidadeFixa) && e.quantidadeFixa < 0)
    erros['quantidadeFixa'] = 'A quantidade fixa não pode ser negativa.';
  if (temValor(e.itemId) && temValor(e.grupoId))
    erros['grupoId'] = 'A regra vale para um item ou para um grupo, não os dois.';
  return erros;
}

export interface EntradaDescontoGrupo extends VigenciaEntrada {
  readonly grupoId: number | null;
  readonly acrescimo: number;
  readonly desconto: number;
  readonly regimes: readonly string[];
  readonly sobre: readonly string[];
}

/** Um sentido só (acréscimo de 0 a 1000% ou desconto de 0 a 100%), diferente de zero, com regime e parcela. */
export function validarDescontoGrupo(e: EntradaDescontoGrupo): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (!temValor(e.grupoId)) erros['grupoId'] = 'Escolha o grupo de despesa.';
  if (e.acrescimo > 0 && e.desconto > 0)
    erros['desconto'] = 'A regra é desconto ou acréscimo, nunca os dois no mesmo grupo.';
  else if (!(e.acrescimo > 0) && !(e.desconto > 0)) erros['desconto'] = 'Informe o desconto ou o acréscimo.';
  if (e.desconto < 0 || e.desconto > 100) erros['desconto'] = 'O desconto vai de 0 a 100%.';
  if (e.acrescimo < 0 || e.acrescimo > 1000) erros['acrescimo'] = 'O acréscimo vai de 0 a 1000%.';
  if (!e.regimes.length || e.regimes.some((r) => !dentro(r, REGIMES_DESCONTO)))
    erros['regimes'] = 'Marque ao menos um regime de atendimento.';
  if (e.sobre.some((s) => !dentro(s, PARCELAS_DESCONTO))) erros['sobre'] = 'Parcela desconhecida.';
  return erros;
}

export interface EntradaViaAcesso extends VigenciaEntrada {
  readonly descricao: string;
  readonly viaId: number | null;
  readonly ordem: number;
  readonly percentual: number;
  readonly criterio: string;
}

/** A ordem começa em 1 (o principal), o percentual vai de 0 a 999 e o critério de ordem é conhecido. */
export function validarViaAcesso(e: EntradaViaAcesso): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (!e.descricao?.trim()) erros['descricao'] = 'Descreva a regra.';
  if (!temValor(e.viaId)) erros['viaId'] = 'Escolha a via de acesso.';
  if (!Number.isInteger(e.ordem) || e.ordem < 1)
    erros['ordem'] = 'A ordem do procedimento começa em 1 (o principal).';
  if (!(e.percentual >= 0 && e.percentual <= 999)) erros['percentual'] = 'O percentual vai de 0 a 999.';
  if (!dentro(e.criterio, CRITERIOS_ORDEM_VIA)) erros['criterio'] = 'Escolha como a ordem é definida.';
  return erros;
}

export interface EntradaIsento extends VigenciaEntrada {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly motivo: string;
}

/** Um alvo só (o item ou o grupo inteiro) e o motivo da isenção. */
export function validarIsento(e: EntradaIsento): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (temValor(e.itemId) === temValor(e.grupoId))
    erros['itemId'] = 'A isenção vale para um item ou para um grupo inteiro: escolha um dos dois.';
  if ((e.motivo ?? '').trim().length < 3) erros['motivo'] = 'Informe o motivo da isenção.';
  return erros;
}

export interface EntradaTeto extends VigenciaEntrada {
  readonly fonteId: number;
  readonly planoId: number | null;
  readonly abrangencia: string;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly valorTeto: number | null;
  readonly quantidadeMaxima: number | null;
  readonly ocorrenciasMaximas: number | null;
  readonly acao: string;
  readonly excedenteFonteId: number | null;
  readonly excedentePlanoId: number | null;
}

/**
 * O alvo segue a abrangência (item pede o item; grupo, o grupo; conta e custo do paciente no mês não têm alvo), um
 * limite positivo, e o excedente só existe quando a ação transfere: vai para outra fonte, ou para outro plano da mesma.
 */
export function validarTeto(e: EntradaTeto): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (!dentro(e.abrangencia, ABRANGENCIAS_TETO)) erros['abrangencia'] = 'Escolha a abrangência do teto.';
  if (e.abrangencia === 'item' && !temValor(e.itemId)) erros['itemId'] = 'O teto por item pede o item.';
  if (e.abrangencia === 'grupo' && !temValor(e.grupoId)) erros['grupoId'] = 'O teto por grupo pede o grupo.';
  if (e.abrangencia !== 'item' && temValor(e.itemId)) erros['itemId'] = 'Só o teto por item tem item.';
  if (e.abrangencia !== 'grupo' && temValor(e.grupoId)) erros['grupoId'] = 'Só o teto por grupo tem grupo.';
  const positivo = (v: number | null) => temValor(v) && v > 0;
  if (!positivo(e.valorTeto) && !positivo(e.quantidadeMaxima) && !positivo(e.ocorrenciasMaximas))
    erros['valorTeto'] = 'Informe um limite maior que zero: valor, quantidade ou vezes.';
  for (const [c, v] of [
    ['valorTeto', e.valorTeto],
    ['quantidadeMaxima', e.quantidadeMaxima],
    ['ocorrenciasMaximas', e.ocorrenciasMaximas],
  ] as const)
    if (temValor(v) && v < 0) erros[c] = 'O limite não pode ser negativo.';
  if (temValor(e.ocorrenciasMaximas) && !Number.isInteger(e.ocorrenciasMaximas))
    erros['ocorrenciasMaximas'] = 'O número de vezes é inteiro.';
  if (!dentro(e.acao, ACOES_TETO)) erros['acao'] = 'Escolha o que acontece ao passar do teto.';
  if (e.acao === 'transferir_excedente') {
    if (!temValor(e.excedenteFonteId))
      erros['excedenteFonteId'] = 'Escolha a fonte pagadora que recebe o excedente.';
    else if (
      e.excedenteFonteId === e.fonteId &&
      (!temValor(e.excedentePlanoId) || e.excedentePlanoId === e.planoId)
    )
      erros['excedentePlanoId'] =
        'Na mesma fonte pagadora, o excedente vai para outro plano: escolha o plano que o recebe.';
  } else if (temValor(e.excedenteFonteId) || temValor(e.excedentePlanoId))
    erros['excedenteFonteId'] = 'O destino do excedente só vale quando a ação transfere o excedente.';
  return erros;
}

export interface EntradaAltoCusto extends VigenciaEntrada {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly regra: string;
  readonly valorBase: number | null;
  readonly valorNegociado: number | null;
}

/** Um alvo só, a regra conhecida, o preço negociado só (e sempre) na regra do preço negociado; valores não negativos. */
export function validarAltoCusto(e: EntradaAltoCusto): ErrosRegra {
  const erros = validarVigenciaRegra(e);
  if (temValor(e.itemId) === temValor(e.grupoId))
    erros['itemId'] = 'O alto custo vale para um item ou para um grupo: escolha um dos dois.';
  if (!dentro(e.regra, REGRAS_ALTO_CUSTO)) erros['regra'] = 'Escolha a regra do alto custo.';
  if (e.regra === 'preco_negociado' && !temValor(e.valorNegociado))
    erros['valorNegociado'] = 'Informe o preço negociado.';
  if (e.regra !== 'preco_negociado' && temValor(e.valorNegociado))
    erros['valorNegociado'] = 'O preço negociado só vale na regra do preço negociado.';
  if (temValor(e.valorBase) && e.valorBase < 0) erros['valorBase'] = 'O valor base não pode ser negativo.';
  if (temValor(e.valorNegociado) && e.valorNegociado < 0)
    erros['valorNegociado'] = 'O preço negociado não pode ser negativo.';
  return erros;
}

/**
 * Encerrar sem reescrever o passado: o fim não vem antes do início nem de hoje (contas já lançadas usaram a regra),
 * e a regra já encerrada antes de hoje não muda.
 */
export function validarEncerramentoRegra(
  inicio: string,
  fimAtual: string | null,
  novoFim: string,
  hoje: string,
): ErrosRegra {
  if (!DATA.test(novoFim)) return { vigenciaFim: 'Informe o fim da vigência.' };
  if (fimAtual !== null && fimAtual < hoje)
    return { id: 'A regra já foi encerrada no passado: o histórico não se reescreve.' };
  if (novoFim < inicio) return { vigenciaFim: 'O fim da vigência não pode ser antes do início.' };
  if (novoFim < hoje)
    return {
      vigenciaFim:
        'O fim da vigência não pode ser antes de hoje: contas já lançadas usaram esta regra. Grave uma regra nova a partir de hoje.',
    };
  return {};
}

/**
 * A regra nova que encerra outra ainda vigente (incluir encerra a anterior na véspera do início) não pode começar antes
 * de hoje: o fim da anterior iria para o passado e reescreveria a regra que já valorizou contas lançadas, o mesmo que
 * validarEncerramentoRegra proíbe na rota de encerrar. Sem regra anterior vigente, o início retroativo é livre.
 */
export function validarInicioQueEncerra(novoInicio: string, hoje: string): ErrosRegra {
  if (novoInicio < hoje)
    return {
      vigenciaInicio:
        'Já existe regra igual vigente: a nova não pode começar antes de hoje, porque contas já lançadas usaram a anterior. Grave a partir de hoje.',
    };
  return {};
}
