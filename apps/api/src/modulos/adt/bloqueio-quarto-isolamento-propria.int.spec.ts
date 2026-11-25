// Contrato de efeito da C1-065 (04-INT linha 75) contra o MariaDB real (cliente de teste), num estabelecimento SINTÉTICO:
// a auditoria do isolamento com critério "bloquear" não conforme bloqueia o quarto até a CCIH (comissão de controle de
// infecção hospitalar) resolver o aviso. Prova o que fica no banco:
//   - o leito vizinho livre ganha período aberto de bloqueio (situação "bloqueado", motivo "isolamento", ligado à
//     precaução e, no retrato, à auditoria) e a situação atual do leito vira "bloqueado";
//   - o leito do paciente isolado não é bloqueado (o atendimento dele segue); o ocupado por outro paciente não é
//     bloqueado e volta listado para a CCIH; o leito com estado aberto e o de outro quarto ficam como estão;
//   - a lista de avisos da CCIH mostra os leitos bloqueados;
//   - resolver o aviso encerra o período (fica no histórico, nunca apagado) e o leito volta a "livre";
//   - cancelar a auditoria também libera o quarto; o critério "alertar" sozinho não bloqueia.
// A internação e o paciente são ids já existentes do cliente (só lidos); o resto é massa sintética apagada no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaControlesAssistenciaisPropria } from './controles-assistenciais-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c1065';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  isolamento: number;
  leitos: Record<'A' | 'B' | 'C' | 'D' | 'E', number>;
  situacao: { livre: number; bloqueado: number };
  criados: { motivo: boolean };
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) {
  const l = await e.uma<{ id: number }>(sel, p);
  return { id: l ? Number(l.id) : await e.inserir(ins, pi), criado: !l };
}

