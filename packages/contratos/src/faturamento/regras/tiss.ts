// Regras puras do pós-fechamento da conta (M31; ficha, seção 8): lote TISS, protocolo, competência, baixa (glosa),
// recurso e desfecho, indicadores e situação inferida. O adaptador do legado as confere antes de gravar e a API e as
// telas as usam para explicar; ficam em @sgh/contratos/regras-faturamento (fronteira Nx, como as do M30).
//   - regra 1: só a 04.03.00 (DP-47.7), inclusive reapresentação e recurso;
//   - regra 2: numeração pelos contadores do outro sistema (TBSEGUIA, tipo de guia 0), 12 dígitos com zeros à esquerda;
//   - regra 5: protocolo normalizado (sem CRLF e TAB, até 12 bytes Latin1); protocolo congela o lote; vazio é '';
//   - regra 6: GLOSADO='T' é baixa (conciliado); glosa real = VALOR_C − VLR_PG nos itens baixados;
//   - regra 7: glosa sem motivo (0) não fecha a conciliação no novo; 3095 é motivo de retorno, não de glosa;
//   - regra 8: recurso só de item conciliado, cobrado > pago, sem recurso anterior; desfecho com demonstrativo e data;
//   - regra 9: competência fechada não recebe conta;
//   - regra 10: duas réguas de glosa, êxito sem denominador = "não recorreu", faixas fechadas à esquerda, ciclo 0..3650;
//   - regra 12: lote e recurso anteriores ao novo têm situação inferida e marcada.
import { centavos, recusaFat, type RecusaFaturamento, reaisTexto } from './recusa.js';

/** A única versão de troca vigente (RN ANS 501/2022; DP-47.7). */
export const VERSAO_TISS_VIGENTE = '04.03.00';

/** Tipos de guia do outro sistema (TBTISSTPGUIA) que o lote do novo monta. */
export const TIPOS_GUIA_LOTE = [1, 2, 3, 4] as const;
export type TipoGuiaLote = (typeof TIPOS_GUIA_LOTE)[number];
/** Tipo de guia do recurso de glosa (TBTISSTPGUIA 8). */
export const TIPO_GUIA_RECURSO = 8;

export const ROTULO_TIPO_GUIA: Readonly<Record<number, string>> = {
  1: 'Consulta',
  2: 'SP/SADT',
  3: 'Resumo de internação',
  4: 'Honorário individual',
  8: 'Recurso de glosa',
};

/** Transação do outro sistema (TBTISSSCHEMA.ID) gravada no lote: 4 envio de lote de guias, 5 recurso de glosa. */
export const SCHEMA_LOTE_GUIAS = 4;
export const SCHEMA_RECURSO_GLOSA = 5;

/** Contador do outro sistema para os lotes de guia e de recurso (TBSEGUIA.TIPO_GUIA = 0; 36 de 37 convênios conferem). */
export const TIPO_GUIA_CONTADOR = 0;

/** Motivo 3095 = "recurso de glosa acatado" (retorno, nunca glosa); 0 = não informado. */
export const MOTIVO_ACATADO = 3095;
export const MOTIVO_NAO_INFORMADO = 0;

export const TAMANHO_PROTOCOLO = 12;
const PROTOCOLO_INVALIDO = /[^\x20-\x7E\xA0-\xFF]/;

/** O tipo de guia vale para o tipo de conta? (E: consulta, SP/SADT, honorário; I: resumo de internação, honorário.) */
export function tipoGuiaCompativel(tipoGuia: number, tipoConta: string): boolean {
  const t = tipoConta.trim().toUpperCase();
  if (tipoGuia === 4) return t === 'E' || t === 'I';
  if (tipoGuia === 3) return t === 'I';
  if (tipoGuia === 1 || tipoGuia === 2) return t === 'E';
  return false;
}

/** Regra 2: o próximo número do contador (texto numérico) com 12 dígitos, como o outro sistema grava. */
export function proximoNumero(atual: string | null | undefined): string {
  const limpo = (atual ?? '').trim();
  if (limpo !== '' && !/^\d{1,12}$/.test(limpo))
    throw new Error(`Contador fora do formato numérico: ${limpo}`);
  const n = BigInt(limpo === '' ? '0' : limpo) + 1n;
  const s = n.toString();
  if (s.length > 12) throw new Error('Contador de lote esgotado (12 dígitos).');
  return s.padStart(12, '0');
}

