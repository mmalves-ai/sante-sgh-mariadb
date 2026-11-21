// Regras puras da conta do paciente (M30) sobre o modelo próprio (conta_hospitalar.situacao), sem banco: a situação
// na tela, o que a conta aceita (lançamento, fechamento, reabertura, conferência e etapas) e a tradução do item para
// o grupo da tela. A porta própria e os testes usam as mesmas funções. Pedido do lote 02-08: levar estas regras para
// o @sgh/dominio-faturamento quando o contrato das telas trocar as marcas de texto pela situação do modelo.
// Melhoria: a situação é a coluna do modelo (aberta, em_conferencia, em_auditoria, fechada, faturada, enviada, paga,
// cancelada), com CHECK no banco, e não uma marca de texto com emissão à parte; o fechamento confere itens,
// pendências que bloqueiam e auditoria que bloqueia; a reabertura recusa a conta em lote ou já enviada.
// Melhoria: a competência fechada da fonte pagadora barra fechar e lançar; o efeito da pendência vem do tipo
// (tipo_pendencia_conta.controle), a tela só endurece; a conta particular é a da fonte de tipo 'particular', sem
// código fixo de convênio; a forma de pagamento da tela e a espécie do caixa se traduzem por lista branca.
import type { FormaPagamento, SituacaoDerivada } from '@sgh/dominio-faturamento';
import { conferirCompetenciaAberta, type RecusaFaturamento, recusaFat } from '@sgh/dominio-faturamento';

export const SITUACOES_CONTA = [
  'aberta',
  'em_conferencia',
  'em_auditoria',
  'fechada',
  'faturada',
  'enviada',
  'paga',
  'cancelada',
] as const;
export type SituacaoConta = (typeof SITUACOES_CONTA)[number];

/** Situações em que a conta ainda está em produção (aceita lançamento e conferência). */
export const SITUACOES_ABERTAS: readonly SituacaoConta[] = ['aberta', 'em_conferencia', 'em_auditoria'];

export function ehSituacaoConta(s: string): s is SituacaoConta {
  return (SITUACOES_CONTA as readonly string[]).includes(s);
}

/** A situação na tela: a do modelo, com "em lote" quando a conta fechada já entrou num lote TISS. */
export function situacaoNaTela(situacao: string, emLote: boolean): SituacaoDerivada {
  switch (situacao) {
    case 'aberta':
      return 'aberta';
    case 'em_conferencia':
      return 'em-conferencia';
    case 'em_auditoria':
      return 'em-auditoria';
    case 'fechada':
      return emLote ? 'em-lote' : 'fechada';
    case 'faturada':
      return 'em-lote';
    case 'enviada':
      return 'apresentada';
    case 'paga':
      return 'com-retorno';
    default:
      return 'erro-de-dado';
  }
}

/** A situação passada depois do envio só a operadora move (retorno): a tela a mostra como informada pelo retorno. */
export function situacaoInferida(situacao: string): boolean {
  return situacao === 'paga';
}

/**
 * A marca de fechamento que o contrato da tela ainda pede (N: em produção, S: fechada, A: apresentada, C: cancelada).
 * Pedido de contrato do lote 02-08: trocar pela situação.
 */
export function marcaDeFechamento(situacao: string): 'N' | 'S' | 'A' | 'C' {
  if ((SITUACOES_ABERTAS as readonly string[]).includes(situacao)) return 'N';
  if (situacao === 'fechada' || situacao === 'faturada') return 'S';
  if (situacao === 'cancelada') return 'C';
  return 'A';
}

/** Condição da lista de contas por situação da tela: situações do modelo e se exige (true) ou recusa (false) lote. */
export function filtroDaSituacao(
  s: SituacaoDerivada,
): { readonly situacoes: readonly SituacaoConta[]; readonly emLote: boolean | null } | null {
  switch (s) {
    case 'aberta':
      return { situacoes: ['aberta'], emLote: null };
    case 'em-conferencia':
      return { situacoes: ['em_conferencia'], emLote: null };
    case 'em-auditoria':
      return { situacoes: ['em_auditoria'], emLote: null };
    case 'fechada':
      return { situacoes: ['fechada'], emLote: false };
    case 'em-lote':
      return { situacoes: ['fechada', 'faturada'], emLote: true };
    case 'apresentada':
      return { situacoes: ['enviada'], emLote: null };
    case 'com-retorno':
      return { situacoes: ['paga'], emLote: null };
    default:
      // "Emitida" não existe no modelo próprio (a conta aberta vai direto ao fechamento); "erro de dado" o CHECK
      // da situação impede.
      return null;
  }
}

