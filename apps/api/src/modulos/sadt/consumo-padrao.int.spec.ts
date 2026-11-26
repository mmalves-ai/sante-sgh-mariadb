// Contrato de efeito do consumo padrão do exame (F8, 05-SADT linha 22) no cliente f22_o3, com massa SINTÉTICA (estoque
// da massa de suprimentos "F22L0314" e o exame com códigos "C1097"; nenhuma pessoa real). Prova o que fica no banco:
//   - cadastro: o consumo e os itens; o repetido do mesmo exame e setor é recusado; a alteração com a versão lida
//     troca a quantidade e o item que sai fica com `excluido_em` (nunca apagado); a versão velha é recusada;
//   - realização: o produto cobrável sai ao paciente e vira item da conta aberta (o movimento aponta o item), o não
//     cobrável sai ao setor, o saldo baixa, cada produto vira `item_exame_insumo` com o movimento, o lote e o item da
//     conta, e o exame fica realizado; a segunda realização é recusada; o ajuste do produto não ajustável é recusado
//     sem gravar nada; o exame realizado sai da lista de pendentes;
//   - conta fechada: o cobrável que não entraria na conta recusa a realização inteira (conta-nao-lancavel), sem baixa
//     nem item_exame_insumo;
//   - pacote (lancamentoConta=false): o estoque baixa, nada vai à conta e o item fica cobravel=0;
//   - kit: o kit abre em produtos com a quantidade do kit vezes a do consumo, no movimento e no item_exame_insumo;
//   - setor contra o geral: o consumo do setor vale no setor dele e o geral (setor vazio) nos demais.
// O exame sem atendimento não existe no modelo (requisicao_exame.atendimento_id é NOT NULL): não há caso a provar.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from '../suprimentos/massa-propria.spec-util.js';
import { PortaConsumoPadraoExamePropria } from './consumo-padrao-propria.js';

const P = 'C1097';
const ESTS = `SELECT id FROM estabelecimento WHERE codigo LIKE 'F22L0314%'`;

interface Massa {
  s: MassaSuprimentos;
  hospital: string;
  exame: number;
  setor: number;
  conta: number;
  itemA: number;
  itemB: number;
  insumoSetor: number;
  setor2: number;
  examePacote: number;
  exameKit: number;
  kit: number;
  itemGeral: number;
  itemPacote: number;
  itemKit: number;
}

const nucleo = new NucleoProprio();
let m: Massa;
let porta: PortaConsumoPadraoExamePropria;
const ctx = () => ({ cliente: CLIENTE, hospital: m.hospital, usuario: m.s.usuario, correlacao: P });
const falha = (p: Promise<unknown>) =>
  p.then(
    () => ({ codigo: 'ok', status: 0 }),
    (e: { problema?: { codigo?: string; status?: number } }) => ({
      codigo: e.problema?.codigo ?? String(e),
      status: e.problema?.status ?? 0,
    }),
  );
const ler = <T>(sql: string, p: unknown[]) =>
  nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
    l.consultar<T & Record<string, unknown>>(sql, p),
  );
const numero = async (sql: string, p: unknown[]) => Number((await ler<{ n: unknown }>(sql, p))[0]?.n ?? 0);