export interface ContaParaLote {
  readonly id: number;
  readonly convenio: number;
  readonly tipoConta: string;
  readonly fechada: string;
  readonly indEmi: string;
  readonly lotes: number;
  readonly ano: number;
  readonly mes: number;
}

/** Recusa da montagem do lote, conta a conta (regra do marco: só contas emitidas, fechadas e fora de outro lote). */
export function conferirContaParaLote(
  c: ContaParaLote,
  lote: { convenio: number; tipoGuia: number },
): RecusaFaturamento | null {
  if (c.convenio !== lote.convenio)
    return recusaFat('outro-convenio', `A conta ${c.id} é de outro convênio: um lote leva um convênio só.`);
  if (c.indEmi !== 'T')
    return recusaFat(
      'conta-nao-emitida',
      `A conta ${c.id} ainda não foi emitida: emita antes de montar o lote.`,
    );
  if (c.fechada === 'A' || c.lotes > 0)
    return recusaFat('conta-em-lote', `A conta ${c.id} já está em outro lote.`);
  if (c.fechada !== 'S')
    return recusaFat(
      'conta-aberta',
      `A conta ${c.id} não está fechada: feche a conta antes de montar o lote.`,
    );
  if (!tipoGuiaCompativel(lote.tipoGuia, c.tipoConta))
    return recusaFat(
      'tipo-guia-incompativel',
      `A conta ${c.id} (${c.tipoConta === 'I' ? 'internação' : 'externa'}) não vai em lote de ${ROTULO_TIPO_GUIA[lote.tipoGuia] ?? 'outro tipo'}.`,
    );
  return null;
}

// ── Protocolo (regra 5) ─────────────────────────────────────────────────────────────────────────────

export type ResultadoProtocolo =
  | { readonly ok: true; readonly protocolo: string; readonly limpou: boolean }
  | { readonly ok: false; readonly recusa: RecusaFaturamento };

/** Normaliza o protocolo antes de qualquer SQL (sem CRLF e TAB, trim, até 12 bytes Latin1). */
export function normalizarProtocolo(valor: string | null | undefined): ResultadoProtocolo {
  const original = String(valor ?? '');
  const protocolo = original.replace(/[\r\n\t]/g, '').trim();
  if (!protocolo)
    return {
      ok: false,
      recusa: recusaFat(
        'protocolo-vazio',
        'Informe o número que a operadora devolveu no comprovante de entrega do lote.',
        ['protocolo'],
      ),
    };
  const ruim = PROTOCOLO_INVALIDO.exec(protocolo);
  if (ruim)
    return {
      ok: false,
      recusa: recusaFat(
        'protocolo-caractere',
        `O protocolo tem um caractere que não pode ser guardado (posição ${ruim.index + 1}). Copie só o número do comprovante.`,
        ['protocolo'],
      ),
    };
  if (protocolo.length > TAMANHO_PROTOCOLO)
    return {
      ok: false,
      recusa: recusaFat(
        'protocolo-longo',
        `O protocolo tem ${protocolo.length} caracteres; o máximo é ${TAMANHO_PROTOCOLO}. Confira se não veio texto colado junto do número.`,
        ['protocolo'],
      ),
    };
  return { ok: true, protocolo, limpou: /[\r\n\t]/.test(original) };
}

/** O lote protocolado está congelado: nem o lote nem as contas dele podem sair (os gatilhos do banco recusam). */
export const loteCongelado = (protocolo: string | null | undefined): boolean =>
  (protocolo ?? '').trim() !== '';

export function conferirRegistroProtocolo(atual: string, acao: 'registrar' | 'limpar', pedido: string) {
  if (acao === 'registrar' && atual.trim() !== '')
    return recusaFat(
      'protocolo-ja-registrado',
      `O lote já tem o protocolo ${atual.trim()}: para trocar, limpe primeiro informando o protocolo atual.`,
      ['protocolo'],
    );
  if (acao === 'limpar' && atual.trim() === '')
    return recusaFat('lote-sem-protocolo', 'O lote já está sem protocolo.');
  if (acao === 'limpar' && atual.trim() !== pedido)
    return recusaFat(
      'protocolo-diferente',
      `O lote tem outro protocolo (${atual.trim()}): a limpeza só desfaz o protocolo informado.`,
      ['protocolo'],
    );
  return null;
}

