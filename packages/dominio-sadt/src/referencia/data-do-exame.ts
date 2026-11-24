// A data que vale para a referência do resultado (F3.5, 05-SADT linhas 3 e 10): a faixa e o valor crítico são os
// vigentes na data do exame, nunca os de hoje (ANVISA RDC 302/2005: o laudo traz a referência do dia em que o exame foi
// feito). A data do exame é a da coleta da amostra; sem coleta, a da solicitação; sem as duas, hoje. A idade do
// paciente é contada na mesma data (a faixa por idade, no SQL da leitura).

const DATA = /^\d{4}-\d{2}-\d{2}/;

/** A data (AAAA-MM-DD) que escolhe a faixa de referência e o crítico do exame. */
export function dataDaReferencia(e: {
  readonly coletadaEm?: string | null;
  readonly solicitadoEm?: string | null;
  readonly hoje: string;
}): string {
  for (const d of [e.coletadaEm, e.solicitadoEm])
    if (d && DATA.test(d)) {
      const dia = d.slice(0, 10);
      return dia <= e.hoje.slice(0, 10) ? dia : e.hoje.slice(0, 10);
    }
  return e.hoje.slice(0, 10);
}
