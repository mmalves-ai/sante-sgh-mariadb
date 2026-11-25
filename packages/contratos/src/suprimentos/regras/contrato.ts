// Regras do contrato com fornecedor (ficha do M55, etapa 3; regras 5 a 8; cap-07 §7.3; ONA-05). Funções puras: a
// gravação confere de novo na transação, com o contrato relido e travado.
//   - regra 5: a vigência pelo fim vigente (o original ou o do último aditivo de prazo ou renovação), a faixa do alerta
//     em 90, 60 e 30 dias, o reajuste por índice e data-base (um ano entre reajustes);
//   - regra 6: o saldo = valor inicial + aditivos + reajustes + renovações − pedidos − títulos avulsos, com as parcelas;
//   - regra 7: o contrato vencido (ou não iniciado) recusa o vínculo, salvo a exceção aprovada pela alçada (de outra
//     pessoa, do mesmo contrato, não usada, até 30 dias); encerrado ou rescindido recusa sempre;
//   - regra 8: a avaliação do fornecedor (média das notas; qualquer nota 1 desqualifica) e a periodicidade (crítico 6
//     meses, os demais 12).
import {
  CRITERIOS_AVALIACAO_FORNECEDOR,
  type CriterioAvaliacao,
  DIAS_VALIDADE_EXCECAO,
  type FaixaVigencia,
  type IndiceReajuste,
  LIMITE_ACRESCIMO_PERCENTUAL,
  MESES_AVALIACAO_COMUM,
  MESES_AVALIACAO_CRITICO,
  MESES_INTERVALO_REAJUSTE,
  type ResultadoAvaliacao,
  type SaldoContrato,
  type SituacaoContratoFornecedor,
  type TipoEventoContrato,
  type TipoVinculoContrato,
} from '../contrato.js';
import { reais, recusa, type RecusaSuprimentos } from './recusa.js';
import type {
  AvisoContrato,
  ContratoDetalhe,
  ContratoGravado,
  ContratoResumo,
  EventoContrato,
  VinculoContrato,
} from '../contrato.js';

// ── Datas (AAAA-MM-DD, sem fuso) ────────────────────────────────────────────────────────────────────────────────

const utc = (iso: string): number => {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d);
};
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Dias corridos de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

/** Soma meses à data (o dia que não existe no mês cai no último dia: 31/01 + 1 mês = 28 ou 29/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return iso(alvo.getTime());
}

// ── Regra 5: vigência e alertas ─────────────────────────────────────────────────────────────────────────────────

export interface EventoParaContrato {
  readonly id: number;
  readonly tipo: TipoEventoContrato;
  readonly data: string | null;
  readonly valor: number | null;
  readonly novoFim: string | null;
  readonly criadoEm: string;
  readonly usuario: string;
  readonly usado?: boolean;
}

/** O fim vigente: o do último aditivo de prazo ou renovação (pela ordem de gravação), senão o original. */
export function fimVigente(fimOriginal: string, eventos: readonly EventoParaContrato[]): string {
  let fim = fimOriginal;
  for (const e of [...eventos].sort((a, b) => a.id - b.id))
    if ((e.tipo === 'aditivo' || e.tipo === 'renovacao') && e.novoFim) fim = e.novoFim;
  return fim;
}

/** Regra 5: a faixa do dia (a iniciar, vigente, vence em 90, 60 ou 30 dias, vencido; encerrado). */
export function faixaVigencia(o: {
  situacao: SituacaoContratoFornecedor;
  inicio: string;
  fim: string;
  hoje: string;
}): { faixa: FaixaVigencia; diasParaVencer: number | null } {
  if (o.situacao !== 'ativo') return { faixa: 'encerrado', diasParaVencer: null };
  const dias = diasEntre(o.hoje, o.fim);
  if (o.hoje < o.inicio) return { faixa: 'a-iniciar', diasParaVencer: dias };
  if (dias < 0) return { faixa: 'vencido', diasParaVencer: dias };
  if (dias <= 30) return { faixa: 'vence-30', diasParaVencer: dias };
  if (dias <= 60) return { faixa: 'vence-60', diasParaVencer: dias };
  if (dias <= 90) return { faixa: 'vence-90', diasParaVencer: dias };
  return { faixa: 'vigente', diasParaVencer: dias };
}