// ── Competência (regra 9) ───────────────────────────────────────────────────────────────────────────

export const chaveCompetencia = (convenio: number, ano: number, mes: number) =>
  `${convenio}/${ano}/${String(mes).padStart(2, '0')}`;

export function conferirFechamentoCompetencia(c: {
  readonly jaFechada: boolean;
  readonly ano: number;
  readonly mes: number;
  readonly hoje: string;
}): RecusaFaturamento | null {
  if (c.jaFechada) return recusaFat('ja-fechada', 'A competência deste convênio já está fechada.');
  if (c.mes < 1 || c.mes > 12) return recusaFat('competencia-invalida', 'Mês inválido.', ['mes']);
  const pedido = `${c.ano}-${String(c.mes).padStart(2, '0')}`;
  if (pedido > c.hoje.slice(0, 7))
    return recusaFat('competencia-futura', 'Não é possível fechar uma competência futura.', ['mes']);
  return null;
}

/** Regra 9: a conta de competência fechada não entra em lote nem recebe lançamento novo nas telas do novo. */
export function conferirCompetenciaAberta(fechada: boolean): RecusaFaturamento | null {
  return fechada
    ? recusaFat(
        'competencia-fechada',
        'A competência desta conta está fechada para o convênio: reabrir exige o supervisor e o motivo.',
      )
    : null;
}

export function conferirReaberturaCompetencia(r: {
  readonly fechada: boolean;
  readonly supervisor: boolean;
  readonly motivo: string;
}): RecusaFaturamento | null {
  if (!r.fechada) return recusaFat('competencia-aberta', 'A competência já está aberta.');
  if (!r.supervisor)
    return recusaFat('sem-supervisor', 'Reabrir a competência é do supervisor do faturamento.');
  if (r.motivo.trim().length < 5) return recusaFat('motivo-obrigatorio', 'Informe o motivo.', ['motivo']);
  return null;
}

// ── Glosa e baixa (regras 6 e 7) ────────────────────────────────────────────────────────────────────

export interface ItemRetorno {
  /** GLOSADO: 'T' = baixado (conciliado), não "glosado". */
  readonly glosado: string;
  readonly valorCobrado: number;
  readonly valorPago: number;
  readonly quantidade: number;
  readonly quantidadePaga: number;
  readonly motivoGlosa: number;
  readonly valorRecurso: number;
  readonly quantidadeRecurso: number;
  readonly dataRecurso: string | null;
  readonly valorRetorno: number;
  readonly quantidadeRetorno: number;
  readonly dataRetorno: string | null;
  readonly motivoRetorno: number;
}

/** Regra 6: o item está conciliado (baixado)? E quanto foi glosado (só nos baixados)? Pago a maior: glosa negativa. */
export function semanticaGlosa(i: Pick<ItemRetorno, 'glosado' | 'valorCobrado' | 'valorPago'>): {
  readonly conciliado: boolean;
  readonly glosa: number;
  readonly glosaPositiva: number;
  readonly pagoAMaior: boolean;
} {
  const conciliado = i.glosado.trim().toUpperCase() === 'T';
  if (!conciliado) return { conciliado, glosa: 0, glosaPositiva: 0, pagoAMaior: false };
  const glosa = centavos(i.valorCobrado - i.valorPago);
  return { conciliado, glosa, glosaPositiva: Math.max(0, glosa), pagoAMaior: glosa < 0 };
}

