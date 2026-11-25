// Contrato de efeito dos movimentos da conta (F3.7, 06-FAT linhas 14, 15 e 16) contra o MariaDB real. Massa SINTÉTICA
// com códigos "F374" (nenhuma pessoa real): a equipe do item (sequencial, grau, valor do ato pelo honorário, retirada
// marcada e restaurada na mesma linha), o kit de cobrança (cadastro, lançamento aberto e fechado, fonte errada recusada)
// e a transferência de itens para outra conta do paciente com outra fonte pagadora (item de origem "transferido",
// item novo com o preço do destino, equipe refeita sobre o honorário novo, totais refeitos, glosado, outro paciente,
// conta fechada e fora do período recusados) e para conta de outro estabelecimento (recusada sem acesso lá, aceita com
// o perfil do usuário no outro estabelecimento). O ato da equipe cobrada pelo hospital soma ao item. No fim, a massa é
// apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoMovimentosConta } from './conta-movimentos.controller.js';
import { buscarItensCobrancaPropria, movimentosContaPropria } from './conta-movimentos-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F374';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao)
      return String(
        (e.problema as unknown as Record<string, unknown>)['codigo'] ??
          (e.problema as unknown as Record<string, unknown>)['tipo'] ??
          '',
      );
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('movimentos da conta: equipe, kit e transferência (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoMovimentosConta;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-f374',
    chaveIdempotencia: `f374-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: null,
    correlacao: 'teste-f374',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f374' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const valorItem = async (id: number) =>
    Number(
      (await linhas('SELECT valor_total FROM conta_hospitalar_item WHERE id = ?', [id]))[0]!['valor_total'],
    );

  const limpar = async (e: Escritor) => {
    const contas = (
      await e.consultar<{ id: number }>('SELECT id FROM conta_hospitalar WHERE numero LIKE ?', [`${P}-%`])
    ).map((c) => Number(c.id));
    for (const id of contas)
      await e.executar(
        'DELETE p FROM conta_hospitalar_item_participante p JOIN conta_hospitalar_item i ON i.id = p.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
    for (const id of contas) {
      await e.executar(
        'DELETE ti FROM transferencia_conta_item ti JOIN transferencia_conta t ON t.id = ti.transferencia_conta_id WHERE t.conta_origem_id = ? OR t.conta_destino_id = ?',
        [id, id],
      );
      await e.executar('DELETE FROM transferencia_conta WHERE conta_origem_id = ? OR conta_destino_id = ?', [
        id,
        id,
      ]);
    }
    for (const id of contas) {
      await e.executar(
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar(
        'DELETE FROM producao_repasse WHERE conta_hospitalar_item_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?)',
        [id],
      );
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar(
      "DELETE ki FROM kit_cobranca_item ki JOIN kit_cobranca k ON k.id = ki.kit_cobranca_id WHERE k.codigo LIKE 'F374%'",
      [],
    );
    await e.executar("DELETE FROM kit_cobranca WHERE codigo LIKE 'F374%'", []);
    await e.executar("DELETE FROM plano_fonte_pagadora WHERE codigo = 'F374PL'", []);
    for (const est of [ids['est'], ids['estB']])
      if (est) await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
    if (ids['usuario']) {
      await e.executar('DELETE FROM usuario_perfil WHERE usuario_id = ?', [ids['usuario']]);
      await e.executar('DELETE FROM usuario_estabelecimento WHERE usuario_id = ?', [ids['usuario']]);
    }
    await e.executar(
      "DELETE pa FROM perfil_acao pa JOIN perfil_acesso p ON p.id = pa.perfil_acesso_id WHERE p.codigo = 'F374P'",
      [],
    );
    await e.executar("DELETE FROM perfil_acesso WHERE codigo = 'F374P'", []);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['estB'] = await g(
        'estabelecimento',
        `${P}B`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P}B SINTETICO`, `ESTAB ${P}B SINTETICO`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f374.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f374.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      // Numeração da transferência no estabelecimento sintético (configuração, como faz o "criar novo cliente").
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'transferencia_conta' AND estabelecimento_id = ?",
        [ids['est']],
        `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo,
           criado_em, versao) VALUES (?, 'transferencia_conta', NULL, 1, 1, 999999999, TRUE, ?, 1)`,
        [ids['est'], agora],
      );
      const fonte = (c: string) =>
        g(
          'fonte_pagadora',
          c,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [c, `OPERADORA SINTETICA ${c}`, agora],
        );
      ids['fonteA'] = await fonte(`${P}FA`);
      ids['fonteB'] = await fonte(`${P}FB`);
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pPac = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pPac, 837_401, agora],
      );
      const pOutro = await pessoa(`OUTRO PACIENTE SINTETICO ${P}`);
      ids['outroPaciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pOutro],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pOutro, 837_402, agora],
      );
      const prof = async (nome: string) => {
        const pf = await pessoa(nome);
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
      };
      ids['cirurgiao'] = await prof(`CIRURGIAO SINTETICO ${P}`);
      ids['auxiliar'] = await prof(`AUXILIAR SINTETICO ${P}`);
      ids['anestesista'] = await prof(`ANESTESISTA SINTETICO ${P}`);
      const funcao = (c: string, tipo: string, pct: number | null, ordemAux: number | null, ordem: number) =>
        g(
          'funcao_equipe_cobranca',
          c,
          'INSERT INTO funcao_equipe_cobranca (codigo, descricao, tipo_funcao, percentual_cobranca, ordem_auxiliar, ordem_apresentacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [c, `FUNCAO SINTETICA ${c}`, tipo, pct, ordemAux, ordem, agora],
        );
      ids['fCir'] = await funcao(`${P}CIR`, 'cirurgiao', 100, null, 1);
      ids['fAux'] = await funcao(`${P}AUX`, 'auxiliar', 30, 1, 2);
      ids['fAne'] = await funcao(`${P}ANE`, 'anestesista', 30, null, 3);
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['carater'] = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F4'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F4', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        P,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      const item = (c: string) =>
        g(
          'item_faturavel',
          c,
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [c, `PROCEDIMENTO SINTETICO ${c}`, ids['grupo'], agora],
        );
      ids['item'] = await item('83740001');
      ids['comp1'] = await item('83740002');
      ids['comp2'] = await item('83740003');
      ids['itemKit'] = await item('83740004');
      const tabela = async (c: string, fonteId: number, precos: [number, number, number][]) => {
        const t = await g(
          'tabela_preco',
          c,
          `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
           VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
          [c, `TABELA SINTETICA ${c}`, fonteId, agora],
        );
        let sq = 0;
        for (const [it, hon, total] of precos) {
          const pp = await garantir(
            e,
            'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
            [t, it],
            'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
            [t, ++sq, it, agora],
          );
          await garantir(
            e,
            'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
            [pp],
            `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
               valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
             VALUES (?, 'inclusao', ?, '2020-01-01', ?, ?, 0, ?, ?)`,
            [pp, agora, hon, total - hon, total, agora],
          );
        }
        return t;
      };
      ids['tabA'] = await tabela(`${P}TA`, ids['fonteA']!, [
        [ids['item']!, 80, 100],
        [ids['comp1']!, 0, 10],
        [ids['itemKit']!, 0, 55],
      ]);
      ids['tabB'] = await tabela(`${P}TB`, ids['fonteB']!, [[ids['item']!, 120, 150]]);
      ids['plano'] = await garantir(
        e,
        "SELECT id FROM plano_fonte_pagadora WHERE codigo = 'F374PL'",
        [],
        "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, 'F374PL', ?, ?)",
        [ids['fonteA'], `PLANO SINTETICO ${P}`, agora],
      );
      ids['motivoGlosa'] = await garantir(
        e,
        "SELECT id FROM motivo_glosa WHERE codigo_tuss = 'F374'",
        [],
        "INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('F374', ?, '2020-01-01', 'teste', ?)",
        [`MOTIVO SINTETICO ${P}`, agora],
      );
      const atendimento = (numero: string, fonteId: number, est: number, paciente: number) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
          [est, numero, paciente, ids['categoria'], ids['carater'], fonteId, ids['cirurgiao'], agora],
        );
      const conta = async (
        numero: string,
        fonteId: number,
        tabelaId: number,
        x: { est?: number; paciente?: number; situacao?: string; inicio?: string } = {},
      ) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tabela_preco_id, tipo_conta_id, natureza, competencia, inicio_em, situacao, fechada_em, fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', ?, ?, ?, ?, ?)`,
          [
            x.est ?? ids['est'],
            numero,
            await atendimento(numero, fonteId, x.est ?? ids['est']!, x.paciente ?? ids['paciente']!),
            x.paciente ?? ids['paciente'],
            fonteId,
            tabelaId,
            ids['tipoConta'],
            x.inicio ?? '2026-01-20 08:00:00',
            x.situacao ?? 'aberta',
            x.situacao === 'fechada' ? agora : null,
            x.situacao === 'fechada' ? ids['usuario'] : null,
            agora,
          ],
        );
      ids['contaOutroPaciente'] = await conta(`${P}-CX`, ids['fonteB']!, ids['tabB']!, {
        paciente: ids['outroPaciente']!,
      });
      ids['contaFechada'] = await conta(`${P}-CF`, ids['fonteB']!, ids['tabB']!, { situacao: 'fechada' });
      ids['contaFevereiro'] = await conta(`${P}-CD`, ids['fonteB']!, ids['tabB']!, {
        inicio: '2026-02-01 00:00:00',
      });
      ids['contaEstB'] = await conta(`${P}-CE`, ids['fonteA']!, ids['tabA']!, { est: ids['estB']! });
      ids['contaA'] = await conta(`${P}-CA`, ids['fonteA']!, ids['tabA']!);
      ids['contaB'] = await conta(`${P}-CB`, ids['fonteB']!, ids['tabB']!);
      // Conta só do lançamento com a equipe (outro paciente): o item novo não mexe nos totais nem nos destinos da A.
      ids['contaL'] = await conta(`${P}-CL`, ids['fonteA']!, ids['tabA']!, {
        paciente: ids['outroPaciente']!,
      });
      const lancado = (seq: number, situacao: string, motivoGlosa: number | null) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao,
             motivo_glosa_id, criado_em)
           VALUES (?, ?, ?, ?, '2026-01-21 10:00:00', 1, 100, 80, 20, 100, ?, ?, ?)`,
          [ids['contaA'], seq, ids['item'], ids['grupo'], situacao, motivoGlosa, agora],
        );
      ids['itemA'] = await lancado(1, 'lancado', null);
      ids['itemGlosado'] = await lancado(2, 'glosado', ids['motivoGlosa']!);
    });
    s = new ServicoMovimentosConta(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']!, ids['estB']!] });
    });
    await nucleo.encerrar();
  });

  it('equipe do item: sequencial pelo cirurgião, valor do ato pelo honorário, retirada marcada e restaurada', async () => {
    const r = await s.gravar('equipe', op(), {
      itemId: ids['itemA'],
      participantes: [
        { profissionalId: ids['auxiliar'], funcaoId: ids['fAux'] },
        { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
      ],
    });
    expect(r).toMatchObject({ participantes: 2 });
    const ver = () =>
      linhas(
        `SELECT profissional_id, sequencia, valor_ato, percentual_cobranca, forma_pagamento, excluido_em IS NOT NULL AS retirado
           FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id = ? ORDER BY profissional_id`,
        [ids['itemA']],
      );
    const por = (xs: Record<string, unknown>[], p: number) =>
      xs.find((x) => Number(x['profissional_id']) === p)!;
    let ps = await ver();
    expect(Number(por(ps, ids['cirurgiao']!)['sequencia'])).toBe(1);
    expect(Number(por(ps, ids['cirurgiao']!)['valor_ato'])).toBe(80);
    expect(Number(por(ps, ids['auxiliar']!)['sequencia'])).toBe(2);
    expect(Number(por(ps, ids['auxiliar']!)['valor_ato'])).toBe(24);
    expect(Number(por(ps, ids['auxiliar']!)['percentual_cobranca'])).toBe(30);
    // O ato do auxiliar (cobrado pelo hospital) soma ao item: 100 + 24; o cirurgião já está no honorário.
    expect(await valorItem(ids['itemA']!)).toBe(124);
    // Troca o auxiliar pelo anestesista: o auxiliar fica marcado (não some).
    await s.gravar('equipe', op(), {
      itemId: ids['itemA'],
      participantes: [
        { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
        {
          profissionalId: ids['anestesista'],
          funcaoId: ids['fAne'],
          formaPagamento: 'direto_fonte_pagadora',
        },
      ],
    });
    ps = await ver();
    expect(ps).toHaveLength(3);
    expect(Number(por(ps, ids['auxiliar']!)['retirado'])).toBe(1);
    expect(por(ps, ids['anestesista']!)).toMatchObject({ forma_pagamento: 'direto_fonte_pagadora' });
    // O anestesista recebe direto da fonte pagadora: o adicional do auxiliar sai e nada entra no item.
    expect(await valorItem(ids['itemA']!)).toBe(100);
    // O auxiliar volta: a mesma linha é restaurada.
    await s.gravar('equipe', op(), {
      itemId: ids['itemA'],
      participantes: [
        { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
        { profissionalId: ids['auxiliar'], funcaoId: ids['fAux'] },
      ],
    });
    ps = await ver();
    expect(ps).toHaveLength(3);
    expect(Number(por(ps, ids['auxiliar']!)['retirado'])).toBe(0);
    expect(Number(por(ps, ids['anestesista']!)['retirado'])).toBe(1);
    expect(await valorItem(ids['itemA']!)).toBe(124);
    const [ca] = await linhas('SELECT valor_itens FROM conta_hospitalar WHERE id = ?', [ids['contaA']]);
    expect(Number(ca!['valor_itens'])).toBe(224); // 124 + 100 do glosado
    const mem = await linhas(
      "SELECT COUNT(*) AS n FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ? AND operacao = 'alteracao'",
      [ids['itemA']],
    );
    expect(Number(mem[0]!['n'])).toBe(3);
    // Dois cirurgiões: recusado pelo domínio.
    expect(
      await codigoDo(
        s.gravar('equipe', op(), {
          itemId: ids['itemA'],
          participantes: [
            { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
            { profissionalId: ids['auxiliar'], funcaoId: ids['fCir'] },
          ],
        }),
      ),
    ).toBe('entrada-invalida');
    const v = await s.ler(ctxL(), (l, est) => movimentosContaPropria(l, est, ids['contaA']!));
    expect(
      v.itens.find((i) => i.id === ids['itemA'])!.equipe.map((x) => [x.sequencia, x.percentual]),
    ).toEqual([
      [1, 100],
      [2, 30],
    ]);
    // A leitura devolve a ordem do auxiliar e a de apresentação (a tela valida 1º e 2º auxiliar com elas).
    expect(v.funcoes.find((f) => f.id === ids['fAux'])).toMatchObject({
      ordemAuxiliar: 1,
      ordemApresentacao: 2,
      ativo: true,
    });
  });

  it('cadastro do kit na tela: busca do item por código e a fonte pagadora da conta na leitura', async () => {
    const achados = await s.ler(ctxL(), (l) => buscarItensCobrancaPropria(l, '8374000'));
    expect(achados.map((i) => i.id)).toEqual(expect.arrayContaining([ids['item'], ids['itemKit']]));
    expect((await s.ler(ctxL(), (l) => buscarItensCobrancaPropria(l, '83740004')))[0]?.id).toBe(
      ids['itemKit'],
    );
    expect(await s.ler(ctxL(), (l) => buscarItensCobrancaPropria(l, '8'))).toEqual([]);
    const v = await s.ler(ctxL(), (l, est) => movimentosContaPropria(l, est, ids['contaA']!));
    expect(v.fontePagadoraId).toBe(ids['fonteA']);
    expect(v.fonte.length).toBeGreaterThan(0);
  });

  it('lançamento manual com a equipe no mesmo pedido: item e equipe juntos; equipe recusada não deixa o item', async () => {
    const contar = async () =>
      Number(
        (
          await linhas('SELECT COUNT(*) AS q FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [
            ids['contaL'],
          ])
        )[0]!['q'],
      );
    const antes = await contar();
    const agora = new Date();
    // Grupo 3 (procedimentos e serviços): o item sintético 83740001 é um procedimento do catálogo.
    const pedido = {
      tipo: 3,
      codigo: 83740001,
      quantidade: 1,
      data: agora.toISOString().slice(0, 10),
      hora: '10:00',
      local: 0,
      ato: 0,
    };
    expect(
      await codigoDo(
        s.gravar('lancar.equipe', op(), {
          ...pedido,
          conta: ids['contaL'],
          equipe: [
            { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
            { profissionalId: ids['auxiliar'], funcaoId: ids['fCir'] },
          ],
        }),
      ),
    ).toBe('entrada-invalida');
    expect(await contar()).toBe(antes);
    const r = await s.gravar('lancar.equipe', op(), {
      ...pedido,
      conta: ids['contaL'],
      equipe: [
        { profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] },
        { profissionalId: ids['auxiliar'], funcaoId: ids['fAux'] },
      ],
    });
    expect(await contar()).toBe(antes + 1);
    const eq = await linhas(
      `SELECT sequencia, funcao_equipe_cobranca_id AS f, valor_ato FROM conta_hospitalar_item_participante
        WHERE conta_hospitalar_item_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [Number(r['id'])],
    );
    const hon = Number(
      (await linhas('SELECT valor_honorario FROM conta_hospitalar_item WHERE id = ?', [Number(r['id'])]))[0]![
        'valor_honorario'
      ],
    );
    expect(hon).toBeGreaterThan(0);
    expect(eq.map((x) => [Number(x['sequencia']), Number(x['f']), Number(x['valor_ato'])])).toEqual([
      [1, ids['fCir'], hon],
      [2, ids['fAux'], Math.round(hon * 30) / 100],
    ]);
  });

  it('kit de cobrança: cadastro, lançamento aberto e fechado na conta, fonte errada recusada', async () => {
    const aberto = await s.gravar('kit.cadastrar', op(), {
      codigo: `${P}KA`,
      descricao: 'KIT SINTETICO ABERTO',
      componentes: [
        { itemId: ids['comp1'], quantidade: 2 },
        { itemId: ids['comp2'], quantidade: 1 },
      ],
    });
    const fechado = await s.gravar('kit.cadastrar', op(), {
      codigo: `${P}KF`,
      descricao: 'KIT SINTETICO FECHADO',
      modo: 'fechado',
      itemId: ids['itemKit'],
      componentes: [{ itemId: ids['comp1'], quantidade: 1 }],
    });
    const deB = await s.gravar('kit.cadastrar', op(), {
      codigo: `${P}KB`,
      descricao: 'KIT SINTETICO DA FONTE B',
      fontePagadoraId: ids['fonteB'],
      componentes: [{ itemId: ids['comp1'], quantidade: 1 }],
    });
    expect(
      await codigoDo(
        s.gravar('kit.cadastrar', op(), {
          codigo: `${P}KX`,
          descricao: 'SEM ITEM',
          modo: 'fechado',
          componentes: [],
        }),
      ),
    ).toBe('entrada-invalida');
    const r = await s.gravar('kit.lancar', op(), {
      contaId: ids['contaA'],
      kitId: aberto['id'],
      vezes: 3,
      data: '2026-01-22',
    });
    expect(r).toMatchObject({ semPreco: 1 });
    const itens = await linhas(
      `SELECT i.item_faturavel_id, i.quantidade, i.valor_total, i.kit_cobranca_id, m.dados
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
        WHERE i.conta_hospitalar_id = ? AND i.kit_cobranca_id = ? ORDER BY i.sequencia`,
      [ids['contaA'], aberto['id']],
    );
    expect(
      itens.map((x) => [Number(x['item_faturavel_id']), Number(x['quantidade']), Number(x['valor_total'])]),
    ).toEqual([
      [ids['comp1'], 6, 60],
      [ids['comp2'], 3, 0],
    ]);
    const dados = itens[1]!['dados'];
    expect(typeof dados === 'string' ? dados : JSON.stringify(dados)).toContain('sem_preco_vigente');
    await s.gravar('kit.lancar', op(), { contaId: ids['contaA'], kitId: fechado['id'], data: '2026-01-22' });
    const f = await linhas(
      'SELECT item_faturavel_id, valor_total FROM conta_hospitalar_item WHERE kit_cobranca_id = ?',
      [fechado['id']],
    );
    expect(f.map((x) => [Number(x['item_faturavel_id']), Number(x['valor_total'])])).toEqual([
      [ids['itemKit'], 55],
    ]);
    expect(await codigoDo(s.gravar('kit.lancar', op(), { contaId: ids['contaA'], kitId: deB['id'] }))).toBe(
      'entrada-invalida',
    );
    const dePlano = await s.gravar('kit.cadastrar', op(), {
      codigo: `${P}KP`,
      descricao: 'KIT SINTETICO DE OUTRO PLANO',
      fontePagadoraId: ids['fonteA'],
      planoId: ids['plano'],
      componentes: [{ itemId: ids['comp1'], quantidade: 1 }],
    });
    // A conta A não tem plano: o kit do plano não entra nela.
    expect(
      await codigoDo(s.gravar('kit.lancar', op(), { contaId: ids['contaA'], kitId: dePlano['id'] })),
    ).toBe('entrada-invalida');
    const [c] = await linhas('SELECT valor_itens FROM conta_hospitalar WHERE id = ?', [ids['contaA']]);
    // 124 (item lançado com o auxiliar) + 100 (glosado: segue na soma; só estornado, transferido e sem cobrança saem)
    // + 60 + 0 + 55.
    expect(Number(c!['valor_itens'])).toBe(339);
  });

  it('transferência para a conta da outra fonte: origem transferida, preço do destino, equipe junto e totais', async () => {
    const recusada = (destino: number, itens: number[]) =>
      codigoDo(
        s.gravar('transferir', op(), {
          contaOrigemId: ids['contaA'],
          contaDestinoId: destino,
          itens,
          motivo: 'troca de convenio',
        }),
      );
    expect(await recusada(ids['contaB']!, [ids['itemGlosado']!])).toBe('entrada-invalida');
    expect(await recusada(ids['contaOutroPaciente']!, [ids['itemA']!])).toBe('entrada-invalida');
    expect(await recusada(ids['contaFechada']!, [ids['itemA']!])).toBe('entrada-invalida');
    // Item realizado em 21/01 não entra na conta que começa em 01/02.
    expect(await recusada(ids['contaFevereiro']!, [ids['itemA']!])).toBe('entrada-invalida');
    // Período fechado (C2-035): o item de 21/01 não sai da faixa fechada da origem nem entra na fechada do destino.
    for (const conta of [ids['contaA']!, ids['contaB']!]) {
      const periodo = await escrever((e) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_periodo (conta_hospitalar_id, sequencia, inicio_em, fim_em, competencia,
             fechado_em, criado_em) VALUES (?, 1, '2026-01-01 00:00:00', '2026-01-31 23:59:59.999', '2026-01-01',
             NOW(3), NOW(3))`,
          [conta],
        ),
      );
      expect(await recusada(ids['contaB']!, [ids['itemA']!])).toBe('periodo-fechado');
      await escrever((e) => e.executar('DELETE FROM conta_hospitalar_periodo WHERE id = ?', [periodo]));
    }
    const r = await s.gravar('transferir', op(), {
      contaOrigemId: ids['contaA'],
      contaDestinoId: ids['contaB'],
      itens: [ids['itemA']],
      motivo: 'troca de convenio na internacao',
    });
    expect(r).toMatchObject({
      tipo: 'fonte_pagadora',
      itens: 1,
      valorOrigem: 124,
      valorDestino: 186,
      semPreco: 0,
    });
    const [t] = await linhas(
      'SELECT tipo, situacao, fonte_pagadora_origem_id, fonte_pagadora_destino_id, valor_total_origem, valor_total_destino, usuario_id FROM transferencia_conta WHERE id = ?',
      [r['id']],
    );
    expect(t).toMatchObject({ tipo: 'fonte_pagadora', situacao: 'efetivada' });
    expect(Number(t!['valor_total_destino'])).toBe(186);
    expect(Number(t!['usuario_id'])).toBe(ids['usuario']);
    const [ti] = await linhas(
      'SELECT item_origem_id, item_destino_id, valor_origem, valor_recalculado FROM transferencia_conta_item WHERE transferencia_conta_id = ?',
      [r['id']],
    );
    expect(Number(ti!['item_origem_id'])).toBe(ids['itemA']);
    const [orig] = await linhas('SELECT situacao, excluido_em FROM conta_hospitalar_item WHERE id = ?', [
      ids['itemA'],
    ]);
    expect(orig).toMatchObject({ situacao: 'transferido', excluido_em: null });
    const [novo] = await linhas(
      'SELECT conta_hospitalar_id, situacao, valor_total, valor_honorario FROM conta_hospitalar_item WHERE id = ?',
      [ti!['item_destino_id']],
    );
    expect(Number(novo!['conta_hospitalar_id'])).toBe(ids['contaB']);
    // 150 da tabela do destino + 36 do auxiliar (30% do honorário novo de 120).
    expect(Number(novo!['valor_total'])).toBe(186);
    expect(Number(novo!['valor_honorario'])).toBe(120);
    const eq = await linhas(
      `SELECT profissional_id, sequencia, valor_ato, valor_liquido, percentual_cobranca
         FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id = ? AND excluido_em IS NULL
        ORDER BY sequencia`,
      [ti!['item_destino_id']],
    );
    expect(
      eq.map((x) => [
        Number(x['profissional_id']),
        Number(x['sequencia']),
        Number(x['valor_ato']),
        Number(x['valor_liquido']),
      ]),
    ).toEqual([
      [ids['cirurgiao'], 1, 120, 120],
      [ids['auxiliar'], 2, 36, 36],
    ]);
    // A equipe da origem fica encerrada pela transferência (marcada, com a referência; nada apagado).
    const eqOrigem = await linhas(
      `SELECT COUNT(*) AS n, SUM(excluido_em IS NULL) AS ativos, SUM(transferencia_conta_id = ?) AS pela_transferencia
         FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id = ?`,
      [r['id'], ids['itemA']],
    );
    expect(Number(eqOrigem[0]!['n'])).toBe(3);
    expect(Number(eqOrigem[0]!['ativos'])).toBe(0);
    expect(Number(eqOrigem[0]!['pela_transferencia'])).toBe(2);
    const contas = await linhas(
      'SELECT id, valor_itens FROM conta_hospitalar WHERE id IN (?, ?) ORDER BY id',
      [ids['contaA'], ids['contaB']],
    );
    const total = (id: number) => Number(contas.find((x) => Number(x['id']) === id)!['valor_itens']);
    expect(total(ids['contaB']!)).toBe(186);
    expect(total(ids['contaA']!)).toBe(215);
    // O item já transferido não muda de conta de novo.
    expect(
      await codigoDo(
        s.gravar('transferir', op(), {
          contaOrigemId: ids['contaA'],
          contaDestinoId: ids['contaB'],
          itens: [ids['itemA']],
          motivo: 'de novo',
        }),
      ),
    ).toBe('entrada-invalida');
    const v = await s.ler(ctxL(), (l, est) => movimentosContaPropria(l, est, ids['contaB']!));
    expect(v.transferencias).toHaveLength(1);
    expect(v.transferencias[0]).toMatchObject({ saiu: false, outraConta: ids['contaA'], itens: 1 });
  });

  it('transferência para conta de outro estabelecimento: só com acesso ao faturamento lá', async () => {
    ids['itemE'] = await escrever((e) =>
      e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
           realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao, criado_em)
         VALUES (?, 90, ?, ?, '2026-01-21 10:00:00', 1, 100, 80, 20, 100, 'lancado', ?)`,
        [ids['contaA'], ids['item'], ids['grupo'], new Date()],
      ),
    );
    const pedido = () =>
      s.gravar('transferir', op(), {
        contaOrigemId: ids['contaA'],
        contaDestinoId: ids['contaEstB'],
        itens: [ids['itemE']],
        motivo: 'paciente seguiu no outro estabelecimento',
      });
    const destinosVistos = async () =>
      (
        await s.ler(ctxL(), (l, est) =>
          movimentosContaPropria(l, est, ids['contaA']!, { usuario: ids['usuario']!, total: false }),
        )
      ).destinos.map((d) => d.id);
    // Sem vínculo nem perfil no outro estabelecimento: recusado, e a conta de lá nem aparece na leitura.
    expect(await codigoDo(pedido())).toBe('sem-permissao-estabelecimento');
    expect(await destinosVistos()).not.toContain(ids['contaEstB']);
    // O administrador da plataforma vê todas.
    expect(
      (
        await s.ler(ctxL(), (l, est) =>
          movimentosContaPropria(l, est, ids['contaA']!, { usuario: null, total: true }),
        )
      ).destinos.map((d) => d.id),
    ).toContain(ids['contaEstB']);
    await escrever(async (e) => {
      const agora = new Date();
      const perfil = await e.inserir(
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'F374P', ?, ?)",
        [ids['estB'], `PERFIL SINTETICO ${P}`, agora],
      );
      for (const codigo of ['faturamento.auditoria.ajustar', 'faturamento.conta.ler'])
        await e.executar(
          `INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em)
           SELECT ?, id, ? FROM acao_sistema WHERE codigo = ?`,
          [perfil, agora, codigo],
        );
      await e.executar(
        "INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, '2020-01-01', ?)",
        [ids['usuario'], ids['estB'], agora],
      );
      await e.executar(
        "INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2020-01-01', ?)",
        [ids['usuario'], perfil, ids['estB'], agora],
      );
    });
    expect(await destinosVistos()).toContain(ids['contaEstB']);
    const r = await pedido();
    expect(r).toMatchObject({ tipo: 'estabelecimento', itens: 1, valorOrigem: 100, valorDestino: 100 });
    const [t] = await linhas(
      'SELECT tipo, estabelecimento_destino_id FROM transferencia_conta WHERE id = ?',
      [r['id']],
    );
    expect(t!['tipo']).toBe('estabelecimento');
    expect(Number(t!['estabelecimento_destino_id'])).toBe(ids['estB']);
    const [ce] = await linhas('SELECT valor_itens FROM conta_hospitalar WHERE id = ?', [ids['contaEstB']]);
    expect(Number(ce!['valor_itens'])).toBe(100);
  });
  it('kit disparado pelo item: o lançamento do item gatilho lança o kit junto, vezes a quantidade', async () => {
    expect(
      await codigoDo(
        s.gravar('kit.cadastrar', op(), {
          codigo: `${P}KG0`,
          descricao: 'KIT SINTETICO GATILHO COBRADO',
          gatilhoItemId: ids['comp1'],
          componentes: [{ itemId: ids['comp1'], quantidade: 1 }],
        }),
      ),
    ).toBe('entrada-invalida');
    const kit = await s.gravar('kit.cadastrar', op(), {
      codigo: `${P}KG`,
      descricao: 'KIT SINTETICO DO GATILHO',
      gatilhoItemId: ids['item'],
      componentes: [{ itemId: ids['comp1'], quantidade: 2 }],
    });
    const [k] = await linhas('SELECT item_gatilho_id FROM kit_cobranca WHERE id = ?', [kit['id']]);
    expect(Number(k!['item_gatilho_id'])).toBe(ids['item']);
    const r = await s.gravar('lancar.equipe', op(), {
      tipo: 3,
      codigo: 83740001,
      quantidade: 2,
      data: new Date().toISOString().slice(0, 10),
      hora: '11:00',
      local: 0,
      ato: 0,
      conta: ids['contaL'],
      equipe: [{ profissionalId: ids['cirurgiao'], funcaoId: ids['fCir'] }],
    });
    expect(r).toMatchObject({ kits: `${P}KG`, itensKit: 1 });
    const doKit = await linhas(
      `SELECT i.item_faturavel_id, i.quantidade, i.valor_total, m.dados
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
        WHERE i.conta_hospitalar_id = ? AND i.kit_cobranca_id = ?`,
      [ids['contaL'], kit['id']],
    );
    expect(doKit.map((x) => [Number(x['item_faturavel_id']), Number(x['quantidade'])])).toEqual([
      [ids['comp1'], 4],
    ]);
    const dados = doKit[0]!['dados'];
    const d = typeof dados === 'string' ? dados : JSON.stringify(dados);
    expect(d).toContain('kit_gatilho');
    expect(d).toContain(`"itemGatilho":${ids['item']}`);
  });

  it('cobertura no destino na transferência dos itens marcados: sem preço lá, só com aceite e justificativa', async () => {
    // O componente só tem preço na tabela da fonte A: na conta B (fonte B) não tem cobertura.
    const semPrecoLa = await escrever((e) =>
      e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
           realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao, criado_em)
         VALUES (?, 91, ?, ?, '2026-01-21 10:00:00', 1, 10, 0, 10, 10, 'lancado', ?)`,
        [ids['contaA'], ids['comp1'], ids['grupo'], new Date()],
      ),
    );
    const pedido = (x: Record<string, unknown> = {}) =>
      s.gravar('transferir', op(), {
        contaOrigemId: ids['contaA'],
        contaDestinoId: ids['contaB'],
        itens: [semPrecoLa],
        motivo: 'troca de convenio na internacao',
        ...x,
      });
    const problema = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        if (e instanceof ErroOperacao) return JSON.stringify(e.problema);
        throw e;
      }
      throw new Error('esperava recusa');
    };
    const transferencias = async () =>
      Number(
        (
          await linhas('SELECT COUNT(*) AS n FROM transferencia_conta WHERE conta_origem_id = ?', [
            ids['contaA'],
          ])
        )[0]!['n'],
      );
    const antes = await transferencias();
    // Sem o aceite: recusado, e nada muda (o item fica lançado na origem).
    expect(await problema(pedido())).toContain('cobertura');
    // Com o aceite e sem justificativa: recusado.
    expect(await problema(pedido({ aceitarSemCobertura: true, justificativaCobertura: '' }))).toContain(
      'justificativaCobertura',
    );
    expect(await transferencias()).toBe(antes);
    const [ainda] = await linhas('SELECT situacao FROM conta_hospitalar_item WHERE id = ?', [semPrecoLa]);
    expect(ainda!['situacao']).toBe('lancado');
    // Com o aceite e a justificativa: vai com o valor da origem, e a justificativa fica na transferência.
    const r = await pedido({
      aceitarSemCobertura: true,
      justificativaCobertura: 'Cobrado no pacote do plano',
    });
    expect(r).toMatchObject({ itens: 1, semPreco: 1, valorOrigem: 10, valorDestino: 10 });
    const [t] = await linhas('SELECT observacao FROM transferencia_conta WHERE id = ?', [r['id']]);
    expect(String(t!['observacao'])).toContain('Sem cobertura no destino (1): Cobrado no pacote do plano');
    const [m] = await linhas(
      `SELECT m.dados FROM transferencia_conta_item ti
         JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = ti.item_destino_id
        WHERE ti.transferencia_conta_id = ?`,
      [r['id']],
    );
    const dados = typeof m!['dados'] === 'string' ? m!['dados'] : JSON.stringify(m!['dados']);
    expect(dados).toContain('valor_origem_sem_preco_destino');
  });
});