/** E: externa (ambulatório, pronto atendimento, externo, domiciliar); I: internação. */
export function tipoContaDaNatureza(natureza: string): 'E' | 'I' {
  return natureza === 'internacao' ? 'I' : 'E';
}

export function naturezasDoTipoConta(t: 'E' | 'I'): readonly string[] {
  return t === 'I' ? ['internacao'] : ['ambulatorial', 'pronto_atendimento', 'externo', 'domiciliar'];
}

/** O grupo da tela (1 diárias e taxas, 2 honorários, 3 SADT, 4 materiais e medicamentos) pelo tipo do item faturável. */
export function tipoDaTela(tipoItem: string): 1 | 2 | 3 | 4 {
  switch (tipoItem) {
    case 'honorario':
      return 2;
    case 'procedimento':
    case 'servico':
      return 3;
    case 'material':
    case 'medicamento':
    case 'opme':
      return 4;
    default:
      return 1;
  }
}

/** Os tipos de item faturável de cada grupo da tela. */
export function tiposDoGrupo(tipo: 1 | 2 | 3 | 4): readonly string[] {
  switch (tipo) {
    case 2:
      return ['honorario'];
    case 3:
      return ['procedimento', 'servico'];
    case 4:
      return ['material', 'medicamento', 'opme'];
    default:
      return ['taxa', 'diaria', 'gas', 'pacote'];
  }
}

export function contaAceitaLancamento(situacao: string): boolean {
  return (SITUACOES_ABERTAS as readonly string[]).includes(situacao);
}

export function conferirLancamento(situacao: string): RecusaFaturamento | null {
  if (contaAceitaLancamento(situacao)) return null;
  return recusaFat(
    'conta-fechada',
    'A conta está fechada ou já foi enviada: o item não entra nela. Registre a decisão na fila de lançamento após o fechamento.',
  );
}

export interface ContaParaFecharPropria {
  readonly situacao: string;
  readonly itens: number;
  readonly pendenciasBloqueantes: number;
  readonly auditoriaBloqueante: boolean;
}

export function conferirFechamentoConta(c: ContaParaFecharPropria): RecusaFaturamento | null {
  if (c.situacao === 'fechada' || c.situacao === 'faturada')
    return recusaFat('conta-ja-fechada', 'A conta já está fechada.');
  if (c.situacao === 'enviada' || c.situacao === 'paga')
    return recusaFat('conta-apresentada', 'A conta já foi apresentada à operadora.');
  if (!contaAceitaLancamento(c.situacao))
    return recusaFat('situacao-invalida', 'A situação desta conta não permite fechar.');
  if (c.itens <= 0) return recusaFat('conta-sem-itens', 'A conta não tem itens lançados: não há o que fechar.');
  if (c.pendenciasBloqueantes > 0)
    return recusaFat(
      'pendencia-bloqueante',
      `A conta tem ${c.pendenciasBloqueantes} pendência(s) aberta(s) que impedem o fechamento.`,
    );
  if (c.auditoriaBloqueante)
    return recusaFat('auditoria-em-andamento', 'A conta está numa auditoria que bloqueia o fechamento.');
  return null;
}

export interface ContaParaReabrirPropria {
  readonly situacao: string;
  readonly emLote: boolean;
  readonly motivo: string;
}

export function conferirReaberturaConta(c: ContaParaReabrirPropria): RecusaFaturamento | null {
  if (contaAceitaLancamento(c.situacao)) return recusaFat('conta-ja-aberta', 'A conta já está aberta.');
  if (c.situacao === 'enviada' || c.situacao === 'paga')
    return recusaFat(
      'conta-apresentada',
      'A conta já foi apresentada à operadora e não pode ser reaberta; use o recurso de glosa ou a conta complementar.',
    );
  if (c.situacao !== 'fechada' && c.situacao !== 'faturada')
    return recusaFat('situacao-invalida', 'A situação desta conta não permite reabrir.');
  if (c.emLote || c.situacao === 'faturada')
    return recusaFat('em-lote', 'A conta está em um lote TISS; retire-a do lote antes de reabrir.');
  if (c.motivo.trim().length < 5) return recusaFat('motivo-obrigatorio', 'Informe o motivo.', ['motivo']);
  return null;
}

