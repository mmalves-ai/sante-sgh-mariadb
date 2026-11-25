// Solicitação eletrônica de autorização prévia à operadora (F78.06-2, 06-FAT linhas 25 e 27). Regras puras: o que um
// pedido precisa ter por tipo (SP/SADT, internação, prorrogação, quimioterapia, radioterapia, OPME), o limite de OPME
// por procedimento, as transições da situação, a leitura da resposta da operadora por item (quantidade e valor
// autorizados, negativa com motivo) e a mensagem SOLICITACAO_PROCEDIMENTOS do padrão TISS 04.03.00 (guia de
// solicitação de SP/SADT e de internação, com o anexo de OPME), validável no XSD oficial. Sem banco e sem relógio.
// Melhoria: o pedido nasce da carteira do paciente (nada redigitado), é conferido na hora (carteira vencida, item
// repetido, quantidade fora do padrão, OPME sem registro, limite de OPME passado), a resposta por item calcula sozinha
// a situação do pedido (autorizado, parcial, negado) e o andamento consultado guarda cada tentativa.
import { dinheiro, hashEpilogo, type MensagemTiss, PADRAO_TISS, VERSAO_TISS } from './lote.js';
import { el, type Elemento, latin1, opcional, serializar } from './xml.js';

export const TIPOS_SOLICITACAO_AUTORIZACAO = [
  'sp_sadt',
  'internacao',
  'prorrogacao',
  'quimioterapia',
  'radioterapia',
  'opme',
] as const;
export type TipoSolicitacaoAutorizacao = (typeof TIPOS_SOLICITACAO_AUTORIZACAO)[number];

export const CANAIS_AUTORIZACAO = ['webservice', 'portal', 'telefone', 'email', 'presencial'] as const;
export type CanalAutorizacao = (typeof CANAIS_AUTORIZACAO)[number];

export type SituacaoSolicitacaoAutorizacao =
  | 'rascunho'
  /** Mensagem montada, validada no XSD e guardada, à espera da transmissão (nenhuma saiu do hospital ainda). */
  | 'pronta_envio'
  | 'enviada'
  | 'em_analise'
  | 'autorizada'
  | 'autorizada_parcial'
  | 'negada'
  | 'cancelada'
  | 'erro_envio';

export type SituacaoRespostaAutorizacao =
  'autorizado' | 'autorizado_parcial' | 'negado' | 'em_analise' | 'aguardando_documentacao' | 'cancelado';

/**
 * Tipos cuja mensagem eletrônica o hospital monta (guia de solicitação de SP/SADT, de internação e de prorrogação da
 * internação); quimioterapia e radioterapia, que pedem o anexo clínico oncológico, vão pelo portal com o canal registrado.
 */
export const TIPOS_COM_MENSAGEM: readonly TipoSolicitacaoAutorizacao[] = [
  'sp_sadt',
  'internacao',
  'prorrogacao',
];
/** Guias que levam ao menos um procedimento além da OPME (a prorrogação pode pedir só diárias). */
const TIPOS_COM_PROCEDIMENTO: readonly TipoSolicitacaoAutorizacao[] = ['sp_sadt', 'internacao'];
/** Tipos que complementam uma guia ou um atendimento já existentes. */
export const TIPOS_COMPLEMENTARES: readonly TipoSolicitacaoAutorizacao[] = [
  'prorrogacao',
  'quimioterapia',
  'radioterapia',
  'opme',
];

export interface Problema {
  readonly campo: string;
  readonly mensagem: string;
}

export interface ItemPedidoAutorizacao {
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorUnitario: number | null;
  readonly opme: boolean;
  readonly registroAnvisa: string | null;
  readonly fabricante: number | null;
  /** O item faturável do procedimento (base do limite de OPME); nulo quando não identificado. */
  readonly itemFaturavel?: number | null;
}

export interface PedidoAutorizacao {
  readonly tipo: TipoSolicitacaoAutorizacao;
  readonly canal: CanalAutorizacao;
  readonly carteira: string;
  /** AAAA-MM-DD ou nulo (carteira sem validade). */
  readonly validadeCarteira: string | null;
  /** AAAA-MM-DD no fuso do estabelecimento. */
  readonly hoje: string;
  /** Há guia principal ou atendimento a que o pedido se liga. */
  readonly ligado: boolean;
  readonly temSolicitante: boolean;
  readonly regimeInternacao: string | null;
  readonly diarias: number | null;
  readonly indicacaoClinica: string | null;
  readonly itens: readonly ItemPedidoAutorizacao[];
}

