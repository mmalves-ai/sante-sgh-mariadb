// Integração do ADR 0009 na API (serviço das rotas de preço particular, credenciamento e agenda estruturada) contra o
// MariaDB, no cliente de teste do agente (SGH_CLIENTE_TESTE, padrão adr9_api, criado por
// `python3 -I tools/db/criar_cliente.py adr9_api ...` e apagado no fim). Massa SINTÉTICA com o prefixo a9a. Prova as
// perguntas de aceite da seção 6 pela API (valor, convênio e subplano, preparo, restrições) com o texto ao lado, o
// alerta e o bloqueio sem credenciamento e a recusa de preço por médico em convênio. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Escritor,
  ErroOperacao,
  NucleoProprio,
} from '@sgh/nucleo';
import { codigoParticularDoParametro, gravarTextoOrigemAgenda } from '@sgh/persistencia';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoFaturamento } from '../faturamento/porta.js';
import { PortaFaturamentoPropria } from '../faturamento/porta-propria.js';
import { PortaAtendimentoPropria } from '../atendimento/porta-propria.js';
import { ServicoAgendaPreco } from './agenda-preco.servico.js';
import { conferirCredenciamentoNoFluxo } from './credenciamento-fluxo.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'adr9_api';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const DIA = '2026-11-22';
const TEXTO =
  'CONSULTA PARTICULAR R$ 300,00. NAO ATENDE PLANO BRONZE. A PARTIR DE 12 ANOS. JEJUM DE 8 HORAS.\n' +
  'Observacao sem regra: '.padEnd(2_400, 'y');

async function codigoDaRecusa(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo']) : String(e);
  }
}

