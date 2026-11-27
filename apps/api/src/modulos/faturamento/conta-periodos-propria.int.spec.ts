// Contrato de efeito da conta parcial por período no faturamento (F3.7, 06-FAT linha 12) contra o MariaDB real. Massa
// SINTÉTICA com códigos "C235" (nenhuma pessoa real): itens e guias por período e competência (o estornado não conta, o
// fora de faixa fica sem período), fechamento parcial em ordem (marca fechado_em), período fechado não sai nem aceita
// lançamento na faixa, reabertura do último para o primeiro, recusada com guia do período num lote TISS. No fim, a
// massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { dataHoraParaInstante } from '@sgh/contratos';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoComplementosConta } from './conta-complementos.controller.js';
import {
  conferirLancamentoNoPeriodo,
  faturamentoPorPeriodoPropria,
  tipoLancamentoDoItem,
} from './conta-periodos-propria.js';
import { versaoTexto } from './esquemas.js';
import { conferirItem } from './operacoes.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C235';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao)
      return `${String(e.problema['codigo'] ?? e.problema.type ?? '')} ${e.message}`;
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('conta parcial por período no faturamento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoComplementosConta;
  const ids = { est: 0, paciente: 0, fonte: 0, conta: 0, guia: 0, lote: 0, jan: 0, fev: 0 };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-c235',
    chaveIdempotencia: `c235-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-c235',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c235' }, fn);
  const linha = async (sql: string, p: unknown[]) =>
    (await escrever((e) => e.consultar<Record<string, unknown>>(sql, p)))[0]!;
  const versao = async (id: number) =>
    Number((await linha('SELECT versao FROM conta_hospitalar_periodo WHERE id = ?', [id]))['versao']);
  const ler = () => s.ler(ctxL(), (l, est) => faturamentoPorPeriodoPropria(l, est, ids.conta));

  const limpar = async (e: Escritor) => {
    await e.executar(
      'DELETE FROM lote_tiss_conta WHERE lote_tiss_id IN (SELECT id FROM lote_tiss WHERE estabelecimento_id = ?)',
      [ids.est],
    );
    await e.executar('DELETE FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]);
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids.est, `${P}%`],
    );
    for (const { id } of contas) {
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM guia_tiss WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_periodo WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      await limpar(e);
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoa, 823_501, agora],
      );
      const pessoaProf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pessoaProf, agora],
      );
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['C2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('C2', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      const tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
        [ids.est, `${P}-1`, ids.paciente, categoria, carater, ids.fonte, prof, agora],
      );
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', ?)`,
        [ids.est, `${P}-C1`, atendimento, ids.paciente, ids.fonte, tipoConta, agora],
      );
      ids.guia = await e.inserir(
        `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
           numero_guia_prestador, data_emissao, criado_em) VALUES (?, ?, 'sp_sadt', ?, ?, ?, '2026-01-21', ?)`,
        [ids.est, ids.conta, ids.fonte, ids.paciente, `${P}G1`, agora],
      );
      const fat = await e.uma<{ id: number }>('SELECT id FROM item_faturavel ORDER BY id LIMIT 1', []);
      const itens: Array<[string, number, string, number | null]> = [
        ['2026-01-21 10:00:00', 100, 'lancado', ids.guia],
        ['2026-01-25 10:00:00', 50.5, 'conferido', ids.guia],
        ['2026-01-26 10:00:00', 999, 'estornado', null],
        ['2026-02-03 10:00:00', 30, 'lancado', null],
        ['2026-03-05 10:00:00', 5, 'lancado', null],
      ];
      let seq = 0;
      for (const [quando, valor, situacao, guia] of itens)
        await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, guia_tiss_id, situacao, criado_em) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [ids.conta, ++seq, Number(fat!.id), quando, valor, valor, guia, situacao, agora],
        );
    });
    s = new ServicoComplementosConta(nucleo);
    const incluir = (inicio: string, fim: string) =>
      s.gravar('periodo.incluir', op(), { contaId: ids.conta, inicio, fim });
    ids.jan = Number((await incluir('2026-01-20T08:00:00.000', '2026-01-31T23:59:59.999'))['id']);
    ids.fev = Number((await incluir('2026-02-01T00:00:00.000', '2026-02-28T23:59:59.999'))['id']);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('itens, valor e guias por período e competência; estornado fora; o que sobra fica sem período', async () => {
    const r = await ler();
    expect(r.periodos.map((p) => [p.competencia, p.itens, p.valor, p.guias, p.fechado])).toEqual([
      ['2026-01-01', 2, 150.5, [ids.guia], false],
      ['2026-02-01', 1, 30, [], false],
    ]);
    expect(r.semPeriodo).toEqual({ itens: 1, valor: 5, guias: [] });
    expect(r.porCompetencia.map((c) => [c.competencia, c.itens, c.valor])).toEqual([
      ['2026-01-01', 2, 150.5],
      ['2026-02-01', 1, 30],
    ]);
  });

  it('fechamento parcial em ordem; o fechado não sai e recusa lançamento na faixa', async () => {
    expect(
      await codigoDo(s.gravarPeriodo('periodo.fechar', op(), { id: ids.fev, versao: await versao(ids.fev) })),
    ).toMatch(/^entrada-invalida .*anterior/);
    const r = await s.gravarPeriodo('periodo.fechar', op(), { id: ids.jan, versao: await versao(ids.jan) });
    expect(r).toMatchObject({
      id: ids.jan,
      competencia: '2026-01-01',
      itens: 2,
      valor: 150.5,
      guias: String(ids.guia),
    });
    const p = await linha(
      'SELECT fechado_em, versao, excluido_em FROM conta_hospitalar_periodo WHERE id = ?',
      [ids.jan],
    );
    expect(p['fechado_em']).not.toBeNull();
    expect(p['excluido_em']).toBeNull();
    expect(
      await codigoDo(
        s.gravar('periodo.retirar', op(), {
          id: ids.jan,
          versao: Number(p['versao']),
          motivo: 'teste de retirada',
        }),
      ),
    ).toMatch(/^entrada-invalida .*reabra/);
    const quando = (d: string) => new Date(dataHoraParaInstante(d, '12:00'));
    expect(
      await codigoDo(escrever((e) => conferirLancamentoNoPeriodo(e, ids.conta, quando('2026-01-27'), null))),
    ).toMatch(/^periodo-fechado/);
    await escrever((e) => conferirLancamentoNoPeriodo(e, ids.conta, quando('2026-02-10'), null));
    // A conferência do item lançado na faixa fechada também é recusada (o item segue lançado).
    const item = await linha(
      `SELECT id, versao, item_faturavel_id FROM conta_hospitalar_item
        WHERE conta_hospitalar_id = ? AND situacao = 'lancado' ORDER BY realizado_em LIMIT 1`,
      [ids.conta],
    );
    expect(
      await codigoDo(
        nucleo.criarExecutor().executar(
          conferirItem,
          CLIENTE,
          {
            conta: ids.conta,
            itens: [{ id: Number(item['id']), versao: versaoTexto(Number(item['versao'])) }],
          },
          op(),
        ),
      ),
    ).toMatch(/^periodo-fechado/);
    expect(
      (await linha('SELECT situacao FROM conta_hospitalar_item WHERE id = ?', [item['id']]))['situacao'],
    ).toBe('lancado');
    // O tipo de lançamento do item sai da terminologia do termo equivalente (um tipo só) ou fica nulo.
    const tipo = await escrever((e) => tipoLancamentoDoItem(e, Number(item['item_faturavel_id'])));
    expect(tipo === null || Number.isInteger(tipo)).toBe(true);
    expect((await ler()).periodos.map((x) => x.fechado)).toEqual([true, false]);
  });

  it('reabertura do último para o primeiro, com motivo, recusada com guia do período num lote TISS', async () => {
    await s.gravarPeriodo('periodo.fechar', op(), { id: ids.fev, versao: await versao(ids.fev) });
    const motivo = 'item lançado com data errada';
    expect(
      await codigoDo(
        s.gravarPeriodo('periodo.reabrir', op(), { id: ids.jan, versao: await versao(ids.jan), motivo }),
      ),
    ).toMatch(/seguinte/);
    await s.gravarPeriodo('periodo.reabrir', op(), { id: ids.fev, versao: await versao(ids.fev), motivo });
    await escrever(async (e) => {
      ids.lote = await e.inserir(
        `INSERT INTO lote_tiss (estabelecimento_id, fonte_pagadora_id, numero_lote, tipo_guia, versao_padrao_tiss_id,
           gerado_em, criado_em) VALUES (?, ?, ?, 'sp_sadt', (SELECT MIN(id) FROM versao_padrao_tiss), NOW(3), NOW(3))`,
        [ids.est, ids.fonte, `${P}L1`],
      );
      await e.inserir(
        'INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, guia_tiss_id, valor, criado_em) VALUES (?, ?, ?, 150.5, NOW(3))',
        [ids.lote, ids.conta, ids.guia],
      );
    });
    expect(
      await codigoDo(
        s.gravarPeriodo('periodo.reabrir', op(), { id: ids.jan, versao: await versao(ids.jan), motivo }),
      ),
    ).toMatch(/lote TISS/);
    await escrever((e) =>
      e.executar('UPDATE lote_tiss_conta SET excluido_em = NOW(3) WHERE lote_tiss_id = ?', [ids.lote]),
    );
    await s.gravarPeriodo('periodo.reabrir', op(), { id: ids.jan, versao: await versao(ids.jan), motivo });
    const p = await linha(
      'SELECT fechado_em, fechado_por, excluido_em FROM conta_hospitalar_periodo WHERE id = ?',
      [ids.jan],
    );
    expect(p).toMatchObject({ fechado_em: null, fechado_por: null, excluido_em: null });
    expect((await ler()).periodos.map((x) => x.fechado)).toEqual([false, false]);
  });
});