async function limpar(e: Escritor, motivoCriado = false): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const auds = `(SELECT a.id FROM auditoria_isolamento a JOIN isolamento_paciente i ON i.id = a.isolamento_paciente_id WHERE i.estabelecimento_id IN ${est})`;
    await e.executar(`DELETE FROM auditoria_isolamento_item WHERE auditoria_isolamento_id IN ${auds}`, [P]);
    await e.executar(
      `DELETE FROM auditoria_isolamento WHERE isolamento_paciente_id IN (SELECT id FROM isolamento_paciente WHERE estabelecimento_id IN ${est})`,
      [P],
    );
    await e.executar(
      'DELETE FROM criterio_auditoria_isolamento WHERE tipo_precaucao_id IN (SELECT id FROM tipo_precaucao WHERE codigo = ?)',
      [P],
    );
    await e.executar(
      `DELETE FROM periodo_situacao_leito WHERE leito_hospitalar_id IN (SELECT id FROM leito_hospitalar WHERE estabelecimento_id IN ${est})`,
      [P],
    );
    for (const t of [
      'aviso_clinico',
      'isolamento_paciente',
      'ocupacao_leito',
      'leito_hospitalar',
      'acomodacao',
      'unidade_internacao',
      'bloco_internacao',
      'unidade_assistencial',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM tipo_precaucao WHERE codigo = ?', [P]);
    await e.executar('DELETE FROM categoria_acomodacao WHERE codigo = ?', [P]);
    await e.executar('DELETE FROM situacao_leito WHERE codigo LIKE ?', [`${P}-%`]);
    if (motivoCriado) await e.executar("DELETE FROM motivo_bloqueio_leito WHERE codigo = 'isolamento'");
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('Bloqueio do quarto pela auditoria do isolamento (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaControlesAssistenciaisPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  /** Os períodos do leito, do mais antigo ao mais novo. */
  const periodos = (leito: number) =>
    ler(
      `SELECT ps.situacao_leito_id, ps.isolamento_paciente_id, ps.data_hora_fim, mb.codigo AS motivo,
              JSON_VALUE(ps.dados, '$.auditoriaIsolamento') AS auditoria
         FROM periodo_situacao_leito ps LEFT JOIN motivo_bloqueio_leito mb ON mb.id = ps.motivo_bloqueio_leito_id
        WHERE ps.leito_hospitalar_id = ? ORDER BY ps.id`,
      [leito],
    );
  const situacaoDo = async (leito: number) =>
    Number(
      (await ler('SELECT situacao_leito_id FROM leito_hospitalar WHERE id = ?', [leito]))[0]![
        'situacao_leito_id'
      ],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      // Duas internações sem ocupação aberta: a do isolado e a do vizinho que ocupa o leito C.
      const ints = await e.consultar(
        `SELECT i.id, i.atendimento_id, i.paciente_id FROM internacao i
          WHERE i.excluido_em IS NULL AND NOT EXISTS (SELECT 1 FROM ocupacao_leito o WHERE o.internacao_id = i.id
                AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL)
          ORDER BY i.id LIMIT 2`,
      );
      if (!usuario?.['id'] || ints.length < 2)
        throw new Error('O cliente de teste precisa de usuário e de duas internações sem ocupação aberta.');
      const [isolado, outro] = ints as Record<string, unknown>[];
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const ua = await e.inserir(
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'POSTO SINTETICO', 'internacao', ?)",
        [est, `${P}-UA`, agora],
      );
      const bloco = await e.inserir(
        "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'CLI', 'BLOCO SINTETICO', ?)",
        [est, agora],
      );
      const ui = await e.inserir(
        `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, bloco_internacao_id,
           criado_em) VALUES (?, ?, ?, 'CLINICA SINTETICA', 'enfermaria', ?, ?)`,
        [est, ua, `${P}-UI`, bloco, agora],
      );
      const cat = await e.inserir(
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'ENFERMARIA SINTETICA', 'enfermaria', ?)",
        [P, agora],
      );
      const quarto = (codigo: string, n: number) =>
        e.inserir(
          `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo,
             nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, ?, 'QUARTO SINTETICO', ?, ?)`,
          [est, bloco, ui, cat, codigo, n, agora],
        );
      const q1 = await quarto('101', 4);
      const q2 = await quarto('102', 1);
      const sit = async (base: string) =>
        (
          await garantir(
            e,
            'SELECT id FROM situacao_leito WHERE situacao_base = ? AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1',
            [base],
            'INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, ?, ?, ?)',
            [`${P}-${base}`, `${base.toUpperCase()} SINTETICO`, base, agora],
          )
        ).id;
      const situacao = { livre: await sit('livre'), bloqueado: await sit('bloqueado') };
      await sit('ocupado');
      const motivo = await garantir(
        e,
        "SELECT id FROM motivo_bloqueio_leito WHERE codigo = 'isolamento' AND ativo = TRUE",
        [],
        "INSERT INTO motivo_bloqueio_leito (codigo, descricao, criado_em) VALUES ('isolamento', 'ISOLAMENTO', ?)",
        [agora],
      );
      const leito = (acom: number, codigo: string, s: number) =>
        e.inserir(
          `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo,
             situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
          [est, ui, acom, bloco, codigo, s, agora],
        );
      const leitos = {
        A: await leito(q1, 'A', situacao.livre),
        B: await leito(q1, 'B', situacao.livre),
        C: await leito(q1, 'C', situacao.livre),
        D: await leito(q1, 'D', situacao.bloqueado),
        E: await leito(q2, 'E', situacao.livre),
      };
      const ocupar = (int: Record<string, unknown>, l: number) =>
        e.inserir(
          `INSERT INTO ocupacao_leito (estabelecimento_id, internacao_id, leito_hospitalar_id, unidade_internacao_id, acomodacao_id,
             data_hora_inicio, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ativa', ?)`,
          [est, Number(int['id']), l, ui, q1, agora, agora],
        );
      await ocupar(isolado!, leitos.A);
      await ocupar(outro!, leitos.C);
      // D já tem estado aberto de outra origem (bloqueio sem motivo de isolamento): fica como está.
      await e.inserir(
        `INSERT INTO periodo_situacao_leito (leito_hospitalar_id, situacao_leito_id, data_hora_inicio, operacao, dados,
           ocorrido_em, criado_em) VALUES (?, ?, ?, 'inclusao', '{"estado":"bloqueio"}', ?, ?)`,
        [leitos.D, situacao.bloqueado, agora, agora, agora],
      );
      const tipo = await e.inserir(
        'INSERT INTO tipo_precaucao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [P, `Precaução sintética ${P}`, agora],
      );
      const isolamento = await e.inserir(
        `INSERT INTO isolamento_paciente (estabelecimento_id, paciente_id, atendimento_id, internacao_id, leito_hospitalar_id,
           tipo_precaucao_id, motivo_precaucao, data_hora_inicio, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'kpc', ?, 'ativo', ?)`,
        [
          est,
          Number(isolado!['paciente_id']),
          Number(isolado!['atendimento_id']),
          Number(isolado!['id']),
          leitos.A,
          tipo,
          agora,
          agora,
        ],
      );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(isolado!['paciente_id']),
        isolamento,
        leitos,
        situacao,
        criados: { motivo: motivo.criado },
      };
    });
    porta = new PortaControlesAssistenciaisPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) =>
        limpar(e, m?.criados.motivo ?? false),
      );
      await nucleo.encerrar?.();
    }
  });

  it('"bloquear" não conforme bloqueia o quarto até a CCIH resolver; cancelar a auditoria também libera', async () => {
    const c1 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: Number((await tipo()).id),
      descricao: 'Placa na porta',
    });
    const c2 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: Number((await tipo()).id),
      descricao: 'Avental na entrada',
      acao: 'alertar',
    });
    const c3 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: Number((await tipo()).id),
      descricao: 'Quarto sem paciente sem a mesma precaução',
      acao: 'bloquear',
    });
    const respostas = (bloq: boolean, alerta: boolean) => [
      { criterio: c1.id, resposta: 'conforme' },
      alerta
        ? { criterio: c2.id, resposta: 'nao_conforme', naoConformidade: 'Sem avental' }
        : { criterio: c2.id, resposta: 'conforme' },
      bloq
        ? { criterio: c3.id, resposta: 'nao_conforme', naoConformidade: 'Coorte desfeita' }
        : { criterio: c3.id, resposta: 'conforme' },
    ];

    // Só "alertar": aviso alto, nenhum período novo no quarto.
    const r0 = await porta.auditar(ctx(), { isolamento: m.isolamento, respostas: respostas(false, true) });
    expect(r0.aviso).not.toBeNull();
    expect(r0.leitosBloqueados).toEqual([]);
    expect(await periodos(m.leitos.B)).toHaveLength(0);
    await porta.cancelarAuditoria(ctx(), r0.id, { motivo: 'Lançada para conferência', versao: 1 });

    // "bloquear": B (livre) bloqueado; A (do isolado) não; C (ocupado por outro) listado; D e E como estavam.
    const r1 = await porta.auditar(ctx(), { isolamento: m.isolamento, respostas: respostas(true, false) });
    expect(r1).toMatchObject({
      geral: 'nao_conforme',
      leitosBloqueados: ['B'],
      leitosOcupadosNoQuarto: ['C'],
    });
    const pb = await periodos(m.leitos.B);
    expect(pb).toHaveLength(1);
    expect(pb[0]).toMatchObject({ motivo: 'isolamento', data_hora_fim: null, auditoria: String(r1.id) });
    expect(Number(pb[0]!['isolamento_paciente_id'])).toBe(m.isolamento);
    expect(Number(pb[0]!['situacao_leito_id'])).toBe(m.situacao.bloqueado);
    expect(await situacaoDo(m.leitos.B)).toBe(m.situacao.bloqueado);
    expect(await periodos(m.leitos.A)).toHaveLength(0);
    expect(await periodos(m.leitos.C)).toHaveLength(0);
    expect(await periodos(m.leitos.E)).toHaveLength(0);
    const pd = await periodos(m.leitos.D);
    expect(pd).toHaveLength(1);
    expect(pd[0]!['auditoria']).toBeNull();
    const av = (await porta.avisosIsolamento(ctx())).itens;
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({ id: r1.aviso, prioridade: 'critica', leitosBloqueados: ['B'] });

    // A CCIH resolve: o período do B fica encerrado (não apagado) e o leito volta a livre; D segue com o dele.
    const res = await porta.resolverAvisoIsolamento(ctx(), r1.aviso!, {
      providencia: 'Coorte refeita e quarto conferido pela CCIH',
      versao: 1,
    });
    expect(res.leitosLiberados).toBe(1);
    const pb2 = await periodos(m.leitos.B);
    expect(pb2).toHaveLength(1);
    expect(pb2[0]!['data_hora_fim']).not.toBeNull();
    expect(await situacaoDo(m.leitos.B)).toBe(m.situacao.livre);
    expect((await periodos(m.leitos.D))[0]!['data_hora_fim']).toBeNull();
    expect(
      (await porta.avisosIsolamento(ctx(), true)).itens.find((x) => x.id === r1.aviso)!.leitosBloqueados,
    ).toEqual([]);

    // Nova auditoria com "bloquear" e cancelamento: o bloqueio dela também sai (histórico fica).
    const r2 = await porta.auditar(ctx(), { isolamento: m.isolamento, respostas: respostas(true, true) });
    expect(r2.leitosBloqueados).toEqual(['B']);
    expect(await situacaoDo(m.leitos.B)).toBe(m.situacao.bloqueado);
    const canc = await porta.cancelarAuditoria(ctx(), r2.id, {
      motivo: 'Auditoria no isolamento errado',
      versao: 1,
    });
    expect(canc.leitosLiberados).toBe(1);
    const pb3 = await periodos(m.leitos.B);
    expect(pb3).toHaveLength(2);
    expect(pb3.every((p) => p['data_hora_fim'] !== null)).toBe(true);
    expect(await situacaoDo(m.leitos.B)).toBe(m.situacao.livre);
  });

  const tipo = async () =>
    (await ler<{ id: number }>('SELECT id FROM tipo_precaucao WHERE codigo = ?', [P]))[0]!;
});
