// Regras de apresentação TISS por fonte pagadora (06-FAT linhas 29 e 30): como cada fonte pagadora quer receber a guia.
// Tudo puro, sem banco: a API lê a regra (`regra_apresentacao_tiss` e itens) e os valores padrão de campo
// (`valor_padrao_campo_tiss`) e o montador do lote recebe a conta já ajustada.
//   - a regra do tipo da conta vence a regra geral da fonte pagadora (tipo de conta nulo);
//   - o item da regra mais específico decide o item da conta: item faturável > função na equipe > grupo; profissional,
//     setor e tipo de guia restringem e somam especificidade; empate: o de maior id (o mais recente);
//   - o item da regra pode trocar o código e a descrição apresentados, tirar o item do arquivo ou somar lançamentos
//     iguais (por dia, ou na primeira ou na última data);
//   - o valor padrão preenche o campo que o atendimento não informou; com `sobrepoe`, substitui o informado. O mais
//     específico vence (procedimento, regime, origem, regra, estabelecimento) e o valor é conferido no domínio TISS.
import type { ContaTiss, ItemContaTiss } from '@sgh/contratos';

export type TipoGuiaApresentacao =
  'consulta' | 'sp_sadt' | 'resumo_internacao' | 'honorario' | 'outras_despesas';
export const TIPO_GUIA_APRESENTACAO: Readonly<Record<1 | 2 | 3 | 4, TipoGuiaApresentacao>> = {
  1: 'consulta',
  2: 'sp_sadt',
  3: 'resumo_internacao',
  4: 'honorario',
};

export type OrdenacaoGuias = 'numero_guia' | 'paciente' | 'data_atendimento';

export interface RegraApresentacao {
  readonly id: number;
  readonly tipoContaId: number | null;
  readonly registroAns: string | null;
  readonly codigoContratadoOperadora: string | null;
  readonly limiteGuiasLote: number | null;
  readonly ordenacaoGuias: OrdenacaoGuias;
  readonly usaGuiaConsulta: boolean;
  readonly agrupaItens: boolean;
  readonly omiteGuiaSemValor: boolean;
  readonly usaFaturamentoEletronico: boolean;
  readonly ativo: boolean;
}

export interface ItemRegraApresentacao {
  readonly id: number;
  readonly grupoId: number | null;
  readonly itemId: number | null;
  readonly funcaoId: number | null;
  readonly setorId: number | null;
  readonly profissionalId: number | null;
  readonly tipoGuia: TipoGuiaApresentacao | null;
  readonly codigoApresentacao: string | null;
  readonly descricaoApresentacao: string | null;
  readonly agrupa: boolean;
  readonly agrupamentoData: 'por_dia' | 'primeira_data' | 'ultima_data' | null;
  readonly naoExporta: boolean;
  readonly ativo: boolean;
}

/** O que a conta sabe de cada item além do que vai à guia (na mesma ordem dos itens da guia). */
export interface OrigemItemConta {
  readonly itemId: number;
  readonly grupoId: number | null;
  readonly funcaoId: number | null;
  readonly setorId: number | null;
  readonly profissionalId: number | null;
}

/** A regra da conta: a do tipo da conta vence a geral; inativa não vale. */
export function escolherRegraApresentacao(
  regras: readonly RegraApresentacao[],
  tipoContaId: number | null,
): RegraApresentacao | null {
  const ativas = regras.filter((r) => r.ativo);
  return (
    (tipoContaId !== null ? ativas.find((r) => r.tipoContaId === tipoContaId) : undefined) ??
    ativas.find((r) => r.tipoContaId === null) ??
    null
  );
}

function pontos(r: ItemRegraApresentacao, o: OrigemItemConta, guia: TipoGuiaApresentacao): number {
  if (!r.ativo) return -1;
  if (r.tipoGuia !== null && r.tipoGuia !== guia) return -1;
  if (r.profissionalId !== null && r.profissionalId !== o.profissionalId) return -1;
  if (r.setorId !== null && r.setorId !== o.setorId) return -1;
  let p: number;
  if (r.itemId !== null) {
    if (r.itemId !== o.itemId) return -1;
    p = 300;
  } else if (r.funcaoId !== null) {
    if (r.funcaoId !== o.funcaoId) return -1;
    p = 200;
  } else if (r.grupoId !== null) {
    if (r.grupoId !== o.grupoId) return -1;
    p = 100;
  } else return -1;
  if (r.profissionalId !== null) p += 20;
  if (r.setorId !== null) p += 10;
  if (r.tipoGuia !== null) p += 5;
  return p;
}

