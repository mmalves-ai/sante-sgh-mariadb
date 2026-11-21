// Regras de integridade que o sistema de origem guardava em gatilhos e travas, agora no próprio modelo (ADR 0002,
// regra de ouro 2): CHECK e UNIQUE nas tabelas do faturamento, do portal, do atendimento e da internação, e nenhum
// gatilho no banco do cliente. Roda no MariaDB real (cliente f22_o5); toda tentativa de gravação fica em transação
// DESFEITA, e nada sobra no banco. A saída só tem nomes de restrição e contagens, sem nenhum dado de pessoa.
// Substitui os specs m14 a m43, que testavam a cópia do sistema de origem (lote 05-02; o mapa de cobertura está em
// docs/obra/fatias/f22/saida/05-02.json).
// Melhoria: o valor negativo, a faixa de horário invertida, a vigência invertida, a retirada sem data e a glosa maior
// que o apresentado são recusados pelo banco com o nome da regra, e não por um gatilho escondido.
// Melhoria: a numeração do protocolo do lote recebido e o par conta × atendimento são únicos por chave do banco, e não
// por releitura sob trava. Cada UNIQUE é provada de dois jeitos: as colunas da chave (KEY_COLUMN_USAGE) e a segunda
// linha igual recusada com o nome da chave (chaves estrangeiras desligadas só nessa transação desfeita).
// Melhoria: a mesma conta sem guia no mesmo lote TISS é recusada por uq_lote_tiss_conta_conta_sem_guia (coluna gerada
// conta_sem_guia_id, 12_FAT/11), porque a UNIQUE com a guia anulável não compara NULL com NULL.
// Este arquivo prova só a última barreira (o banco). A recusa antes do banco, com mensagem de negócio, fica na porta
// dona: glosa maior e devolução em apps/api/src/modulos/operadora/contas-porta-propria.int.spec.ts ('glosa-maior');
// faixa de horário, vigência do dependente e retirada do portal ainda não têm operação que grave essas tabelas
// (pedidos 'cobertura-a-conferir' do 05-02 para agenda/config e portal-paciente).
import type { Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, desfeito, prepararAmbiente, SEM_BANCO } from './escrita.spec-util.js';

/** Restrições CHECK que substituem as recusas dos gatilhos antigos, por tabela. */
const CHECKS: Readonly<Record<string, readonly string[]>> = {
  lote_conta_recebida: [
    'ck_lote_conta_recebida_valores',
    'ck_lote_conta_recebida_devolucao',
    'ck_lote_conta_recebida_competencia',
  ],
  lote_tiss_conta: ['ck_lote_tiss_conta_valor'],
  liberacao_resultado_portal: [
    'ck_liberacao_resultado_portal_retirada',
    'ck_liberacao_resultado_portal_periodo',
    'ck_liberacao_resultado_portal_situacao',
  ],
  local_atendimento_horario: ['ck_local_atendimento_horario_faixa', 'ck_local_atendimento_horario_dia'],
  conta_portal_paciente_dependente: ['ck_conta_portal_paciente_dependente_vigencia'],
  conta_portal_paciente: ['ck_conta_portal_paciente_situacao', 'ck_conta_portal_paciente_segundo_fator'],
};

/** Chaves únicas que substituem a releitura sob trava (numeração, par, sequência), com as colunas em ordem. */
const UNICAS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  lote_conta_recebida: {
    uq_lote_conta_recebida_estabelecimento_id_numero_protocolo: ['estabelecimento_id', 'numero_protocolo'],
  },
  lote_tiss_conta: {
    uq_lote_tiss_conta_conta_guia: ['lote_tiss_id', 'conta_hospitalar_id', 'guia_tiss_id'],
    uq_lote_tiss_conta_conta_sem_guia: ['lote_tiss_id', 'conta_sem_guia_id'],
  },
  item_lista_trabalho_imagem: { uq_item_lista_trabalho_imagem_exame_vigente: ['exame_item_vigente_id'] },
  atendimento_conta: { uq_atendimento_conta_par: ['atendimento_id', 'conta_hospitalar_id'] },
  usuario_local_atendimento: { uq_usuario_local_atendimento_par: ['usuario_id', 'local_atendimento_id'] },
  painel_resultado_grupo_exame: { uq_painel_resultado_grupo_exame_sequencia: ['painel_resultado_grupo_id', 'sequencia'] },
  conta_portal_paciente: { uq_conta_portal_paciente_paciente: ['paciente_id'] },
};

/** Texto completo de uma recusa (mensagem, problema e causa), para achar o nome da restrição. */
function textoDe(x: unknown): string {
  if (!(x instanceof Error)) return String(x);
  const extra = x as Error & { problema?: unknown; cause?: unknown };
  return [x.message, JSON.stringify(extra.problema ?? null), extra.cause ? textoDe(extra.cause) : ''].join(' | ');
}

