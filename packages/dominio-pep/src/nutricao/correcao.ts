// W0-05 (programa CRUD completo, 18/11/2026): as regras da correção do registro clínico da nutrição e do serviço social
// (matriz de governança, linha "Prontuário: registro clínico finalizado"; SBIS NGS1.12.01 e NGS1.12.03). Puras:
//   - a retificação (nova versão) e o estorno (inativação) são do PRÓPRIO autor, com justificativa;
//   - o registro já inativo (retificado, estornado, substituído ou encerrado) não se corrige de novo: a correção vale
//     sobre a versão ativa;
//   - o adendo complementa um registro ativo (o original continua ativo).
import type { CorrecaoLida } from '@sgh/contratos';

export type CodigoRecusaCorrecao = 'correcao-de-outro-autor' | 'registro-ja-corrigido';

export class ErroCorrecao extends Error {
  override readonly name = 'ErroCorrecao';
  readonly codigo: CodigoRecusaCorrecao;
  readonly status: 403 | 409;
  constructor(codigo: CodigoRecusaCorrecao, status: 403 | 409, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** A correção do registro clínico é do próprio autor (403 para os demais). */
export function exigirProprioAutor(registro: { readonly por: string }, login: string, oQue: string): void {
  if (!mesmo(registro.por, login))
    throw new ErroCorrecao(
      'correcao-de-outro-autor',
      403,
      `${oQue} é corrigido pelo próprio autor (${registro.por.trim()}): registre a sua avaliação como um registro novo.`,
    );
}

/** O registro tem de estar ativo (sem correção). */
export function exigirAtivo(registro: { readonly correcao: CorrecaoLida | null }): void {
  if (registro.correcao !== null)
    throw new ErroCorrecao(
      'registro-ja-corrigido',
      409,
      'O registro já foi retificado, estornado ou encerrado (está inativo): a correção vale sobre a versão ativa.',
    );
}