async function limpar(e: Escritor) {
  const exames = 'SELECT id FROM exame WHERE codigo LIKE ?';
  const itens = `SELECT ei.id FROM exame_item ei WHERE ei.exame_id IN (${exames})`;
  await e.executar(`DELETE FROM item_exame_insumo WHERE exame_item_id IN (${itens})`, [`${P}%`]);
  const contas = `SELECT c.id FROM conta_hospitalar c JOIN atendimento a ON a.id = c.atendimento_id WHERE a.numero LIKE ?`;
  const itensConta = `SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`;
  await e.executar(
    `UPDATE movimento_estoque SET conta_hospitalar_item_id = NULL WHERE conta_hospitalar_item_id IN (${itensConta})`,
    [`${P}%`],
  );
  await e.executar(
    `DELETE FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id IN (${itensConta})`,
    [`${P}%`],
  );
  await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`, [`${P}%`]);
  await e.executar(
    `DELETE FROM conta_hospitalar WHERE atendimento_id IN (SELECT id FROM atendimento WHERE numero LIKE ?)`,
    [`${P}%`],
  );
  await e.executar(
    `DELETE FROM exame_item WHERE requisicao_exame_id IN (SELECT id FROM requisicao_exame WHERE numero LIKE ?)`,
    [`${P}%`],
  );
  await e.executar('DELETE FROM requisicao_exame WHERE numero LIKE ?', [`${P}%`]);
  await e.executar(
    `DELETE FROM consumo_padrao_exame_item WHERE consumo_padrao_exame_id IN (SELECT id FROM consumo_padrao_exame WHERE exame_id IN (${exames}))`,
    [`${P}%`],
  );
  await e.executar(`DELETE FROM consumo_padrao_exame WHERE exame_id IN (${exames})`, [`${P}%`]);
  const kits = `SELECT id FROM kit_material WHERE codigo LIKE ? AND estabelecimento_id IN (${ESTS})`;
  await e.executar(`DELETE FROM kit_material_item WHERE kit_material_id IN (${kits})`, [`${P}%`]);
  await e.executar(`DELETE FROM kit_material WHERE codigo LIKE ? AND estabelecimento_id IN (${ESTS})`, [
    `${P}%`,
  ]);
  await e.executar('DELETE FROM exame WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(`DELETE FROM setor_diagnostico WHERE codigo LIKE ? AND estabelecimento_id IN (${ESTS})`, [
    `${P}%`,
  ]);
  // A saída ao paciente aponta o atendimento: o movimento, os lotes e o documento dela saem antes (o saldo volta na massa).
  const atds = 'SELECT id FROM atendimento WHERE numero LIKE ?';
  const movs = `SELECT id FROM movimento_estoque WHERE atendimento_id IN (${atds})`;
  const docs = `SELECT id FROM documento_estoque WHERE atendimento_id IN (${atds})`;
  await e.executar(
    `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE documento_estoque_id IN (${docs})`,
    [`${P}%`],
  );
  await e.executar(`DELETE FROM movimento_lote WHERE movimento_estoque_id IN (${movs})`, [`${P}%`]);
  await e.executar(`DELETE FROM movimento_estoque WHERE atendimento_id IN (${atds})`, [`${P}%`]);
  await e.executar(`DELETE FROM documento_estoque_item WHERE documento_estoque_id IN (${docs})`, [`${P}%`]);
  await e.executar(`DELETE FROM documento_estoque WHERE atendimento_id IN (${atds})`, [`${P}%`]);
  await e.executar('DELETE FROM atendimento WHERE numero LIKE ?', [`${P}%`]);
  await e.executar(
    'UPDATE insumo SET item_faturavel_id = NULL WHERE item_faturavel_id IN (SELECT id FROM item_faturavel WHERE codigo LIKE ?)',
    [`${P}F%`],
  );
  await e.executar('DELETE FROM item_faturavel WHERE codigo LIKE ?', [`${P}F%`]);
}

/** O produto do setor sai antes da massa, com o próprio movimento, o item do documento e o saldo. */
async function limparProdutoSetor() {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, async (e) => {
    const ins = 'SELECT id FROM insumo WHERE codigo LIKE ?';
    await e.executar(
      `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE insumo_id IN (${ins})`,
      [`${P}N%`],
    );
    for (const t of ['movimento_lote', 'movimento_estoque', 'documento_estoque_item', 'saldo_estoque'])
      await e.executar(
        t === 'movimento_lote'
          ? `DELETE FROM movimento_lote WHERE movimento_estoque_id IN (SELECT id FROM movimento_estoque WHERE insumo_id IN (${ins}))`
          : `DELETE FROM ${t} WHERE insumo_id IN (${ins})`,
        [`${P}N%`],
      );
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}N%`]);
    await e.executar('DELETE FROM grupo_insumo WHERE codigo = ?', [`${P}GS`]);
    await e.executar('DELETE FROM unidade_medida WHERE codigo = ?', [`${P}US`]);
  });
}