/**
 * Tenta gravar uma linha que viola uma CHECK, dentro de uma transação desfeita, e devolve o texto da recusa. O id de
 * pai inexistente (0) não chega a pesar: o MariaDB confere a CHECK antes da chave estrangeira.
 */
async function recusaDe(a: Ambiente, sql: string, p: readonly unknown[]): Promise<string> {
  try {
    await desfeito(a, (e: Escritor) => e.inserir(sql, p));
  } catch (x) {
    return textoDe(x);
  }
  return 'gravou';
}

/**
 * Grava a primeira linha e tenta a segunda igual na mesma transação desfeita, com as chaves estrangeiras desligadas só
 * nela (os ids de pai são sintéticos). Devolve o texto da recusa da segunda, ou 'gravou'. Recusa na primeira é erro.
 */
async function duplicadaDe(a: Ambiente, sql: string, p1: readonly unknown[], p2: readonly unknown[]): Promise<string> {
  try {
    return await desfeito(a, async (e: Escritor) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await e.inserir(sql, p1);
        try {
          await e.inserir(sql, p2);
        } catch (x) {
          return textoDe(x);
        }
        return 'gravou';
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  } catch (x) {
    return `primeira recusada: ${textoDe(x)}`;
  }
}

/** Sufixo sintético para os textos únicos da rodada (nada de dado real). */
const RODADA = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(-10).toUpperCase();

describe.skipIf(SEM_BANCO)('regras de integridade no modelo (cliente f22_o5, transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const ler = <T>(fn: Parameters<Ambiente['nucleo']['lerSomente']>[1]) =>
    a.nucleo.lerSomente({ cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5'), correlacao: 'int-regras-banco' }, fn) as Promise<T>;

  it('as CHECK e as UNIQUE que substituem os gatilhos existem no banco do cliente', async () => {
    const faltam: string[] = [];
    await ler(async (l) => {
      for (const [tabela, nomes] of Object.entries(CHECKS)) {
        for (const nome of nomes) {
          const n = await contar(
            l,
            `SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
            [tabela, nome],
          );
          if (n !== 1) faltam.push(`${tabela}.${nome}`);
        }
      }
      for (const [tabela, chaves] of Object.entries(UNICAS)) {
        for (const nome of Object.keys(chaves)) {
          const n = await contar(
            l,
            `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'UNIQUE'`,
            [tabela, nome],
          );
          if (n !== 1) faltam.push(`${tabela}.${nome}`);
        }
      }
      return null;
    });
    expect(faltam).toEqual([]);
  });

  it('nenhum gatilho no banco do cliente (a regra de negócio fica no domínio)', async () => {
    const n = await ler<number>((l) =>
      contar(l, 'SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()'),
    );
    expect(n).toBe(0);
  });

  it('faixa de horário invertida e dia da semana fora de 1 a 7 são recusados pelo banco', async () => {
    const sql = `INSERT INTO local_atendimento_horario
        (local_atendimento_id, dia_semana, dia_nao_util, hora_inicio, hora_fim, criado_em)
      VALUES (0, ?, FALSE, ?, ?, NOW(3))`;
    expect(await recusaDe(a, sql, [2, '18:00:00', '08:00:00'])).toContain('ck_local_atendimento_horario_faixa');
    expect(await recusaDe(a, sql, [9, '08:00:00', '18:00:00'])).toContain('ck_local_atendimento_horario_dia');
  });

  it('valor negativo de conta no lote TISS é recusado pelo banco', async () => {
    const t = await recusaDe(
      a,
      `INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, valor, criado_em) VALUES (0, 0, ?, NOW(3))`,
      [-1],
    );
    expect(t).toContain('ck_lote_tiss_conta_valor');
  });

  it('lote recebido com glosa maior que o apresentado e devolução sem motivo são recusados pelo banco', async () => {
    const sql = `INSERT INTO lote_conta_recebida
        (estabelecimento_id, operadora_saude_id, prestador_rede_id, numero_protocolo, numero_lote_prestador, tipo_guia,
         competencia, canal_envio, valor_apresentado, valor_glosado, recebido_em, situacao, motivo_devolucao, criado_em)
      VALUES (?, 0, 0, 'INT-REGRA-1', 'INT-REGRA-1', 'consulta', '2099-01-01', 'portal', ?, ?, NOW(3), ?, NULL, NOW(3))`;
    expect(await recusaDe(a, sql, [a.estabelecimento, 10, 20, 'recebida'])).toContain(
      'ck_lote_conta_recebida_valores',
    );
    expect(await recusaDe(a, sql, [a.estabelecimento, 10, 0, 'devolvida'])).toContain(
      'ck_lote_conta_recebida_devolucao',
    );
  });

  it('resultado retirado do portal sem a data da retirada é recusado pelo banco', async () => {
    const t = await recusaDe(
      a,
      `INSERT INTO liberacao_resultado_portal
          (estabelecimento_id, resultado_exame_id, paciente_id, liberado_em, situacao, retirado_em, criado_em)
        VALUES (?, 0, 0, NOW(3), 'retirado', NULL, NOW(3))`,
      [a.estabelecimento],
    );
    expect(t).toContain('ck_liberacao_resultado_portal_retirada');
  });

  it('cada UNIQUE tem exatamente as colunas da regra, na ordem', async () => {
    const erradas: string[] = [];
    await ler(async (l) => {
      for (const [tabela, chaves] of Object.entries(UNICAS)) {
        for (const [nome, colunas] of Object.entries(chaves)) {
          const r = await l.consultar<{ coluna: string }>(
            `SELECT COLUMN_NAME AS coluna FROM information_schema.KEY_COLUMN_USAGE
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
              ORDER BY ORDINAL_POSITION`,
            [tabela, nome],
          );
          const lidas = r.map((x) => String(x.coluna));
          if (lidas.join(',') !== colunas.join(',')) erradas.push(`${nome}: ${lidas.join(',')}`);
        }
      }
      return null;
    });
    expect(erradas).toEqual([]);
  });

  it('protocolo do lote recebido repetido no mesmo estabelecimento é recusado pela chave', async () => {
    const sql = `INSERT INTO lote_conta_recebida
        (estabelecimento_id, operadora_saude_id, prestador_rede_id, numero_protocolo, numero_lote_prestador, tipo_guia,
         competencia, canal_envio, valor_apresentado, valor_glosado, recebido_em, situacao, criado_em)
      VALUES (?, 0, 0, ?, ?, 'consulta', '2099-01-01', 'portal', 10, 0, NOW(3), 'recebida', NOW(3))`;
    const prot = `UQ${RODADA}`;
    expect(await duplicadaDe(a, sql, [a.estabelecimento, prot, 'L1'], [a.estabelecimento, prot, 'L2'])).toContain(
      'uq_lote_conta_recebida_estabelecimento_id_numero_protocolo',
    );
  });

  it('a mesma conta e guia no mesmo lote TISS é recusada pela chave, também com a guia nula', async () => {
    const sql = `INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, guia_tiss_id, valor, criado_em)
      VALUES (0, 0, ?, 1, NOW(3))`;
    expect(await duplicadaDe(a, sql, [0], [0])).toContain('uq_lote_tiss_conta_conta_guia');
    // NULL não é igual a NULL na UNIQUE do MariaDB: a conta sem guia é barrada pela chave da coluna gerada.
    expect(await duplicadaDe(a, sql, [null], [null])).toContain('uq_lote_tiss_conta_conta_sem_guia');
  });

  it('o par conta × atendimento, o par usuário × local e a sequência do grupo do painel são recusados pela chave', async () => {
    expect(
      await duplicadaDe(
        a,
        'INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em) VALUES (0, 0, NOW(3))',
        [],
        [],
      ),
    ).toContain('uq_atendimento_conta_par');
    expect(
      await duplicadaDe(
        a,
        'INSERT INTO usuario_local_atendimento (usuario_id, local_atendimento_id, criado_em) VALUES (0, 0, NOW(3))',
        [],
        [],
      ),
    ).toContain('uq_usuario_local_atendimento_par');
    // Mesma sequência no grupo com outro exame: quem recusa é a chave da sequência, não a do exame.
    expect(
      await duplicadaDe(
        a,
        `INSERT INTO painel_resultado_grupo_exame (painel_resultado_grupo_id, sequencia, exame_id, criado_em)
          VALUES (0, 1, ?, NOW(3))`,
        [0],
        [1],
      ),
    ).toContain('uq_painel_resultado_grupo_exame_sequencia');
  });

  it('segunda conta do portal para o mesmo paciente é recusada pela chave', async () => {
    const sql = `INSERT INTO conta_portal_paciente (paciente_id, login, email, criado_em)
      VALUES (0, ?, ?, NOW(3))`;
    const l1 = `uq1-${RODADA}@exemplo.invalid`.toLowerCase();
    const l2 = `uq2-${RODADA}@exemplo.invalid`.toLowerCase();
    expect(await duplicadaDe(a, sql, [l1, l1], [l2, l2])).toContain('uq_conta_portal_paciente_paciente');
  });

  it('dependente do portal com vigência terminando antes do início é recusado pelo banco', async () => {
    const t = await recusaDe(
      a,
      `INSERT INTO conta_portal_paciente_dependente
          (conta_portal_paciente_id, paciente_id, vigencia_inicio, vigencia_fim, criado_em)
        VALUES (0, 0, '2099-02-01', '2099-01-01', NOW(3))`,
      [],
    );
    expect(t).toContain('ck_conta_portal_paciente_dependente_vigencia');
  });
});
