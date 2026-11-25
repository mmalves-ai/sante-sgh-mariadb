// Contrato de efeito do projeto como centro de resultado (C2-107, 07-FIN linha 128) contra o MariaDB real (cliente de
// teste; migração 14_FIN/99_apropriacao_projeto_natureza). Massa SINTÉTICA: estabelecimento com o código do teste, dois
// centros de custo, um título a pagar e um título a receber sintéticos; usuário, credor, fonte pagadora, tipo de
// documento, natureza financeira e produto de estoque são ids já existentes do cliente (só lidos). Prova o que fica em
// `projeto`, `etapa_projeto`, `projeto_centro_custo`, `projeto_produto` e `apropriacao_projeto`: o cadastro com etapas,
// centros e produtos; a alteração que reativa e inativa sem apagar; a apropriação da despesa pelo percentual do título
// (com o valor realizado da etapa) e da receita pelo título a receber; o teto do documento entre projetos; o estorno que
// marca como excluída e recalcula a etapa; o resultado (orçado × realizado); e as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaProjetoResultadoPropria } from './projeto-resultado-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2107prj';

type Massa = Record<string, number>;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const prj = `(SELECT id FROM projeto WHERE estabelecimento_id IN ${est})`;
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM apropriacao_projeto WHERE projeto_id IN ${prj}`, [P]);
    await e.executar(`DELETE FROM etapa_projeto WHERE projeto_id IN ${prj}`, [P]);
    await e.executar(`DELETE FROM projeto_centro_custo WHERE projeto_id IN ${prj}`, [P]);
    await e.executar(`DELETE FROM projeto_produto WHERE projeto_id IN ${prj}`, [P]);
    await e.executar(`DELETE FROM projeto WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM titulo_pagar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM titulo_receber WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM centro_custo WHERE estabelecimento_id IN ${est}`, [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const recusa = { problema: { codigo: 'regra-violada' } };

describe.skipIf(SEM_BANCO)('PortaProjetoResultadoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProjetoResultadoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m['usuario']!, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const contar = async () =>
    Number(
      (
        await ler(
          `SELECT (SELECT COUNT(*) FROM projeto WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM etapa_projeto e JOIN projeto p ON p.id = e.projeto_id WHERE p.estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM projeto_centro_custo WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM projeto_produto x JOIN projeto p ON p.id = x.projeto_id WHERE p.estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM apropriacao_projeto a JOIN projeto p ON p.id = a.projeto_id
                    WHERE p.estabelecimento_id = ? AND a.excluido_em IS NULL) AS n`,
          [m['est'], m['est'], m['est'], m['est'], m['est']],
        )
      )[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const credor = await um('SELECT MIN(id) AS id FROM tipo_credor');
      const fornecedor = await um('SELECT MIN(id) AS id FROM empresa_fornecedora');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      const tipoDoc = await um('SELECT MIN(id) AS id FROM tipo_documento_financeiro');
      const natureza = await um('SELECT MIN(id) AS id FROM natureza_financeira');
      const insumo = await um('SELECT MIN(id) AS id FROM insumo WHERE excluido_em IS NULL');
      if (!usuario || !credor || !fornecedor || !fonte || !tipoDoc || !natureza || !insumo)
        throw new Error(
          'O cliente de teste precisa de usuário, tipo de credor, fornecedor, fonte pagadora, tipo de documento, natureza financeira e produto.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const cc = (codigo: string) =>
        e.inserir(
          `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, ativo, criado_em)
           VALUES (?, ?, ?, '2026-01-01', TRUE, ?)`,
          [est, `${P}-${codigo}`, `Centro sintético ${codigo}`, agora],
        );
      const cc1 = await cc('A');
      const cc2 = await cc('B');
      const pagar = await e.inserir(
        `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, 902107001, ?, ?, ?, 'NF-SINT-1', '2027-02-01', '2027-02-01', 1000, 1000, ?, ?)`,
        [est, credor, fornecedor, tipoDoc, natureza, agora],
      );
      const receber = await e.inserir(
        `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, 902107002, 'fonte_pagadora', ?, 'avulso', ?, 'REC-SINT-1', '2027-02-01', '2027-02-01', 800, 800, ?, ?)`,
        [est, fonte, tipoDoc, natureza, agora],
      );
      return { usuario, est, cc1, cc2, pagar, receber, insumo };
    });
    porta = new PortaProjetoResultadoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 60_000);

  const projetoBase = () => ({
    codigo: 'obra-1',
    descricao: 'Reforma sintética da ala',
    tipo: 'obra',
    verba: 1000,
    inicioPrevisto: '2027-01-01',
    fimPrevisto: '2027-12-31',
    centroResultado: m['cc1']!,
    situacao: 'em_andamento',
    etapas: [
      {
        sequencia: 1,
        descricao: 'Projeto executivo',
        inicioPrevisto: '2027-01-01',
        fimPrevisto: '2027-02-28',
        valorPrevisto: 300,
      },
      { sequencia: 2, descricao: 'Execução', centroCusto: m['cc2']!, valorPrevisto: 600 },
    ],
    centros: [
      { centroCusto: m['cc1']!, percentual: 60 },
      { centroCusto: m['cc2']!, percentual: 40 },
    ],
    produtos: [
      { insumo: m['insumo']!, quantidade: 10, valorPrevisto: 50 },
      { servico: 'Mão de obra sintética', quantidade: 1, valorPrevisto: 400 },
    ],
  });

  it('cadastro do projeto com etapas, centros e produtos; recusa sem gravar', async () => {
    const antes = await contar();
    await expect(porta.salvarProjeto(ctx(), null, { ...projetoBase(), verba: 500 })).rejects.toMatchObject(
      recusa,
    );
    await expect(
      porta.salvarProjeto(ctx(), null, {
        ...projetoBase(),
        etapas: [
          { sequencia: 1, descricao: 'Fora do prazo', inicioPrevisto: '2026-06-01', valorPrevisto: 10 },
        ],
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes);

    const p = await porta.salvarProjeto(ctx(), null, projetoBase());
    m['projeto'] = p.id!;
    const [g] = await ler(
      `SELECT codigo, tipo, situacao, valor_orcado, centro_custo_id, data_inicio_efetiva, versao, criado_por
         FROM projeto WHERE id = ?`,
      [p.id],
    );
    expect(g).toMatchObject({ codigo: 'OBRA-1', tipo: 'obra', situacao: 'em_andamento' });
    expect(Number(g!['valor_orcado'])).toBe(1000);
    expect(Number(g!['centro_custo_id'])).toBe(m['cc1']);
    expect(g!['data_inicio_efetiva']).not.toBeNull();
    expect(Number(g!['criado_por'])).toBe(m['usuario']);
    const etapas = await ler(
      'SELECT sequencia, valor_previsto, situacao FROM etapa_projeto WHERE projeto_id = ? ORDER BY sequencia',
      [p.id],
    );
    expect(etapas.map((e) => [Number(e['sequencia']), Number(e['valor_previsto']), e['situacao']])).toEqual([
      [1, 300, 'planejada'],
      [2, 600, 'planejada'],
    ]);
    expect(
      Number(
        (await ler('SELECT COUNT(*) AS n FROM projeto_centro_custo WHERE projeto_id = ?', [p.id]))[0]!['n'],
      ),
    ).toBe(2);
    expect(
      Number((await ler('SELECT COUNT(*) AS n FROM projeto_produto WHERE projeto_id = ?', [p.id]))[0]!['n']),
    ).toBe(2);
    // Código repetido no estabelecimento.
    await expect(porta.salvarProjeto(ctx(), null, projetoBase())).rejects.toMatchObject(recusa);
  });

  it('alteração: centro que sai fica excluído, produto que sai fica inativo, etapa nova entra', async () => {
    const det = await porta.projeto(ctx(), m['projeto']!);
    const base = projetoBase();
    await porta.salvarProjeto(ctx(), m['projeto']!, {
      ...base,
      verba: 1200,
      versao: det.versao,
      etapas: [...base.etapas, { sequencia: 3, descricao: 'Entrega', valorPrevisto: 200 }],
      centros: [{ centroCusto: m['cc1']!, percentual: 100 }],
      produtos: [base.produtos[0]!],
    });
    const centros = await ler(
      'SELECT centro_custo_id, percentual_participacao, excluido_em FROM projeto_centro_custo WHERE projeto_id = ? ORDER BY centro_custo_id',
      [m['projeto']],
    );
    expect(centros.map((c) => [Number(c['percentual_participacao']), c['excluido_em'] === null])).toEqual([
      [100, true],
      [40, false],
    ]);
    const produtos = await ler('SELECT ativo FROM projeto_produto WHERE projeto_id = ? ORDER BY id', [
      m['projeto'],
    ]);
    expect(produtos.map((x) => Number(x['ativo']))).toEqual([1, 0]);
    expect(
      Number(
        (await ler('SELECT COUNT(*) AS n FROM etapa_projeto WHERE projeto_id = ?', [m['projeto']]))[0]!['n'],
      ),
    ).toBe(3);
    // A etapa gravada não sai (cancela-se); versão velha recusa.
    const atual = await porta.projeto(ctx(), m['projeto']!);
    await expect(
      porta.salvarProjeto(ctx(), m['projeto']!, { ...base, verba: 1200, versao: atual.versao }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.salvarProjeto(ctx(), m['projeto']!, { ...base, verba: 1200, versao: det.versao }),
    ).rejects.toBeTruthy();
  });

  it('apropriação: despesa pelo percentual do título com a etapa, receita pelo título a receber, teto do documento', async () => {
    const det = await porta.projeto(ctx(), m['projeto']!);
    const etapa2 = det.etapas.find((e) => e.sequencia === 2)!.id;
    m['etapa2'] = etapa2;
    const d = await porta.apropriar(ctx(), m['projeto']!, {
      origem: 'titulo',
      documento: m['pagar']!,
      etapa: etapa2,
      percentual: 70,
      data: '2027-03-10',
    });
    expect(d).toMatchObject({ valor: 700, natureza: 'despesa' });
    const [a] = await ler(
      `SELECT tipo_origem, natureza, titulo_pagar_id, etapa_projeto_id, percentual_rateio, valor, criado_por
         FROM apropriacao_projeto WHERE id = ?`,
      [d.id],
    );
    expect(a).toMatchObject({ tipo_origem: 'titulo', natureza: 'despesa' });
    expect(Number(a!['titulo_pagar_id'])).toBe(m['pagar']);
    expect(Number(a!['etapa_projeto_id'])).toBe(etapa2);
    expect(Number(a!['percentual_rateio'])).toBe(70);
    expect(Number(a!['valor'])).toBe(700);
    const [et] = await ler('SELECT valor_realizado FROM etapa_projeto WHERE id = ?', [etapa2]);
    expect(Number(et!['valor_realizado'])).toBe(700);
    m['aprDespesa'] = d.id!;

    const r = await porta.apropriar(ctx(), m['projeto']!, {
      origem: 'titulo_receber',
      documento: m['receber']!,
      valor: 800,
      data: '2027-03-15',
    });
    expect(r).toMatchObject({ valor: 800, natureza: 'receita' });

    // Mesmo documento duas vezes no projeto, natureza contrária e passar do livre: recusas sem gravar.
    const antes = await contar();
    await expect(
      porta.apropriar(ctx(), m['projeto']!, {
        origem: 'titulo',
        documento: m['pagar']!,
        valor: 10,
        data: '2027-03-10',
      }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.apropriar(ctx(), m['projeto']!, {
        origem: 'titulo_receber',
        documento: m['receber']!,
        natureza: 'despesa',
        valor: 1,
        data: '2027-03-10',
      }),
    ).rejects.toMatchObject(recusa);
    // Outro projeto no mesmo título: só os 300 livres.
    const outro = await porta.salvarProjeto(ctx(), null, {
      codigo: 'pesq-1',
      descricao: 'Pesquisa sintética',
      tipo: 'pesquisa',
      verba: 5000,
    });
    m['outro'] = outro.id!;
    await expect(
      porta.apropriar(ctx(), outro.id!, {
        origem: 'titulo',
        documento: m['pagar']!,
        valor: 301,
        data: '2027-03-10',
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes + 1); // só o projeto novo
    const docs = await porta.documentos(ctx(), 'titulo', '902107');
    expect(docs).toEqual([expect.objectContaining({ id: m['pagar'], valor: 1000, livre: 300 })]);
  });

  it('resultado: orçado × realizado, receita − despesa, etapas e centros', async () => {
    const det = await porta.projeto(ctx(), m['projeto']!);
    expect(det.resultado).toMatchObject({
      orcado: 1200,
      despesa: 700,
      receita: 800,
      resultado: 100,
      saldoVerba: 500,
      estourado: false,
      semEtapa: 0,
    });
    expect(det.resultado.etapas.find((e) => e.sequencia === 2)).toMatchObject({
      previsto: 600,
      realizado: 700,
      estourada: true,
    });
    expect(det.resultado.centros).toEqual([{ centroCusto: m['cc1'], percentual: 100, despesa: 700 }]);
    const lista = await porta.projetos(ctx());
    expect(lista.projetos.find((p) => p.id === m['projeto'])).toMatchObject({ despesa: 700, receita: 800 });
  });

  it('estorno: marca como excluída, recalcula a etapa e libera o documento; reapropriar reativa', async () => {
    const det = await porta.projeto(ctx(), m['projeto']!);
    const a = det.apropriacoes.find((x) => x.id === m['aprDespesa'])!;
    await expect(porta.estornar(ctx(), a.id, { versao: a.versao, motivo: 'x' })).rejects.toBeTruthy();
    await porta.estornar(ctx(), a.id, { versao: a.versao, motivo: 'Lançado no projeto errado' });
    const [g] = await ler(
      'SELECT excluido_em, excluido_por, observacao FROM apropriacao_projeto WHERE id = ?',
      [a.id],
    );
    expect(g!['excluido_em']).not.toBeNull();
    expect(Number(g!['excluido_por'])).toBe(m['usuario']);
    expect(String(g!['observacao'])).toContain('Estorno: Lançado no projeto errado');
    const [et] = await ler('SELECT valor_realizado FROM etapa_projeto WHERE id = ?', [m['etapa2']]);
    expect(Number(et!['valor_realizado'])).toBe(0);
    await expect(
      porta.estornar(ctx(), a.id, { versao: a.versao + 1, motivo: 'De novo' }),
    ).rejects.toMatchObject(recusa);
    // O documento volta a ter 1000 livres; reapropriar no mesmo projeto grava linha nova e o estorno continua legível.
    const r = await porta.apropriar(ctx(), m['projeto']!, {
      origem: 'titulo',
      documento: m['pagar']!,
      valor: 250,
      data: '2027-04-01',
    });
    expect(r.id).not.toBe(a.id);
    const [v] = await ler(
      'SELECT valor, excluido_em, etapa_projeto_id FROM apropriacao_projeto WHERE id = ?',
      [r.id],
    );
    expect(Number(v!['valor'])).toBe(250);
    expect(v!['excluido_em']).toBeNull();
    expect(v!['etapa_projeto_id']).toBeNull();
    const [h] = await ler(
      'SELECT valor, excluido_em, excluido_por, observacao, etapa_projeto_id FROM apropriacao_projeto WHERE id = ?',
      [a.id],
    );
    expect(Number(h!['valor'])).toBe(700);
    expect(h!['excluido_em']).not.toBeNull();
    expect(Number(h!['excluido_por'])).toBe(m['usuario']);
    expect(String(h!['observacao'])).toContain('Estorno: Lançado no projeto errado');
    expect(Number(h!['etapa_projeto_id'])).toBe(m['etapa2']);
    const comHistorico = await porta.projeto(ctx(), m['projeto']!);
    expect(comHistorico.apropriacoes.filter((x) => x.documento === m['pagar'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a.id, estornada: true }),
        expect.objectContaining({ id: r.id, estornada: false }),
      ]),
    );
    // Duas apropriações simultâneas do mesmo título em projetos diferentes: a trava do documento serializa, e só uma
    // cabe nos 750 livres (a soma nunca passa do valor do documento).
    const novo = (codigo: string) =>
      porta.salvarProjeto(ctx(), null, {
        codigo,
        descricao: `Concorrência sintética ${codigo}`,
        tipo: 'pesquisa',
        verba: 5000,
      });
    const p1 = await novo('conc-1');
    const p2 = await novo('conc-2');
    const disputa = await Promise.allSettled(
      [p1!.id!, p2!.id!].map((pid) =>
        porta.apropriar(ctx(), pid, {
          origem: 'titulo',
          documento: m['pagar']!,
          valor: 500,
          data: '2027-04-02',
        }),
      ),
    );
    expect(disputa.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejeitada = disputa.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejeitada.reason).toMatchObject(recusa);
    const [soma] = await ler(
      'SELECT SUM(valor) AS v FROM apropriacao_projeto WHERE titulo_pagar_id = ? AND excluido_em IS NULL',
      [m['pagar']],
    );
    expect(Number(soma!['v'])).toBe(750);
    // Projeto concluído não recebe apropriação.
    const atual = await porta.projeto(ctx(), m['projeto']!);
    const base = projetoBase();
    await porta.salvarProjeto(ctx(), m['projeto']!, {
      ...base,
      verba: 1200,
      versao: atual.versao,
      situacao: 'concluido',
      etapas: [...base.etapas, { sequencia: 3, descricao: 'Entrega', valorPrevisto: 200 }],
      centros: [{ centroCusto: m['cc1']!, percentual: 100 }],
      produtos: [base.produtos[0]!],
    });
    const [pf] = await ler('SELECT situacao, data_fim_efetiva FROM projeto WHERE id = ?', [m['projeto']]);
    expect(pf!['situacao']).toBe('concluido');
    expect(pf!['data_fim_efetiva']).not.toBeNull();
    await expect(
      porta.apropriar(ctx(), m['projeto']!, {
        origem: 'titulo',
        documento: m['pagar']!,
        valor: 1,
        data: '2027-04-01',
      }),
    ).rejects.toMatchObject(recusa);
  });
});
