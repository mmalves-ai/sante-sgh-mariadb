// Troca TISS na visão da operadora (08-SGO linha 107, C2-061; F7): o que chega do prestador em mensagem TISS 4.03 (pedido
// de autorização SOLICITACAO_PROCEDIMENTOS, cancelamento de guia CANCELA_GUIA e comunicação de internação ou alta
// COMUNICACAO_BENEFICIARIO) e as regras de cada uma. O XSD e o hash do epílogo são conferidos antes, na aplicação, com o
// validador oficial; aqui fica a leitura dos campos já validados e a decisão de negócio:
//   - o cabeçalho: tipo de transação, sequencial, data e hora, destino e prestador de origem;
//   - a mensagem é desta operadora, de um prestador da rede, e o sequencial do prestador não se repete;
//   - o cancelamento, guia a guia: não localizada, já apresentada em conta (não cancela) ou cancelada;
//   - a comunicação: o evento não é futuro, a internação traz o tipo e a alta o motivo de encerramento; a carteira não
//     identificada fica recebida (pendente), nunca descartada;
//   - o pedido de autorização: a guia TISS vira o pedido da operadora (conselho, UF, caráter, itens e internação);
//   - o demonstrativo de pagamento: líquido = liberado − débitos + créditos.
// Vocabulário neutro: datas ISO, booleanos, códigos da terminologia TISS só na borda da leitura.

export class ErroTrocaTiss extends Error {
  constructor(
    readonly codigo: string,
    mensagem = codigo,
  ) {
    super(mensagem);
    this.name = 'ErroTrocaTiss';
  }
}

export type ProblemaTroca = { readonly codigo: string; readonly campo?: string };

export const TIPOS_TROCA_TISS = [
  'envio_lote_guias',
  'solicitacao_procedimento',
  'solicitacao_status_autorizacao',
  'solicitacao_status_protocolo',
  'verificacao_elegibilidade',
  'cancelamento_guia',
  'demonstrativo_pagamento',
  'demonstrativo_analise_conta',
  'recurso_glosa',
  'envio_documentos',
  'envio_anexo',
  'comunicacao_internacao',
  'outra',
] as const;
export type TipoTrocaTiss = (typeof TIPOS_TROCA_TISS)[number];

/** O tipo de transação do cabeçalho TISS no tipo de troca da operadora. */
export const TIPO_TROCA_DA_TRANSACAO: Readonly<Record<string, TipoTrocaTiss>> = {
  ENVIO_LOTE_GUIAS: 'envio_lote_guias',
  SOLICITACAO_PROCEDIMENTOS: 'solicitacao_procedimento',
  SOLICITA_STATUS_AUTORIZACAO: 'solicitacao_status_autorizacao',
  SOLIC_STATUS_PROTOCOLO: 'solicitacao_status_protocolo',
  VERIFICA_ELEGIBILIDADE: 'verificacao_elegibilidade',
  CANCELA_GUIA: 'cancelamento_guia',
  COMUNICACAO_BENEFICIARIO: 'comunicacao_internacao',
  RECURSO_GLOSA: 'recurso_glosa',
  ENVIO_DOCUMENTO: 'envio_documentos',
  ENVIO_ANEXO: 'envio_anexo',
  DEMONSTRATIVO_PAGAMENTO: 'demonstrativo_pagamento',
  DEMONSTRATIVO_ANALISE_CONTA: 'demonstrativo_analise_conta',
};

/** As transações que a operadora recebe por esta porta (o lote de contas tem a sua própria). */
export const TRANSACOES_RECEBIDAS = [
  'SOLICITACAO_PROCEDIMENTOS',
  'CANCELA_GUIA',
  'COMUNICACAO_BENEFICIARIO',
] as const;
export type TransacaoRecebida = (typeof TRANSACOES_RECEBIDAS)[number];

// ── Leitura (o XML já passou no XSD) ──────────────────────────────────────────────────────────────

const P = '(?:[A-Za-z0-9_]+:)?';
const desescapar = (t: string) =>
  t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** O texto do primeiro elemento simples com o nome dado (ou null). */
