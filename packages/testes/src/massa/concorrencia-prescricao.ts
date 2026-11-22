// Concorrência na prescrição e na checagem, nos testes de integração (prescrição e enfermagem): a ação feita em
// OUTRA estação (outra conexão) entre a leitura e o "Salvar" da tela, a trava que outra conexão segura sobre a linha
// e a conferência de que a prescrição não lança na conta nem mexe no estoque. Sobre o modelo próprio no MariaDB
// (prescricao, prescricao_item, horario_administracao, conta_hospitalar_item, movimento_estoque). Só números e
// identificadores; nada é impresso. As gravações são massa de teste e rodam na transação do teste (desfeita).
// Substitui as antigas simulações "pelo outro sistema" (sem convivência: a outra estação é o próprio produto).
// A outra estação grava o mesmo estado que o produto deixa (enfermagem.checar-administracao e a suspensão do item):
// a linha com alterado_em/alterado_por e `versao` somada, e o evento do horário (horario_administracao_evento,
// 'checagem' ou 'suspensao'). Não passa pelo Executor (sem trilha nem outbox): é massa de teste dentro da
// transação do teste, que mede o conflito, não a auditoria; por isso os rastros (eventos x administrados) batem.
// Melhoria: a suspensão incompleta é recusada por CHECK do banco (ck_prescricao_10), não por gatilho.
// Melhoria: a ação da outra estação sobe a `versao` da linha, e a trava otimista do produto acusa o conflito.
// Melhoria: as leituras filtram estabelecimento e excluido_em; a trava usa SELECT ... FOR UPDATE do Escritor.
import type { Escritor, Leitor } from '@sgh/nucleo';

type Consulta = Pick<Leitor, 'consultar'>;
const num = (v: unknown): number => Number(v ?? NaN);
const marcas = (ids: readonly number[]) => ids.map(() => '?').join(', ');

// ── Prescrição ─────────────────────────────────────────────────────────────────────────────────────

export interface SuspensaoEmOutraEstacao {
  /** Profissional que suspendeu, na outra estação. */
  readonly profissional: number;
  /** Motivo da suspensão (texto sintético do teste). */
  readonly motivo: string;
  /** Usuário da outra estação (alterado_por e autor do evento); null quando o teste não tem usuário. */
  readonly usuario?: number | null;
}

/**
 * O item suspenso em outra estação, como a suspensão do item pela tela: o item ativo passa a 'suspenso', com o
 * profissional, o motivo, alterado_em/alterado_por e a `versao` somada. Só as doses AINDA PENDENTES (não
 * administradas, não suspensas) são suspensas, cada uma com o evento 'suspensao'; a dose já administrada não muda.
 * Devolve as linhas do item alteradas (0 ou 1); com 0, nenhum horário é tocado.
 */
export async function suspenderItemEmOutraEstacao(
  e: Escritor,
  item: number,
  s: SuspensaoEmOutraEstacao,
): Promise<number> {
  const usuario = s.usuario ?? null;
  const n = await e.executar(
    `UPDATE prescricao_item
        SET situacao = 'suspenso', suspenso_em = NOW(3), suspensao_profissional_id = ?, motivo_suspensao = ?,
            alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
      WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL`,
    [s.profissional, s.motivo, usuario, item],
  );
  if (n !== 1) return n;
  // O evento antes da alteração: o mesmo filtro escolhe as doses pendentes que serão suspensas.
  await e.executar(
    `INSERT INTO horario_administracao_evento
            (horario_administracao_id, operacao, ocorrido_em, usuario_id, evento, profissional_id, motivo,
             canal_registro, criado_em, criado_por)
     SELECT id, 'alteracao', NOW(3), ?, 'suspensao', ?, ?, 'estacao', NOW(3), ?
       FROM horario_administracao
      WHERE prescricao_item_id = ? AND administrado_em IS NULL AND suspenso = FALSE AND excluido_em IS NULL`,
    [usuario, s.profissional, s.motivo, usuario, item],
  );
  await e.executar(
    `UPDATE horario_administracao
        SET suspenso = TRUE, suspenso_em = NOW(3), alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
      WHERE prescricao_item_id = ? AND administrado_em IS NULL AND suspenso = FALSE AND excluido_em IS NULL`,
    [usuario, item],
  );
  return n;
}

/**
 * Suspensão da prescrição pela metade (a situação sem o momento da suspensão): o CHECK ck_prescricao_10 recusa.
 * O teste espera o erro do banco; sem a recusa, a regra se perdeu.
 */
export async function suspensaoIncompleta(e: Escritor, prescricao: number): Promise<number> {
  return e.executar(`UPDATE prescricao SET situacao = 'suspensa', suspensa_em = NULL WHERE id = ?`, [
    prescricao,
  ]);
}

