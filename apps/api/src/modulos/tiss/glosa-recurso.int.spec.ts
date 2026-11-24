// Contrato de efeito da glosa por item no banco (06-FAT linhas 33 e 34, F3.7): a baixa do retorno por item grava o pago
// no item e a glosa (uma por conta, itens com motivo); o lote de recurso parte da decisão "recorrer" e grava o recurso,
// os itens com a justificativa e o valor pleiteado; o retorno grava o acatado, o demonstrativo e o motivo, e fecha o
// recurso e a glosa. Recusas: conta não apresentada, item já baixado, recurso sem decisão, glosa aceita, item já
// recorrido, retorno repetido. Nada é apagado. Massa SINTÉTICA "L0734" (nenhuma pessoa real) no cliente de teste.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { versaoTexto } from '../faturamento/esquemas.js';
import { armazemXmlMemoria } from './armazem-xml.js';
import type { ContextoTiss } from './porta.js';
import { PortaTissPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0734';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function erroDe(p: Promise<unknown>): Promise<ErroOperacao> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e;
    throw e;
  }
  throw new Error('esperava recusa');
}
const codigo = (e: ErroOperacao) => String(e.problema['codigo'] ?? '');

describe.skipIf(SEM_BANCO)('glosa por item: baixa, lote de recurso e retorno (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTissPropria;
  let c: ContextoTiss;
  const ids = { est: 0, usuario: 0, conta: 0, contaAberta: 0, itens: [0, 0, 0], itemAberto: 0 };
  /** A massa para o segundo caso: as contas novas reaproveitam o atendimento, o tipo e o item faturável. */
  const massa = { atendimento: 0, paciente: 0, tipoConta: 0, item: 0, fontes: [0, 0] };
  let novaConta: (numero: string, fonte: number, itens: number) => Promise<number[]> = async () => [];

  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    await e.executar(
      `DELETE FROM recurso_glosa_item WHERE recurso_glosa_id IN (SELECT id FROM recurso_glosa WHERE estabelecimento_id = ?)`,
      est,
    );
    // O item glosado aponta o recurso (fk_glosa_item_recurso_glosa_id): sai antes dele.
    await e.executar(
      'DELETE FROM glosa_item WHERE glosa_id IN (SELECT id FROM glosa WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar('DELETE FROM recurso_glosa WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM glosa WHERE estabelecimento_id = ?', est);
    await e.executar(
      `DELETE FROM producao_repasse WHERE conta_hospitalar_item_id IN (SELECT ci.id FROM conta_hospitalar_item ci
         JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id WHERE ch.estabelecimento_id = ?)`,
      est,
    );
    await e.executar(
      'DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', est);
    await limparTrilhaDaMassa(e, { ids: est });
  };
  const op = (): ContextoOperacao => ({
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao,
    chaveIdempotencia: `t0734-${randomUUID()}`,
  });
  const lerUma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-0734' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const versao = async (item: number) =>
    versaoTexto(
      Number((await lerUma('SELECT versao FROM conta_hospitalar_item WHERE id = ?', [item]))?.['versao']),
    );
  const executar = (nome: string, entrada: unknown) => porta.executar(c, nome, entrada, op());

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-0734' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0734.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0734.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      const pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoa, 873_401, agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999998', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const fonteB = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FB`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999997', ?)",
        [`${P}FB`, `OPERADORA SINTETICA ${P} B`, agora],
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
        "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = 'L9'",
        [],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
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
      const atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}-1`],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
        [ids.est, `${P}-1`, paciente, categoria, carater, fonte, prof, agora, agora],
      );
      const tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      const item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['87340001'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['87340001', 'PROCEDIMENTO SINTETICO 87340001', grupo, agora],
      );
      for (const [cod, reapresenta] of [
        ['9734', true],
        ['9735', false],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM motivo_glosa WHERE codigo_tuss = ?',
          [cod],
          `INSERT INTO motivo_glosa (codigo_tuss, descricao, permite_reapresentacao, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, '2020-01-01', 'teste', ?)`,
          [cod, `MOTIVO SINTETICO ${cod}`, reapresenta, agora],
        );
      const conta = (numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
             fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-10-01', ?, ?, ?, 900, 900, ?, ?, ?)`,
          [
            ids.est,
            numero,
            atendimento,
            paciente,
            fonte,
            tipoConta,
            agora,
            agora,
            situacao,
            agora,
            ids.usuario,
            agora,
          ],
        );
      ids.conta = await conta(`${P}-C1`, 'faturada');
      ids.contaAberta = await conta(`${P}-C2`, 'fechada');
      const lancar = (ct: number, seq: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, criado_em) VALUES (?, ?, ?, ?, 3, 100, 300, ?)`,
          [ct, seq, item, agora, agora],
        );
      ids.itens = [await lancar(ids.conta, 1), await lancar(ids.conta, 2), await lancar(ids.conta, 3)];
      ids.itemAberto = await lancar(ids.contaAberta, 1);
      Object.assign(massa, { atendimento, paciente, tipoConta, item, fontes: [fonte, fonteB] });
    });
    novaConta = (numero, fonte, qtd) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-0734b' }, async (e) => {
        const agora = new Date();
        const ct = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
             fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-10-01', ?, ?, 'faturada', 900, 900, ?, ?, ?)`,
          [
            ids.est,
            numero,
            massa.atendimento,
            massa.paciente,
            fonte,
            massa.tipoConta,
            agora,
            agora,
            agora,
            ids.usuario,
            agora,
          ],
        );
        const itens: number[] = [];
        for (let k = 1; k <= qtd; k += 1)
          itens.push(
            await e.inserir(
              `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em,
                 quantidade, valor_unitario, valor_total, criado_em) VALUES (?, ?, ?, ?, 3, 100, 300, ?)`,
              [ct, k, massa.item, agora, agora],
            ),
          );
        return itens;
      });
    porta = new PortaTissPropria(nucleo, CLIENTE, armazemXmlMemoria());
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `t0734-${randomUUID()}`.slice(0, 64),
      rede: 'rede',
      hospital: `${P}A`,
    };
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-0734' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('baixa, recurso e retorno: o que fica no banco a cada passo, as recusas e nada apagado', async () => {
    const [i1, i2, i3] = ids.itens as [number, number, number];
    for (const o of [
      'faturamento.registrarGlosa',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
    ])
      expect(await porta.podeGravar(c, o)).toMatchObject({ pode: true });

    // Conta ainda não apresentada: recusa sem gravar.
    const naoApresentada = await erroDe(
      executar('faturamento.registrarGlosa', {
        itens: [
          {
            item: ids.itemAberto,
            versao: await versao(ids.itemAberto),
            valorPago: 300,
            quantidadePaga: 3,
            motivo: 0,
          },
        ],
        dataPagamento: '2026-11-10',
      }),
    );
    expect(codigo(naoApresentada)).toBe('conta-nao-apresentada');

    // Baixa: item 1 pago em parte (glosa 200), item 2 pago inteiro, item 3 sem pagamento (glosa 300).
    const baixa = await executar('faturamento.registrarGlosa', {
      itens: [
        { item: i1, versao: await versao(i1), valorPago: 100, quantidadePaga: 1, motivo: 9734 },
        { item: i2, versao: await versao(i2), valorPago: 300, quantidadePaga: 3, motivo: 0 },
        { item: i3, versao: await versao(i3), valorPago: 0, quantidadePaga: 0, motivo: 9735 },
      ],
      dataPagamento: '2026-11-10',
    });
    expect(baixa.resultado).toMatchObject({ itens: 3, glosados: 2, glosas: 1 });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(valor_glosado) AS glosado, SUM(valor_apresentado) AS apresentado,
                MIN(procedencia) AS procedencia, MIN(situacao) AS situacao, MIN(numero) AS numero
           FROM glosa WHERE estabelecimento_id = ?`,
        [ids.est],
      ),
    ).toMatchObject({
      q: 1,
      glosado: '500.00',
      apresentado: '600.00',
      procedencia: 'digitacao',
      situacao: 'em_analise',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(gi.quantidade_glosada) AS qg FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id
          WHERE g.estabelecimento_id = ? AND gi.decisao = 'pendente' AND gi.motivo_glosa_id IS NOT NULL`,
        [ids.est],
      ),
    ).toMatchObject({ q: 2, qg: '5.0000' });
    expect(
      await lerUma('SELECT valor_pago, versao FROM conta_hospitalar_item WHERE id = ?', [i2]),
    ).toMatchObject({
      valor_pago: '300.00',
    });
    const lidos = await porta.itensDaConta(c, ids.conta, '');
    expect(lidos.find((x) => x.item === i2)).toMatchObject({
      conciliado: true,
      estado: 'sem-glosa',
      valorPago: 300,
    });
    expect(lidos.find((x) => x.item === i1)).toMatchObject({
      conciliado: true,
      glosa: 200,
      estado: 'pendente',
      motivo: 9734,
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ? AND JSON_VALUE(dados_depois, '$.operacao') = 'faturamento.registrar-glosa'`,
        [ids.est],
      ),
    ).toMatchObject({ q: 1 });

    // Baixar de novo recusa.
    const repetida = await erroDe(
      executar('faturamento.registrarGlosa', {
        itens: [{ item: i2, versao: await versao(i2), valorPago: 300, quantidadePaga: 3, motivo: 0 }],
        dataPagamento: '2026-11-10',
      }),
    );
    expect(codigo(repetida)).toBe('ja-baixado');

    // Recurso sem a decisão "recorrer" recusa.
    expect(
      codigo(
        await erroDe(
          executar('faturamento.registrarRecurso', {
            itens: [{ item: i1, versao: await versao(i1) }],
            dataProtocolo: '2026-11-15',
          }),
        ),
      ),
    ).toBe('sem-decisao-recorrer');

    // Decisões na grade: recorrer o item 1 (com justificativa), aceitar o item 3.
    const trilhaDe = (x: { id: number }) => ({
      estabelecimento: null,
      usuario: null,
      correlacao: null,
      acao: 'alteracao' as const,
      entidade: 'glosa_item',
      entidadeId: x.id,
      motivo: 'decisão da glosa (teste)',
    });
    for (const [item, decisao] of [
      [i1, 'recorrer'],
      [i3, 'aceitar'],
    ] as const)
      await porta.gravarSgh(c, trilhaDe, (g) =>
        g.decidirGlosa({
          item,
          decisao,
          texto: decisao === 'recorrer' ? 'Procedimento autorizado pela senha da guia' : 'Glosa procedente',
          evidencia: '',
          usuario: 'x',
          prazo: null,
        }),
      );
    expect(
      codigo(
        await erroDe(
          executar('faturamento.registrarRecurso', {
            itens: [{ item: i3, versao: await versao(i3) }],
            dataProtocolo: '2026-11-15',
          }),
        ),
      ),
    ).toBe('glosa-aceita');

    // Lote de recurso: o item 1 pleiteia 150 dos 200 glosados.
    const rec = await executar('faturamento.registrarRecurso', {
      itens: [{ item: i1, versao: await versao(i1), valor: 150 }],
      dataProtocolo: '2026-11-15',
    });
    const recurso = Number(String(rec.resultado['recursos']));
    expect(
      await lerUma(
        `SELECT situacao, objeto, valor_recursado, DATE_FORMAT(enviado_em, '%Y-%m-%d') AS enviado, numero
           FROM recurso_glosa WHERE id = ? AND estabelecimento_id = ?`,
        [recurso, ids.est],
      ),
    ).toMatchObject({
      situacao: 'enviado',
      objeto: 'item',
      valor_recursado: '150.00',
      enviado: '2026-11-15',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, MIN(justificativa) AS justificativa, SUM(valor_recursado) AS valor
           FROM recurso_glosa_item WHERE recurso_glosa_id = ? AND conta_hospitalar_item_id = ?`,
        [recurso, i1],
      ),
    ).toMatchObject({ q: 1, justificativa: 'Procedimento autorizado pela senha da guia', valor: '150.00' });
    expect(
      await lerUma(
        `SELECT g.situacao, g.valor_recursado, g.valor_aceito, gi.recurso_glosa_id
           FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id WHERE gi.conta_hospitalar_item_id = ?`,
        [i1],
      ),
    ).toMatchObject({
      situacao: 'em_recurso',
      valor_recursado: '150.00',
      valor_aceito: '300.00',
      recurso_glosa_id: recurso,
    });
    expect(
      codigo(
        await erroDe(
          executar('faturamento.registrarRecurso', {
            itens: [{ item: i1, versao: await versao(i1) }],
            dataProtocolo: '2026-11-16',
          }),
        ),
      ),
    ).toBe('ja-recorrido');

    // Retorno: acatado em parte (100 dos 150), com o demonstrativo e o motivo da operadora.
    await executar('faturamento.registrarRetornoRecurso', {
      itens: [{ item: i1, versao: await versao(i1), desfecho: 'parcial', valor: 100, motivo: 9735 }],
      data: '2026-12-05',
      numeroDemonstrativo: 'DEM-0734',
    });
    expect(
      await lerUma(
        `SELECT rgi.valor_acatado, rgi.numero_demonstrativo_retorno, mg.codigo_tuss,
                DATE_FORMAT(rgi.retornado_em, '%Y-%m-%d') AS em, rgi.retornado_por_usuario_id AS por
           FROM recurso_glosa_item rgi LEFT JOIN motivo_glosa mg ON mg.id = rgi.motivo_retorno_glosa_id
          WHERE rgi.recurso_glosa_id = ?`,
        [recurso],
      ),
    ).toMatchObject({
      valor_acatado: '100.00',
      numero_demonstrativo_retorno: 'DEM-0734',
      codigo_tuss: '9735',
      em: '2026-12-05',
      por: ids.usuario,
    });
    expect(
      await lerUma('SELECT situacao, valor_acatado FROM recurso_glosa WHERE id = ?', [recurso]),
    ).toMatchObject({ situacao: 'acatado_parcial', valor_acatado: '100.00' });
    expect(
      await lerUma(
        `SELECT g.situacao, g.valor_recuperado, g.encerrado_em IS NOT NULL AS encerrada, gi.valor_recuperado AS item
           FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id WHERE gi.conta_hospitalar_item_id = ?`,
        [i1],
      ),
    ).toMatchObject({ situacao: 'recuperada', valor_recuperado: '100.00', encerrada: 1, item: '100.00' });
    const depois = (await porta.itensDaConta(c, ids.conta, '')).find((x) => x.item === i1);
    expect(depois).toMatchObject({ estado: 'encerrada', valorRetorno: 100, motivoRetorno: 9735 });
    expect(
      codigo(
        await erroDe(
          executar('faturamento.registrarRetornoRecurso', {
            itens: [{ item: i1, versao: await versao(i1), desfecho: 'negado', valor: null, motivo: 0 }],
            data: '2026-12-06',
            numeroDemonstrativo: 'DEM-0735',
          }),
        ),
      ),
    ).toBe('retorno-ja-baixado');

    // Nada apagado: a glosa, os dois itens glosados, o recurso e o item dele continuam.
    expect(
      await lerUma(
        `SELECT (SELECT COUNT(*) FROM glosa WHERE estabelecimento_id = ? AND excluido_em IS NULL) AS g,
                (SELECT COUNT(*) FROM glosa_item gi JOIN glosa x ON x.id = gi.glosa_id
                  WHERE x.estabelecimento_id = ? AND gi.excluido_em IS NULL) AS gi,
                (SELECT COUNT(*) FROM recurso_glosa_item WHERE recurso_glosa_id = ? AND excluido_em IS NULL) AS ri`,
        [ids.est, ids.est, recurso],
      ),
    ).toMatchObject({ g: 1, gi: 2, ri: 1 });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ?
            AND JSON_VALUE(dados_depois, '$.operacao') IN ('faturamento.registrar-recurso', 'faturamento.registrar-retorno-recurso')`,
        [ids.est],
      ),
    ).toMatchObject({ q: 2 });
  }, 120_000);

  it('prazo gravado na baixa, lote por fonte pagadora, teto do valor e retornos acatado, parcial do lote e negado', async () => {
    const [fa, fb] = massa.fontes as [number, number];
    const [a1, a2, a3] = (await novaConta(`${P}-C3`, fa, 3)) as [number, number, number];
    const [b1] = (await novaConta(`${P}-C4`, fb, 1)) as [number];
    const [s1] = (await novaConta(`${P}-C5`, fa, 1)) as [number];
    const baixa = async (itens: number[], prazoParametro?: string) =>
      executar('faturamento.registrarGlosa', {
        itens: await Promise.all(
          itens.map(async (i) => ({
            item: i,
            versao: await versao(i),
            valorPago: 0,
            quantidadePaga: 0,
            motivo: 9734,
          })),
        ),
        dataPagamento: '2026-11-10',
        ...(prazoParametro === undefined ? {} : { prazoParametro }),
      });
    // A baixa grava o prazo pela regra da grade: 30 dias na fonte A, 10 na fonte B, a contar do pagamento.
    await baixa([a1, a2, a3, b1], `${fa}:30;${fb}:10`);
    const limite = async (item: number) =>
      (
        await lerUma(
          `SELECT DATE_FORMAT(g.data_limite_recurso, '%Y-%m-%d') AS d FROM glosa_item gi
             JOIN glosa g ON g.id = gi.glosa_id WHERE gi.conta_hospitalar_item_id = ?`,
          [item],
        )
      )?.['d'];
    expect(await limite(a1)).toBe('2026-12-10');
    expect(await limite(b1)).toBe('2026-11-20');
    // Baixa sem o parâmetro: a glosa fica sem prazo gravado; o recurso calcula pela mesma regra.
    await baixa([s1]);
    expect(await limite(s1)).toBeNull();

    for (const item of [a1, a2, a3, b1, s1])
      await porta.gravarSgh(
        c,
        (x: { id: number }) => ({
          estabelecimento: null,
          usuario: null,
          correlacao: null,
          acao: 'alteracao' as const,
          entidade: 'glosa_item',
          entidadeId: x.id,
          motivo: 'decisão da glosa (teste)',
        }),
        (g) =>
          g.decidirGlosa({
            item,
            decisao: 'recorrer',
            texto: 'Procedimento autorizado pela senha da guia',
            evidencia: '',
            usuario: 'x',
            prazo: null,
          }),
      );
    const recorrer = async (
      itens: { item: number; valor?: number }[],
      dataProtocolo: string,
      prazoParametro = '',
    ) =>
      executar('faturamento.registrarRecurso', {
        itens: await Promise.all(itens.map(async (i) => ({ ...i, versao: await versao(i.item) }))),
        dataProtocolo,
        prazoParametro,
      });
    // Prazo vencido: gravado (fonte B, até 20/11) e calculado na hora (sem prazo gravado: 3 dias da baixa).
    expect(codigo(await erroDe(recorrer([{ item: b1 }], '2026-11-21')))).toBe('prazo-vencido');
    expect(codigo(await erroDe(recorrer([{ item: s1 }], '2026-11-20', `${fa}:3`)))).toBe('prazo-vencido');
    // Valor acima do que não foi aceito (300 glosados, nada aceito).
    expect(codigo(await erroDe(recorrer([{ item: a1, valor: 300.01 }], '2026-11-20')))).toBe(
      'valor-acima-da-glosa',
    );
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q FROM recurso_glosa_item ri JOIN recurso_glosa r ON r.id = ri.recurso_glosa_id
          WHERE r.estabelecimento_id = ? AND ri.conta_hospitalar_item_id IN (?, ?, ?)`,
        [ids.est, a1, b1, s1],
      ),
    ).toMatchObject({ q: 0 });

    // Um pedido com duas fontes pagadoras: um lote por fonte; o da fonte A com dois itens em sequência.
    const rec = await recorrer([{ item: a1 }, { item: b1 }, { item: a2 }], '2026-11-20');
    const [ra, rb] = String(rec.resultado['recursos']).split(',').map(Number) as [number, number];
    expect(
      await lerUma(
        `SELECT fonte_pagadora_id AS fonte, valor_recursado, DATE_FORMAT(prazo_ate, '%Y-%m-%d') AS prazo,
                (SELECT GROUP_CONCAT(CONCAT(sequencia, ':', conta_hospitalar_item_id) ORDER BY sequencia)
                   FROM recurso_glosa_item WHERE recurso_glosa_id = r.id) AS itens
           FROM recurso_glosa r WHERE id = ?`,
        [ra],
      ),
    ).toMatchObject({ fonte: fa, valor_recursado: '600.00', prazo: '2026-12-10', itens: `1:${a1},2:${a2}` });
    expect(
      await lerUma(
        `SELECT fonte_pagadora_id AS fonte, valor_recursado, DATE_FORMAT(prazo_ate, '%Y-%m-%d') AS prazo
           FROM recurso_glosa WHERE id = ?`,
        [rb],
      ),
    ).toMatchObject({ fonte: fb, valor_recursado: '300.00', prazo: '2026-11-20' });

    const retorno = async (item: number, desfecho: string, motivo: number | null) =>
      executar('faturamento.registrarRetornoRecurso', {
        itens: [{ item, versao: await versao(item), desfecho, valor: null, motivo }],
        data: '2026-12-05',
        numeroDemonstrativo: 'DEM-0734B',
      });
    const recurso = (id: number) =>
      lerUma('SELECT situacao, valor_acatado FROM recurso_glosa WHERE id = ?', [id]);
    const glosaDe = (item: number) =>
      lerUma(
        `SELECT g.situacao, g.valor_recuperado, g.encerrado_em IS NOT NULL AS encerrada
           FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id WHERE gi.conta_hospitalar_item_id = ?`,
        [item],
      );
    // Retorno de um item do lote de dois: o lote segue enviado.
    await retorno(a1, 'acatado', null);
    expect(await recurso(ra)).toMatchObject({ situacao: 'enviado', valor_acatado: null });
    await retorno(a2, 'acatado', null);
    expect(await recurso(ra)).toMatchObject({ situacao: 'acatado', valor_acatado: '600.00' });
    // O item 3 foi decidido "recorrer" e ainda não entrou em lote: a glosa não encerra.
    expect(await glosaDe(a1)).toMatchObject({
      situacao: 'em_recurso',
      valor_recuperado: '600.00',
      encerrada: 0,
    });
    const r3 = Number(String((await recorrer([{ item: a3 }], '2026-11-25')).resultado['recursos']));
    await retorno(a3, 'negado', 9735);
    expect(await recurso(r3)).toMatchObject({ situacao: 'negado', valor_acatado: '0.00' });
    expect(await glosaDe(a1)).toMatchObject({
      situacao: 'recuperada',
      valor_recuperado: '600.00',
      encerrada: 1,
    });
    // Fonte B negada por inteiro: a glosa encerra sem recuperar nada.
    await retorno(b1, 'negado', 9735);
    expect(await recurso(rb)).toMatchObject({ situacao: 'negado', valor_acatado: '0.00' });
    expect(await glosaDe(b1)).toMatchObject({
      situacao: 'encerrada',
      valor_recuperado: '0.00',
      encerrada: 1,
    });
  }, 120_000);
});
