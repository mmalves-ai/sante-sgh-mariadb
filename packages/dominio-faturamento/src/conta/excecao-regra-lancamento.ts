// Cadastro da exceção da regra de lançamento automático (F3.7, 06-FAT linha 16). A apuração já respeita a exceção
// (taxaPermitidaPelasExcecoes, em admissao.ts); aqui ficam a validação do cadastro (a mesma na tela e no servidor) e o
// encerramento, que nunca apaga: a exceção encerrada continua no banco com a data de fim.
// - Recorte: ao menos um entre estabelecimento, fonte pagadora, plano, setor, especialidade, item e grupo (uma exceção
//   sem recorte valeria para tudo e seria, na prática, desligar a regra: isso se faz na própria regra).
// - Plano só com a fonte pagadora dele; item e grupo não juntos (o item já é de um grupo).
// - Natureza: ao menos uma entre internação, ambulatorial, externo, urgência e domiciliar.
// - Vigência: início obrigatório, fim nulo (sem término) ou igual ou depois do início.
// - Motivo: obrigatório, de 5 a 500 caracteres (quem lê a exceção depois precisa saber por que ela existe).
// - Encerrar: a exceção vale até ontem (fim = ontem); a que ainda não começou não se encerra (o início é o registro do
//   que foi combinado) e a já encerrada não se encerra de novo.
// - Cancelar: a exceção gravada errada que começa hoje ou depois se cancela antes de valer (motivo de 5 a 500
//   caracteres; a linha fica no banco com quem cancelou, quando e por quê, e a apuração passa a ignorá-la). A que já
//   valeu antes de hoje se encerra, nunca se cancela (as contas já apuradas com ela continuam explicadas).
// - Recorte de todos os estabelecimentos: só com permissão própria (incluir e encerrar ou cancelar a exceção global
//   muda a apuração dos outros estabelecimentos).

export const EFEITOS_EXCECAO_REGRA = ['nao_aplicar', 'aplicar_somente'] as const;
export type EfeitoExcecaoRegra = (typeof EFEITOS_EXCECAO_REGRA)[number];
export const NATUREZAS_EXCECAO_REGRA = [
  'internacao',
  'ambulatorial',
  'externo',
  'urgencia',
  'domiciliar',
] as const;
export type NaturezaExcecaoRegra = (typeof NATUREZAS_EXCECAO_REGRA)[number];

export interface CadastroExcecaoRegra {
  readonly regraLancamento: number | null;
  readonly estabelecimento: number | null;
  readonly fontePagadora: number | null;
  readonly plano: number | null;
  readonly setor: number | null;
  readonly especialidade: number | null;
  readonly item: number | null;
  readonly grupo: number | null;
  readonly efeito: string;
  readonly aplica: Readonly<Record<NaturezaExcecaoRegra, boolean>>;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly motivo: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const preenchido = (v: number | null) => v !== null && v > 0;

/** Erros do cadastro por campo (vazio: válido). */
export function validarExcecaoRegraLancamento(x: CadastroExcecaoRegra): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!preenchido(x.regraLancamento)) erros['regraLancamento'] = 'Escolha a regra de lançamento.';
  if (!(EFEITOS_EXCECAO_REGRA as readonly string[]).includes(x.efeito))
    erros['efeito'] = 'Escolha o efeito: não aplicar no recorte ou aplicar somente nele.';
  const recortes = [x.estabelecimento, x.fontePagadora, x.plano, x.setor, x.especialidade, x.item, x.grupo];
  if (!recortes.some(preenchido))
    erros['recorte'] =
      'Informe ao menos um recorte (estabelecimento, fonte pagadora, plano, setor, especialidade, item ou grupo).';
  if (preenchido(x.plano) && !preenchido(x.fontePagadora))
    erros['plano'] = 'O plano vai junto da fonte pagadora dele.';
  if (preenchido(x.item) && preenchido(x.grupo))
    erros['grupo'] = 'Escolha o item ou o grupo, não os dois: o item já pertence a um grupo.';
  if (!NATUREZAS_EXCECAO_REGRA.some((k) => x.aplica[k]))
    erros['aplica'] = 'Marque ao menos uma natureza de atendimento.';
  if (!x.vigenciaInicio || !DATA.test(x.vigenciaInicio))
    erros['vigenciaInicio'] = 'Informe o início da vigência.';
  if (x.vigenciaFim !== null && x.vigenciaFim !== '') {
    if (!DATA.test(x.vigenciaFim)) erros['vigenciaFim'] = 'Data de fim inválida.';
    else if (x.vigenciaInicio && x.vigenciaFim < x.vigenciaInicio)
      erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  }
  const motivo = x.motivo.trim();
  if (motivo.length < 5) erros['motivo'] = 'Escreva o motivo da exceção (ao menos 5 caracteres).';
  else if (motivo.length > 500) erros['motivo'] = 'O motivo passa de 500 caracteres.';
  return erros;
}