/** O que o pedido precisa ter antes de ser gravado (validação na hora). */
export function conferirPedidoAutorizacao(p: PedidoAutorizacao): Problema[] {
  const r: Problema[] = [];
  if (!p.carteira.trim())
    r.push({ campo: 'carteira', mensagem: 'A cobertura não tem o número da carteira.' });
  if (p.validadeCarteira !== null && p.validadeCarteira < p.hoje)
    r.push({ campo: 'carteira', mensagem: `A carteira venceu em ${p.validadeCarteira}.` });
  if (!p.temSolicitante)
    r.push({
      campo: 'solicitante',
      mensagem: 'Informe o profissional solicitante (do hospital ou externo).',
    });
  if (TIPOS_COMPLEMENTARES.includes(p.tipo) && !p.ligado)
    r.push({
      campo: 'principal',
      mensagem: 'Prorrogação, quimioterapia, radioterapia e OPME pedem a guia principal ou o atendimento.',
    });
  if (p.canal === 'webservice' && !TIPOS_COM_MENSAGEM.includes(p.tipo))
    r.push({
      campo: 'canal',
      mensagem: 'Este tipo vai pelo portal, telefone ou e-mail da operadora; registre o canal usado.',
    });
  if (p.tipo === 'internacao') {
    if (!p.regimeInternacao) r.push({ campo: 'regime', mensagem: 'A internação pede o regime.' });
    if (!p.diarias || p.diarias < 1 || p.diarias > 99)
      r.push({ campo: 'diarias', mensagem: 'As diárias solicitadas vão de 1 a 99.' });
    if (!p.indicacaoClinica?.trim())
      r.push({ campo: 'indicacaoClinica', mensagem: 'A internação pede a indicação clínica.' });
  }
  if (p.tipo === 'prorrogacao') {
    if (!p.diarias || p.diarias < 1 || p.diarias > 99)
      r.push({ campo: 'diarias', mensagem: 'A prorrogação pede as diárias adicionais (1 a 99).' });
    if (!p.indicacaoClinica?.trim())
      r.push({
        campo: 'indicacaoClinica',
        mensagem: 'A prorrogação pede a indicação clínica (o motivo de ficar mais).',
      });
  }
  if (p.itens.length === 0) r.push({ campo: 'itens', mensagem: 'O pedido precisa de ao menos um item.' });
  const vistos = new Set<string>();
  p.itens.forEach((i, n) => {
    const campo = `itens.${n}`;
    if (!/^\d{2}$/.test(i.codigoTabela))
      r.push({ campo, mensagem: `Item ${n + 1}: a tabela tem dois dígitos (terminologia da TISS).` });
    if (!i.codigoProcedimento.trim() || i.codigoProcedimento.length > 10)
      r.push({ campo, mensagem: `Item ${n + 1}: o código tem de 1 a 10 caracteres.` });
    if (!i.descricao.trim()) r.push({ campo, mensagem: `Item ${n + 1}: falta a descrição.` });
    if (!Number.isInteger(i.quantidade) || i.quantidade < 1 || i.quantidade > 999)
      r.push({ campo, mensagem: `Item ${n + 1}: a quantidade é inteira, de 1 a 999.` });
    if (i.valorUnitario !== null && !(i.valorUnitario >= 0))
      r.push({ campo, mensagem: `Item ${n + 1}: o valor não pode ser negativo.` });
    if (i.opme && !i.registroAnvisa?.trim() && i.fabricante === null)
      r.push({ campo, mensagem: `Item ${n + 1}: a OPME pede o registro na Anvisa ou o fabricante.` });
    const chave = `${i.codigoTabela}:${i.codigoProcedimento}:${i.registroAnvisa ?? ''}`;
    if (vistos.has(chave))
      r.push({ campo, mensagem: `Item ${n + 1}: código repetido; some a quantidade no mesmo item.` });
    vistos.add(chave);
  });
  if (p.tipo === 'opme' && p.itens.some((i) => !i.opme))
    r.push({ campo: 'itens', mensagem: 'O pedido de OPME só leva itens de OPME.' });
  // A guia de solicitação (SP/SADT e internação) leva ao menos um procedimento; a OPME vai no anexo dele.
  if (TIPOS_COM_PROCEDIMENTO.includes(p.tipo) && p.itens.length > 0 && !p.itens.some((i) => !i.opme))
    r.push({
      campo: 'itens',
      mensagem: 'A guia leva ao menos um procedimento além da OPME (a OPME vai no anexo do procedimento).',
    });
  return r;
}

export interface LimiteOpme {
  readonly valorLimite: number | null;
  readonly quantidadeLimite: number | null;
}

