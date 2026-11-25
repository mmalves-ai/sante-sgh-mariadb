// Fila de exportação e importação com o sistema de gestão corporativo (ERP) do hospital (F8, 08-INTG L136). Regras
// puras (sem banco): o lote por tipo (contas a pagar, contas a receber, estoque, compras e faturamento) a partir dos
// registros que já existem no financeiro, em suprimentos e no faturamento, num LAYOUT CANÔNICO próprio (o adaptador de
// cada ERP traduz o canônico); o ciclo do lote (gerado, enviado, processado, conciliado; cancelado só antes do envio);
// o retorno do ERP aplicado item a item de forma IDEMPOTENTE (o mesmo retorno duas vezes não muda nada; a chave externa
// já gravada nunca é trocada em silêncio); a conciliação (todo item resolvido e, quando o ERP informa o total, o valor
// aceito confere); e o simulador do ERP usado fora de produção (nada sai para fora).

export const TIPOS_FILA_ERP = ['pagar', 'receber', 'estoque', 'compras', 'faturamento'] as const;
export type TipoFilaErp = (typeof TIPOS_FILA_ERP)[number];

/** O tipo gravado no lote (`exportacao_erp.tipo`). */
export const TIPO_LOTE_ERP: Readonly<Record<TipoFilaErp, string>> = {
  pagar: 'financeiro_pagar',
  receber: 'financeiro_receber',
  estoque: 'estoque',
  compras: 'compras',
  faturamento: 'faturamento',
};

/** A tabela de onde vêm os registros de cada tipo (`exportacao_erp_item.entidade`). */
export const ENTIDADE_FILA_ERP: Readonly<Record<TipoFilaErp, string>> = {
  pagar: 'titulo_pagar',
  receber: 'titulo_receber',
  estoque: 'movimento_estoque',
  compras: 'pedido_compra',
  faturamento: 'fatura_fonte_pagadora',
};

/** Tipos cuja contraparte (fornecedor, devedor) precisa de CPF ou CNPJ no ERP. */
const EXIGE_CONTRAPARTE: ReadonlySet<TipoFilaErp> = new Set(['pagar', 'receber', 'compras']);

export const LAYOUT_CANONICO_ERP = 'sgh-erp/1';
/** Período máximo de um lote, em dias (um trimestre). */
export const PERIODO_MAXIMO_LOTE_ERP = 92;
/** Registros por lote (o resto fica para o próximo lote do mesmo período). */
export const TETO_ITENS_LOTE_ERP = 5000;

export const SITUACOES_LOTE_ERP = [
  'aberto',
  'gerado',
  // Reservado pelo worker sob trava e versão antes de chamar o adaptador: a tela não envia nem cancela um lote em envio.
  'enviando',
  'enviado',
  'processado',
  'processado_com_erro',
  'conciliado',
  'cancelado',
] as const;
export type SituacaoLoteErp = (typeof SITUACOES_LOTE_ERP)[number];

export const SITUACOES_ITEM_ERP = ['pendente', 'exportado', 'importado', 'rejeitado', 'ignorado'] as const;
export type SituacaoItemErp = (typeof SITUACOES_ITEM_ERP)[number];

const TRANSICOES: Readonly<Record<SituacaoLoteErp, readonly SituacaoLoteErp[]>> = {
  aberto: ['gerado', 'cancelado'],
  gerado: ['enviando', 'enviado', 'cancelado'],
  // O adaptador recusou o envio (nada chegou ao ERP): volta a gerado; senão, enviado com o protocolo.
  enviando: ['gerado', 'enviado'],
  enviado: ['enviado', 'processado', 'processado_com_erro'],
  processado: ['processado', 'conciliado'],
  // O ERP pode devolver de novo os rejeitados corrigidos (retorno idempotente) antes da conciliação.
  processado_com_erro: ['processado', 'processado_com_erro', 'conciliado'],
  conciliado: [],
  cancelado: [],
};

