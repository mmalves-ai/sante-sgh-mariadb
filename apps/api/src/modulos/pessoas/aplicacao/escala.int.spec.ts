// Integração das portas próprias da escala de plantão e do plantão realizado contra o MariaDB real (F2.2 lote 03-04;
// cliente f22_o3; massa SINTÉTICA, nenhuma pessoa real). Contrato de efeito de cada gravação: as linhas, a `versao`, a
// trilha (trilha_auditoria) e o outbox (integracao_mensagem); recusas: conflito de versão, duplicidade, outro
// estabelecimento. A troca de plantão precisa de vínculo de trabalho, que depende dos catálogos de RH do cliente
// (tipo de vínculo, categoria do trabalhador, cargo com CBO): sem eles o teste da troca é pulado com o motivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ContextoNucleo, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import { PortaEscalaPropria } from '../escala/porta-escala-propria.js';
import { PortaRealizadoPropria } from '../escala/porta-realizado-propria.js';

const CLIENTE = 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const MARCA = `E34${Date.now().toString(36).slice(-4).toUpperCase()}`;

interface Massa {
  est: number;
  outroEst: number;
  setor: number;
  setorOutro: number;
  usuario: number;
  decisor: number;
  colab: number;
  colab2: number;
  vinculo: number | null;
  vinculo2: number | null;
  regimes: number[];
}

function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], {
      cwd: RAIZ,
      stdio: 'ignore',
    });
}

const codigoDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao
      ? String(e.problema['codigo'] ?? e.problema.title)
      : `outro: ${(e as Error).message}`;
  }
};
/** Linha da trilha como a do serviço: o evento auditável escolhe a operação do Executor. */
const linha = (evento: string, entidade: string, id: number | null = null): TrilhaDaGravacao =>
  ({
    acao: 'operacao',
    entidade,
    entidadeId: id,
    dadosAntes: null,
    dadosDepois: { evento },
    motivo: null,
  }) as never;