export function valorTiss(xml: string, nome: string): string | null {
  const m = new RegExp(`<${P}${nome}>([^<]*)</${P}${nome}>`).exec(xml);
  return m ? desescapar(m[1]!) : null;
}

/** O conteúdo de cada elemento composto com o nome dado. */
export function blocosTiss(xml: string, nome: string): string[] {
  return [...xml.matchAll(new RegExp(`<${P}${nome}>([\\s\\S]*?)</${P}${nome}>`, 'g'))].map((m) => m[1]!);
}

const exigir = (v: string | null, codigo: string): string => {
  if (v === null || v === '') throw new ErroTrocaTiss(codigo);
  return v;
};

export interface PrestadorDaOrigem {
  readonly tipo: 'codigo' | 'cpf' | 'cnpj';
  readonly valor: string;
}

export interface CabecalhoTroca {
  readonly transacao: string;
  readonly tipo: TipoTrocaTiss;
  readonly sequencial: string;
  /** AAAA-MM-DDTHH:MM:SS */
  readonly registradaEm: string;
  readonly registroAns: string | null;
  readonly prestador: PrestadorDaOrigem;
  readonly padrao: string;
}

export function lerCabecalhoTroca(xml: string): CabecalhoTroca {
  const [cab] = blocosTiss(xml, 'cabecalho');
  if (!cab) throw new ErroTrocaTiss('mensagem-sem-cabecalho');
  const transacao = exigir(valorTiss(cab, 'tipoTransacao'), 'mensagem-sem-cabecalho');
  const origem = blocosTiss(cab, 'origem')[0] ?? '';
  const codigo = valorTiss(origem, 'codigoPrestadorNaOperadora');
  const cpf = valorTiss(origem, 'CPF') ?? valorTiss(origem, 'cpfContratado');
  const cnpj = valorTiss(origem, 'CNPJ') ?? valorTiss(origem, 'cnpjContratado');
  const prestador: PrestadorDaOrigem | null = codigo
    ? { tipo: 'codigo', valor: codigo }
    : cnpj
      ? { tipo: 'cnpj', valor: cnpj.replace(/\D/g, '') }
      : cpf
        ? { tipo: 'cpf', valor: cpf.replace(/\D/g, '') }
        : null;
  if (!prestador) throw new ErroTrocaTiss('prestador-nao-identificado');
  const data = exigir(valorTiss(cab, 'dataRegistroTransacao'), 'mensagem-sem-cabecalho');
  const hora = valorTiss(cab, 'horaRegistroTransacao') ?? '00:00:00';
  return {
    transacao,
    tipo: TIPO_TROCA_DA_TRANSACAO[transacao] ?? 'outra',
    sequencial: exigir(valorTiss(cab, 'sequencialTransacao'), 'mensagem-sem-cabecalho'),
    registradaEm: `${data}T${hora.slice(0, 8)}`,
    registroAns: valorTiss(blocosTiss(cab, 'destino')[0] ?? '', 'registroANS'),
    prestador,
    padrao: valorTiss(cab, 'Padrao') ?? '',
  };
}

/** A mensagem é desta operadora, de um prestador da rede, e o sequencial do prestador é novo. */
export function problemasDaTroca(
  cab: CabecalhoTroca,
  ctx: {
    readonly registroAnsOperadora: string | null;
    readonly prestadorEncontrado: boolean;
    readonly sequencialRepetido: boolean;
  },
): ProblemaTroca[] {
  const p: ProblemaTroca[] = [];
  if (!(TRANSACOES_RECEBIDAS as readonly string[]).includes(cab.transacao))
    p.push({ codigo: 'transacao-nao-recebida', campo: 'arquivo' });
  if (!ctx.registroAnsOperadora || cab.registroAns !== ctx.registroAnsOperadora)
    p.push({ codigo: 'operadora-de-outro-registro', campo: 'arquivo' });
  if (!ctx.prestadorEncontrado) p.push({ codigo: 'prestador-nao-identificado', campo: 'arquivo' });
  if (ctx.sequencialRepetido) p.push({ codigo: 'transacao-repetida', campo: 'arquivo' });
  return p;
}

// ── Cancelamento de guia ──────────────────────────────────────────────────────────────────────────