/** Os alertas a gerar hoje (o `worker` agrega por dia): o contrato que cruzou 90, 60 ou 30 dias, uma vez por faixa. */
export function alertaDeVencimento(o: {
  situacao: SituacaoContratoFornecedor;
  inicio: string;
  fim: string;
  hoje: string;
  faixaJaAvisada: FaixaVigencia | null;
}): FaixaVigencia | null {
  const { faixa } = faixaVigencia(o);
  if (!['vence-90', 'vence-60', 'vence-30', 'vencido'].includes(faixa)) return null;
  return faixa === o.faixaJaAvisada ? null : faixa;
}

// ── Regra 5: reajuste por índice e data-base ────────────────────────────────────────────────────────────────────

/** A data a partir da qual o próximo reajuste vale: um ano da data-base ou do último reajuste. */
export function proximoReajuste(o: {
  indice: IndiceReajuste;
  dataBase: string | null;
  ultimoReajuste: string | null;
}): string | null {
  if (o.indice === 'nenhum' || !o.dataBase) return null;
  return somarMeses(o.ultimoReajuste ?? o.dataBase, MESES_INTERVALO_REAJUSTE);
}

/** Regra 5: confere o reajuste e calcula o valor (sobre o valor vigente: inicial + aditivos + reajustes anteriores). */
export function calcularReajuste(o: {
  indice: IndiceReajuste;
  dataBase: string | null;
  ultimoReajuste: string | null;
  data: string;
  percentual: number;
  valorVigente: number;
}): { valor: number; conta: string } | RecusaSuprimentos {
  if (o.indice === 'nenhum' || !o.dataBase)
    return recusa('sem-indice', 'O contrato não tem índice de reajuste nem data-base.', ['percentual']);
  const minimo = proximoReajuste(o)!;
  if (o.data < minimo)
    return recusa(
      'reajuste-antes-do-prazo',
      `O reajuste só vale a partir de ${minimo.split('-').reverse().join('/')} (um ano da data-base ou do último reajuste).`,
      ['data'],
    );
  const valor = reais((o.valorVigente * o.percentual) / 100);
  return { valor, conta: `${fmt(o.valorVigente)} × ${o.percentual}% = ${fmt(valor)}` };
}

// ── Regra 6: saldo ──────────────────────────────────────────────────────────────────────────────────────────────

export interface VinculoParaSaldo {
  readonly id: number;
  readonly tipo: TipoVinculoContrato;
  readonly valor: number;
  readonly ativo: boolean;
  readonly pedidoDeOrigem: number | null;
}

const fmt = (n: number): string =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Regra 6: valor inicial + aditivos + reajustes + renovações − pedidos − títulos avulsos, com as parcelas impressas. */
export function saldoContrato(
  valorInicial: number,
  eventos: readonly Pick<EventoParaContrato, 'tipo' | 'valor'>[],
  vinculos: readonly VinculoParaSaldo[],
): SaldoContrato {
  const soma = (t: TipoEventoContrato) =>
    reais(eventos.filter((e) => e.tipo === t).reduce((s, e) => s + (e.valor ?? 0), 0));
  const aditivos = soma('aditivo');
  const reajustes = soma('reajuste');
  const renovacoes = soma('renovacao');
  const valorTotal = reais(valorInicial + aditivos + reajustes + renovacoes);
  const ativos = vinculos.filter((v) => v.ativo);
  const pedidos = reais(ativos.filter((v) => v.tipo === 'pedido').reduce((s, v) => s + v.valor, 0));
  const titulos = ativos.filter((v) => v.tipo === 'titulo');
  const titulosAvulsos = reais(
    titulos.filter((v) => v.pedidoDeOrigem === null).reduce((s, v) => s + v.valor, 0),
  );
  const titulosDePedidos = reais(
    titulos.filter((v) => v.pedidoDeOrigem !== null).reduce((s, v) => s + v.valor, 0),
  );
  const consumido = reais(pedidos + titulosAvulsos);
  const saldo = reais(valorTotal - consumido);
  const percentualConsumido = valorTotal > 0 ? Math.round((consumido / valorTotal) * 10_000) / 100 : 0;
  const conta =
    `${fmt(valorInicial)} + ${fmt(aditivos)} (aditivos) + ${fmt(reajustes)} (reajustes) + ${fmt(renovacoes)} ` +
    `(renovações) − ${fmt(pedidos)} (pedidos) − ${fmt(titulosAvulsos)} (títulos sem pedido) = ${fmt(saldo)}`;
  return {
    valorInicial: reais(valorInicial),
    aditivos,
    reajustes,
    renovacoes,
    valorTotal,
    pedidos,
    titulosAvulsos,
    titulosDePedidos,
    consumido,
    saldo,
    percentualConsumido,
    conta,
  };
}

