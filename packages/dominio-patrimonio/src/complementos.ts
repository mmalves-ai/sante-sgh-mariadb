// F8 (07-FIN linha 149; CPC 27 / NBC TG 27): agregação de valor ao bem, imobilizado em andamento e seguro dos bens.
// - Agregação: o gasto posterior que aumenta a vida útil ou a capacidade do bem (melhoria, componente, serviço) soma ao
//   custo e passa a depreciar da competência seguinte em diante (prospectivo: as cotas passadas ficam). A retirada do
//   componente (desagregação) registra a data e tira o valor da base dali em diante; nada se apaga.
// - Imobilizado em andamento: a obra ou montagem acumula os custos apropriados (cada um ligado ao título a pagar ou à
//   nota de entrada) e NÃO deprecia; a ativação gera o bem pelo custo acumulado, com a depreciação a partir do mês
//   seguinte. A apropriação negativa (devolução, abatimento) não deixa o acumulado abaixo de zero.
// - Seguro: a apólice tem seguradora, vigência e prêmio; o bem entra na cobertura com o valor segurado, dentro da
//   vigência; a tela mostra o subseguro (valor segurado abaixo de 80% do valor contábil: cláusula de rateio).
import { competenciaDe, mesSeguinte } from './origem.js';

const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Agregação de valor ──────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_AGREGACAO = ['componente', 'melhoria', 'servico', 'outro'] as const;
export type TipoAgregacao = (typeof TIPOS_AGREGACAO)[number];

export interface NovaAgregacao {
  readonly tipo: string;
  readonly bemAgregado: number | null;
  readonly descricao: string;
  readonly data: string;
  readonly valorCent: number;
  readonly agregaValor: boolean;
}

export interface SituacaoParaAgregacao {
  readonly bem: {
    readonly id: number;
    readonly situacao: string;
    readonly dataAquisicao: string;
    /** O bem tem ajuste de valor vigente que é marco da depreciação (a base passa a ser a do marco). */
    readonly temMarcoAjuste: boolean;
  };
  /** O bem incorporado como componente (null: não é componente ou não existe). */
  readonly agregado: {
    readonly id: number;
    readonly situacao: string;
    readonly jaAgregadoEm: number | null;
  } | null;
  readonly hoje: string;
}

export type CodigoAgregacao =
  | 'tipo-invalido'
  | 'bem-baixado'
  | 'componente-sem-bem'
  | 'componente-inexistente'
  | 'componente-proprio'
  | 'componente-baixado'
  | 'componente-ja-agregado'
  | 'descricao-curta'
  | 'data-invalida'
  | 'data-futura'
  | 'data-antes-aquisicao'
  | 'valor-negativo'
  | 'sem-valor'
  | 'ajuste-vigente';