export function podeTransitarLoteErp(de: SituacaoLoteErp, para: SituacaoLoteErp): boolean {
  return TRANSICOES[de].includes(para);
}

export interface ErroRegraErp {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** O pedido de geração: tipo, período e o sistema corporativo de destino. */
export function conferirGeracaoLoteErp(
  e: { readonly tipo: string; readonly inicio: string; readonly fim: string },
  sistema: { readonly ativo: boolean; readonly categoria: string } | null,
): ErroRegraErp[] {
  const erros: ErroRegraErp[] = [];
  if (!(TIPOS_FILA_ERP as readonly string[]).includes(e.tipo))
    erros.push({ campo: 'tipo', codigo: 'tipo-invalido', mensagem: 'Tipo de lote desconhecido.' });
  if (!sistema)
    erros.push({
      campo: 'sistema',
      codigo: 'sistema-inexistente',
      mensagem: 'Sistema corporativo não encontrado.',
    });
  else if (sistema.categoria !== 'erp')
    erros.push({
      campo: 'sistema',
      codigo: 'sistema-nao-erp',
      mensagem: 'O sistema escolhido não é um sistema de gestão corporativo.',
    });
  else if (!sistema.ativo)
    erros.push({
      campo: 'sistema',
      codigo: 'sistema-inativo',
      mensagem: 'O sistema corporativo está inativo.',
    });
  if (!DATA.test(e.inicio) || !DATA.test(e.fim))
    erros.push({ campo: 'inicio', codigo: 'periodo-invalido', mensagem: 'Informe o período (AAAA-MM-DD).' });
  else if (e.fim < e.inicio)
    erros.push({
      campo: 'fim',
      codigo: 'periodo-invertido',
      mensagem: 'O fim do período é anterior ao início.',
    });
  else if ((Date.parse(e.fim) - Date.parse(e.inicio)) / DIA_MS + 1 > PERIODO_MAXIMO_LOTE_ERP)
    erros.push({
      campo: 'fim',
      codigo: 'periodo-longo',
      mensagem: `O lote cobre no máximo ${PERIODO_MAXIMO_LOTE_ERP} dias.`,
    });
  return erros;
}

/** Um registro do hospital pronto para ir ao ERP (lido do financeiro, de suprimentos ou do faturamento). */
export interface RegistroOrigemErp {
  readonly id: number;
  readonly numero: string;
  readonly documento: string | null;
  readonly data: string;
  readonly valor: number;
  /** CPF ou CNPJ da contraparte, só dígitos. */
  readonly cpfCnpj: string | null;
  readonly contraparte: string | null;
  readonly situacao: string;
  readonly contaContabil?: number | null;
  readonly centroCusto?: number | null;
}

export interface ItemCanonicoErp {
  readonly sequencia: number;
  readonly entidade: string;
  readonly entidadeId: number;
  readonly numeroDocumento: string;
  readonly cpfCnpj: string | null;
  readonly data: string;
  readonly valor: number;
  readonly contaContabil: number | null;
  readonly centroCusto: number | null;
  /** O registro no layout canônico (o adaptador do ERP traduz este conteúdo). */
  readonly conteudo: Readonly<Record<string, unknown>>;
}

export interface LoteCanonicoErp {
  readonly tipo: TipoFilaErp;
  readonly itens: readonly ItemCanonicoErp[];
  readonly quantidade: number;
  readonly valorTotal: number;
  /** Já exportados em lote vivo do mesmo sistema (não vão de novo). */
  readonly jaExportados: number;
  /** Ficaram para o próximo lote (teto de itens). */
  readonly excedentes: number;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;
const soDigitos = (v: string | null) => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? d : null;
};

/** Monta o lote canônico: ordem estável (data, id), sem repetir o que já foi a um lote vivo do mesmo ERP. */
export function montarLoteErp(
  tipo: TipoFilaErp,
  registros: readonly RegistroOrigemErp[],
  jaExportados: ReadonlySet<number>,
): LoteCanonicoErp {
  const novos = [...registros]
    .filter((r) => !jaExportados.has(r.id))
    .sort((a, b) => (a.data === b.data ? a.id - b.id : a.data < b.data ? -1 : 1));
  const vao = novos.slice(0, TETO_ITENS_LOTE_ERP);
  let total = 0;
  const itens = vao.map((r, i): ItemCanonicoErp => {
    const valor = reais(centavos(r.valor));
    total += centavos(valor);
    const doc = (r.documento ?? r.numero).slice(0, 30);
    return {
      sequencia: i + 1,
      entidade: ENTIDADE_FILA_ERP[tipo],
      entidadeId: r.id,
      numeroDocumento: doc,
      cpfCnpj: soDigitos(r.cpfCnpj),
      data: r.data,
      valor,
      contaContabil: r.contaContabil ?? null,
      centroCusto: r.centroCusto ?? null,
      conteudo: {
        layout: LAYOUT_CANONICO_ERP,
        tipo,
        sequencia: i + 1,
        numero: r.numero,
        documento: doc,
        data: r.data,
        valor,
        contraparte: { documento: soDigitos(r.cpfCnpj), nome: r.contraparte },
        situacaoOrigem: r.situacao,
      },
    };
  });
  return {
    tipo,
    itens,
    quantidade: itens.length,
    valorTotal: reais(total),
    jaExportados: registros.length - novos.length,
    excedentes: novos.length - vao.length,
  };
}

/** Uma linha do retorno do ERP. */
export interface RetornoItemErp {
  readonly sequencia: number;
  readonly aceito: boolean;
  readonly chaveExterna: string | null;
  readonly mensagem: string | null;
}

export interface ItemAtualErp {
  readonly sequencia: number;
  readonly situacao: SituacaoItemErp;
  readonly chaveExterna: string | null;
  readonly valor: number | null;
}

export interface MudancaItemErp {
  readonly sequencia: number;
  readonly situacao: SituacaoItemErp;
  readonly chaveExterna: string | null;
  readonly mensagem: string | null;
}

export interface ResultadoRetornoErp {
  readonly mudancas: readonly MudancaItemErp[];
  /** Linhas iguais ao que já está gravado (retorno repetido). */
  readonly repetidos: number;
  /** Sequências que não existem no lote. */
  readonly desconhecidos: readonly number[];
  /** Item já aceito com outra chave externa: não muda (conflito para a equipe tratar). */
  readonly conflitos: readonly number[];
  readonly situacaoLote: SituacaoLoteErp;
  readonly quantidadeErros: number;
}

/**
 * Aplica o retorno item a item, idempotente: o item já aceito com a mesma chave fica como está; o rejeitado pode ser
 * aceito depois (o ERP corrigiu); o aceito nunca volta a rejeitado nem troca de chave. A situação do lote sai do
 * conjunto: ainda há pendente = enviado; algum rejeitado = processado_com_erro; senão processado.
 */
export function aplicarRetornoErp(
  situacaoLote: SituacaoLoteErp,
  itens: readonly ItemAtualErp[],
  retorno: readonly RetornoItemErp[],
): ResultadoRetornoErp {
  if (!['enviado', 'processado', 'processado_com_erro'].includes(situacaoLote))
    throw new Error(`Retorno recusado: o lote está ${situacaoLote}.`);
  const atual = new Map(itens.map((i) => [i.sequencia, i]));
  const mudancas = new Map<number, MudancaItemErp>();
  const desconhecidos: number[] = [];
  const conflitos: number[] = [];
  let repetidos = 0;
  for (const r of retorno) {
    const i = atual.get(r.sequencia);
    if (!i || i.situacao === 'ignorado') {
      desconhecidos.push(r.sequencia);
      continue;
    }
    const chave = r.chaveExterna?.trim().slice(0, 100) || null;
    if (r.aceito && !chave) {
      conflitos.push(r.sequencia);
      continue;
    }
    if (i.situacao === 'exportado') {
      if (r.aceito && chave === i.chaveExterna) repetidos++;
      else conflitos.push(r.sequencia);
      continue;
    }
    const nova: SituacaoItemErp = r.aceito ? 'exportado' : 'rejeitado';
    const mensagem = r.mensagem?.trim().slice(0, 1000) || null;
    if (i.situacao === nova && !r.aceito && !mudancas.has(r.sequencia)) {
      repetidos++;
      continue;
    }
    mudancas.set(r.sequencia, { sequencia: r.sequencia, situacao: nova, chaveExterna: chave, mensagem });
    atual.set(r.sequencia, { ...i, situacao: nova, chaveExterna: chave });
  }
  const finais = [...atual.values()].filter((i) => i.situacao !== 'ignorado');
  const erros = finais.filter((i) => i.situacao === 'rejeitado').length;
  const situacao: SituacaoLoteErp = finais.some((i) => i.situacao === 'pendente')
    ? 'enviado'
    : erros > 0
      ? 'processado_com_erro'
      : 'processado';
  return {
    mudancas: [...mudancas.values()],
    repetidos,
    desconhecidos,
    conflitos,
    situacaoLote: situacao,
    quantidadeErros: erros,
  };
}

export interface ResumoConciliacaoErp {
  readonly exportados: number;
  readonly rejeitados: number;
  readonly valorExportado: number;
}

/** A conciliação: lote processado, nenhum item pendente e, se o ERP informou o total aceito, o valor confere. */
export function conferirConciliacaoErp(
  situacaoLote: SituacaoLoteErp,
  itens: readonly ItemAtualErp[],
  valorInformadoErp: number | null,
): { erros: ErroRegraErp[]; resumo: ResumoConciliacaoErp } {
  const erros: ErroRegraErp[] = [];
  const vivos = itens.filter((i) => i.situacao !== 'ignorado');
  const exportados = vivos.filter((i) => i.situacao === 'exportado');
  const valor = reais(exportados.reduce((s, i) => s + centavos(i.valor ?? 0), 0));
  const resumo = {
    exportados: exportados.length,
    rejeitados: vivos.filter((i) => i.situacao === 'rejeitado').length,
    valorExportado: valor,
  };
  if (!podeTransitarLoteErp(situacaoLote, 'conciliado'))
    erros.push({
      campo: 'situacao',
      codigo: 'lote-nao-processado',
      mensagem: 'Só o lote processado pelo ERP pode ser conciliado.',
    });
  if (vivos.some((i) => i.situacao === 'pendente'))
    erros.push({ campo: 'itens', codigo: 'itens-pendentes', mensagem: 'Há itens sem retorno do ERP.' });
  if (valorInformadoErp !== null && centavos(valorInformadoErp) !== centavos(valor))
    erros.push({
      campo: 'valorInformado',
      codigo: 'divergencia-valor',
      mensagem: `O total informado pelo ERP não confere com o aceito (${valor.toFixed(2)}).`,
    });
  return { erros, resumo };
}

/** O simulador do ERP fora de produção: aceita o item com contraparte válida e rejeita o que não tem. */
export function simularRetornoErp(
  numeroLote: string,
  tipo: TipoFilaErp,
  itens: readonly {
    readonly sequencia: number;
    readonly cpfCnpj: string | null;
    readonly valor: number | null;
  }[],
): RetornoItemErp[] {
  return itens.map((i) => {
    if (EXIGE_CONTRAPARTE.has(tipo) && !i.cpfCnpj)
      return {
        sequencia: i.sequencia,
        aceito: false,
        chaveExterna: null,
        mensagem: 'Contraparte sem CPF ou CNPJ cadastrado.',
      };
    if (i.valor === null || i.valor <= 0)
      return {
        sequencia: i.sequencia,
        aceito: false,
        chaveExterna: null,
        mensagem: 'Valor zerado ou ausente.',
      };
    return {
      sequencia: i.sequencia,
      aceito: true,
      chaveExterna: `SIM-${numeroLote}-${i.sequencia}`.slice(0, 100),
      mensagem: null,
    };
  });
}
