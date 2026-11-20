// O lado da operadora no TISS 04.03.00 (M56, etapa 6, F5; ficha, regra 5; cap-13 §13.3.7): a operadora própria da Rede
// recebe o lote de guias que o prestador gera (o mesmo XML que o M31 monta do lado do hospital) e devolve o demonstrativo
// de análise da conta. Aqui ficam as duas pontas puras, sem banco:
//   - `lerLoteRecebido`: do XML já validado no XSD e com o hash do epílogo conferido (validacao.ts, lote.ts) sai o lote
//     neutro de @sgh/contratos (o prestador de origem, o registro na ANS do destino, o número do lote e cada guia com a
//     carteirinha, a senha, o caráter, as datas e os itens: procedimentos e outras despesas, com a quantidade, o fator, o
//     valor unitário e o total). O XML é lido por expressões sobre os elementos (com ou sem o prefixo), como o
//     demonstrativo do M31; o que não é lote de guias é recusado;
//   - `mensagemDemonstrativoAnalise`: o demonstrativo de análise da conta (DEMONSTRATIVO_ANALISE_CONTA) da operadora para
//     o prestador, com o protocolo, a situação, cada guia (pela carteirinha: o XSD 04.03.00 não leva o nome do beneficiário) e cada item
//     com o informado, o liberado e as glosas (tabela 38),
//     montado pela mesma árvore canônica e com o mesmo hash do epílogo das mensagens do hospital (só 04.03.00);
//   - `mensagemDemonstrativoPagamento` (W0-10, M8): o demonstrativo de pagamento (DEMONSTRATIVO_PAGAMENTO) do lote pago,
//     com a data e a forma do pagamento, o protocolo com os valores e cada guia (inicial ou de recurso), os totais brutos
//     e os líquidos (sem débitos nem créditos: o líquido é o liberado), pela mesma árvore e o mesmo hash do epílogo.
import type {
  GrupoItemConta,
  GuiaTissRecebida,
  ItemTissRecebido,
  LoteTissRecebido,
  TipoGuiaConta,
} from '@sgh/contratos';
import { dinheiro, hashEpilogo, type MensagemTiss, PADRAO_TISS, VERSAO_TISS } from './lote.js';
import { desescapar, el, type Elemento, latin1, opcional, serializar } from './xml.js';