/** O item da regra que decide este item da conta (o mais específico; empate: o mais recente). */
export function itemDaRegra(
  itens: readonly ItemRegraApresentacao[],
  o: OrigemItemConta,
  guia: TipoGuiaApresentacao,
): ItemRegraApresentacao | null {
  let melhor: ItemRegraApresentacao | null = null;
  let mp = -1;
  for (const r of itens) {
    const p = pontos(r, o, guia);
    if (p > mp || (p === mp && p >= 0 && melhor !== null && r.id > melhor.id)) {
      melhor = r;
      mp = p;
    }
  }
  return mp >= 0 ? melhor : null;
}

const centavos = (i: Pick<ItemContaTiss, 'quantidade' | 'valorUnitario'>) =>
  Math.round(i.quantidade * i.valorUnitario * 100);

export interface ContaApresentada {
  readonly conta: ContaTiss;
  /** A guia não vai ao arquivo: ficou sem valor e a fonte pagadora não quer guia zerada. */
  readonly omitida: boolean;
  /** Quantos itens a regra tirou do arquivo, trocou o código ou somou. */
  readonly retirados: number;
  readonly trocados: number;
  readonly somados: number;
}

/**
 * Aplica a regra de apresentação aos itens da conta: tira os que não vão ao arquivo, troca código e descrição, soma os
 * lançamentos iguais (mesmo código, tabela e valor unitário: o total nunca muda pela soma) e renumera.
 */
export function apresentarConta(
  conta: ContaTiss,
  origens: readonly OrigemItemConta[],
  regra: RegraApresentacao | null,
  itensRegra: readonly ItemRegraApresentacao[],
): ContaApresentada {
  if (origens.length !== conta.itens.length)
    throw new Error(
      `A conta ${conta.conta} tem ${conta.itens.length} itens na guia e ${origens.length} na origem: a regra de apresentação não pode ser aplicada.`,
    );
  const guia = TIPO_GUIA_APRESENTACAO[conta.tipoGuia];
  let retirados = 0;
  let trocados = 0;
  let somados = 0;
  const saida: { item: ItemContaTiss; chave: string | null; data: 'primeira_data' | 'ultima_data' }[] = [];
  const porChave = new Map<string, number>();
  conta.itens.forEach((it, k) => {
    const r = regra ? itemDaRegra(itensRegra, origens[k]!, guia) : null;
    if (r?.naoExporta) {
      retirados++;
      return;
    }
    let item: ItemContaTiss = it;
    if (r?.codigoApresentacao) {
      item = {
        ...item,
        codigo: r.codigoApresentacao.slice(0, 10),
        descricao: (r.descricaoApresentacao ?? item.descricao).slice(0, 150),
      };
      trocados++;
    }
    const agrupa = r ? r.agrupa : (regra?.agrupaItens ?? false);
    const modo = r?.agrupamentoData ?? 'por_dia';
    const chave = agrupa
      ? [
          item.codigoTabela,
          item.codigo,
          item.natureza,
          item.valorUnitario,
          modo === 'por_dia' ? item.data : '',
        ].join('|')
      : null;
    const ja = chave !== null ? porChave.get(chave) : undefined;
    if (ja !== undefined) {
      const s = saida[ja]!;
      const data =
        s.data === 'ultima_data'
          ? item.data > s.item.data
            ? item.data
            : s.item.data
          : item.data < s.item.data
            ? item.data
            : s.item.data;
      s.item = { ...s.item, quantidade: s.item.quantidade + item.quantidade, data };
      somados++;
      return;
    }
    if (chave !== null) porChave.set(chave, saida.length);
    saida.push({ item, chave, data: modo === 'ultima_data' ? 'ultima_data' : 'primeira_data' });
  });
  const itens = saida.map((s, k) => ({ ...s.item, sequencial: k + 1 }));
  const total = itens.reduce((t, i) => t + centavos(i), 0);
  return {
    conta: { ...conta, itens },
    omitida: (regra?.omiteGuiaSemValor ?? false) && total === 0,
    retirados,
    trocados,
    somados,
  };
}