/**
 * O procedimento a que a OPME se refere precisa estar identificado (item faturável) para o limite ser conferido: os
 * procedimentos do próprio pedido ou, no pedido só de OPME, os da guia principal. Sem isso o pedido é recusado, em vez
 * de seguir sem conferência.
 */
export function conferirProcedimentoDaOpme(
  itens: readonly ItemPedidoAutorizacao[],
  procedimentosDaPrincipal: number,
): Problema[] {
  if (!itens.some((i) => i.opme)) return [];
  const proc = itens.filter((i) => !i.opme);
  if (proc.length ? proc.some((i) => !i.itemFaturavel) : procedimentosDaPrincipal === 0)
    return [
      {
        campo: 'itens',
        mensagem: proc.length
          ? 'Com OPME, cada procedimento do pedido indica o item faturável (base do limite de OPME).'
          : 'O pedido de OPME pede a guia principal com o procedimento identificado (base do limite de OPME).',
      },
    ];
  return [];
}

/** Os itens de OPME do pedido contra os limites vigentes do procedimento na fonte pagadora (o menor vale). */
export function conferirLimiteOpme(
  itens: readonly ItemPedidoAutorizacao[],
  limites: readonly LimiteOpme[],
): Problema[] {
  const opme = itens.filter((i) => i.opme);
  if (!opme.length || !limites.length) return [];
  const r: Problema[] = [];
  const valores = limites.map((l) => l.valorLimite).filter((v): v is number => v !== null);
  const quantidades = limites.map((l) => l.quantidadeLimite).filter((v): v is number => v !== null);
  // Com limite de valor, a OPME sem valor não entra como zero: o valor é pedido.
  if (valores.length)
    opme.forEach((i) => {
      if (i.valorUnitario === null)
        r.push({
          campo: 'itens',
          mensagem: `Informe o valor da OPME ${i.codigoProcedimento}: o procedimento tem limite de valor nesta fonte pagadora.`,
        });
    });
  const total = opme.reduce((s, i) => s + Math.round((i.valorUnitario ?? 0) * 100) * i.quantidade, 0) / 100;
  const qtd = opme.reduce((s, i) => s + i.quantidade, 0);
  if (valores.length && total > Math.min(...valores))
    r.push({
      campo: 'itens',
      mensagem: `A OPME soma ${dinheiro(total)}, acima do limite de ${dinheiro(Math.min(...valores))} do procedimento nesta fonte pagadora.`,
    });
  if (quantidades.length && qtd > Math.min(...quantidades))
    r.push({
      campo: 'itens',
      mensagem: `A OPME soma ${qtd} unidades, acima do limite de ${Math.min(...quantidades)} do procedimento.`,
    });
  return r;
}

const TRANSICOES: Readonly<
  Record<SituacaoSolicitacaoAutorizacao, readonly SituacaoSolicitacaoAutorizacao[]>
> = {
  rascunho: ['pronta_envio', 'enviada', 'cancelada', 'erro_envio'],
  pronta_envio: ['enviada', 'cancelada'],
  erro_envio: ['pronta_envio', 'enviada', 'cancelada'],
  enviada: ['em_analise', 'autorizada', 'autorizada_parcial', 'negada', 'cancelada'],
  em_analise: ['em_analise', 'autorizada', 'autorizada_parcial', 'negada', 'cancelada'],
  autorizada: ['cancelada'],
  autorizada_parcial: ['cancelada'],
  negada: [],
  cancelada: [],
};

export function podeMudar(de: SituacaoSolicitacaoAutorizacao, para: SituacaoSolicitacaoAutorizacao): boolean {
  return TRANSICOES[de].includes(para);
}

/** Situações em que o andamento ainda pode ser consultado na operadora. */
export const SITUACOES_EM_ANDAMENTO: readonly SituacaoSolicitacaoAutorizacao[] = ['enviada', 'em_analise'];

export interface ItemSolicitado {
  readonly sequencia: number;
  readonly quantidade: number;
}

export interface ItemRespondido {
  readonly sequencia: number;
  readonly quantidadeAutorizada: number;
  readonly valorAutorizado: number | null;
  readonly motivoNegativa: string | null;
  readonly motivoGlosa: number | null;
}

export interface RespostaRecebida {
  /** Só para resposta sem itens: em análise, aguardando documentação ou cancelada. */
  readonly situacao: SituacaoRespostaAutorizacao | null;
  readonly senha: string | null;
  readonly numeroGuiaOperadora: string | null;
  readonly dataAutorizacao: string | null;
  readonly senhaValidade: string | null;
  readonly itens: readonly ItemRespondido[];
}

