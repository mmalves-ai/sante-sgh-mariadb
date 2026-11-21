// Integração da porta própria da agenda de sessões contra o MariaDB real (cliente f22_o2, já criado pela obra da onda
// 2). Massa SINTÉTICA com códigos "L0214S" (nenhuma pessoa real). Contrato de efeito de cada gravação: o plano e as
// sessões no modelo, o número de negócio, a versão, a trilha da operação e as recusas (recurso e paciente ocupados,
// plano incompleto, recurso de outro estabelecimento, versão antiga). A bateria da série roda na memória e no banco.
// No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha (só inclusão)
// referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { PortaSessoes, SerieNova } from './porta.js';
import { PortaSessoesMemoria } from './porta-memoria.js';
import { PortaSessoesPropria, relogioCivil } from './porta-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0214S';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown): string | null =>
  e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : e instanceof Error ? e.message : null;
const erroDe = (p: Promise<unknown>) => p.then(() => null, codigoDe);

describe.skipIf(SEM_BANCO)('porta própria da agenda de sessões (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSessoesPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    agenda: 0,
    recurso: 0,
    recurso2: 0,
    recursoOutro: 0,
    complexidade: 0,
    duracao: 0,
    item: 0,
    profissional: 0,
    fonte: 0,
    paciente: 0,
  };
  let ctx: ContextoNucleo;
  let outro: ContextoNucleo;
  // Um dia útil bem à frente (sem colidir com outra massa).
  const dia = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  const trilha = (entidade: string): TrilhaDaGravacao => ({
    estabelecimento: ctx.estabelecimento,
    usuario: ctx.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste-0214' },
    correlacao: ctx.correlacao,
  });
  const serie = (x: Partial<SerieNova> = {}): SerieNova => ({
    agenda: ids.agenda,
    recurso: ids.recurso,
    complexidade: ids.complexidade,
    duracao: ids.duracao,
    duracaoMin: 60,
    intervaloDias: 7,
    pularFimDeSemana: true,
    paciente: ids.paciente,
    prontuario: 910_214_001,
    planoTipo: 'quimioterapia',
    plano: 'PROTOCOLO SINTETICO',
    observacao: null,
    itemAgendavel: ids.item,
    solicitante: ids.profissional,
    fontePagadora: ids.fonte,
    sessoes: [
      { ordem: 1, inicio: `${dia}T08:00`, fim: `${dia}T09:00` },
      { ordem: 2, inicio: `${dia}T10:00`, fim: `${dia}T11:00` },
      { ordem: 3, inicio: `${dia}T13:00`, fim: `${dia}T14:00` },
    ],
    ...x,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        'DELETE s FROM sessao_terapeutica s JOIN plano_sessao p ON p.id = s.plano_sessao_id WHERE p.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar('DELETE FROM plano_sessao WHERE estabelecimento_id IN (?, ?)', [
        ids.est,
        ids.outroEst,
      ]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-14s' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0214s.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0214s.teste', 'USUARIO SINTETICO L0214S', agora],
      );
      const setor = (estab: number) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, `${P}-ONC`],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'ONCOLOGIA SINTETICA', 'assistencial', ?)",
          [estab, `${P}-ONC`, agora],
        );
      const setorA = await setor(ids.est);
      const setorB = await setor(ids.outroEst);
      ids.complexidade = await garantir(
        e,
        'SELECT id FROM complexidade_sessao WHERE codigo = ?',
        [`${P}-ALTA`],
        "INSERT INTO complexidade_sessao (codigo, descricao, ordem, criado_em) VALUES (?, 'ALTA SINTETICA', 3, ?)",
        [`${P}-ALTA`, agora],
      );
      ids.duracao = await garantir(
        e,
        'SELECT id FROM duracao_sessao WHERE codigo = ?',
        [`${P}-LONGA`],
        "INSERT INTO duracao_sessao (codigo, descricao, minutos_minimo, minutos_maximo, criado_em) VALUES (?, 'LONGA SINTETICA', 60, 240, ?)",
        [`${P}-LONGA`, agora],
      );
      const recurso = (estab: number, setorId: number, codigo: string) =>
        garantir(
          e,
          'SELECT id FROM recurso_agendavel WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          "INSERT INTO recurso_agendavel (estabelecimento_id, codigo, descricao, tipo, setor_funcional_id, criado_em) VALUES (?, ?, ?, 'cadeira', ?, ?)",
          [estab, codigo, `CADEIRA ${codigo}`, setorId, agora],
        );
      ids.recurso = await recurso(ids.est, setorA, `${P}-C1`);
      ids.recurso2 = await recurso(ids.est, setorA, `${P}-C2`);
      ids.recursoOutro = await recurso(ids.outroEst, setorB, `${P}-C9`);
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}-SES`],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, 'SESSOES SINTETICAS', 'consulta', ?)",
        [`${P}-SES`, agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, `TERAPIA ${P}`],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, setor_funcional_id,
           duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 60, ?)`,
        [ids.est, `TERAPIA ${P}`, cat, setorA, agora],
      );
      for (const [r, prioridade] of [
        [ids.recurso, 1],
        [ids.recurso2, 2],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM agenda_recurso WHERE agenda_servico_id = ? AND recurso_agendavel_id = ?',
          [ids.agenda, r],
          'INSERT INTO agenda_recurso (agenda_servico_id, recurso_agendavel_id, prioridade, complexidade_sessao_id, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.agenda, r, prioridade, prioridade === 1 ? ids.complexidade : null, agora],
        );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_agendavel WHERE codigo = ?',
        [`${P}-QT`],
        "INSERT INTO item_agendavel (codigo, descricao, tipo_item, duracao_minutos, criado_em) VALUES (?, 'SESSAO SINTETICA', 'sessao', 60, ?)",
        [`${P}-QT`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)',
          [nome, '1980-03-15', agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 910214001, 'ativo', ?)",
        [pp, agora],
      );
      const pm = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-SUS`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA SINTETICA', 'operadora', 'ativa', ?)",
        [`${P}-SUS`, agora],
      );
      await limpar(e);
    });
    ctx = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `t0214s-${randomUUID()}`,
    };
    outro = { ...ctx, estabelecimento: ids.outroEst };
    porta = new PortaSessoesPropria(nucleo);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo
        .escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-14s' }, limpar)
        .catch(() => undefined);
      await nucleo.encerrar();
    }
  });

  it('o relógio, os recursos da agenda com o que aceitam e os domínios', async () => {
    expect(relogioCivil('America/Sao_Paulo', new Date('2027-03-01T10:00:00Z'))).toEqual({
      hoje: '2027-03-01',
      agora: '2027-03-01T07:00',
    });
    const recursos = await porta.recursos(ctx);
    expect(recursos.map((r) => r.recurso)).toEqual([ids.recurso, ids.recurso2]);
    expect(recursos[0]).toMatchObject({
      agenda: ids.agenda,
      tipo: 4,
      prioridade: 1,
      complexidade: ids.complexidade,
      ativo: true,
    });
    expect(recursos[1]?.complexidade).toBe(0);
    expect((await porta.recursos(outro)).map((r) => r.recurso)).not.toContain(ids.recurso);
    const d = await porta.dominios(ctx);
    expect(d.complexidades).toEqual(
      expect.arrayContaining([
        { codigo: 0, nome: 'Todas' },
        { codigo: ids.complexidade, nome: 'ALTA SINTETICA' },
      ]),
    );
    expect(await porta.paciente(ctx, ids.paciente)).toMatchObject({
      prontuario: 910214001,
      nascimento: '1980-03-15',
      ativo: true,
    });
  });

  it('a série: plano com número, sessões, trilha; recurso e paciente ocupados, plano incompleto e outro estabelecimento recusam', async () => {
    const antes = Number(
      (
        await nucleo.lerSomente(ctx, (l) =>
          l.uma('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [ctx.correlacao]),
        )
      )?.['n'],
    );
    const r = await porta.gravarSgh(ctx, trilha('plano_sessao'), (g) => g.agendarSerie(serie()));
    expect(r.ids).toHaveLength(3);
    const plano = await nucleo.lerSomente(ctx, (l) =>
      l.uma(
        'SELECT numero, total_sessoes, situacao, item_agendavel_id, fonte_pagadora_id, criado_por FROM plano_sessao WHERE id = ?',
        [r.serie],
      ),
    );
    expect(plano).toMatchObject({
      total_sessoes: 3,
      situacao: 'ativo',
      item_agendavel_id: ids.item,
      fonte_pagadora_id: ids.fonte,
      criado_por: ids.usuario,
    });
    expect(String(plano?.['numero'])).toMatch(/^PS-\d+$/);
    const depois = Number(
      (
        await nucleo.lerSomente(ctx, (l) =>
          l.uma('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [ctx.correlacao]),
        )
      )?.['n'],
    );
    expect(depois).toBe(antes + 1);
    const lidas = await porta.serie(ctx, r.serie);
    expect(lidas.map((x) => [x.ordem, x.inicio, x.situacao, x.versao])).toEqual([
      [1, `${dia}T08:00`, 'agendada', 1],
      [2, `${dia}T10:00`, 'agendada', 1],
      [3, `${dia}T13:00`, 'agendada', 1],
    ]);
    expect(lidas[0]).toMatchObject({
      paciente: ids.paciente,
      prontuario: 910214001,
      planoTipo: 'quimioterapia',
      plano: 'PROTOCOLO SINTETICO',
      por: 'l0214s.teste',
    });
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('plano_sessao'), (g) =>
          g.agendarSerie(
            serie({
              paciente: ids.paciente,
              recurso: ids.recurso,
              sessoes: [{ ordem: 1, inicio: `${dia}T08:30`, fim: `${dia}T09:30` }],
            }),
          ),
        ),
      ),
    ).toBe('recurso-ocupado');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('plano_sessao'), (g) =>
          g.agendarSerie(
            serie({
              recurso: ids.recurso2,
              sessoes: [{ ordem: 1, inicio: `${dia}T10:30`, fim: `${dia}T11:30` }],
            }),
          ),
        ),
      ),
    ).toBe('paciente-ocupado');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('plano_sessao'), (g) => g.agendarSerie(serie({ fontePagadora: null }))),
      ),
    ).toBe('plano-incompleto');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('plano_sessao'), (g) =>
          g.agendarSerie(serie({ recurso: ids.recursoOutro })),
        ),
      ),
    ).toBe('recurso-inativo');
    // O paciente é do cliente inteiro: a sessão dele aqui impede o horário no outro estabelecimento.
    expect(
      await porta.ocupacoes(outro, { paciente: ids.paciente }, [
        { inicio: `${dia}T08:30`, fim: `${dia}T08:45` },
      ]),
    ).toEqual([{ id: r.ids[0], serie: r.serie, inicio: `${dia}T08:00`, fim: `${dia}T09:00` }]);
    expect(
      await porta.ocupacoes(ctx, { recurso: ids.recurso2 }, [
        { inicio: `${dia}T08:00`, fim: `${dia}T18:00` },
      ]),
    ).toEqual([]);
    expect(await porta.sessao(outro, r.ids[0]!)).toBeNull();
    const grade = await porta.periodo(
      ctx,
      dia,
      new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
      [ids.recurso],
    );
    expect(grade).toMatchObject({ cortada: false });
    expect(grade.sessoes).toHaveLength(3);
    expect((await porta.doPaciente(ctx, ids.paciente, dia)).sessoes).toHaveLength(3);
    expect((await porta.nomes(ctx, [ids.paciente])).get(ids.paciente)).toBe(`PACIENTE SINTETICO ${P}`);
  });

  it('a situação pela versão: realizada, a versão antiga recusa e as restantes canceladas', async () => {
    const [s1, s2, s3] = (await porta.doPaciente(ctx, ids.paciente, dia)).sessoes;
    await porta.gravarSgh(ctx, trilha('sessao_terapeutica'), (g) =>
      g.atualizar({ id: s1!.id, situacao: 'realizada', motivo: null, versao: 1 }),
    );
    const r1 = await porta.sessao(ctx, s1!.id);
    expect(r1).toMatchObject({ situacao: 'realizada', versao: 2, alteradoPor: 'l0214s.teste' });
    const realizada = await nucleo.lerSomente(ctx, (l) =>
      l.uma('SELECT realizada_em FROM sessao_terapeutica WHERE id = ?', [s1!.id]),
    );
    expect(realizada?.['realizada_em']).toBeInstanceOf(Date);
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('sessao_terapeutica'), (g) =>
          g.atualizar({ id: s1!.id, situacao: 'falta', motivo: 'X', versao: 1 }),
        ),
      ),
    ).toBe('versao-desatualizada');
    const n = await porta.gravarSgh(ctx, trilha('sessao_terapeutica'), (g) =>
      g.cancelarRestantes({
        id: s2!.id,
        serie: s2!.serie,
        ordem: s2!.ordem,
        motivo: 'SUSPENSO PELO MEDICO',
        versao: 1,
      }),
    );
    expect(n).toBe(2);
    const fim = await porta.serie(ctx, s1!.serie);
    expect(fim.map((x) => x.situacao)).toEqual(['realizada', 'cancelada', 'cancelada']);
    const c3 = await nucleo.lerSomente(ctx, (l) =>
      l.uma('SELECT cancelado_usuario_id, motivo FROM sessao_terapeutica WHERE id = ?', [s3!.id]),
    );
    expect(c3).toEqual({ cancelado_usuario_id: ids.usuario, motivo: 'SUSPENSO PELO MEDICO' });
    // As canceladas liberam o recurso; a realizada continua ocupando.
    expect(
      (
        await porta.ocupacoes(ctx, { recurso: ids.recurso }, [
          { inicio: `${dia}T07:00`, fim: `${dia}T15:00` },
        ])
      ).map((x) => x.id),
    ).toEqual([s1!.id]);
  });

  it.each([
    ['memória', () => new PortaSessoesMemoria(null, () => new Date(`${dia}T10:00:00Z`)) as PortaSessoes],
    ['banco', () => porta as PortaSessoes],
  ])('a mesma bateria de conflito vale na %s', async (_nome, fabrica) => {
    const p = fabrica();
    const base = serie({
      recurso: ids.recurso2,
      sessoes: [{ ordem: 1, inicio: `${dia}T16:00`, fim: `${dia}T17:00` }],
    });
    const a = await p.gravarSgh(ctx, trilha('plano_sessao'), (g) => g.agendarSerie(base));
    expect(a.ids).toHaveLength(1);
    expect(await erroDe(p.gravarSgh(ctx, trilha('plano_sessao'), (g) => g.agendarSerie(base)))).toBe(
      'recurso-ocupado',
    );
    const lida = await p.sessao(ctx, a.ids[0]!);
    await p.gravarSgh(ctx, trilha('sessao_terapeutica'), (g) =>
      g.atualizar({ id: a.ids[0]!, situacao: 'cancelada', motivo: 'TESTE', versao: lida!.versao }),
    );
    expect((await p.sessao(ctx, a.ids[0]!))?.situacao).toBe('cancelada');
  });
});