describe.skipIf(SEM_BANCO)('ADR 0009 na API (cliente de teste adr9_api)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoAgendaPreco;
  const ids = { est: 0, usuario: 0, prof: 0, prof2: 0, part: 0, conv: 0, ouro: 0, bronze: 0, agenda: 0 };
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-adr9-api' }, fn);
  const ctx = (): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: 'teste-adr9-api',
  });
  const op = (): ContextoOperacao => ({
    ...ctx(),
    chaveIdempotencia: `a9a-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });

  const limpar = async (e: Escritor) => {
    // O lançamento na conta (massa a9a): memória, itens, contas e atendimentos do estabelecimento a9a.
    const est = "(SELECT id FROM estabelecimento WHERE codigo = 'a9a')";
    const ct = `(SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN ${est})`;
    await e.executar(`DELETE FROM atendimento_conta WHERE conta_hospitalar_id IN ${ct}`);
    await e.executar(
      `DELETE FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN ${ct})`,
    );
    await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN ${ct}`);
    await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`);
    await e.executar(`DELETE FROM marcacao_horario WHERE estabelecimento_id IN ${est}`);
    await e.executar(`DELETE FROM horario_agenda WHERE estabelecimento_id IN ${est}`);
    const ag = "(SELECT id FROM agenda_servico WHERE nome LIKE 'a9a%')";
    const pr =
      "(SELECT p.id FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome LIKE 'a9a%')";
    await e.executar(
      `DELETE FROM regra_preco_particular WHERE agenda_servico_id IN ${ag} OR profissional_id IN ${pr}`,
    );
    for (const t of ['agenda_cobertura', 'agenda_restricao', 'agenda_preparo', 'agenda_item_agendavel'])
      await e.executar(`DELETE FROM ${t} WHERE agenda_servico_id IN ${ag}`);
    await e.executar(
      `DELETE t FROM trecho_texto_agenda t JOIN texto_origem_agenda o ON o.id = t.texto_origem_agenda_id WHERE o.agenda_servico_id IN ${ag}`,
    );
    await e.executar(`DELETE FROM texto_origem_agenda WHERE agenda_servico_id IN ${ag}`);
    await e.executar(`DELETE FROM agenda_fonte_pagadora WHERE agenda_servico_id IN ${ag}`);
    await e.executar("DELETE FROM agenda_servico WHERE nome LIKE 'a9a%'");
    await e.executar(
      "DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id IN (SELECT id FROM fonte_pagadora WHERE codigo LIKE 'a9a%')",
    );
    await e.executar(
      "DELETE FROM profissional_fonte_pagadora WHERE plano_fonte_pagadora_id IN (SELECT id FROM plano_fonte_pagadora WHERE codigo LIKE 'a9a%')",
    );
    await e.executar(
      "DELETE FROM plano_fonte_pagadora WHERE codigo LIKE 'a9a%' AND plano_superior_id IS NOT NULL",
    );
    await e.executar("DELETE FROM plano_fonte_pagadora WHERE codigo LIKE 'a9a%'");
    // Convênios criados pelo POST /convenios (a9anv*) e o parâmetro do particular padrão da massa.
    await e.executar("DELETE FROM fonte_pagadora WHERE codigo LIKE 'a9anv%'");
    await e.executar(
      "DELETE FROM parametro_valor WHERE motivo = 'a9a teste' AND parametro_definicao_id IN (SELECT id FROM parametro_definicao WHERE chave = 'faturamento.fontePagadoraParticularCodigo')",
    );
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    s = new ServicoAgendaPreco(nucleo, 'a9apart');
    await escrever(async (e) => {
      await limpar(e);
      const agora = 'CURRENT_TIMESTAMP(3)';
      const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await um(
        "SELECT id FROM estabelecimento WHERE codigo = 'a9a'",
        [],
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES ('a9a', 'a9a Hospital', 'a9a Hospital Ltda', ${agora})`,
        [],
      );
      ids.usuario = await um(
        "SELECT id FROM usuario WHERE login = 'a9a.teste'",
        [],
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES ('a9a.teste', 'a9a teste', 'servico', ${agora})`,
        [],
      );
      const prof = async (nome: string) => {
        const pf = await um(
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          `INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ${agora})`,
          [nome],
        );
        return um(
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          `INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ${agora})`,
          [pf],
        );
      };
      ids.prof = await prof('a9a Medico X');
      ids.prof2 = await prof('a9a Medico Y');
      const fonte = (codigo: string, tipo: string) =>
        um(
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [codigo],
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ${agora})`,
          [codigo, codigo, tipo],
        );
      ids.part = await fonte('a9apart', 'particular');
      ids.conv = await fonte('a9aconv', 'operadora');
      await e.executar(
        'UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 0, credencia_todos_ao_criar = 0 WHERE id = ?',
        [ids.conv],
      );
      const plano = (codigo: string, sup: number | null) =>
        e.inserir(
          `INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, plano_superior_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?, ${agora})`,
          [ids.conv, sup, codigo, codigo],
        );
      const raiz = await plano('a9araiz', null);
      ids.ouro = await plano('a9aouro', raiz);
      ids.bronze = await plano('a9abronze', raiz);
      const cat = await um(
        "SELECT id FROM categoria_agenda WHERE codigo = 'a9acat'",
        [],
        `INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES ('a9acat', 'a9a', ${agora})`,
        [],
      );
      ids.agenda = await e.inserir(
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos,
           codigo_origem, observacao, criado_em) VALUES (?, 'a9a Agenda X', ?, ?, 20, '9101', ?, ${agora})`,
        [ids.est, cat, ids.prof, TEXTO],
      );
      await e.inserir(
        `INSERT INTO agenda_fonte_pagadora (agenda_servico_id, fonte_pagadora_id, criado_em) VALUES (?, ?, ${agora}), (?, ?, ${agora})`,
        [ids.agenda, ids.part, ids.agenda, ids.conv],
      );
      await gravarTextoOrigemAgenda(
        e,
        { agendaId: ids.agenda, fontePagadoraId: null, campo: 'observacao', texto: TEXTO },
        null,
      );
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await escrever((e) => limpar(e));
      await nucleo.encerrar();
    }
  });

  it('grava as regras pela API: preço particular da agenda e do médico, cobertura, restrição e preparo', async () => {
    const base = { fontePagadoraId: ids.part, vigenciaInicio: '2026-01-01', alvo: { tipo: 'consulta' } };
    const ra = await s.incluirRegra(op(), {
      ...base,
      dono: { tipo: 'agenda', agendaId: ids.agenda },
      valor: 300,
      situacaoRevisao: 'estimada',
    });
    const rp = await s.incluirRegra(op(), {
      ...base,
      dono: { tipo: 'profissional', profissionalId: ids.prof2 },
      valor: 250,
    });
    expect(Number(ra['id'])).toBeGreaterThan(0);
    expect(Number(rp['id'])).toBeGreaterThan(0);
    await s.incluirCobertura(op(), {
      agendaId: ids.agenda,
      fontePagadoraId: ids.conv,
      planoId: ids.bronze,
      aceita: false,
      vigenciaInicio: '2026-01-01',
      situacaoRevisao: 'estimada',
    });
    await s.incluirRestricao(op(), {
      agendaId: ids.agenda,
      idadeMinimaAnos: 12,
      vigenciaInicio: '2026-01-01',
    });
    await s.incluirPreparo(op(), {
      agendaId: ids.agenda,
      descricao: 'Jejum de 8 horas.',
      jejumHoras: 8,
      vigenciaInicio: '2026-01-01',
    });
    const a = await s.agendaEstruturada(ctx(), ids.agenda, DIA);
    expect([
      a?.precosParticulares.length,
      a?.coberturas.length,
      a?.restricoes.length,
      a?.preparos.length,
    ]).toEqual([1, 1, 1, 1]);
  });

  it('PUT com versão: cobertura, restrição e preparo revisados; versão velha e agenda errada recusadas', async () => {
    const a = (await s.agendaEstruturada(ctx(), ids.agenda))!;
    const cob = a.coberturas[0]!;
    const res = a.restricoes[0]!;
    const pre = a.preparos[0]!;
    await s.revisarCobertura(op(), {
      id: cob.id,
      versao: cob.versao,
      valores: {
        agendaId: ids.agenda,
        fontePagadoraId: ids.conv,
        planoId: ids.bronze,
        aceita: false,
        vigenciaInicio: '2026-01-01',
        situacaoRevisao: 'confirmada',
        observacao: 'revisada',
      },
    });
    await s.revisarRestricao(op(), {
      id: res.id,
      versao: res.versao,
      valores: {
        agendaId: ids.agenda,
        idadeMinimaAnos: 12,
        observacao: 'revisada',
        vigenciaInicio: '2026-01-01',
      },
    });
    await s.revisarPreparo(op(), {
      id: pre.id,
      versao: pre.versao,
      valores: {
        agendaId: ids.agenda,
        descricao: 'Jejum de 8 horas.',
        jejumHoras: 8,
        vigenciaInicio: '2026-01-01',
      },
    });
    const b = (await s.agendaEstruturada(ctx(), ids.agenda))!;
    const cob2 = b.coberturas.find((x) => x.id === cob.id)!;
    const res2 = b.restricoes.find((x) => x.id === res.id)!;
    const pre2 = b.preparos.find((x) => x.id === pre.id)!;
    expect([cob2.versao, cob2.situacaoRevisao, res2.idadeMinimaAnos, res2.versao, pre2.versao]).toEqual([
      cob.versao + 1,
      'confirmada',
      12,
      res.versao + 1,
      pre.versao + 1,
    ]);
    const velha = await codigoDaRecusa(
      s.revisarPreparo(op(), {
        id: pre.id,
        versao: pre.versao,
        valores: { agendaId: ids.agenda, descricao: 'x', vigenciaInicio: '2026-01-01' },
      }),
    );
    expect(velha).not.toBeNull();
    const fora = await codigoDaRecusa(
      s.revisarPreparo(op(), {
        id: pre.id,
        versao: pre2.versao,
        valores: { agendaId: ids.agenda + 999999, descricao: 'x', vigenciaInicio: '2026-01-01' },
      }),
    );
    expect(fora).toBe('regra-inexistente');
  });

  it('decisão 24: preço por médico em convênio é recusado', async () => {
    const r = await codigoDaRecusa(
      s.incluirRegra(op(), {
        fontePagadoraId: ids.conv,
        dono: { tipo: 'profissional', profissionalId: ids.prof },
        alvo: { tipo: 'consulta' },
        valor: 100,
        vigenciaInicio: '2026-01-01',
      }),
    );
    expect(r).toBe('convenio-sem-preco-por-medico');
  });

  it('aceite 6.1: quanto custa a consulta particular com o médico X (agenda) e com o médico Y (profissional)', async () => {
    const x = await s.calcular(ctx(), {
      fontePagadoraId: null,
      planoId: null,
      profissionalId: ids.prof,
      agendaId: ids.agenda,
      itemFaturavelId: null,
      consulta: true,
      tabelaContaId: null,
      data: DIA,
    });
    expect([x.valor, x.origem, x.estimada]).toEqual([300, 'regra_particular_agenda', true]);
    const y = await s.calcular(ctx(), {
      fontePagadoraId: ids.part,
      planoId: null,
      profissionalId: ids.prof2,
      agendaId: null,
      itemFaturavelId: null,
      consulta: true,
      tabelaContaId: null,
      data: DIA,
    });
    expect([y.valor, y.origem]).toEqual([250, 'regra_particular_profissional']);
  });

  it('aceite 6.7/6.8, 6.10 e 6.12: respostas da agenda com o texto original ao lado', async () => {
    const pergunta = {
      data: DIA,
      fontePagadoraId: ids.conv,
      planoId: ids.bronze,
      idadeAnos: 5,
      sexo: null,
      itemAgendavelId: null,
      retorno: false,
      encaixe: false,
    };
    const r = await s.responder(ctx(), ids.agenda, pergunta);
    expect(r?.convenio?.atende).toBe(false);
    expect(r?.paciente.permitido).toBe(false);
    expect(r?.paciente.motivo).toContain('12 anos');
    expect([r?.preparo.precisaPreparo, r?.preparo.jejumHoras]).toEqual([true, 8]);
    expect(r?.precoParticular?.valor).toBe(300);
    expect(r?.textos[0]?.texto.length).toBe(TEXTO.length);
    const ouro = await s.responder(ctx(), ids.agenda, { ...pergunta, planoId: ids.ouro, idadeAnos: 30 });
    expect([ouro?.convenio?.atende, ouro?.paciente.permitido]).toEqual([true, true]);
  });

  it('decisão 25: sem credenciamento é alerta; com a opção do convênio, bloqueio; credenciado, nada', async () => {
    const q = { profissionalId: ids.prof, fontePagadoraId: ids.conv, planoId: ids.ouro, data: DIA };
    expect((await s.verificar(ctx(), q)).efeito).toBe('alerta');
    await s.definirOpcoes(op(), {
      fontePagadoraId: ids.conv,
      bloqueiaSemCredenciamento: true,
      credenciaTodosAoCriar: false,
    });
    expect((await s.verificar(ctx(), q)).efeito).toBe('bloqueio');
    const calc = await s.calcular(ctx(), {
      fontePagadoraId: ids.conv,
      planoId: ids.ouro,
      profissionalId: ids.prof,
      agendaId: ids.agenda,
      itemFaturavelId: null,
      consulta: true,
      tabelaContaId: null,
      data: DIA,
    });
    expect(calc.recusa).toBe('profissional-nao-credenciado');
    await s.incluirCredenciamento(op(), {
      profissionalId: ids.prof,
      fontePagadoraId: ids.conv,
      vigenciaInicio: '2026-01-01',
    });
    expect((await s.verificar(ctx(), q)).efeito).toBe('nenhum');
    expect(
      (await s.credenciamentos(ctx(), { profissionalId: ids.prof, fontePagadoraId: ids.conv, data: DIA }))
        .length,
    ).toBe(1);
    expect((await s.opcoes(ctx(), ids.conv))?.bloqueiaSemCredenciamento).toBe(true);
  });

  it('decisão 26: credenciar todos os ativos é idempotente e recusa o particular', async () => {
    const a = await s.credenciarTodos(op(), { fontePagadoraId: ids.conv, vigenciaInicio: '2026-01-01' });
    const b = await s.credenciarTodos(op(), { fontePagadoraId: ids.conv, vigenciaInicio: '2026-01-01' });
    expect(Number(a['credenciados'])).toBeGreaterThanOrEqual(0);
    expect(Number(b['credenciados'])).toBe(0);
    expect(
      await codigoDaRecusa(
        s.credenciarTodos(op(), { fontePagadoraId: ids.part, vigenciaInicio: '2026-01-01' }),
      ),
    ).toBe('particular-sem-credenciamento');
  });

  describe('convênio novo (POST /convenios) e o particular padrão', () => {
    const adm = { id: 0 };
    beforeAll(async () => {
      await escrever(async (e) => {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, CURRENT_TIMESTAMP(3))',
          ['a9a Administrativo'],
        );
        adm.id = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'administrativo', CURRENT_TIMESTAMP(3))",
          [pf],
        );
      });
    });
    const credenciadosEm = (fonte: number) =>
      escrever(async (e) =>
        (
          await e.consultar<{ p: number }>(
            'SELECT profissional_id AS p FROM profissional_fonte_pagadora WHERE fonte_pagadora_id = ? AND excluido_em IS NULL',
            [fonte],
          )
        ).map((x) => Number(x.p)),
      );
    const novo = (codigo: string, credenciaTodosAoCriar: boolean, tipo = 'operadora') =>
      s.incluirConvenio(op(), {
        codigo,
        nome: codigo,
        tipo,
        credenciaTodosAoCriar,
        dataInicioRelacao: '2026-01-01',
      }) as Promise<Record<string, unknown>>;

    it('decisão 26: com credenciaTodosAoCriar credencia os médicos ativos, nunca o administrativo', async () => {
      const r = await novo('a9anv1', true);
      const id = Number(r['id'] ?? (r['resultado'] as Record<string, unknown> | undefined)?.['id']);
      const cred = await credenciadosEm(id);
      expect(cred).toEqual(expect.arrayContaining([ids.prof, ids.prof2]));
      expect(cred).not.toContain(adm.id);
      // Já credenciados: o alerta da decisão 25 some para o médico, nunca para o administrativo.
      const q = { fontePagadoraId: id, planoId: null, data: DIA };
      expect((await s.verificar(ctx(), { ...q, profissionalId: ids.prof })).efeito).toBe('nenhum');
      expect((await s.verificar(ctx(), { ...q, profissionalId: adm.id })).efeito).toBe('alerta');
    });

    it('decisão 26: sem a opção, nenhum credenciamento', async () => {
      const r = await novo('a9anv2', false);
      const id = Number(r['id'] ?? (r['resultado'] as Record<string, unknown> | undefined)?.['id']);
      expect(await credenciadosEm(id)).toEqual([]);
    });

    // A conferência auxiliar isolada. Os fluxos reais (agenda.encaixar e atendimento.abrirAtendimento, com o bloqueio
    // antes do INSERT, o alerta no resultado e o credenciamento por plano e subplano) estão em
    // agenda/porta-propria.int.spec.ts e atendimento/porta-propria.int.spec.ts.
    it('decisão 25, conferência auxiliar (conferirCredenciamentoNoFluxo): alerta sem a opção, recusa com o bloqueio; plano desconhecido só alerta', async () => {
      const id = await escrever(async (e) =>
        Number((await e.uma<{ id: number }>("SELECT id FROM fonte_pagadora WHERE codigo = 'a9anv2'"))!.id),
      );
      const conferir = (fonte: number) =>
        escrever((e) =>
          conferirCredenciamentoNoFluxo(e, {
            profissionalId: ids.prof,
            fontePagadoraId: fonte,
            planoId: null,
            estabelecimentoId: ids.est,
            data: DIA,
            campo: 'profissional',
          }),
        );
      expect((await conferir(id))?.efeito).toBe('alerta');
      expect(await conferir(ids.part)).toBeNull();
      await s.definirOpcoes(op(), {
        fontePagadoraId: id,
        bloqueiaSemCredenciamento: true,
        credenciaTodosAoCriar: false,
      });
      expect(await codigoDaRecusa(conferir(id))).toBe('profissional-nao-credenciado');
      // Credenciado só no plano ouro de outro convênio não conta; no plano deste, com o plano desconhecido, só alerta.
      const planoNv2 = await escrever((e) =>
        e.inserir(
          "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, 'a9anv2pl', 'a9anv2pl', CURRENT_TIMESTAMP(3))",
          [id],
        ),
      );
      await s.incluirCredenciamento(op(), {
        profissionalId: ids.prof,
        fontePagadoraId: id,
        planoId: planoNv2,
        vigenciaInicio: '2026-01-01',
      });
      const desconhecido = await escrever((e) =>
        conferirCredenciamentoNoFluxo(e, {
          profissionalId: ids.prof,
          fontePagadoraId: id,
          planoId: null,
          planoDesconhecido: true,
          estabelecimentoId: ids.est,
          data: DIA,
          campo: 'convenio',
        }),
      );
      expect(desconhecido?.efeito).toBe('alerta');
      await s.incluirCredenciamento(op(), {
        profissionalId: ids.prof,
        fontePagadoraId: id,
        vigenciaInicio: '2026-01-01',
      });
      expect(await conferir(id)).toBeNull();
    });

    it('segundo particular sem o parâmetro do particular padrão é recusado; a consulta particular segue', async () => {
      expect(await codigoDaRecusa(novo('a9anv3', false, 'particular'))).toBe('particular-padrao-ambiguo');
      const calc = await s.calcular(ctx(), {
        fontePagadoraId: null,
        planoId: null,
        profissionalId: ids.prof,
        agendaId: ids.agenda,
        itemFaturavelId: null,
        consulta: true,
        tabelaContaId: null,
        data: DIA,
      });
      expect(calc.recusa ?? null).toBeNull();
    });

    it('particular padrão pelo parâmetro: o do estabelecimento vence o da rede', async () => {
      await escrever(async (e) => {
        const chave = 'faturamento.fontePagadoraParticularCodigo';
        let def = await e.uma<{ id: number }>('SELECT id FROM parametro_definicao WHERE chave = ?', [chave]);
        // O cliente de teste nasce sem o catálogo de parâmetros: a definição sintética entra e sai com o teste.
        const criada = def === null;
        if (criada)
          def = {
            id: await e.inserir(
              `INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, permite_estabelecimento,
                 criado_em) SELECT ?, MIN(id), 'a9a teste', 'texto', 1, 1, CURRENT_TIMESTAMP(3) FROM modulo_sistema`,
              [chave],
            ),
          };
        expect(await codigoParticularDoParametro(e, ids.est)).toBeNull();
        const ins = (nivel: string, est: number | null, valor: string) =>
          e.inserir(
            `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio, motivo,
               criado_em) VALUES (?, ?, ?, ?, '2026-01-01', 'a9a teste', CURRENT_TIMESTAMP(3))`,
            [Number(def!.id), nivel, est, valor],
          );
        await ins('rede', null, 'a9arede');
        expect(await codigoParticularDoParametro(e, ids.est)).toBe('a9arede');
        await ins('estabelecimento', ids.est, 'a9apart');
        expect(await codigoParticularDoParametro(e, ids.est)).toBe('a9apart');
        expect(await codigoParticularDoParametro(e, ids.est + 1_000_000)).toBe('a9arede');
        await e.executar(
          "DELETE FROM parametro_valor WHERE motivo = 'a9a teste' AND parametro_definicao_id = ?",
          [Number(def!.id)],
        );
        if (criada) await e.executar('DELETE FROM parametro_definicao WHERE id = ?', [Number(def!.id)]);
      });
    });
  });

  describe('lançamento na conta (faturamento.lancarItem)', () => {
    const L = {
      porta: null as unknown as PortaFaturamentoPropria,
      profZ: 0,
      conv2: 0,
      consulta: 0,
      exame: 0,
      contaPart: 0,
      contaConv: 0,
      contaConv2: 0,
      tabPart: 0,
      tabConv: 0,
    };
    const hoje = new Date().toISOString().slice(0, 10);
    const cf = (): ContextoFaturamento => ({
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-adr9-api',
      rede: 'rede-teste',
      hospital: 'a9a',
    });
    const lancar = (conta: number, codigo: number, executante: number | null = null) =>
      L.porta.executar(
        cf(),
        'faturamento.lancarItem',
        { conta, tipo: 2, codigo, quantidade: 1, data: hoje, hora: '10:00', local: 0, ato: 0, executante },
        op(),
      );
    const gravado = (item: number) =>
      nucleo.lerSomente(ctx(), (l) =>
        l.uma<Record<string, unknown>>(
          `SELECT i.valor_unitario, m.regra_preco_particular_id, m.tabela_preco_id, m.dados
             FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
            WHERE i.id = ?`,
          [item],
        ),
      );

    beforeAll(async () => {
      L.porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
      await escrever(async (e) => {
        const agora = 'CURRENT_TIMESTAMP(3)';
        const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        const pf = await um(
          "SELECT id FROM pessoa_fisica WHERE nome = 'a9a Medico Z'",
          [],
          `INSERT INTO pessoa_fisica (nome, criado_em) VALUES ('a9a Medico Z', ${agora})`,
          [],
        );
        L.profZ = await um(
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          `INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ${agora})`,
          [pf],
        );
        const pfp = await um(
          "SELECT id FROM pessoa_fisica WHERE nome = 'a9a Paciente'",
          [],
          `INSERT INTO pessoa_fisica (nome, criado_em) VALUES ('a9a Paciente', ${agora})`,
          [],
        );
        const paciente = await um(
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pfp],
          `INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, 919901, ${agora})`,
          [pfp],
        );
        L.conv2 = await um(
          "SELECT id FROM fonte_pagadora WHERE codigo = 'a9aconv2'",
          [],
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('a9aconv2', 'a9aconv2', 'operadora', ${agora})`,
          [],
        );
        await e.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 1 WHERE id = ?', [L.conv2]);
        const categoria = await um(
          "SELECT id FROM categoria_atendimento WHERE codigo = 'a9a'",
          [],
          `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('a9a', 'a9a', 'ambulatorio', ${agora})`,
          [],
        );
        const carater = await um(
          "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = 'L9'",
          [],
          `INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', 'a9a', 'teste', ${agora})`,
          [],
        );
        const tipoConta = await um(
          "SELECT id FROM tipo_conta WHERE codigo = 'a9a'",
          [],
          `INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES ('a9a', 'a9a', 'ambulatorial', ${agora})`,
          [],
        );
        const grupo = await um(
          "SELECT id FROM grupo_faturamento WHERE codigo = 'a9a'",
          [],
          `INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES ('a9a', 'a9a', 'sadt', ${agora})`,
          [],
        );
        const item = (codigo: string) =>
          um(
            'SELECT id FROM item_faturavel WHERE codigo = ?',
            [codigo],
            `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'honorario', ?, ${agora})`,
            [codigo, `a9a honorario ${codigo}`, grupo],
          );
        L.consulta = await item('91990001');
        L.exame = await item('91990002');
        // O catálogo de agendamento marca o 91990001 como consulta (é ele que leva a regra "consulta").
        await um(
          "SELECT id FROM item_agendavel WHERE codigo = 'a9acons'",
          [],
          `INSERT INTO item_agendavel (codigo, descricao, tipo_item, item_faturavel_id, duracao_minutos, criado_em)
           VALUES ('a9acons', 'a9a consulta', 'consulta', ?, 20, ${agora})`,
          [L.consulta],
        );
        const tabela = async (codigo: string, fonte: number) => {
          const t = await um(
            'SELECT id FROM tabela_preco WHERE codigo = ?',
            [codigo],
            `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
             VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ${agora})`,
            [codigo, codigo, fonte],
          );
          for (const [i, it] of [L.consulta, L.exame].entries()) {
            const pp = await um(
              'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
              [t, it],
              `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ${agora})`,
              [t, i + 1, it],
            );
            await um(
              'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
              [pp],
              `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
                 valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
               VALUES (?, 'inclusao', ${agora}, '2020-01-01', 100, 0, 0, 100, ${agora})`,
              [pp],
            );
          }
          return t;
        };
        L.tabPart = await tabela('a9atabpart', ids.part);
        L.tabConv = await tabela('a9atabconv', ids.conv);
        const tabConv2 = await tabela('a9atabconv2', L.conv2);
        const competencia = `${hoje.slice(0, 7)}-01`;
        let k = 0;
        const conta = async (fonte: number, plano: number | null, tabelaId: number, prof: number) => {
          k += 1;
          const at = await e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ${agora}, ${agora})`,
            [ids.est, `a9a-${k}`, paciente, categoria, carater, fonte, prof],
          );
          return e.inserir(
            `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
               plano_fonte_pagadora_id, tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ${agora}, ${agora})`,
            [ids.est, `a9a-C${k}`, at, paciente, fonte, plano, tipoConta, tabelaId, competencia],
          );
        };
        L.contaPart = await conta(ids.part, null, L.tabPart, L.profZ);
        L.contaConv = await conta(ids.conv, ids.ouro, L.tabConv, L.profZ);
        L.contaConv2 = await conta(L.conv2, null, tabConv2, L.profZ);
      });
      // A regra particular "consulta" do médico Z (sem agenda: atendimento direto, sem marcação).
      await s.incluirRegra(op(), {
        fontePagadoraId: ids.part,
        dono: { tipo: 'profissional', profissionalId: L.profZ },
        alvo: { tipo: 'consulta' },
        valor: 180,
        vigenciaInicio: '2026-01-01',
      });
    });

    it('particular: a consulta sem marcação leva a regra do médico antes da tabela, com a origem na memória', async () => {
      const r = await lancar(L.contaPart, 91_990_001);
      expect(Number(r.resultado['valor'])).toBe(180);
      const g = await gravado(Number(r.resultado['id']));
      expect(Number(g?.['valor_unitario'])).toBe(180);
      expect(Number(g?.['regra_preco_particular_id'])).toBeGreaterThan(0);
      expect(g?.['tabela_preco_id']).toBeNull();
      const d = (typeof g?.['dados'] === 'string' ? JSON.parse(g['dados']) : g?.['dados']) as Record<
        string,
        unknown
      >;
      expect([d['origemPreco'], d['regraEstimada']]).toEqual(['regra_particular_profissional', false]);
    });

    it('particular: o honorário que não é consulta cai na tabela; a consulta de outro executante leva a regra dele', async () => {
      const r = await lancar(L.contaPart, 91_990_002);
      expect(Number(r.resultado['valor'])).toBe(100);
      const g = await gravado(Number(r.resultado['id']));
      expect(g?.['regra_preco_particular_id']).toBeNull();
      expect(Number(g?.['tabela_preco_id'])).toBe(L.tabPart);
      // O executante do item (médico Y, regra "consulta" de 250), não o médico do atendimento (Z, 180).
      const y = await lancar(L.contaPart, 91_990_001, ids.prof2);
      expect(Number(y.resultado['valor'])).toBe(250);
    });

    it('convênio: ignora a regra particular do médico (tabela) e avisa a falta de credenciamento', async () => {
      await s.definirOpcoes(op(), {
        fontePagadoraId: ids.conv,
        bloqueiaSemCredenciamento: false,
        credenciaTodosAoCriar: false,
      });
      // O "credenciar todos" do teste da decisão 26 pode ter credenciado o médico Z numa rodada anterior.
      await escrever((e) =>
        e.executar(
          'DELETE FROM profissional_fonte_pagadora WHERE profissional_id = ? AND fonte_pagadora_id = ?',
          [L.profZ, ids.conv],
        ),
      );
      const r = await lancar(L.contaConv, 91_990_001);
      expect(Number(r.resultado['valor'])).toBe(100);
      expect(r.resultado['alerta']).toBe('profissional-nao-credenciado');
      const g = await gravado(Number(r.resultado['id']));
      expect(g?.['regra_preco_particular_id']).toBeNull();
      expect(Number(g?.['tabela_preco_id'])).toBe(L.tabConv);
    });

    it('convênio com bloqueio: recusa o lançamento sem credenciamento e aceita depois de credenciar', async () => {
      expect(await codigoDaRecusa(lancar(L.contaConv2, 91_990_001))).toBe('profissional-nao-credenciado');
      await s.incluirCredenciamento(op(), {
        profissionalId: L.profZ,
        fontePagadoraId: L.conv2,
        vigenciaInicio: '2026-01-01',
      });
      const r = await lancar(L.contaConv2, 91_990_001);
      expect(Number(r.resultado['valor'])).toBe(100);
      expect(r.resultado['alerta']).toBeUndefined();
    });

    const atendimentoDa = (conta: number) =>
      nucleo
        .lerSomente(ctx(), (l) =>
          l.uma<Record<string, unknown>>('SELECT atendimento_id FROM conta_hospitalar WHERE id = ?', [conta]),
        )
        .then((x) => Number(x?.['atendimento_id']));

    it('pendência 10: atendimento.lancarProcedimentoExtra na porta própria lança pela regra particular; a requisição de laboratório é recusada', async () => {
      const pa = new PortaAtendimentoPropria(nucleo, CLIENTE);
      const ca = cf() as unknown as Parameters<PortaAtendimentoPropria['executar']>[0];
      const og = () =>
        ({ ...op(), login: 'a9a', estacao: 'TESTE' }) as unknown as Parameters<
          PortaAtendimentoPropria['executar']
        >[3];
      const { at, lab } = await escrever(async (e) => {
        const agora = 'CURRENT_TIMESTAMP(3)';
        const at = Number(
          (await e.uma<{ a: number }>('SELECT atendimento_id AS a FROM conta_hospitalar WHERE id = ?', [
            L.contaPart,
          ]))!.a,
        );
        await e.inserir(
          `INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em) VALUES (?, ?, ${agora})`,
          [at, L.contaPart],
        );
        const catLab =
          Number(
            (await e.uma<{ id: number }>("SELECT id FROM categoria_atendimento WHERE codigo = 'a9alab'"))
              ?.id ?? 0,
          ) ||
          (await e.inserir(
            `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, laboratorio, criado_em)
             SELECT 'a9alab', 'a9a laboratório', tipo_base, 1, ${agora} FROM categoria_atendimento WHERE codigo = 'a9a'`,
          ));
        const lab = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           SELECT estabelecimento_id, 'a9a-LAB', paciente_id, ?, carater_atendimento_tiss_id, fonte_pagadora_id,
                  profissional_id, situacao, entrada_em, ${agora} FROM atendimento WHERE id = ?`,
          [catLab, at],
        );
        await e.inserir(
          `INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em) VALUES (?, ?, ${agora})`,
          [lab, L.contaPart],
        );
        return { at, lab };
      });
      const r = await pa.executar(
        ca,
        'atendimento.lancarProcedimentoExtra',
        { atendimento: at, procedimento: 91_990_001, quantidade: 1 },
        og(),
      );
      expect([Number(r.resultado['conta']), Number(r.resultado['valor'])]).toEqual([L.contaPart, 180]);
      const id = await nucleo.lerSomente(ctx(), async (l) =>
        Number(
          (
            await l.uma<{ id: number }>(
              'SELECT MAX(id) AS id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
              [L.contaPart],
            )
          )?.id,
        ),
      );
      expect(Number((await gravado(id))?.['regra_preco_particular_id'])).toBeGreaterThan(0);
      expect(
        await codigoDaRecusa(
          pa.executar(
            ca,
            'atendimento.lancarProcedimentoExtra',
            { atendimento: lab, procedimento: 91_990_001, quantidade: 1 },
            og(),
          ),
        ),
      ).toBe('requisicao-sem-extra');
    });

    it('pendência 7: com a marcação na agenda, a consulta leva a regra da agenda e o exame, a regra "exame" antes da tabela', async () => {
      const contaMarcada = await escrever(async (e) => {
        const agora = 'CURRENT_TIMESTAMP(3)';
        const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        // O 91990002 é exame no catálogo de agendamento: na marcação da agenda, leva o alvo "exame".
        await um(
          "SELECT id FROM item_agendavel WHERE codigo = 'a9aexam'",
          [],
          `INSERT INTO item_agendavel (codigo, descricao, tipo_item, item_faturavel_id, duracao_minutos, criado_em)
           VALUES ('a9aexam', 'a9a exame', 'exame', ?, 20, ${agora})`,
          [L.exame],
        );
        const cod = (t: string, extra: string, v: string) =>
          um(
            `SELECT id FROM ${t} WHERE codigo = 'a9a'`,
            [],
            `INSERT INTO ${t} (codigo, descricao${extra}, criado_em) VALUES ('a9a', 'a9a'${v}, ${agora})`,
            [],
          );
        const tipo = await cod('tipo_marcacao', ', natureza', ", 'primeira_vez'");
        const situacao = await cod('situacao_marcacao', ', significado', ", 'chegou'");
        const canal = await cod('canal_marcacao', '', '');
        const horario = await e.inserir(
          `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ${agora})`,
          [ids.est, ids.agenda, hoje, `${hoje} 10:00:00`, `${hoje} 10:20:00`],
        );
        const base = await e.uma<{ at: number; pac: number }>(
          'SELECT atendimento_id AS at, paciente_id AS pac FROM conta_hospitalar WHERE id = ?',
          [L.contaPart],
        );
        const marcacao = await e.inserir(
          `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, tipo_marcacao_id, situacao_marcacao_id,
             canal_marcacao_id, fonte_pagadora_id, paciente_id, duracao_minutos, marcado_em, responsavel_usuario_id, criado_em)
           VALUES (?, 'a9a-M1', ?, ?, ?, ?, ?, ?, 20, ${agora}, ?, ${agora})`,
          [ids.est, horario, tipo, situacao, canal, ids.part, Number(base!.pac), ids.usuario],
        );
        const at = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, marcacao_horario_id, situacao, entrada_em,
             criado_em)
           SELECT estabelecimento_id, 'a9a-M1', paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
                  fonte_pagadora_id, ?, ?, situacao, entrada_em, ${agora} FROM atendimento WHERE id = ?`,
          [ids.prof, marcacao, Number(base!.at)],
        );
        return e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             plano_fonte_pagadora_id, tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
           SELECT estabelecimento_id, 'a9a-CM1', ?, paciente_id, fonte_pagadora_id, plano_fonte_pagadora_id, tipo_conta_id,
                  tabela_preco_id, natureza, competencia, inicio_em, ${agora} FROM conta_hospitalar WHERE id = ?`,
          [at, L.contaPart],
        );
      });
      await s.incluirRegra(op(), {
        fontePagadoraId: ids.part,
        dono: { tipo: 'agenda', agendaId: ids.agenda },
        alvo: { tipo: 'exame' },
        valor: 95,
        vigenciaInicio: '2026-01-01',
      });
      // A consulta da marcação: a regra da agenda X (300, estimada pelo texto), não a tabela (100).
      const c = await lancar(contaMarcada, 91_990_001);
      expect(Number(c.resultado['valor'])).toBe(300);
      const gc = await gravado(Number(c.resultado['id']));
      const dc = (typeof gc?.['dados'] === 'string' ? JSON.parse(gc['dados']) : gc?.['dados']) as Record<
        string,
        unknown
      >;
      expect([dc['origemPreco'], dc['regraEstimada']]).toEqual(['regra_particular_agenda', true]);
      // Um exame que a agenda não oferece (não está em agenda_item_agendavel nem é o da marcação): segue a tabela.
      expect(Number((await lancar(contaMarcada, 91_990_002)).resultado['valor'])).toBe(100);
      await escrever(async (e) => {
        const ia = Number(
          (await e.uma<{ id: number }>("SELECT id FROM item_agendavel WHERE codigo = 'a9aexam'"))!.id,
        );
        await e.inserir(
          'INSERT INTO agenda_item_agendavel (agenda_servico_id, item_agendavel_id, criado_em) VALUES (?, ?, CURRENT_TIMESTAMP(3))',
          [ids.agenda, ia],
        );
      });
      // O exame da agenda: a regra "exame" da agenda (95) antes da tabela (100).
      const x = await lancar(contaMarcada, 91_990_002);
      expect(Number(x.resultado['valor'])).toBe(95);
      expect(
        Number((await gravado(Number(x.resultado['id'])))?.['regra_preco_particular_id']),
      ).toBeGreaterThan(0);
      // Sem marcação, o mesmo exame segue na tabela.
      expect(Number((await lancar(L.contaPart, 91_990_002)).resultado['valor'])).toBe(100);
    });

    it('prévia do atendimento (GET atendimento/:reg/preco): os mesmos critérios do lançamento', async () => {
      const part = await s.precoDoAtendimento(ctx(), await atendimentoDa(L.contaPart), L.consulta, hoje);
      expect([part?.valor, part?.origem]).toEqual([180, 'regra_particular_profissional']);
      const exame = await s.precoDoAtendimento(ctx(), await atendimentoDa(L.contaPart), L.exame, hoje);
      expect(exame?.valor).toBe(100);
      expect(exame?.origem).not.toMatch(/^regra_particular/);
      // Convênio sem credenciamento do médico Z e sem bloqueio: o preço da tabela, com o alerta.
      const conv = await s.precoDoAtendimento(ctx(), await atendimentoDa(L.contaConv), L.consulta, hoje);
      expect([conv?.valor, conv?.credenciamento?.efeito]).toEqual([100, 'alerta']);
      expect(await s.precoDoAtendimento(ctx(), 2_147_000_000, L.consulta, hoje)).toBeNull();
    });

    it('credenciamentos por um filtro só (ficha do profissional ou do convênio)', async () => {
      const doProf = await s.credenciamentos(ctx(), {
        profissionalId: L.profZ,
        fontePagadoraId: null,
        data: hoje,
      });
      expect(doProf.map((c) => c.fontePagadoraId)).toContain(L.conv2);
      const doConv = await s.credenciamentos(ctx(), {
        profissionalId: null,
        fontePagadoraId: L.conv2,
        data: hoje,
      });
      expect(doConv.map((c) => c.profissionalId)).toContain(L.profZ);
    });

    it('revisão da regra (PUT precos-particulares/:id): corrige o valor com a versão lida e recusa a desatualizada', async () => {
      const [regra] = await s.listarRegras(ctx(), { profissionalId: L.profZ });
      expect(regra).toBeDefined();
      const r = regra as NonNullable<typeof regra>;
      await s.revisarRegra(op(), {
        id: r.id,
        versao: r.versao,
        valores: { valor: 190, situacaoRevisao: 'confirmada' },
      });
      const p = await s.precoDoAtendimento(ctx(), await atendimentoDa(L.contaPart), L.consulta, hoje);
      expect(p?.valor).toBe(190);
      expect(
        await codigoDaRecusa(s.revisarRegra(op(), { id: r.id, versao: r.versao, valores: { valor: 1 } })),
      ).toBe('conflito-versao');
      expect(
        await codigoDaRecusa(
          s.revisarRegra(op(), { id: r.id, versao: r.versao + 1, valores: { vigenciaFim: '2025-12-31' } }),
        ),
      ).toBe('vigencia-invalida');
    });
  });
});