export interface RespostaLida {
  readonly situacao: SituacaoRespostaAutorizacao;
  readonly solicitacao: SituacaoSolicitacaoAutorizacao;
  readonly itens: readonly (ItemRespondido & { situacao: SituacaoRespostaAutorizacao })[];
  readonly problemas: Problema[];
}

const DA_RESPOSTA: Readonly<Record<SituacaoRespostaAutorizacao, SituacaoSolicitacaoAutorizacao>> = {
  autorizado: 'autorizada',
  autorizado_parcial: 'autorizada_parcial',
  negado: 'negada',
  em_analise: 'em_analise',
  aguardando_documentacao: 'em_analise',
  cancelado: 'cancelada',
};

/**
 * Lê a resposta da operadora: cada item pedido recebe a quantidade autorizada (zero é negativa, com motivo), e a
 * situação do pedido sai dos itens (todos autorizados, todos negados ou parcial). Autorizada exige a senha ou o número
 * da guia na operadora; a validade da senha não fica antes da data da autorização.
 */
export function lerRespostaAutorizacao(
  pedidos: readonly ItemSolicitado[],
  r: RespostaRecebida,
): RespostaLida {
  const problemas: Problema[] = [];
  if (r.itens.length === 0) {
    const situacao = r.situacao ?? 'em_analise';
    if (['autorizado', 'autorizado_parcial', 'negado'].includes(situacao))
      problemas.push({ campo: 'itens', mensagem: 'A decisão da operadora vem por item: informe cada item.' });
    return { situacao, solicitacao: DA_RESPOSTA[situacao], itens: [], problemas };
  }
  const porSeq = new Map(pedidos.map((p) => [p.sequencia, p.quantidade]));
  const vistos = new Set<number>();
  const itens = r.itens.map((i, n) => {
    const pedida = porSeq.get(i.sequencia);
    const campo = `itens.${n}`;
    if (pedida === undefined)
      problemas.push({ campo, mensagem: `O item ${i.sequencia} não está no pedido.` });
    if (vistos.has(i.sequencia))
      problemas.push({ campo, mensagem: `O item ${i.sequencia} veio duas vezes.` });
    vistos.add(i.sequencia);
    if (!(i.quantidadeAutorizada >= 0) || (pedida !== undefined && i.quantidadeAutorizada > pedida))
      problemas.push({ campo, mensagem: `Item ${i.sequencia}: a quantidade autorizada vai de 0 ao pedido.` });
    if (i.valorAutorizado !== null && !(i.valorAutorizado >= 0))
      problemas.push({ campo, mensagem: `Item ${i.sequencia}: o valor autorizado não pode ser negativo.` });
    const situacao: SituacaoRespostaAutorizacao =
      i.quantidadeAutorizada === 0
        ? 'negado'
        : pedida !== undefined && i.quantidadeAutorizada < pedida
          ? 'autorizado_parcial'
          : 'autorizado';
    if (situacao === 'negado' && !i.motivoNegativa?.trim() && i.motivoGlosa === null)
      problemas.push({ campo, mensagem: `Item ${i.sequencia}: a negativa pede o motivo da operadora.` });
    return { ...i, situacao };
  });
  for (const p of pedidos)
    if (!vistos.has(p.sequencia))
      problemas.push({ campo: 'itens', mensagem: `Falta a resposta do item ${p.sequencia}.` });
  const situacao: SituacaoRespostaAutorizacao = itens.every((i) => i.situacao === 'autorizado')
    ? 'autorizado'
    : itens.every((i) => i.situacao === 'negado')
      ? 'negado'
      : 'autorizado_parcial';
  if (situacao !== 'negado' && !r.senha?.trim() && !r.numeroGuiaOperadora?.trim())
    problemas.push({
      campo: 'senha',
      mensagem: 'A autorização pede a senha ou o número da guia na operadora.',
    });
  if (r.senhaValidade && r.dataAutorizacao && r.senhaValidade < r.dataAutorizacao)
    problemas.push({
      campo: 'senhaValidade',
      mensagem: 'A validade da senha fica antes da data da autorização.',
    });
  return { situacao, solicitacao: DA_RESPOSTA[situacao], itens, problemas };
}

/** A próxima consulta do andamento: 30 minutos, dobrando a cada tentativa, até 24 horas. */
export function proximaConsultaAndamento(tentativa: number, agora: Date): Date {
  const minutos = Math.min(30 * 2 ** Math.max(0, tentativa - 1), 24 * 60);
  return new Date(agora.getTime() + minutos * 60_000);
}

// ── Mensagem TISS (prestador → operadora), só 04.03.00 ───────────────────────────────────────────