export const MENSAGENS_AGREGACAO: Record<CodigoAgregacao, string> = {
  'tipo-invalido': 'Escolha o tipo: componente, melhoria, serviço ou outro.',
  'bem-baixado': 'O bem está baixado: não recebe agregação.',
  'componente-sem-bem': 'O componente é outro bem: informe a plaqueta do bem incorporado.',
  'componente-inexistente': 'O bem incorporado não existe neste estabelecimento.',
  'componente-proprio': 'O bem não se agrega a ele mesmo.',
  'componente-baixado': 'O bem incorporado está baixado.',
  'componente-ja-agregado': 'O bem incorporado já é componente de outro bem: desagregue-o antes.',
  'descricao-curta': 'Descreva a agregação com ao menos 5 letras.',
  'data-invalida': 'Informe uma data válida.',
  'data-futura': 'A data não pode ser futura.',
  'data-antes-aquisicao': 'A agregação não pode ser anterior à aquisição do bem.',
  'valor-negativo': 'O valor não pode ser negativo.',
  'sem-valor': 'A agregação que soma ao custo precisa de valor maior que zero.',
  'ajuste-vigente':
    'O bem tem ajuste de valor vigente (revisão ou recuperabilidade): estorne-o ou registre a agregação sem somar ao custo.',
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Os erros da agregação (vazio: pode gravar). */
export function errosAgregacao(e: NovaAgregacao, s: SituacaoParaAgregacao): CodigoAgregacao[] {
  const r: CodigoAgregacao[] = [];
  if (!(TIPOS_AGREGACAO as readonly string[]).includes(e.tipo)) r.push('tipo-invalido');
  if (s.bem.situacao === 'baixado') r.push('bem-baixado');
  if (e.tipo === 'componente') {
    if (e.bemAgregado === null) r.push('componente-sem-bem');
    else if (e.bemAgregado === s.bem.id) r.push('componente-proprio');
    else if (!s.agregado) r.push('componente-inexistente');
    else {
      if (s.agregado.situacao === 'baixado') r.push('componente-baixado');
      if (s.agregado.jaAgregadoEm !== null && s.agregado.jaAgregadoEm !== s.bem.id)
        r.push('componente-ja-agregado');
    }
  }
  if (e.descricao.trim().length < 5) r.push('descricao-curta');
  if (!DATA.test(e.data)) r.push('data-invalida');
  else {
    if (e.data > s.hoje) r.push('data-futura');
    if (e.data < s.bem.dataAquisicao) r.push('data-antes-aquisicao');
  }
  if (e.valorCent < 0) r.push('valor-negativo');
  else if (e.agregaValor && e.valorCent === 0) r.push('sem-valor');
  if (e.agregaValor && s.bem.temMarcoAjuste) r.push('ajuste-vigente');
  return r;
}

/** A agregação gravada como a regra a vê. */
export interface AgregacaoVigente {
  readonly sequencia: number;
  readonly data: string;
  readonly valorCent: number;
  readonly agregaValor: boolean;
  readonly dataDesagregacao: string | null;
}

/** A próxima sequência do bem. */
export const proximaSequencia = (lista: readonly { readonly sequencia: number }[]): number =>
  lista.reduce((m, a) => Math.max(m, a.sequencia), 0) + 1;

/**
 * O valor agregado que entra na base da depreciação da competência (AAAA-MM): só a que soma ao custo, registrada
 * ANTES do primeiro dia da competência e ainda não retirada nesse dia (prospectivo).
 */
export function valorAgregadoNaCompetencia(lista: readonly AgregacaoVigente[], competencia: string): number {
  const dia = `${competencia}-01`;
  return lista
    .filter(
      (a) => a.agregaValor && a.data < dia && (a.dataDesagregacao === null || a.dataDesagregacao >= dia),
    )
    .reduce((s, a) => s + a.valorCent, 0);
}

export type CodigoDesagregacao =
  'ja-desagregado' | 'data-invalida' | 'data-antes' | 'data-futura' | 'motivo-curto';
export const MENSAGENS_DESAGREGACAO: Record<CodigoDesagregacao, string> = {
  'ja-desagregado': 'A agregação já foi retirada.',
  'data-invalida': 'Informe uma data válida.',
  'data-antes': 'A retirada não pode ser anterior à agregação.',
  'data-futura': 'A data não pode ser futura.',
  'motivo-curto': 'Escreva o motivo da retirada com ao menos 5 letras.',
};

export function errosDesagregacao(
  a: { readonly data: string; readonly dataDesagregacao: string | null },
  e: { readonly data: string; readonly motivo: string },
  hoje: string,
): CodigoDesagregacao[] {
  const r: CodigoDesagregacao[] = [];
  if (a.dataDesagregacao !== null) r.push('ja-desagregado');
  if (!DATA.test(e.data)) r.push('data-invalida');
  else {
    if (e.data < a.data) r.push('data-antes');
    if (e.data > hoje) r.push('data-futura');
  }
  if (e.motivo.trim().length < 5) r.push('motivo-curto');
  return r;
}

// ── Imobilizado em andamento ──────────────────────────────────────────────────────────────────────────────────────

export type CodigoAndamento =
  | 'descricao-curta'
  | 'data-invalida'
  | 'data-futura'
  | 'previsao-antes-inicio'
  | 'orcado-negativo'
  | 'nao-em-andamento'
  | 'sem-documento'
  | 'valor-zero'
  | 'data-antes-inicio'
  | 'acumulado-negativo'
  | 'documento-repetido'
  | 'sem-custo'
  | 'data-antes-apropriacao'
  | 'com-custo'
  | 'vida-invalida'
  | 'motivo-curto';

export const MENSAGENS_ANDAMENTO: Record<CodigoAndamento, string> = {
  'descricao-curta': 'Descreva a obra ou montagem com ao menos 5 letras.',
  'data-invalida': 'Informe uma data válida.',
  'data-futura': 'A data não pode ser futura.',
  'previsao-antes-inicio': 'A conclusão prevista vem depois do início.',
  'orcado-negativo': 'O valor orçado não pode ser negativo.',
  'nao-em-andamento': 'A obra não está em andamento (já ativada ou cancelada).',
  'sem-documento': 'Ligue o custo ao título a pagar ou à nota de entrada.',
  'valor-zero': 'O valor da apropriação não pode ser zero.',
  'data-antes-inicio': 'A data não pode ser anterior ao início da obra.',
  'acumulado-negativo': 'O abatimento deixaria o custo acumulado negativo.',
  'documento-repetido': 'Este documento já foi apropriado a esta obra com o mesmo valor.',
  'sem-custo': 'A obra não tem custo acumulado: não há o que ativar.',
  'data-antes-apropriacao': 'A ativação não pode ser anterior à última apropriação.',
  'com-custo': 'A obra tem custo apropriado: ative-a ou abata os custos antes de cancelar.',
  'vida-invalida': 'Informe a vida útil do bem em meses (1 a 1200).',
  'motivo-curto': 'Escreva o motivo com ao menos 5 letras.',
};

export interface NovaObra {
  readonly descricao: string;
  readonly dataInicio: string;
  readonly dataPrevista: string | null;
  readonly valorOrcadoCent: number | null;
}

export function errosAberturaObra(e: NovaObra, hoje: string): CodigoAndamento[] {
  const r: CodigoAndamento[] = [];
  if (e.descricao.trim().length < 5) r.push('descricao-curta');
  if (!DATA.test(e.dataInicio)) r.push('data-invalida');
  else {
    if (e.dataInicio > hoje) r.push('data-futura');
    if (e.dataPrevista !== null && DATA.test(e.dataPrevista) && e.dataPrevista < e.dataInicio)
      r.push('previsao-antes-inicio');
  }
  if (e.dataPrevista !== null && !DATA.test(e.dataPrevista) && !r.includes('data-invalida'))
    r.push('data-invalida');
  if (e.valorOrcadoCent !== null && e.valorOrcadoCent < 0) r.push('orcado-negativo');
  return r;
}

export interface ObraParaRegra {
  readonly situacao: string;
  readonly dataInicio: string;
  readonly acumuladoCent: number;
  readonly valorOrcadoCent: number | null;
  /** As apropriações vigentes (documento e valor), para não apropriar o mesmo documento duas vezes. */
  readonly apropriacoes: readonly {
    readonly data: string;
    readonly titulo: number | null;
    readonly nota: number | null;
    readonly valorCent: number;
  }[];
}

export interface NovaApropriacao {
  readonly data: string;
  readonly titulo: number | null;
  readonly nota: number | null;
  readonly valorCent: number;
}

export function errosApropriacao(o: ObraParaRegra, e: NovaApropriacao, hoje: string): CodigoAndamento[] {
  const r: CodigoAndamento[] = [];
  if (o.situacao !== 'em_andamento') r.push('nao-em-andamento');
  if (e.titulo === null && e.nota === null) r.push('sem-documento');
  if (e.valorCent === 0) r.push('valor-zero');
  if (!DATA.test(e.data)) r.push('data-invalida');
  else {
    if (e.data < o.dataInicio) r.push('data-antes-inicio');
    if (e.data > hoje) r.push('data-futura');
  }
  if (o.acumuladoCent + e.valorCent < 0) r.push('acumulado-negativo');
  if (
    e.valorCent > 0 &&
    o.apropriacoes.some(
      (a) =>
        a.valorCent === e.valorCent &&
        ((e.titulo !== null && a.titulo === e.titulo) || (e.nota !== null && a.nota === e.nota)),
    )
  )
    r.push('documento-repetido');
  return r;
}

/** A situação do orçamento da obra: o percentual consumido e o alerta (90% ou mais) ou o estouro. */
export function situacaoOrcamento(
  orcadoCent: number | null,
  acumuladoCent: number,
): {
  readonly percentual: number | null;
  readonly estado: 'sem-orcamento' | 'dentro' | 'alerta' | 'estourado';
} {
  if (orcadoCent === null || orcadoCent === 0) return { percentual: null, estado: 'sem-orcamento' };
  const percentual = Math.round((acumuladoCent / orcadoCent) * 1000) / 10;
  return { percentual, estado: percentual > 100 ? 'estourado' : percentual >= 90 ? 'alerta' : 'dentro' };
}

export interface PlanoAtivacao {
  readonly valorCent: number;
  readonly dataAquisicao: string;
  /** A competência em que a depreciação começa (a seguinte à ativação: em andamento não deprecia). */
  readonly inicioDepreciacao: string;
  readonly vidaUtilMeses: number;
  /** Quanto o custo passou do orçado (0: dentro). */
  readonly estouroCent: number;
}

export function planejarAtivacao(
  o: ObraParaRegra,
  e: { readonly data: string; readonly vidaUtilMeses: number },
  hoje: string,
): { plano: PlanoAtivacao } | { erros: CodigoAndamento[] } {
  const r: CodigoAndamento[] = [];
  if (o.situacao !== 'em_andamento') r.push('nao-em-andamento');
  if (o.acumuladoCent <= 0) r.push('sem-custo');
  if (!DATA.test(e.data)) r.push('data-invalida');
  else {
    if (e.data > hoje) r.push('data-futura');
    if (e.data < o.dataInicio) r.push('data-antes-inicio');
    const ultima = o.apropriacoes.reduce((m, a) => (a.data > m ? a.data : m), '');
    if (ultima && e.data < ultima) r.push('data-antes-apropriacao');
  }
  if (!Number.isInteger(e.vidaUtilMeses) || e.vidaUtilMeses < 1 || e.vidaUtilMeses > 1200)
    r.push('vida-invalida');
  if (r.length) return { erros: r };
  return {
    plano: {
      valorCent: o.acumuladoCent,
      dataAquisicao: e.data,
      inicioDepreciacao: mesSeguinte(competenciaDe(e.data)),
      vidaUtilMeses: e.vidaUtilMeses,
      estouroCent:
        o.valorOrcadoCent !== null && o.acumuladoCent > o.valorOrcadoCent
          ? o.acumuladoCent - o.valorOrcadoCent
          : 0,
    },
  };
}

export function errosCancelamentoObra(o: ObraParaRegra, motivo: string): CodigoAndamento[] {
  const r: CodigoAndamento[] = [];
  if (o.situacao !== 'em_andamento') r.push('nao-em-andamento');
  if (o.acumuladoCent !== 0) r.push('com-custo');
  if (motivo.trim().length < 5) r.push('motivo-curto');
  return r;
}

// ── Seguro dos bens ───────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_SEGURO = [
  'patrimonial',
  'incendio',
  'roubo',
  'equipamento',
  'veiculo',
  'responsabilidade_civil',
  'empresarial',
  'outro',
] as const;

