// Orçamento de exames particulares e conversão no MariaDB real (cliente da massa SADT; massa SINTÉTICA), F3.5, 05-SADT
// linha 26. Contrato de efeito: a prévia não grava; o orçamento emitido grava o número de negócio, a validade, os
// valores (bruto, desconto, total com as parcelas) e os itens de exame, com a trilha; a conversão abre a requisição no
// setor executante padrão do exame, com os itens e o evento, aponta a requisição para o orçamento e marca o orçamento
// realizado com o atendimento, o aceite e o paciente vinculado, tudo na mesma transação; converter de novo, atendimento
// de outro estabelecimento, exame sem preço e exame sem setor executante são recusados sem gravar nada. Correção F3.5-6:
// a conversão lança na conta do atendimento o valor aprovado (unitário e desconto); fonte não particular, atendimento de
// outra fonte, orçamento vencido, CPF diferente e vínculo sem confirmação são recusados; a chave repetida não duplica.
// F3.5-14: sem valor digitado, o preço sai da tabela da fonte particular (o vigente no dia; o de vigência futura não
// vale) e é ele que fica no item do orçamento e na conta; o atendimento cancelado é recusado sem gravar nada.
import { ErroOperacao, garantirSequencia, NucleoProprio } from '@sgh/nucleo';
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

