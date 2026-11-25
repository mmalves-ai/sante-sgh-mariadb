// F3.8, 07-FIN linha 89: cliente das telas do cartão de débito e crédito (cartao.controller.ts): administradoras e taxas
// com vigência, prévia da venda, parcelas a receber das administradoras e a baixa do crédito.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { ParcelaRecebivel, TaxaAdministradora } from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const P = '/api/financeiro/cartao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.custom<X[]>((v) => Array.isArray(v));

export interface AdministradoraCartao {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly diasParaPagamento: number;
  readonly contaBancaria: number | null;
  readonly permiteParcelamento: boolean;
  readonly ativo: boolean;
}
export interface BandeiraCartao {
  readonly id: number;
  readonly nome: string;
  readonly modalidade: string;
}
export interface OpcoesCartao {
  readonly administradoras: readonly AdministradoraCartao[];
  readonly bandeiras: readonly BandeiraCartao[];
}
export interface TaxaCartao extends TaxaAdministradora {
  readonly versao: number;
  readonly vigente: boolean;
}
export interface PlanoCartao {
  readonly taxa: TaxaAdministradora;
  readonly parcelas: readonly ParcelaRecebivel[];
  readonly bruto: number;
  readonly taxaTotal: number;
  readonly liquido: number;
}
export interface RecebivelCartao {
  readonly id: number;
  readonly transacao: number;
  readonly administradora: number;
  readonly administradoraNome: string;
  readonly bandeira: string;
  readonly modalidade: string;
  readonly nsu: string;
  readonly dataVenda: string;
  readonly sequencia: number;
  readonly de: number;
  readonly dataPrevista: string;
  readonly bruto: number;
  readonly taxa: number;
  readonly liquido: number;
  readonly situacao: string;
  readonly recebidaEm: string | null;
  readonly valorRecebido: number | null;
  readonly contaSugerida: number | null;
}
export interface PedidoPrevia {
  administradora: number;
  bandeira: number;
  modalidade: 'debito' | 'credito';
  parcelas: number;
  valor: number;
}

const consulta = (o: Record<string, string | number | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const lerAdministradoras = () => ler(`${P}/administradoras`, confiar<OpcoesCartao>());
export const lerOpcoesCartao = () => ler(`${P}/opcoes`, confiar<OpcoesCartao>());
export const lerTaxas = (administradora: number) =>
  ler(`${P}/taxas?${consulta({ administradora })}`, lista<TaxaCartao>());
export const lerPreviaCartao = (p: PedidoPrevia) =>
  ler(`${P}/previa?${consulta({ ...p })}`, confiar<PlanoCartao>());
export const lerRecebiveis = (f: { de: string; ate: string; situacao: string }) =>
  ler(`${P}/recebiveis?${consulta(f)}`, lista<RecebivelCartao>());
const gravar = (caminho: string, corpo: unknown, chave: string) =>
  enviar(`${P}/${caminho}`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const gravarAdministradora = (e: unknown, chave: string) => gravar('administradoras', e, chave);
export const gravarTaxa = (e: unknown, chave: string) => gravar('taxas', e, chave);
export const encerrarTaxa = (taxa: number, vigenciaFim: string, chave: string) =>
  gravar(`taxas/${taxa}/encerrar`, { vigenciaFim }, chave);
export const baixarRecebiveis = (e: unknown, chave: string) => gravar('recebiveis/baixa', e, chave);