export type CodigoSeguro =
  | 'numero-ausente'
  | 'tipo-invalido'
  | 'seguradora-ausente'
  | 'data-invalida'
  | 'vigencia-invertida'
  | 'premio-negativo'
  | 'franquia-negativa'
  | 'apolice-encerrada'
  | 'bem-baixado'
  | 'fora-da-vigencia'
  | 'valor-zero'
  | 'bem-ja-segurado'
  | 'ja-retirado'
  | 'motivo-curto';

export const MENSAGENS_SEGURO: Record<CodigoSeguro, string> = {
  'numero-ausente': 'Informe o número da apólice.',
  'tipo-invalido': 'Escolha o tipo de seguro.',
  'seguradora-ausente': 'Escolha a seguradora.',
  'data-invalida': 'Informe datas válidas.',
  'vigencia-invertida': 'O fim da vigência vem depois do início.',
  'premio-negativo': 'O prêmio não pode ser negativo.',
  'franquia-negativa': 'A franquia não pode ser negativa.',
  'apolice-encerrada': 'A apólice está cancelada, vencida ou renovada: não recebe bem.',
  'bem-baixado': 'O bem está baixado.',
  'fora-da-vigencia': 'A cobertura do bem começa dentro da vigência da apólice.',
  'valor-zero': 'Informe o valor segurado do bem.',
  'bem-ja-segurado': 'O bem já está coberto por esta apólice.',
  'ja-retirado': 'O bem já foi retirado da apólice.',
  'motivo-curto': 'Escreva o motivo com ao menos 5 letras.',
};

