// F3.7 (06-FAT linha 36): a nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular.
// Desenho próprio: o faturista vê, a partir da fatura ou da conta, quanto já está documentado por nota e quanto falta,
// e liga uma nota com o valor já sugerido (o menor entre o saldo da nota e o saldo do alvo). Uma nota pode documentar
// várias faturas (parte de cada) e uma fatura pode ter mais de uma nota; a soma nunca passa do valor de nenhum lado.
// A nota só documenta o alvo para o qual serve: a emitida para outra fatura ou outra conta é recusada, a de outra fonte
// pagadora também, e a emitida a um tomador avulso (sem fonte pagadora, o particular) só vale se o CPF ou CNPJ do
// tomador for o do paciente, o de um responsável financeiro ou legal da conta, ou o da própria fonte pagadora.
// Desligar não apaga e pede motivo: o vínculo fica marcado como excluído, com autor e data, e cada ligação, ajuste,
// desligamento e religamento fica no histórico próprio do vínculo (valor anterior e novo, motivo, quem e quando).

/** Situações da nota que aceitam vínculo (a cancelada, a substituída e a rejeitada não documentam nada). */
export const SITUACOES_NOTA_VINCULAVEIS: ReadonlySet<string> = new Set([
  'rascunho',
  'rps_gerado',
  'enviada',
  'autorizada',
]);
/** Conta do paciente só é documentada depois de fechada (o valor não muda mais sem reabrir). */
export const SITUACOES_CONTA_DOCUMENTAVEIS: ReadonlySet<string> = new Set([
  'fechada',
  'faturada',
  'enviada',
  'paga',
]);
/** Fatura do convênio só é documentada depois de fechada. */
export const SITUACOES_FATURA_DOCUMENTAVEIS: ReadonlySet<string> = new Set([
  'fechada',
  'enviada',
  'protocolada',
  'paga_parcial',
  'paga',
]);

export type TipoAlvoNota = 'fatura' | 'conta';

export interface NotaParaVinculo {
  readonly situacao: string;
  /** Valor dos serviços da nota. */
  readonly valorServicos: number;
  /** Soma já apropriada pela nota a outros alvos (sem o vínculo em edição). */
  readonly valorJaApropriado: number;
  readonly fontePagadoraId: number | null;
  /** Conta e fatura para as quais a nota foi emitida (nulas quando a nota não nasceu de um alvo). */
  readonly contaHospitalarId?: number | null;
  readonly faturaFontePagadoraId?: number | null;
  /** CPF ou CNPJ do tomador, como saiu na nota. */
  readonly tomadorDocumento?: string | null;
}

export interface AlvoParaVinculo {
  readonly tipo: TipoAlvoNota;
  readonly situacao: string;
  /** Valor a documentar: o da fatura (apresentado + acréscimo − desconto) ou o da conta (total). */
  readonly valorDocumentavel: number;
  /** Soma já documentada por outras notas. */
  readonly valorJaDocumentado: number;
  readonly fontePagadoraId: number | null;
  /** Id do alvo, para recusar a nota emitida para outra fatura ou conta. */
  readonly id?: number;
  /** Documentos aceitos como tomador da nota sem fonte pagadora (paciente, responsáveis, CNPJ da fonte). */
  readonly documentosTomador?: readonly string[];
}

