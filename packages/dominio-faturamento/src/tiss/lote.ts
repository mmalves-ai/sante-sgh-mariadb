// Gerador de mensagens TISS **só na versão 04.03.00** (DP-47.7: única versão de troca aceita desde
// 2026-07-01, inclusive reapresentação e recurso de glosa; DP-37: o legado não a gera). Regra 7 da ficha do
// M09 (cap-12 §12.2, cap-16 R25): o XML é validado no XSD oficial (versionado com SHA-256) antes de ser
// "pronto"; o hash do epílogo é conferido; nada é enviado fora de produção. O gerador completo, a partir da
// conta do legado, é do M31; aqui ficam a estrutura da mensagem e as quatro guias de prova (consulta,
// SP/SADT, resumo de internação e recurso de glosa), com dados sintéticos de teste.
import { md5Hex } from './md5.js';
import { el, type Elemento, ErroXmlTiss, latin1, opcional, serializar, textos, desescapar } from './xml.js';

/** A única versão gerada (sem parâmetro: a 04.01.00 configurada no legado não é mais aceita). */
export const VERSAO_TISS = '04.03.00';
/** Valor do elemento Padrao no cabeçalho (dm_versao do XSD). */
export const PADRAO_TISS = '4.03.00';

export interface Cabecalho {
  readonly sequencialTransacao: string;
  /** AAAA-MM-DD */
  readonly data: string;
  /** HH:MM:SS */
  readonly hora: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly registroANS: string;
}

export interface Beneficiario {
  readonly numeroCarteira: string;
  /** Atendimento ao recém-nascido; o XML da TISS (dmSimNao) recebe S ou N. */
  readonly atendimentoRN: boolean;
}

export interface Profissional {
  readonly conselho: string;
  readonly numeroConselho: string;
  readonly uf: string;
  readonly cbos: string;
}

export interface Procedimento {
  readonly codigoTabela: string;
  readonly codigo: string;
  readonly descricao: string;
}

export interface ItemExecutado {
  readonly sequencial: number;
  /** AAAA-MM-DD */
  readonly data: string;
  readonly procedimento: Procedimento;
  readonly quantidade: number;
  readonly valorUnitario: number;
}

export interface GuiaConsulta {
  readonly tipo: 'consulta';
  readonly numeroGuiaPrestador: string;
  readonly beneficiario: Beneficiario;
  readonly cnes: string;
  readonly profissional: Profissional;
  readonly dataAtendimento: string;
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  readonly procedimento: Omit<Procedimento, 'descricao'>;
  readonly valor: number;
}

export interface GuiaSpSadt {
  readonly tipo: 'sp-sadt';
  readonly numeroGuiaPrestador: string;
  readonly beneficiario: Beneficiario;
  readonly nomeContratadoSolicitante: string;
  readonly profissionalSolicitante: Profissional;
  readonly cnes: string;
  readonly caraterAtendimento: '1' | '2';
  readonly tipoAtendimento: string;
  readonly itens: readonly ItemExecutado[];
  readonly despesas?: readonly Despesa[];
  /** M56.6: a autorização da operadora (a senha que a operadora deu), quando o atendimento foi autorizado. */
  readonly autorizacao?: { readonly data: string; readonly senha: string };
}

export interface GuiaResumoInternacao {
  readonly tipo: 'resumo-internacao';
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaSolicitacao: string;
  readonly dataAutorizacao: string;
  readonly senha: string;
  readonly beneficiario: Beneficiario;
  readonly cnes: string;
  readonly caraterAtendimento: '1' | '2';
  readonly tipoFaturamento: '1' | '2' | '3' | '4';
  readonly inicio: { readonly data: string; readonly hora: string };
  readonly fim: { readonly data: string; readonly hora: string };
  readonly tipoInternacao: '1' | '2' | '3' | '4' | '5';
  readonly regimeInternacao: '1' | '2' | '3';
  readonly motivoEncerramento: string;
  readonly itens: readonly ItemExecutado[];
  readonly despesas?: readonly Despesa[];
}

/** Outras despesas (mat/med, diárias e taxas) da SP/SADT e do resumo de internação (ct_outrasDespesas). */
export interface Despesa {
  readonly sequencial: number;
  /** dm_outrasDespesas: 01 gases, 02 medicamentos, 03 materiais, 05 diárias, 07 taxas e aluguéis, 08 OPME. */
  readonly codigoDespesa: '01' | '02' | '03' | '05' | '07' | '08';
  readonly data: string;
  readonly codigoTabela: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
  /** dm_unidadeMedida (ex.: 036 unidade). */
  readonly unidadeMedida: string;
  readonly valorUnitario: number;
}