/** O aviso do acréscimo acumulado por aditivo acima de 25% do valor inicial (Lei 14.133/2021, art. 125). */
export function acrescimoAcimaDoLimite(valorInicial: number, aditivos: number): boolean {
  return valorInicial > 0 && (aditivos / valorInicial) * 100 > LIMITE_ACRESCIMO_PERCENTUAL + 1e-9;
}

// ── Regra 5: aditivo, renovação, encerramento ───────────────────────────────────────────────────────────────────

export function conferirEventoContrato(o: {
  tipo: TipoEventoContrato;
  situacao: SituacaoContratoFornecedor;
  inicio: string;
  fim: string;
  novoFim: string | null;
  valor: number | null;
  saldo: number;
  data: string | null;
  hoje: string;
}): RecusaSuprimentos | null {
  if (o.situacao !== 'ativo' && o.tipo !== 'ocorrencia' && o.tipo !== 'anexo' && o.tipo !== 'avaliacao')
    return recusa(
      'contrato-encerrado',
      'O contrato está encerrado ou rescindido: só aceita ocorrência, anexo e avaliação.',
    );
  if ((o.tipo === 'aditivo' || o.tipo === 'renovacao') && o.novoFim !== null && o.novoFim <= o.fim)
    return recusa('prazo-nao-aumenta', 'O novo fim da vigência tem de ser depois do fim atual.', ['novoFim']);
  if (o.tipo === 'aditivo' && (o.valor ?? 0) < 0 && -(o.valor ?? 0) > o.saldo + 1e-9)
    return recusa(
      'supressao-acima-do-saldo',
      'A supressão é maior que o saldo do contrato (o que já foi pedido ou pago não se suprime).',
      ['valor'],
    );
  if ((o.tipo === 'encerramento' || o.tipo === 'rescisao') && o.data !== null && o.data < o.inicio)
    return recusa('data-antes-do-inicio', 'A data é anterior ao início do contrato.', ['data']);
  if (o.data !== null && o.data > o.hoje && (o.tipo === 'ocorrencia' || o.tipo === 'avaliacao'))
    return recusa('data-futura', 'A data não pode ser futura.', ['data']);
  return null;
}

// ── Regra 7: o vínculo de pedido ou título ──────────────────────────────────────────────────────────────────────

export interface ExcecaoParaVinculo {
  readonly id: number;
  readonly contrato: number;
  readonly aprovador: string;
  readonly criadoEm: string;
  readonly usada: boolean;
}