export interface GuiaACancelar {
  /** 1 solicitação, 2 faturamento, 3 recurso de glosa (dm_tipoGuia). */
  readonly tipoGuia: 'solicitacao' | 'faturamento' | 'recurso_glosa';
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly numeroProtocolo: string | null;
}

export interface CancelamentoLido {
  /** O pedido de cancelamento do lote inteiro (nesse caso, sem guias). */
  readonly lote: { readonly numeroLote: string; readonly numeroProtocolo: string | null } | null;
  readonly guias: readonly GuiaACancelar[];
}

const TIPO_GUIA_CANCELAMENTO: Readonly<Record<string, GuiaACancelar['tipoGuia']>> = {
  '1': 'solicitacao',
  '2': 'faturamento',
  '3': 'recurso_glosa',
};

export function lerCancelamentoGuia(xml: string): CancelamentoLido {
  const [corpo] = blocosTiss(xml, 'cancelaGuia');
  if (!corpo) throw new ErroTrocaTiss('corpo-ausente');
  const [lote] = blocosTiss(corpo, 'tipoCancelamentoLote');
  if (lote)
    return {
      lote: {
        numeroLote: exigir(valorTiss(lote, 'numeroLote'), 'corpo-ausente'),
        numeroProtocolo: valorTiss(lote, 'numeroProtocolo'),
      },
      guias: [],
    };
  const guias = blocosTiss(corpo, 'tipoCancelamentoGuia').map((g) => ({
    tipoGuia: TIPO_GUIA_CANCELAMENTO[valorTiss(g, 'tipoGuia') ?? ''] ?? 'solicitacao',
    numeroGuiaPrestador: exigir(valorTiss(g, 'numeroGuiaPrestador'), 'corpo-ausente'),
    numeroGuiaOperadora: valorTiss(g, 'numeroGuiaOperadora'),
    numeroProtocolo: valorTiss(g, 'numeroProtocolo'),
  }));
  if (!guias.length) throw new ErroTrocaTiss('corpo-ausente');
  return { lote: null, guias };
}

export type ResultadoCancelamento = 'cancelada' | 'nao_cancelada' | 'nao_localizada';

/** As situações do pedido de autorização que ainda podem ser canceladas a pedido do prestador. */
export const SITUACOES_CANCELAVEIS = ['em_analise', 'pendente', 'em_junta', 'autorizada', 'parcial'] as const;

/**
 * O resultado de uma guia do pedido de cancelamento. A guia já apresentada em conta não se cancela por aqui (o caminho é
 * a conta: devolução ou recurso); a negada já está encerrada; a já cancelada responde cancelada sem mudar nada.
 */
export function resultadoDoCancelamento(x: {
  readonly pedido: { readonly situacao: string } | null;
  readonly apresentadaEmConta: boolean;
}): { resultado: ResultadoCancelamento; observacao: string | null; cancelarPedido: boolean } {
  if (!x.pedido && !x.apresentadaEmConta)
    return {
      resultado: 'nao_localizada',
      observacao: 'Guia não localizada na operadora.',
      cancelarPedido: false,
    };
  if (x.apresentadaEmConta)
    return {
      resultado: 'nao_cancelada',
      observacao: 'A guia já foi apresentada em conta: o cancelamento é pela conta.',
      cancelarPedido: false,
    };
  const s = x.pedido!.situacao;
  if (s === 'cancelada')
    return { resultado: 'cancelada', observacao: 'A guia já estava cancelada.', cancelarPedido: false };
  if ((SITUACOES_CANCELAVEIS as readonly string[]).includes(s))
    return { resultado: 'cancelada', observacao: null, cancelarPedido: true };
  return { resultado: 'nao_cancelada', observacao: 'O pedido já foi encerrado.', cancelarPedido: false };
}

/** A situação do pedido de cancelamento depois da resposta: recusado só se nenhuma guia foi cancelada. */
export function situacaoDoCancelamento(
  resultados: readonly ResultadoCancelamento[],
): 'respondido' | 'recusado' {
  return resultados.some((r) => r === 'cancelada') ? 'respondido' : 'recusado';
}