/** Regra 7: a baixa com glosa precisa de motivo (0 não fecha a conciliação); 3095 é motivo de retorno. */
export function conferirBaixa(b: {
  readonly valorCobrado: number;
  readonly valorPago: number;
  readonly quantidadePaga: number;
  readonly motivo: number;
  readonly motivoExiste: boolean;
  readonly jaBaixado: boolean;
}): RecusaFaturamento | null {
  if (b.jaBaixado)
    return recusaFat('ja-baixado', 'Este item já foi baixado; corrija pela reversão da baixa.');
  if (b.valorPago < 0 || b.quantidadePaga < 0)
    return recusaFat('valor-negativo', 'O valor e a quantidade pagos não podem ser negativos.', [
      'valorPago',
    ]);
  const glosa = centavos(b.valorCobrado - b.valorPago);
  if (b.motivo === MOTIVO_ACATADO)
    return recusaFat(
      'motivo-de-retorno',
      'O motivo 3095 é do retorno do recurso (recurso acatado), não da glosa.',
      ['motivo'],
    );
  if (glosa > 0 && b.motivo === MOTIVO_NAO_INFORMADO)
    return recusaFat(
      'motivo-zero',
      `Há glosa de ${reaisTexto(glosa)}: informe o motivo (tabela 38 da TISS) para fechar a conciliação.`,
      ['motivo'],
    );
  if (!b.motivoExiste) return recusaFat('motivo-inexistente', 'O motivo informado não existe.', ['motivo']);
  return null;
}

// ── Recurso (regra 8) ───────────────────────────────────────────────────────────────────────────────

export function conferirRecurso(
  i: Pick<ItemRetorno, 'glosado' | 'valorCobrado' | 'valorPago' | 'valorRecurso'>,
): RecusaFaturamento | null {
  if (i.glosado.trim().toUpperCase() !== 'T')
    return recusaFat(
      'nao-conciliado',
      'O item ainda não foi conciliado (baixado): baixe o retorno antes de recorrer.',
    );
  if (i.valorRecurso > 0) return recusaFat('ja-recorrido', 'Este item já tem recurso registrado.');
  if (!(i.valorCobrado > i.valorPago))
    return recusaFat('sem-glosa', 'O item não tem glosa a recorrer (o pago cobre o cobrado).');
  return null;
}

/** Valor e quantidade padrão do recurso: VALOR_C − VLR_PG e QTDE − QTD_PG (nunca 0: sem saldo, a quantidade inteira). */
export function padraoRecurso(
  i: Pick<ItemRetorno, 'valorCobrado' | 'valorPago' | 'quantidade' | 'quantidadePaga'>,
): { valor: number; quantidade: number } {
  const valor = centavos(i.valorCobrado - i.valorPago);
  const q = Math.round((i.quantidade - i.quantidadePaga) * 1000) / 1000;
  return { valor, quantidade: q > 0 ? q : i.quantidade > 0 ? i.quantidade : 1 };
}

export function conferirValorRecurso(valor: number, padrao: number): RecusaFaturamento | null {
  if (!(valor >= 0.01))
    return recusaFat('valor-invalido', 'O valor do recurso tem de ser positivo.', ['valor']);
  if (valor > padrao + 0.005)
    return recusaFat(
      'valor-acima-da-glosa',
      `O valor do recurso (${reaisTexto(valor)}) passa da glosa (${reaisTexto(padrao)}).`,
      ['valor'],
    );
  return null;
}

/** Motivo que não admite reapresentação (TBMOTGLO.REAPRESENTA='F'): alerta, nunca bloqueio. */
export function alertaReapresentacao(reapresenta: string | null | undefined): string | null {
  return (reapresenta ?? '').trim().toUpperCase() === 'F'
    ? 'O motivo desta glosa não admite reapresentação pela tabela da operadora: o recurso pode ser negado.'
    : null;
}

// ── Desfecho do recurso (regra 8) ───────────────────────────────────────────────────────────────────

export type Desfecho = 'acatado' | 'parcial' | 'negado';
export const DESFECHOS: readonly Desfecho[] = ['acatado', 'parcial', 'negado'];

export interface ValoresDesfecho {
  readonly valor: number;
  readonly quantidade: number;
  readonly motivo: number;
}