export function conferirVinculoContrato(o: {
  contrato: {
    id: number;
    situacao: SituacaoContratoFornecedor;
    inicio: string;
    fim: string;
    fornecedor: number;
  };
  hoje: string;
  tipo: TipoVinculoContrato;
  /** O fornecedor do título (credor) ou os convidados do pedido. */
  fornecedores: readonly number[];
  /**
   * O valor que abate o saldo agora: o título; o pedido já aprovado, o que ele compromete (05-SUP linha 20); o pedido
   * que nasce na compra, sem preço: 0.
   */
  valor: number;
  saldo: number;
  excecao: ExcecaoParaVinculo | null;
  solicitante: string;
  /** Algum dos IDs já está ligado a um contrato. */
  jaVinculado: boolean;
  /** No título: o pedido de origem é um vínculo de pedido ativo deste contrato. */
  pedidoDeOrigemValido?: boolean | null;
}): RecusaSuprimentos | null {
  const c = o.contrato;
  if (o.jaVinculado)
    return recusa('ja-vinculado', 'O pedido ou o título já está ligado a um contrato.', ['contrato']);
  if (c.situacao !== 'ativo')
    return recusa(
      'contrato-encerrado',
      'O contrato está encerrado ou rescindido: não aceita pedido nem título.',
      ['contrato'],
    );
  if (o.fornecedores.some((f) => f !== c.fornecedor))
    return recusa(
      'fornecedor-diferente',
      'O pedido ou o título é de outro fornecedor: só o fornecedor do contrato.',
      ['contrato'],
    );
  if (o.pedidoDeOrigemValido === false)
    return recusa('pedido-de-origem-invalido', 'O pedido de origem não está ligado a este contrato.', [
      'pedidoDeOrigem',
    ]);
  const fora = o.hoje < c.inicio ? 'nao-iniciado' : o.hoje > c.fim ? 'vencido' : null;
  if (fora) {
    const x = o.excecao;
    if (!x)
      return fora === 'vencido'
        ? recusa(
            'contrato-vencido',
            'O contrato está vencido: o pedido ou o título só com a exceção aprovada pela alçada (ou um aditivo de prazo).',
            ['contrato'],
          )
        : recusa(
            'contrato-nao-iniciado',
            'A vigência do contrato ainda não começou: só com a exceção aprovada.',
            ['contrato'],
          );
    if (x.contrato !== c.id)
      return recusa('excecao-de-outro-contrato', 'A exceção aprovada é de outro contrato.', ['excecao']);
    if (x.usada)
      return recusa('excecao-usada', 'A exceção aprovada já foi usada em outro vínculo.', ['excecao']);
    if (diasEntre(x.criadoEm.slice(0, 10), o.hoje) > DIAS_VALIDADE_EXCECAO)
      return recusa(
        'excecao-expirada',
        `A exceção aprovada vale por ${DIAS_VALIDADE_EXCECAO} dias: peça outra.`,
        ['excecao'],
      );
    if (x.aprovador.toUpperCase() === o.solicitante.toUpperCase())
      return recusa(
        'excecao-do-proprio',
        'Quem aprovou a exceção não a usa: outra pessoa faz o pedido ou o título.',
        ['excecao'],
      );
  } else if (o.excecao) {
    return recusa('excecao-desnecessaria', 'O contrato está vigente: a exceção não é usada.', ['excecao']);
  }
  if (o.tipo === 'pedido' && o.saldo <= 0)
    return recusa('sem-saldo', 'O contrato não tem saldo: registre um aditivo antes do pedido.', [
      'contrato',
    ]);
  if (o.valor > o.saldo + 1e-9)
    return recusa(
      'saldo-insuficiente',
      `${o.tipo === 'titulo' ? 'O título' : 'O pedido'} (${fmt(o.valor)}) é maior que o saldo do contrato (${fmt(o.saldo)}).`,
      ['contrato'],
    );
  return null;
}

// ── Regra 8: avaliação do fornecedor ────────────────────────────────────────────────────────────────────────────

/** A média das notas e o resultado: média ≥ 4 qualificado, ≥ 3 com ressalvas, < 3 ou alguma nota 1 desqualificado. */
export function avaliarFornecedor(notas: Readonly<Record<CriterioAvaliacao, number>>): {
  media: number;
  resultado: ResultadoAvaliacao;
  conta: string;
} {
  const vs = CRITERIOS_AVALIACAO_FORNECEDOR.map((c) => notas[c.codigo]);
  const media = Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 100) / 100;
  const resultado: ResultadoAvaliacao =
    vs.some((v) => v <= 1) || media < 3 ? 'desqualificado' : media < 4 ? 'condicional' : 'qualificado';
  return { media, resultado, conta: `(${vs.join(' + ')}) ÷ ${vs.length} = ${media.toFixed(2)}` };
}

/** A data da próxima avaliação: 6 meses (crítico) ou 12 depois da última, ou do início do contrato. */
export function proximaAvaliacao(o: { critico: boolean; inicio: string; ultima: string | null }): string {
  return somarMeses(o.ultima ?? o.inicio, o.critico ? MESES_AVALIACAO_CRITICO : MESES_AVALIACAO_COMUM);
}

export function avaliacaoVencida(o: {
  critico: boolean;
  inicio: string;
  ultima: string | null;
  hoje: string;
  situacao: SituacaoContratoFornecedor;
}): boolean {
  return o.situacao === 'ativo' && o.hoje > proximaAvaliacao(o);
}

// ── Montagem do resumo e do detalhe (a leitura do banco e a porta em memória) ─────────────────────────────────────

export interface ContratoMontado {
  readonly resumo: ContratoResumo;
  readonly detalhe: Omit<ContratoDetalhe, keyof ContratoResumo | 'centroCustoNome'>;
}

