// Pré-preenchimento pelo histórico (regra 7 da ficha do M22; cap-11 §11.1; DP-28): PRPERGUNTA.MANTERHIST = 1
// (1.081 perguntas) traz a última resposta do paciente na pergunta, MARCADA (autopreenchido) e exigindo
// confirmação; ao gravar vai com AUTOPREENCHIDO = T. A semântica de 2 (61) e 3 (342) não está decidida (DP-28):
// o contorno é só mostrar o histórico ("copiar do último", a pedido), sem trazer o valor.
import type { CampoRegistro, RespostaRegistro } from '@sgh/contratos';

export const NIVEL_PREENCHE = 1;

/**
 * Valores trazidos do último registro do paciente para os campos com MANTERHIST 1 (só os campos ativos da visão;
 * resposta de vínculo que não está na visão é descartada). As que vêm do rascunho têm precedência (quem chama
 * só pede o histórico das perguntas sem resposta no rascunho).
 */
export function preencherPeloHistorico(
  campos: readonly CampoRegistro[],
  ultimas: readonly RespostaRegistro[],
): RespostaRegistro[] {
  const nivel = new Map<number, number>();
  const visitar = (l: readonly CampoRegistro[]) => {
    for (const c of l) {
      nivel.set(c.vinculo, c.manterHistorico);
      visitar(c.itens);
    }
  };
  visitar(campos);
  return ultimas
    .filter((r) => nivel.get(r.vinculo) === NIVEL_PREENCHE)
    .map((r) => ({ ...r, autopreenchido: true, confirmado: false }));
}

/** Campos que mostram o histórico a pedido (DP-28: 2 e 3 só mostram; 1 também traz o valor). */
export function mostraHistorico(c: Pick<CampoRegistro, 'manterHistorico'>): boolean {
  return c.manterHistorico >= 1 && c.manterHistorico <= 3;
}
