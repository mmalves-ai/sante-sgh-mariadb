// 02-AGE 48: o grupo de prioridade legal do pedido da lista de espera, pela MESMA regra da marcação e da senha
// (`prioridadeNaMarcacao`, do domínio): o grupo informado, os vigentes do cadastro do paciente e o da idade, na data
// da inclusão. Lê dentro da transação da gravação; o grupo informado inexistente ou inativo é recusado sem gravar.
import { prioridadeNaMarcacao } from '@sgh/dominio-agenda';
import { recusa, type TxOperacao } from '@sgh/nucleo';

const n = (v: unknown): number => Number(v);
const nOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

/** O grupo legal do pedido (nulo: sem prioridade legal). */
export async function grupoLegalDaEspera(
  tx: TxOperacao,
  e: { readonly paciente: number; readonly informada: number | null; readonly data: string },
): Promise<number | null> {
  // O grupo não tem exclusão lógica (só `ativo`, que a regra do domínio confere).
  const grupos = await tx.consultar(
    'SELECT id, descricao, ativo, peso, idade_minima FROM grupo_prioridade_legal',
  );
  const doPaciente = await tx.consultar(
    `SELECT grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim FROM paciente_prioridade_legal
      WHERE paciente_id = ? AND excluido_em IS NULL`,
    [e.paciente],
  );
  const pac = await tx.uma(
    `SELECT pf.data_nascimento FROM paciente p LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL`,
    [e.paciente],
  );
  if (!pac) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
  const r = prioridadeNaMarcacao(
    grupos.map((g) => ({
      id: n(g['id']),
      descricao: String(g['descricao']),
      ativo: Boolean(Number(g['ativo'])),
      peso: n(g['peso']),
      idadeMinima: nOuNulo(g['idade_minima']),
    })),
    {
      informada: e.informada,
      doPaciente: doPaciente.map((x) => ({
        grupo: n(x['grupo_prioridade_legal_id']),
        vigenciaInicio: dia(x['vigencia_inicio']) ?? '',
        vigenciaFim: dia(x['vigencia_fim']),
      })),
      nascimento: dia(pac['data_nascimento']),
      data: e.data,
    },
  );
  if (!r.ok) throw recusa(r.codigo, r.motivo, { campos: ['prioridadeLegal'] });
  return r.grupo;
}
