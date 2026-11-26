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
const armazem = armazemXmlMemoria();

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
    // A reapresentação aponta o recurso anterior (fk_recurso_glosa_recurso_glosa_anterior_id): solta antes de apagar.
    await e.executar(
      'UPDATE recurso_glosa SET recurso_glosa_anterior_id = NULL WHERE estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM recurso_glosa WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM glosa WHERE estabelecimento_id = ?', est);
    // O demonstrativo sintético aponta o lote de origem; as linhas de guia e o honorário apontam a guia principal.
    await e.executar('DELETE FROM demonstrativo_analise_conta WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE FROM guia_tiss_procedimento WHERE guia_tiss_id IN (SELECT id FROM guia_tiss WHERE estabelecimento_id = ?)',
      est,
    );
    // A guia de recurso TISS (lote_tiss "recurso_glosa" com o arquivo) e o lote de origem sintético.
    await e.executar(
      'DELETE FROM guia_tiss WHERE estabelecimento_id = ? AND guia_tiss_principal_id IS NOT NULL',
      est,
    );
    await e.executar('DELETE FROM guia_tiss WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE FROM lote_tiss_conta WHERE lote_tiss_id IN (SELECT id FROM lote_tiss WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar("DELETE FROM lote_tiss WHERE estabelecimento_id = ? AND tipo_envio <> 'normal'", est);
    await e.executar('DELETE FROM lote_tiss WHERE estabelecimento_id = ?', est);
    await e.executar("DELETE FROM arquivo WHERE estabelecimento_id = ? AND entidade = 'lote_tiss'", est);
    await e.executar('DELETE FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id = ?', est);
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
        ['1001', true],
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
    porta = new PortaTissPropria(nucleo, CLIENTE, armazem);
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

  it('reapresentação: recurso negado ou em parte volta num recurso novo ligado ao anterior, com prazo do retorno e teto do que não voltou; nada apagado', async () => {
    const [fa] = massa.fontes as [number, number];
    const [x] = (await novaConta(`${P}-C6`, fa, 1)) as [number];
    await executar('faturamento.registrarGlosa', {
      itens: [{ item: x, versao: await versao(x), valorPago: 0, quantidadePaga: 0, motivo: 9734 }],
      dataPagamento: '2026-11-10',
      prazoParametro: `${fa}:30`,
    });
    await porta.gravarSgh(
      c,
      (y: { id: number }) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao' as const,
        entidade: 'glosa_item',
        entidadeId: y.id,
        motivo: 'decisão da glosa (teste)',
      }),
      (g) =>
        g.decidirGlosa({
          item: x,
          decisao: 'recorrer',
          texto: 'Procedimento autorizado pela senha da guia',
          evidencia: '',
          usuario: 'x',
          prazo: null,
        }),
    );
    const recorrer = async (dataProtocolo: string, valor?: number) =>
      executar('faturamento.registrarRecurso', {
        itens: [{ item: x, versao: await versao(x), ...(valor === undefined ? {} : { valor }) }],
        dataProtocolo,
        prazoParametro: `${fa}:30`,
      });
    const retorno = async (data: string, desfecho: string, valor: number | null, motivo: number | null) =>
      executar('faturamento.registrarRetornoRecurso', {
        itens: [{ item: x, versao: await versao(x), desfecho, valor, motivo }],
        data,
        numeroDemonstrativo: 'DEM-0734R',
      });
    const recurso = (id: number) =>
      lerUma(
        `SELECT situacao, valor_recursado, valor_acatado, recurso_glosa_anterior_id AS anterior,
                DATE_FORMAT(prazo_ate, '%Y-%m-%d') AS prazo FROM recurso_glosa WHERE id = ?`,
        [id],
      );
    const itemGlosa = () =>
      lerUma(
        `SELECT gi.valor_recursado, gi.valor_recuperado, gi.data_recuperacao IS NULL AS aguardando, gi.recurso_glosa_id AS rec,
                g.situacao, g.valor_recursado AS glosa_recursado, g.valor_recuperado AS glosa_recuperado,
                g.encerrado_em IS NOT NULL AS encerrada
           FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id WHERE gi.conta_hospitalar_item_id = ?`,
        [x],
      );
    const idDe = (r: { resultado: Record<string, unknown> }) => Number(String(r.resultado['recursos']));

    // Primeiro recurso (200 dos 300 glosados); reapresentar antes do retorno recusa.
    const r1 = idDe(await recorrer('2026-11-20', 200));
    expect(codigo(await erroDe(recorrer('2026-11-21')))).toBe('ja-recorrido');
    // Retorno em parte (50): a glosa encerra como recuperada.
    await retorno('2026-12-05', 'parcial', 50, 9735);
    expect(await recurso(r1)).toMatchObject({
      situacao: 'acatado_parcial',
      valor_acatado: '50.00',
      anterior: null,
    });
    expect(await itemGlosa()).toMatchObject({
      situacao: 'recuperada',
      encerrada: 1,
      valor_recuperado: '50.00',
    });

    // Reapresentação: teto = 300 − 50 que já voltou; prazo de 30 dias contado do retorno (05/12 → 04/01).
    expect(codigo(await erroDe(recorrer('2026-12-10', 250.01)))).toBe('valor-acima-da-glosa');
    expect(codigo(await erroDe(recorrer('2027-01-05')))).toBe('prazo-vencido');
    const r2 = idDe(await recorrer('2026-12-10'));
    expect(await recurso(r2)).toMatchObject({
      situacao: 'enviado',
      valor_recursado: '250.00',
      anterior: r1,
      prazo: '2027-01-04',
    });
    // O item volta a esperar retorno; o recursado da cadeia é o que voltou mais o novo pleito; a glosa reabre.
    expect(await itemGlosa()).toMatchObject({
      valor_recursado: '300.00',
      valor_recuperado: '50.00',
      aguardando: 1,
      rec: r2,
      situacao: 'em_recurso',
      glosa_recursado: '300.00',
      encerrada: 0,
    });
    // Nada apagado: o primeiro recurso e o retorno dele continuam como estavam.
    expect(
      await lerUma(
        `SELECT r.situacao, ri.valor_recursado, ri.valor_acatado, DATE_FORMAT(ri.retornado_em, '%Y-%m-%d') AS em
           FROM recurso_glosa r JOIN recurso_glosa_item ri ON ri.recurso_glosa_id = r.id WHERE r.id = ?`,
        [r1],
      ),
    ).toMatchObject({
      situacao: 'acatado_parcial',
      valor_recursado: '200.00',
      valor_acatado: '50.00',
      em: '2026-12-05',
    });

    // Retorno da reapresentação: negado; repetir o retorno recusa; o recuperado continua 50 e a glosa encerra.
    await retorno('2026-12-20', 'negado', null, 9735);
    expect(codigo(await erroDe(retorno('2026-12-21', 'negado', null, 9735)))).toBe('retorno-ja-baixado');
    expect(await recurso(r2)).toMatchObject({ situacao: 'negado', valor_acatado: '0.00' });
    expect(await itemGlosa()).toMatchObject({
      situacao: 'recuperada',
      encerrada: 1,
      valor_recuperado: '50.00',
    });

    // Segunda reapresentação, acatada por inteiro: tudo voltou e não há mais o que reapresentar.
    const r3 = idDe(await recorrer('2026-12-22'));
    expect(await recurso(r3)).toMatchObject({ valor_recursado: '250.00', anterior: r2 });
    await retorno('2026-12-28', 'acatado', null, null);
    expect(await recurso(r3)).toMatchObject({ situacao: 'acatado', valor_acatado: '250.00' });
    expect(await itemGlosa()).toMatchObject({
      valor_recursado: '300.00',
      valor_recuperado: '300.00',
      glosa_recuperado: '300.00',
      situacao: 'recuperada',
      encerrada: 1,
    });
    expect(codigo(await erroDe(recorrer('2026-12-29')))).toBe('nada-a-reapresentar');
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q FROM recurso_glosa r JOIN recurso_glosa_item ri ON ri.recurso_glosa_id = r.id
          WHERE ri.conta_hospitalar_item_id = ? AND ri.retornado_em IS NOT NULL`,
        [x],
      ),
    ).toMatchObject({ q: 3 });
  }, 120_000);

  it('guia de recurso TISS: o recurso da conta apresentada em lote protocolado vira o XML 04.03.00 por item, validado, guardado e num lote de recurso ligado ao de origem; sem lote de origem, o recurso fica gravado com o alerta', async () => {
    const [fa] = massa.fontes as [number, number];
    const [t1, t2] = (await novaConta(`${P}-C7`, fa, 2)) as [number, number];
    const [u1] = (await novaConta(`${P}-C8`, fa, 1)) as [number];
    const origem = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-0734c' },
      async (e) => {
        const agora = new Date();
        const versaoTiss = await garantir(
          e,
          "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
          [],
          `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA L0734', '2020-01-01', 'teste', ?)`,
          [agora],
        );
        await e.inserir(
          `INSERT INTO configuracao_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, versao_padrao_tiss_id,
           vigencia_inicio, registro_ans, codigo_prestador_operadora, criado_em)
         VALUES (?, ?, ?, '2020-01-01', '999998', 'PRESTSINT34', ?)`,
          [ids.est, fa, versaoTiss, agora],
        );
        const conta = Number(
          (await e.uma<{ id: number }>(
            'SELECT conta_hospitalar_id AS id FROM conta_hospitalar_item WHERE id = ?',
            [t1],
          ))!.id,
        );
        const lote = await e.inserir(
          `INSERT INTO lote_tiss (estabelecimento_id, fonte_pagadora_id, numero_lote, sequencial, tipo_guia,
           versao_padrao_tiss_id, gerado_em, quantidade_guias, valor_total, numero_protocolo, situacao, protocolado_em,
           criado_em)
         VALUES (?, ?, '000000073401', '000000073401', 'resumo_internacao', ?, ?, 1, 600, '734001', 'protocolado', ?, ?)`,
          [ids.est, fa, versaoTiss, agora, agora, agora],
        );
        await e.inserir(
          'INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, valor, criado_em) VALUES (?, ?, 600, ?)',
          [lote, conta, agora],
        );
        await e.inserir(
          `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, lote_tiss_id, fonte_pagadora_id,
           paciente_id, numero_guia_prestador, numero_guia_operadora, data_emissao, situacao, criado_em)
         VALUES (?, ?, 'resumo_internacao', ?, ?, ?, 'GS734001', 'OP734001', CURRENT_DATE, 'enviada', ?)`,
          [ids.est, conta, lote, fa, massa.paciente, agora],
        );
        return lote;
      },
    );
    await executar('faturamento.registrarGlosa', {
      itens: await Promise.all(
        [t1, t2, u1].map(async (i) => ({
          item: i,
          versao: await versao(i),
          valorPago: 0,
          quantidadePaga: 0,
          motivo: 1001,
        })),
      ),
      dataPagamento: '2026-11-10',
      prazoParametro: `${fa}:30`,
    });
    for (const item of [t1, t2, u1])
      await porta.gravarSgh(
        c,
        (y: { id: number }) => ({
          estabelecimento: null,
          usuario: null,
          correlacao: null,
          acao: 'alteracao' as const,
          entidade: 'glosa_item',
          entidadeId: y.id,
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
    const guardados = armazem.objetos.size;
    const rec = await executar('faturamento.registrarRecurso', {
      itens: await Promise.all(
        [{ item: t1, valor: 300 }, { item: u1 }, { item: t2, valor: 120.5 }].map(async (i) => ({
          ...i,
          versao: await versao(i.item),
        })),
      ),
      dataProtocolo: '2026-11-20',
      prazoParametro: '',
    });
    // Dois recursos: o da conta apresentada no lote protocolado (dois itens) e o da conta fora de lote (um item).
    const [rt, ru] = String(rec.resultado['recursos']).split(',').map(Number) as [number, number];
    const loteRecurso = Number(rec.resultado['lotesTiss']);
    expect(String(rec.resultado['lotesTiss']).split(',')).toHaveLength(1);
    expect(String(rec.resultado['alertas'])).toContain(
      'não foi gerada: falta o lote TISS em que a conta foi apresentada',
    );
    expect(
      await lerUma(
        `SELECT r.lote_tiss_id AS lote, r.valor_recursado, (SELECT COUNT(*) FROM recurso_glosa_item WHERE recurso_glosa_id = r.id) AS itens
           FROM recurso_glosa r WHERE r.id = ?`,
        [rt],
      ),
    ).toMatchObject({ lote: loteRecurso, valor_recursado: '420.50', itens: 2 });
    expect(await lerUma('SELECT lote_tiss_id AS lote FROM recurso_glosa WHERE id = ?', [ru])).toMatchObject({
      lote: null,
    });
    // O lote de recurso: tipo recurso_glosa, ligado ao de origem, enviado na data do protocolo, com o arquivo guardado.
    const l = await lerUma(
      `SELECT lt.tipo_envio, lt.tipo_guia, lt.original_lote_tiss_id AS origem, lt.situacao, lt.quantidade_guias AS guias,
              lt.valor_total, DATE_FORMAT(lt.enviado_em, '%Y-%m-%d') AS enviado, lt.hash_arquivo, lt.tamanho_bytes,
              a.chave_armazenamento AS chave, a.hash_sha256, a.tamanho_bytes AS bytes_arquivo, a.imutavel,
              a.entidade_id
         FROM lote_tiss lt JOIN arquivo a ON a.id = lt.arquivo_id WHERE lt.id = ?`,
      [loteRecurso],
    );
    expect(l).toMatchObject({
      tipo_envio: 'recurso_glosa',
      tipo_guia: 'recurso_glosa',
      origem,
      situacao: 'enviado',
      guias: 1,
      valor_total: '420.50',
      enviado: '2026-11-20',
      imutavel: 1,
      entidade_id: loteRecurso,
    });
    expect(l?.['hash_sha256']).toBe(l?.['hash_arquivo']);
    expect(Number(l?.['bytes_arquivo'])).toBe(Number(l?.['tamanho_bytes']));
    expect(armazem.objetos.size).toBe(guardados + 1);
    const xml = new TextDecoder('latin1').decode(armazem.objetos.get(String(l?.['chave']))!);
    expect(xml).toContain('<ans:tipoTransacao>RECURSO_GLOSA</ans:tipoTransacao>');
    expect(xml).toContain('<ans:numeroLote>73401</ans:numeroLote>');
    expect(xml).toContain('<ans:numeroProtocolo>734001</ans:numeroProtocolo>');
    expect(xml).toContain('<ans:numeroGuiaOrigem>GS734001</ans:numeroGuiaOrigem>');
    expect(xml).toContain('<ans:numeroGuiaOperadora>OP734001</ans:numeroGuiaOperadora>');
    expect(xml.match(/<ans:itensGuia>/g)).toHaveLength(2);
    expect(xml).toContain('<ans:codGlosaItem>1001</ans:codGlosaItem>');
    expect(xml).toContain('<ans:valorTotalRecursado>420.50</ans:valorTotalRecursado>');
    // O lote de origem segue como estava (nada apagado nem alterado).
    expect(
      await lerUma('SELECT situacao, numero_protocolo FROM lote_tiss WHERE id = ?', [origem]),
    ).toMatchObject({ situacao: 'protocolado', numero_protocolo: '734001' });
  }, 120_000);

  it('guia de recurso TISS: a glosa do demonstrativo cita o lote que ela respondeu (não a reapresentação mais nova) e cada item vai sob a guia em que foi apresentado', async () => {
    const [fa] = massa.fontes as [number, number];
    const [h1, h2] = (await novaConta(`${P}-C9`, fa, 2)) as [number, number];
    const preparo = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-0734d' },
      async (e) => {
        const agora = new Date();
        const versaoTiss = await garantir(
          e,
          "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
          [],
          `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA L0734', '2020-01-01', 'teste', ?)`,
          [agora],
        );
        await garantir(
          e,
          'SELECT id FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? LIMIT 1',
          [ids.est, fa],
          `INSERT INTO configuracao_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, versao_padrao_tiss_id,
           vigencia_inicio, registro_ans, codigo_prestador_operadora, criado_em)
         VALUES (?, ?, ?, '2020-01-01', '999998', 'PRESTSINT34', ?)`,
          [ids.est, fa, versaoTiss, agora],
        );
        const conta = Number(
          (await e.uma<{ id: number }>(
            'SELECT conta_hospitalar_id AS id FROM conta_hospitalar_item WHERE id = ?',
            [h1],
          ))!.id,
        );
        const lote = (numero: string, protocolo: string | null, situacao: string, original: number | null) =>
          e.inserir(
            `INSERT INTO lote_tiss (estabelecimento_id, fonte_pagadora_id, numero_lote, sequencial, tipo_guia, tipo_envio,
             original_lote_tiss_id, versao_padrao_tiss_id, gerado_em, quantidade_guias, valor_total, numero_protocolo,
             situacao, protocolado_em, criado_em)
           VALUES (?, ?, ?, ?, 'resumo_internacao', ?, ?, ?, ?, 2, 600, ?, ?, ?, ?)`,
            [
              ids.est,
              fa,
              numero,
              numero,
              original === null ? 'normal' : 'reapresentacao',
              original,
              versaoTiss,
              agora,
              protocolo,
              situacao,
              protocolo === null ? null : agora,
              agora,
            ],
          );
        const guia = (
          lt: number,
          numero: string,
          operadora: string,
          tipo: string,
          principal: number | null,
        ) =>
          e.inserir(
            `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, guia_tiss_principal_id, lote_tiss_id,
             fonte_pagadora_id, paciente_id, numero_guia_prestador, numero_guia_operadora, data_emissao, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, 'enviada', ?)`,
            [ids.est, conta, tipo, principal, lt, fa, massa.paciente, numero, operadora, agora],
          );
        // O lote original, protocolado, com a guia principal e um honorário individual que traz o segundo item.
        const original = await lote('000000073421', '734201', 'protocolado', null);
        const principal = await guia(original, 'GS734201', 'OP734201', 'resumo_internacao', null);
        const honorario = await guia(original, 'GH734201', 'OH734201', 'honorario', principal);
        await e.inserir(
          `INSERT INTO guia_tiss_procedimento (guia_tiss_id, sequencia, conta_hospitalar_item_id, tabela_tiss,
           codigo_procedimento, descricao, data_realizacao, quantidade_realizada, valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, '22', '10101039', 'HONORARIO SINTETICO L0734', CURRENT_DATE, 1, 300, 300, ?)`,
          [honorario, h2, agora],
        );
        // A reapresentação mais nova da mesma conta, ainda sem protocolo: não é o lote que a glosa respondeu.
        const reapresentacao = await lote('000000073422', null, 'enviado', original);
        await guia(reapresentacao, 'GS734202', 'OP734202', 'resumo_internacao', null);
        for (const lt of [original, reapresentacao])
          await e.inserir(
            'INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, valor, criado_em) VALUES (?, ?, 600, ?)',
            [lt, conta, agora],
          );
        const demonstrativo = await e.inserir(
          `INSERT INTO demonstrativo_analise_conta (estabelecimento_id, fonte_pagadora_id, lote_tiss_id,
             numero_demonstrativo, numero_protocolo, data_emissao, valor_informado, valor_liberado, valor_glosa, situacao,
             criado_em)
           VALUES (?, ?, ?, 'DEM-073421', '734201', '2026-11-10', 600, 0, 600, 'importado', ?)`,
          [ids.est, fa, original, agora],
        );
        return { original, reapresentacao, demonstrativo };
      },
    );
    await executar('faturamento.registrarGlosa', {
      itens: await Promise.all(
        [h1, h2].map(async (i) => ({
          item: i,
          versao: await versao(i),
          valorPago: 0,
          quantidadePaga: 0,
          motivo: 1001,
        })),
      ),
      dataPagamento: '2026-11-10',
      prazoParametro: `${fa}:30`,
      demonstrativo: preparo.demonstrativo,
    });
    for (const item of [h1, h2])
      await porta.gravarSgh(
        c,
        (y: { id: number }) => ({
          estabelecimento: null,
          usuario: null,
          correlacao: null,
          acao: 'alteracao' as const,
          entidade: 'glosa_item',
          entidadeId: y.id,
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
    expect(
      await lerUma(
        'SELECT demonstrativo_analise_conta_id AS d FROM glosa WHERE conta_hospitalar_id = (SELECT conta_hospitalar_id FROM conta_hospitalar_item WHERE id = ?)',
        [h1],
      ),
    ).toMatchObject({ d: preparo.demonstrativo });
    const rec = await executar('faturamento.registrarRecurso', {
      itens: await Promise.all(
        [
          { item: h1, valor: 100 },
          { item: h2, valor: 50 },
        ].map(async (i) => ({
          ...i,
          versao: await versao(i.item),
        })),
      ),
      dataProtocolo: '2026-11-20',
      prazoParametro: '',
    });
    expect(String(rec.resultado['alertas'] ?? '')).not.toContain('Glosa sem demonstrativo ligado');
    const loteRecurso = Number(rec.resultado['lotesTiss']);
    expect(loteRecurso).toBeGreaterThan(0);
    const l = await lerUma(
      `SELECT lt.original_lote_tiss_id AS origem, lt.quantidade_guias AS guias, a.chave_armazenamento AS chave
         FROM lote_tiss lt JOIN arquivo a ON a.id = lt.arquivo_id WHERE lt.id = ?`,
      [loteRecurso],
    );
    // Ligado ao lote que a glosa respondeu, com uma guia de recurso por guia de origem (principal e honorário).
    expect(l).toMatchObject({ origem: preparo.original, guias: 2 });
    const xml = new TextDecoder('latin1').decode(armazem.objetos.get(String(l?.['chave']))!);
    expect(xml).toContain('<ans:numeroLote>73421</ans:numeroLote>');
    expect(xml).toContain('<ans:numeroProtocolo>734201</ans:numeroProtocolo>');
    expect(xml).not.toContain('73422');
    expect(xml).not.toContain('GS734202');
    expect(xml).toContain('<ans:numeroGuiaOrigem>GS734201</ans:numeroGuiaOrigem>');
    expect(xml).toContain('<ans:numeroGuiaOrigem>GH734201</ans:numeroGuiaOrigem>');
    expect(xml).toContain('<ans:numeroGuiaOperadora>OH734201</ans:numeroGuiaOperadora>');
    // O item do honorário vai com a tabela, o código e a descrição da linha da guia enviada.
    const doHonorario = xml.slice(xml.indexOf('GH734201'));
    expect(doHonorario).toContain('<ans:codigoProcedimento>10101039</ans:codigoProcedimento>');
    expect(doHonorario).toContain('HONORARIO SINTETICO L0734');
    // Os lotes de origem seguem como estavam.
    expect(
      await lerUma('SELECT situacao, numero_protocolo FROM lote_tiss WHERE id = ?', [preparo.reapresentacao]),
    ).toMatchObject({ situacao: 'enviado', numero_protocolo: null });
  }, 120_000);
});