export interface MembroEquipe {
  readonly grauParticipacao: string;
  readonly codigoPrestador: string;
  readonly nome: string;
  readonly profissional: Profissional;
}

/** Guia de honorário individual (ctm_honorarioIndividualGuia). */
export interface GuiaHonorario {
  readonly tipo: 'honorario';
  readonly numeroGuiaPrestador: string;
  readonly guiaSolicitacaoInternacao: string;
  readonly beneficiario: Beneficiario;
  readonly nomeContratado: string;
  readonly cnes: string;
  readonly inicio: string;
  readonly fim: string;
  readonly caraterAtendimento: '1' | '2';
  readonly itens: readonly (ItemExecutado & { readonly equipe: readonly MembroEquipe[] })[];
  readonly dataEmissao: string;
  /** M56.6: a senha da internação autorizada pela operadora (opcional no XSD). */
  readonly senha?: string;
}

export type Guia = GuiaConsulta | GuiaSpSadt | GuiaResumoInternacao | GuiaHonorario;

export interface RecursoGlosa {
  readonly numeroGuiaRecurso: string;
  readonly nomeOperadora: string;
  readonly numeroLote: string;
  readonly numeroProtocolo: string;
  readonly data: string;
  readonly guias: readonly {
    readonly numeroGuiaOrigem: string;
    readonly codigoGlosa: string;
    readonly justificativa: string;
    readonly valorRecursado: number;
  }[];
}

export class ErroLoteTiss extends Error {
  override readonly name = 'ErroLoteTiss';
}

/** Valor monetário no formato do XSD (st_decimal10-2): ponto decimal, duas casas. */
export function dinheiro(v: number): string {
  if (!Number.isFinite(v) || v < 0) throw new ErroLoteTiss(`Valor inválido: ${v}.`);
  return (Math.round(v * 100) / 100).toFixed(2);
}

const soma = (itens: readonly ItemExecutado[]) =>
  itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100;

/** O booleano no domínio dmSimNao do XML da TISS. */
const simNao = (v: boolean): string => (v ? 'S' : 'N');

function beneficiario(b: Beneficiario): Elemento {
  return el(
    'dadosBeneficiario',
    el('numeroCarteira', b.numeroCarteira),
    el('atendimentoRN', simNao(b.atendimentoRN)),
  );
}

function profissional(nome: string, p: Profissional): Elemento {
  return el(
    nome,
    el('conselhoProfissional', p.conselho),
    el('numeroConselhoProfissional', p.numeroConselho),
    el('UF', p.uf),
    el('CBOS', p.cbos),
  );
}

function procedimento(nome: string, p: Procedimento): Elemento {
  return el(
    nome,
    el('codigoTabela', p.codigoTabela),
    el('codigoProcedimento', p.codigo),
    el('descricaoProcedimento', p.descricao),
  );
}

function itemExecutado(i: ItemExecutado, cabecalho: string): Elemento {
  return el(
    cabecalho,
    el('sequencialItem', String(i.sequencial)),
    el('dataExecucao', i.data),
    procedimento('procedimento', i.procedimento),
    el('quantidadeExecutada', String(i.quantidade)),
    el('reducaoAcrescimo', '1.00'),
    el('valorUnitario', dinheiro(i.valorUnitario)),
    el('valorTotal', dinheiro(i.quantidade * i.valorUnitario)),
  );
}

const somaDespesas = (ds: readonly Despesa[], codigos: readonly string[]) =>
  ds
    .filter((d) => codigos.includes(d.codigoDespesa))
    .reduce((s, d) => s + Math.round(d.quantidade * d.valorUnitario * 100), 0) / 100;

function valorTotal(itens: readonly ItemExecutado[], despesas: readonly Despesa[] = []): Elemento {
  const proc = soma(itens);
  const diarias = somaDespesas(despesas, ['05']);
  const taxas = somaDespesas(despesas, ['07']);
  const materiais = somaDespesas(despesas, ['03']);
  const medicamentos = somaDespesas(despesas, ['02']);
  const opme = somaDespesas(despesas, ['08']);
  const gases = somaDespesas(despesas, ['01']);
  const total = Math.round((proc + diarias + taxas + materiais + medicamentos + opme + gases) * 100) / 100;
  return el(
    'valorTotal',
    el('valorProcedimentos', dinheiro(proc)),
    diarias ? el('valorDiarias', dinheiro(diarias)) : null,
    taxas ? el('valorTaxasAlugueis', dinheiro(taxas)) : null,
    materiais ? el('valorMateriais', dinheiro(materiais)) : null,
    medicamentos ? el('valorMedicamentos', dinheiro(medicamentos)) : null,
    opme ? el('valorOPME', dinheiro(opme)) : null,
    gases ? el('valorGasesMedicinais', dinheiro(gases)) : null,
    el('valorTotalGeral', dinheiro(total)),
  );
}

