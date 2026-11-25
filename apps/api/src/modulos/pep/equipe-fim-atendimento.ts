// Equipe assistencial no fim do atendimento (03-PEP L94): a alta da internação e o encerramento do atendimento
// encerram a equipe NA MESMA TRANSAÇÃO (os membros vigentes saem com o motivo "Fim do atendimento"; nada é apagado),
// e o cancelamento da alta a reabre (quem saiu junto volta como participação nova; a antiga fica no histórico).
// Usado pela internação (dar e cancelar alta) e pelo atendimento (encerrar), que declaram as duas tabelas abaixo.
import {
  MOTIVO_FIM_DO_ATENDIMENTO,
  type MembroEquipe,
  planoEncerramentoEquipe,
  planoReaberturaEquipe,
} from '@sgh/dominio-pep';
import type { TxOperacao } from '@sgh/nucleo';

export const TABELAS_EQUIPE_ATENDIMENTO = ['equipe_assistencial_paciente', 'equipe_assistencial_membro'];

type TxEquipe = Pick<TxOperacao, 'uma' | 'consultarParaAtualizar' | 'alterar' | 'incluir'>;

const SQL_EQUIPE = `SELECT id, situacao, fim_em, versao FROM equipe_assistencial_paciente
  WHERE atendimento_id = ? AND excluido_em IS NULL`;
const SQL_MEMBROS = `SELECT id, profissional_id, funcao_equipe_assistencial_id, especialidade_medica_id,
         responsavel_principal, recebe_notificacao, inicio_em, fim_em, motivo_saida, versao
    FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ? AND excluido_em IS NULL
   ORDER BY sequencia`;

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function membroDaLinha(
  x: Record<string, unknown>,
): MembroEquipe & { motivoSaida: string | null; versao: number } {
  return {
    id: Number(x['id']),
    profissional: Number(x['profissional_id']),
    funcao: Number(x['funcao_equipe_assistencial_id']),
    responsavelPrincipal: Boolean(Number(x['responsavel_principal'])),
    recebeNotificacao: Boolean(Number(x['recebe_notificacao'])),
    inicio: iso(x['inicio_em']) ?? '',
    fim: iso(x['fim_em']),
    motivoSaida:
      x['motivo_saida'] === null || x['motivo_saida'] === undefined ? null : String(x['motivo_saida']),
    versao: Number(x['versao']),
  };
}

/** Fim do atendimento: encerra a equipe vigente e fecha os membros vigentes. Sem equipe (ou já encerrada): nada. */
export async function encerrarEquipeNoFimDoAtendimento(
  tx: TxEquipe,
  atendimento: number,
  agora: Date,
): Promise<{ equipe: number | null; membros: number }> {
  const e = (await tx.consultarParaAtualizar(SQL_EQUIPE, [atendimento]))[0];
  if (!e) return { equipe: null, membros: 0 };
  const membros = (await tx.consultarParaAtualizar(SQL_MEMBROS, [e['id']])).map(membroDaLinha);
  const plano = planoEncerramentoEquipe(String(e['situacao']), membros);
  if (plano.erros.length) return { equipe: Number(e['id']), membros: 0 };
  for (const id of plano.membrosAEncerrar) {
    const m = membros.find((x) => x.id === id)!;
    await tx.alterar('equipe_assistencial_membro', id, m.versao, {
      fim_em: agora,
      motivo_saida: MOTIVO_FIM_DO_ATENDIMENTO,
    });
  }
  await tx.alterar('equipe_assistencial_paciente', Number(e['id']), Number(e['versao']), {
    situacao: 'encerrada',
    fim_em: agora,
  });
  return { equipe: Number(e['id']), membros: plano.membrosAEncerrar.length };
}

/** Cancelamento da alta: a equipe volta a valer e quem saiu junto com o fim volta como participação nova. */
export async function reabrirEquipeDoAtendimento(
  tx: TxEquipe,
  atendimento: number,
  agora: Date,
): Promise<{ equipe: number | null; membros: number }> {
  const e = (await tx.consultarParaAtualizar(SQL_EQUIPE, [atendimento]))[0];
  if (!e) return { equipe: null, membros: 0 };
  const linhas = await tx.consultarParaAtualizar(SQL_MEMBROS, [e['id']]);
  const membros = linhas.map(membroDaLinha);
  const plano = planoReaberturaEquipe(String(e['situacao']), iso(e['fim_em']), membros);
  if (!plano.reabrir) return { equipe: Number(e['id']), membros: 0 };
  await tx.alterar('equipe_assistencial_paciente', Number(e['id']), Number(e['versao']), {
    situacao: 'ativa',
    fim_em: null,
  });
  const seq = await tx.uma(
    'SELECT COALESCE(MAX(sequencia), 0) AS s FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ?',
    [e['id']],
  );
  let sequencia = Number(seq?.['s'] ?? 0);
  for (const id of plano.membrosAVoltar) {
    const x = linhas.find((l) => Number(l['id']) === id)!;
    sequencia += 1;
    await tx.incluir('equipe_assistencial_membro', {
      equipe_assistencial_paciente_id: Number(e['id']),
      sequencia,
      profissional_id: Number(x['profissional_id']),
      funcao_equipe_assistencial_id: Number(x['funcao_equipe_assistencial_id']),
      especialidade_medica_id: x['especialidade_medica_id'] ?? null,
      responsavel_principal: Boolean(Number(x['responsavel_principal'])),
      recebe_notificacao: Boolean(Number(x['recebe_notificacao'])),
      inicio_em: agora,
    });
  }
  return { equipe: Number(e['id']), membros: plano.membrosAVoltar.length };
}