export class ErroLoteRecebido extends Error {
  override readonly name = 'ErroLoteRecebido';
  readonly codigo: 'arquivo-invalido' | 'transacao-nao-e-lote';
  constructor(codigo: 'arquivo-invalido' | 'transacao-nao-e-lote', mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const tag = (nome: string) =>
  new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${nome}>`, 'g');
const valorDe = (xml: string, nome: string): string | null => {
  const r = tag(nome).exec(xml);
  return r ? desescapar(r[1]!.replace(/<[^>]+>/g, '').trim()) : null;
};
const blocos = (xml: string, nome: string): string[] => [...xml.matchAll(tag(nome))].map((m) => m[1]!);
const primeiro = (xml: string, nome: string): string => blocos(xml, nome)[0] ?? '';
const numero = (s: string | null): number => {
  const n = Number((s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const data = (s: string | null): string => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

/** As guias do lote e o elemento de cada uma no XSD. */
const ELEMENTO_DA_GUIA: Readonly<Record<TipoGuiaConta, string>> = {
  consulta: 'guiaConsulta',
  'sp-sadt': 'guiaSP-SADT',
  'resumo-internacao': 'guiaResumoInternacao',
  honorario: 'guiaHonorarios',
};

function itemDe(x: string, grupo: GrupoItemConta, codigoDespesa: string | null): ItemTissRecebido {
  const proc = grupo === 'procedimento' ? primeiro(x, 'procedimento') : x;
  return {
    sequencial: Math.trunc(numero(valorDe(x, 'sequencialItem'))),
    grupo,
    codigoDespesa,
    tabela: valorDe(proc, 'codigoTabela') ?? '',
    codigo: valorDe(proc, 'codigoProcedimento') ?? '',
    descricao: valorDe(proc, 'descricaoProcedimento') ?? '',
    data: data(valorDe(x, 'dataExecucao')),
    quantidade: numero(valorDe(x, 'quantidadeExecutada')),
    fator: valorDe(x, 'reducaoAcrescimo') === null ? 1 : numero(valorDe(x, 'reducaoAcrescimo')),
    valorUnitario: numero(valorDe(x, 'valorUnitario')),
    valorTotal: numero(valorDe(x, 'valorTotal')),
  };
}

function itensDe(g: string, procedimentos: string, item: string): ItemTissRecebido[] {
  const itens = blocos(primeiro(g, procedimentos), item).map((x) => itemDe(x, 'procedimento', null));
  // Na despesa, o sequencial e o código da despesa ficam fora dos serviços executados (ct_outrasDespesas).
  for (const d of blocos(primeiro(g, 'outrasDespesas'), 'despesa'))
    itens.push({
      ...itemDe(primeiro(d, 'servicosExecutados'), 'despesa', valorDe(d, 'codigoDespesa')),
      sequencial: Math.trunc(numero(valorDe(d, 'sequencialItem'))),
    });
  return itens;
}

const carater = (v: string | null): '1' | '2' | null => (v === '1' || v === '2' ? v : null);

function periodo(
  itens: readonly ItemTissRecebido[],
  inicio: string,
  fim: string,
): { inicio: string; fim: string } {
  const datas = itens.map((i) => i.data).filter(Boolean);
  const i0 = inicio || [...datas].sort()[0] || '';
  const f0 = fim || [...datas].sort().at(-1) || i0;
  return { inicio: i0, fim: f0 };
}

function guiaDe(tipo: TipoGuiaConta, g: string): GuiaTissRecebida {
  const cab = primeiro(g, tipo === 'consulta' ? 'cabecalhoConsulta' : 'cabecalhoGuia');
  const benef = primeiro(g, tipo === 'honorario' ? 'beneficiario' : 'dadosBeneficiario');
  const comum = {
    tipo,
    registroAns: valorDe(cab, 'registroANS') ?? '',
    numeroGuiaPrestador: valorDe(cab, 'numeroGuiaPrestador') ?? '',
    carteirinha: valorDe(benef, 'numeroCarteira') ?? '',
    atendimentoRN: valorDe(benef, 'atendimentoRN') === 'S',
  };
  if (tipo === 'consulta') {
    const at = primeiro(g, 'dadosAtendimento');
    const proc = primeiro(at, 'procedimento');
    const dia = data(valorDe(at, 'dataAtendimento'));
    const valor = numero(valorDe(proc, 'valorProcedimento'));
    return {
      ...comum,
      numeroGuiaOperadora: valorDe(cab, 'numeroGuiaOperadora') ?? valorDe(g, 'numeroGuiaOperadora'),
      senha: null,
      carater: null,
      inicio: dia,
      fim: dia,
      itens: [
        {
          sequencial: 1,
          grupo: 'procedimento',
          codigoDespesa: null,
          tabela: valorDe(proc, 'codigoTabela') ?? '',
          codigo: valorDe(proc, 'codigoProcedimento') ?? '',
          descricao: '',
          data: dia,
          quantidade: 1,
          fator: 1,
          valorUnitario: valor,
          valorTotal: valor,
        },
      ],
    };
  }
  if (tipo === 'sp-sadt') {
    const aut = primeiro(g, 'dadosAutorizacao');
    const itens = itensDe(g, 'procedimentosExecutados', 'procedimentoExecutado');
    return {
      ...comum,
      numeroGuiaOperadora: valorDe(aut, 'numeroGuiaOperadora'),
      senha: valorDe(aut, 'senha'),
      carater: carater(valorDe(primeiro(g, 'dadosSolicitacao'), 'caraterAtendimento')),
      ...periodo(itens, '', ''),
      itens,
    };
  }
  if (tipo === 'resumo-internacao') {
    const aut = primeiro(g, 'dadosAutorizacao');
    const int = primeiro(g, 'dadosInternacao');
    const itens = itensDe(g, 'procedimentosExecutados', 'procedimentoExecutado');
    return {
      ...comum,
      numeroGuiaOperadora: valorDe(aut, 'numeroGuiaOperadora'),
      senha: valorDe(aut, 'senha'),
      carater: carater(valorDe(int, 'caraterAtendimento')),
      ...periodo(
        itens,
        data(valorDe(int, 'dataInicioFaturamento')),
        data(valorDe(int, 'dataFinalFaturamento')),
      ),
      itens,
    };
  }
  const int = primeiro(g, 'dadosInternacao');
  const itens = itensDe(g, 'procedimentosRealizados', 'procedimentoRealizado');
  // O honorário: a senha e o número da guia da operadora vêm logo depois da guia de solicitação da internação.
  const semItens = g.replace(tag('procedimentosRealizados'), '').replace(tag('beneficiario'), '');
  return {
    ...comum,
    numeroGuiaOperadora: valorDe(semItens, 'numeroGuiaOperadora'),
    senha: valorDe(semItens, 'senha'),
    carater: carater(valorDe(int, 'caraterAtendimento')),
    ...periodo(itens, data(valorDe(int, 'dataInicioFaturamento')), data(valorDe(int, 'dataFimFaturamento'))),
    itens,
  };
}

function prestadorDaOrigem(cabecalho: string): LoteTissRecebido['prestador'] {
  const p = primeiro(primeiro(cabecalho, 'origem'), 'identificacaoPrestador');
  const codigo = valorDe(p, 'codigoPrestadorNaOperadora');
  if (codigo) return { tipo: 'codigo', valor: codigo };
  const cpf = valorDe(p, 'CPF');
  if (cpf) return { tipo: 'cpf', valor: cpf };
  return { tipo: 'cnpj', valor: valorDe(p, 'CNPJ') ?? '' };
}

/**
 * O lote de guias recebido (ENVIO_LOTE_GUIAS). Lê o que o XSD já validou; recusa o que não é lote de guias. O nome do
 * beneficiário nunca é lido (a operadora tem o cadastro dela pela carteirinha).
 */
export function lerLoteRecebido(xml: string): LoteTissRecebido {
  if (!/<(?:[A-Za-z0-9_]+:)?mensagemTISS\b/.test(xml))
    throw new ErroLoteRecebido('arquivo-invalido', 'O arquivo não é uma mensagem TISS.');
  const cab = primeiro(xml, 'cabecalho');
  const tipoTransacao = valorDe(primeiro(cab, 'identificacaoTransacao'), 'tipoTransacao') ?? '';
  const lote = primeiro(xml, 'loteGuias');
  if (tipoTransacao !== 'ENVIO_LOTE_GUIAS' || !lote)
    throw new ErroLoteRecebido(
      'transacao-nao-e-lote',
      'O arquivo não é um lote de guias (ENVIO_LOTE_GUIAS).',
    );
  const guiasXml = primeiro(lote, 'guiasTISS');
  const tipos = (Object.keys(ELEMENTO_DA_GUIA) as TipoGuiaConta[]).filter((t) =>
    tag(ELEMENTO_DA_GUIA[t]).test(guiasXml),
  );
  if (tipos.length !== 1)
    throw new ErroLoteRecebido('arquivo-invalido', 'O lote tem de trazer guias de um só tipo.');
  const tipoGuia = tipos[0]!;
  return {
    tipoTransacao,
    sequencialTransacao: valorDe(cab, 'sequencialTransacao') ?? '',
    dataTransacao: data(valorDe(cab, 'dataRegistroTransacao')),
    padrao: valorDe(cab, 'Padrao'),
    prestador: prestadorDaOrigem(cab),
    registroAnsDestino: valorDe(primeiro(cab, 'destino'), 'registroANS') ?? '',
    numeroLote: valorDe(lote, 'numeroLote') ?? '',
    tipoGuia,
    guias: blocos(guiasXml, ELEMENTO_DA_GUIA[tipoGuia]).map((g) => guiaDe(tipoGuia, g)),
  };
}

// ── Demonstrativo de análise da conta (operadora → prestador) ──────────────────────────────────────

export interface GlosaDemonstrativo {
  readonly valor: number;
  /** Código da tabela 38 (dm_tipoGlosa). */
  readonly tipo: string;
}

export interface ItemDemonstrativoAnalise {
  readonly sequencial: number;
  readonly data: string;
  readonly tabela: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly informado: number;
  readonly quantidade: number;
  readonly liberado: number;
  readonly glosas: readonly GlosaDemonstrativo[];
}

export interface GuiaDemonstrativoAnalise {
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  readonly numeroCarteira: string;
  readonly inicio: string;
  readonly fim: string | null;
  /** dm_statusProtocolo da guia. */
  readonly situacao: string;
  readonly itens: readonly ItemDemonstrativoAnalise[];
}

export interface DemonstrativoAnalise {
  readonly sequencialTransacao: string;
  readonly data: string;
  readonly hora: string;
  readonly registroAns: string;
  readonly nomeOperadora: string;
  readonly cnpjOperadora: string;
  readonly numeroDemonstrativo: string;
  readonly prestador: LoteTissRecebido['prestador'];
  readonly cnes: string;
  readonly numeroLote: string;
  readonly protocolo: string;
  readonly dataProtocolo: string;
  /** dm_statusProtocolo do lote. */
  readonly situacao: string;
  readonly guias: readonly GuiaDemonstrativoAnalise[];
  readonly observacao: string | null;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => dinheiro(c / 100);
/** Texto limitado ao tamanho do XSD, só com caracteres do ISO-8859-1 (os outros viram espaço). */
const texto = (s: string, max: number) =>
  (
    s
      .replace(/[^\x20-\x7e\xa0-\xff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '-'
  ).slice(0, max);

function contratado(p: LoteTissRecebido['prestador']): Elemento {
  if (p.tipo === 'cpf') return el('cpfContratado', p.valor);
  if (p.tipo === 'cnpj') return el('cnpjContratado', p.valor);
  return el('codigoPrestadorNaOperadora', p.valor);
}

function identificacao(p: LoteTissRecebido['prestador']): Elemento {
  if (p.tipo === 'cpf') return el('CPF', p.valor);
  if (p.tipo === 'cnpj') return el('CNPJ', p.valor);
  return el('codigoPrestadorNaOperadora', p.valor);
}

function itemXml(i: ItemDemonstrativoAnalise): Elemento {
  return el(
    'detalhesGuia',
    el('sequencialItem', String(i.sequencial)),
    el('dataRealizacao', i.data),
    el(
      'procedimento',
      el('codigoTabela', i.tabela),
      el('codigoProcedimento', i.codigo.slice(0, 10)),
      el('descricaoProcedimento', texto(i.descricao, 150)),
    ),
    el('valorInformado', reais(centavos(i.informado))),
    el('qtdExecutada', i.quantidade.toFixed(4)),
    el('valorProcessado', reais(centavos(i.informado))),
    el('valorLiberado', reais(centavos(i.liberado))),
    ...i.glosas
      .filter((g) => centavos(g.valor) > 0)
      .map((g) => el('relacaoGlosa', el('valorGlosa', reais(centavos(g.valor))), el('tipoGlosa', g.tipo))),
  );
}

function guiaXml(g: GuiaDemonstrativoAnalise): Elemento {
  return el(
    'relacaoGuias',
    el('numeroGuiaPrestador', g.numeroGuiaPrestador),
    opcional('numeroGuiaOperadora', g.numeroGuiaOperadora),
    opcional('senha', g.senha),
    el('numeroCarteira', g.numeroCarteira.slice(0, 20)),
    el('dataInicioFat', g.inicio),
    opcional('dataFimFat', g.fim),
    el('situacaoGuia', g.situacao),
    ...g.itens.map(itemXml),
    el('valorInformadoGuia', reais(g.itens.reduce((s, i) => s + centavos(i.informado), 0))),
    el('valorProcessadoGuia', reais(g.itens.reduce((s, i) => s + centavos(i.informado), 0))),
    el('valorLiberadoGuia', reais(g.itens.reduce((s, i) => s + centavos(i.liberado), 0))),
    el(
      'valorGlosaGuia',
      reais(g.itens.reduce((s, i) => s + i.glosas.reduce((t, x) => t + centavos(x.valor), 0), 0)),
    ),
  );
}

/** O demonstrativo de análise da conta, só em 04.03.00 (DP-47.7), com o hash do epílogo. */
export function mensagemDemonstrativoAnalise(d: DemonstrativoAnalise): MensagemTiss {
  const informado = d.guias.flatMap((g) => g.itens).reduce((s, i) => s + centavos(i.informado), 0);
  const liberado = d.guias.flatMap((g) => g.itens).reduce((s, i) => s + centavos(i.liberado), 0);
  const glosa = d.guias
    .flatMap((g) => g.itens)
    .reduce((s, i) => s + i.glosas.reduce((t, x) => t + centavos(x.valor), 0), 0);
  const cabecalho = el(
    'cabecalho',
    el(
      'identificacaoTransacao',
      el('tipoTransacao', 'DEMONSTRATIVO_ANALISE_CONTA'),
      el('sequencialTransacao', d.sequencialTransacao),
      el('dataRegistroTransacao', d.data),
      el('horaRegistroTransacao', d.hora),
    ),
    el('origem', el('registroANS', d.registroAns)),
    el('destino', el('identificacaoPrestador', identificacao(d.prestador))),
    el('Padrao', PADRAO_TISS),
  );
  const corpo = el(
    'operadoraParaPrestador',
    el(
      'demonstrativosRetorno',
      el(
        'demonstrativoAnaliseConta',
        el(
          'cabecalhoDemonstrativo',
          el('registroANS', d.registroAns),
          el('numeroDemonstrativo', d.numeroDemonstrativo),
          el('nomeOperadora', texto(d.nomeOperadora, 70)),
          el('numeroCNPJ', d.cnpjOperadora),
          el('dataEmissao', d.data),
        ),
        el('dadosPrestador', el('dadosContratado', contratado(d.prestador)), el('CNES', d.cnes || '9999999')),
        el(
          'dadosConta',
          el(
            'dadosProtocolo',
            el('numeroLotePrestador', d.numeroLote),
            el('numeroProtocolo', d.protocolo),
            el('dataProtocolo', d.dataProtocolo),
            el('situacaoProtocolo', d.situacao),
            ...d.guias.map(guiaXml),
            el('valorInformadoProtocolo', reais(informado)),
            el('valorProcessadoProtocolo', reais(informado)),
            el('valorLiberadoProtocolo', reais(liberado)),
            el('valorGlosaProtocolo', reais(glosa)),
          ),
        ),
        el('valorInformadoGeral', reais(informado)),
        el('valorProcessadoGeral', reais(informado)),
        el('valorLiberadoGeral', reais(liberado)),
        el('valorGlosaGeral', reais(glosa)),
        opcional('observacao', d.observacao ? texto(d.observacao, 500) : null),
      ),
    ),
  );
  const hash = hashEpilogo(cabecalho, corpo);
  const xml = serializar(el('mensagemTISS', cabecalho, corpo, el('epilogo', el('hash', hash))));
  return { versao: VERSAO_TISS, tipoTransacao: 'DEMONSTRATIVO_ANALISE_CONTA', xml, bytes: latin1(xml), hash };
}

// ── Demonstrativo de pagamento (operadora → prestador, W0-10 M8) ───────────────────────────────────

export interface GuiaDemonstrativoPagamento {
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  /** A guia teve valor acatado em recurso de glosa (dm_tipoPagamento 2); senão é o pagamento inicial (1). */
  readonly recurso: boolean;
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
}

export interface ProtocoloDemonstrativoPagamento {
  readonly dataProtocolo: string;
  readonly protocolo: string;
  readonly numeroLote: string;
  readonly guias: readonly GuiaDemonstrativoPagamento[];
}

export interface PagamentoDemonstrativo {
  readonly data: string;
  /** dm_formaPagamento: 1 depósito/transferência, 2 carteira, 3 boleto, 4 outros. */
  readonly forma: '1' | '2' | '3' | '4';
  readonly protocolos: readonly ProtocoloDemonstrativoPagamento[];
}

export interface DemonstrativoPagamento {
  readonly sequencialTransacao: string;
  readonly data: string;
  readonly hora: string;
  readonly registroAns: string;
  readonly nomeOperadora: string;
  readonly cnpjOperadora: string;
  readonly numeroDemonstrativo: string;
  readonly prestador: LoteTissRecebido['prestador'];
  readonly cnes: string;
  readonly pagamentos: readonly PagamentoDemonstrativo[];
  readonly observacao: string | null;
}

interface Somas {
  informado: number;
  liberado: number;
  glosa: number;
}
const somar = (gs: readonly GuiaDemonstrativoPagamento[]): Somas =>
  gs.reduce(
    (s, g) => ({
      informado: s.informado + centavos(g.informado),
      liberado: s.liberado + centavos(g.liberado),
      glosa: s.glosa + centavos(g.glosa),
    }),
    { informado: 0, liberado: 0, glosa: 0 },
  );

function protocoloPagamentoXml(p: ProtocoloDemonstrativoPagamento): Elemento {
  const t = somar(p.guias);
  return el(
    'relacaoProtocolos',
    el('dataProtocolo', p.dataProtocolo),
    el('numeroProtocolo', p.protocolo.slice(0, 12)),
    el('numeroLote', p.numeroLote.slice(0, 12)),
    el('valorInformado', reais(t.informado)),
    el('valorProcessado', reais(t.informado)),
    el('valorLiberado', reais(t.liberado)),
    el('valorGlosa', reais(t.glosa)),
    ...p.guias.map((g) =>
      el(
        'guiasDoLote',
        el('numeroGuiaPrestador', g.numeroGuiaPrestador.slice(0, 20)),
        opcional('numeroGuiaOperadora', g.numeroGuiaOperadora),
        opcional('senha', g.senha),
        el('tipoPagamento', g.recurso ? '2' : '1'),
        el('valorProcessadoGuia', reais(centavos(g.informado))),
        el('valorLiberadoGuia', reais(centavos(g.liberado))),
        el('valorGlosaGuia', reais(centavos(g.glosa))),
      ),
    ),
  );
}

/** O demonstrativo de pagamento, só em 04.03.00, com o hash do epílogo. Exige ao menos um pagamento com um protocolo. */
export function mensagemDemonstrativoPagamento(d: DemonstrativoPagamento): MensagemTiss {
  if (
    !d.pagamentos.length ||
    d.pagamentos.some((p) => !p.protocolos.length || p.protocolos.some((x) => !x.guias.length))
  )
    throw new Error('O demonstrativo de pagamento precisa de um pagamento com protocolo e guias.');
  const porData = d.pagamentos.map((p) => ({ p, t: somar(p.protocolos.flatMap((x) => x.guias)) }));
  const geral = porData.reduce(
    (s, { t }) => ({
      informado: s.informado + t.informado,
      liberado: s.liberado + t.liberado,
      glosa: s.glosa + t.glosa,
    }),
    { informado: 0, liberado: 0, glosa: 0 },
  );
  const cabecalho = el(
    'cabecalho',
    el(
      'identificacaoTransacao',
      el('tipoTransacao', 'DEMONSTRATIVO_PAGAMENTO'),
      el('sequencialTransacao', d.sequencialTransacao),
      el('dataRegistroTransacao', d.data),
      el('horaRegistroTransacao', d.hora),
    ),
    el('origem', el('registroANS', d.registroAns)),
    el('destino', el('identificacaoPrestador', identificacao(d.prestador))),
    el('Padrao', PADRAO_TISS),
  );
  const corpo = el(
    'operadoraParaPrestador',
    el(
      'demonstrativosRetorno',
      el(
        'demonstrativoPagamento',
        el(
          'cabecalhoDemonstrativo',
          el('registroANS', d.registroAns),
          el('numeroDemonstrativo', d.numeroDemonstrativo.slice(0, 20)),
          el('nomeOperadora', texto(d.nomeOperadora, 70)),
          el('numeroCNPJ', d.cnpjOperadora),
          el('dataEmissao', d.data),
        ),
        el('dadosContratado', el('dadosPrestador', contratado(d.prestador)), el('CNES', d.cnes || '9999999')),
        el(
          'pagamentos',
          ...porData.map(({ p, t }) =>
            el(
              'pagamentosPorData',
              el('dadosPagamento', el('dataPagamento', p.data), el('formaPagamento', p.forma)),
              el('dadosResumo', ...p.protocolos.map(protocoloPagamentoXml)),
              el(
                'totaisBrutosPorData',
                el('totalInformadoPorData', reais(t.informado)),
                el('totalProcessadoPorData', reais(t.informado)),
                el('totaLiberadoPorData', reais(t.liberado)),
                el('totalGlosaPorData', reais(t.glosa)),
              ),
              el(
                'totaisLiquidosPorData',
                el('totalDebitosPorData', reais(0)),
                el('totalCreditosPorData', reais(0)),
                el('liquidoPorData', reais(t.liberado)),
              ),
            ),
          ),
        ),
        el(
          'totaisDemonstrativo',
          el(
            'totaisBrutosDemonstrativo',
            el('valorInformadoBruto', reais(geral.informado)),
            el('valorProcessadoBruto', reais(geral.informado)),
            el('valorLiberadoBruto', reais(geral.liberado)),
            el('valorGlosaBruto', reais(geral.glosa)),
          ),
          el(
            'totaisLiquidosDemonstrativo',
            el('totalDebitosDemonstrativo', reais(0)),
            el('totalCreditosdemonstrativo', reais(0)),
            el('valorLiberadoDemonstrativo', reais(geral.liberado)),
          ),
        ),
        opcional('observacao', d.observacao ? texto(d.observacao, 500) : null),
      ),
    ),
  );
  const hash = hashEpilogo(cabecalho, corpo);
  const xml = serializar(el('mensagemTISS', cabecalho, corpo, el('epilogo', el('hash', hash))));
  return { versao: VERSAO_TISS, tipoTransacao: 'DEMONSTRATIVO_PAGAMENTO', xml, bytes: latin1(xml), hash };
}