describe.skipIf(SEM_BANCO)('portas próprias da escala e do realizado (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEscalaPropria;
  let realizado: PortaRealizadoPropria;
  let m: Massa;
  const ctx = (est = m.est, usuario = m.usuario): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario,
    correlacao: `t-${MARCA}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `t-${MARCA}` }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo` }, async (e) => {
      const agora = new Date();
      const est = (cod: string) =>
        e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      const estId = await est(MARCA.toLowerCase());
      const outroEst = await est(`${MARCA.toLowerCase()}b`);
      const setor = (x: number, cod: string) =>
        e.inserir(
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [x, cod, `UTI ${cod} SINTETICA`, agora],
        );
      const sexo =
        Number((await e.uma<{ id: number }>("SELECT id FROM sexo WHERE sigla = 'F'"))?.id ?? 0) ||
        (await e.inserir(
          "INSERT INTO sexo (sigla, codigo, descricao, criado_em) VALUES ('F', 'feminino', 'Feminino', ?)",
          [agora],
        ));
      const usuario = await e.inserir(
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [`${MARCA.toLowerCase()}.coord`, `USUARIO SINTETICO ${MARCA}`, agora],
      );
      const decisor = await e.inserir(
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [`${MARCA.toLowerCase()}.decisor`, `USUARIO SINTETICO ${MARCA} B`, agora],
      );
      const base = String(Date.now()).slice(-9);
      const colab = (n: number) =>
        e.inserir(
          "INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, ?, '1985-03-01', ?, '07', ?)",
          [`COLABORADOR ${MARCA} ${n} SINTETICO`, `${n}${base}`.padEnd(11, '0').slice(0, 11), sexo, agora],
        );
      const c1 = await colab(8);
      const c2 = await colab(9);
      // Vínculo de trabalho: só com os catálogos de RH do cliente já carregados (nunca inventados aqui).
      const tipo = await e.uma<{ id: number }>('SELECT id FROM tipo_vinculo_trabalho ORDER BY id LIMIT 1');
      const cat = await e.uma<{ id: number }>('SELECT id FROM categoria_trabalhador ORDER BY id LIMIT 1');
      const cbo = await e
        .uma<{ id: number }>('SELECT id FROM ocupacao_cbo ORDER BY id LIMIT 1')
        .catch(() => null);
      let vinculo: number | null = null;
      let vinculo2: number | null = null;
      if (tipo && cat && cbo) {
        const cargo = await e.inserir(
          'INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [`${MARCA}-CG`, 'CARGO SINTETICO', cbo.id, '2020-01-01', agora],
        );
        const vinc = (c: number, mat: string) =>
          e.inserir(
            `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id,
               cargo_id, data_admissao, salario_base, criado_em) VALUES (?, ?, ?, ?, ?, ?, '2024-01-01', 1000, ?)`,
            [estId, c, mat, tipo.id, cat.id, cargo, agora],
          );
        vinculo = await vinc(c1, `${MARCA}1`);
        vinculo2 = await vinc(c2, `${MARCA}2`);
      }
      // Tarifa geral por hora do estabelecimento (sem setor: vale para todos), para o valor do realizado.
      await e.inserir(
        `INSERT INTO valor_hora_plantao (estabelecimento_id, descricao, forma_pagamento, valor_hora, vigencia_inicio, criado_em)
         VALUES (?, 'HORA SINTETICA', 'hora', 120.00, '2031-01-01', ?)`,
        [estId, agora],
      );
      return {
        est: estId,
        outroEst,
        setor: await setor(estId, `${MARCA}-S`),
        setorOutro: await setor(outroEst, `${MARCA}-SB`),
        usuario,
        decisor,
        colab: c1,
        colab2: c2,
        vinculo,
        vinculo2,
        regimes: [],
      };
    });
    porta = new PortaEscalaPropria(nucleo);
    realizado = new PortaRealizadoPropria(nucleo);
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
        const ests = [m.est, m.outroEst];
        const em = 'estabelecimento_id IN (?, ?)';
        await e.executar(
          `DELETE a FROM acionamento_sobreaviso a JOIN plantao p ON p.id = a.plantao_id WHERE p.${em}`,
          ests,
        );
        await e.executar(`DELETE FROM troca_plantao WHERE ${em}`, ests);
        await e.executar(
          `DELETE pe FROM publicacao_escala pe JOIN escala x ON x.id = pe.escala_id WHERE x.${em}`,
          ests,
        );
        await e.executar(`DELETE FROM plantao WHERE ${em}`, ests);
        await e.executar(`DELETE FROM valor_hora_plantao WHERE ${em}`, ests);
        await e.executar(`DELETE FROM escala WHERE ${em}`, ests);
        await e.executar('DELETE FROM vigencia_regime_colaborador WHERE colaborador_id IN (?, ?)', [
          m.colab,
          m.colab2,
        ]);
        await e.executar(`DELETE FROM vinculo_trabalho WHERE ${em}`, ests);
        await e.executar('DELETE FROM cargo WHERE codigo = ?', [`${MARCA}-CG`]);
        await e.executar('DELETE FROM regime_jornada WHERE codigo LIKE ?', [`${MARCA}%`]);
        await e.executar('DELETE FROM colaborador WHERE id IN (?, ?)', [m.colab, m.colab2]);
        await e.executar(`DELETE FROM setor_funcional WHERE ${em}`, ests);
      });
    await nucleo?.encerrar();
  });

  it('regime: inclui e altera com trava otimista, trilha na mesma transação; sigla repetida é recusada', async () => {
    const campos = {
      codigo: `${MARCA}R`,
      nome: 'Plantão 12x36 sintético',
      jornada: 2,
      contratoParcial: 0,
      folgaPadrao: null,
      minutosPlantao: 720,
      descansoMinimoMin: 660,
      limiteSemanalHoras: 44,
      acordo: null,
      ativo: true,
    };
    const id = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.regime.gravado', 'regime_jornada', r),
      (g) => g.incluirRegime({ ...campos, por: 'x' }),
    );
    m.regimes.push(id);
    expect(await porta.regime(ctx(), id)).toMatchObject({
      id,
      codigo: `${MARCA}R`,
      jornada: 2,
      limiteSemanalHoras: 44,
      versao: 1,
    });
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regime_jornada' AND entidade_id = ?",
        [id],
      ),
    ).toMatchObject({ n: 1 });
    await porta.gravarSgh(ctx(), linha('pessoas.regime.gravado', 'regime_jornada', id), (g) =>
      g.alterarRegime({ ...campos, nome: 'Plantão 12x36 alterado', id, versao: 1, por: 'x' }),
    );
    expect(await porta.regime(ctx(), id)).toMatchObject({ nome: 'Plantão 12x36 alterado', versao: 2 });
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.regime.gravado', 'regime_jornada', id), (g) =>
          g.alterarRegime({ ...campos, id, versao: 1, por: 'x' }),
        ),
      ),
    ).toBe('conflito-versao');
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.regime.gravado', 'regime_jornada'), (g) =>
          g.incluirRegime({ ...campos, por: 'x' }),
        ),
      ),
    ).toBe('regime-existente');
  });

  it('escala, plantões, publicação (outbox) e cancelamento, isolados por estabelecimento', async () => {
    const competencia = '2031-03';
    // A cobertura mínima ainda não tem coluna: informada acima de zero, a criação recusa (nunca finge gravar).
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.escala.criada', 'escala'), (g) =>
          g.incluirEscala({
            unidade: m.setor,
            setor: '',
            competencia,
            tipo: 'enfermagem',
            cobertura: { manha: 1, tarde: 1, noite: 1 },
            por: 'x',
          }),
        ),
      ),
    ).toBe('modelo-pendente');
    const escala = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.escala.criada', 'escala', r),
      (g) =>
        g.incluirEscala({
          unidade: m.setor,
          setor: '',
          competencia,
          tipo: 'enfermagem',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'x',
        }),
    );
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.escala.criada', 'escala', escala), (g) =>
          g.alterarCobertura({
            id: escala,
            versao: 1,
            cobertura: { manha: 2, tarde: 2, noite: 1 },
            por: 'x',
          }),
        ),
      ),
    ).toBe('modelo-pendente');
    expect(porta.coberturaRegistrada).toBe(false);
    expect(await porta.escala(ctx(), escala)).toMatchObject({
      estado: 'rascunho',
      competencia,
      unidade: m.setor,
      versao: 1,
      plantoes: 0,
    });
    expect(await porta.escala(ctx(m.outroEst), escala)).toBeNull();
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.escala.criada', 'escala'), (g) =>
          g.incluirEscala({
            unidade: m.setor,
            setor: '',
            competencia,
            tipo: 'enfermagem',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
            por: 'x',
          }),
        ),
      ),
    ).toBe('escala-existente');
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.escala.criada', 'escala'), (g) =>
          g.incluirEscala({
            unidade: m.setorOutro,
            setor: '',
            competencia,
            tipo: 'medica',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
            por: 'x',
          }),
        ),
      ),
    ).toBe('setor-inexistente');
    const plantao = (inicio: string, fim: string, tipo = 'presencial') =>
      porta.gravarSgh(
        ctx(),
        (r: number) => linha('pessoas.plantao.gravado', 'plantao', r),
        (g) =>
          g.incluirPlantao({
            escala,
            vinculo: m.vinculo ?? 0,
            pessoa: m.colab,
            profissional: null,
            registro: null,
            tipo,
            inicio,
            fim,
            chegadaMin: null,
            alertaConselho: null,
            redeNaoConferida: false,
            motivo: null,
            por: 'x',
          }),
      );
    const p1 = await plantao('2031-03-02T07:00', '2031-03-02T19:00');
    const p2 = await plantao('2031-03-03T19:00', '2031-03-04T07:00', 'sobreaviso');
    const lidos = await porta.plantoesDaEscala(ctx(), escala);
    expect(lidos.map((p) => [p.id, p.inicio, p.fim, p.situacao, p.pessoa])).toEqual([
      [p1, '2031-03-02T07:00', '2031-03-02T19:00', 'previsto', m.colab],
      [p2, '2031-03-03T19:00', '2031-03-04T07:00', 'previsto', m.colab],
    ]);
    const janela = { de: '2031-03-02T00:00', ate: '2031-03-03T00:00', inicioDesde: '2031-03-01T00:00' };
    expect((await porta.plantoesDaPessoa(ctx(), m.colab, janela)).map((p) => p.id)).toEqual([p1]);
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.plantao.gravado', 'plantao', p1), (g) =>
          g.alterarPlantao({
            id: p1,
            versao: 9,
            tipo: 'presencial',
            inicio: '2031-03-02T08:00',
            fim: '2031-03-02T20:00',
            chegadaMin: null,
            registro: null,
            alertaConselho: null,
            redeNaoConferida: false,
            motivo: null,
            por: 'x',
          }),
        ),
      ),
    ).toBe('conflito-versao');
    // Publicação: a escala (versão lida), a linha da publicação e a mensagem de saída na mesma transação.
    const v = (await porta.escala(ctx(), escala))!.versao;
    await porta.gravarSgh(ctx(), linha('pessoas.escala.publicada', 'escala', escala), async (g) => {
      await g.publicarEscala({
        id: escala,
        versao: v,
        justificativaFuro: 'Furo sintético justificado',
        por: 'x',
      });
      await g.outbox({ tipo: 'pessoas.escala.publicada', chave: `t:${escala}`, carga: { escala } });
    });
    expect(await porta.escala(ctx(), escala)).toMatchObject({
      estado: 'publicada',
      versao: v + 1,
      justificativaFuro: 'Furo sintético justificado',
      plantoes: 2,
    });
    expect((await porta.eventos(ctx(), escala)).map((e) => e.acao)).toEqual(['publicada']);
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'pessoas.escala.publicada' AND estabelecimento_id = ?",
        [m.est],
      ),
    ).toMatchObject({ n: 1 });
    // Quem está de plantão agora e o acionamento do sobreaviso.
    expect(
      (await porta.plantoesNoInstante(ctx(), '2031-03-02T10:00', '2031-03-01T10:00', {})).map((p) => p.id),
    ).toEqual([p1]);
    const a = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.sobreaviso.acionado', 'acionamento_sobreaviso', r),
      (g) =>
        g.incluirAcionamento({
          plantao: p2,
          acionadoEm: '2031-03-03T22:00',
          prazoChegada: '2031-03-03T22:40',
          motivo: 'Chamado sintético',
          atendimento: null,
          por: 'x',
        }),
    );
    // Sem o prazo no modelo, o prazo volta nulo (atraso não calculável), nunca o horário do chamado.
    expect(await porta.acionamento(ctx(), a)).toMatchObject({
      situacao: 'acionado',
      acionadoEm: '2031-03-03T22:00',
      prazoChegada: null,
      versao: 1,
    });
    await porta.gravarSgh(ctx(), linha('pessoas.sobreaviso.acionado', 'acionamento_sobreaviso', a), (g) =>
      g.registrarChegada({ id: a, versao: 1, chegouEm: '2031-03-03T22:30', por: 'x' }),
    );
    expect(await porta.acionamento(ctx(), a)).toMatchObject({
      situacao: 'chegou',
      chegouEm: '2031-03-03T22:30',
      versao: 2,
    });
    expect(
      await codigoDe(
        porta.gravarSgh(ctx(), linha('pessoas.sobreaviso.acionado', 'acionamento_sobreaviso', a), (g) =>
          g.cancelarAcionamento({ id: a, versao: 2, motivo: 'tarde', por: 'x' }),
        ),
      ),
    ).toBe('conflito-versao');
    expect(await porta.dependenciasEscala(ctx(), escala)).toEqual([
      {
        grupo: 'Acionamentos do sobreaviso',
        tabela: 'acionamento_sobreaviso',
        coluna: 'plantao_id',
        quantidade: 1,
      },
    ]);
    // Uma operação do Executor por ação, com o nome da ação (e não uma genérica).
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'pessoas.escala.publicar' AND usuario_id = ?",
        [m.usuario],
      ),
    ).toMatchObject({ n: 1 });
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'pessoas.escala.gravacao' AND usuario_id = ?",
        [m.usuario],
      ),
    ).toMatchObject({ n: 0 });
    expect(
      (await realizado.plantoes(ctx(), { de: '2031-03-01', ate: '2031-03-31' })).map((p) => p.plantao),
    ).toEqual([p1, p2]);
    // Cancelamento: os previstos cancelados, a escala com motivo e a linha da publicação.
    const v2 = (await porta.escala(ctx(), escala))!.versao;
    const n = await porta.gravarSgh(ctx(), linha('pessoas.escala.cancelada', 'escala', escala), (g) =>
      g.cancelarEscala({ id: escala, versao: v2, motivo: 'Cancelamento sintético da escala', por: 'x' }),
    );
    expect(n).toBe(2);
    // Cada plantão cancelado tem a sua linha de auditoria (alteração auditada, versão nova), nada em massa.
    expect(await um('SELECT situacao, versao FROM plantao WHERE id = ?', [p1])).toMatchObject({
      situacao: 'cancelado',
      versao: 2,
    });
    expect(await porta.escala(ctx(), escala)).toMatchObject({
      estado: 'cancelada',
      motivoCancelamento: 'Cancelamento sintético da escala',
      plantoes: 0,
    });
    expect((await porta.eventos(ctx(), escala)).map((e) => e.acao)).toEqual(['cancelada', 'publicada']);
  });

  it('rascunho sem vínculo é excluído com os plantões', async () => {
    const escala = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.escala.criada', 'escala', r),
      (g) =>
        g.incluirEscala({
          unidade: m.setor,
          setor: '',
          competencia: '2031-04',
          tipo: 'medica',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'x',
        }),
    );
    await porta.gravarSgh(ctx(), linha('pessoas.plantao.gravado', 'plantao'), (g) =>
      g.incluirPlantao({
        escala,
        vinculo: 0,
        pessoa: m.colab2,
        profissional: null,
        registro: null,
        tipo: 'presencial',
        inicio: '2031-04-02T07:00',
        fim: '2031-04-02T19:00',
        chegadaMin: null,
        alertaConselho: null,
        redeNaoConferida: false,
        motivo: null,
        por: 'x',
      }),
    );
    const r = await porta.gravarSgh(ctx(), linha('pessoas.escala.excluida', 'escala', escala), (g) =>
      g.excluirEscalaRascunho({ id: escala, versao: 1, motivo: 'Exclusão sintética', por: 'x' }),
    );
    expect(r).toEqual({ retratos: 2, plantoes: 1 });
    expect(await porta.escala(ctx(), escala)).toBeNull();
  });

  it('idempotência pela correlação da requisição: o mesmo pedido repetido não grava de novo', async () => {
    const c = { ...ctx(), correlacao: `req-${MARCA}-0000000001` };
    const criar = () =>
      porta.gravarSgh(
        c,
        (r: number) => linha('pessoas.escala.criada', 'escala', r),
        (g) =>
          g.incluirEscala({
            unidade: m.setor,
            setor: '',
            competencia: '2031-08',
            tipo: 'medica',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
            por: 'x',
          }),
      );
    const a = await criar();
    expect(await criar()).toBe(a);
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM escala WHERE estabelecimento_id = ? AND competencia = '2031-08-01'",
        [m.est],
      ),
    ).toMatchObject({ n: 1 });
  });

  it('realizado sobre o plantão: informa, recusa, informa de novo e aprova por outra pessoa; valor pela tarifa; repasse aguarda o modelo', async () => {
    const escala = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.escala.criada', 'escala', r),
      (g) =>
        g.incluirEscala({
          unidade: m.setor,
          setor: '',
          competencia: '2031-06',
          tipo: 'enfermagem',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'x',
        }),
    );
    const p = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.plantao.gravado', 'plantao', r),
      (g) =>
        g.incluirPlantao({
          escala,
          vinculo: 0,
          pessoa: m.colab,
          profissional: null,
          registro: null,
          tipo: 'presencial',
          inicio: '2031-06-02T07:00',
          fim: '2031-06-02T19:00',
          chegadaMin: null,
          alertaConselho: null,
          redeNaoConferida: false,
          motivo: null,
          por: 'x',
        }),
    );
    await porta.gravarSgh(ctx(), linha('pessoas.escala.publicada', 'escala', escala), (g) =>
      g.publicarEscala({ id: escala, versao: 1, justificativaFuro: null, por: 'x' }),
    );
    const tarifas = await realizado.tarifas(ctx());
    expect(tarifas.filter((t) => t.tipo === 'presencial')).toMatchObject([
      { unidade: null, valorHora: 120, inicio: '2031-01-01', fim: null },
    ]);
    const informar = (inicio: string, fim: string) =>
      realizado.gravarSgh(
        ctx(),
        (r: number) => linha('pessoas.realizado.registrado', 'plantao', r),
        (g) =>
          g.incluirRealizado({
            plantao: p,
            vinculo: 0,
            inicio,
            fim,
            minutos: 0,
            origem: 'informado',
            observacao: null,
            por: 'x',
          }),
      );
    expect(await informar('2031-06-02T07:00', '2031-06-02T19:30')).toBe(p);
    const r1 = (await realizado.realizado(ctx(), p))!;
    expect(r1).toMatchObject({
      plantao: p,
      situacao: 'informado',
      inicio: '2031-06-02T07:00',
      fim: '2031-06-02T19:30',
      minutos: 750,
      valor: null,
    });
    expect(
      await um('SELECT situacao, revisado, revisado_por_usuario_id, aprovado FROM plantao WHERE id = ?', [p]),
    ).toMatchObject({
      situacao: 'realizado',
      revisado: 1,
      revisado_por_usuario_id: m.usuario,
      aprovado: 0,
    });
    const decidir = (usuario: number, versao: number, situacao: 'aprovado' | 'recusado') =>
      realizado.gravarSgh(ctx(m.est, usuario), linha('pessoas.realizado.decidido', 'plantao', p), (g) =>
        g.decidirRealizado({
          id: p,
          versao,
          situacao,
          motivo: situacao === 'recusado' ? 'Horário sem conferência' : null,
          tarifa: null,
          valorHora: null,
          valor: null,
          por: 'x',
        }),
      );
    // Quatro olhos: quem registrou não decide.
    expect(await codigoDe(decidir(m.usuario, r1.versao, 'aprovado'))).toBe('quatro-olhos');
    await decidir(m.decisor, r1.versao, 'recusado');
    expect(await realizado.realizado(ctx(), p)).toMatchObject({
      situacao: 'recusado',
      versao: r1.versao + 1,
    });
    expect(await um('SELECT situacao, aprovado_por_usuario_id FROM plantao WHERE id = ?', [p])).toMatchObject(
      { situacao: 'previsto', aprovado_por_usuario_id: m.decisor },
    );
    await informar('2031-06-02T07:00', '2031-06-02T19:00');
    const r2 = (await realizado.realizado(ctx(), p))!;
    expect(r2.situacao).toBe('informado');
    expect(await codigoDe(decidir(m.decisor, r2.versao - 1, 'aprovado'))).toBe('conflito-versao');
    await decidir(m.decisor, r2.versao, 'aprovado');
    expect(await realizado.realizado(ctx(), p)).toMatchObject({
      situacao: 'aprovado',
      minutos: 720,
      valorHora: 120,
      valor: 1440,
    });
    expect((await realizado.realizadosAprovados(ctx(), '2031-06-01', '2031-06-30')).map((x) => x.id)).toEqual(
      [p],
    );
    expect(await realizado.realizado(ctx(m.outroEst), p)).toBeNull();
    // Lançamento, estorno e inclusão de tarifa aguardam o modelo: 409 com o motivo, nunca sucesso falso.
    expect(await realizado.podeGravar(ctx(), 'repasse.lancarEvento')).toMatchObject({
      pode: false,
      codigo: 'modelo-pendente',
    });
    expect(await codigoDe(realizado.executar())).toBe('modelo-pendente');
    expect(
      await codigoDe(
        realizado.gravarSgh(ctx(), linha('pessoas.tarifa_plantao.gravada', 'valor_hora_plantao'), (g) =>
          g.incluirTarifa({
            tipo: 'sobreaviso',
            unidade: null,
            inicio: '2031-07-01',
            fim: null,
            valorHora: 50,
            por: 'x',
          }),
        ),
      ),
    ).toBe('modelo-pendente');
  });

  it('vigências de regime: retroativa termina na véspera da seguinte, anulação reabre a anterior, mesma data reativa a anulada', async (t) => {
    if (m.vinculo === null || m.regimes.length === 0) t.skip();
    const atribuir = (desde: string) =>
      porta.gravarSgh(
        ctx(),
        (r: number) => linha('pessoas.regime.atribuido', 'vigencia_regime_colaborador', r),
        (g) => g.atribuirRegime({ vinculo: m.vinculo!, regime: m.regimes[0]!, desde, por: 'x' }),
      );
    const periodos = async () =>
      (
        await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `t-${MARCA}` }, (l) =>
          l.consultar(
            "SELECT id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM vigencia_regime_colaborador WHERE colaborador_id = ? AND operacao <> 'exclusao' ORDER BY vigencia_inicio",
            [m.colab],
          ),
        )
      ).map((r) => [r['ini'], r['fim'] ?? null]);
    const a = await atribuir('2030-01-01');
    const b = await atribuir('2030-06-01');
    expect(await periodos()).toEqual([
      ['2030-01-01', '2030-05-31'],
      ['2030-06-01', null],
    ]);
    // Retroativa entre as duas: termina na véspera da seguinte (nunca dois períodos abertos).
    const c = await atribuir('2030-03-01');
    expect(await periodos()).toEqual([
      ['2030-01-01', '2030-02-28'],
      ['2030-03-01', '2030-05-31'],
      ['2030-06-01', null],
    ]);
    expect(await codigoDe(atribuir('2030-03-01'))).toBe('vigencia-repetida');
    // Anular a do meio reabre a anterior até o fim da anulada.
    await porta.gravarSgh(
      ctx(),
      linha('pessoas.regime.vigencia_anulada', 'vigencia_regime_colaborador', c),
      (g) => g.anularVigencia({ id: c, motivo: 'Anulação sintética', por: 'x' }),
    );
    expect(await periodos()).toEqual([
      ['2030-01-01', '2030-05-31'],
      ['2030-06-01', null],
    ]);
    // A mesma data da anulada: a linha anulada é reativada (o UNIQUE do banco vale para as anuladas).
    expect(await atribuir('2030-03-01')).toBe(c);
    expect(await periodos()).toEqual([
      ['2030-01-01', '2030-02-28'],
      ['2030-03-01', '2030-05-31'],
      ['2030-06-01', null],
    ]);
    expect([a, b].every((x) => x > 0)).toBe(true);
  });

  it('troca de plantão entre colegas: pedida, aceita e aprovada, com a trava de troca aberta', async (t) => {
    if (m.vinculo === null || m.vinculo2 === null) t.skip();
    const escala = await porta.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.escala.criada', 'escala', r),
      (g) =>
        g.incluirEscala({
          unidade: m.setor,
          setor: '',
          competencia: '2031-05',
          tipo: 'multiprofissional',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'x',
        }),
    );
    const novo = (pessoa: number, vinculo: number, dia: string) =>
      porta.gravarSgh(
        ctx(),
        (r: number) => linha('pessoas.plantao.gravado', 'plantao', r),
        (g) =>
          g.incluirPlantao({
            escala,
            vinculo,
            pessoa,
            profissional: null,
            registro: null,
            tipo: 'presencial',
            inicio: `${dia}T07:00`,
            fim: `${dia}T19:00`,
            chegadaMin: null,
            alertaConselho: null,
            redeNaoConferida: false,
            motivo: null,
            por: 'x',
          }),
      );
    const meu = await novo(m.colab, m.vinculo!, '2031-05-02');
    const dele = await novo(m.colab2, m.vinculo2!, '2031-05-03');
    const pedir = () =>
      porta.gravarSgh(
        ctx(),
        (r: number) => linha('pessoas.troca.pedida', 'troca_plantao', r),
        (g) =>
          g.incluirTroca({
            tipo: 'troca',
            plantao: meu,
            versaoPlantao: 1,
            vinculo: m.vinculo!,
            vinculoColega: m.vinculo2!,
            plantaoColega: dele,
            versaoColega: 1,
            motivo: 'Troca sintética',
            por: 'x',
          }),
      );
    const troca = await pedir();
    expect(await codigoDe(pedir())).toBe('troca-aberta');
    expect(await porta.plantoesEmTrocaAberta(ctx(), [meu, dele])).toEqual(new Set([meu, dele]));
    await porta.gravarSgh(ctx(), linha('pessoas.troca.respondida', 'troca_plantao', troca), (g) =>
      g.responderTroca({ id: troca, versao: 1, estado: 'aceita', confirmacao: null, por: 'x' }),
    );
    await porta.gravarSgh(ctx(), linha('pessoas.troca.decidida', 'troca_plantao', troca), (g) =>
      g.decidirTroca({ id: troca, versao: 2, estado: 'aprovada', motivo: null, por: 'x' }),
    );
    expect(await porta.troca(ctx(), troca)).toMatchObject({
      estado: 'aprovada',
      vinculo: m.vinculo,
      vinculoColega: m.vinculo2,
      versao: 3,
    });
    expect((await porta.trocas(ctx(), { vinculos: [m.vinculo2!] })).map((x) => x.id)).toEqual([troca]);
    expect(await porta.plantoesEmTrocaAberta(ctx(), [meu, dele])).toEqual(new Set());
  });
});