export interface SolicitanteMensagem {
  readonly nome: string;
  /** Código do conselho na terminologia da TISS (dois dígitos). */
  readonly conselho: string;
  readonly numeroConselho: string;
  /** Código IBGE da UF do conselho. */
  readonly uf: string;
  readonly cbo: string;
  readonly telefone: string | null;
}

export interface DadosMensagemSolicitacao {
  readonly tipo: TipoSolicitacaoAutorizacao;
  readonly sequencialTransacao: string;
  readonly data: string;
  readonly hora: string;
  readonly registroAns: string;
  readonly codigoPrestador: string;
  readonly nomeContratado: string;
  readonly cnes: string | null;
  readonly numeroGuia: string;
  readonly numeroGuiaPrincipal: string | null;
  readonly carteira: string;
  readonly recemNascido: boolean;
  readonly solicitante: SolicitanteMensagem;
  readonly urgencia: boolean;
  readonly indicacaoClinica: string | null;
  readonly regime: 'hospitalar' | 'hospital_dia' | 'domiciliar' | null;
  /** Tipo de internação da TISS (1 clínica, 2 cirúrgica, 3 obstétrica, 4 pediátrica, 5 psiquiátrica). */
  readonly tipoInternacao: string | null;
  readonly diarias: number | null;
  readonly dataAdmissao: string | null;
  readonly cids: readonly string[];
  readonly acidente: 'trabalho' | 'transito' | 'outros' | 'nao_acidente' | null;
  readonly observacao: string | null;
  readonly itens: readonly (ItemPedidoAutorizacao & { opcaoFabricante: number | null })[];
}

/** O que falta para montar a mensagem eletrônica (sem isso o pedido vai pelo portal). */
export function faltasParaMensagem(d: DadosMensagemSolicitacao): string[] {
  const f: string[] = [];
  if (!TIPOS_COM_MENSAGEM.includes(d.tipo)) f.push('tipo sem mensagem eletrônica (use o portal)');
  if (!/^\d{6}$/.test(d.registroAns)) f.push('registro da operadora na agência reguladora');
  if (!d.codigoPrestador.trim()) f.push('código do hospital na operadora');
  if (!d.solicitante.nome.trim()) f.push('nome do solicitante');
  if (!/^\d{2}$/.test(d.solicitante.conselho)) f.push('conselho do solicitante');
  if (!d.solicitante.numeroConselho.trim()) f.push('número no conselho do solicitante');
  if (!/^\d{2}$/.test(d.solicitante.uf)) f.push('UF do conselho do solicitante');
  if (!/^\d{6}$/.test(d.solicitante.cbo)) f.push('CBO do solicitante');
  if (d.tipo === 'internacao') {
    if (!d.tipoInternacao) f.push('tipo de internação');
    if (!d.dataAdmissao) f.push('data provável da admissão');
  }
  if (d.tipo === 'prorrogacao') {
    if (!d.numeroGuiaPrincipal?.trim()) f.push('número da guia da internação que se prorroga');
    if (!d.indicacaoClinica?.trim()) f.push('indicação clínica da prorrogação');
    if (!d.diarias && !d.itens.some((i) => !i.opme)) f.push('diárias adicionais ou procedimento adicional');
  } else if (!d.itens.some((i) => !i.opme)) f.push('ao menos um procedimento além da OPME');
  if (d.itens.some((i) => i.opme) && !d.solicitante.telefone)
    f.push('telefone do solicitante (anexo de OPME)');
  return f;
}

const corte = (t: string | null, n: number) => (t ? t.slice(0, n) : null);
const REGIME: Readonly<Record<string, string>> = { hospitalar: '1', hospital_dia: '2', domiciliar: '3' };
const ACIDENTE: Readonly<Record<string, string>> = {
  trabalho: '0',
  transito: '1',
  outros: '2',
  nao_acidente: '9',
};

function beneficiario(d: DadosMensagemSolicitacao): Elemento {
  return el(
    'dadosBeneficiario',
    el('numeroCarteira', d.carteira),
    el('atendimentoRN', d.recemNascido ? 'S' : 'N'),
  );
}

function profissional(s: SolicitanteMensagem): Elemento[] {
  return [
    el('nomeProfissional', s.nome.slice(0, 70)),
    el('conselhoProfissional', s.conselho),
    el('numeroConselhoProfissional', s.numeroConselho.slice(0, 15)),
    el('UF', s.uf),
    el('CBOS', s.cbo),
  ];
}