export function conferirDesfecho(d: {
  readonly item: Pick<
    ItemRetorno,
    'valorRecurso' | 'quantidadeRecurso' | 'dataRecurso' | 'valorRetorno' | 'dataRetorno'
  >;
  readonly desfecho: Desfecho;
  readonly data: string;
  readonly numeroDemonstrativo: string;
  readonly valor?: number | null;
  readonly motivo?: number | null;
}): { ok: true; valores: ValoresDesfecho } | { ok: false; recusa: RecusaFaturamento } {
  const r = (codigo: string, msg: string, campos?: string[]) => ({
    ok: false as const,
    recusa: recusaFat(codigo, msg, campos),
  });
  if (!(d.item.valorRecurso > 0)) return r('sem-recurso', 'O item não tem recurso registrado.');
  if (d.item.valorRetorno > 0 || d.item.dataRetorno !== null)
    return r('retorno-ja-baixado', 'O retorno deste recurso já foi registrado.');
  if (!d.numeroDemonstrativo.trim())
    return r('demonstrativo-obrigatorio', 'Informe o número do demonstrativo de retorno da operadora.', [
      'numeroDemonstrativo',
    ]);
  if (d.item.dataRecurso !== null && d.data < d.item.dataRecurso)
    return r(
      'data-anterior-ao-recurso',
      `A data do retorno (${d.data}) é anterior à do recurso (${d.item.dataRecurso}).`,
      ['data'],
    );
  if (d.desfecho === 'acatado') {
    if (d.valor !== null && d.valor !== undefined && Math.abs(d.valor - d.item.valorRecurso) > 0.005)
      return r('valor-acatado', 'No acatado o valor é o recursado inteiro; para parte dele, use parcial.', [
        'valor',
      ]);
    return {
      ok: true,
      valores: { valor: d.item.valorRecurso, quantidade: d.item.quantidadeRecurso, motivo: MOTIVO_ACATADO },
    };
  }
  if (d.desfecho === 'parcial') {
    const v = d.valor ?? 0;
    if (!(v >= 0.01) || v > d.item.valorRecurso - 0.005)
      return r(
        'valor-parcial',
        `No parcial o valor fica entre R$ 0,01 e menos que o recursado (${reaisTexto(d.item.valorRecurso)}).`,
        ['valor'],
      );
    return {
      ok: true,
      valores: {
        valor: centavos(v),
        quantidade: d.item.quantidadeRecurso,
        motivo: d.motivo ?? MOTIVO_NAO_INFORMADO,
      },
    };
  }
  if (d.valor) return r('valor-negado', 'No negado a operadora não pagou: não informe valor.', ['valor']);
  if (d.motivo === null || d.motivo === undefined)
    return r(
      'motivo-obrigatorio',
      'No negado informe o motivo da negativa (0 se a operadora não informou).',
      ['motivo'],
    );
  if (d.motivo === MOTIVO_ACATADO)
    return r('motivo-acatado-no-negado', 'O motivo 3095 é de recurso acatado.', ['motivo']);
  return { ok: true, valores: { valor: 0, quantidade: 0, motivo: d.motivo } };
}

// ── Decisão da glosa ────────────────────────────────────────────────────────────────────────────────

export type EstadoGlosa = 'pendente' | 'aceita' | 'recorrida' | 'encerrada';
export const ESTADOS_GLOSA: readonly EstadoGlosa[] = ['pendente', 'aceita', 'recorrida', 'encerrada'];

export function conferirDecisaoGlosa(d: {
  readonly conciliado: boolean;
  readonly glosa: number;
  readonly estadoAtual: EstadoGlosa | null;
  readonly decisao: 'aceitar' | 'recorrer';
  readonly texto: string;
}): RecusaFaturamento | null {
  if (!d.conciliado) return recusaFat('nao-conciliado', 'O item ainda não foi conciliado.');
  if (!(d.glosa > 0)) return recusaFat('sem-glosa', 'O item não tem glosa.');
  if (d.estadoAtual === 'aceita' || d.estadoAtual === 'encerrada')
    return recusaFat('glosa-decidida', 'A glosa deste item já foi decidida.');
  if (d.estadoAtual === 'recorrida' && d.decisao === 'recorrer')
    return recusaFat('glosa-decidida', 'A glosa deste item já está em recurso.');
  if (d.texto.trim().length < 5)
    return recusaFat(
      d.decisao === 'aceitar' ? 'motivo-obrigatorio' : 'justificativa-obrigatoria',
      d.decisao === 'aceitar'
        ? 'Informe o motivo de aceitar a glosa.'
        : 'Informe a justificativa do recurso.',
      [d.decisao === 'aceitar' ? 'motivo' : 'justificativa'],
    );
  return null;
}

