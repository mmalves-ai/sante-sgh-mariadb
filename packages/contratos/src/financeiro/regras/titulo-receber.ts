// Regras 9, 10, 11 e 13 do M32 (Anexo A §A.6; cap-06b §6.8): o título a receber.
//   - DEV (devedor): E 17.130 · I 5.096 · C 2.559 · T 190 · L 83 · O 1 (confiança alta);
//   - ORIGEM: V 24.602 (faturamento e recepção) · F 262 (lançado no financeiro) · E 190 (terceiros); F e E "a confirmar"
//     (DP-46.4); o novo grava V nos cenários do faturamento e da recepção;
//   - ATE (atendimento de origem): E 18.493 · I 6.151 · A 148;
//   - ORIGEMBAIXA: M 24.600 (manual) · B 459 (retorno bancário); a baixa manual é exceção (permissão própria e motivo);
//   - VLR_GLO, SALDO e GLOSA_ACEITA: 0 em 100% (a glosa está no item da conta; no título vai para SGH_FIN_GLOSA_TITULO);
//   - regra 10: toda conta apresentada ganha título a partir do fechamento de competência; "contas sem título"
//     acompanha os dois sistemas (só 13.260 de 40.693 contas de 2025 estavam ligadas).
import { recusaFin, type RecusaFinanceiro, somarDias, diaDaSemana } from './recusa.js';

export const DEVEDORES = ['C', 'E', 'I', 'T', 'L', 'O'] as const;
export type Devedor = (typeof DEVEDORES)[number];
export const ROTULO_DEVEDOR: Readonly<Record<Devedor, string>> = {
  C: 'Convênio',
  E: 'Paciente externo',
  I: 'Paciente interno',
  T: 'Terceiros',
  L: 'Cliente',
  O: 'Colaborador',
};

export const ORIGENS_RECEBER = ['V', 'F', 'E'] as const;
export type OrigemReceber = (typeof ORIGENS_RECEBER)[number];
export const ROTULO_ORIGEM_RECEBER: Readonly<Record<OrigemReceber, string>> = {
  V: 'Faturamento ou recepção',
  F: 'Lançado no financeiro (a confirmar)',
  E: 'Títulos de terceiros (a confirmar)',
};

export const ATENDIMENTOS = ['E', 'I', 'A'] as const;
export type AtendimentoOrigem = (typeof ATENDIMENTOS)[number];
export const ROTULO_ATENDIMENTO: Readonly<Record<AtendimentoOrigem, string>> = {
  E: 'Externo',
  I: 'Internação',
  A: 'Ambos ou avulso',
};

export const ROTULO_ORIGEM_BAIXA: Readonly<Record<'M' | 'B', string>> = {
  M: 'Baixa manual',
  B: 'Retorno bancário',
};

/** O devedor do título que nasce da conta: convênio, ou o paciente externo ou interno no particular. */
export function devedorDaConta(conta: { particular: boolean; tipoConta: 'E' | 'I' }): Devedor {
  if (!conta.particular) return 'C';
  return conta.tipoConta === 'I' ? 'I' : 'E';
}

/** O atendimento de origem gravado: o da conta (E ou I). */
export const atendimentoDaConta = (tipoConta: 'E' | 'I'): AtendimentoOrigem => tipoConta;

/** O novo só grava os valores já vistos: V nos cenários do faturamento e da recepção. */
export const ORIGEM_GRAVADA_PELO_NOVO: OrigemReceber = 'V';

export interface ContaParaTitulo {
  /** FCCTAEXT.FECHADA: S fechada, A apresentada (as que geram título), N aberta. */
  readonly fechada: string;
  /** FCCTAEXT.ID_MFCTAREC: o título já ligado (0 ou nulo: sem título). */
  readonly titulo: number | null;
  readonly valor: number;
}

/** Regra 10: só conta fechada ou apresentada, sem título ligado (uma conta, um título, num só sistema). */
export function conferirContaParaTitulo(c: ContaParaTitulo): RecusaFinanceiro | null {
  if (c.titulo && c.titulo > 0)
    return recusaFin('conta-titulada', 'A conta já tem título a receber: abra o título existente.');
  const f = c.fechada.trim().toUpperCase();
  if (f !== 'S' && f !== 'A')
    return recusaFin('conta-aberta', 'Só a conta fechada ou apresentada gera título a receber.');
  if (!(c.valor > 0)) return recusaFin('conta-sem-valor', 'A conta não tem valor a receber.');
  return null;
}

