// Contrato de efeito dos ajustes de valor na conta (F3.7, 06-FAT linhas 17, 18 e 20) contra o MariaDB real. Massa
// SINTÉTICA com códigos "F375" (nenhuma pessoa real):
// - horário especial: faixa noturna e de feriado gravadas; o item da noite e o do feriado recebem o acréscimo (sem
//   acumular), o do dia útil não; o total da conta é refeito;
// - ajuste da conta: desconto pedido fica pendente e não muda o total; quem pediu não aprova; outro usuário aprova e o
//   total cai; o recusado fica gravado com o decisor;
// - pacote: versão nova fecha a anterior; exceção e teto gravados; aplicar lança o item do pacote, deixa o incluso sem
//   cobrança e o da exceção cobrado; descaracterizar grava motivo e autor, devolve o incluso à cobrança e estorna o item
//   do pacote (nada apagado).
// - correções da revisão: acréscimo manual do item e desconto do cabeçalho sem linha de ajuste preservados ao aplicar
//   o horário; alçada por valor (pedido de aprovação gravado, decisor sem alçada suficiente recusado, decisão gravada);
//   conta de data antiga segue o retrato da versão encerrada do pacote; outro estabelecimento é recusado sem gravar.
// No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoAjustesConta } from './conta-ajustes.controller.js';
import { ajustesContaPropria, pacotesContaPropria } from './conta-ajustes-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F375';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('ajustes de valor na conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoAjustesConta;
  const ids = {
    est: 0,
    paciente: 0,
    prof: 0,
    fonte: 0,
    categoria: 0,
    carater: 0,
    tipoConta: 0,
    u1: 0,
    u2: 0,
    u3: 0,
    estB: 0,
    tipoAprov: 0,
  };
  const m = {
    grupo: 0,
    grupo2: 0,
    itemA: 0,
    itemB: 0,
    itemPac: 0,
    pacote: 0,
    atendimento: 0,
    conta: 0,
    conta2: 0,
    conta3: 0,
    conta4: 0,
    cp4: 0,
  };
  const op = (usuario: number | null = ids.u1): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario,
    correlacao: 'teste-f375',
    chaveIdempotencia: `f375-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const opEm = (est: number, usuario: number): ContextoOperacao => ({ ...op(usuario), estabelecimento: est });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f375',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f375' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids.est, `${P}%`],
    );
    await e.executar('DELETE FROM ajuste_conta WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(
      "DELETE d FROM decisao_aprovacao d JOIN pedido_aprovacao p ON p.id = d.pedido_aprovacao_id WHERE p.estabelecimento_id = ? AND p.entidade = 'ajuste_conta'",
      [ids.est],
    );
    await e.executar(
      "DELETE FROM pedido_aprovacao WHERE estabelecimento_id = ? AND entidade = 'ajuste_conta'",
      [ids.est],
    );
    for (const { id } of contas) {
      await e.executar('DELETE FROM ajuste_conta WHERE conta_hospitalar_id = ?', [id]);
      await e.executar(
        'UPDATE conta_hospitalar_pacote SET descaracterizacao_pacote_id = NULL WHERE conta_hospitalar_id = ?',
        [id],
      );
      await e.executar('DELETE FROM descaracterizacao_pacote WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_pacote WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar(
      'DELETE n FROM alcada_aprovacao_nivel n JOIN alcada_aprovacao a ON a.id = n.alcada_aprovacao_id WHERE a.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM alcada_aprovacao WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM motivo_ajuste_conta WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM motivo_descaracterizacao_pacote WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM acrescimo_horario_especial WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM dia_nao_util WHERE estabelecimento_id = ?', [ids.est]);
    const pac = await e.consultar<{ id: number }>('SELECT id FROM pacote WHERE codigo LIKE ?', [`${P}%`]);
    for (const { id } of pac)
      for (const t of [
        'pacote_versao',
        'pacote_excecao',
        'pacote_teto',
        'pacote_diaria_acomodacao',
        'pacote_item_incluso',
      ])
        await e.executar(`DELETE FROM ${t} WHERE pacote_id = ?`, [id]);
    await e.executar('DELETE FROM pacote WHERE codigo LIKE ?', [`${P}%`]);
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
      ids.estB = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}B`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P} SINTETICO B`, `ESTAB ${P} SINTETICO B`, agora],
      );
      ids.tipoAprov = await garantir(
        e,
        "SELECT id FROM tipo_documento_aprovacao WHERE codigo = 'ajuste_conta'",
        [],
        "INSERT INTO tipo_documento_aprovacao (codigo, descricao, entidade, tipo_limite, criado_em) VALUES ('ajuste_conta', 'Acréscimo ou desconto na conta do paciente', 'ajuste_conta', 'valor', ?)",
        [agora],
      );
      await limpar(e);
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 837_501, agora],
      );
      const pf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F5'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F5', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO ${login}`, agora],
        );
      ids.u1 = await usuario(`${P.toLowerCase()}.pede`);
      ids.u2 = await usuario(`${P.toLowerCase()}.aprova`);
      ids.u3 = await usuario(`${P.toLowerCase()}.gerente`);
      m.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}G1`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'taxa', ?)",
        [`${P}G1`, `GRUPO ${P} 1`, agora],
      );
      m.grupo2 = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}G2`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [`${P}G2`, `GRUPO ${P} 2`, agora],
      );
      const item = (cod: string, grupo: number) =>
        garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          [cod],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'servico', ?, ?)",
          [cod, `ITEM ${cod}`, grupo, agora],
        );
      m.itemA = await item(`${P}IA`, m.grupo);
      m.itemB = await item(`${P}IB`, m.grupo2);
      m.itemPac = await item(`${P}IP`, m.grupo);
      m.pacote = await e.inserir(
        `INSERT INTO pacote (codigo, descricao, tipo_pacote, item_faturavel_id, cobranca_item_faturavel_id, valor,
           vigencia_inicio, criado_em) VALUES (?, ?, 'cirurgico', ?, ?, 900, '2025-01-01', ?)`,
        [`${P}PC`, `PACOTE SINTETICO ${P}`, m.itemA, m.itemPac, agora],
      );
      m.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
        [
          ids.est,
          `${P}-1`,
          ids.paciente,
          ids.categoria,
          ids.carater,
          ids.fonte,
          ids.prof,
          '2026-01-20 11:00:00',
          agora,
        ],
      );
      const conta = (num: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, fim_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 11:00:00', '2026-01-24 11:00:00', ?)`,
          [ids.est, num, m.atendimento, ids.paciente, ids.fonte, ids.tipoConta, agora],
        );
      m.conta = await conta(`${P}-C1`);
      m.conta2 = await conta(`${P}-C2`);
      // Itens: instantes em UTC (o relógio do hospital é UTC-3). 20/01 (terça) 14h local; 21/01 02h UTC = 20/01 23h
      // local (noturno); 22/01 15h local num feriado do estabelecimento.
      const lancar = (
        c: number,
        seq: number,
        it: number,
        grupo: number,
        quando: string,
        valor: number,
        hon = 0,
      ) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             realizado_em, quantidade, valor_unitario, valor_honorario, valor_total, criado_em)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [c, seq, it, grupo, quando, valor, hon, valor, agora],
        );
      await lancar(m.conta, 1, m.itemA, m.grupo, '2026-01-20 17:00:00', 100);
      await lancar(m.conta, 2, m.itemA, m.grupo, '2026-01-21 02:00:00', 200, 100);
      await lancar(m.conta, 3, m.itemB, m.grupo2, '2026-01-22 18:00:00', 100);
      await lancar(m.conta2, 1, m.itemA, m.grupo, '2026-01-20 17:00:00', 300);
      await lancar(m.conta2, 2, m.itemB, m.grupo2, '2026-01-20 18:00:00', 50);
      // Conta 3: desconto de 15 no cabeçalho sem linha de ajuste (importado) e item noturno com acréscimo manual de 10.
      m.conta3 = await conta(`${P}-C3`);
      await e.executar(
        'UPDATE conta_hospitalar SET valor_itens = 110, valor_desconto = 15, valor_total = 95 WHERE id = ?',
        [m.conta3],
      );
      await e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
           realizado_em, quantidade, valor_unitario, valor_acrescimo, valor_total, criado_em)
         VALUES (?, 1, ?, ?, '2026-01-21 02:00:00', 1, 100, 10, 110, ?)`,
        [m.conta3, m.itemA, m.grupo, agora],
      );
      // Conta 4: de 2025, na vigência da versão 1 do pacote; o item B é exceção só na composição atual.
      m.conta4 = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2025-06-01', '2025-06-10 11:00:00', '2025-06-11 11:00:00', ?)`,
        [ids.est, `${P}-C4`, m.atendimento, ids.paciente, ids.fonte, ids.tipoConta, agora],
      );
      await lancar(m.conta4, 1, m.itemB, m.grupo2, '2025-06-10 15:00:00', 70);
      await e.inserir(
        "INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, data, criado_em) VALUES (?, 'estabelecimento', ?, 'data_unica', '2026-01-22', ?)",
        [`FERIADO ${P}`, ids.est, agora],
      );
    });
    s = new ServicoAjustesConta(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.estB] });
    });
    await nucleo.encerrar();
  });

  it('horário especial: noturno e feriado com acréscimo, dia útil sem, sem acumular; total refeito', async () => {
    const faixa = (codigo: string, x: Record<string, unknown>) =>
      s.gravar('horario.faixa', op(), {
        codigo,
        descricao: `FAIXA ${codigo}`,
        vigenciaInicio: '2026-01-01',
        ...x,
      });
    expect(await codigoDo(faixa(`${P}X`, { tipoHorario: 'noturno', percentual: 30 }))).toBe(
      'entrada-invalida',
    );
    await faixa(`${P}N`, {
      tipoHorario: 'noturno',
      horaInicio: '19:00',
      horaFim: '07:00',
      percentual: 30,
      percentualHonorario: 50,
    });
    await faixa(`${P}H`, { tipoHorario: 'feriado', percentual: 25 });
    const previa = await s.ler(ctxL(), (l, est) => ajustesContaPropria(l, est, m.conta));
    expect(previa.horario.map((i) => [i.sequencia, i.realizadoEm.slice(11), i.feriado, i.acrescimo])).toEqual(
      [
        [1, '14:00', false, 0],
        [2, '23:00', false, 80],
        [3, '15:00', true, 25],
      ],
    );
    const r = await s.gravar('horario.aplicar', op(), { contaId: m.conta });
    expect(r).toMatchObject({ alterados: 2, comAcrescimo: 2 });
    const itens = await linhas(
      'SELECT sequencia, horario_especial, valor_acrescimo, valor_total, acrescimo_horario_especial_id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [m.conta],
    );
    expect(
      itens.map((i) => [
        Number(i['horario_especial']),
        Number(i['valor_acrescimo']),
        Number(i['valor_total']),
      ]),
    ).toEqual([
      [0, 0, 100],
      [1, 80, 280],
      [1, 25, 125],
    ]);
    const [c] = await linhas('SELECT valor_itens, valor_total FROM conta_hospitalar WHERE id = ?', [m.conta]);
    expect([Number(c!['valor_itens']), Number(c!['valor_total'])]).toEqual([505, 505]);
    // Reaplicar não muda nada (idempotente pela regra).
    expect(await s.gravar('horario.aplicar', op(), { contaId: m.conta })).toMatchObject({ alterados: 0 });
  });

  it('ajuste da conta: pendente não muda o total, quem pede não aprova, aprovado e recusado ficam gravados', async () => {
    const { id: motivo } = (await s.gravar('ajuste.motivo', op(), {
      codigo: `${P}D`,
      descricao: 'Desconto comercial sintético',
      tipoAjuste: 'desconto',
    })) as { id: number };
    const { id: motivoA } = (await s.gravar('ajuste.motivo', op(), {
      codigo: `${P}A`,
      descricao: 'Acréscimo sintético',
      tipoAjuste: 'acrescimo',
    })) as { id: number };
    expect(
      await codigoDo(
        s.gravar('ajuste.pedir', op(), {
          contaId: m.conta,
          tipo: 'desconto',
          motivoId: motivoA,
          valor: 10,
          justificativa: 'Motivo de outro tipo',
        }),
      ),
    ).toBe('entrada-invalida');
    expect(
      await codigoDo(
        s.gravar('ajuste.pedir', op(), {
          contaId: m.conta,
          tipo: 'desconto',
          motivoId: motivo,
          valor: 9999,
          justificativa: 'Desconto acima da conta',
        }),
      ),
    ).toBe('entrada-invalida');
    const d = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'desconto',
      motivoId: motivo,
      forma: 'percentual',
      percentual: 10,
      justificativa: 'Acordo comercial sintético',
    })) as { id: number; valor: number };
    expect(d.valor).toBe(50.5);
    let [c] = await linhas('SELECT valor_desconto, valor_total FROM conta_hospitalar WHERE id = ?', [
      m.conta,
    ]);
    expect(Number(c!['valor_total'])).toBe(505);
    const [a0] = await linhas(
      'SELECT versao, situacao, solicitado_por_usuario_id FROM ajuste_conta WHERE id = ?',
      [d.id],
    );
    expect(a0).toMatchObject({ situacao: 'pendente_aprovacao' });
    expect(Number(a0!['solicitado_por_usuario_id'])).toBe(ids.u1);
    expect(
      await codigoDo(
        s.gravar('ajuste.decidir', op(ids.u1), {
          id: d.id,
          versao: Number(a0!['versao']),
          decisao: 'aprovar',
        }),
      ),
    ).toBe('alcada');
    await s.gravar('ajuste.decidir', op(ids.u2), {
      id: d.id,
      versao: Number(a0!['versao']),
      decisao: 'aprovar',
    });
    [c] = await linhas('SELECT valor_desconto, valor_total FROM conta_hospitalar WHERE id = ?', [m.conta]);
    expect([Number(c!['valor_desconto']), Number(c!['valor_total'])]).toEqual([50.5, 454.5]);
    const x = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'acrescimo',
      motivoId: motivoA,
      valor: 20,
      justificativa: 'Acréscimo sintético pedido',
    })) as { id: number };
    const [ax] = await linhas('SELECT versao FROM ajuste_conta WHERE id = ?', [x.id]);
    const vx = Number(ax!['versao']);
    expect(
      await codigoDo(s.gravar('ajuste.decidir', op(ids.u2), { id: x.id, versao: vx, decisao: 'recusar' })),
    ).toBe('entrada-invalida');
    await s.gravar('ajuste.decidir', op(ids.u2), {
      id: x.id,
      versao: vx,
      decisao: 'recusar',
      observacao: 'Sem respaldo no acordo',
    });
    const [a1] = await linhas(
      'SELECT situacao, decidido_por_usuario_id, decidido_em FROM ajuste_conta WHERE id = ?',
      [x.id],
    );
    expect(a1).toMatchObject({ situacao: 'recusado' });
    expect(Number(a1!['decidido_por_usuario_id'])).toBe(ids.u2);
    [c] = await linhas('SELECT valor_acrescimo, valor_total FROM conta_hospitalar WHERE id = ?', [m.conta]);
    expect([Number(c!['valor_acrescimo']), Number(c!['valor_total'])]).toEqual([0, 454.5]);
    const tela = await s.ler(ctxL(), (l, est) => ajustesContaPropria(l, est, m.conta));
    expect(tela.ajustes.map((a) => a.situacao).sort()).toEqual(['aprovado', 'recusado']);
  });

  it('pacote: versão, composição, aplicação na conta e descaracterização com motivo', async () => {
    const v1 = (await s.gravar('pacote.versao', op(), {
      pacoteId: m.pacote,
      vigenciaInicio: '2025-01-01',
      valor: 800,
    })) as { numero: number };
    expect(v1.numero).toBe(1);
    expect(
      await codigoDo(
        s.gravar('pacote.versao', op(), { pacoteId: m.pacote, vigenciaInicio: '2025-01-01', valor: 1 }),
      ),
    ).toBe('entrada-invalida');
    await s.gravar('pacote.versao', op(), {
      pacoteId: m.pacote,
      vigenciaInicio: '2026-01-01',
      valor: 1000,
      quantidadeDiarias: 2,
    });
    const vs = await linhas(
      'SELECT numero_versao, vigencia_fim FROM pacote_versao WHERE pacote_id = ? ORDER BY numero_versao',
      [m.pacote],
    );
    expect(
      vs.map((v) => [
        Number(v['numero_versao']),
        v['vigencia_fim'] === null
          ? null
          : String((v['vigencia_fim'] as Date).toISOString?.() ?? v['vigencia_fim']).slice(0, 10),
      ]),
    ).toEqual([
      [1, '2025-12-31'],
      [2, null],
    ]);
    await s.gravar('pacote.composicao', op(), {
      pacoteId: m.pacote,
      excecoes: [{ itemId: m.itemB, efeito: 'cobrar_a_parte' }],
      tetos: [{ valorTeto: 200 }],
      diarias: [],
    });
    const ap = (await s.gravar('pacote.aplicar', op(), { contaId: m.conta2, pacoteId: m.pacote })) as {
      id: number;
      inclusos: number;
      total: number;
      alertas: number;
    };
    expect(ap.inclusos).toBe(1);
    expect(ap.total).toBe(1050);
    expect(ap.alertas).toBe(2);
    const itens = await linhas(
      'SELECT item_faturavel_id, situacao, pertence_pacote, tipo_valorizacao, valor_total FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [m.conta2],
    );
    expect(
      itens.map((i) => [
        Number(i['item_faturavel_id']),
        i['situacao'],
        Number(i['pertence_pacote']),
        i['tipo_valorizacao'],
      ]),
    ).toEqual([
      [m.itemA, 'sem_cobranca', 1, 'tabela'],
      [m.itemB, 'lancado', 0, 'tabela'],
      [m.itemPac, 'lancado', 1, 'pacote'],
    ]);
    const tela = await s.ler(ctxL(), (l, est) => pacotesContaPropria(l, est, m.conta2));
    expect(tela.aplicados[0]!.alertas.map((a) => [a.tipo, a.descaracteriza])).toEqual([
      ['teto', true],
      ['diarias', false],
    ]);
    expect(tela.aplicados[0]).toMatchObject({
      ativo: true,
      numeroVersao: 2,
      valorCobrado: 1000,
      inclusos: 1,
      aParte: 1,
    });
    const { id: motivo } = (await s.gravar('pacote.motivo', op(), {
      codigo: `${P}M`,
      descricao: 'Intercorrência sintética',
      tipo: 'intercorrencia',
    })) as { id: number };
    const [cp] = await linhas('SELECT versao FROM conta_hospitalar_pacote WHERE id = ?', [ap.id]);
    expect(
      await codigoDo(
        s.gravar('pacote.descaracterizar', op(), {
          id: ap.id,
          versao: Number(cp!['versao']),
          motivoId: motivo,
          justificativa: 'curta',
        }),
      ),
    ).toBe('entrada-invalida');
    const d = (await s.gravar('pacote.descaracterizar', op(), {
      id: ap.id,
      versao: Number(cp!['versao']),
      motivoId: motivo,
      justificativa: 'Teto de consumo superado na internação',
    })) as { id: number; reabertos: number; total: number };
    expect(d).toMatchObject({ reabertos: 1, total: 350 });
    const [dd] = await linhas(
      'SELECT usuario_id, motivo_descaracterizacao_pacote_id, pacote_id FROM descaracterizacao_pacote WHERE id = ?',
      [d.id],
    );
    expect([
      Number(dd!['usuario_id']),
      Number(dd!['motivo_descaracterizacao_pacote_id']),
      Number(dd!['pacote_id']),
    ]).toEqual([ids.u1, motivo, m.pacote]);
    const depois = await linhas(
      'SELECT situacao, pertence_pacote FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [m.conta2],
    );
    expect(depois.map((i) => i['situacao'])).toEqual(['lancado', 'lancado', 'estornado']);
    const [cpd] = await linhas(
      'SELECT descaracterizacao_pacote_id, excluido_em FROM conta_hospitalar_pacote WHERE id = ?',
      [ap.id],
    );
    expect(Number(cpd!['descaracterizacao_pacote_id'])).toBe(d.id);
    expect(cpd!['excluido_em']).toBeNull();
    expect(await codigoDo(s.gravar('pacote.aplicar', op(), { contaId: m.conta2, pacoteId: m.pacote }))).toBe(
      'pacote-descaracterizado',
    );
  });

  it('horário preserva o acréscimo manual do item e o desconto do cabeçalho sem linha de ajuste', async () => {
    const r = await s.gravar('horario.aplicar', op(), { contaId: m.conta3 });
    expect(r).toMatchObject({ alterados: 1 });
    const [i] = await linhas(
      'SELECT valor_acrescimo, valor_acrescimo_horario, valor_total FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [m.conta3],
    );
    // noturno 30% sobre a base de 100 (sem o acréscimo manual): 30 de horário + 10 manual
    expect([
      Number(i!['valor_acrescimo']),
      Number(i!['valor_acrescimo_horario']),
      Number(i!['valor_total']),
    ]).toEqual([40, 30, 140]);
    const [c] = await linhas(
      'SELECT valor_itens, valor_desconto, valor_total FROM conta_hospitalar WHERE id = ?',
      [m.conta3],
    );
    expect([Number(c!['valor_itens']), Number(c!['valor_desconto']), Number(c!['valor_total'])]).toEqual([
      140, 15, 125,
    ]);
    expect(await s.gravar('horario.aplicar', op(), { contaId: m.conta3 })).toMatchObject({ alterados: 0 });
  });

  it('alçada por valor: pedido de aprovação gravado, decisor sem alçada recusado, decisão no mecanismo', async () => {
    const alc = await escrever(async (e) => {
      const agora = new Date();
      const a = await e.inserir(
        `INSERT INTO alcada_aprovacao (estabelecimento_id, tipo_documento_aprovacao_id, descricao, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2020-01-01', ?)`,
        [ids.est, ids.tipoAprov, `ALCADA ${P}`, agora],
      );
      const nv = (seq: number, usuario: number, max: number | null) =>
        e.inserir(
          `INSERT INTO alcada_aprovacao_nivel (alcada_aprovacao_id, sequencia, nivel, aprovador_usuario_id, valor_unitario_maximo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [a, seq, seq, usuario, max, agora],
        );
      return { a, n1: await nv(1, ids.u2, 30), n2: await nv(2, ids.u3, null) };
    });
    const [mot] = await linhas('SELECT id FROM motivo_ajuste_conta WHERE codigo = ?', [`${P}D`]);
    const d = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'desconto',
      motivoId: Number(mot!['id']),
      valor: 40,
      justificativa: 'Desconto acima da alçada do faturista',
    })) as { id: number; pedidoAprovacaoId: number };
    const [pa] = await linhas(
      'SELECT alcada_aprovacao_id, entidade, entidade_id, valor, situacao, solicitante_usuario_id FROM pedido_aprovacao WHERE id = ?',
      [d.pedidoAprovacaoId],
    );
    expect([
      Number(pa!['alcada_aprovacao_id']),
      pa!['entidade'],
      Number(pa!['entidade_id']),
      Number(pa!['valor']),
    ]).toEqual([alc.a, 'ajuste_conta', d.id, 40]);
    expect(pa!['situacao']).toBe('pendente');
    const [aj] = await linhas('SELECT pedido_aprovacao_id, versao FROM ajuste_conta WHERE id = ?', [d.id]);
    expect(Number(aj!['pedido_aprovacao_id'])).toBe(d.pedidoAprovacaoId);
    const versao = Number(aj!['versao']);
    expect(
      await codigoDo(s.gravar('ajuste.decidir', op(ids.u2), { id: d.id, versao, decisao: 'aprovar' })),
    ).toBe('alcada');
    const [ainda] = await linhas('SELECT situacao FROM ajuste_conta WHERE id = ?', [d.id]);
    expect(ainda!['situacao']).toBe('pendente_aprovacao');
    await s.gravar('ajuste.decidir', op(ids.u3), { id: d.id, versao, decisao: 'aprovar' });
    const [pd] = await linhas('SELECT situacao, concluido_em FROM pedido_aprovacao WHERE id = ?', [
      d.pedidoAprovacaoId,
    ]);
    expect(pd!['situacao']).toBe('aprovado');
    expect(pd!['concluido_em']).not.toBeNull();
    const dec = await linhas(
      'SELECT aprovador_usuario_id, alcada_aprovacao_nivel_id, nivel, decisao, valor_aprovado FROM decisao_aprovacao WHERE pedido_aprovacao_id = ?',
      [d.pedidoAprovacaoId],
    );
    expect(
      dec.map((x) => [
        Number(x['aprovador_usuario_id']),
        Number(x['alcada_aprovacao_nivel_id']),
        Number(x['nivel']),
        x['decisao'],
        Number(x['valor_aprovado']),
      ]),
    ).toEqual([[ids.u3, alc.n2, 2, 'aprovado', 40]]);
    // O cabeçalho soma só a diferença do aprovado: 50,50 de antes + 40.
    const [c] = await linhas('SELECT valor_desconto, valor_total FROM conta_hospitalar WHERE id = ?', [
      m.conta,
    ]);
    expect([Number(c!['valor_desconto']), Number(c!['valor_total'])]).toEqual([90.5, 414.5]);
  });

  it('alçada em série: dois níveis um após o outro, cada um por uma pessoa; autoaprovação só se a alçada permite', async () => {
    // Alçada mais nova (vigência posterior à do caso anterior): série, com autoaprovação; nível 1 de quem pede (u1) e
    // de u2 sem teto, nível 2 de u3 a partir de 30.
    const alc = await escrever(async (e) => {
      const agora = new Date();
      const a = await e.inserir(
        `INSERT INTO alcada_aprovacao (estabelecimento_id, tipo_documento_aprovacao_id, descricao, modo_aprovacao,
           permite_autoaprovacao, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, 'serie', 1, '2021-01-01', ?)`,
        [ids.est, ids.tipoAprov, `ALCADA SERIE ${P}`, agora],
      );
      const nv = (seq: number, nivel: number, usuario: number, min: number) =>
        e.inserir(
          `INSERT INTO alcada_aprovacao_nivel (alcada_aprovacao_id, sequencia, nivel, aprovador_usuario_id,
             valor_unitario_minimo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [a, seq, nivel, usuario, min, agora],
        );
      return {
        a,
        n1: await nv(1, 1, ids.u2, 0),
        n1b: await nv(2, 1, ids.u1, 0),
        n2: await nv(3, 2, ids.u3, 30),
      };
    });
    const [mot] = await linhas('SELECT id FROM motivo_ajuste_conta WHERE codigo = ?', [`${P}D`]);
    const [antes] = await linhas('SELECT valor_desconto FROM conta_hospitalar WHERE id = ?', [m.conta]);
    const d = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'desconto',
      motivoId: Number(mot!['id']),
      valor: 40,
      justificativa: 'Desconto que pede dois níveis',
    })) as { id: number; pedidoAprovacaoId: number };
    const [aj] = await linhas('SELECT versao FROM ajuste_conta WHERE id = ?', [d.id]);
    const versao = Number(aj!['versao']);
    const decidir = (u: number) =>
      s.gravar('ajuste.decidir', op(u), { id: d.id, versao, decisao: 'aprovar' });
    // O nível 2 não decide antes do 1.
    expect(await codigoDo(decidir(ids.u3))).toBe('alcada');
    const r1 = (await decidir(ids.u2)) as { situacao: string; avisos: string };
    expect(r1.situacao).toBe('pendente_aprovacao');
    expect(r1.avisos).toContain('falta o nível 2');
    const [meio] = await linhas(
      `SELECT a.situacao, p.situacao AS pedido, p.nivel_atual, p.alcada_aprovacao_nivel_id, c.valor_desconto
         FROM ajuste_conta a JOIN pedido_aprovacao p ON p.id = a.pedido_aprovacao_id
         JOIN conta_hospitalar c ON c.id = a.conta_hospitalar_id WHERE a.id = ?`,
      [d.id],
    );
    expect([
      meio!['situacao'],
      meio!['pedido'],
      Number(meio!['nivel_atual']),
      Number(meio!['alcada_aprovacao_nivel_id']),
      Number(meio!['valor_desconto']),
    ]).toEqual(['pendente_aprovacao', 'pendente', 2, alc.n2, Number(antes!['valor_desconto'])]);
    // Quem aprovou o nível 1 não aprova o 2.
    expect(await codigoDo(decidir(ids.u2))).toBe('alcada');
    await decidir(ids.u3);
    const [fim] = await linhas(
      `SELECT a.situacao, p.situacao AS pedido, c.valor_desconto FROM ajuste_conta a
         JOIN pedido_aprovacao p ON p.id = a.pedido_aprovacao_id JOIN conta_hospitalar c ON c.id = a.conta_hospitalar_id
        WHERE a.id = ?`,
      [d.id],
    );
    expect([fim!['situacao'], fim!['pedido'], Number(fim!['valor_desconto'])]).toEqual([
      'aprovado',
      'aprovado',
      Number(antes!['valor_desconto']) + 40,
    ]);
    const dec = await linhas(
      'SELECT aprovador_usuario_id, alcada_aprovacao_nivel_id, nivel FROM decisao_aprovacao WHERE pedido_aprovacao_id = ? ORDER BY id',
      [d.pedidoAprovacaoId],
    );
    expect(
      dec.map((x) => [
        Number(x['aprovador_usuario_id']),
        Number(x['alcada_aprovacao_nivel_id']),
        Number(x['nivel']),
      ]),
    ).toEqual([
      [ids.u2, alc.n1, 1],
      [ids.u3, alc.n2, 2],
    ]);
    // Autoaprovação: 10 cabe só no nível 1, e a alçada permite que quem pediu (u1, do nível 1) aprove.
    const p2 = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'desconto',
      motivoId: Number(mot!['id']),
      valor: 10,
      justificativa: 'Desconto pequeno autoaprovado',
    })) as { id: number };
    const [aj2] = await linhas('SELECT versao FROM ajuste_conta WHERE id = ?', [p2.id]);
    await s.gravar('ajuste.decidir', op(ids.u1), {
      id: p2.id,
      versao: Number(aj2!['versao']),
      decisao: 'aprovar',
    });
    const [auto] = await linhas('SELECT situacao, decidido_por_usuario_id FROM ajuste_conta WHERE id = ?', [
      p2.id,
    ]);
    expect([auto!['situacao'], Number(auto!['decidido_por_usuario_id'])]).toEqual(['aprovado', ids.u1]);
  });

  it('pacote: conta de data antiga segue o retrato da versão encerrada, não a composição atual', async () => {
    const ap = (await s.gravar('pacote.aplicar', op(), { contaId: m.conta4, pacoteId: m.pacote })) as {
      id: number;
      inclusos: number;
      total: number;
    };
    m.cp4 = ap.id;
    // versão 1 (2025): retrato sem exceção, pacote fechado, o item B fica incluso; a composição atual o cobraria à parte
    expect(ap).toMatchObject({ inclusos: 1, total: 800 });
    const itens = await linhas(
      'SELECT item_faturavel_id, situacao FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [m.conta4],
    );
    expect(itens.map((i) => [Number(i['item_faturavel_id']), i['situacao']])).toEqual([
      [m.itemB, 'sem_cobranca'],
      [m.itemPac, 'lancado'],
    ]);
    const tela = await s.ler(ctxL(), (l, est) => pacotesContaPropria(l, est, m.conta4));
    expect(tela.aplicados[0]).toMatchObject({ numeroVersao: 1, inclusos: 1, aParte: 0 });
  });

  it('outro estabelecimento: decidir, pedir, aplicar e descaracterizar recusados, sem gravar', async () => {
    const [mot] = await linhas('SELECT id FROM motivo_ajuste_conta WHERE codigo = ?', [`${P}A`]);
    const x = (await s.gravar('ajuste.pedir', op(), {
      contaId: m.conta,
      tipo: 'acrescimo',
      motivoId: Number(mot!['id']),
      valor: 5,
      justificativa: 'Acréscimo para o teste de isolamento',
    })) as { id: number };
    const fora = opEm(ids.estB, ids.u3);
    expect(
      await codigoDo(s.gravar('ajuste.decidir', fora, { id: x.id, versao: 2, decisao: 'aprovar' })),
    ).toBe('nao-encontrado');
    expect(
      await codigoDo(
        s.gravar('ajuste.pedir', fora, {
          contaId: m.conta,
          tipo: 'acrescimo',
          motivoId: Number(mot!['id']),
          valor: 5,
          justificativa: 'Pedido de outro estabelecimento',
        }),
      ),
    ).toBe('nao-encontrado');
    expect(await codigoDo(s.gravar('pacote.aplicar', fora, { contaId: m.conta4, pacoteId: m.pacote }))).toBe(
      'nao-encontrado',
    );
    expect(await codigoDo(s.gravar('horario.aplicar', fora, { contaId: m.conta }))).toBe('nao-encontrado');
    const [mm] = await linhas('SELECT id FROM motivo_descaracterizacao_pacote WHERE codigo = ?', [`${P}M`]);
    const [cp] = await linhas('SELECT versao FROM conta_hospitalar_pacote WHERE id = ?', [m.cp4]);
    expect(
      await codigoDo(
        s.gravar('pacote.descaracterizar', fora, {
          id: m.cp4,
          versao: Number(cp!['versao']),
          motivoId: Number(mm!['id']),
          justificativa: 'Tentativa de outro estabelecimento',
        }),
      ),
    ).toBe('nao-encontrado');
    const [a] = await linhas('SELECT situacao FROM ajuste_conta WHERE id = ?', [x.id]);
    expect(a!['situacao']).toBe('pendente_aprovacao');
    const [cpd] = await linhas(
      'SELECT descaracterizacao_pacote_id FROM conta_hospitalar_pacote WHERE id = ?',
      [m.cp4],
    );
    expect(cpd!['descaracterizacao_pacote_id']).toBeNull();
    const [n] = await linhas('SELECT COUNT(*) AS n FROM ajuste_conta WHERE estabelecimento_id = ?', [
      ids.estB,
    ]);
    expect(Number(n!['n'])).toBe(0);
  });
});
