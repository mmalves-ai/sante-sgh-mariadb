// Regra 5 do M32 (cap-06b §6.8): no Sante SGH nenhuma baixa de título a pagar sem a aprovação na alçada. A aprovação
// fica em SGH_FIN_APROVACAO (só inclusão) e AUTORIZADO_PGTO_PARA continua com a sentinela (1899-12-30 em 100% dos
// 71.267 títulos); MFPARAM.AUT_ELET continua 'F' (o novo não mexe em parâmetro do outro sistema). A faixa vale por
// valor, centro de custo e tipo de credor, com dupla aprovação acima do limite e vigência.
import type { TipoCredor } from './credor.js';
import { mesmaPessoa, recusaFin, type RecusaFinanceiro, reais } from './recusa.js';

export interface FaixaAlcada {
  readonly id: number;
  readonly empresa: number;
  /** Centro de custo (TBCENCUS.COD) ou nulo (todos). */
  readonly centroCusto: number | null;
  /** Tipo de credor (MFCONPAG.TIPO) ou nulo (todos). */
  readonly tipoCredor: TipoCredor | null;
  readonly valorDe: number;
  /** Teto da faixa (inclusivo) ou nulo (sem teto). */
  readonly valorAte: number | null;
  /** Quantas aprovações de pessoas diferentes a faixa exige (1 ou 2: dupla aprovação). */
  readonly aprovacoes: 1 | 2;
  /** Permissão que o aprovador precisa ter (financeiro.titulo_pagar.aprovar, ou a da diretoria). */
  readonly permissao: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativa: boolean;
}

export interface TituloParaAlcada {
  readonly empresa: number;
  readonly centroCusto: number | null;
  readonly tipo: TipoCredor;
  /** Valor do documento (VLR_DOC_TOT): a alçada é do documento, não da parcela. */
  readonly valor: number;
}

const vigente = (f: FaixaAlcada, data: string) =>
  f.ativa && f.vigenciaInicio <= data && (f.vigenciaFim === null || data <= f.vigenciaFim);

const cabe = (f: FaixaAlcada, valor: number) =>
  valor >= f.valorDe && (f.valorAte === null || valor <= f.valorAte);

/** Especificidade da faixa: centro de custo e tipo (3) > só centro (2) > só tipo (1) > geral (0). */
const especificidade = (f: FaixaAlcada) => (f.centroCusto !== null ? 2 : 0) + (f.tipoCredor !== null ? 1 : 0);

/** A faixa que vale para o título na data: a mais específica que cabe; empate fica com a de menor teto. */
export function alcadaAplicavel(
  faixas: readonly FaixaAlcada[],
  t: TituloParaAlcada,
  data: string,
): FaixaAlcada | null {
  const candidatas = faixas.filter(
    (f) =>
      f.empresa === t.empresa &&
      vigente(f, data) &&
      cabe(f, t.valor) &&
      (f.centroCusto === null || f.centroCusto === t.centroCusto) &&
      (f.tipoCredor === null || f.tipoCredor === t.tipo),
  );
  candidatas.sort(
    (a, b) =>
      especificidade(b) - especificidade(a) ||
      (a.valorAte ?? Number.POSITIVE_INFINITY) - (b.valorAte ?? Number.POSITIVE_INFINITY) ||
      a.id - b.id,
  );
  return candidatas[0] ?? null;
}

/** Faixas da mesma combinação (empresa, centro, tipo) não se sobrepõem no valor nem na vigência. */
export function conferirFaixas(faixas: readonly FaixaAlcada[]): RecusaFinanceiro | null {
  for (const f of faixas) {
    if (f.valorAte !== null && f.valorAte < f.valorDe)
      return recusaFin('faixa-invertida', `A faixa ${f.id} termina antes de começar.`, ['valorAte']);
    if (f.vigenciaFim !== null && f.vigenciaFim < f.vigenciaInicio)
      return recusaFin('vigencia-invertida', `A vigência da faixa ${f.id} termina antes de começar.`, [
        'vigenciaFim',
      ]);
  }
  const ativas = faixas.filter((f) => f.ativa);
  for (const [i, a] of ativas.entries())
    for (const b of ativas.slice(i + 1)) {
      if (a.empresa !== b.empresa || a.centroCusto !== b.centroCusto || a.tipoCredor !== b.tipoCredor)
        continue;
      const valor = a.valorDe <= (b.valorAte ?? Infinity) && b.valorDe <= (a.valorAte ?? Infinity);
      const tempo =
        a.vigenciaInicio <= (b.vigenciaFim ?? '9999-12-31') &&
        b.vigenciaInicio <= (a.vigenciaFim ?? '9999-12-31');
      if (valor && tempo)
        return recusaFin(
          'faixas-sobrepostas',
          `As faixas ${a.id} e ${b.id} se sobrepõem no valor e na vigência.`,
          ['valorDe', 'valorAte'],
        );
    }
  return null;
}

export interface AprovacaoRegistrada {
  readonly aprovador: string;
  readonly ordem: 1 | 2;
  readonly faixa: number;
  readonly em: string;
}