/** O resumo e o detalhe do contrato no dia (o fim vigente, a faixa, o saldo com as parcelas, os avisos). */
export function montarContrato(
  c: ContratoGravado,
  fornecedorNome: string,
  eventos: readonly (EventoContrato & { readonly contrato?: number })[],
  vinculos: readonly VinculoContrato[],
  hoje: string,
): ContratoMontado {
  const fim = fimVigente(c.fimOriginal, eventos);
  const { faixa, diasParaVencer } = faixaVigencia({ situacao: c.situacao, inicio: c.inicio, fim, hoje });
  const saldo = saldoContrato(c.valorInicial, eventos, vinculos);
  const reajustes = eventos.filter((e) => e.tipo === 'reajuste');
  const ultimoReajuste = reajustes.length ? (reajustes[reajustes.length - 1]!.data ?? null) : null;
  const avaliacoes = eventos.filter((e) => e.tipo === 'avaliacao' && e.notas);
  const ua = avaliacoes[avaliacoes.length - 1];
  const ultimaAvaliacao = ua
    ? {
        data: ua.data ?? ua.criadoEm.slice(0, 10),
        resultado: ua.resultado!,
        media: avaliarFornecedor(ua.notas!).media,
      }
    : null;
  const avisos: AvisoContrato[] = [];
  if (faixa === 'vencido')
    avisos.push({
      codigo: 'vencido',
      mensagem: 'O contrato está vencido: novos pedidos só com a exceção aprovada.',
    });
  else if (faixa.startsWith('vence-'))
    avisos.push({ codigo: faixa, mensagem: `O contrato vence em ${diasParaVencer} dia(s).` });
  if (saldo.saldo < 0)
    avisos.push({
      codigo: 'saldo-excedido',
      mensagem: 'O consumido passou do valor do contrato: registre um aditivo.',
    });
  if (acrescimoAcimaDoLimite(c.valorInicial, saldo.aditivos))
    avisos.push({
      codigo: 'acrescimo-acima-do-limite',
      mensagem: 'Os aditivos somam mais de 25% do valor inicial: confira com o jurídico.',
    });
  const ultimaData = ultimaAvaliacao?.data ?? null;
  if (
    avaliacaoVencida({ critico: c.critico, inicio: c.inicio, ultima: ultimaData, hoje, situacao: c.situacao })
  )
    avisos.push({
      codigo: 'avaliacao-vencida',
      mensagem: 'A avaliação periódica do fornecedor está vencida.',
    });
  if (ultimaAvaliacao?.resultado === 'desqualificado')
    avisos.push({
      codigo: 'fornecedor-desqualificado',
      mensagem: 'O fornecedor foi desqualificado na última avaliação.',
    });
  if (c.garantia !== 'nenhuma' && c.garantiaValidade && c.garantiaValidade < hoje && c.situacao === 'ativo')
    avisos.push({ codigo: 'garantia-vencida', mensagem: 'A garantia contratual está vencida.' });
  return {
    resumo: {
      id: c.id,
      numero: c.numero,
      fornecedor: c.fornecedor,
      fornecedorNome,
      tipo: c.tipo,
      objeto: c.objeto,
      critico: c.critico,
      inicio: c.inicio,
      fim,
      situacao: c.situacao,
      faixa,
      diasParaVencer,
      valorTotal: saldo.valorTotal,
      saldo: saldo.saldo,
      gestor: c.gestor,
      fiscal: c.fiscal,
      versao: c.versao,
    },
    detalhe: {
      indiceReajuste: c.indiceReajuste,
      dataBase: c.dataBase,
      proximoReajuste: proximoReajuste({ indice: c.indiceReajuste, dataBase: c.dataBase, ultimoReajuste }),
      garantia: c.garantia,
      garantiaValor: c.garantiaValor,
      garantiaValidade: c.garantiaValidade,
      centroCusto: c.centroCusto,
      observacao: c.observacao,
      valorInicial: c.valorInicial,
      fimOriginal: c.fimOriginal,
      saldoDetalhe: saldo,
      ultimaAvaliacao,
      proximaAvaliacao: proximaAvaliacao({ critico: c.critico, inicio: c.inicio, ultima: ultimaData }),
      avisos,
      eventos: eventos.map((e) => {
        const r: { contrato?: number } & Omit<EventoContrato, never> = { ...e };
        delete r.contrato;
        return r;
      }),
      vinculos,
      criadoPor: c.usuario,
      criadoEm: c.criadoEm,
    },
  };
}