export interface SuspensaoDaPrescricao {
  readonly situacao: string;
  readonly suspensaEm: Date | null;
  readonly motivo: string | null;
}

/** A situação e a suspensão da prescrição (só da prescrição sintética que o teste gravou). */
export async function suspensaoDaPrescricao(
  l: Consulta,
  prescricao: number,
): Promise<SuspensaoDaPrescricao | null> {
  const [x] = await l.consultar<{
    situacao: string;
    suspensa_em: Date | null;
    motivo_suspensao: string | null;
  }>(
    'SELECT situacao, suspensa_em, motivo_suspensao FROM prescricao WHERE id = ? AND excluido_em IS NULL',
    [prescricao],
    { teto: 1 },
  );
  if (!x) return null;
  return {
    situacao: String(x.situacao),
    suspensaEm: x.suspensa_em ?? null,
    motivo: x.motivo_suspensao ?? null,
  };
}

/** Quantas prescrições do atendimento nasceram depois da de origem (a cópia não pode duplicar). */
export async function prescricoesDepoisDe(l: Consulta, atendimento: number, origem: number): Promise<number> {
  const [x] = await l.consultar<{ n: number }>(
    'SELECT COUNT(*) AS n FROM prescricao WHERE atendimento_id = ? AND id > ? AND excluido_em IS NULL',
    [atendimento, origem],
    { teto: 1 },
  );
  return num(x?.n ?? 0);
}

/** Outra conexão segura a prescrição (a tela de edição aberta e gravando em outra estação). */
export async function travarPrescricao(e: Escritor, prescricao: number): Promise<boolean> {
  const r = await e.consultarParaAtualizar('SELECT id FROM prescricao WHERE id = ?', [prescricao], {
    teto: 1,
  });
  return r.length === 1;
}

// ── Conta e estoque (a prescrição não lança na conta nem mexe no estoque) ─────────────────────────

export interface MarcasContaEstoque {
  readonly conta: number;
  readonly movimento: number;
  readonly saldo: string;
}

/** Saldo do mês, por insumo, no estabelecimento: entradas menos saídas da competência corrente. */
async function saldoDoMes(l: Consulta, estabelecimento: number, insumos: readonly number[]): Promise<string> {
  if (insumos.length === 0) return '';
  const ls = await l.consultar<{ insumo_id: number; saldo: string }>(
    `SELECT insumo_id, CAST(SUM(CASE natureza WHEN 'entrada' THEN quantidade_estoque ELSE -quantidade_estoque END)
            AS CHAR) AS saldo
       FROM movimento_estoque
      WHERE estabelecimento_id = ? AND competencia = DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
        AND excluido_em IS NULL AND insumo_id IN (${marcas(insumos)})
      GROUP BY insumo_id ORDER BY insumo_id`,
    [estabelecimento, ...insumos],
    { teto: 200 },
  );
  return ls.map((x) => `${String(x.insumo_id)}:${String(x.saldo)}`).join(';');
}

/**
 * Marca, antes da operação, a maior chave dos itens de conta e dos movimentos de estoque e o saldo do mês dos
 * insumos. Os itens de conta são lidos pela chave da tabela inteira (a conta não guarda o estabelecimento na linha
 * do item; só se compara "nasceu alguma linha depois").
 */