// CPF sintético válido e único por execução (os dígitos verificadores calculados), diferente do interessado.
const cpfSintetico = () => {
  const d = String(Date.now() % 1_000_000_000)
    .padStart(9, '7')
    .split('')
    .map(Number);
  const dv = (k: number[]) => ((k.reduce((a, x, i) => a + x * (k.length + 1 - i), 0) * 10) % 11) % 10;
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
};
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
  let outraFonte = 0;
  let operadora = 0;
  let itemFat = 0;
  let tabela = 0;
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
      // A fonte do atendimento da massa é particular (a regra do orçamento exige); outra particular e uma operadora.
      const tipo = await e.uma<{ t: string }>('SELECT tipo AS t FROM fonte_pagadora WHERE id = ?', [fonte]);
      expect(tipo?.t).toBe('particular');
      const novaFonte = (cod: string, t: string) =>
        e.inserir('INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?)', [
          `${m!.marca}${cod}`,
          `FONTE ${cod} SINTETICA`,
          t,
          new Date(),
        ]);
      outraFonte = await novaFonte('P2', 'particular');
      operadora = await novaFonte('OP', 'operadora');
      // O exame do laboratório é cobrável: item faturável próprio (a conversão lança na conta por ele).
      const grupo = await e.uma<{ g: number }>('SELECT MIN(id) AS g FROM grupo_faturamento', []);
      itemFat = await e.inserir(
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, situacao, criado_em) VALUES (?, 'POTASSIO SINTETICO', 'procedimento', ?, 'ativo', ?)",
        [`${m!.marca}IF`, Number(grupo?.g), new Date()],
      );
      await e.executar('UPDATE exame SET item_faturavel_id = ? WHERE id = ?', [itemFat, m!.exameLab]);
      // A conta aberta do atendimento na fonte particular (o catálogo de tipos de conta do cliente de teste não decide a
      // abertura sozinho): a conversão lança nela os valores aprovados.
      const tipoConta = await e.uma<{ t: number }>('SELECT MIN(id) AS t FROM tipo_conta', []);
      const agora = new Date();
      await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ?, 'aberta', ?)`,
        [
          m!.base.est,
          `${m!.marca}C1`,
          m!.base.atendimento,
          m!.base.paciente,
          fonte,
          Number(tipoConta?.t),
          `${agora.toISOString().slice(0, 7)}-01`,
          agora,
          agora,
        ],
      );
      // A numeração da requisição do estabelecimento (a conversão abre o pedido por ela).
      await garantirSequencia(
        e,
        { tipo: 'requisicao_exame', estabelecimento: m!.base.est, prefixo: 'RQ' },
        { usuario: m!.base.usuario, agora: new Date() },
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
        const ats = [m!.base.atendimento, m!.base.atendimentoOutro];
        await e.executar(
          `DELETE mm FROM conta_hospitalar_item_memoria mm JOIN conta_hospitalar_item i ON i.id = mm.conta_hospitalar_item_id
             JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.atendimento_id IN (?, ?)`,
          ats,
        );
        await e.executar(
          `DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
            WHERE c.atendimento_id IN (?, ?)`,
          ats,
        );
        await e.executar('DELETE FROM atendimento_conta WHERE atendimento_id IN (?, ?)', ats);
        await e.executar('DELETE FROM conta_hospitalar WHERE atendimento_id IN (?, ?)', ats);
        await e.executar('UPDATE exame SET item_faturavel_id = NULL WHERE id = ?', [m!.exameLab]);
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
        await e.executar('DELETE FROM fonte_pagadora WHERE id IN (?, ?)', [outraFonte, operadora]);
        if (tabela) {
          await e.executar(
            `DELETE pv FROM preco_procedimento_valor pv JOIN preco_procedimento pp ON pp.id = pv.preco_procedimento_id
              WHERE pp.tabela_preco_id = ?`,
            [tabela],
          );
          await e.executar('DELETE FROM preco_procedimento WHERE tabela_preco_id = ?', [tabela]);
          await e.executar('DELETE FROM tabela_preco WHERE id = ?', [tabela]);
        }
        await e.executar('DELETE FROM item_faturavel WHERE id = ?', [itemFat]);
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
    // Orçamento particular só pela tabela de uma fonte particular: a operadora é recusada com o campo.
    expect(
      await recusaDe(
        servico.previa(c, entrada([{ exame: m!.exameLab, valor: 10 }], { fontePagadora: operadora })),
      ),
    ).toBe('fonte-nao-particular');
    expect((await servico.apoio(c)).fontes.map((f) => f.id)).not.toContain(operadora);
    const depois = await um('SELECT COUNT(*) AS n FROM orcamento_particular WHERE estabelecimento_id = ?', [
      m!.base.est,
    ]);
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });

  it('validade padrão pelo parâmetro sadt.validadeOrcamentoDias do estabelecimento; a digitada prevalece', async () => {
    const c = contexto(m!);
    // O dia de hoje do estabelecimento sai da prévia com validade digitada de 1 dia.
    const um1 = await servico.previa(c, entrada([{ exame: m!.exameLab, valor: 10 }], { validadeDias: 1 }));
    const hoje = Date.parse(`${um1.validade}T00:00:00Z`) - 86_400_000;
    const dias = (v: string) => Math.round((Date.parse(`${v}T00:00:00Z`) - hoje) / 86_400_000);
    const base = await servico.previa(c, entrada([{ exame: m!.exameLab, valor: 10 }]));
    // Sem valor no estabelecimento: o padrão da definição semeada (30 dias).
    expect(dias(base.validade)).toBe(30);
    let valor = 0;
    try {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, async (e) => {
        const d = await e.uma(
          "SELECT id FROM parametro_definicao WHERE chave = 'sadt.validadeOrcamentoDias'",
          [],
        );
        expect(d).toBeTruthy();
        valor = await e.inserir(
          `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio, motivo,
             criado_em) VALUES (?, 'estabelecimento', ?, '7', '2020-01-01', 'teste sintético', ?)`,
          [d!['id'], m!.base.est, new Date()],
        );
      });
      const p = await servico.previa(c, entrada([{ exame: m!.exameLab, valor: 10 }]));
      expect(dias(p.validade)).toBe(7);
      const digitada = await servico.previa(
        c,
        entrada([{ exame: m!.exameLab, valor: 10 }], { validadeDias: 3 }),
      );
      expect(dias(digitada.validade)).toBe(3);
    } finally {
      if (valor)
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, (e) =>
          e.executar('DELETE FROM parametro_valor WHERE id = ?', [valor]),
        );
    }
  });

  it('grava o orçamento, converte no atendimento do paciente e recusa a segunda conversão', async () => {
    const c = contexto(m!);
    const corpoOrc = entrada([{ exame: m!.exameLab, quantidade: 2, valor: 12.5 }], {
      desconto: 5,
      cpf: '000.000.001-91',
    });
    const o = await servico.criar({ ...c, chaveIdempotencia: `orc-${m!.marca}` }, corpoOrc);
    expect(o.total).toBe(20);
    // A mesma chave de idempotência devolve o mesmo orçamento, sem gravar outro.
    expect((await servico.criar({ ...c, chaveIdempotencia: `orc-${m!.marca}` }, corpoOrc)).id).toBe(o.id);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM orcamento_particular WHERE numero = ? AND estabelecimento_id = ?',
            [o.numero, m!.base.est],
          )
        )?.['n'],
      ),
    ).toBe(1);
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
    // O paciente da massa não tem CPF: sem a confirmação explícita (ou com outro id), nada se vincula.
    expect(await servico.atendimentos(c, o.id)).toEqual([]);
    expect((await servico.atendimentos(c, o.id, m!.base.paciente)).map((a) => a.id)).toContain(
      m!.base.atendimento,
    );
    const av = await servico.avaliarConversao(c, o.id, { atendimento: m!.base.atendimento });
    expect(av).toMatchObject({ paciente: { id: m!.base.paciente }, confirmarPaciente: true, segue: true });
    expect(await recusaDe(servico.converter(c, o.id, { atendimento: m!.base.atendimento }))).toBe(
      'vinculo-nao-confirmado',
    );
    expect(
      await recusaDe(
        servico.converter(c, o.id, {
          atendimento: m!.base.atendimento,
          confirmaPaciente: m!.base.paciente + 1,
        }),
      ),
    ).toBe('vinculo-nao-confirmado');
    const r = await servico.converter({ ...c, chaveIdempotencia: `conv-${m!.marca}` }, o.id, {
      atendimento: m!.base.atendimento,
      confirmaPaciente: m!.base.paciente,
    });
    expect(r.requisicoes).toHaveLength(1);
    // A mesma chave devolve a mesma conversão (nenhuma requisição a mais).
    const r2 = await servico.converter({ ...c, chaveIdempotencia: `conv-${m!.marca}` }, o.id, {
      atendimento: m!.base.atendimento,
      confirmaPaciente: m!.base.paciente,
    });
    expect(r2.requisicoes.map((x) => x.requisicao)).toEqual(r.requisicoes.map((x) => x.requisicao));
    expect(
      Number(
        (await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE orcamento_particular_id = ?', [o.id]))?.[
          'n'
        ],
      ),
    ).toBe(1);
    // O valor APROVADO chega à conta do atendimento: unitário de 12,50 × 2 e o desconto de 5 na conta.
    const ci = await um(
      `SELECT i.quantidade, i.valor_unitario, i.valor_total, i.tipo_valorizacao, c.fonte_pagadora_id, c.valor_desconto,
              JSON_VALUE(mm.dados, '$.orcamento') AS orc
         FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
         JOIN conta_hospitalar_item_memoria mm ON mm.conta_hospitalar_item_id = i.id
        WHERE c.id = ? AND i.item_faturavel_id = ?`,
      [r.conta, itemFat],
    );
    expect([
      Number(ci!['quantidade']),
      Number(ci!['valor_unitario']),
      Number(ci!['valor_total']),
      Number(ci!['valor_desconto']),
      Number(ci!['fonte_pagadora_id']),
      Number(ci!['orc']),
    ]).toEqual([2, 12.5, 25, 5, fonte, o.id]);
    expect(ci!['tipo_valorizacao']).toBe('manual');
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

  it('preço da tabela da fonte particular vai ao orçamento e à conta; atendimento cancelado é recusado sem gravar', async () => {
    const c = contexto(m!);
    // A tabela de preço da fonte particular com o exame: 40,00 vigente e 99,00 só a partir do ano que vem.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, async (e) => {
      const agora = new Date();
      tabela = await e.inserir(
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao,
           fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'PARTICULAR SINTETICA', 'servico_hospitalar', 'propria', 'real', 'ativa', ?, ?)`,
        [m!.base.est, `${m!.marca}TP`, fonte, agora],
      );
      const preco = await e.inserir(
        `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
         VALUES (?, 1, ?, 'valor', ?)`,
        [tabela, itemFat, agora],
      );
      const futuro = `${agora.getUTCFullYear() + 1}-12-31`;
      for (const [vig, valor] of [
        ['2020-01-01', 40],
        [futuro, 99],
      ] as const)
        await e.inserir(
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, ocorrido_em, vigencia_inicio, valor_total, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [preco, agora, vig, valor, agora],
        );
    });
    // Sem valor digitado: o preço vigente da tabela (o futuro não vale hoje), com as parcelas.
    const p = await servico.previa(c, entrada([{ exame: m!.exameLab, quantidade: 3 }]));
    expect(p).toMatchObject({ bruto: 120, desconto: 0, total: 120 });
    expect(p.itens[0]).toMatchObject({
      quantidade: 3,
      unitario: 40,
      total: 120,
      origemPreco: 'tabela',
      precoTabela: 40,
    });
    // O valor do balcão prevalece e a tabela continua à vista.
    const inf = await servico.previa(c, entrada([{ exame: m!.exameLab, quantidade: 3, valor: 35 }]));
    expect(inf.itens[0]).toMatchObject({
      unitario: 35,
      total: 105,
      origemPreco: 'informado',
      precoTabela: 40,
    });
    // A outra fonte particular não tem tabela: o exame segue sem preço.
    expect(
      await recusaDe(servico.previa(c, entrada([{ exame: m!.exameLab }], { fontePagadora: outraFonte }))),
    ).toBe('exame-sem-preco');

    const o = await servico.criar(
      c,
      entrada([{ exame: m!.exameLab, quantidade: 3 }], { paciente: m!.base.paciente, nome: null }),
    );
    expect(o.total).toBe(120);
    const it1 = await um(
      'SELECT quantidade, valor_unitario, valor_total FROM orcamento_particular_item WHERE orcamento_particular_id = ?',
      [o.id],
    );
    expect([Number(it1!['quantidade']), Number(it1!['valor_unitario']), Number(it1!['valor_total'])]).toEqual(
      [3, 40, 120],
    );

    // Atendimento cancelado: fora da lista da conversão, recusado na avaliação e na gravação, nada gravado.
    const fotografia = async () => ({
      requisicoes: Number(
        (await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE orcamento_particular_id = ?', [o.id]))?.[
          'n'
        ],
      ),
      itensConta: Number(
        (
          await um(
            `SELECT COUNT(*) AS n FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
              WHERE c.atendimento_id = ?`,
            [m!.base.atendimento],
          )
        )?.['n'],
      ),
      situacao: String(
        (await um('SELECT situacao FROM orcamento_particular WHERE id = ?', [o.id]))?.['situacao'],
      ),
    });
    const antes = await fotografia();
    const situacaoAntes = String(
      (await um('SELECT situacao FROM atendimento WHERE id = ?', [m!.base.atendimento]))?.['situacao'],
    );
    const situar = (s: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, (e) =>
        e.executar('UPDATE atendimento SET situacao = ? WHERE id = ?', [s, m!.base.atendimento]),
      );
    await situar('cancelado');
    try {
      expect((await servico.atendimentos(c, o.id)).map((a) => a.id)).not.toContain(m!.base.atendimento);
      expect(await recusaDe(servico.avaliarConversao(c, o.id, { atendimento: m!.base.atendimento }))).toBe(
        'atendimento-cancelado',
      );
      expect(await recusaDe(servico.converter(c, o.id, { atendimento: m!.base.atendimento }))).toBe(
        'atendimento-cancelado',
      );
      expect(await fotografia()).toEqual({ ...antes, situacao: 'emitido' });
    } finally {
      await situar(situacaoAntes);
    }

    // Com o atendimento ativo de novo, a conversão lança na conta o preço da tabela que o orçamento aprovou.
    const r = await servico.converter(c, o.id, { atendimento: m!.base.atendimento });
    const ci = await um(
      `SELECT i.quantidade, i.valor_unitario, i.valor_total
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria mm ON mm.conta_hospitalar_item_id = i.id
        WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(mm.dados, '$.orcamento') = ?`,
      [r.conta, o.id],
    );
    expect([Number(ci!['quantidade']), Number(ci!['valor_unitario']), Number(ci!['valor_total'])]).toEqual([
      3, 40, 120,
    ]);
    expect((await fotografia()).situacao).toBe('realizado');
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

  it('fonte diferente, vencido e CPF diferente: recusas sem gravar', async () => {
    const c = contexto(m!);
    const contar = async (id: number) =>
      Number(
        (await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE orcamento_particular_id = ?', [id]))?.[
          'n'
        ],
      );
    // Orçamento de outra fonte particular não vira cobrança na fonte do atendimento.
    const of = await servico.criar(
      c,
      entrada([{ exame: m!.exameLab, valor: 9 }], {
        paciente: m!.base.paciente,
        nome: null,
        fontePagadora: outraFonte,
      }),
    );
    expect(await recusaDe(servico.converter(c, of.id, { atendimento: m!.base.atendimento }))).toBe(
      'fonte-diferente',
    );
    expect(await servico.atendimentos(c, of.id)).toEqual([]);
    expect(await contar(of.id)).toBe(0);
    // Vencido: passou da validade.
    const ov = await servico.criar(
      c,
      entrada([{ exame: m!.exameLab, valor: 9 }], { paciente: m!.base.paciente, nome: null }),
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, (e) =>
      e.executar(
        'UPDATE orcamento_particular SET data_orcamento = DATE_SUB(CURDATE(), INTERVAL 40 DAY), validade_ate = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = ?',
        [ov.id],
      ),
    );
    expect(await recusaDe(servico.converter(c, ov.id, { atendimento: m!.base.atendimento }))).toBe(
      'orcamento-nao-converte',
    );
    expect(await contar(ov.id)).toBe(0);
    // Interessado com CPF e paciente do atendimento com outro CPF: paciente diferente, mesmo com a confirmação.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35orc' }, (e) =>
      e.executar(
        'UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id SET pf.cpf = ? WHERE p.id = ?',
        [cpfSintetico(), m!.base.paciente],
      ),
    );
    const oc = await servico.criar(c, entrada([{ exame: m!.exameLab, valor: 9 }], { cpf: '000.000.001-91' }));
    expect(
      await recusaDe(
        servico.converter(c, oc.id, { atendimento: m!.base.atendimento, confirmaPaciente: m!.base.paciente }),
      ),
    ).toBe('paciente-diferente');
    expect(await contar(oc.id)).toBe(0);
  });
});