export type EtapaConta = 'conferencia' | 'auditoria';

/** A etapa de trabalho: iniciar leva a conta aberta para a etapa; concluir a devolve para aberta. */
export function transicaoDaEtapa(
  situacao: string,
  etapa: EtapaConta,
  acao: 'iniciar' | 'concluir',
): { readonly nova: SituacaoConta } | RecusaFaturamento {
  const naEtapa: SituacaoConta = etapa === 'conferencia' ? 'em_conferencia' : 'em_auditoria';
  if (acao === 'iniciar') {
    if (situacao === naEtapa) return recusaFat('etapa-em-andamento', 'A etapa já está em andamento nesta conta.');
    if (situacao !== 'aberta')
      return recusaFat('conta-nao-aberta', 'A etapa só começa na conta aberta, fora de outra etapa.');
    return { nova: naEtapa };
  }
  if (situacao !== naEtapa) return recusaFat('etapa-nao-iniciada', 'A etapa não está em andamento nesta conta.');
  return { nova: 'aberta' };
}

/** A conferência de itens vale na conta em produção. */
export function conferirConferenciaItens(situacao: string): RecusaFaturamento | null {
  return contaAceitaLancamento(situacao)
    ? null
    : recusaFat('conta-fechada', 'A conta não está aberta: a conferência é feita na conta aberta.');
}

/** Valor do item: unitário × quantidade × percentual de cobrança, em centavos. */
export function valorDoItem(unitario: number, quantidade: number, percentual = 100): number {
  return Math.round(unitario * quantidade * (percentual / 100) * 100) / 100;
}

/** Competência (primeiro dia do mês) de uma data AAAA-MM-DD. */
export function competenciaDe(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

// ── Competência ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A competência da conta está fechada para a fonte pagadora? O fechamento da própria fonte (estabelecimento, fonte,
 * competência) decide quando existe, inclusive reaberto; sem ele, vale a competência do faturamento de convênios.
 */
export function competenciaFechada(daFonte: string | null, geral: string | null): boolean {
  return daFonte !== null ? daFonte === 'fechada' : geral === 'fechada';
}

/** Fechar a conta e lançar item exigem a competência aberta (regra 9). */
export function conferirCompetenciaDaConta(daFonte: string | null, geral: string | null): RecusaFaturamento | null {
  return conferirCompetenciaAberta(competenciaFechada(daFonte, geral));
}

// ── Pendência ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * O tipo define o efeito: 'impede_fechamento' sempre bloqueia; 'alerta' e 'impede_envio' só bloqueiam o fechamento
 * quando a tela pede (a tela endurece, nunca afrouxa).
 */
export function pendenciaBloqueiaFechamento(controle: string, pedidoDaTela: boolean): boolean {
  return controle === 'impede_fechamento' || pedidoDaTela;
}

/** Pendência nova só em conta viva: cancelada, enviada ou paga não recebe pendência. */
export function conferirRegistroPendencia(situacao: string): RecusaFaturamento | null {
  return situacao === 'cancelada' || situacao === 'enviada' || situacao === 'paga'
    ? recusaFat('conta-encerrada', 'A conta está cancelada, enviada ou paga: não recebe pendência nova.', ['conta'])
    : null;
}

// ── Particular e caixa ──────────────────────────────────────────────────────────────────────────────────

/** O recebimento no caixa contra uma conta só vale para a conta particular (fonte pagadora de tipo particular). */
export function conferirRecebimentoDaConta(particular: boolean): RecusaFaturamento | null {
  return particular
    ? null
    : recusaFat('conta-nao-particular', 'Só a conta do particular é recebida no caixa.', ['conta']);
}

/** Forma de pagamento da tela → espécie do movimento de caixa (lista branca; CHECK de movimento_caixa.especie). */
export const ESPECIE_DA_FORMA: Readonly<Record<FormaPagamento, string>> = {
  dinheiro: 'dinheiro',
  pix: 'pix',
  'cartao-credito': 'cartao_credito',
  'cartao-debito': 'cartao_debito',
  transferencia: 'transferencia',
};

/** Espécie do caixa → forma da tela; as espécies que a tela não recebe (cheque, boleto, vale, outro) são 'outras'. */
export function formaDaEspecie(especie: string): FormaPagamento | 'outras' {
  for (const [forma, e] of Object.entries(ESPECIE_DA_FORMA)) if (e === especie) return forma as FormaPagamento;
  return 'outras';
}