function procedimentos(d: DadosMensagemSolicitacao): Elemento[] {
  return d.itens
    .filter((i) => !i.opme)
    .map((i) =>
      el(
        'procedimentosSolicitados',
        el(
          'procedimento',
          el('codigoTabela', i.codigoTabela),
          el('codigoProcedimento', i.codigoProcedimento),
          el('descricaoProcedimento', i.descricao.slice(0, 150)),
        ),
        el('quantidadeSolicitada', String(i.quantidade)),
      ),
    );
}

function anexoOpme(d: DadosMensagemSolicitacao, nome = 'anexoClinico'): Elemento | null {
  const opme = d.itens.filter((i) => i.opme);
  if (!opme.length) return null;
  return el(
    nome,
    el(
      'solicitacaoOPME',
      el(
        'cabecalhoAnexo',
        el('registroANS', d.registroAns),
        el('numeroGuiaAnexo', `${d.numeroGuia}-O`.slice(0, 20)),
        el(
          'numeroGuiaReferenciada',
          d.tipo === 'prorrogacao' ? (d.numeroGuiaPrincipal ?? d.numeroGuia) : d.numeroGuia,
        ),
        el('dataSolicitacao', d.data),
      ),
      beneficiario(d),
      el(
        'profissionalSolicitante',
        el('nomeProfissional', d.solicitante.nome.slice(0, 70)),
        el('telefoneProfissional', (d.solicitante.telefone ?? '').replace(/\D/g, '').slice(0, 11)),
      ),
      el('justificativaTecnica', (d.indicacaoClinica ?? 'Conforme indicação clínica.').slice(0, 1000)),
      el(
        'opmeSolicitadas',
        ...opme.map((i) =>
          el(
            'opmeSolicitada',
            el(
              'identificacaoOPME',
              el('codigoTabela', i.codigoTabela),
              el('codigoProcedimento', i.codigoProcedimento),
              el('descricaoProcedimento', i.descricao.slice(0, 150)),
            ),
            el('opcaoFabricante', String(i.opcaoFabricante ?? 1)),
            el('quantidadeSolicitada', String(i.quantidade)),
            opcional(
              'valorSolicitado',
              i.valorUnitario === null ? null : dinheiro(i.valorUnitario * i.quantidade),
            ),
            opcional('registroANVISA', i.registroAnvisa),
          ),
        ),
      ),
    ),
  );
}

function guiaSpSadt(d: DadosMensagemSolicitacao): Elemento {
  return el(
    'solicitacaoSP-SADT',
    el('cabecalhoSolicitacao', el('registroANS', d.registroAns), el('numeroGuiaPrestador', d.numeroGuia)),
    opcional('numeroGuiaPrincipal', d.numeroGuiaPrincipal),
    el('tipoEtapaAutorizacao', '1'),
    beneficiario(d),
    el(
      'dadosSolicitante',
      el('contratadoSolicitante', el('codigoPrestadorNaOperadora', d.codigoPrestador)),
      el('nomeContratadoSolicitante', d.nomeContratado.slice(0, 70)),
      el('profissionalSolicitante', ...profissional(d.solicitante)),
    ),
    el('caraterAtendimento', d.urgencia ? '2' : '1'),
    el('dataSolicitacao', d.data),
    opcional('indicacaoClinica', corte(d.indicacaoClinica, 500)),
    ...procedimentos(d),
    el('dadosExecutante', el('codigonaOperadora', d.codigoPrestador), el('CNES', d.cnes || '9999999')),
    anexoOpme(d),
    opcional('observacao', corte(d.observacao, 500)),
  );
}

function guiaInternacao(d: DadosMensagemSolicitacao): Elemento {
  return el(
    'solicitacaoInternacao',
    el('registroANS', d.registroAns),
    el('numeroGuiaPrestador', d.numeroGuia),
    el('tipoEtapaAutorizacao', '1'),
    beneficiario(d),
    el(
      'identificacaoSolicitante',
      el('dadosDoContratado', el('codigoPrestadorNaOperadora', d.codigoPrestador)),
      el('dadosProfissionalContratado', ...profissional(d.solicitante)),
    ),
    el(
      'dadosHospitalSolicitado',
      el('codigoIndicadonaOperadora', d.codigoPrestador),
      el('nomeContratadoIndicado', d.nomeContratado.slice(0, 70)),
      el('dataSugeridaInternacao', d.dataAdmissao ?? d.data),
    ),
    el(
      'dadosInternacao',
      el('caraterAtendimento', d.urgencia ? '2' : '1'),
      el('tipoInternacao', d.tipoInternacao ?? '1'),
      el('regimeInternacao', REGIME[d.regime ?? 'hospitalar']!),
      el('qtDiariasSolicitadas', String(d.diarias ?? 1)),
      el('indicadorOPME', d.itens.some((i) => i.opme) ? 'S' : 'N'),
      el('indicadorQuimio', 'N'),
      el('indicacaoClinica', (d.indicacaoClinica ?? '').slice(0, 500)),
    ),
    el(
      'hipotesesDiagnosticas',
      ...d.cids.slice(0, 4).map((c) => el('diagnosticoCID', c.replace(/\W/g, '').slice(0, 4))),
      el('indicadorAcidente', ACIDENTE[d.acidente ?? 'nao_acidente']!),
    ),
    ...procedimentos(d),
    el('dataSolicitacao', d.data),
    opcional('observacao', corte(d.observacao, 1000)),
    anexoOpme(d),
  );
}

