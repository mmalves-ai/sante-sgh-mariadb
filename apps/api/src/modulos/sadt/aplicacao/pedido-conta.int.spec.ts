// Contrato de efeito do exame pedido na conta do paciente (F3.5, 05-SADT linha 4) no MariaDB real (cliente de teste;
// massa SINTÉTICA). Prova o que fica no banco: o pedido sem preço segue gravado e fica pendente de cobrança (nada na
// conta); o lançamento dos pendentes do atendimento cria o item da conta com a memória e marca o exame; o pedido com
// conta e preço entra na conta na mesma transação (quantidade, unitário, total, totais da conta refeitos, conta "não
// calculada"); o cancelamento com motivo que tira da conta estorna o item (nunca apagado) com a memória da exclusão;
// o motivo que mantém a cobrança não toca a conta; em conta fechada o cancelamento com estorno é recusado sem gravar.
// Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoPedidoSadt } from './pedido-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const CORR = { cliente: CLIENTE, correlacao: 't-f352c' };

describe.skipIf(SEM_BANCO)('exame pedido na conta do paciente (MariaDB, cliente de teste)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoPedidoSadt;
  let m: MassaSadt | null = null;
  let itemFat = 0;
  let tabela = 0;
  let conta = 0;
  let motivoMantem = 0;
  let motivoTira = 0;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(CORR, (l) => l.uma(sql, p));
  const num = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const itemDaConta = (exameItem: number) =>
    um(
      `SELECT i.id, i.situacao, i.quantidade, i.valor_unitario, i.valor_total, i.item_faturavel_id,
              (SELECT o.codigo FROM origem_lancamento o WHERE o.id = i.origem_lancamento_id) AS origem,
              (SELECT COUNT(*) FROM conta_hospitalar_item_memoria x WHERE x.conta_hospitalar_item_id = i.id
                  AND x.operacao = 'inclusao') AS inclusoes,
              (SELECT COUNT(*) FROM conta_hospitalar_item_memoria x WHERE x.conta_hospitalar_item_id = i.id
                  AND x.operacao = 'exclusao') AS exclusoes
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria mm ON mm.conta_hospitalar_item_id = i.id
          AND mm.operacao = 'inclusao'
        WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(mm.dados, '$.regra') = 'exame_pedido'
          AND JSON_VALUE(mm.dados, '$.exameItem') = ?`,
      [conta, exameItem],
    );
  const faturado = (exameItem: number) =>
    num('SELECT faturado AS n FROM exame_item WHERE id = ?', [exameItem]);
  const somaDosItens = () =>
    num(
      `SELECT COALESCE(SUM(valor_total), 0) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?
          AND excluido_em IS NULL AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
      [conta],
    );
  const valorItensDaConta = () => num('SELECT valor_itens AS n FROM conta_hospitalar WHERE id = ?', [conta]);
  const pedir = (quantidade: number) =>
    servico.abrirPedido(contexto(m!), {
      atendimento: m!.base.atendimento,
      setor: m!.setorLab,
      exames: [{ exame: m!.exameLab, quantidade }],
      confirmado: true,
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'F3C');
    servico = new ServicoPedidoSadt(nucleo);
    await nucleo.escrever(CORR, async (e) => {
      const agora = new Date();
      const fonte = Number(
        (await e.uma<{ f: number }>('SELECT fonte_pagadora_id AS f FROM atendimento WHERE id = ?', [
          m!.base.atendimento,
        ]))!.f,
      );
      const grupo = await e.uma<{ g: number }>('SELECT MIN(id) AS g FROM grupo_faturamento', []);
      itemFat = await e.inserir(
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, situacao, criado_em) VALUES (?, 'EXAME SINTETICO COBRAVEL', 'procedimento', ?, 'ativo', ?)",
        [`${m!.marca}IF`, Number(grupo?.g), agora],
      );
      await e.executar('UPDATE exame SET item_faturavel_id = ? WHERE id = ?', [itemFat, m!.exameLab]);
      tabela = await e.inserir(
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, fonte_pagadora_id,
           situacao, criado_em) VALUES (?, ?, 'TABELA SINTETICA EXAMES', 'servico_hospitalar', 'propria', ?, 'ativa', ?)`,
        [m!.base.est, `${m!.marca}TP`, fonte, agora],
      );
      const tipoConta = await e.uma<{ t: number }>('SELECT MIN(id) AS t FROM tipo_conta', []);
      conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, situacao, calculada, tabela_preco_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ?, 'aberta', TRUE, ?, ?)`,
        [
          m!.base.est,
          `${m!.marca}C1`,
          m!.base.atendimento,
          m!.base.paciente,
          fonte,
          Number(tipoConta?.t),
          `${agora.toISOString().slice(0, 7)}-01`,
          new Date(agora.getTime() - 3_600_000),
          tabela,
          agora,
        ],
      );
      const motivo = (cod: string, tira: boolean) =>
        e.inserir(
          `INSERT INTO motivo_cancelamento_item_exame (codigo, descricao, ativo, aplica_a, remove_da_conta,
             exige_nova_coleta, exige_complemento, criado_em, versao) VALUES (?, ?, TRUE, 'exame', ?, FALSE, FALSE, ?, 1)`,
          [`${m!.marca}${cod}`, `MOTIVO SINTETICO ${cod}`, tira, agora],
        );
      motivoTira = await motivo('MT', true);
      motivoMantem = await motivo('MM', false);
    });
  }, 60_000);

  afterAll(async () => {
    if (m) {
      await nucleo.escrever(CORR, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          `DELETE mm FROM conta_hospitalar_item_memoria mm JOIN conta_hospitalar_item i ON i.id = mm.conta_hospitalar_item_id
            WHERE i.conta_hospitalar_id = ?`,
          [conta],
        );
        await x('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [conta]);
        await x('DELETE FROM atendimento_conta WHERE conta_hospitalar_id = ?', [conta]);
        await x('DELETE FROM conta_hospitalar WHERE id = ?', [conta]);
        await x(
          `DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id
            WHERE pp.tabela_preco_id = ?`,
          [tabela],
        );
        await x('DELETE FROM preco_procedimento WHERE tabela_preco_id = ?', [tabela]);
        await x('DELETE FROM tabela_preco WHERE id = ?', [tabela]);
        await x('UPDATE exame SET item_faturavel_id = NULL WHERE id = ?', [m!.exameLab]);
        await x('DELETE FROM item_faturavel WHERE id = ?', [itemFat]);
        await x(
          `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id = ?`,
          [m!.base.est],
        );
        await x(
          `UPDATE exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
              SET ei.motivo_cancelamento_item_exame_id = NULL, ei.situacao = 'solicitado' WHERE r.estabelecimento_id = ?`,
          [m!.base.est],
        );
        await x('DELETE FROM motivo_cancelamento_item_exame WHERE id IN (?, ?)', [motivoTira, motivoMantem]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('pedido sem preço fica pendente; o lançamento dos pendentes cobra depois, sem redigitar o pedido', async () => {
    const c = contexto(m!);
    const a = await pedir(1);
    const itemA = a.itens[0]!.id;
    // O pedido foi gravado e nada entrou na conta: a falta de preço é pendência, não recusa.
    expect(a.cobranca?.itens.map((i) => [i.item, i.contaItem, i.pendencia])).toEqual([
      [itemA, null, 'sem-preco'],
    ]);
    expect(
      await num('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [conta]),
    ).toBe(0);
    expect(await faturado(itemA)).toBe(0);
    expect(await num('SELECT calculada AS n FROM conta_hospitalar WHERE id = ?', [conta])).toBe(1);
    const visao = await servico.pedidosDoAtendimento(c, m!.base.atendimento);
    expect(visao?.requisicoes.find((r) => r.id === a.requisicao)?.itens.map((i) => i.cobranca)).toEqual([
      'pendente',
    ]);

    // O preço entra na tabela da conta; os pendentes do atendimento são lançados de uma vez.
    await nucleo.escrever(CORR, async (e) => {
      const agora = new Date();
      const pp = await e.inserir(
        `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
         VALUES (?, 1, ?, 'valor', ?)`,
        [tabela, itemFat, agora],
      );
      await e.inserir(
        `INSERT INTO preco_procedimento_valor (preco_procedimento_id, vigencia_inicio, valor_total, ocorrido_em, criado_em)
         VALUES (?, '2020-01-01', 40, ?, ?)`,
        [pp, agora, agora],
      );
    });
    const r = await servico.lancarPendentesNaConta(c, m!.base.atendimento);
    expect(r.conta).toBe(conta);
    expect(r.itens.find((i) => i.item === itemA)?.contaItem).toBeGreaterThan(0);
    const i = await itemDaConta(itemA);
    expect({
      situacao: i?.['situacao'],
      quantidade: Number(i?.['quantidade']),
      unitario: Number(i?.['valor_unitario']),
      total: Number(i?.['valor_total']),
      item: Number(i?.['item_faturavel_id']),
      inclusoes: Number(i?.['inclusoes']),
    }).toEqual({ situacao: 'lancado', quantidade: 1, unitario: 40, total: 40, item: itemFat, inclusoes: 1 });
    expect(await faturado(itemA)).toBe(1);
    // Os totais da conta saem dos itens (sem gatilho) e a conta volta a "não calculada".
    expect(await valorItensDaConta()).toBe(await somaDosItens());
    expect(await num('SELECT calculada AS n FROM conta_hospitalar WHERE id = ?', [conta])).toBe(0);
    expect(
      await num(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'conta_hospitalar' AND entidade_id = ?",
        [conta],
      ),
    ).toBe(1);
    // Repetir não cobra de novo: o exame já está na conta.
    const de_novo = await servico.lancarPendentesNaConta(c, m!.base.atendimento);
    expect(de_novo.itens.filter((x) => x.contaItem !== null).length).toBe(0);
    expect(
      await num(
        `SELECT COUNT(*) AS n FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria mm
            ON mm.conta_hospitalar_item_id = i.id WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(mm.dados, '$.exameItem') = ?`,
        [conta, itemA],
      ),
    ).toBe(1);

    // Motivo que mantém a cobrança: o exame cancela e o item da conta segue lançado.
    const antes = await valorItensDaConta();
    const cancel = await servico.cancelarItem(c, itemA, { motivo: motivoMantem });
    expect(cancel.conta).toBe('mantido');
    expect((await itemDaConta(itemA))?.['situacao']).toBe('lancado');
    expect(await faturado(itemA)).toBe(1);
    expect(await valorItensDaConta()).toBe(antes);
  }, 60_000);

  it('pedido com conta e preço entra na conta na hora; cancelar com motivo que tira da conta estorna', async () => {
    const c = contexto(m!);
    const antes = await valorItensDaConta();
    const b = await pedir(2);
    const itemB = b.itens[0]!.id;
    expect(b.cobranca?.conta).toBe(conta);
    expect(b.cobranca?.itens.map((i) => [i.item, i.pendencia])).toEqual([[itemB, null]]);
    const i = await itemDaConta(itemB);
    expect({
      situacao: i?.['situacao'],
      quantidade: Number(i?.['quantidade']),
      unitario: Number(i?.['valor_unitario']),
      total: Number(i?.['valor_total']),
    }).toEqual({ situacao: 'lancado', quantidade: 2, unitario: 40, total: 80 });
    // A origem do lançamento vem da semente 12_FAT/99_origem_lancamento_diagnostico (antes entrava sem origem).
    expect(i?.['origem']).toBe('diagnostico');
    expect(await faturado(itemB)).toBe(1);
    expect(await valorItensDaConta()).toBe(antes + 80);
    expect(
      (await servico.pedidosDoAtendimento(c, m!.base.atendimento))?.requisicoes
        .find((r) => r.id === b.requisicao)
        ?.itens.map((x) => x.cobranca),
    ).toEqual(['na_conta']);

    const cancel = await servico.cancelarItem(c, itemB, { motivo: motivoTira });
    expect(cancel).toMatchObject({ id: itemB, conta: 'estornado', requisicaoCancelada: true });
    const depois = await itemDaConta(itemB);
    // O item da conta não é apagado: fica estornado, com a memória da exclusão.
    expect({ situacao: depois?.['situacao'], exclusoes: Number(depois?.['exclusoes']) }).toEqual({
      situacao: 'estornado',
      exclusoes: 1,
    });
    expect(await faturado(itemB)).toBe(0);
    expect(await valorItensDaConta()).toBe(antes);
    expect(await valorItensDaConta()).toBe(await somaDosItens());
    const ev = await um(
      `SELECT JSON_VALUE(dados, '$.conta.destino') AS destino FROM item_exame_evento
        WHERE exame_item_id = ? AND evento = 'cancelado'`,
      [itemB],
    );
    expect(ev?.['destino']).toBe('estornado');
  }, 60_000);

  it('pedido do prontuário recebido no setor: evento "recebido", cobrança dele só; repetir e versão velha recusam', async () => {
    const c = contexto(m!);
    const base = await pedir(1);
    // O pedido do prontuário: o exame "solicitado" no setor padrão, ainda sem cobrança (como grava o prontuário).
    const item = await nucleo.escrever(CORR, (e) =>
      e.inserir(
        `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, setor_diagnostico_id, quantidade, urgente,
           situacao, origem, criado_em) VALUES (?, 2, ?, ?, 1, FALSE, 'solicitado', 'sistema', ?)`,
        [base.requisicao, m!.exameLab, m!.setorLab, new Date()],
      ),
    );
    expect(await faturado(item)).toBe(0);
    const versao = String(
      (
        await um('SELECT DATE_FORMAT(criado_em, "%Y-%m-%dT%H:%i:%s") AS v FROM exame_item WHERE id = ?', [
          item,
        ])
      )?.['v'],
    );
    expect(
      codigoDe(
        await servico
          .receberNoSetor(c, { exames: [{ id: item, versao: '2000-01-01T00:00:00' }] })
          .catch((e: unknown) => e),
      ),
    ).toBe('versao-divergente');
    const contaAntes = await num(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [conta],
    );
    const r = await servico.receberNoSetor(c, { exames: [{ id: item, versao }] });
    expect({ recebidos: r.recebidos, cobrados: r.cobranca.itens.map((i) => [i.item, i.pendencia]) }).toEqual({
      recebidos: 1,
      cobrados: [[item, null]],
    });
    const ev = await um(
      "SELECT COUNT(*) AS n, MAX(setor_diagnostico_id) AS setor, MAX(situacao_nova) AS sit FROM item_exame_evento WHERE exame_item_id = ? AND evento = 'recebido'",
      [item],
    );
    expect([Number(ev?.['n']), Number(ev?.['setor']), ev?.['sit']]).toEqual([1, m!.setorLab, 'solicitado']);
    // A situação não muda (o recebimento é evento, não situação); a cobrança entra com a origem do diagnóstico.
    expect((await um('SELECT situacao FROM exame_item WHERE id = ?', [item]))?.['situacao']).toBe(
      'solicitado',
    );
    expect(await faturado(item)).toBe(1);
    expect((await itemDaConta(item))?.['origem']).toBe('diagnostico');
    expect(
      await num('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [conta]),
    ).toBe(contaAntes + 1);
    expect(await valorItensDaConta()).toBe(await somaDosItens());
    // Repetir é recusado e nada muda.
    expect(
      codigoDe(
        await servico.receberNoSetor(c, { exames: [{ id: item, versao: null }] }).catch((e: unknown) => e),
      ),
    ).toBe('pedido-recebido');
    expect(
      await num(
        "SELECT COUNT(*) AS n FROM item_exame_evento WHERE exame_item_id = ? AND evento = 'recebido'",
        [item],
      ),
    ).toBe(1);
  }, 60_000);

  it('conta fechada recusa o cancelamento com estorno e nada muda; sem conta aberta o pedido segue pendente', async () => {
    const c = contexto(m!);
    const d = await pedir(1);
    const itemD = d.itens[0]!.id;
    expect((await itemDaConta(itemD))?.['situacao']).toBe('lancado');
    await nucleo.escrever(CORR, (e) =>
      e.executar(
        "UPDATE conta_hospitalar SET situacao = 'fechada', fechada_em = UTC_TIMESTAMP(3), fechada_por_usuario_id = ? WHERE id = ?",
        [m!.base.usuario, conta],
      ),
    );
    expect(
      codigoDe(await servico.cancelarItem(c, itemD, { motivo: motivoTira }).catch((e: unknown) => e)),
    ).toBe('conta-fechada');
    expect((await um('SELECT situacao FROM exame_item WHERE id = ?', [itemD]))?.['situacao']).toBe(
      'solicitado',
    );
    expect((await itemDaConta(itemD))?.['situacao']).toBe('lancado');
    // Com a conta fechada, o pedido novo não é recusado: fica pendente de cobrança.
    const f = await pedir(1);
    expect(f.cobranca?.itens.map((i) => i.pendencia)).toEqual(['sem-conta']);
    expect(await faturado(f.itens[0]!.id)).toBe(0);
  }, 60_000);
});
