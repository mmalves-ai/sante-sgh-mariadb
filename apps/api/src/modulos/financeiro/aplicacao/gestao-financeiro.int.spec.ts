// F3.8, 07-FIN linhas 98 e 99: contrato de efeito da reclassificação gerencial e das permissões do financeiro contra o
// MariaDB real (massa SINTÉTICA "L0207").
// Reclassificar o título a pagar: a natureza e o centro principal do título mudam; as linhas de rateio anteriores ficam
// no banco marcadas como substituídas (quem e quando) e as novas entram com a sequência seguinte; a trilha guarda o
// motivo e o antes e o depois. Natureza de outro tipo, igual à atual ou sem motivo: recusa e nada grava.
// Escopo de contas: a primeira linha restringe o usuário à conta dada; retirar desliga as marcas (a linha fica);
// ninguém altera o próprio escopo. Tipo de lançamento por perfil: liberado só o crédito avulso, a transferência do
// usuário do perfil é recusada e não grava; liberada a transferência, grava.
// Tipo de credor por perfil no título a pagar (a lista de cada operação é separada): liberado só outro tipo de credor,
// o título do fornecedor é recusado e não grava; liberado o fornecedor, grava; a restrição do título a pagar não mexe no
// movimento bancário, e a liberação fica com o tipo de credor (nunca com o tipo de lançamento).
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contasDoEscopo } from '../operacoes.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-gf-${randomUUID()}` });
const MOTIVO = 'natureza do documento lançada no item errado';