/** Recusa do lote pela regra da fonte pagadora (null: pode montar). */
export function conferirLotePelaRegra(
  regra: RegraApresentacao | null,
  tipoGuia: 1 | 2 | 3 | 4,
  guias: number,
): { codigo: string; mensagem: string } | null {
  if (!regra) return null;
  if (!regra.usaFaturamentoEletronico)
    return {
      codigo: 'fonte-sem-faturamento-eletronico',
      mensagem:
        'Esta fonte pagadora não recebe faturamento eletrônico pela regra de apresentação: o lote XML não é gerado.',
    };
  if (tipoGuia === 1 && !regra.usaGuiaConsulta)
    return {
      codigo: 'fonte-sem-guia-consulta',
      mensagem: 'Esta fonte pagadora não usa a guia de consulta: apresente as consultas na guia SP/SADT.',
    };
  if (regra.limiteGuiasLote !== null && guias > regra.limiteGuiasLote)
    return {
      codigo: 'lote-acima-do-limite',
      mensagem: `Esta fonte pagadora aceita até ${regra.limiteGuiasLote} guias por lote; foram escolhidas ${guias}. Divida em lotes menores.`,
    };
  return null;
}

/** Ordena as guias do lote como a fonte pagadora pede (estável: empate segue a ordem escolhida). */
export function ordenarGuias<T extends { conta: ContaTiss; paciente?: string }>(
  guias: readonly T[],
  ordem: OrdenacaoGuias,
): T[] {
  const chave = (g: T): string =>
    ordem === 'paciente'
      ? (g.paciente ?? '')
      : ordem === 'data_atendimento'
        ? `${g.conta.inicio.data}T${g.conta.inicio.hora}`
        : g.conta.numeroGuia;
  return guias
    .map((g, k) => ({ g, k }))
    .sort((a, b) => chave(a.g).localeCompare(chave(b.g), 'pt-BR') || a.k - b.k)
    .map((x) => x.g);
}

// ── Valor padrão de campo ─────────────────────────────────────────────────────────────────────────

export type CampoPadraoTiss =
  | 'caraterAtendimento'
  | 'tipoConsulta'
  | 'tipoAtendimento'
  | 'tipoFaturamento'
  | 'tipoInternacao'
  | 'regimeInternacao'
  | 'motivoEncerramento';

/** Os campos da guia que aceitam valor padrão e o domínio TISS de cada um. */
export const CAMPOS_PADRAO_TISS: Readonly<Record<CampoPadraoTiss, { nome: string; valores: RegExp }>> = {
  caraterAtendimento: { nome: 'Caráter do atendimento', valores: /^[12]$/ },
  tipoConsulta: { nome: 'Tipo de consulta', valores: /^[1-4]$/ },
  tipoAtendimento: { nome: 'Tipo de atendimento', valores: /^(0[1-9]|1\d|2[0-3])$/ },
  tipoFaturamento: { nome: 'Tipo de faturamento', valores: /^[1-4]$/ },
  tipoInternacao: { nome: 'Tipo de internação', valores: /^[1-5]$/ },
  regimeInternacao: { nome: 'Regime de internação', valores: /^[1-3]$/ },
  motivoEncerramento: { nome: 'Motivo de encerramento', valores: /^\d{2}$/ },
};

export const ehCampoPadraoTiss = (c: string): c is CampoPadraoTiss => Object.hasOwn(CAMPOS_PADRAO_TISS, c);

