// O aviso do valor crítico na central de avisos do Início (M27; ficha do M26, regra 7: "aviso ativo ao médico
// responsável"; ficha do M27, regra 6: o que não interrompe vai para a central). Depois do COMMIT da liberação (pelo
// novo) ou do ciclo da vigia (liberação feita no outro sistema), o médico do atendimento recebe um item no sino, com
// o link para os resultados do paciente (que abre pela autorização normal do PEP). O título não leva dado do paciente.
// Um aviso por exame e liberação (a central não repete o mesmo evento e objeto). Falha aqui não desfaz a liberação:
// o aviso continua no painel do setor e na fila do médico.
import { EVENTOS_AUDITAVEIS, type NovoAviso } from '@sgh/contratos';
import type { ContextoSadt, PortaSadt } from '../porta.js';

/** A forma pública de `ServicoComunicacao.emitir` (módulo acesso), sem acoplar o SADT ao módulo. */
export interface CentralDeAvisos {
  emitir(
    c: { readonly rede: string; readonly hospital: string },
    a: { readonly login: string; readonly estacao: string; readonly correlacao: string },
    novo: NovoAviso,
  ): Promise<number | null>;
}

/** Injeção da central de avisos no SADT (o `ServicoComunicacao` do módulo acesso, com o canal do sino). */
export const CENTRAL_AVISOS_SADT = Symbol('CENTRAL_AVISOS_SADT');

export const TIPO_AVISO_CRITICO = 'resultado-critico';
export const TITULO_AVISO_CRITICO =
  'Resultado com valor crítico liberado: abra os resultados e registre a ciência.';

/** O aviso para o médico do atendimento (puro: testado sem banco). */
export function avisoDoCritico(o: {
  login: string;
  exame: number;
  liberacao: number | null;
  paciente: number;
}): NovoAviso {
  return {
    login: o.login,
    tipo: TIPO_AVISO_CRITICO,
    gravidade: 'atencao',
    modulo: 'sadt',
    evento: EVENTOS_AUDITAVEIS.sadtAvisoCriticoEmitido.codigo,
    titulo: TITULO_AVISO_CRITICO,
    link: `/pep/paciente/${o.paciente}/resultados`,
    objetoTabela: 'SILANEXA',
    objetoChave: (o.liberacao ? `${o.exame}:${o.liberacao}` : String(o.exame)).slice(0, 80),
  };
}

/** Emite (sem lançar) o aviso do crítico ao médico do atendimento; devolve se um aviso novo foi gravado. */
export async function avisarCriticoNaCentral(
  central: CentralDeAvisos | null,
  porta: PortaSadt,
  c: ContextoSadt,
  autor: { login: string; estacao: string; correlacao: string },
  x: { exame: number; liberacao: number | null; paciente: number | null; atendimento: number | null },
): Promise<boolean> {
  if (!central || !x.paciente || !x.atendimento) return false;
  try {
    const login = await porta.responsavelDoAtendimento(c, x.atendimento);
    if (!login) return false;
    const id = await central.emitir(
      { rede: c.rede, hospital: c.hospital },
      autor,
      avisoDoCritico({ login, exame: x.exame, liberacao: x.liberacao, paciente: x.paciente }),
    );
    return id !== null;
  } catch {
    return false;
  }
}