/** Quantidade com até 4 casas (st_decimal9-4). */
const quantidade4 = (q: number) => (Math.round(q * 10_000) / 10_000).toFixed(4);

function despesasXml(ds: readonly Despesa[] | undefined): Elemento | null {
  if (!ds || ds.length === 0) return null;
  return el(
    'outrasDespesas',
    ...ds.map((d) =>
      el(
        'despesa',
        el('sequencialItem', String(d.sequencial)),
        el('codigoDespesa', d.codigoDespesa),
        el(
          'servicosExecutados',
          el('dataExecucao', d.data),
          el('codigoTabela', d.codigoTabela),
          el('codigoProcedimento', d.codigo),
          el('quantidadeExecutada', quantidade4(d.quantidade)),
          el('unidadeMedida', d.unidadeMedida),
          el('reducaoAcrescimo', '1.00'),
          el('valorUnitario', dinheiro(d.valorUnitario)),
          el('valorTotal', dinheiro(d.quantidade * d.valorUnitario)),
          el('descricaoProcedimento', d.descricao),
        ),
      ),
    ),
  );
}

function guiaXml(g: Guia, cab: Cabecalho): Elemento {
  const contratado = el('codigoPrestadorNaOperadora', cab.codigoPrestadorNaOperadora);
  switch (g.tipo) {
    case 'consulta':
      return el(
        'guiaConsulta',
        el(
          'cabecalhoConsulta',
          el('registroANS', cab.registroANS),
          el('numeroGuiaPrestador', g.numeroGuiaPrestador),
        ),
        beneficiario(g.beneficiario),
        el('contratadoExecutante', contratado, el('CNES', g.cnes)),
        profissional('profissionalExecutante', g.profissional),
        el('indicacaoAcidente', '9'),
        el(
          'dadosAtendimento',
          el('regimeAtendimento', '01'),
          el('dataAtendimento', g.dataAtendimento),
          el('tipoConsulta', g.tipoConsulta),
          el(
            'procedimento',
            el('codigoTabela', g.procedimento.codigoTabela),
            el('codigoProcedimento', g.procedimento.codigo),
            el('valorProcedimento', dinheiro(g.valor)),
          ),
        ),
      );
    case 'sp-sadt':
      return el(
        'guiaSP-SADT',
        el(
          'cabecalhoGuia',
          el('registroANS', cab.registroANS),
          el('numeroGuiaPrestador', g.numeroGuiaPrestador),
        ),
        g.autorizacao
          ? el(
              'dadosAutorizacao',
              el('dataAutorizacao', g.autorizacao.data),
              el('senha', g.autorizacao.senha),
            )
          : null,
        beneficiario(g.beneficiario),
        el(
          'dadosSolicitante',
          el('contratadoSolicitante', contratado),
          el('nomeContratadoSolicitante', g.nomeContratadoSolicitante),
          profissional('profissionalSolicitante', g.profissionalSolicitante),
        ),
        el('dadosSolicitacao', el('caraterAtendimento', g.caraterAtendimento)),
        el('dadosExecutante', el('contratadoExecutante', contratado), el('CNES', g.cnes)),
        el(
          'dadosAtendimento',
          el('tipoAtendimento', g.tipoAtendimento),
          el('indicacaoAcidente', '9'),
          el('regimeAtendimento', '01'),
        ),
        g.itens.length
          ? el('procedimentosExecutados', ...g.itens.map((i) => itemExecutado(i, 'procedimentoExecutado')))
          : null,
        despesasXml(g.despesas),
        valorTotal(g.itens, g.despesas),
      );
    case 'resumo-internacao':
      return el(
        'guiaResumoInternacao',
        el(
          'cabecalhoGuia',
          el('registroANS', cab.registroANS),
          el('numeroGuiaPrestador', g.numeroGuiaPrestador),
        ),
        el('numeroGuiaSolicitacaoInternacao', g.numeroGuiaSolicitacao),
        el('dadosAutorizacao', el('dataAutorizacao', g.dataAutorizacao), el('senha', g.senha)),
        beneficiario(g.beneficiario),
        el('dadosExecutante', el('contratadoExecutante', contratado), el('CNES', g.cnes)),
        el(
          'dadosInternacao',
          el('caraterAtendimento', g.caraterAtendimento),
          el('tipoFaturamento', g.tipoFaturamento),
          el('dataInicioFaturamento', g.inicio.data),
          el('horaInicioFaturamento', g.inicio.hora),
          el('dataFinalFaturamento', g.fim.data),
          el('horaFinalFaturamento', g.fim.hora),
          el('tipoInternacao', g.tipoInternacao),
          el('regimeInternacao', g.regimeInternacao),
        ),
        el(
          'dadosSaidaInternacao',
          el('indicadorAcidente', '9'),
          el('motivoEncerramento', g.motivoEncerramento),
        ),
        g.itens.length
          ? el('procedimentosExecutados', ...g.itens.map((i) => itemExecutado(i, 'procedimentoExecutado')))
          : null,
        valorTotal(g.itens, g.despesas),
        despesasXml(g.despesas),
      );
    case 'honorario':
      return el(
        'guiaHonorarios',
        el(
          'cabecalhoGuia',
          el('registroANS', cab.registroANS),
          el('numeroGuiaPrestador', g.numeroGuiaPrestador),
        ),
        el('guiaSolicInternacao', g.guiaSolicitacaoInternacao),
        opcional('senha', g.senha),
        el(
          'beneficiario',
          el('numeroCarteira', g.beneficiario.numeroCarteira),
          el('atendimentoRN', simNao(g.beneficiario.atendimentoRN)),
        ),
        el(
          'localContratado',
          el('codigoContratado', el('codigoNaOperadora', cab.codigoPrestadorNaOperadora)),
          el('nomeContratado', g.nomeContratado),
          el('cnes', g.cnes),
        ),
        el(
          'dadosContratadoExecutante',
          el('codigonaOperadora', cab.codigoPrestadorNaOperadora),
          el('cnesContratadoExecutante', g.cnes),
        ),
        el(
          'dadosInternacao',
          el('dataInicioFaturamento', g.inicio),
          el('dataFimFaturamento', g.fim),
          el('caraterAtendimento', g.caraterAtendimento),
        ),
        el(
          'procedimentosRealizados',
          ...g.itens.map((i) =>
            el(
              'procedimentoRealizado',
              el('sequencialItem', String(i.sequencial)),
              el('dataExecucao', i.data),
              procedimento('procedimento', i.procedimento),
              el('quantidadeExecutada', String(i.quantidade)),
              el('reducaoAcrescimo', '1.00'),
              el('valorUnitario', dinheiro(i.valorUnitario)),
              el('valorTotal', dinheiro(i.quantidade * i.valorUnitario)),
              ...i.equipe.map((m) =>
                el(
                  'profissionais',
                  el('grauParticipacao', m.grauParticipacao),
                  el('codProfissional', el('codigoPrestadorNaOperadora', m.codigoPrestador)),
                  el('nomeProfissional', m.nome),
                  el('conselhoProfissional', m.profissional.conselho),
                  el('numeroConselhoProfissional', m.profissional.numeroConselho),
                  el('UF', m.profissional.uf),
                  el('CBO', m.profissional.cbos),
                ),
              ),
            ),
          ),
        ),
        el('valorTotalHonorarios', dinheiro(soma(g.itens))),
        el('dataEmissaoGuia', g.dataEmissao),
      );
  }
}

