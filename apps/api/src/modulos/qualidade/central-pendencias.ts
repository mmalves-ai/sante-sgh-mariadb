// Revisão do W0-04: a pendência de prontuário chega ao médico pela central de avisos (o sino do Início), com o link para
// "Minhas pendências de prontuário". O título não leva dado do paciente nem o item (só que há pendência da comissão).
// Um aviso por revisão gravada (a central não repete o mesmo evento e objeto). Falha aqui não desfaz a revisão: a
// pendência continua na lista do profissional e na tela da comissão.
import { EVENTOS_AUDITAVEIS, type NovoAviso } from '@sgh/contratos';

/** A forma pública de `ServicoComunicacao.emitir` (módulo acesso), sem acoplar a qualidade ao módulo. */
export interface CentralAvisosQualidade {
  emitir(
    c: { readonly rede: string; readonly hospital: string },
    a: { readonly login: string; readonly estacao: string; readonly correlacao: string },
    novo: NovoAviso,
  ): Promise<number | null>;
}

export const CENTRAL_AVISOS_QUALIDADE = Symbol('CENTRAL_AVISOS_QUALIDADE');

export const LINK_MINHAS_PENDENCIAS = '/qualidade/revisao-prontuarios/minhas-pendencias';
export const TITULO_AVISO_PENDENCIA =
  'A comissão de revisão de prontuários abriu pendência para você: abra Minhas pendências de prontuário.';

/** O aviso ao profissional (puro: testado sem banco). */
export function avisoDePendencia(o: { login: string; prontuario: number; versao: number }): NovoAviso {
  return {
    login: o.login,
    tipo: 'pendencia-prontuario',
    gravidade: 'atencao',
    modulo: 'qualidade',
    evento: EVENTOS_AUDITAVEIS.qualidadeRevisaoPendenciaAvisada.codigo,
    titulo: TITULO_AVISO_PENDENCIA,
    link: LINK_MINHAS_PENDENCIAS,
    objetoTabela: 'revisao_prontuario',
    objetoChave: `${String(o.prontuario)}:${String(o.versao)}`,
  };
}

/** Emite (sem lançar) o aviso; devolve se um aviso novo foi gravado. */
export async function avisarPendenciaNaCentral(
  central: CentralAvisosQualidade | null,
  c: { readonly rede: string; readonly hospital: string },
  autor: { login: string; estacao: string; correlacao: string },
  o: { login: string | null; prontuario: number; versao: number },
): Promise<boolean> {
  if (!central || !o.login) return false;
  try {
    return (
      (await central.emitir(
        c,
        autor,
        avisoDePendencia({ login: o.login, prontuario: o.prontuario, versao: o.versao }),
      )) !== null
    );
  } catch {
    return false;
  }
}