/** O dia anterior a "AAAA-MM-DD" (calendário, sem fuso). */
export function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const x = new Date(Date.UTC(a, m - 1, d - 1));
  return x.toISOString().slice(0, 10);
}

/** Situação da exceção no dia: cancelada, futura, vigente ou encerrada. */
export function situacaoExcecaoRegra(
  inicio: string | null,
  fim: string | null,
  hoje: string,
  cancelada = false,
): 'cancelada' | 'futura' | 'vigente' | 'encerrada' {
  if (cancelada) return 'cancelada';
  if (fim !== null && fim < hoje) return 'encerrada';
  if (inicio !== null && inicio > hoje) return 'futura';
  return 'vigente';
}

export type EncerramentoExcecao =
  | { readonly ok: true; readonly vigenciaFim: string }
  | {
      readonly ok: false;
      readonly codigo: 'excecao-encerrada' | 'excecao-futura' | 'excecao-cancelada';
      readonly mensagem: string;
    };

const JA_CANCELADA = {
  ok: false,
  codigo: 'excecao-cancelada',
  mensagem: 'A exceção já está cancelada.',
} as const;

/** Encerrar a exceção: passa a valer até ontem. Nunca apaga. */
export function encerramentoExcecaoRegra(
  inicio: string | null,
  fim: string | null,
  hoje: string,
  cancelada = false,
): EncerramentoExcecao {
  if (cancelada) return JA_CANCELADA;
  const ontem = diaAnterior(hoje);
  if (fim !== null && fim <= ontem)
    return { ok: false, codigo: 'excecao-encerrada', mensagem: 'A exceção já está encerrada.' };
  if (inicio !== null && inicio > ontem)
    return {
      ok: false,
      codigo: 'excecao-futura',
      mensagem:
        'A exceção começa hoje ou depois: só se encerra depois do primeiro dia de vigência. Se foi gravada errada, cancele.',
    };
  return { ok: true, vigenciaFim: ontem };
}

export type CancelamentoExcecao =
  | { readonly ok: true; readonly motivo: string }
  | {
      readonly ok: false;
      readonly codigo: 'excecao-cancelada' | 'excecao-em-vigor' | 'entrada-invalida';
      readonly mensagem: string;
    };

/**
 * Cancelar a exceção gravada errada antes de valer: só a que começa hoje ou depois (a que já valeu antes de hoje se
 * encerra). Pede o motivo (5 a 500 caracteres). Nunca apaga: a porta grava quem, quando e por quê.
 */
export function cancelamentoExcecaoRegra(
  inicio: string | null,
  cancelada: boolean,
  hoje: string,
  motivo: string,
): CancelamentoExcecao {
  if (cancelada) return JA_CANCELADA;
  if (inicio === null || inicio < hoje)
    return {
      ok: false,
      codigo: 'excecao-em-vigor',
      mensagem: 'A exceção já valeu antes de hoje: encerre-a (passa a valer até ontem) em vez de cancelar.',
    };
  const m = motivo.trim();
  if (m.length < 5)
    return {
      ok: false,
      codigo: 'entrada-invalida',
      mensagem: 'Escreva o motivo do cancelamento (ao menos 5 caracteres).',
    };
  if (m.length > 500)
    return {
      ok: false,
      codigo: 'entrada-invalida',
      mensagem: 'O motivo do cancelamento passa de 500 caracteres.',
    };
  return { ok: true, motivo: m };
}