/** Contas sem título, nos dois sistemas (o indicador da regra 10, com as parcelas). */
export function contasSemTitulo(contas: readonly { titulada: boolean; tituladaPeloNovo: boolean }[]): {
  contas: number;
  comTitulo: number;
  peloNovo: number;
  semTitulo: number;
  percentualLigadas: number;
} {
  const com = contas.filter((c) => c.titulada).length;
  return {
    contas: contas.length,
    comTitulo: com,
    peloNovo: contas.filter((c) => c.titulada && c.tituladaPeloNovo).length,
    semTitulo: contas.length - com,
    percentualLigadas: contas.length ? Math.round((com / contas.length) * 10_000) / 100 : 0,
  };
}

// ── Regra 11: vencimento pelo prazo do contrato do convênio (0 a 90 dias) e calendário de entrega ──────────────────

export const PRAZO_MAXIMO_CONVENIO = 90;

export interface ContratoPrazo {
  /** Dias depois da apresentação (0 a 90). */
  readonly prazoDias: number;
  /** Dias do mês em que o convênio paga (calendário de pagamento); vazio: na data do prazo. */
  readonly diasDePagamento: readonly number[];
}

export function conferirPrazo(c: ContratoPrazo): RecusaFinanceiro | null {
  if (!Number.isInteger(c.prazoDias) || c.prazoDias < 0 || c.prazoDias > PRAZO_MAXIMO_CONVENIO)
    return recusaFin('prazo-fora-da-faixa', `O prazo do contrato vai de 0 a ${PRAZO_MAXIMO_CONVENIO} dias.`, [
      'prazoDias',
    ]);
  if (c.diasDePagamento.some((d) => !Number.isInteger(d) || d < 1 || d > 31))
    return recusaFin('dia-de-pagamento-invalido', 'Os dias de pagamento vão de 1 a 31.', ['diasDePagamento']);
  return null;
}

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** Próximo dia útil (sábado e domingo e os feriados informados passam para o seguinte). */
export function proximoDiaUtil(data: string, feriados: ReadonlySet<string> = new Set()): string {
  let d = data;
  for (let i = 0; i < 15 && (diaDaSemana(d) === 0 || diaDaSemana(d) === 6 || feriados.has(d)); i++)
    d = somarDias(d, 1);
  return d;
}

/**
 * O vencimento do título de convênio: apresentação + prazo; com calendário, o primeiro dia de pagamento do convênio
 * em ou depois dessa data (num mês curto, o dia 31 vira o último dia); por fim o próximo dia útil.
 */
export function vencimentoConvenio(
  apresentacao: string,
  c: ContratoPrazo,
  feriados: ReadonlySet<string> = new Set(),
): string {
  const base = somarDias(apresentacao, c.prazoDias);
  if (c.diasDePagamento.length === 0) return proximoDiaUtil(base, feriados);
  const dias = [...new Set(c.diasDePagamento)].sort((a, b) => a - b);
  let ano = Number(base.slice(0, 4));
  let mes = Number(base.slice(5, 7));
  for (let k = 0; k < 3; k++) {
    for (const d of dias) {
      const dia = Math.min(d, ultimoDiaDoMes(ano, mes));
      const candidato = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (candidato >= base) return proximoDiaUtil(candidato, feriados);
    }
    mes += 1;
    if (mes === 13) {
      mes = 1;
      ano += 1;
    }
  }
  return proximoDiaUtil(base, feriados);
}

// ── Regra 13: a baixa manual é exceção ──────────────────────────────────────────────────────────────────────────

export interface PedidoBaixaReceber {
  readonly emAberto: boolean;
  readonly valorTitulo: number;
  readonly valorRecebido: number;
  readonly motivo: string;
  readonly temPermissaoManual: boolean;
}

export const MOTIVO_MINIMO = 10;

export function conferirBaixaManual(p: PedidoBaixaReceber): RecusaFinanceiro | null {
  if (!p.temPermissaoManual)
    return recusaFin(
      'sem-permissao-baixa-manual',
      'A baixa manual pede a permissão própria do contas a receber.',
    );
  if (!p.emAberto) return recusaFin('titulo-baixado', 'O título já foi baixado por outra via: releia.');
  if (p.motivo.trim().length < MOTIVO_MINIMO)
    return recusaFin(
      'motivo-obrigatorio',
      `Informe o motivo da baixa manual (ao menos ${MOTIVO_MINIMO} letras).`,
      ['motivo'],
    );
  if (!(p.valorRecebido > 0)) return recusaFin('valor-obrigatorio', 'Informe o valor recebido.', ['valor']);
  if (p.valorRecebido > p.valorTitulo + 0.005)
    return recusaFin('valor-acima-do-titulo', 'O valor recebido passa do valor do título.', ['valor']);
  return null;
}