/** Guia de solicitação de prorrogação da internação: diárias adicionais, procedimentos adicionais e o anexo de OPME. */
function guiaProrrogacao(d: DadosMensagemSolicitacao): Elemento {
  return el(
    'solicitacaoProrrogacao',
    el('registroANS', d.registroAns),
    el('numeroGuiaPrestador', d.numeroGuia),
    el('nrGuiaReferenciada', (d.numeroGuiaPrincipal ?? '').slice(0, 20)),
    el('dadosBeneficiario', el('numeroCarteira', d.carteira)),
    el('dadosContratadoSolicitante', el('codigoPrestadorNaOperadora', d.codigoPrestador)),
    el('nomeContratadoSolicitante', d.nomeContratado.slice(0, 70)),
    el('dadosProfissionalSolicitante', ...profissional(d.solicitante)),
    el(
      'dadosInternacao',
      opcional('qtDiariasAdicionais', d.diarias ? String(d.diarias) : null),
      el('indicacaoClinica', (d.indicacaoClinica ?? '').slice(0, 500)),
    ),
    ...d.itens
      .filter((i) => !i.opme)
      .map((i) =>
        el(
          'procedimentosAdicionais',
          el(
            'procedimento',
            el('codigoTabela', i.codigoTabela),
            el('codigoProcedimento', i.codigoProcedimento),
            el('descricaoProcedimento', i.descricao.slice(0, 150)),
          ),
          el('quantidadeSolicitada', String(i.quantidade)),
        ),
      ),
    anexoOpme(d, 'anexoClinicoProrrogacao'),
    opcional('observacao', corte(d.observacao, 500)),
    el('dataSolicitacao', d.data),
  );
}

