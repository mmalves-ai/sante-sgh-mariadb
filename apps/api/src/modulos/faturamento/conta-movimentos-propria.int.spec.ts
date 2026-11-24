// Contrato de efeito dos movimentos da conta (F3.7, 06-FAT linhas 14, 15 e 16) contra o MariaDB real. Massa SINTÉTICA
// com códigos "F374" (nenhuma pessoa real): a equipe do item (sequencial, grau, valor do ato pelo honorário, retirada
// marcada e restaurada na mesma linha), o kit de cobrança (cadastro, lançamento aberto e fechado, fonte errada recusada)
// e a transferência de itens para outra conta do paciente com outra fonte pagadora (item de origem "transferido",
// item novo com o preço do destino, equipe junto, totais refeitos, glosado recusado). No fim, a massa é apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoMovimentosConta } from './conta-movimentos.controller.js';
import { movimentosContaPropria } from './conta-movimentos-propria.js';

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
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema['tipo'] ?? '');
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

  const limpar = async (e: Escritor) => {
    const contas = (
      await e.consultar<{ id: number }>('SELECT id FROM conta_hospitalar WHERE numero LIKE ?', [`${P}-%`])
    ).map((c) => Number(c.id));
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
        'DELETE p FROM conta_hospitalar_item_participante p JOIN conta_hospitalar_item i ON i.id = p.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
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
    if (ids['est']) await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
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
      await limpar(e);
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f374.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f374.teste', `USUARIO SINTETICO ${P}`, agora],
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
      const atendimento = (numero: string, fonteId: number) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
          [
            ids['est'],
            numero,
            ids['paciente'],
            ids['categoria'],
            ids['carater'],
            fonteId,
            ids['cirurgiao'],
            agora,
          ],
        );
      const conta = async (numero: string, fonteId: number, tabelaId: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tabela_preco_id, tipo_conta_id, natureza, competencia, inicio_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', ?)`,
          [
            ids['est'],
            numero,
            await atendimento(numero, fonteId),
            ids['paciente'],
            fonteId,
            tabelaId,
            ids['tipoConta'],
            agora,
          ],
        );
      ids['contaA'] = await conta(`${P}-CA`, ids['fonteA']!, ids['tabA']!);
      ids['contaB'] = await conta(`${P}-CB`, ids['fonteB']!, ids['tabB']!);
      const lancado = (seq: number, situacao: string, motivoGlosa: number | null) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao,
             motivo_glosa_id, criado_em)
           VALUES (?, ?, ?, ?, '2026-01-21 10:00:00', 1, 100, 80, 20, 100, ?, ?, ?)`,
          [ids['contaA'], seq, ids['item'], ids['grupo'], situacao, motivoGlosa, agora],
        );
      ids['itemA'] = await lancado(1, 'lancado', null);
      const motivo = await e.uma<{ id: number }>('SELECT id FROM motivo_glosa LIMIT 1', []);
      if (motivo) ids['itemGlosado'] = await lancado(2, 'glosado', Number(motivo.id));
    });
    s = new ServicoMovimentosConta(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']!] });
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
        `SELECT profissional_id, sequencia, valor_ato, forma_pagamento, excluido_em IS NOT NULL AS retirado
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
    expect(v.itens.find((i) => i.id === ids['itemA'])!.equipe.map((x) => x.sequencia)).toEqual([1, 2]);
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
    expect(String(itens[1]!['dados'])).toContain('sem_preco_vigente');
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
    const [c] = await linhas('SELECT valor_itens FROM conta_hospitalar WHERE id = ?', [ids['contaA']]);
    // 100 (item lançado) + 60 + 0 + 55 (o glosado não está fora da soma do total: só estornado, transferido e sem cobrança).
    expect(Number(c!['valor_itens'])).toBe(ids['itemGlosado'] ? 315 : 215);
  });

  it('transferência para a conta da outra fonte: origem transferida, preço do destino, equipe junto e totais', async () => {
    if (ids['itemGlosado'])
      expect(
        await codigoDo(
          s.gravar('transferir', op(), {
            contaOrigemId: ids['contaA'],
            contaDestinoId: ids['contaB'],
            itens: [ids['itemGlosado']],
            motivo: 'troca de convenio',
          }),
        ),
      ).toBe('entrada-invalida');
    const r = await s.gravar('transferir', op(), {
      contaOrigemId: ids['contaA'],
      contaDestinoId: ids['contaB'],
      itens: [ids['itemA']],
      motivo: 'troca de convenio na internacao',
    });
    expect(r).toMatchObject({
      tipo: 'fonte_pagadora',
      itens: 1,
      valorOrigem: 100,
      valorDestino: 150,
      semPreco: 0,
    });
    const [t] = await linhas(
      'SELECT tipo, situacao, fonte_pagadora_origem_id, fonte_pagadora_destino_id, valor_total_origem, valor_total_destino, usuario_id FROM transferencia_conta WHERE id = ?',
      [r['id']],
    );
    expect(t).toMatchObject({ tipo: 'fonte_pagadora', situacao: 'efetivada' });
    expect(Number(t!['valor_total_destino'])).toBe(150);
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
    expect(Number(novo!['valor_total'])).toBe(150);
    expect(Number(novo!['valor_honorario'])).toBe(120);
    const eq = await linhas(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id = ? AND excluido_em IS NULL',
      [ti!['item_destino_id']],
    );
    expect(Number(eq[0]!['n'])).toBe(2);
    const contas = await linhas(
      'SELECT id, valor_itens FROM conta_hospitalar WHERE id IN (?, ?) ORDER BY id',
      [ids['contaA'], ids['contaB']],
    );
    const total = (id: number) => Number(contas.find((x) => Number(x['id']) === id)!['valor_itens']);
    expect(total(ids['contaB']!)).toBe(150);
    expect(total(ids['contaA']!)).toBe(ids['itemGlosado'] ? 215 : 115);
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
});