export interface PedidoVinculoNota {
  readonly valorApropriado: number;
  readonly valorDesconto?: number;
  readonly valorAcrescimo?: number;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/** Valor de uma fatura a documentar por nota. */
export function valorDocumentavelFatura(f: {
  readonly valorApresentado: number;
  readonly valorAcrescimo: number;
  readonly valorDesconto: number;
}): number {
  return reais(
    Math.max(0, centavos(f.valorApresentado) + centavos(f.valorAcrescimo) - centavos(f.valorDesconto)),
  );
}

/** Saldo da nota ainda sem alvo e saldo do alvo ainda sem nota. */
export function saldosVinculo(nota: NotaParaVinculo, alvo: AlvoParaVinculo) {
  const saldoNota = Math.max(0, centavos(nota.valorServicos) - centavos(nota.valorJaApropriado));
  const saldoAlvo = Math.max(0, centavos(alvo.valorDocumentavel) - centavos(alvo.valorJaDocumentado));
  return {
    saldoNota: reais(saldoNota),
    saldoAlvo: reais(saldoAlvo),
    sugerido: reais(Math.min(saldoNota, saldoAlvo)),
  };
}

const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/**
 * Por que a nota não serve para este alvo (nulo quando serve): emitida para outra fatura ou conta, para outra fonte
 * pagadora ou para um tomador que não é o paciente, um responsável da conta nem a fonte pagadora.
 */
export function notaServeAoAlvo(nota: NotaParaVinculo, alvo: AlvoParaVinculo): string | null {
  const paraConta = nota.contaHospitalarId ?? null;
  const paraFatura = nota.faturaFontePagadoraId ?? null;
  if (paraConta !== null || paraFatura !== null) {
    const doAlvo = alvo.tipo === 'fatura' ? paraFatura : paraConta;
    if (alvo.id === undefined || doAlvo !== alvo.id)
      return alvo.tipo === 'fatura'
        ? 'A nota foi emitida para outra fatura ou para uma conta.'
        : 'A nota foi emitida para outra conta ou para uma fatura.';
  }
  if (nota.fontePagadoraId !== null) {
    if (nota.fontePagadoraId !== alvo.fontePagadoraId) return 'A nota foi emitida para outra fonte pagadora.';
    return null;
  }
  const doc = soDigitos(nota.tomadorDocumento);
  const aceitos = new Set((alvo.documentosTomador ?? []).map(soDigitos).filter((d) => d.length > 0));
  if (!doc || !aceitos.has(doc))
    return alvo.tipo === 'fatura'
      ? 'O tomador da nota não é a fonte pagadora da fatura.'
      : 'O tomador da nota não é o paciente, um responsável financeiro da conta nem a fonte pagadora.';
  return null;
}

/** Confere o vínculo pedido; devolve os erros por campo (vazio quando vale). */
export function validarVinculoNota(
  nota: NotaParaVinculo,
  alvo: AlvoParaVinculo,
  p: PedidoVinculoNota,
): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!SITUACOES_NOTA_VINCULAVEIS.has(nota.situacao))
    erros['notaServicoId'] = 'A nota cancelada, substituída ou rejeitada não documenta fatura nem conta.';
  const situacoes = alvo.tipo === 'fatura' ? SITUACOES_FATURA_DOCUMENTAVEIS : SITUACOES_CONTA_DOCUMENTAVEIS;
  if (!situacoes.has(alvo.situacao))
    erros['alvo'] =
      alvo.tipo === 'fatura'
        ? 'Feche a fatura antes de ligar a nota.'
        : 'Feche a conta antes de ligar a nota.';
  const outro = notaServeAoAlvo(nota, alvo);
  if (outro) erros['notaServicoId'] = outro;
  const valor = centavos(p.valorApropriado);
  const desconto = centavos(p.valorDesconto ?? 0);
  const acrescimo = centavos(p.valorAcrescimo ?? 0);
  if (!(valor > 0)) erros['valorApropriado'] = 'Informe o valor que a nota documenta (maior que zero).';
  if (desconto < 0) erros['valorDesconto'] = 'O desconto não pode ser negativo.';
  if (acrescimo < 0) erros['valorAcrescimo'] = 'O acréscimo não pode ser negativo.';
  if (valor > 0) {
    const { saldoNota, saldoAlvo } = saldosVinculo(nota, alvo);
    if (valor > centavos(saldoNota))
      erros['valorApropriado'] = `A nota só tem ${saldoNota.toFixed(2)} sem vínculo.`;
    else if (valor > centavos(saldoAlvo))
      erros['valorApropriado'] =
        `Faltam só ${saldoAlvo.toFixed(2)} para documentar ${alvo.tipo === 'fatura' ? 'a fatura' : 'a conta'}.`;
  }
  return erros;
}

export type SituacaoDocumentacao = 'sem_nota' | 'parcial' | 'documentada';

/** Como está a documentação fiscal do alvo. */
export function situacaoDocumentacao(
  valorDocumentavel: number,
  valorDocumentado: number,
): SituacaoDocumentacao {
  const d = centavos(valorDocumentado);
  if (d <= 0) return 'sem_nota';
  return d >= centavos(valorDocumentavel) ? 'documentada' : 'parcial';
}

/** A nota ainda documenta o alvo? A cancelada, a substituída e a rejeitada seguem ligadas, mas não documentam mais. */
export const notaDocumenta = (situacaoNota: string) => SITUACOES_NOTA_VINCULAVEIS.has(situacaoNota);

/** Desligar a nota do alvo exige o motivo (de 10 a 500 caracteres), que fica no histórico do vínculo. */
export function validarDesligamentoNota(motivo: string | null | undefined): Record<string, string> {
  const m = (motivo ?? '').trim();
  if (m.length < 10) return { motivo: 'Diga por que a nota deixa de documentar (pelo menos 10 caracteres).' };
  if (m.length > 500) return { motivo: 'O motivo vai até 500 caracteres.' };
  return {};
}
