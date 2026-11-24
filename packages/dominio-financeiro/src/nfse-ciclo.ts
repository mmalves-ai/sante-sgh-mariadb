// F3.8, 07-FIN linha 113: o ciclo da NFS-e depois da emissão simples (nfse.ts). Deduções da base de cálculo com o
// documento que as comprova; lote de várias faturas num envio só (a tela emite uma ou muitas do mesmo jeito);
// cancelamento e substituição da nota emitida com motivo do catálogo do cliente, justificativa e o prazo do município. Nada é
// apagado: a nota fica no banco com a situação "cancelada" ou "substituida" (nota_servico) e cada passo vira um evento
// (evento_nota_servico). A substituição encerra a original e emite a nova para a mesma fatura (o mesmo tomador), ligadas.
import { centavos, recusaFin, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import { ALIQUOTA_CBS_2026, ALIQUOTA_IBS_2026, conferirNfse, type PedidoNfse } from './nfse.js';

/** Os tipos da dedução como o modelo os guarda (deducao_nota_servico). */
export const TIPOS_DEDUCAO_NFSE = [
  'material',
  'subempreitada',
  'filme',
  'honorario',
  'operacional',
  'outra',
] as const;
export type TipoDeducaoNfse = (typeof TIPOS_DEDUCAO_NFSE)[number];

export interface DeducaoNfse {
  readonly tipo: TipoDeducaoNfse;
  readonly descricao: string;
  /** O documento que comprova a dedução (nota do fornecedor, contrato): obrigatório, salvo na "outra" com descrição. */
  readonly documento: string | null;
  readonly valor: number;
}

export interface PedidoNfseCompleto extends PedidoNfse {
  readonly tituloReceber: number | null;
  readonly conta: number | null;
  readonly itemServico: string;
  readonly deducoes: readonly DeducaoNfse[];
}

export interface NfseComDeducoes {
  readonly valorServicos: number;
  readonly valorDeducoes: number;
  readonly baseCalculo: number;
  readonly valorIss: number;
  readonly issRetido: boolean;
  readonly valorCbs: number;
  readonly valorIbs: number;
  readonly retencoesFederais: number;
  /** Serviços − ISS retido − retenções federais (as deduções reduzem a base, não o valor cobrado). */
  readonly valorLiquido: number;
}

export function conferirDeducoes(
  valorServicos: number,
  deducoes: readonly DeducaoNfse[],
): RecusaFinanceiro | null {
  for (const [i, d] of deducoes.entries()) {
    if (!(d.valor > 0))
      return recusaFin('deducao-valor', `A dedução ${i + 1} precisa de valor maior que zero.`, [
        `deducoes.${i}.valor`,
      ]);
    if (!d.descricao.trim())
      return recusaFin('deducao-descricao', `Descreva a dedução ${i + 1}.`, [`deducoes.${i}.descricao`]);
    if (d.tipo !== 'outra' && !d.documento?.trim())
      return recusaFin(
        'deducao-documento',
        `A dedução ${i + 1} precisa do documento que a comprova (nota do fornecedor ou contrato).`,
        [`deducoes.${i}.documento`],
      );
  }
  const total = centavos(deducoes.reduce((s, d) => s + d.valor, 0));
  if (total >= valorServicos)
    return recusaFin('deducoes-acima', 'As deduções não podem chegar ao valor dos serviços.', ['deducoes']);
  return null;
}

export function calcularNfseComDeducoes(
  p: PedidoNfse & { deducoes: readonly DeducaoNfse[] },
): NfseComDeducoes {
  const servicos = centavos(p.valorServicos);
  const deducoes = centavos(p.deducoes.reduce((s, d) => s + d.valor, 0));
  const base = centavos(servicos - deducoes);
  const iss = centavos((base * p.aliquotaIss) / 100);
  const fed = centavos(
    p.retencoes.ir + p.retencoes.pis + p.retencoes.cofins + p.retencoes.csll + p.retencoes.inss,
  );
  return {
    valorServicos: servicos,
    valorDeducoes: deducoes,
    baseCalculo: base,
    valorIss: iss,
    issRetido: p.issRetido,
    valorCbs: centavos(base * ALIQUOTA_CBS_2026),
    valorIbs: centavos(base * ALIQUOTA_IBS_2026),
    retencoesFederais: fed,
    valorLiquido: centavos(servicos - (p.issRetido ? iss : 0) - fed),
  };
}

export const LIMITE_LOTE_NFSE = 50;

/** A fatura (ou a conta) a que a nota serve. */
export interface AlvoNfse {
  readonly tituloReceber: number | null;
  readonly conta: number | null;
}

const chaveAlvo = (a: AlvoNfse) => (a.tituloReceber !== null ? `t${a.tituloReceber}` : `c${a.conta}`);

/**
 * O lote (1 a 50 notas): cada nota conferida, com o índice no campo; nenhuma fatura repetida no mesmo envio nem com
 * nota já ativa (autorizada ou enviada à prefeitura): a nota ativa muda pela substituição, não por outra emissão.
 */
export function conferirLoteNfse(
  notas: readonly PedidoNfseCompleto[],
  comNotaAtiva: readonly AlvoNfse[],
): RecusaFinanceiro | null {
  if (notas.length === 0) return recusaFin('lote-vazio', 'Escolha ao menos uma fatura.', ['notas']);
  if (notas.length > LIMITE_LOTE_NFSE)
    return recusaFin('lote-grande', `O lote leva até ${LIMITE_LOTE_NFSE} notas.`, ['notas']);
  const ativas = new Set(comNotaAtiva.map(chaveAlvo));
  const vistos = new Set<string>();
  for (const [i, n] of notas.entries()) {
    const campo = (c: string) => `notas.${i}.${c}`;
    if (n.tituloReceber === null && n.conta === null)
      return recusaFin('tomador-obrigatorio', `Nota ${i + 1}: informe a fatura ou a conta.`, [
        campo('tituloReceber'),
      ]);
    const chave = chaveAlvo(n);
    if (ativas.has(chave))
      return recusaFin(
        'fatura-com-nota',
        `Nota ${i + 1}: a fatura já tem nota emitida; para corrigi-la, substitua a nota.`,
        [campo('tituloReceber')],
      );
    if (vistos.has(chave))
      return recusaFin('fatura-repetida', `Nota ${i + 1}: a mesma fatura já está no lote.`, [
        campo('tituloReceber'),
      ]);
    vistos.add(chave);
    if (!n.itemServico.trim())
      return recusaFin('item-obrigatorio', `Nota ${i + 1}: informe o item da lista de serviços.`, [
        campo('itemServico'),
      ]);
    const r = conferirNfse(n) ?? conferirDeducoes(n.valorServicos, n.deducoes);
    if (r) return { ...r, mensagem: `Nota ${i + 1}: ${r.mensagem}`, campos: (r.campos ?? []).map(campo) };
  }
  return null;
}

/** O motivo como está no catálogo do cliente (motivo_cancelamento_documento_fiscal), a única fonte dos motivos. */
export interface MotivoCatalogoNfse {
  readonly id: number;
  readonly codigo: string;
  readonly ativo: boolean;
  readonly aplicaNotaServico: boolean;
}

function conferirMotivo(m: MotivoCatalogoNfse | null, oQue: string): RecusaFinanceiro | null {
  return m && m.ativo && m.aplicaNotaServico
    ? null
    : recusaFin('motivo-invalido', `Escolha um motivo ativo do catálogo para ${oQue}.`, ['motivo']);
}

/** O prazo usado enquanto a regra do município do estabelecimento não está cadastrada. */
export const PRAZO_NFSE_PADRAO_DIAS = 30;

export interface NotaEmitida {
  readonly situacao: string;
  /** Dia da emissão, AAAA-MM-DD. */
  readonly emitidaEm: string;
  readonly tituloReceber: number | null;
  readonly conta: number | null;
}

const dias = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

function conferirAlteravel(
  n: NotaEmitida,
  oQue: 'cancelar' | 'substituir',
  justificativa: string,
  hoje: string,
  prazoDias: number,
): RecusaFinanceiro | null {
  if (n.situacao !== 'autorizada')
    return recusaFin(
      'nota-nao-alteravel',
      `Só a nota emitida e ativa pode ${oQue === 'cancelar' ? 'ser cancelada' : 'ser substituída'}.`,
    );
  if (justificativa.trim().length < 15)
    return recusaFin('justificativa-curta', 'Escreva a justificativa com ao menos 15 letras.', [
      'justificativa',
    ]);
  const passados = dias(n.emitidaEm, hoje);
  if (passados > prazoDias)
    return recusaFin(
      `prazo-${oQue === 'cancelar' ? 'cancelamento' : 'substituicao'}-vencido`,
      `A nota foi emitida há ${passados} dias e o prazo do município é de ${prazoDias}: ${
        oQue === 'cancelar'
          ? 'substitua a nota ou peça o cancelamento à prefeitura'
          : 'peça a análise à prefeitura'
      }.`,
    );
  return null;
}

export function conferirCancelamentoNfse(
  n: NotaEmitida,
  motivo: MotivoCatalogoNfse | null,
  justificativa: string,
  hoje: string,
  prazoDias: number,
): RecusaFinanceiro | null {
  const m = conferirMotivo(motivo, 'o cancelamento');
  if (m) return m;
  return conferirAlteravel(n, 'cancelar', justificativa, hoje, prazoDias);
}

/** A substituição: a nova nota é da mesma fatura (o tomador não muda; para outro tomador, cancele e emita). */
export function conferirSubstituicaoNfse(
  n: NotaEmitida,
  motivo: MotivoCatalogoNfse | null,
  justificativa: string,
  hoje: string,
  prazoDias: number,
  nova: PedidoNfseCompleto,
): RecusaFinanceiro | null {
  const m = conferirMotivo(motivo, 'a substituição');
  if (m) return m;
  const r = conferirAlteravel(n, 'substituir', justificativa, hoje, prazoDias);
  if (r) return r;
  if (nova.tituloReceber !== n.tituloReceber || nova.conta !== n.conta)
    return recusaFin(
      'tomador-diferente',
      'A nota substituta é da mesma fatura; para outro tomador, cancele e emita outra.',
      ['tituloReceber'],
    );
  // A única nota ativa da fatura é a que está sendo substituída.
  return conferirLoteNfse([nova], []);
}

export function conferirParametroNfse(p: {
  municipioIbge: string;
  prazoCancelamentoDias: number;
  prazoSubstituicaoDias: number;
}): RecusaFinanceiro | null {
  if (!/^\d{7}$/.test(p.municipioIbge))
    return recusaFin('municipio-invalido', 'O código do município tem 7 dígitos (IBGE).', ['municipioIbge']);
  for (const c of ['prazoCancelamentoDias', 'prazoSubstituicaoDias'] as const)
    if (!Number.isInteger(p[c]) || p[c] < 0 || p[c] > 3650)
      return recusaFin('prazo-invalido', 'O prazo vai de 0 a 3.650 dias.', [c]);
  return null;
}

/** O XML da nota com deduções (leiaute nacional simplificado, como em nfse.ts). */
export function xmlNfseCompleta(
  d: NfseComDeducoes & { numeroRps: string; tomador: string; itemServico: string; substitui: string | null },
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFSe versao="1.00">',
    `<infNFSe><rps>${esc(d.numeroRps)}</rps><tomador>${esc(d.tomador)}</tomador><itemServico>${esc(d.itemServico)}</itemServico>`,
    d.substitui ? `<subst><chSubstda>${esc(d.substitui)}</chSubstda></subst>` : '',
    `<valores><vServ>${d.valorServicos.toFixed(2)}</vServ><vDR>${d.valorDeducoes.toFixed(2)}</vDR><vBC>${d.baseCalculo.toFixed(2)}</vBC>`,
    `<vISS>${d.valorIss.toFixed(2)}</vISS><issRetido>${d.issRetido ? 1 : 2}</issRetido>`,
    `<vCBS>${d.valorCbs.toFixed(2)}</vCBS><vIBS>${d.valorIbs.toFixed(2)}</vIBS><vRetFed>${d.retencoesFederais.toFixed(2)}</vRetFed><vLiq>${d.valorLiquido.toFixed(2)}</vLiq></valores>`,
    '</infNFSe></NFSe>',
  ].join('');
}