/** A mensagem SOLICITACAO_PROCEDIMENTOS com o hash do epílogo; recusa o pedido com faltas. */
export function mensagemSolicitacaoAutorizacao(d: DadosMensagemSolicitacao): MensagemTiss {
  const faltas = faltasParaMensagem(d);
  if (faltas.length) throw new Error(`Faltam dados para a mensagem: ${faltas.join(', ')}.`);
  const cabecalho = el(
    'cabecalho',
    el(
      'identificacaoTransacao',
      el('tipoTransacao', 'SOLICITACAO_PROCEDIMENTOS'),
      el('sequencialTransacao', d.sequencialTransacao),
      el('dataRegistroTransacao', d.data),
      el('horaRegistroTransacao', d.hora),
    ),
    el('origem', el('identificacaoPrestador', el('codigoPrestadorNaOperadora', d.codigoPrestador))),
    el('destino', el('registroANS', d.registroAns)),
    el('Padrao', PADRAO_TISS),
  );
  const corpo = el(
    'prestadorParaOperadora',
    el(
      'solicitacaoProcedimento',
      d.tipo === 'internacao'
        ? guiaInternacao(d)
        : d.tipo === 'prorrogacao'
          ? guiaProrrogacao(d)
          : guiaSpSadt(d),
    ),
  );
  const hash = hashEpilogo(cabecalho, corpo);
  const xml = serializar(el('mensagemTISS', cabecalho, corpo, el('epilogo', el('hash', hash))));
  return { versao: VERSAO_TISS, tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS', xml, bytes: latin1(xml), hash };
}

// ── Hipóteses diagnósticas do pedido ──────────────────────────────────────────────────────────────

export interface DiagnosticoPedido {
  /** Código da CID-10, com ou sem ponto (A00, A00.0 ou A000). */
  readonly cid: string;
  readonly tipoDoenca: 'aguda' | 'cronica' | null;
  readonly tempo: number | null;
  readonly unidadeTempo: 'dia' | 'mes' | 'ano' | null;
}

/** O código da CID-10 sem ponto e em maiúsculas (como no catálogo oficial), ou nulo se não tem a forma da CID-10. */
export function normalizarCid(cid: string): string | null {
  const c = cid.trim().toUpperCase().replace('.', '');
  return /^[A-Z]\d{2}[0-9X]?$/.test(c) ? c : null;
}

/**
 * As hipóteses diagnósticas do pedido: até quatro (o que a guia de internação comporta), a primeira é a principal,
 * CID-10 válido e sem repetição, tempo de doença com a unidade. A internação pede ao menos uma (a guia não sai sem CID).
 */
export function conferirDiagnosticosAutorizacao(
  tipo: TipoSolicitacaoAutorizacao,
  diagnosticos: readonly DiagnosticoPedido[],
): Problema[] {
  const r: Problema[] = [];
  if (tipo === 'internacao' && diagnosticos.length === 0)
    r.push({
      campo: 'diagnosticos',
      mensagem: 'A internação pede ao menos a hipótese diagnóstica principal (CID-10).',
    });
  if (diagnosticos.length > 4)
    r.push({ campo: 'diagnosticos', mensagem: 'A guia comporta até quatro hipóteses diagnósticas.' });
  const vistos = new Set<string>();
  diagnosticos.forEach((d, n) => {
    const campo = `diagnosticos.${n}`;
    const cid = normalizarCid(d.cid);
    if (!cid)
      r.push({ campo, mensagem: `Diagnóstico ${n + 1}: o código não tem a forma da CID-10 (A00 ou A00.0).` });
    else if (vistos.has(cid)) r.push({ campo, mensagem: `Diagnóstico ${n + 1}: CID repetido.` });
    if (cid) vistos.add(cid);
    if ((d.tempo === null) !== (d.unidadeTempo === null))
      r.push({
        campo,
        mensagem: `Diagnóstico ${n + 1}: o tempo de doença vai com a unidade (dias, meses ou anos).`,
      });
    if (d.tempo !== null && (!Number.isInteger(d.tempo) || d.tempo < 1 || d.tempo > 999))
      r.push({ campo, mensagem: `Diagnóstico ${n + 1}: o tempo de doença é inteiro, de 1 a 999.` });
  });
  return r;
}

// ── Ligação da autorização aos itens da conta ─────────────────────────────────────────────────────

export interface ItemAutorizadoParaConta {
  readonly respostaItem: number;
  /** Sequência do item na guia (vai à conta como sequencial do item da guia TISS). */
  readonly sequencia: number;
  readonly itemFaturavel: number | null;
  readonly quantidadeAutorizada: number;
  /** Quanto desta autorização já cobre itens da conta. */
  readonly jaCoberta: number;
}

export interface ItemDaContaParaAutorizacao {
  readonly contaItem: number;
  readonly itemFaturavel: number;
  readonly quantidade: number;
  /** Quanto deste item da conta já está coberto por autorização. */
  readonly jaCoberta: number;
}

export interface LigacaoItemConta {
  readonly contaItem: number;
  readonly respostaItem: number;
  readonly sequencia: number;
  readonly quantidadeCoberta: number;
}

/**
 * Casa cada item autorizado com os itens lançados na conta do mesmo item faturável, na ordem do lançamento, até a
 * quantidade autorizada: o item da conta fica com a autorização que o cobre e o sequencial dele na guia. O que já está
 * coberto não é coberto de novo (refazer não duplica); o item da conta sem autorização sobra para a auditoria.
 */
export function casarAutorizacaoComConta(
  autorizados: readonly ItemAutorizadoParaConta[],
  conta: readonly ItemDaContaParaAutorizacao[],
): { ligacoes: LigacaoItemConta[]; semCobertura: number[] } {
  const livre = new Map(conta.map((c) => [c.contaItem, Math.max(0, c.quantidade - c.jaCoberta)]));
  const ligacoes: LigacaoItemConta[] = [];
  for (const a of autorizados) {
    if (a.itemFaturavel === null) continue;
    let resta = Math.max(0, a.quantidadeAutorizada - a.jaCoberta);
    for (const c of conta) {
      if (resta <= 0) break;
      if (c.itemFaturavel !== a.itemFaturavel) continue;
      const q = Math.min(resta, livre.get(c.contaItem) ?? 0);
      if (q <= 0) continue;
      ligacoes.push({
        contaItem: c.contaItem,
        respostaItem: a.respostaItem,
        sequencia: a.sequencia,
        quantidadeCoberta: q,
      });
      livre.set(c.contaItem, (livre.get(c.contaItem) ?? 0) - q);
      resta -= q;
    }
  }
  const semCobertura = conta.filter((c) => (livre.get(c.contaItem) ?? 0) > 0).map((c) => c.contaItem);
  return { ligacoes, semCobertura };
}