export interface ValorPadraoCampo {
  readonly id: number;
  readonly campo: string;
  readonly valor: string;
  readonly sobrepoe: boolean;
  readonly estabelecimentoId: number | null;
  readonly regraId: number | null;
  readonly regimeId: number | null;
  readonly origemId: number | null;
  readonly itemId: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface NovoValorPadrao {
  readonly campo: string;
  readonly valor: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Validação na hora do cadastro: o campo existe, o valor está no domínio TISS e a vigência fecha. */
export function validarValorPadraoCampo(v: NovoValorPadrao): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!ehCampoPadraoTiss(v.campo))
    erros['campo'] = `O campo ${v.campo} não aceita valor padrão. Campos aceitos: ${Object.values(
      CAMPOS_PADRAO_TISS,
    )
      .map((c) => c.nome)
      .join(', ')}.`;
  else if (!CAMPOS_PADRAO_TISS[v.campo].valores.test(v.valor.trim()))
    erros['valor'] = `O valor ${v.valor} não existe no padrão TISS para ${CAMPOS_PADRAO_TISS[v.campo].nome}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.vigenciaInicio))
    erros['vigenciaInicio'] = 'Informe o início da vigência.';
  else if (v.vigenciaFim !== null && v.vigenciaFim < v.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

export interface ContextoPadrao {
  readonly estabelecimentoId: number;
  readonly regraId: number | null;
  readonly regimeId: number | null;
  readonly origemId: number | null;
  readonly itemIds: readonly number[];
  readonly data: string;
}

function pontosPadrao(v: ValorPadraoCampo, c: ContextoPadrao): number {
  if (!v.ativo || v.vigenciaInicio > c.data || (v.vigenciaFim !== null && v.vigenciaFim < c.data)) return -1;
  let p = 0;
  if (v.itemId !== null) {
    if (!c.itemIds.includes(v.itemId)) return -1;
    p += 16;
  }
  if (v.regimeId !== null) {
    if (v.regimeId !== c.regimeId) return -1;
    p += 8;
  }
  if (v.origemId !== null) {
    if (v.origemId !== c.origemId) return -1;
    p += 4;
  }
  if (v.regraId !== null) {
    if (v.regraId !== c.regraId) return -1;
    p += 2;
  }
  if (v.estabelecimentoId !== null) {
    if (v.estabelecimentoId !== c.estabelecimentoId) return -1;
    p += 1;
  }
  return p;
}

/** O valor padrão de cada campo que vale para a conta (o mais específico; empate: vigência mais nova, depois id). */
export function escolherValoresPadrao(
  padroes: readonly ValorPadraoCampo[],
  c: ContextoPadrao,
): Map<CampoPadraoTiss, ValorPadraoCampo> {
  const melhor = new Map<CampoPadraoTiss, { v: ValorPadraoCampo; p: number }>();
  for (const v of padroes) {
    if (!ehCampoPadraoTiss(v.campo) || !CAMPOS_PADRAO_TISS[v.campo].valores.test(v.valor.trim())) continue;
    const p = pontosPadrao(v, c);
    if (p < 0) continue;
    const a = melhor.get(v.campo);
    if (
      !a ||
      p > a.p ||
      (p === a.p &&
        (v.vigenciaInicio > a.v.vigenciaInicio || (v.vigenciaInicio === a.v.vigenciaInicio && v.id > a.v.id)))
    )
      melhor.set(v.campo, { v, p });
  }
  return new Map([...melhor].map(([k, x]) => [k, x.v]));
}

/**
 * Aplica os valores padrão à conta: preenche o campo que o atendimento não informou (`informados` diz quais vieram do
 * cadastro) e, com `sobrepoe`, substitui o informado. Devolve a conta e os campos ajustados.
 */
export function aplicarValoresPadrao(
  conta: ContaTiss,
  padroes: readonly ValorPadraoCampo[],
  c: ContextoPadrao,
  informados: ReadonlySet<CampoPadraoTiss>,
): { conta: ContaTiss; aplicados: CampoPadraoTiss[] } {
  const escolhidos = escolherValoresPadrao(padroes, c);
  const ajuste: Record<string, string> = {};
  const aplicados: CampoPadraoTiss[] = [];
  for (const [campo, v] of escolhidos) {
    if (informados.has(campo) && !v.sobrepoe) continue;
    ajuste[campo] = v.valor.trim();
    aplicados.push(campo);
  }
  return { conta: { ...conta, ...ajuste } as ContaTiss, aplicados };
}
