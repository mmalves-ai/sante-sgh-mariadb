// 02-AGE 48: o grupo de prioridade legal do pedido da lista de espera, pela MESMA regra da marcação e da senha
// (`prioridadeNaMarcacao`, do domínio): o grupo informado, os vigentes do cadastro do paciente e o da idade, na data
// da inclusão. Lê dentro da transação da gravação; o grupo informado inexistente ou inativo é recusado sem gravar.
import {
  type GrupoPrioridadeCadastro,
  grupoLegalVigenteNaEspera,
  prioridadeNaMarcacao,
} from '@sgh/dominio-agenda';
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

type Leitor = Pick<TxOperacao, 'consultar'>;

const grupoDe = (g: Record<string, unknown>): GrupoPrioridadeCadastro => ({
  id: n(g['id']),
  descricao: String(g['descricao']),
  ativo: Boolean(Number(g['ativo'])),
  peso: n(g['peso']),
  idadeMinima: nOuNulo(g['idade_minima']),
});
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/**
 * 02-AGE 48 (correção): o grupo legal VIGENTE de cada pedido na data (leitura ou oferta), pela regra do domínio
 * `grupoLegalVigenteNaEspera`: o grupo informado na inclusão (do histórico de entrada; o pedido anterior a esse
 * registro usa o grupo gravado), o cadastro do paciente vigente na data e a idade na data. Devolve o grupo com a
 * descrição e o peso, ou nulo.
 */
export async function gruposVigentesDaEspera(
  l: Leitor,
  itens: readonly { readonly id: number; readonly paciente: number; readonly grupoGravado: number | null }[],
  data: string,
): Promise<Map<number, { id: number; descricao: string; peso: number } | null>> {
  const r = new Map<number, { id: number; descricao: string; peso: number } | null>();
  if (!itens.length) return r;
  const grupos = (
    await l.consultar('SELECT id, descricao, ativo, peso, idade_minima FROM grupo_prioridade_legal')
  ).map(grupoDe);
  const pacs = [...new Set(itens.map((i) => i.paciente))];
  const cad = await l.consultar(
    `SELECT paciente_id, grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim FROM paciente_prioridade_legal
      WHERE excluido_em IS NULL AND paciente_id IN (${marcas(pacs.length)})`,
    pacs,
  );
  const nasc = await l.consultar(
    `SELECT p.id, pf.data_nascimento FROM paciente p LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id IN (${marcas(pacs.length)})`,
    pacs,
  );
  const ids = itens.map((i) => i.id);
  const ent = await l.consultar(
    `SELECT lista_espera_id, dados FROM lista_espera_historico
      WHERE evento = 'entrada' AND lista_espera_id IN (${marcas(ids.length)})`,
    ids,
  );
  const informada = new Map<number, number | null>();
  for (const h of ent) {
    const d = (typeof h['dados'] === 'string' ? JSON.parse(h['dados']) : (h['dados'] ?? {})) as Record<
      string,
      unknown
    >;
    if ('informada' in d) informada.set(n(h['lista_espera_id']), nOuNulo(d['informada']));
  }
  const nascDe = new Map(nasc.map((x) => [n(x['id']), dia(x['data_nascimento'])]));
  for (const i of itens) {
    const g = grupoLegalVigenteNaEspera(grupos, {
      informada: informada.has(i.id) ? (informada.get(i.id) ?? null) : i.grupoGravado,
      doPaciente: cad
        .filter((x) => n(x['paciente_id']) === i.paciente)
        .map((x) => ({
          grupo: n(x['grupo_prioridade_legal_id']),
          vigenciaInicio: dia(x['vigencia_inicio']) ?? '',
          vigenciaFim: dia(x['vigencia_fim']),
        })),
      nascimento: nascDe.get(i.paciente) ?? null,
      data,
    });
    const gg = g === null ? undefined : grupos.find((x) => x.id === g);
    r.set(i.id, gg ? { id: gg.id, descricao: gg.descricao, peso: gg.peso } : null);
  }
  return r;
}