export interface SituacaoAprovacao {
  readonly aprovado: boolean;
  readonly exigidas: number;
  readonly feitas: number;
  readonly faltam: number;
}

/** Quantas aprovações válidas (pessoas diferentes, na faixa atual) o título tem. */
export function situacaoAprovacao(
  faixa: FaixaAlcada | null,
  aprovacoes: readonly AprovacaoRegistrada[],
): SituacaoAprovacao {
  const exigidas = faixa?.aprovacoes ?? 1;
  const pessoas = new Set(
    aprovacoes
      .filter((a) => faixa === null || a.faixa === faixa.id)
      .map((a) => a.aprovador.trim().toUpperCase()),
  );
  const feitas = Math.min(pessoas.size, exigidas);
  return { aprovado: faixa !== null && feitas >= exigidas, exigidas, feitas, faltam: exigidas - feitas };
}

export interface PedidoAprovacao {
  readonly faixa: FaixaAlcada | null;
  readonly aprovacoes: readonly AprovacaoRegistrada[];
  readonly aprovador: string;
  readonly lancador: string | null;
  /** O aprovador tem a permissão que a faixa exige? */
  readonly temPermissaoDaFaixa: boolean;
  readonly valor: number;
  readonly emAberto: boolean;
}

/** Aprovar: título em aberto, faixa definida, permissão da faixa, quem lançou não aprova, a mesma pessoa uma vez. */
export function conferirAprovacao(p: PedidoAprovacao): RecusaFinanceiro | null {
  if (!p.emAberto) return recusaFin('titulo-baixado', 'O título já foi baixado: não há o que aprovar.');
  if (!p.faixa)
    return recusaFin(
      'sem-alcada',
      `Nenhuma faixa de alçada cobre ${reais(p.valor)}: peça ao administrador do financeiro para cadastrar a faixa.`,
    );
  if (mesmaPessoa(p.aprovador, p.lancador))
    return recusaFin('segregacao-lancou-aprova', 'Quem lançou o título não pode aprová-lo.');
  if (!p.temPermissaoDaFaixa)
    return recusaFin('fora-da-alcada', `A aprovação de ${reais(p.valor)} pede a alçada de outro aprovador.`);
  if (p.aprovacoes.some((a) => a.faixa === p.faixa?.id && mesmaPessoa(a.aprovador, p.aprovador)))
    return recusaFin('ja-aprovou', 'Você já aprovou este título; a segunda aprovação é de outra pessoa.');
  if (situacaoAprovacao(p.faixa, p.aprovacoes).aprovado)
    return recusaFin('ja-aprovado', 'O título já tem as aprovações que a alçada exige.');
  return null;
}

export interface PedidoPagamento {
  readonly faixa: FaixaAlcada | null;
  readonly aprovacoes: readonly AprovacaoRegistrada[];
  readonly pagador: string;
  readonly lancador: string | null;
}

/** Pagar (regras 4 e 5): aprovado na alçada; quem lançou e quem aprovou não pagam. */
export function conferirPagamento(p: PedidoPagamento): RecusaFinanceiro | null {
  const s = situacaoAprovacao(p.faixa, p.aprovacoes);
  if (!s.aprovado)
    return recusaFin(
      'sem-aprovacao',
      s.feitas > 0
        ? `O título tem ${s.feitas} de ${s.exigidas} aprovação(ões) da alçada: falta a dupla aprovação.`
        : 'O título não tem aprovação na alçada: nenhum pagamento sem aprovação registrada.',
    );
  if (mesmaPessoa(p.pagador, p.lancador))
    return recusaFin('segregacao-lancou-paga', 'Quem lançou o título não pode pagá-lo.');
  if (p.aprovacoes.some((a) => mesmaPessoa(a.aprovador, p.pagador)))
    return recusaFin('segregacao-aprovou-paga', 'Quem aprovou o título não pode pagá-lo.');
  return null;
}

/** Indicador "títulos pagos sem aprovação" nos dois sistemas (parcelas impressas). */
export interface PagosSemAprovacao {
  readonly pagos: number;
  readonly comAprovacao: number;
  readonly semAprovacaoNoNovo: number;
  readonly semAprovacaoNoOutro: number;
  readonly percentual: number;
}

export function pagosSemAprovacao(
  titulos: readonly { pago: boolean; aprovado: boolean; pagoPeloNovo: boolean }[],
): PagosSemAprovacao {
  const pagos = titulos.filter((t) => t.pago);
  const com = pagos.filter((t) => t.aprovado).length;
  const semNovo = pagos.filter((t) => !t.aprovado && t.pagoPeloNovo).length;
  const semOutro = pagos.filter((t) => !t.aprovado && !t.pagoPeloNovo).length;
  return {
    pagos: pagos.length,
    comAprovacao: com,
    semAprovacaoNoNovo: semNovo,
    semAprovacaoNoOutro: semOutro,
    percentual: pagos.length ? Math.round(((semNovo + semOutro) / pagos.length) * 10_000) / 100 : 0,
  };
}