async function montar(s: MassaSuprimentos, e: Escritor): Promise<Massa> {
  const agora = new Date();
  const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const est = s.estA;
  const hospital = String(
    (await e.uma<{ codigo: string }>('SELECT codigo FROM estabelecimento WHERE id = ?', [est]))!.codigo,
  );
  const pf = await g(
    'SELECT id FROM pessoa_fisica WHERE nome = ?',
    [`PACIENTE SINTETICO ${P}`],
    'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
    [`PACIENTE SINTETICO ${P}`, agora],
  );
  const paciente = await g(
    'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
    [pf],
    "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 931097, 'ativo', ?)",
    [pf, agora],
  );
  const convenio = await g(
    'SELECT id FROM fonte_pagadora WHERE codigo = ?',
    [P],
    "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
    [P, `OPERADORA ${P}`, agora],
  );
  const categoria = await g(
    'SELECT id FROM categoria_atendimento WHERE codigo = ?',
    [`${P}amb`],
    "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'CATEGORIA SINTETICA', 'ambulatorio', ?)",
    [`${P}amb`, agora],
  );
  const caraterTiss = await g(
    'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
    [`${P}c`],
    "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, 'CARATER SINTETICO', 'teste', ?)",
    [`${P}c`, agora],
  );
  const pfMedico = await g(
    'SELECT id FROM pessoa_fisica WHERE nome = ?',
    [`MEDICO SINTETICO ${P}`],
    'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
    [`MEDICO SINTETICO ${P}`, agora],
  );
  const medico = await g(
    'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
    [pfMedico],
    "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
    [pfMedico, agora],
  );
  const atendimento = await e.inserir(
    `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
       fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [est, `${P}-AT`, paciente, categoria, caraterTiss, convenio, medico, agora, agora],
  );
  const tipoConta = Number((await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM tipo_conta'))!.id);
  const conta = await e.inserir(
    `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
       natureza, competencia, inicio_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ?, ?)`,
    [
      est,
      `${P}-C${Date.now() % 1e6}`,
      atendimento,
      paciente,
      convenio,
      tipoConta,
      `${agora.toISOString().slice(0, 7)}-01`,
      new Date(agora.getTime() - 3_600_000),
      agora,
    ],
  );
  const grupoFat = await g(
    'SELECT id FROM grupo_faturamento WHERE codigo = ?',
    [`${P}GF`],
    "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'MATERIAL SINTETICO', 'material', ?)",
    [`${P}GF`, agora],
  );
  const faturavel = await e.inserir(
    `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, insumo_id, criado_em)
     VALUES (?, 'CONTRASTE SINTETICO', 'material', ?, ?, ?)`,
    [`${P}F1`, grupoFat, s.insumo, agora],
  );
  await e.executar('UPDATE insumo SET item_faturavel_id = ?, cobravel = TRUE WHERE id = ?', [
    faturavel,
    s.insumo,
  ]);
  // O produto sem item de cobrança, com saldo no local: baixa ao setor, nunca na conta.
  const grupoSetor = await inserirMinimo(e, 'grupo_insumo', { codigo: `${P}GS`, natureza: 'material' }, P);
  const unidadeSetor = await inserirMinimo(e, 'unidade_medida', { codigo: `${P}US` }, P);
  const insumoSetor = await inserirMinimo(
    e,
    'insumo',
    {
      codigo: `${P}N${Date.now() % 1e6}`,
      nome: 'SERINGA SINTETICA',
      tipo: 'material',
      grupo_insumo_id: grupoSetor,
      estoque_unidade_medida_id: unidadeSetor,
      situacao: 'ativo',
    },
    P,
  );
  await inserirMinimo(
    e,
    'saldo_estoque',
    {
      estabelecimento_id: est,
      local_estoque_id: s.localA,
      insumo_id: insumoSetor,
      quantidade: 10,
      quantidade_consignada: 0,
      custo_medio: 1.5,
    },
    P,
  );
  const setor = await e.inserir(
    `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
     VALUES (?, ?, 'IMAGEM SINTETICA', 'imagem', ?, 1)`,
    [est, `${P}I`, agora],
  );
  const modalidade = await g(
    "SELECT id FROM modalidade_imagem WHERE codigo = 'CT'",
    [],
    "INSERT INTO modalidade_imagem (codigo, descricao, ativo, sigla_padrao, criado_em, versao) VALUES ('CT', 'Tomografia', TRUE, 'CT', ?, 1)",
    [agora],
  );
  const exame = await e.inserir(
    `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, modalidade_imagem_id, ativo, criado_em, versao)
     VALUES (?, ?, 'TOMOGRAFIA COM CONTRASTE SINTETICA', 'imagem', 'laudo', ?, TRUE, ?, 1)`,
    [`${P}T`, `${P}T`, modalidade, agora],
  );
  const requisicao = await e.inserir(
    `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
       fonte_pagadora_id, solicitante_profissional_id, solicitado_em, criado_em, versao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [est, `${P}-R1`, paciente, atendimento, setor, convenio, medico, agora, agora],
  );
  const item = (seq: number, req = requisicao, ex = exame) =>
    e.inserir(
      `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em, versao)
       VALUES (?, ?, ?, 'solicitado', ?, 1)`,
      [req, seq, ex, agora],
    );
  const itemA = await item(1);
  const itemB = await item(2);
  // O segundo setor (sem consumo próprio: vale o geral), o exame de pacote e o exame do kit.
  const setor2 = await e.inserir(
    `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
     VALUES (?, ?, 'IMAGEM SINTETICA DOIS', 'imagem', ?, 1)`,
    [est, `${P}J`, agora],
  );
  const novoExame = (sufixo: string, nome: string) =>
    e.inserir(
      `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, modalidade_imagem_id, ativo, criado_em, versao)
       VALUES (?, ?, ?, 'imagem', 'laudo', ?, TRUE, ?, 1)`,
      [`${P}${sufixo}`, `${P}${sufixo}`, nome, modalidade, agora],
    );
  const examePacote = await novoExame('P', 'TOMOGRAFIA EM PACOTE SINTETICA');
  const exameKit = await novoExame('K', 'PUNCAO GUIADA SINTETICA');
  const kit = await e.inserir(
    `INSERT INTO kit_material (estabelecimento_id, codigo, nome, tipo, ativo, criado_em, versao)
     VALUES (?, ?, 'KIT SINTETICO DE PUNCAO', 'procedimento', TRUE, ?, 1)`,
    [est, `${P}KIT`, agora],
  );
  const unidadeInsumo = Number(
    (await e.uma<{ u: number }>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [
      s.insumo,
    ]))!.u,
  );
  for (const [seq, ins, un, q] of [
    [1, insumoSetor, unidadeSetor, 2],
    [2, s.insumo, unidadeInsumo, 1],
  ] as const)
    await e.executar(
      `INSERT INTO kit_material_item (kit_material_id, sequencia, insumo_id, unidade_medida_id, quantidade, criado_em, versao)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [kit, seq, ins, un, q, agora],
    );
  const requisicao2 = await e.inserir(
    `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
       fonte_pagadora_id, solicitante_profissional_id, solicitado_em, criado_em, versao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [est, `${P}-R2`, paciente, atendimento, setor2, convenio, medico, agora, agora],
  );
  return {
    s,
    hospital,
    exame,
    setor,
    conta,
    itemA,
    itemB,
    insumoSetor,
    setor2,
    examePacote,
    exameKit,
    kit,
    itemGeral: await item(1, requisicao2, exame),
    itemPacote: await item(2, requisicao2, examePacote),
    itemKit: await item(3, requisicao2, exameKit),
  };
}