export interface NovaApolice {
  readonly numero: string;
  readonly tipo: string;
  readonly seguradora: number | null;
  readonly inicio: string;
  readonly fim: string;
  readonly premioCent: number;
  readonly franquiaCent: number | null;
}

export function errosApolice(e: NovaApolice): CodigoSeguro[] {
  const r: CodigoSeguro[] = [];
  if (e.numero.trim() === '') r.push('numero-ausente');
  if (!(TIPOS_SEGURO as readonly string[]).includes(e.tipo)) r.push('tipo-invalido');
  if (e.seguradora === null) r.push('seguradora-ausente');
  if (!DATA.test(e.inicio) || !DATA.test(e.fim)) r.push('data-invalida');
  else if (e.fim < e.inicio) r.push('vigencia-invertida');
  if (e.premioCent < 0) r.push('premio-negativo');
  if (e.franquiaCent !== null && e.franquiaCent < 0) r.push('franquia-negativa');
  return r;
}

export type SituacaoVistaApolice =
  'em_cotacao' | 'vigente' | 'a-vencer' | 'vencida' | 'cancelada' | 'renovada';

/** A situação mostrada: a vigente que passou do fim é vencida; a que vence em até 30 dias é "a vencer". */
export function situacaoDaApolice(
  a: { readonly situacao: string; readonly fim: string },
  hoje: string,
): SituacaoVistaApolice {
  if (a.situacao !== 'vigente') return a.situacao as SituacaoVistaApolice;
  if (a.fim < hoje) return 'vencida';
  const dias = (Date.parse(`${a.fim}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000;
  return dias <= 30 ? 'a-vencer' : 'vigente';
}

export function errosBemSegurado(
  ap: { readonly situacao: string; readonly inicio: string; readonly fim: string },
  bem: { readonly situacao: string },
  e: { readonly valorSeguradoCent: number; readonly inicio: string },
  jaCoberto: boolean,
  hoje: string,
): CodigoSeguro[] {
  const r: CodigoSeguro[] = [];
  const vista = situacaoDaApolice(ap, hoje);
  if (vista !== 'vigente' && vista !== 'a-vencer' && vista !== 'em_cotacao') r.push('apolice-encerrada');
  if (bem.situacao === 'baixado') r.push('bem-baixado');
  if (!DATA.test(e.inicio)) r.push('data-invalida');
  else if (e.inicio < ap.inicio || e.inicio > ap.fim) r.push('fora-da-vigencia');
  if (!(e.valorSeguradoCent > 0)) r.push('valor-zero');
  if (jaCoberto) r.push('bem-ja-segurado');
  return r;
}

/** A cobertura do bem contra o valor contábil: abaixo de 80% é subseguro (a indenização sofre rateio). */
export function cobertura(
  valorSeguradoCent: number,
  valorContabilCent: number,
): { readonly percentual: number | null; readonly subseguro: boolean; readonly detalhe: string } {
  if (valorContabilCent <= 0)
    return { percentual: null, subseguro: false, detalhe: 'Bem sem valor contábil.' };
  const percentual = Math.round((valorSeguradoCent / valorContabilCent) * 1000) / 10;
  const subseguro = percentual < 80;
  return {
    percentual,
    subseguro,
    detalhe: subseguro
      ? `Subseguro: ${fmt(valorSeguradoCent)} cobre ${percentual}% de ${fmt(valorContabilCent)}; a indenização sofre rateio.`
      : `Cobertura de ${percentual}% do valor contábil.`,
  };
}

/** O total segurado da apólice (os bens ainda cobertos). */
export const totalSegurado = (
  bens: readonly { readonly valorSeguradoCent: number; readonly ativo: boolean }[],
) => bens.filter((b) => b.ativo).reduce((s, b) => s + b.valorSeguradoCent, 0);
