// O RPA do médico usa o dado fiscal do cadastro do profissional que vale no dia e no estabelecimento (F3.1, 02-CAD
// linha 16): quais tributos são retidos, a alíquota do ISS do município e o percentual do INSS do contribuinte
// individual. Sem dado fiscal cadastrado, vale a regra geral dos parâmetros do repasse (o que o RPA já fazia). Quem recebe
// por empresa no dia não tem RPA (o repasse sai em demonstrativo para a nota). A conta principal ativa é o destino do
// pagamento mostrado na prévia, sempre mascarada (LGPD: só o final da conta ou o tipo da chave).
import type { ParametrosRpa } from './rpa.js';

/** O dado fiscal do profissional vigente no dia, como o RPA o vê. */
export interface DadoFiscalParaRpa {
  readonly tipoRecebedor: string;
  readonly aliquotaIss: number | null;
  readonly percentualInss: number | null;
  readonly retemIss: boolean;
  readonly retemInss: boolean;
  readonly retemIrrf: boolean;
}

/** A conta principal ativa do profissional, como o destino do pagamento a mostra. */
export interface ContaParaRpa {
  readonly bancoDescricao: string | null;
  readonly agencia: string | null;
  readonly numeroConta: string | null;
  readonly tipoChavePix: string | null;
}

export type OrigemFiscalRpa = 'dado-fiscal' | 'regra-geral';

export type ParametrosDoProfissional =
  | { readonly ok: true; readonly parametros: ParametrosRpa; readonly origem: OrigemFiscalRpa }
  | { readonly ok: false; readonly codigo: 'recebe-por-empresa'; readonly motivo: string };

const percentualValido = (v: number | null): v is number =>
  v !== null && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * Os parâmetros do RPA para o médico: a regra geral ajustada pelo dado fiscal vigente. O dado fiscal decide o que é
 * retido (ISS, INSS e IRRF) e, quando informa, a alíquota do ISS e o percentual do INSS; a tabela do IRRF e o teto do
 * INSS são sempre os gerais (são da lei, não do profissional).
 */
export function parametrosDoProfissional(
  geral: ParametrosRpa,
  fiscal: DadoFiscalParaRpa | null,
): ParametrosDoProfissional {
  if (fiscal === null) return { ok: true, parametros: geral, origem: 'regra-geral' };
  if (fiscal.tipoRecebedor === 'pessoa_juridica')
    return {
      ok: false,
      codigo: 'recebe-por-empresa',
      motivo:
        'No dia, o profissional recebe o repasse pela empresa (dado fiscal do cadastro): emita o demonstrativo para a nota, sem RPA.',
    };
  return {
    ok: true,
    origem: 'dado-fiscal',
    parametros: {
      ...geral,
      reterIss: fiscal.retemIss,
      reterInss: fiscal.retemInss,
      reterIrrf: fiscal.retemIrrf,
      issAliquota: percentualValido(fiscal.aliquotaIss) ? fiscal.aliquotaIss : geral.issAliquota,
      inssAliquota: percentualValido(fiscal.percentualInss) ? fiscal.percentualInss : geral.inssAliquota,
    },
  };
}

/** O destino do pagamento mascarado: banco, agência e só os 2 últimos dígitos da conta, ou o tipo da chave. */
export function destinoDoPagamento(conta: ContaParaRpa | null): string | null {
  if (conta === null) return null;
  if (conta.numeroConta) {
    const digitos = conta.numeroConta.replace(/\D+/g, '');
    const final = digitos.slice(-2) || '-';
    return [conta.bancoDescricao, conta.agencia ? `ag. ${conta.agencia}` : null, `conta final ${final}`]
      .filter((x): x is string => x !== null && x !== '')
      .join(' · ');
  }
  return conta.tipoChavePix ? `chave de pagamento instantâneo (${conta.tipoChavePix})` : null;
}