/** O protocolo devolvido ao prestador: AAMMDD e o sequencial de 6 dígitos (12 caracteres, st_texto12 da TISS). */
export function protocoloDaTroca(hoje: string, sequencial: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(hoje) ||
    !Number.isInteger(sequencial) ||
    sequencial < 1 ||
    sequencial > 999_999
  )
    throw new ErroTrocaTiss('protocolo-invalido');
  return `${hoje.slice(2, 4)}${hoje.slice(5, 7)}${hoje.slice(8, 10)}${String(sequencial).padStart(6, '0')}`;
}

// ── Comunicação de internação e alta ─────────────────────────────────────────────────────────────

export const TIPOS_INTERNACAO_TISS: Readonly<Record<string, string>> = {
  '1': 'clinica',
  '2': 'cirurgica',
  '3': 'obstetrica',
  '4': 'pediatrica',
  '5': 'psiquiatrica',
};

export interface ComunicacaoLida {
  readonly carteira: string;
  readonly recemNascido: boolean;
  readonly dataEvento: string;
  readonly tipoEvento: 'internacao' | 'alta';
  readonly tipoInternacao: string | null;
  readonly motivoEncerramento: string | null;
}

export function lerComunicacaoBeneficiario(xml: string): ComunicacaoLida {
  const [corpo] = blocosTiss(xml, 'comunicacaoInternacao');
  if (!corpo) throw new ErroTrocaTiss('corpo-ausente');
  const ev = valorTiss(corpo, 'tipoEvento');
  const tipo = valorTiss(corpo, 'tipoInternacao');
  return {
    carteira: exigir(valorTiss(corpo, 'numeroCarteira'), 'corpo-ausente'),
    recemNascido: valorTiss(corpo, 'atendimentoRN') === 'S',
    dataEvento: exigir(valorTiss(corpo, 'dataEvento'), 'corpo-ausente'),
    tipoEvento: ev === 'A' ? 'alta' : 'internacao',
    tipoInternacao: tipo ? (TIPOS_INTERNACAO_TISS[tipo] ?? null) : null,
    motivoEncerramento: valorTiss(corpo, 'motivoEncerramento'),
  };
}

/** O que recusa a comunicação inteira (o evento futuro e o dado obrigatório do evento). */
export function problemasDaComunicacao(c: ComunicacaoLida, hoje: string): ProblemaTroca[] {
  const p: ProblemaTroca[] = [];
  if (c.dataEvento > hoje) p.push({ codigo: 'evento-no-futuro', campo: 'dataEvento' });
  if (c.tipoEvento === 'internacao' && !c.tipoInternacao)
    p.push({ codigo: 'internacao-sem-tipo', campo: 'tipoInternacao' });
  if (c.tipoEvento === 'alta' && !c.motivoEncerramento?.trim())
    p.push({ codigo: 'alta-sem-motivo', campo: 'motivoEncerramento' });
  return p;
}

/** Aceita quando o beneficiário é da operadora; a carteira não identificada fica recebida para a central conferir. */
export function situacaoDaComunicacao(beneficiarioIdentificado: boolean): 'aceita' | 'recebida' {
  return beneficiarioIdentificado ? 'aceita' : 'recebida';
}

