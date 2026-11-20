// Regra 12 do M32 (ref 01 §0 achado 10; cap-06b §6.8): a glosa chega ao título. Valor glosado = VALOR_C − VLR_PG dos
// itens com FCLANEXT.GLOSADO = 'T' (baixados); nunca ler 'F' como glosa (daria 33,8% em vez de 15,2%). A glosa aceita
// reduz o saldo mostrado do título (SGH_FIN_GLOSA_TITULO); o recurso deferido vira recebível.
import { centavos } from './recusa.js';

export interface ItemContaGlosa {
  readonly valorCobrado: number;
  readonly valorPago: number;
  /** FCLANEXT.GLOSADO: 'T' = baixado (conciliado); 'F' ou vazio = ainda sem retorno. */
  readonly glosado: string;
}

export interface GlosaDoTitulo {
  readonly itens: number;
  readonly baixados: number;
  readonly cobradoBaixado: number;
  readonly pagoBaixado: number;
  /** Σ (VALOR_C − VLR_PG) dos baixados com VALOR_C > VLR_PG. */
  readonly glosado: number;
  /** Σ (VLR_PG − VALOR_C) dos pagos a maior (glosa positiva). */
  readonly pagoAMaior: number;
  /** Taxa sobre o cobrado dos baixados (a régua da regra 12). */
  readonly taxa: number;
}

export function glosaDoTitulo(itens: readonly ItemContaGlosa[]): GlosaDoTitulo {
  let cobrado = 0;
  let pago = 0;
  let glosado = 0;
  let aMaior = 0;
  let baixados = 0;
  for (const i of itens) {
    if (i.glosado.trim().toUpperCase() !== 'T') continue;
    baixados++;
    cobrado += i.valorCobrado;
    pago += i.valorPago;
    const d = i.valorCobrado - i.valorPago;
    if (d > 0) glosado += d;
    else aMaior += -d;
  }
  return {
    itens: itens.length,
    baixados,
    cobradoBaixado: centavos(cobrado),
    pagoBaixado: centavos(pago),
    glosado: centavos(glosado),
    pagoAMaior: centavos(aMaior),
    taxa: cobrado > 0 ? Math.round((glosado / cobrado) * 10_000) / 100 : 0,
  };
}

export interface SaldoTitulo {
  readonly valorTitulo: number;
  readonly recebido: number;
  readonly glosaAceita: number;
  readonly recursoDeferido: number;
}

/** O saldo mostrado: valor − recebido − glosa aceita (nunca negativo); o recurso deferido é recebível à parte. */
export function saldoMostrado(s: SaldoTitulo): { saldo: number; recebivelRecurso: number } {
  return {
    saldo: Math.max(0, centavos(s.valorTitulo - s.recebido - s.glosaAceita)),
    recebivelRecurso: centavos(s.recursoDeferido),
  };
}
