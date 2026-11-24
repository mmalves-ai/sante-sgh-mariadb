// Contrato de efeito da escala de execução do diagnóstico (F3.5, 05-SADT linha 19) no MariaDB real (cliente f22_o2;
// massa SINTÉTICA). Prova o que fica no banco: a escala com o papel, os plantões (inclusive o que vira a noite) e os
// exames, com a trilha; a escala de laudo do mesmo profissional em outro setor no mesmo horário recusada pelo choque,
// sem gravar nada; a escala inválida recusada com todos os campos; o encerramento da vigência que não apaga (com a
// versão conferida); outro estabelecimento não vê a escala. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { ServicoEscalaExecucao } from './escala-execucao-propria.js';

const problemaDe = (e: unknown) =>
  e instanceof ErroOperacao
    ? { codigo: String(e.problema['codigo'] ?? ''), campos: (e.problema['campos'] as string[]) ?? [] }
    : { codigo: String(e), campos: [] };

describe.skipIf(SEM_BANCO)('escala de execução do diagnóstico (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let escalas: ServicoEscalaExecucao;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-l19esc' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'E19');
    escalas = new ServicoEscalaExecucao(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const est = m.base.est;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          'DELETE d FROM escala_execucao_dia d JOIN escala_execucao s ON s.id = d.escala_execucao_id WHERE s.estabelecimento_id = ?',
          [est],
        );
        await x(
          'DELETE x FROM escala_execucao_exame x JOIN escala_execucao s ON s.id = x.escala_execucao_id WHERE s.estabelecimento_id = ?',
          [est],
        );
        await x('DELETE FROM escala_execucao WHERE estabelecimento_id = ?', [est]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('inclui com plantões e exames, recusa o choque e o inválido sem gravar, encerra sem apagar', async () => {
    const c = contexto(m!);
    const prof = m!.base.profissional;
    const escala = {
      setor: m!.setorImagem,
      profissional: prof,
      papel: 'executa',
      descricao: 'Imagem noturno E19',
      vigenciaInicio: '2026-11-01',
      plantoes: [
        { diaSemana: 2, inicio: '19:00', fim: '07:00', capacidade: 8 },
        { diaSemana: 4, inicio: '07:00', fim: '07:00', capacidade: 20 },
      ],
      exames: [{ exame: m!.exameImagem, limitePorTurno: 6 }],
    };
    // Inclusão: a escala, os dois plantões (o que vira a noite e o de 24 horas) e o exame.
    const { id } = await escalas.incluir(c, escala);
    expect(id).toBeGreaterThan(0);
    const cab = await um(
      'SELECT papel, profissional_id, vigencia_fim, versao, ativo FROM escala_execucao WHERE id = ?',
      [id],
    );
    expect(cab).toMatchObject({ papel: 'executa', vigencia_fim: null });
    expect(Number(cab?.['profissional_id'])).toBe(prof);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM escala_execucao_dia WHERE escala_execucao_id = ? AND hora_fim <= hora_inicio',
        [id],
      ),
    ).toBe(2);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM escala_execucao_exame WHERE escala_execucao_id = ? AND limite_por_turno = 6',
        [id],
      ),
    ).toBe(1);

    // A mesma pessoa laudando em outro setor das 02:00 às 04:00 da terça (dentro do noturno de segunda): choque, nada gravado.
    const choque = await escalas
      .incluir(c, {
        ...escala,
        setor: m!.setorLab,
        papel: 'lauda',
        descricao: 'Laudo madrugada E19',
        plantoes: [{ diaSemana: 3, inicio: '02:00', fim: '04:00', capacidade: 4 }],
        exames: [{ exame: m!.exameLab }],
      })
      .catch(problemaDe);
    expect(choque).toEqual({ codigo: 'escala-conflito', campos: ['plantoes.0'] });

    // Escala de laudo de sala e sem exame: todos os problemas de uma vez, nada gravado.
    const invalida = await escalas
      .incluir(c, { ...escala, profissional: null, recurso: null, papel: 'lauda', exames: [] })
      .catch(problemaDe);
    expect(invalida).toMatchObject({ codigo: 'escala-invalida' });
    expect((invalida as { campos: string[] }).campos).toEqual(
      expect.arrayContaining(['executante', 'profissional', 'exames']),
    );
    expect(
      await contar('SELECT COUNT(*) n FROM escala_execucao WHERE estabelecimento_id = ?', [m!.base.est]),
    ).toBe(1);

    // A leitura traz a escala com os plantões em HH:MM; outro estabelecimento não a vê.
    const lidas = await escalas.listar(c, m!.setorImagem);
    expect(lidas.map((e) => e.id)).toEqual([id]);
    expect(lidas[0]!.plantoes.map((p) => `${p.inicio}-${p.fim}`)).toEqual(['19:00-07:00', '07:00-07:00']);
    expect((await escalas.listar(contexto(m!, m!.base.outroEst))).map((e) => e.id)).not.toContain(id);

    // Encerrar: versão velha recusada; fim antes do início recusado; o encerramento grava o fim e a linha fica.
    const versao = Number(cab?.['versao']);
    expect(
      await escalas.encerrar(c, id, { vigenciaFim: '2026-12-31', versao: versao + 5 }).catch(problemaDe),
    ).toMatchObject({ codigo: 'versao-mudou' });
    expect(
      await escalas.encerrar(c, id, { vigenciaFim: '2026-10-01', versao }).catch(problemaDe),
    ).toMatchObject({ codigo: 'vigencia-invalida' });
    await escalas.encerrar(c, id, { vigenciaFim: '2026-12-31', versao });
    const depois = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') fim, versao, excluido_em FROM escala_execucao WHERE id = ?",
      [id],
    );
    expect(depois).toMatchObject({ fim: '2026-12-31', excluido_em: null });
    expect(Number(depois?.['versao'])).toBe(versao + 1);
    expect(
      await contar('SELECT COUNT(*) n FROM escala_execucao_dia WHERE escala_execucao_id = ?', [id]),
    ).toBe(2);

    // A trilha: a inclusão e o encerramento da escala (as recusas não deixam rastro de gravação).
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'escala_execucao' AND entidade_id = ?",
        [id],
      ),
    ).toBe(2);
  }, 120_000);
});