/** A carteira como chave de identificação: sem espaços, pontos, traços ou barras, em maiúsculas. */
export function carteiraNormalizada(carteira: string): string {
  return carteira.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export type RespostaComunicacao =
  { readonly acao: 'aceitar' } | { readonly acao: 'recusar'; readonly motivoRecusa: number | null };

/**
 * A resposta da central à comunicação recebida: só a ainda 'recebida' é respondida; o aceite exige o beneficiário
 * identificado pela carteira; a recusa exige o motivo (da terminologia de glosas).
 */
export function problemasDaRespostaComunicacao(
  atual: { readonly situacao: string; readonly beneficiarioIdentificado: boolean },
  r: RespostaComunicacao,
): ProblemaTroca[] {
  if (atual.situacao !== 'recebida') return [{ codigo: 'comunicacao-ja-respondida', campo: 'situacao' }];
  if (r.acao === 'aceitar' && !atual.beneficiarioIdentificado)
    return [{ codigo: 'carteira-nao-identificada', campo: 'numeroCarteira' }];
  if (r.acao === 'recusar' && !r.motivoRecusa)
    return [{ codigo: 'recusa-sem-motivo', campo: 'motivoRecusa' }];
  return [];
}

/** A identificação da carteira só vale para a comunicação ainda pendente. */
export function problemasDaIdentificacaoComunicacao(situacao: string, carteira: string): ProblemaTroca[] {
  if (situacao !== 'recebida') return [{ codigo: 'comunicacao-ja-respondida', campo: 'situacao' }];
  if (!carteiraNormalizada(carteira)) return [{ codigo: 'carteira-vazia', campo: 'numeroCarteira' }];
  return [];
}

// ── Pedido de autorização (SOLICITACAO_PROCEDIMENTOS) ───────────────────────────────────────────────

/** Conselho profissional da terminologia TISS (dm_conselhoProfissional) na sigla. */
export const CONSELHO_DO_CODIGO_TISS: Readonly<Record<string, string>> = {
  '02': 'COREN',
  '03': 'CRF',
  '04': 'CRFA',
  '05': 'CREFITO',
  '06': 'CRM',
  '07': 'CRN',
  '08': 'CRO',
  '09': 'CRP',
};

/** UF pelo código do IBGE (dm_UF da TISS). */
export const UF_DO_CODIGO_IBGE: Readonly<Record<string, string>> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

export interface SolicitacaoLida {
  readonly tipo: 'sp_sadt' | 'internacao';
  readonly numeroGuiaPrestador: string;
  readonly carteira: string;
  readonly recemNascido: boolean;
  readonly urgencia: boolean;
  readonly indicacaoClinica: string | null;
  readonly cid: string | null;
  readonly profissional: {
    readonly nome: string;
    readonly conselho: string | null;
    readonly numero: string;
    readonly uf: string | null;
  };
  readonly internacao: {
    readonly tipo: number;
    readonly diarias: number;
    readonly admissaoPrevista: string;
  } | null;
  readonly itens: readonly {
    readonly tabela: number;
    readonly codigo: string;
    readonly descricao: string | null;
    readonly quantidade: number;
  }[];
}

export function lerSolicitacaoProcedimento(xml: string): SolicitacaoLida {
  const [sadt] = blocosTiss(xml, 'solicitacaoSP-SADT');
  const [int] = blocosTiss(xml, 'solicitacaoInternacao');
  const g = sadt ?? int;
  if (!g) throw new ErroTrocaTiss('corpo-ausente');
  // O anexo de OPME tem outro pedido: os procedimentos da guia ficam antes dele.
  const guia = g.split(/<(?:[A-Za-z0-9_]+:)?anexoClinico>/)[0]!;
  const prof =
    blocosTiss(guia, 'profissionalSolicitante')[0] ??
    blocosTiss(guia, 'dadosProfissionalContratado')[0] ??
    '';
  const dados = int ? (blocosTiss(guia, 'dadosInternacao')[0] ?? '') : '';
  const carater = valorTiss(sadt ? guia : dados, 'caraterAtendimento');
  const cid = valorTiss(guia, 'diagnosticoCID');
  return {
    tipo: sadt ? 'sp_sadt' : 'internacao',
    numeroGuiaPrestador: exigir(valorTiss(guia, 'numeroGuiaPrestador'), 'corpo-ausente'),
    carteira: exigir(valorTiss(guia, 'numeroCarteira'), 'corpo-ausente'),
    recemNascido: valorTiss(guia, 'atendimentoRN') === 'S',
    urgencia: carater === '2',
    indicacaoClinica: valorTiss(sadt ? guia : dados, 'indicacaoClinica'),
    cid: cid ? cid.toUpperCase() : null,
    profissional: {
      nome: valorTiss(prof, 'nomeProfissional') ?? '',
      conselho: CONSELHO_DO_CODIGO_TISS[valorTiss(prof, 'conselhoProfissional') ?? ''] ?? null,
      numero: valorTiss(prof, 'numeroConselhoProfissional') ?? '',
      uf: UF_DO_CODIGO_IBGE[valorTiss(prof, 'UF') ?? ''] ?? null,
    },
    internacao: int
      ? {
          tipo: Number(valorTiss(dados, 'tipoInternacao') ?? '1'),
          diarias: Number(valorTiss(dados, 'qtDiariasSolicitadas') ?? '1'),
          admissaoPrevista:
            valorTiss(guia, 'dataSugeridaInternacao') ??
            exigir(valorTiss(guia, 'dataSolicitacao'), 'corpo-ausente'),
        }
      : null,
    itens: blocosTiss(guia, 'procedimentosSolicitados').map((b) => ({
      tabela: Number(valorTiss(b, 'codigoTabela') ?? '0'),
      codigo: valorTiss(b, 'codigoProcedimento') ?? '',
      descricao: valorTiss(b, 'descricaoProcedimento'),
      quantidade: Number(valorTiss(b, 'quantidadeSolicitada') ?? '1'),
    })),
  };
}

/** O que falta para a guia TISS virar o pedido da operadora (sem isso, a troca fica rejeitada com o motivo). */
export function problemasDaSolicitacao(s: SolicitacaoLida): ProblemaTroca[] {
  const p: ProblemaTroca[] = [];
  if (!s.profissional.conselho) p.push({ codigo: 'conselho-nao-aceito', campo: 'profissional' });
  if (!s.profissional.uf) p.push({ codigo: 'uf-invalida', campo: 'profissional' });
  if (!s.itens.length) p.push({ codigo: 'sem-itens', campo: 'itens' });
  if (s.itens.some((i) => ![18, 19, 20, 22].includes(i.tabela)))
    p.push({ codigo: 'tabela-nao-aceita', campo: 'itens' });
  if (s.tipo === 'internacao' && !s.cid) p.push({ codigo: 'internacao-sem-cid', campo: 'cid' });
  return p;
}

/**
 * A guia TISS no pedido da operadora (o mesmo pedido do portal e da central): o prestador, o tipo de guia e a origem
 * "troca eletrônica" vêm resolvidos do banco; o resto, da mensagem.
 */
export function pedidoDaSolicitacao(
  s: SolicitacaoLida,
  r: { readonly prestador: number; readonly tipoGuia: number; readonly origem: number },
) {
  return {
    carteirinha: s.carteira,
    prestador: r.prestador,
    executante: null,
    tipoGuia: r.tipoGuia,
    carater: s.urgencia ? ('U' as const) : ('E' as const),
    altaComplexidade: false,
    origem: r.origem,
    guiaPrincipal: null,
    cid: s.cid,
    indicacaoClinica: s.indicacaoClinica ?? '',
    profissional: {
      nome: s.profissional.nome,
      conselho: s.profissional.conselho ?? '',
      numero: s.profissional.numero,
      uf: s.profissional.uf ?? '',
    },
    internacao: s.internacao,
    itens: s.itens.map((i) => ({
      tabela: i.tabela,
      codigo: i.codigo,
      descricao: i.tabela === 22 ? null : i.descricao,
      quantidade: i.quantidade,
    })),
  };
}

// ── Demonstrativo de pagamento ───────────────────────────────────────────────────────────────────

/** Os valores do demonstrativo de pagamento em centavos inteiros: líquido = liberado − débitos + créditos (≥ 0). */
export function valoresDoDemonstrativoPagamento(v: {
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
  readonly debitos?: number;
  readonly creditos?: number;
}) {
  const c = (x: number) => Math.round(x * 100);
  const debitos = c(v.debitos ?? 0);
  const creditos = c(v.creditos ?? 0);
  const liquido = c(v.liberado) - debitos + creditos;
  if ([v.informado, v.liberado, v.glosa, v.debitos ?? 0, v.creditos ?? 0].some((x) => x < 0) || liquido < 0)
    throw new ErroTrocaTiss('valores-invalidos');
  return {
    informado: c(v.informado) / 100,
    processado: c(v.informado) / 100,
    liberado: c(v.liberado) / 100,
    glosa: c(v.glosa) / 100,
    debitos: debitos / 100,
    creditos: creditos / 100,
    liquido: liquido / 100,
  };
}
