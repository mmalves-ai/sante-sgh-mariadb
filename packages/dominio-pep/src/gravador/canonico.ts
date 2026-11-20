// Prova do documento (ficha do M22, seção 6 e regra 11; cap-11 §11.1 "documento com hash"): o conteúdo canônico do
// registro em JCS (RFC 8785: chaves em ordem de unidades UTF-16, números na forma do ECMAScript, sem espaços) e o
// SHA-256 dele; os eventos do documento encadeados por hash (cada um leva o hash do anterior). A prova não torna
// o prontuário imutável (DP-40): o outro sistema pode alterar o registro durante a coexistência; a rotina compara
// o hash guardado com o conteúdo atual e aponta a alteração.
import { jcs, type RespostaRegistro, sha256Hex } from '@sgh/contratos';

export {
  cadeiaIntegra,
  type EventoDocumento,
  hashDoEvento,
  jcs,
  sha256Hex,
  TIPOS_EVENTO_DOCUMENTO,
  type TipoEventoDocumento,
} from '@sgh/contratos';

export interface ConteudoCanonico {
  readonly estabelecimento: string;
  readonly registro: number;
  readonly modelo: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly dataHoraClinica: string;
  /** Impressão digital da representação usada. */
  readonly impressao: string;
  readonly respostas: readonly RespostaRegistro[];
}

/** Respostas em ordem de vínculo, sem campos indefinidos (a mesma entrada dá o mesmo hash). */
export function conteudoCanonico(c: ConteudoCanonico): string {
  return jcs({
    ...c,
    respostas: [...c.respostas]
      .sort((a, b) => a.vinculo - b.vinculo)
      .map((r) => ({ vinculo: r.vinculo, valor: r.valor, autopreenchido: r.autopreenchido })),
  });
}

export async function hashDoConteudo(c: ConteudoCanonico): Promise<string> {
  return sha256Hex(conteudoCanonico(c));
}