export async function marcasContaEstoque(
  l: Consulta,
  estabelecimento: number,
  insumos: readonly number[],
): Promise<MarcasContaEstoque> {
  const [c] = await l.consultar<{ m: number | null }>('SELECT MAX(id) AS m FROM conta_hospitalar_item', [], {
    teto: 1,
    tempoMaximoMs: 120_000,
  });
  const [s] = await l.consultar<{ m: number | null }>(
    'SELECT MAX(id) AS m FROM movimento_estoque WHERE estabelecimento_id = ?',
    [estabelecimento],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  return {
    conta: num(c?.m ?? 0),
    movimento: num(s?.m ?? 0),
    saldo: await saldoDoMes(l, estabelecimento, insumos),
  };
}

export async function semContaNemEstoque(
  l: Consulta,
  estabelecimento: number,
  antes: MarcasContaEstoque,
  insumos: readonly number[],
): Promise<{ conta: number; movimento: number; saldoIgual: boolean }> {
  const [c] = await l.consultar<{ n: number }>(
    'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE id > ?',
    [antes.conta],
  );
  const [s] = await l.consultar<{ n: number }>(
    'SELECT COUNT(*) AS n FROM movimento_estoque WHERE estabelecimento_id = ? AND id > ?',
    [estabelecimento, antes.movimento],
    { teto: 1 },
  );
  return {
    conta: num(c?.n ?? 0),
    movimento: num(s?.n ?? 0),
    saldoIgual: (await saldoDoMes(l, estabelecimento, insumos)) === antes.saldo,
  };
}

// ── Checagem (horário de administração) ────────────────────────────────────────────────────────────

export interface ChecagemEmOutraEstacao {
  /** Profissional que administrou, na outra estação. */
  readonly profissional: number;
  /** Situação de checagem gravada (id do catálogo situacao_checagem, escolhido pelo teste). */
  readonly situacaoChecagem: number;
  /** Usuário da outra estação (alterado_por e autor do evento); null quando o teste não tem usuário. */
  readonly usuario?: number | null;
}

/**
 * O horário checado em outra estação, entre a leitura e o "Salvar": administrado agora, pelo profissional dado, com
 * alterado_em/alterado_por, a `versao` somada e o evento 'checagem' (como enfermagem.checar-administracao). Só
 * altera o horário ainda não administrado nem suspenso. Devolve as linhas alteradas (0 ou 1).
 */
export async function checarEmOutraEstacao(
  e: Escritor,
  horario: number,
  c: ChecagemEmOutraEstacao,
): Promise<number> {
  const usuario = c.usuario ?? null;
  const n = await e.executar(
    `UPDATE horario_administracao
        SET situacao_checagem_id = ?, situacao_checagem_em = NOW(3), administrado_em = NOW(3),
            administrado_por_profissional_id = ?, alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
      WHERE id = ? AND administrado_em IS NULL AND suspenso = FALSE AND excluido_em IS NULL`,
    [c.situacaoChecagem, c.profissional, usuario, horario],
  );
  if (n !== 1) return n;
  await e.inserir(
    `INSERT INTO horario_administracao_evento
            (horario_administracao_id, operacao, ocorrido_em, usuario_id, evento, situacao_checagem_id,
             profissional_id, canal_registro, criado_em, criado_por)
     VALUES (?, 'alteracao', NOW(3), ?, 'checagem', ?, ?, 'estacao', NOW(3), ?)`,
    [horario, usuario, c.situacaoChecagem, c.profissional, usuario],
  );
  return n;
}

/** Outra conexão segura o horário (a tela de checagem aberta e gravando em outra estação). */
export async function travarHorario(e: Escritor, horario: number): Promise<boolean> {
  const r = await e.consultarParaAtualizar('SELECT id FROM horario_administracao WHERE id = ?', [horario], {
    teto: 1,
  });
  return r.length === 1;
}

export interface HorarioPendente {
  readonly horario: number;
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: number;
}

/**
 * Um horário pendente (não administrado nem suspenso, já vencido) de prescrição vigente, de atendimento sem saída,
 * no estabelecimento. Null quando não há.
 */
export async function horarioPendente(l: Consulta, estabelecimento: number): Promise<HorarioPendente | null> {
  const [x] = await l.consultar<Record<string, unknown>>(
    `SELECT h.id AS horario, h.prescricao_item_id AS item, h.prescricao_id AS prescricao,
            h.atendimento_id AS atendimento, a.paciente_id AS paciente
       FROM horario_administracao h
       JOIN prescricao p ON p.id = h.prescricao_id
       JOIN atendimento a ON a.id = h.atendimento_id
      WHERE h.estabelecimento_id = ? AND h.administrado_em IS NULL AND h.suspenso = FALSE
        AND h.excluido_em IS NULL AND h.previsto_em < NOW(3)
        AND p.situacao = 'vigente' AND p.excluido_em IS NULL
        AND a.saida_em IS NULL AND a.excluido_em IS NULL
      ORDER BY h.previsto_em DESC LIMIT 1`,
    [estabelecimento],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) return null;
  return {
    horario: num(x['horario']),
    item: num(x['item']),
    prescricao: num(x['prescricao']),
    atendimento: num(x['atendimento']),
    paciente: num(x['paciente']),
  };
}

/**
 * O rastro da checagem dos horários (só contagens): os eventos do horário e os horários já administrados. Igual
 * antes e depois = nada gravado.
 */
export async function rastroDosHorarios(l: Consulta, ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return [0, 0];
  const [ev] = await l.consultar<{ n: number }>(
    `SELECT COUNT(*) AS n FROM horario_administracao_evento WHERE horario_administracao_id IN (${marcas(ids)})`,
    [...ids],
    { teto: 1 },
  );
  const [ad] = await l.consultar<{ n: number }>(
    `SELECT COUNT(*) AS n FROM horario_administracao WHERE id IN (${marcas(ids)}) AND administrado_em IS NOT NULL`,
    [...ids],
    { teto: 1 },
  );
  return [num(ev?.n ?? 0), num(ad?.n ?? 0)];
}