function cabecalhoXml(cab: Cabecalho, tipoTransacao: string): Elemento {
  return el(
    'cabecalho',
    el(
      'identificacaoTransacao',
      el('tipoTransacao', tipoTransacao),
      el('sequencialTransacao', cab.sequencialTransacao),
      el('dataRegistroTransacao', cab.data),
      el('horaRegistroTransacao', cab.hora),
    ),
    el(
      'origem',
      el('identificacaoPrestador', el('codigoPrestadorNaOperadora', cab.codigoPrestadorNaOperadora)),
    ),
    el('destino', el('registroANS', cab.registroANS)),
    el('Padrao', PADRAO_TISS),
  );
}

/**
 * Hash do epílogo: MD5 (hexadecimal) do conteúdo de todos os campos da mensagem, sem as tags, concatenados
 * do cabeçalho ao fim do corpo, em ISO-8859-1 (Componente de Comunicação do Padrão TISS).
 */
export function hashEpilogo(cabecalho: Elemento, corpo: Elemento): string {
  return md5Hex(latin1([...textos(cabecalho), ...textos(corpo)].join('')));
}

export interface MensagemTiss {
  readonly versao: typeof VERSAO_TISS;
  readonly tipoTransacao: string;
  readonly xml: string;
  /** XML em ISO-8859-1 (o que vai ao validador e, em produção, à operadora). */
  readonly bytes: Uint8Array;
  readonly hash: string;
}

