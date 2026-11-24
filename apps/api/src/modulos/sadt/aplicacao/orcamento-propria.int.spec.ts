// Orçamento de exames particulares e conversão no MariaDB real (cliente da massa SADT; massa SINTÉTICA), F3.5, 05-SADT
// linha 26. Contrato de efeito: a prévia não grava; o orçamento emitido grava o número de negócio, a validade, os
// valores (bruto, desconto, total com as parcelas) e os itens de exame, com a trilha; a conversão abre a requisição no
// setor executante padrão do exame, com os itens e o evento, aponta a requisição para o orçamento e marca o orçamento
// realizado com o atendimento, o aceite e o paciente vinculado, tudo na mesma transação; converter de novo, atendimento
// de outro estabelecimento, exame sem preço e exame sem setor executante são recusados sem gravar nada.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoOrcamentoSadt } from './orcamento-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusaDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigoDe(e);
  }
  return 'gravou';
};

describe.skipIf(SEM_BANCO)('orçamento de exames e conversão em atendimento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoOrcamentoSadt;
  let m: MassaSadt | null = null;
  let fonte = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s35orc' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S6O');
    servico = new ServicoOrcamentoSadt(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, async (e) => {
      fonte = Number(
        (
          await e.uma<{ f: number }>('SELECT fonte_pagadora_id AS f FROM atendimento WHERE id = ?', [
            m!.base.atendimento,
          ])
        )?.f,
      );
      // O exame do laboratório tem o setor executante padrão; o de imagem fica sem setor (recusa na conversão).
      await e.inserir(
        'INSERT INTO exame_setor_executante (exame_id, setor_diagnostico_id, padrao, ativo, criado_em) VALUES (?, ?, TRUE, TRUE, ?)',
        [m!.exameLab, m!.setorLab, new Date()],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, async (e) => {
        const ests = [m!.base.est, m!.base.outroEst];
        await e.executar(
          'UPDATE requisicao_exame SET orcamento_particular_id = NULL WHERE estabelecimento_id IN (?, ?)',
          ests,
        );
        await e.executar(
          `DELETE oi FROM orcamento_particular_item oi JOIN orcamento_particular o ON o.id = oi.orcamento_particular_id
            WHERE o.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar('DELETE FROM orcamento_particular WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo IN ('orcamento_particular', 'requisicao_exame') AND estabelecimento_id IN (?, ?)",
          ests,
        );
        await e.executar(
          `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar('DELETE FROM exame_setor_executante WHERE exame_id IN (?, ?)', [
          m!.exameLab,
          m!.exameImagem,
        ]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  const entrada = (exames: { exame: number; quantidade?: number; valor?: number | null }[], extra = {}) => ({
    nome: 'INTERESSADO SINTETICO',
    fontePagadora: fonte,
    exames,
    ...extra,
  });

  it('prévia não grava; sem preço na tabela e sem valor é recusado com o campo', async () => {
    const c = contexto(m!);
    const antes = await um('SELECT COUNT(*) AS n FROM orcamento_particular WHERE estabelecimento_id = ?', [
      m!.base.est,
    ]);
    const p = await servico.previa(
      c,
      entrada([{ exame: m!.exameLab, quantidade: 2, valor: 12.5 }], { desconto: 5 }),
    );
    expect(p).toMatchObject({ bruto: 25, desconto: 5, total: 20 });
    expect(p.itens[0]).toMatchObject({ quantidade: 2, unitario: 12.5, total: 25, origemPreco: 'informado' });
    expect(await recusaDe(servico.previa(c, entrada([{ exame: m!.exameLab }])))).toBe('exame-sem-preco');
    expect(await recusaDe(servico.criar(c, entrada([{ exame: m!.exameLab }])))).toBe('exame-sem-preco');
    const depois = await um('SELECT COUNT(*) AS n FROM orcamento_particular WHERE estabelecimento_id = ?', [
      m!.base.est,
    ]);
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });

  it('grava o orçamento, converte no atendimento do paciente e recusa a segunda conversão', async () => {
    const c = contexto(m!);
    const o = await servico.criar(
      { ...c, chaveIdempotencia: `orc-${m!.marca}` },
      entrada([{ exame: m!.exameLab, quantidade: 2, valor: 12.5 }], { desconto: 5, cpf: '000.000.001-91' }),
    );
    expect(o.total).toBe(20);
    const cab = await um(
      `SELECT numero, situacao, valor_bruto, valor_desconto, valor_total, paciente_id, cpf_interessado,
              DATEDIFF(validade_ate, data_orcamento) AS dias FROM orcamento_particular WHERE id = ?`,
      [o.id],
    );
    expect(cab).toMatchObject({ situacao: 'emitido', paciente_id: null, cpf_interessado: '00000000191' });
    expect([
      Number(cab!['valor_bruto']),
      Number(cab!['valor_desconto']),
      Number(cab!['valor_total']),
    ]).toEqual([25, 5, 20]);
    expect(Number(cab!['dias'])).toBe(30);
    expect(String(cab!['numero'])).toMatch(/^OP-/);
    const it1 = await um(
      'SELECT tipo_item, exame_id, quantidade, valor_unitario, valor_total FROM orcamento_particular_item WHERE orcamento_particular_id = ?',
      [o.id],
    );
    expect(it1).toMatchObject({ tipo_item: 'exame', exame_id: m!.exameLab });
    expect([Number(it1!['quantidade']), Number(it1!['valor_unitario']), Number(it1!['valor_total'])]).toEqual(
      [2, 12.5, 25],
    );
    const trilhaCriar = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'orcamento_particular' AND entidade_id = ?",
      [o.id],
    );
    expect(Number(trilhaCriar?.['n'])).toBeGreaterThanOrEqual(1);

    // Interessado sem cadastro: os atendimentos aparecem pelo CPF só quando o paciente o tem; a conversão é por id.
    expect(await recusaDe(servico.converter(c, o.id, { atendimento: m!.base.atendimentoOutro }))).toBe(
      'atendimento-inexistente',
    );
    const r = await servico.converter({ ...c, chaveIdempotencia: `conv-${m!.marca}` }, o.id, {
      atendimento: m!.base.atendimento,
    });
    expect(r.requisicoes).toHaveLength(1);
    const req = await um(
      'SELECT setor_diagnostico_id, atendimento_id, orcamento_particular_id, situacao FROM requisicao_exame WHERE id = ?',
      [r.requisicoes[0]!.requisicao],
    );
    expect(req).toMatchObject({
      setor_diagnostico_id: m!.setorLab,
      atendimento_id: m!.base.atendimento,
      orcamento_particular_id: o.id,
      situacao: 'solicitada',
    });
    const item = await um(
      'SELECT exame_id, quantidade, situacao FROM exame_item WHERE requisicao_exame_id = ?',
      [r.requisicoes[0]!.requisicao],
    );
    expect(item).toMatchObject({ exame_id: m!.exameLab, situacao: 'solicitado' });
    expect(Number(item!['quantidade'])).toBe(2);
    const fim = await um(
      'SELECT situacao, atendimento_id, paciente_id, aceito_em IS NOT NULL AS aceito, realizado_em IS NOT NULL AS feito FROM orcamento_particular WHERE id = ?',
      [o.id],
    );
    expect(fim).toMatchObject({
      situacao: 'realizado',
      atendimento_id: m!.base.atendimento,
      paciente_id: m!.base.paciente,
    });
    expect(Number(fim!['aceito'])).toBe(1);
    expect(Number(fim!['feito'])).toBe(1);
    const trilhaConv = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'orcamento_particular' AND entidade_id = ?",
      [o.id],
    );
    expect(Number(trilhaConv?.['n'])).toBeGreaterThan(Number(trilhaCriar?.['n']));
    expect(await recusaDe(servico.converter(c, o.id, { atendimento: m!.base.atendimento }))).toBe(
      'orcamento-convertido',
    );
    expect((await servico.atendimentos(c, o.id)).map((a) => a.id)).toContain(m!.base.atendimento);
  });

  it('exame sem setor executante: a conversão recusa e nada fica (nem requisição, nem orçamento realizado)', async () => {
    const c = contexto(m!);
    const o = await servico.criar(
      c,
      entrada([{ exame: m!.exameImagem, valor: 300 }], { paciente: m!.base.paciente, nome: null }),
    );
    const reqs = await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE orcamento_particular_id = ?', [
      o.id,
    ]);
    expect(await recusaDe(servico.converter(c, o.id, { atendimento: m!.base.atendimento }))).toBe(
      'exame-sem-setor',
    );
    const depois = await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE orcamento_particular_id = ?', [
      o.id,
    ]);
    expect(Number(depois?.['n'])).toBe(Number(reqs?.['n']));
    expect(await um('SELECT situacao FROM orcamento_particular WHERE id = ?', [o.id])).toMatchObject({
      situacao: 'emitido',
    });
  });
});