/** O prazo de recurso por operadora (parâmetro "cod:dias;cod:dias"); sem valor: "prazo não cadastrado". */
export function prazoRecurso(
  parametro: string,
  convenio: number,
  dataBaixa: string | null,
): { prazo: string | null; alerta: string | null } {
  const dias = new Map(
    parametro
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(':').map((x) => Number(x.trim())) as [number, number])
      .filter(([c, d]) => Number.isInteger(c) && Number.isInteger(d) && d > 0),
  ).get(convenio);
  if (!dias) return { prazo: null, alerta: 'prazo não cadastrado' };
  if (!dataBaixa) return { prazo: null, alerta: 'sem data de baixa' };
  const d = new Date(`${dataBaixa}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return { prazo: d.toISOString().slice(0, 10), alerta: null };
}

export const FORMATO_PRAZO_OPERADORA = '^$|^\\d{1,4}:\\d{1,3}(;\\d{1,4}:\\d{1,3})*$';

// ── Indicadores (regra 10) ──────────────────────────────────────────────────────────────────────────

export interface SomasGlosa {
  readonly emitido: number;
  readonly conciliado: number;
  readonly pago: number;
  /** Régua líquida: Σ(VALOR_C − VLR_PG) nos baixados (o pago a maior abate). */
  readonly glosaLiquida: number;
  /** Régua positiva: só as diferenças positivas. */
  readonly glosaPositiva: number;
  readonly contestado: number;
  readonly recuperado: number;
}

/** Percentual com denominador zero → null (a tela mostra "não recorreu"/"sem base"). */
export const percentual = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10_000) / 100 : null;

export function indicadoresGlosa(s: SomasGlosa): {
  readonly taxaLiquida: number | null;
  readonly taxaPositiva: number | null;
  readonly exito: number | null;
  readonly exitoRotulo: string;
  readonly nuncaRecorrido: number;
} {
  const exito = percentual(s.recuperado, s.contestado);
  return {
    taxaLiquida: percentual(s.glosaLiquida, s.conciliado),
    taxaPositiva: percentual(s.glosaPositiva, s.conciliado),
    exito,
    exitoRotulo: exito === null ? 'não recorreu' : `${exito.toLocaleString('pt-BR')}%`,
    // "Nunca recorrido" na régua líquida (glosa líquida − contestado), como o relatório de 2025 (R$ 5,0 mi).
    nuncaRecorrido: centavos(s.glosaLiquida - s.contestado),
  };
}

/** Faixas de valor fechadas à esquerda: [0, 100), [100, 1.000), [1.000, 10.000), [10.000, ∞). */
export const FAIXAS_VALOR = [0, 100, 1_000, 10_000] as const;
export function faixaDoValor(v: number): string {
  let i = FAIXAS_VALOR.length - 1;
  while (i > 0 && v < FAIXAS_VALOR[i]!) i -= 1;
  const de = FAIXAS_VALOR[i]!;
  const ate = FAIXAS_VALOR[i + 1];
  return ate === undefined ? `${de} ou mais` : `${de} até menos de ${ate}`;
}

/** Ciclo do recurso (dias da baixa ao retorno) só de 0 a 3.650; fora disso é dado inconsistente e fica de fora. */
export function cicloValido(dias: number | null): boolean {
  return dias !== null && Number.isFinite(dias) && dias >= 0 && dias <= 3_650;
}

/** Toda tela de indicador declara a régua; o padrão é a competência. */
export const REGUA_PADRAO_GLOSA = 'competencia' as const;

// ── Situação inferida (regra 12) ────────────────────────────────────────────────────────────────────

export type SituacaoLote = 'gerado' | 'protocolado' | 'com-demonstrativo' | 'com-recurso' | 'encerrado';

export function situacaoDoLote(l: {
  readonly protocolo: string;
  readonly registradoNoNovo: boolean;
  readonly demonstrativos: number;
  readonly itensBaixados: number;
  readonly itensComRecurso: number;
  readonly itensRecursoAberto: number;
}): { readonly situacao: SituacaoLote; readonly inferida: boolean } {
  const inferida = !l.registradoNoNovo;
  if (l.itensComRecurso > 0)
    return { situacao: l.itensRecursoAberto > 0 ? 'com-recurso' : 'encerrado', inferida };
  if (l.demonstrativos > 0 || l.itensBaixados > 0) return { situacao: 'com-demonstrativo', inferida };
  if (loteCongelado(l.protocolo)) return { situacao: 'protocolado', inferida };
  return { situacao: 'gerado', inferida };
}

export const ROTULO_SITUACAO_LOTE: Readonly<Record<SituacaoLote, string>> = {
  gerado: 'Gerado',
  protocolado: 'Protocolado',
  'com-demonstrativo': 'Com retorno',
  'com-recurso': 'Em recurso',
  encerrado: 'Encerrado',
};

/** Regra 12: lote anterior ao novo não serve de base para cobrar recurso sem conferência humana. */
export function avisoInferida(inferida: boolean): string | null {
  return inferida
    ? 'Situação inferida dos dados existentes (lote anterior ao novo): confira antes de cobrar recurso.'
    : null;
}

// ── Envio (regra 13) ────────────────────────────────────────────────────────────────────────────────

export type DestinoEnvio = 'simulador' | 'operadora';
/** Nenhum envio fora de produção: fora dela, o simulador de operadora responde. */
export const destinoEnvio = (ambiente: string): DestinoEnvio =>
  ambiente === 'producao' ? 'operadora' : 'simulador';

// ── Profissional executante da guia (D-XML-31) ──────────────────────────────────────────────────────────────────────

/** UF (sigla do cadastro do profissional) → código da TISS (dm_UF, o código IBGE; 98 = estrangeiro). */
export const UF_TISS: Readonly<Record<string, string>> = {
  RO: '11',
  AC: '12',
  AM: '13',
  RR: '14',
  PA: '15',
  AP: '16',
  TO: '17',
  MA: '21',
  PI: '22',
  CE: '23',
  RN: '24',
  PB: '25',
  PE: '26',
  AL: '27',
  SE: '28',
  BA: '29',
  MG: '31',
  ES: '32',
  RJ: '33',
  SP: '35',
  PR: '41',
  SC: '42',
  RS: '43',
  MS: '50',
  MT: '51',
  GO: '52',
  DF: '53',
  EX: '98',
};

/**
 * Conselho da TISS (dm_conselhoProfissional) pela família do CBO do profissional: o cadastro do estabelecimento não
 * guarda a sigla do conselho (0 de 13.006 executantes das contas em lote de 2026), e o CBO decide o conselho.
 */
const CONSELHO_POR_CBO: readonly (readonly [string, string])[] = [
  ['2251', '06'],
  ['2252', '06'],
  ['2253', '06'],
  ['2231', '06'],
  ['2235', '02'],
  ['3222', '02'],
  ['2234', '03'],
  ['2238', '04'],
  ['2236', '05'],
  ['2237', '07'],
  ['2232', '08'],
  ['2515', '09'],
  ['2516', '01'],
  ['3241', '15'],
];

export function conselhoTissDoCbo(cbo: string): string | null {
  const c = cbo.trim();
  if (!/^\d{6}$/.test(c) || /^0+$/.test(c)) return null;
  return CONSELHO_POR_CBO.find(([p]) => c.startsWith(p))?.[1] ?? null;
}

export interface ExecutanteLido {
  readonly numero: string;
  readonly uf: string;
  readonly cbo: string;
  readonly nome: string;
}

export interface ExecutanteTiss {
  readonly profissional: { conselho: string; numeroConselho: string; uf: string; cbos: string };
  readonly nome: string;
}

/** O executante nos códigos da TISS; null quando falta conselho (pelo CBO), número, UF ou CBO no cadastro. */
export function executanteTiss(x: ExecutanteLido): ExecutanteTiss | null {
  const conselho = conselhoTissDoCbo(x.cbo);
  const numero = x.numero.trim().slice(0, 15);
  const uf = UF_TISS[x.uf.trim().toUpperCase()];
  if (!conselho || !numero || /^0+$/.test(numero) || !uf) return null;
  return {
    profissional: { conselho, numeroConselho: numero, uf, cbos: x.cbo.trim() },
    nome: x.nome.trim().slice(0, 70),
  };
}

/**
 * D-XML-31: o executante padrão só quando a conta não tem executante no cadastro (30% das contas em lote de 2026 trazem
 * o profissional sentinela, sem CBO nem número): conselho 06, CBO 225125. A guia é marcada e o lote avisa.
 */
export const EXECUTANTE_PADRAO: ExecutanteTiss = {
  profissional: { conselho: '06', numeroConselho: '0', uf: '33', cbos: '225125' },
  nome: 'PROFISSIONAL EXECUTANTE',
};