function montar(cab: Cabecalho, tipoTransacao: string, corpo: Elemento): MensagemTiss {
  const cabecalho = cabecalhoXml(cab, tipoTransacao);
  const hash = hashEpilogo(cabecalho, corpo);
  const raiz = el('mensagemTISS', cabecalho, corpo, el('epilogo', el('hash', hash)));
  const xml = serializar(raiz);
  return { versao: VERSAO_TISS, tipoTransacao, xml, bytes: latin1(xml), hash };
}

/** Lote de guias (ENVIO_LOTE_GUIAS); o XSD aceita um só tipo de guia por lote (1 a 100). */
export function mensagemLoteGuias(cab: Cabecalho, numeroLote: string, guias: readonly Guia[]): MensagemTiss {
  if (guias.length === 0 || guias.length > 100) throw new ErroLoteTiss('O lote tem de 1 a 100 guias.');
  if (new Set(guias.map((g) => g.tipo)).size > 1) throw new ErroLoteTiss('Um lote leva um só tipo de guia.');
  const corpo = el(
    'prestadorParaOperadora',
    el('loteGuias', el('numeroLote', numeroLote), el('guiasTISS', ...guias.map((g) => guiaXml(g, cab)))),
  );
  return montar(cab, 'ENVIO_LOTE_GUIAS', corpo);
}

/** Recurso de glosa por guia completa (RECURSO_GLOSA), também só em 04.03.00 (DP-47.7). */
export function mensagemRecursoGlosa(cab: Cabecalho, r: RecursoGlosa): MensagemTiss {
  if (r.guias.length === 0 || r.guias.length > 100) throw new ErroLoteTiss('O recurso tem de 1 a 100 guias.');
  const total = r.guias.reduce((s, g) => s + Math.round(g.valorRecursado * 100), 0) / 100;
  const corpo = el(
    'prestadorParaOperadora',
    el(
      'recursoGlosa',
      el(
        'guiaRecursoGlosa',
        el('registroANS', cab.registroANS),
        el('numeroGuiaRecGlosaPrestador', r.numeroGuiaRecurso),
        el('nomeOperadora', r.nomeOperadora),
        el('objetoRecurso', '2'),
        el('dadosContratado', el('codigoPrestadorNaOperadora', cab.codigoPrestadorNaOperadora)),
        el('numeroLote', r.numeroLote),
        el('numeroProtocolo', r.numeroProtocolo),
        el(
          'opcaoRecurso',
          ...r.guias.map((g) =>
            el(
              'recursoGuia',
              el('numeroGuiaOrigem', g.numeroGuiaOrigem),
              el(
                'opcaoRecursoGuia',
                el(
                  'recursoGuiaCompleta',
                  el('codGlosaGuia', g.codigoGlosa),
                  el('justificativaGuia', g.justificativa),
                ),
              ),
            ),
          ),
        ),
        el('valorTotalRecursado', dinheiro(total)),
        el('dataRecurso', r.data),
      ),
    ),
  );
  return montar(cab, 'RECURSO_GLOSA', corpo);
}

/** Recalcula o hash a partir do XML serializado e compara com o do epílogo. */
export function conferirHashEpilogo(xml: string): {
  readonly confere: boolean;
  readonly informado: string | null;
  readonly calculado: string;
} {
  const posEpilogo = xml.indexOf('<ans:epilogo>');
  const informado = /<ans:hash>([^<]*)<\/ans:hash>/.exec(xml)?.[1] ?? null;
  const corpo = posEpilogo >= 0 ? xml.slice(0, posEpilogo) : xml;
  const semDeclaracao = corpo.replace(/^<\?xml[^>]*\?>/, '');
  const valores = [...semDeclaracao.matchAll(/>([^<]+)</g)].map((m) => desescapar(m[1]!));
  let calculado: string;
  try {
    calculado = md5Hex(latin1(valores.join('')));
  } catch (e) {
    if (e instanceof ErroXmlTiss) return { confere: false, informado, calculado: '' };
    throw e;
  }
  return { confere: informado !== null && informado.toLowerCase() === calculado, informado, calculado };
}

export { opcional };