describe.skipIf(SEM_BANCO)('consumo padrão do exame (05-SADT linha 22): contrato de efeito', () => {
  beforeAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, limpar).catch(() => undefined);
    await limparProdutoSetor().catch(() => undefined);
    const s = await montarMassa(nucleo);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-massa` }, (e) => montar(s, e));
    porta = new PortaConsumoPadraoExamePropria(nucleo, CLIENTE);
  }, 180_000);

  afterAll(async () => {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, limpar);
    await limparProdutoSetor();
    await limparMassa(nucleo, m.s);
  }, 180_000);

  let consumo = 0;

  it('cadastro: inclui, recusa o repetido, altera com a versão lida e o item que sai fica marcado', async () => {
    const base = {
      exame: m.exame,
      setor: m.setor,
      descricao: 'Tomografia com contraste',
      baixaAutomatica: true,
      lancamentoConta: true,
    };
    const r = await porta.salvar(ctx(), {
      ...base,
      itens: [
        { insumo: m.s.insumo, kit: null, quantidade: 2, ajustavel: true },
        { insumo: m.insumoSetor, kit: null, quantidade: 1, ajustavel: false },
        { insumo: m.s.insumoOpme, kit: null, quantidade: 1, ajustavel: true },
      ],
    });
    consumo = r.id;
    expect(
      await numero(
        'SELECT COUNT(*) AS n FROM consumo_padrao_exame_item WHERE consumo_padrao_exame_id = ? AND excluido_em IS NULL',
        [consumo],
      ),
    ).toBe(3);
    expect(
      await falha(
        porta.salvar(ctx(), {
          ...base,
          itens: [{ insumo: m.s.insumo, kit: null, quantidade: 1, ajustavel: true }],
        }),
      ),
    ).toEqual({ codigo: 'consumo-repetido', status: 409 });
    const alterado = await porta.salvar(ctx(), {
      ...base,
      id: consumo,
      versao: r.versao,
      itens: [
        { insumo: m.s.insumo, kit: null, quantidade: 1, ajustavel: true },
        { insumo: m.insumoSetor, kit: null, quantidade: 1, ajustavel: false },
      ],
    });
    expect(alterado.versao).toBe(r.versao + 1);
    const linhas = await ler<{ insumo_id: number; quantidade: string; excluido_em: Date | null }>(
      'SELECT insumo_id, quantidade, excluido_em FROM consumo_padrao_exame_item WHERE consumo_padrao_exame_id = ? ORDER BY sequencia',
      [consumo],
    );
    expect(linhas.map((l) => [Number(l.insumo_id), Number(l.quantidade), l.excluido_em !== null])).toEqual([
      [m.s.insumo, 1, false],
      [m.insumoSetor, 1, false],
      [m.s.insumoOpme, 1, true],
    ]);
    expect(
      (await falha(porta.salvar(ctx(), { ...base, id: consumo, versao: r.versao, itens: [] }))).status,
    ).toBe(422);
    expect(
      (
        await falha(
          porta.salvar(ctx(), {
            ...base,
            id: consumo,
            versao: r.versao,
            itens: [{ insumo: m.s.insumo, kit: null, quantidade: 1, ajustavel: true }],
          }),
        )
      ).status,
    ).toBe(409);
  });

  it('realização: baixa no estoque, item na conta, item_exame_insumo e exame realizado; nada em dobro', async () => {
    const pend = await porta.pendentes(ctx(), m.setor);
    expect(pend.map((p) => p.item).sort()).toEqual([m.itemA, m.itemB].sort());
    const sug = await porta.sugestao(ctx(), m.itemA);
    expect(sug.consumo?.id).toBe(consumo);
    expect(sug.produtos.map((p) => [p.insumo, p.cobravelNoCadastro])).toEqual([
      [m.s.insumo, true],
      [m.insumoSetor, false],
    ]);
    const saldo = (insumo: number) =>
      numero('SELECT quantidade AS n FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
        m.s.localA,
        insumo,
      ]);
    const antes = [await saldo(m.s.insumo), await saldo(m.insumoSetor)];
    const itensContaAntes = await numero(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [m.conta],
    );
    const r = await porta.realizar(ctx(), m.itemA, {
      local: m.s.localA,
      ajustes: [{ insumo: m.s.insumo, quantidade: 2 }],
    });
    expect(r).toMatchObject({ id: m.itemA, baixados: 2, itensConta: 1 });
    expect([await saldo(m.s.insumo), await saldo(m.insumoSetor)]).toEqual([antes[0]! - 2, antes[1]! - 1]);
    const ins = await ler<{
      insumo_id: number;
      quantidade_consumida: string;
      cobravel: number;
      movimento_estoque_id: number | null;
      conta_hospitalar_item_id: number | null;
      consumo_padrao_exame_id: number;
      lote_insumo_id: number | null;
    }>('SELECT * FROM item_exame_insumo WHERE exame_item_id = ? ORDER BY sequencia', [m.itemA]);
    expect(
      ins.map((x) => [
        Number(x.insumo_id),
        Number(x.quantidade_consumida),
        Boolean(x.cobravel),
        x.movimento_estoque_id !== null,
        x.conta_hospitalar_item_id !== null,
        Number(x.consumo_padrao_exame_id),
      ]),
    ).toEqual([
      [m.s.insumo, 2, true, true, true, consumo],
      [m.insumoSetor, 1, false, true, false, consumo],
    ]);
    // O item da conta é do produto, com a quantidade, e o movimento da saída aponta o item.
    const ci = await ler<{ quantidade: string; situacao: string; movimento_estoque_id: number }>(
      'SELECT quantidade, situacao, movimento_estoque_id FROM conta_hospitalar_item WHERE id = ?',
      [ins[0]!.conta_hospitalar_item_id],
    );
    expect([Number(ci[0]!.quantidade), ci[0]!.situacao, Number(ci[0]!.movimento_estoque_id)]).toEqual([
      2,
      'lancado',
      Number(ins[0]!.movimento_estoque_id),
    ]);
    expect(
      await numero('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [
        m.conta,
      ]),
    ).toBe(itensContaAntes + 1);
    expect(
      await numero(
        'SELECT COUNT(*) AS n FROM exame_item WHERE id = ? AND realizado_em IS NOT NULL AND realizado_por_usuario_id = ?',
        [m.itemA, m.s.usuario],
      ),
    ).toBe(1);
    expect(await falha(porta.realizar(ctx(), m.itemA, { local: m.s.localA }))).toEqual({
      codigo: 'consumo-ja-baixado',
      status: 409,
    });
    expect(
      await numero('SELECT COUNT(*) AS n FROM item_exame_insumo WHERE exame_item_id = ?', [m.itemA]),
    ).toBe(2);
    expect((await porta.pendentes(ctx(), m.setor)).map((p) => p.item)).toEqual([m.itemB]);
  });

  it('o ajuste do produto não ajustável é recusado sem gravar nada', async () => {
    const saldoAntes = await numero(
      'SELECT quantidade AS n FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.s.localA, m.insumoSetor],
    );
    expect(
      (
        await falha(
          porta.realizar(ctx(), m.itemB, {
            local: m.s.localA,
            ajustes: [{ insumo: m.insumoSetor, quantidade: 3 }],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      await numero('SELECT COUNT(*) AS n FROM item_exame_insumo WHERE exame_item_id = ?', [m.itemB]),
    ).toBe(0);
    expect(
      await numero('SELECT quantidade AS n FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
        m.s.localA,
        m.insumoSetor,
      ]),
    ).toBe(saldoAntes);
    expect(
      await numero('SELECT COUNT(*) AS n FROM exame_item WHERE id = ? AND realizado_em IS NULL', [m.itemB]),
    ).toBe(1);
  });

  const saldo = (insumo: number) =>
    numero('SELECT quantidade AS n FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
      m.s.localA,
      insumo,
    ]);
  const itensDaConta = () =>
    numero('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [m.conta]);
  const baixas = (item: number) =>
    ler<{
      insumo_id: number;
      quantidade_consumida: string;
      cobravel: number;
      conta_hospitalar_item_id: number | null;
      consumo_padrao_exame_id: number;
      mov_quantidade: string | null;
    }>(
      `SELECT x.insumo_id, x.quantidade_consumida, x.cobravel, x.conta_hospitalar_item_id, x.consumo_padrao_exame_id,
              mv.quantidade AS mov_quantidade
         FROM item_exame_insumo x LEFT JOIN movimento_estoque mv ON mv.id = x.movimento_estoque_id
        WHERE x.exame_item_id = ? ORDER BY x.insumo_id`,
      [item],
    ).then((ls) =>
      ls.map((x) => [
        Number(x.insumo_id),
        Number(x.quantidade_consumida),
        Boolean(x.cobravel),
        x.conta_hospitalar_item_id !== null,
        Number(x.consumo_padrao_exame_id),
        x.mov_quantidade === null ? null : Number(x.mov_quantidade),
      ]),
    );

  it('conta fechada: o cobrável que não entraria na conta recusa a realização inteira, sem baixa', async () => {
    const situacao = (fechar: boolean) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-conta` }, (e) =>
        e.executar(
          fechar
            ? "UPDATE conta_hospitalar SET situacao = 'fechada', fechada_em = NOW(3), fechada_por_usuario_id = ? WHERE id = ?"
            : "UPDATE conta_hospitalar SET situacao = 'aberta', fechada_em = NULL, fechada_por_usuario_id = NULL WHERE id = ?",
          fechar ? [m.s.usuario, m.conta] : [m.conta],
        ),
      );
    const antes = [await saldo(m.s.insumo), await saldo(m.insumoSetor)];
    const contaAntes = await itensDaConta();
    await situacao(true);
    try {
      expect(await falha(porta.realizar(ctx(), m.itemB, { local: m.s.localA }))).toEqual({
        codigo: 'conta-nao-lancavel',
        status: 409,
      });
    } finally {
      await situacao(false);
    }
    expect(
      await numero('SELECT COUNT(*) AS n FROM item_exame_insumo WHERE exame_item_id = ?', [m.itemB]),
    ).toBe(0);
    expect([await saldo(m.s.insumo), await saldo(m.insumoSetor)]).toEqual(antes);
    expect(await itensDaConta()).toBe(contaAntes);
    expect(
      await numero('SELECT COUNT(*) AS n FROM exame_item WHERE id = ? AND realizado_em IS NULL', [m.itemB]),
    ).toBe(1);
  });

  it('setor contra o geral, pacote e kit: o que baixa, o que vai à conta e a quantidade do kit', async () => {
    const geral = await porta.salvar(ctx(), {
      exame: m.exame,
      setor: null,
      descricao: 'Tomografia, todos os setores',
      baixaAutomatica: true,
      lancamentoConta: true,
      itens: [{ insumo: m.s.insumo, kit: null, quantidade: 1, ajustavel: false }],
    });
    const pacote = await porta.salvar(ctx(), {
      exame: m.examePacote,
      setor: null,
      descricao: 'Material no preço do exame',
      baixaAutomatica: true,
      lancamentoConta: false,
      itens: [{ insumo: m.s.insumo, kit: null, quantidade: 1, ajustavel: false }],
    });
    const comKit = await porta.salvar(ctx(), {
      exame: m.exameKit,
      setor: null,
      descricao: 'Kit de punção',
      baixaAutomatica: true,
      lancamentoConta: true,
      itens: [{ insumo: null, kit: m.kit, quantidade: 2, ajustavel: false }],
    });
    // O consumo do setor vale no setor dele, mesmo com o geral do mesmo exame; no outro setor vale o geral.
    expect((await porta.sugestao(ctx(), m.itemB)).consumo?.id).toBe(consumo);
    expect((await porta.sugestao(ctx(), m.itemGeral)).consumo?.id).toBe(geral.id);
    expect((await porta.pendentes(ctx(), m.setor2)).map((p) => p.item).sort()).toEqual(
      [m.itemGeral, m.itemPacote, m.itemKit].sort(),
    );

    const contaAntes = await itensDaConta();
    const s0 = [await saldo(m.s.insumo), await saldo(m.insumoSetor)];
    const g = await porta.realizar(ctx(), m.itemGeral, { local: m.s.localA });
    expect(g).toMatchObject({ baixados: 1, itensConta: 1 });
    expect(await baixas(m.itemGeral)).toEqual([[m.s.insumo, 1, true, true, geral.id, 1]]);

    // Pacote: o estoque baixa, nada vai à conta e o item fica não cobrável.
    const contaAntesPacote = await itensDaConta();
    const pc = await porta.realizar(ctx(), m.itemPacote, { local: m.s.localA });
    expect(pc).toMatchObject({ baixados: 1, itensConta: 0 });
    expect(await baixas(m.itemPacote)).toEqual([[m.s.insumo, 1, false, false, pacote.id, 1]]);
    expect(await itensDaConta()).toBe(contaAntesPacote);

    // Kit: 2 kits de (2 seringas + 1 contraste) = 4 seringas ao setor e 2 contrastes à conta.
    const sk = await porta.sugestao(ctx(), m.itemKit);
    expect(sk.produtos.map((p) => [p.insumo, p.quantidade]).sort((a, b) => a[0]! - b[0]!)).toEqual(
      [
        [m.insumoSetor, 4],
        [m.s.insumo, 2],
      ].sort((a, b) => a[0]! - b[0]!),
    );
    const k = await porta.realizar(ctx(), m.itemKit, { local: m.s.localA });
    expect(k).toMatchObject({ baixados: 2, itensConta: 1 });
    expect(await baixas(m.itemKit)).toEqual(
      [
        [m.s.insumo, 2, true, true, comKit.id, 2],
        [m.insumoSetor, 4, false, false, comKit.id, 4],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
    expect(await itensDaConta()).toBe(contaAntes + 2);
    expect([await saldo(m.s.insumo), await saldo(m.insumoSetor)]).toEqual([s0[0]! - 4, s0[1]! - 4]);
  });
});
