// O "outro sistema" nos testes de integração da enfermagem (M25; ficha, seção 10), por SQL de teste na transação
// desfeita: a checagem feita em outro terminal entre a leitura e o "Salvar", a trava de outra conexão sobre o horário
// e um horário pendente já gravado na cópia (para a disputa entre duas conexões). Só números; nada é impresso.
import type { Escritor, Leitor } from '@sgh/legado';

const num = (v: unknown): number => Number(v ?? NaN);

/** O horário checado "no outro sistema" (a mudança de situação, como o executável a grava no horário). */
export async function checarComoOLegado(e: Escritor, horario: number): Promise<number> {
  return e.executar(
    `UPDATE PRCHKGERAL SET SITUACAO_CHECAGEM = 'A', DATA_HORA_SITUACAO_CHECAGEM = CURRENT_TIMESTAMP
      WHERE ID = ? AND SITUACAO_CHECAGEM = 'P'`,
    [horario],
  );
}

/** Outra conexão segura o horário (o outro sistema com a tela de checagem aberta e gravando). */
export async function travarHorarioComoOLegado(e: Escritor, horario: number): Promise<void> {
  await e.consultar('SELECT ID FROM PRCHKGERAL WHERE ID = ? WITH LOCK', [horario], { teto: 1 });
}

export interface HorarioPendenteDaCopia {
  readonly horario: number;
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: number;
}

/** Um horário pendente ("P") de prescrição vigente, não suspensa, de atendimento aberto (gravado na cópia). */
export async function horarioPendenteDaCopia(
  l: Pick<Leitor, 'consultar'>,
): Promise<HorarioPendenteDaCopia | null> {
  const ls = await l.consultar(
    `SELECT FIRST 1 c.ID H, c.ID_PRLANGERAL I, x.ID_PRPRESC P, p.ID_ATCABECATEND_INTEGRACAO A, a.ID_RICADPAC R
       FROM PRCHKGERAL c
       JOIN PRLANGERAL x ON x.ID = c.ID_PRLANGERAL
       JOIN PRPRESC p ON p.ID = x.ID_PRPRESC
       JOIN ATCABECATEND a ON a.ID = p.ID_ATCABECATEND_INTEGRACAO
      WHERE c.DATA_HORA_CHECAR >= DATEADD(-200 DAY TO CURRENT_DATE) AND c.DATA_HORA_CHECAR < CURRENT_DATE AND c.SITUACAO_CHECAGEM = 'P'
        AND p.DATA_HORA_SUSPENSAO IS NULL AND a.DATA_HORA_SAIDA_EFETIVA IS NULL AND c.ID_PRITENSGLICEMIA IS NULL`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  const x = ls[0];
  if (!x) return null;
  return {
    horario: num(x['H']),
    item: num(x['I']),
    prescricao: num(x['P']),
    atendimento: num(x['A']),
    paciente: num(x['R']),
  };
}

/**
 * O rastro da checagem dos horários (só contagens, pelos índices de cada tabela): o histórico, o extrato, o vínculo
 * com o documento e o registro do novo. Igual antes e depois = nada gravado.
 */
export async function rastroDosHorarios(
  e: Pick<Leitor, 'consultar'>,
  ids: readonly number[],
): Promise<number[]> {
  const marcas = ids.map(() => '?').join(', ');
  const r: number[] = [];
  for (const t of [
    'HTCHKGERAL',
    'PREXTRATOITEM_PRCHKGERAL',
    'PRASSINAT_DOC_PRCHKGERAL',
    'SGH_PEP_CHECAGEM_EXT',
  ]) {
    const [x] = await e.consultar(
      `SELECT COUNT(*) N FROM ${t} WHERE ID_PRCHKGERAL IN (${marcas})`,
      [...ids],
      { teto: 1 },
    );
    r.push(num(x?.['N']));
  }
  const [s] = await e.consultar(
    `SELECT COUNT(*) N FROM PRCHKGERAL WHERE ID IN (${marcas}) AND SITUACAO_CHECAGEM IN ('A', 'N')`,
    [...ids],
    { teto: 1 },
  );
  r.push(num(s?.['N']));
  return r;
}
