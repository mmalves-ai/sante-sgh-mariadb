// F3.8, 07-FIN linha 66 (C1-026): de quem são os dados bancários e qual chave Pix paga o título.
// O cadastro da conta e da chave Pix vale para os três credores que o hospital paga por transferência: o fornecedor, o
// profissional de saúde (honorário e repasse) e o prestador terceiro. A conta é de um credor só (o par tipo e código;
// códigos de cadastros diferentes colidem). Na remessa por Pix, o título paga o credor do próprio título; quando ele
// não tem chave ativa, vale a do prestador terceiro ligado a ele (o prestador que recebe pelo mesmo fornecedor ou pelo
// mesmo profissional). Entre as chaves do mesmo nível, a conta preferencial e depois a mais recente.
import type { TipoChavePix } from './chave-pix.js';
import type { RecusaPagamentoEletronico } from './pagamento-eletronico.js';

export const TIPOS_CREDOR_CONTA = ['fornecedor', 'profissional', 'prestador'] as const;
export type TipoCredorConta = (typeof TIPOS_CREDOR_CONTA)[number];

export interface CredorDaConta {
  readonly tipo: TipoCredorConta;
  readonly id: number;
}

/** Entrada da inclusão: o par (tipoCredor, credor); `fornecedor` sozinho é a forma curta do fornecedor. */
export interface CredorDaContaInformado {
  readonly tipoCredor?: TipoCredorConta | undefined;
  readonly credor?: number | undefined;
  readonly fornecedor?: number | undefined;
}

const idValido = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

/** O credor da conta nova: um só, com tipo e código. Recusa a falta, o código sem tipo e o par ambíguo. */
export function credorDaConta(e: CredorDaContaInformado): CredorDaConta | RecusaPagamentoEletronico {
  const temPar = e.tipoCredor !== undefined || e.credor !== undefined;
  if (temPar && e.fornecedor !== undefined)
    return {
      codigo: 'credor-ambiguo',
      mensagem: 'Informe um credor só: o tipo e o código, ou o fornecedor.',
      campos: ['credor'],
    };
  if (e.fornecedor !== undefined)
    return idValido(e.fornecedor)
      ? { tipo: 'fornecedor', id: e.fornecedor }
      : { codigo: 'credor-invalido', mensagem: 'Escolha o credor.', campos: ['credor'] };
  if (e.tipoCredor === undefined || !TIPOS_CREDOR_CONTA.includes(e.tipoCredor))
    return { codigo: 'credor-invalido', mensagem: 'Escolha o tipo do credor.', campos: ['tipoCredor'] };
  if (!idValido(e.credor))
    return { codigo: 'credor-invalido', mensagem: 'Escolha o credor.', campos: ['credor'] };
  return { tipo: e.tipoCredor, id: e.credor };
}

export const credorRecusado = (
  r: CredorDaConta | RecusaPagamentoEletronico,
): r is RecusaPagamentoEletronico => 'codigo' in r;

/** Conta com chave Pix ativa candidata a pagar o título. */
export interface ChaveCandidata {
  readonly conta: number;
  /** `credor`: a conta é do credor do título; `prestador`: do prestador terceiro ligado a ele. */
  readonly nivel: 'credor' | 'prestador';
  readonly preferencial: boolean;
  readonly tipoChavePix: TipoChavePix;
  readonly chavePix: string;
}

/** A chave que paga o título: a do próprio credor antes da do prestador; no mesmo nível, a preferencial e a mais nova. */
export function escolherChavePix(candidatas: readonly ChaveCandidata[]): ChaveCandidata | null {
  const ordem = (c: ChaveCandidata) => (c.nivel === 'credor' ? 0 : 1);
  const lista = [...candidatas].sort(
    (a, b) => ordem(a) - ordem(b) || Number(b.preferencial) - Number(a.preferencial) || b.conta - a.conta,
  );
  return lista[0] ?? null;
}