describe.skipIf(SEM_BANCO)('gestão do financeiro: reclassificação e permissões (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let centro2 = 0;
  let natureza112 = 0;
  let perfil = 0;
  let perfilLivre = 0;
  let perfilOutroEst = 0;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'gf-02-07' }, (l) => l.consultar(sql, p));
  const executar = (nome: string, entrada: unknown, usuario = m.lanca) => {
    const c = m.ctx(usuario);
    return porta.executar(c, nome, entrada, op(c));
  };
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-gf-02-07' }, fn) as Promise<T>;

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    const ids = await escrever<{ centro2: number; natureza112: number; perfil: number }>(async (e) => {
      const agora = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const sub = await e.uma<{ id: number }>(
        `SELECT s.id FROM subgrupo_natureza_financeira s JOIN grupo_natureza_financeira g
            ON g.id = s.grupo_natureza_financeira_id WHERE g.codigo = '9207' AND s.codigo = '1'`,
        [],
      );
      return {
        centro2: await garantir(
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [m.est, `${P}-CC2`],
          "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, ?, 'CENTRO SINTETICO L0207 DOIS', '2000-01-01', ?)",
          [m.est, `${P}-CC2`, agora],
        ),
        natureza112: await garantir(
          "SELECT id FROM natureza_financeira WHERE codigo = '9207.1.2'",
          [],
          "INSERT INTO natureza_financeira (codigo, descricao, subgrupo_natureza_financeira_id, tipo, criado_em) VALUES ('9207.1.2', 'DESPESA SINTETICA L0207 DOIS', ?, 'despesa', ?)",
          [Number(sub?.id), agora],
        ),
        perfil: await garantir(
          "SELECT id FROM perfil_acesso WHERE codigo = 'L0207-TL'",
          [],
          "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'L0207-TL', 'PERFIL SINTETICO L0207', ?)",
          [m.est, agora],
        ),
      };
    });
    ({ centro2, natureza112, perfil } = ids);
    // Um perfil livre que dá a operação (para o acúmulo de perfis) e um perfil de outro estabelecimento.
    ({ perfilLivre, perfilOutroEst } = await escrever<{ perfilLivre: number; perfilOutroEst: number }>(
      async (e) => {
        const agora = new Date();
        const garantir = async (codigo: string, est: number) => {
          const l = await e.uma<{ id: number }>('SELECT id FROM perfil_acesso WHERE codigo = ?', [codigo]);
          return l
            ? Number(l.id)
            : e.inserir(
                "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'PERFIL SINTETICO L0207', ?)",
                [est, codigo, agora],
              );
        };
        return {
          perfilLivre: await garantir('L0207-TL2', m.est),
          perfilOutroEst: await garantir('L0207-TL3', m.outroEst),
        };
      },
    ));
  });

  afterAll(async () => {
    if (!m) return;
    await escrever(async (e) => {
      const ps = [perfil, perfilLivre, perfilOutroEst];
      for (const t of [
        'permissao_tipo_lancamento',
        'restricao_tipo_lancamento_perfil',
        'perfil_acao',
        'usuario_perfil',
      ])
        await e.executar(`DELETE FROM ${t} WHERE perfil_acesso_id IN (?, ?, ?)`, ps);
      await e.executar(
        `DELETE r FROM rateio_lancamento r JOIN movimento_bancario b ON b.id = r.movimento_bancario_id
          WHERE b.estabelecimento_id = ?`,
        [m.est],
      );
    });
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.encerrar();
  });

  it('reclassifica o título a pagar: cabeçalho novo, rateio anterior substituído e não apagado, trilha com o motivo', async () => {
    const t = await executar('financeiro.criarTituloPagar', {
      ...tituloDaMassa(m, 920_798_001, 1_000),
      centroCusto: m.centro,
    });
    const titulo = Number((t.resultado as Record<string, unknown>)['tituloPagar']);
    expect(titulo).toBeGreaterThan(0);
    const entrada = {
      alvo: 'titulo_pagar',
      id: titulo,
      classificacao: { grupo: 9207, subgrupo: 1, item: 2 },
      rateio: [
        { centroCusto: m.centro, percentual: 40 },
        { centroCusto: centro2, percentual: 60 },
      ],
      motivo: MOTIVO,
    };
    // Recusas: sem motivo, natureza de receita num título de despesa; nada grava.
    expect(
      await codigoDaGravacao(executar('financeiro.reclassificarLancamento', { ...entrada, motivo: 'erro' })),
    ).toBe('reclassificacao-sem-motivo');
    expect(
      await codigoDaGravacao(
        executar('financeiro.reclassificarLancamento', {
          ...entrada,
          classificacao: { grupo: 9207, subgrupo: 2, item: 1 },
        }),
      ),
    ).toBe('reclassificacao-tipo-trocado');
    const antes = await consultar('SELECT COUNT(*) AS n FROM rateio_lancamento WHERE titulo_pagar_id = ?', [
      titulo,
    ]);

    await executar('financeiro.reclassificarLancamento', entrada);

    const [cab] = await consultar(
      'SELECT natureza_financeira_id, centro_custo_id FROM titulo_pagar WHERE id = ?',
      [titulo],
    );
    expect([Number(cab?.['natureza_financeira_id']), Number(cab?.['centro_custo_id'])]).toEqual([
      natureza112,
      centro2,
    ]);
    const linhas = await consultar(
      `SELECT sequencia, centro_custo_id, natureza_financeira_id, percentual, valor, excluido_em IS NOT NULL AS subst,
              excluido_por FROM rateio_lancamento WHERE titulo_pagar_id = ? ORDER BY sequencia`,
      [titulo],
    );
    const anteriores = Number(antes[0]?.['n'] ?? 0);
    expect(linhas.length).toBe(anteriores + 2);
    // As anteriores ficam, substituídas por quem reclassificou; as novas, vigentes, com a sequência seguinte.
    for (const l of linhas.slice(0, anteriores)) {
      expect(Number(l['subst'])).toBe(1);
      expect(Number(l['excluido_por'])).toBe(m.lanca);
    }
    expect(
      linhas
        .slice(anteriores)
        .map((l) => [
          Number(l['sequencia']),
          Number(l['centro_custo_id']),
          Number(l['natureza_financeira_id']),
          Number(l['valor']),
          Number(l['subst']),
        ]),
    ).toEqual([
      [anteriores + 1, m.centro, natureza112, 400, 0],
      [anteriores + 2, centro2, natureza112, 600, 0],
    ]);
    const [trilha] = await consultar(
      `SELECT motivo, JSON_EXTRACT(dados_depois, '$.dados.reclassificacao.naturezaDepois') AS depois,
              JSON_EXTRACT(dados_depois, '$.dados.reclassificacao.naturezaAntes') AS antes
         FROM trilha_auditoria WHERE entidade = 'titulo_pagar' AND entidade_id = ? AND estabelecimento_id = ?
        ORDER BY id DESC LIMIT 1`,
      [titulo, m.est],
    );
    expect(String(trilha?.['motivo'])).toBe(MOTIVO);
    // O antes e o depois completos do rateio, com os ids das linhas substituídas e das novas.
    const [rat] = await consultar(
      `SELECT JSON_EXTRACT(dados_depois, '$.dados.reclassificacao') AS r FROM trilha_auditoria
        WHERE entidade = 'titulo_pagar' AND entidade_id = ? AND estabelecimento_id = ? ORDER BY id DESC LIMIT 1`,
      [titulo, m.est],
    );
    const bruto = rat?.['r'];
    const r = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as {
      antes: { centroCusto: number; percentual: number; valor: number }[];
      depois: { centroCusto: number; percentual: number; valor: number }[];
      linhasSubstituidas: number[];
      linhasNovas: number[];
    };
    expect(r.antes.length).toBeGreaterThan(0);
    expect(r.antes.reduce((s, x) => s + x.valor, 0)).toBe(1_000);
    expect(r.depois).toEqual([
      { centroCusto: m.centro, percentual: 40, valor: 400 },
      { centroCusto: centro2, percentual: 60, valor: 600 },
    ]);
    const idsLinhas = await consultar(
      'SELECT id, excluido_em IS NOT NULL AS subst FROM rateio_lancamento WHERE titulo_pagar_id = ? ORDER BY sequencia',
      [titulo],
    );
    expect(r.linhasSubstituidas).toEqual(
      idsLinhas.filter((x) => Number(x['subst']) === 1).map((x) => Number(x['id'])),
    );
    expect(r.linhasNovas).toEqual(
      idsLinhas.filter((x) => Number(x['subst']) === 0).map((x) => Number(x['id'])),
    );
    expect(Number(trilha?.['depois'])).toBe(natureza112);
    expect(Number(trilha?.['antes'])).not.toBe(natureza112);
    // Igual à atual: nada a reclassificar.
    expect(await codigoDaGravacao(executar('financeiro.reclassificarLancamento', entrada))).toBe(
      'reclassificacao-sem-mudanca',
    );
  });

  it('escopo de contas: a primeira linha restringe, retirar desliga as marcas e a linha fica; o próprio escopo é recusado', async () => {
    const ler = (uso: 'consultar' | 'movimentar') =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'gf-02-07' }, (l) =>
        contasDoEscopo(l, m.est, m.paga, uso),
      );
    expect((await ler('consultar')).sort()).toEqual([m.contaA, m.contaB].sort());
    const dar = {
      usuario: m.paga,
      conta: m.contaA,
      consultar: true,
      movimentar: false,
      vigenciaInicio: null,
      vigenciaFim: null,
    };
    expect(
      await codigoDaGravacao(executar('financeiro.manterEscopoConta', { ...dar, usuario: m.lanca })),
    ).toBe('escopo-proprio');
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterEscopoConta', { ...dar, consultar: false, movimentar: true }),
      ),
    ).toBe('escopo-movimentar-sem-consultar');
    await executar('financeiro.manterEscopoConta', dar);
    expect(await ler('consultar')).toEqual([m.contaA]);
    expect(await ler('movimentar')).toEqual([]);
    await executar('financeiro.manterEscopoConta', { ...dar, consultar: false });
    expect(await ler('consultar')).toEqual([]);
    const linhas = await consultar(
      'SELECT pode_consultar, pode_movimentar, excluido_em FROM permissao_conta_bancaria WHERE usuario_id = ? AND conta_bancaria_id = ?',
      [m.paga, m.contaA],
    );
    expect(
      linhas.map((l) => [Number(l['pode_consultar']), Number(l['pode_movimentar']), l['excluido_em']]),
    ).toEqual([[0, 0, null]]);
    await escrever(async (e) => {
      await e.executar('DELETE FROM permissao_conta_bancaria WHERE usuario_id = ?', [m.paga]);
    });
  });

  it('tipo de lançamento por perfil: fora da lista é recusado e não grava; liberado, grava', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    await escrever(async (e) => {
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [m.paga, perfil, m.est, '2000-01-01', new Date()],
      );
    });
    const transfere = () =>
      executar(
        'financeiro.lancarMovimento',
        {
          tipo: 'T',
          data: hoje,
          contaCredito: m.contaB,
          contaDebito: m.contaA,
          valor: 12.34,
          historico: 'TRANSFERENCIA SINTETICA L0207 TIPO',
          classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
        },
        m.paga,
      );
    const [antes] = await consultar(
      'SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ?',
      [m.est],
    );
    // Libera um tipo que não é o da transferência: a transferência passa a ser recusada.
    const ids = (
      await consultar('SELECT id, codigo FROM tipo_lancamento_bancario WHERE ativo = TRUE ORDER BY id', [])
    ).map((r) => ({ id: Number(r['id']), codigo: String(r['codigo']) }));
    await expect(transfere()).resolves.toBeTruthy();
    const [depoisLivre] = await consultar(
      'SELECT tipo_lancamento_bancario_id AS t FROM movimento_bancario WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
      [m.est],
    );
    const tipoTransf = Number(depoisLivre?.['t']);
    const outro = ids.find((x) => x.id !== tipoTransf)!.id;
    await executar('financeiro.manterTipoLancamento', { perfil, tipo: outro, liberado: true });
    const [n1] = await consultar(
      'SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(await codigoDaGravacao(transfere())).toBe('tipo-lancamento-nao-liberado');
    const [n2] = await consultar(
      'SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(n2?.['n'])).toBe(Number(n1?.['n']));
    expect(Number(n1?.['n'])).toBeGreaterThan(Number(antes?.['n']));
    await executar('financeiro.manterTipoLancamento', { perfil, tipo: tipoTransf, liberado: true });
    expect(await codigoDaGravacao(transfere())).toBe('gravou');
    // Retirar o tipo: a linha fica marcada (histórico) e repetir o pedido é recusado.
    await executar('financeiro.manterTipoLancamento', { perfil, tipo: outro, liberado: false });
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterTipoLancamento', { perfil, tipo: outro, liberado: false }),
      ),
    ).toBe('sem-mudanca');
    const [linha] = await consultar(
      "SELECT excluido_em IS NOT NULL AS fora, excluido_por FROM permissao_tipo_lancamento WHERE perfil_acesso_id = ? AND tipo_lancamento_bancario_id = ? AND operacao = 'banco'",
      [perfil, outro],
    );
    expect([Number(linha?.['fora']), Number(linha?.['excluido_por'])]).toEqual([1, m.lanca]);
    // Retirar o ÚLTIMO tipo: o perfil continua restrito, com a lista vazia, e a transferência segue recusada.
    await executar('financeiro.manterTipoLancamento', { perfil, tipo: tipoTransf, liberado: false });
    expect(await codigoDaGravacao(transfere())).toBe('tipo-lancamento-nao-liberado');
    const [marca] = await consultar(
      "SELECT COUNT(*) AS n FROM restricao_tipo_lancamento_perfil WHERE perfil_acesso_id = ? AND estabelecimento_id = ? AND operacao = 'banco' AND excluido_em IS NULL",
      [perfil, m.est],
    );
    expect(Number(marca?.['n'])).toBe(1);
    // Dois perfis: um perfil livre que NÃO dá a operação não abre o tipo; o que dá a operação abre (acumula).
    await escrever(async (e) => {
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [m.paga, perfilLivre, m.est, '2000-01-01', new Date()],
      );
    });
    expect(await codigoDaGravacao(transfere())).toBe('tipo-lancamento-nao-liberado');
    await escrever(async (e) => {
      await e.executar(
        `INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em)
         SELECT ?, id, ? FROM acao_sistema WHERE codigo = 'financeiro.movimento.criar'`,
        [perfilLivre, new Date()],
      );
    });
    expect(await codigoDaGravacao(transfere())).toBe('gravou');
    await escrever(async (e) => {
      await e.executar('DELETE FROM usuario_perfil WHERE perfil_acesso_id = ?', [perfilLivre]);
    });
    expect(await codigoDaGravacao(transfere())).toBe('tipo-lancamento-nao-liberado');
    // Desfazer a restrição é explícito: a marca fica (excluída, com quem) e a transferência volta a passar.
    await executar('financeiro.manterRestricaoTipoLancamento', { perfil, restrito: false });
    expect(await codigoDaGravacao(transfere())).toBe('gravou');
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterRestricaoTipoLancamento', { perfil, restrito: false }),
      ),
    ).toBe('sem-mudanca');
    // Perfil de outro estabelecimento: a gravação é recusada e nada grava.
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterTipoLancamento', { perfil: perfilOutroEst, tipo: outro, liberado: true }),
      ),
    ).toBe('perfil-inexistente');
    const [nada] = await consultar(
      'SELECT COUNT(*) AS n FROM permissao_tipo_lancamento WHERE perfil_acesso_id = ?',
      [perfilOutroEst],
    );
    expect(Number(nada?.['n'])).toBe(0);
  });

  it('tipo de credor por perfil no título a pagar: fora da lista é recusado e não grava; a lista é só desta operação', async () => {
    await escrever(async (e) => {
      await e.executar('DELETE FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id IN (?, ?)', [
        m.paga,
        perfil,
        perfilLivre,
      ]);
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [m.paga, perfil, m.est, '2000-01-01', new Date()],
      );
    });
    const lancar = (documento: number) =>
      executar(
        'financeiro.criarTituloPagar',
        { ...tituloDaMassa(m, documento, 100), centroCusto: m.centro },
        m.paga,
      );
    const titulos = async () =>
      Number(
        (
          await consultar('SELECT COUNT(*) AS n FROM titulo_pagar WHERE estabelecimento_id = ?', [m.est])
        )[0]?.['n'],
      );
    // Perfil livre no título a pagar: grava, e o tipo de credor gravado é o que a lista vai guardar.
    const t1 = await lancar(920_799_001);
    const [tc] = await consultar('SELECT tipo_credor_id AS t FROM titulo_pagar WHERE id = ?', [
      Number((t1.resultado as Record<string, unknown>)['tituloPagar']),
    ]);
    const tipoDoTitulo = Number(tc?.['t']);
    // Um segundo tipo de credor a pagar (o código padrão do cadastro; a massa só garante o fornecedor).
    const outro = await escrever<number>(async (e) => {
      const l = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_credor WHERE ativo = TRUE AND sentido IN ('pagar','ambos') AND id <> ? ORDER BY id LIMIT 1",
        [tipoDoTitulo],
      );
      return l
        ? Number(l.id)
        : e.inserir(
            "INSERT INTO tipo_credor (codigo, descricao, natureza, criado_em) VALUES ('medico', 'Médico', 'medico', ?)",
            [new Date()],
          );
    });
    expect(outro).toBeGreaterThan(0);
    // Tipo que não é de credor a pagar: recusado e nada grava.
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterTipoLancamento', {
          perfil,
          tipo: 999_999_999,
          liberado: true,
          operacao: 'contas_pagar',
        }),
      ),
    ).toBe('tipo-inexistente');
    // Liberado só outro tipo de credor: o título deste credor é recusado e não grava.
    const r = await executar('financeiro.manterTipoLancamento', {
      perfil,
      tipo: outro,
      liberado: true,
      operacao: 'contas_pagar',
    });
    expect((r.resultado as Record<string, unknown>)['restringiu']).toBe(true);
    const n1 = await titulos();
    expect(await codigoDaGravacao(lancar(920_799_002))).toBe('tipo-lancamento-nao-liberado');
    expect(await titulos()).toBe(n1);
    // A liberação fica com o tipo de credor, na operação do título a pagar; a marca de restrito também.
    const linhas = await consultar(
      `SELECT operacao, tipo_credor_id, tipo_lancamento_bancario_id, estabelecimento_id, criado_por
         FROM permissao_tipo_lancamento WHERE perfil_acesso_id = ? AND operacao = 'contas_pagar'`,
      [perfil],
    );
    expect(
      linhas.map((x) => [
        Number(x['tipo_credor_id']),
        x['tipo_lancamento_bancario_id'],
        Number(x['estabelecimento_id']),
        Number(x['criado_por']),
      ]),
    ).toEqual([[outro, null, m.est, m.lanca]]);
    const marcas = await consultar(
      'SELECT operacao, excluido_em IS NULL AS vale FROM restricao_tipo_lancamento_perfil WHERE perfil_acesso_id = ? AND estabelecimento_id = ? ORDER BY operacao',
      [perfil, m.est],
    );
    // No movimento bancário a restrição foi desfeita no caso anterior e segue desfeita: uma operação não mexe na outra.
    expect(marcas.map((x) => [String(x['operacao']), Number(x['vale'])])).toEqual([
      ['banco', 0],
      ['contas_pagar', 1],
    ]);
    const hoje = new Date().toISOString().slice(0, 10);
    expect(
      await codigoDaGravacao(
        executar(
          'financeiro.lancarMovimento',
          {
            tipo: 'T',
            data: hoje,
            contaCredito: m.contaB,
            contaDebito: m.contaA,
            valor: 23.45,
            historico: 'TRANSFERENCIA SINTETICA L0207 CREDOR',
            classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
          },
          m.paga,
        ),
      ),
    ).toBe('gravou');
    // Liberado o tipo do título: grava.
    await executar('financeiro.manterTipoLancamento', {
      perfil,
      tipo: tipoDoTitulo,
      liberado: true,
      operacao: 'contas_pagar',
    });
    expect(await codigoDaGravacao(lancar(920_799_002))).toBe('gravou');
    expect(await titulos()).toBe(n1 + 1);
    // Retirar o tipo do título: a linha fica (histórico), o perfil segue restrito e o título volta a ser recusado.
    await executar('financeiro.manterTipoLancamento', {
      perfil,
      tipo: tipoDoTitulo,
      liberado: false,
      operacao: 'contas_pagar',
    });
    expect(await codigoDaGravacao(lancar(920_799_003))).toBe('tipo-lancamento-nao-liberado');
    const [fora] = await consultar(
      "SELECT excluido_em IS NOT NULL AS fora, excluido_por FROM permissao_tipo_lancamento WHERE perfil_acesso_id = ? AND operacao = 'contas_pagar' AND tipo_credor_id = ?",
      [perfil, tipoDoTitulo],
    );
    expect([Number(fora?.['fora']), Number(fora?.['excluido_por'])]).toEqual([1, m.lanca]);
    // Um perfil livre que dá a criação do título abre todos os tipos (os perfis acumulam).
    await escrever(async (e) => {
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [m.paga, perfilLivre, m.est, '2000-01-01', new Date()],
      );
      await e.executar(
        `INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em)
         SELECT ?, id, ? FROM acao_sistema WHERE codigo = 'financeiro.tituloPagar.criar'`,
        [perfilLivre, new Date()],
      );
    });
    expect(await codigoDaGravacao(lancar(920_799_003))).toBe('gravou');
    await escrever(async (e) => {
      await e.executar('DELETE FROM usuario_perfil WHERE perfil_acesso_id = ?', [perfilLivre]);
    });
    // Desfazer a restrição do título a pagar é explícito e volta a valer só a permissão da operação.
    expect(await codigoDaGravacao(lancar(920_799_004))).toBe('tipo-lancamento-nao-liberado');
    await executar('financeiro.manterRestricaoTipoLancamento', {
      perfil,
      restrito: false,
      operacao: 'contas_pagar',
    });
    expect(await codigoDaGravacao(lancar(920_799_004))).toBe('gravou');
  });
});
