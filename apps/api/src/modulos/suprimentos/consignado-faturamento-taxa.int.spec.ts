// Integração do faturamento do consumo consignado com a taxa de comercialização por faixa (C1-014, 05-SUP linha 24)
// contra o MariaDB real (cliente f22_o3). Contrato de efeito: o faturamento do consumo em sala pela nota de compra
// confirmada grava em reposicao_consignada o valor do material (custo unitário da nota × quantidade) e as parcelas da
// taxa da faixa vigente do fornecedor (faixa, origem, percentual, taxa bruta, teto e taxa), na mesma transação; a nota
// sem o item é recusada sem linha nova; a tabela já usada em cobrança não se substitui (tabela-ja-cobrada), e a tabela
// geral ainda não usada se substitui no mesmo dia (a antiga fica inativa, versão 2, nada apagado).
// Massa SINTÉTICA (estabelecimento, fornecedor, paciente, médico, cirurgia, nota e insumo fictícios); os movimentos
// são limpos. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import type { LinhaMovimentoConsignado } from './consignado-porta.js';
import { PortaConsignadoPropria } from './consignado-porta-propria.js';
import { PortaTaxaConsignacaoPropria } from './consignado-taxa.js';
import { inserirMinimo } from './massa-propria.spec-util.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGO = 'c1014fat';
const MARCA = 'C1014F';

async function garantir(
  e: Escritor,
  sel: string,
  p: unknown[],
  criar: () => Promise<number>,
): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : criar();
}

const faturar = (x: Partial<LinhaMovimentoConsignado>): LinhaMovimentoConsignado => ({
  tipo: 'faturamento',
  quantidade: 2,
  consumo: null,
  nfNumero: null,
  nfSerie: null,
  nfEmissao: null,
  nfEntrada: null,
  lote: 'LT-C1014F',
  serie: null,
  validade: null,
  motivo: null,
  ...x,
});

describe.skipIf(SEM_DB)('faturamento do consignado com a taxa por faixa (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaConsignadoPropria;
  let taxa: PortaTaxaConsignacaoPropria;
  let est = 0;
  let usuario = 0;
  let fornecedor = 0;
  let item = 0;
  let outroItem = 0;
  let consumo = 0;
  let consumo2 = 0;
  let nota = 0;
  let hoje = '';
  let ctx: ContextoPortaM18;
  const sufixo = Date.now().toString(36);
  const correlacao = `c1014f-${sufixo}`;
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1014f-conta' }, (l) => l.consultar<T>(sql, p));
  const trilha = (r: { grupo: number }): TrilhaDaGravacao => ({
    estabelecimento: est,
    usuario,
    acao: 'operacao',
    entidade: 'reposicao_consignada',
    entidadeId: r.grupo,
    dadosDepois: { evento: 'teste' },
    correlacao,
  });

  async function limpar(): Promise<void> {
    if (!est) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014f-limpa' }, async (e) => {
      for (const sql of [
        'DELETE FROM reposicao_consignada WHERE estabelecimento_id = ?',
        'DELETE FROM consumo_opme WHERE estabelecimento_id = ?',
        'DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = ?',
        'DELETE FROM atendimento WHERE estabelecimento_id = ?',
        'DELETE i FROM nota_entrada_item i JOIN nota_entrada n ON n.id = i.nota_entrada_id WHERE n.estabelecimento_id = ?',
        'DELETE FROM nota_entrada WHERE estabelecimento_id = ?',
        'DELETE FROM faixa_taxa_consignacao WHERE estabelecimento_id = ?',
        "DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ? AND (operacao LIKE 'consignado.%' OR operacao LIKE 'suprimentos.consignado.%')",
      ])
        await e.executar(sql, [est]);
      await limparTrilhaDaMassa(e, { codigos: [CODIGO] });
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014f-cadastro' }, async (e) => {
      const agora = new Date();
      est = await garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [CODIGO], () =>
        e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [CODIGO, 'Hospital fictício C1014F', 'Hospital fictício C1014F (teste)', agora],
        ),
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014f-massa' }, async (e) => {
      const agora = new Date();
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, MARCA);
      usuario = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', ['c1014f.teste'], () =>
        e.inserir("INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)", [
          'c1014f.teste',
          'Usuário fictício do faturamento do consignado',
          agora,
        ]),
      );
      fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
        ['00101402000150'],
        () =>
          e.inserir(
            "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
            ['00101402000150', 'DISTRIBUIDORA FICTÍCIA C1014F LTDA', agora],
          ),
      );
      const grupo = await garantir(e, 'SELECT id FROM grupo_insumo WHERE codigo = ?', ['C1014F-OPME'], () =>
        e.inserir(
          "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'opme', ?)",
          ['C1014F-OPME', 'OPME fictício C1014F', agora],
        ),
      );
      const unidade = await garantir(e, 'SELECT id FROM unidade_medida WHERE codigo = ?', ['C1014F-UN'], () =>
        e.inserir('INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)', [
          'C1014F-UN',
          'Unidade fictícia C1014F',
          'UNC',
          agora,
        ]),
      );
      const insumo = (codigo: string) =>
        garantir(e, 'SELECT id FROM insumo WHERE codigo = ?', [codigo], () =>
          e.inserir(
            `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, opme, consignado, criado_em)
             VALUES (?, ?, 'opme', ?, ?, TRUE, TRUE, ?)`,
            [codigo, `ITEM FICTÍCIO ${codigo}`, grupo, unidade, agora],
          ),
        );
      item = await insumo('C1014F-PLACA');
      outroItem = await insumo('C1014F-PARAFUSO');
      const local = await garantir(
        e,
        "SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = 'C1014F-CONSIG'",
        [est],
        () =>
          e.inserir(
            "INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'C1014F-CONSIG', ?, 'consignado', ?)",
            [est, 'Consignado fictício C1014F', agora],
          ),
      );
      const pessoa = (nome: string) =>
        garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], () =>
          x('pessoa_fisica', { nome }),
        );
      const pacPessoa = await pessoa('PACIENTE SINTETICO C1014F');
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pacPessoa],
        () =>
          x('paciente', {
            pessoa_fisica_id: pacPessoa,
            numero_prontuario: 926_000_000 + (Date.now() % 900_000),
          }),
      );
      const medPessoa = await pessoa('MEDICO SINTETICO C1014F');
      const medico = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [medPessoa],
        () => x('profissional', { pessoa_fisica_id: medPessoa, tipo: 'corpo_clinico' }),
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${MARCA}CA`],
        () => x('categoria_atendimento', { codigo: `${MARCA}CA`, tipo_base: 'internacao' }),
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F4'],
        () => x('carater_atendimento_tiss', { codigo_tiss: 'F4' }),
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_cirurgia WHERE codigo = ?',
        [`${MARCA}CC`],
        () => x('carater_cirurgia', { codigo: `${MARCA}CC` }),
      );
      const fonte = await garantir(e, 'SELECT id FROM fonte_pagadora WHERE codigo = ?', [`${MARCA}OP`], () =>
        x('fonte_pagadora', { codigo: `${MARCA}OP`, tipo: 'operadora', situacao: 'ativa' }),
      );
      const atendimento = await x('atendimento', {
        fonte_pagadora_id: fonte,
        estabelecimento_id: est,
        paciente_id: paciente,
        categoria_atendimento_id: cat,
        carater_atendimento_tiss_id: tiss,
        profissional_id: medico,
      });
      const agenda = await x('agendamento_cirurgico', {
        estabelecimento_id: est,
        paciente_id: paciente,
        atendimento_id: atendimento,
        cirurgiao_profissional_id: medico,
        carater_cirurgia_id: carater,
        tipo_cobertura: 'particular',
      });
      const consumir = () =>
        x('consumo_opme', {
          estabelecimento_id: est,
          atendimento_id: atendimento,
          agendamento_cirurgico_id: agenda,
          insumo_id: item,
          empresa_fornecedora_id: fornecedor,
          quantidade: 2,
          consignado: true,
          situacao: 'consumido',
          numero_lote: 'LT-C1014F',
          registrado_por_usuario_id: usuario,
          registrado_em: agora,
        });
      consumo = await consumir();
      consumo2 = await consumir();
      const tipoEntrada = await e.uma<{ id: number }>(
        'SELECT id FROM tipo_entrada_estoque ORDER BY id LIMIT 1',
        [],
      );
      nota = await x('nota_entrada', {
        estabelecimento_id: est,
        numero: 1,
        empresa_fornecedora_id: fornecedor,
        local_estoque_id: local,
        tipo_entrada_estoque_id: Number(tipoEntrada?.id),
        numero_documento: '771014',
        data_emissao: '2026-11-02',
        data_entrada: '2026-11-03',
        situacao: 'confirmada',
      });
      await x('nota_entrada_item', {
        nota_entrada_id: nota,
        sequencia: 1,
        insumo_id: item,
        unidade_medida_id: unidade,
        quantidade: 2,
        quantidade_estoque: 2,
        valor_unitario: 1500,
        custo_unitario: 1500,
        valor_total: 3000,
      });
      await garantirSequencia(
        e,
        { tipo: 'reposicao_consignada', estabelecimento: est },
        { usuario: null, agora },
      );
      const [h] = await e.consultar<{ d: string }>("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS d", []);
      hoje = String(h?.d);
    });
    porta = new PortaConsignadoPropria(nucleo);
    taxa = new PortaTaxaConsignacaoPropria(nucleo);
    ctx = { cliente: CLIENTE, estabelecimento: est, usuario, correlacao };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const NF = { ano: 2026, mes: 11, doc: 0 };
  const GERAL = [{ valorInicial: 0, valorFinal: null, percentual: 50, teto: null }];
  const DO_FORNECEDOR = [
    { valorInicial: 0, valorFinal: 1000, percentual: 30, teto: null },
    { valorInicial: 1000, valorFinal: null, percentual: 10, teto: 250 },
  ];

  it('o faturamento grava o valor do material e as parcelas da taxa da faixa vigente do fornecedor', async () => {
    await taxa.gravar(ctx, { fornecedor: null, inicio: hoje, faixas: GERAL }, `c1014f-geral-${sufixo}`);
    const forn = await taxa.gravar(
      ctx,
      { fornecedor, inicio: hoje, faixas: DO_FORNECEDOR },
      `c1014f-forn-${sufixo}`,
    );
    const pedido = { tipo: 'faturamento', consumos: [consumo], nfEntrada: { ...NF, doc: nota } };
    const r = await porta.gravarSgh(ctx, trilha, (g) =>
      g.gravar({
        fornecedor,
        item,
        usuario: 'teste',
        chave: `c1014f-fat-${sufixo}`,
        pedido,
        linhas: [faturar({ consumo, nfEntrada: { ...NF, doc: nota } })],
      }),
    );
    expect(r.repetido).toBe(false);
    const [l] = await ler(
      `SELECT tipo, situacao, nota_entrada_id, valor_material, taxa_faixa_id, taxa_origem, taxa_percentual, taxa_bruta,
              taxa_teto, taxa_valor, versao, criado_por
         FROM reposicao_consignada WHERE id = ?`,
      [r.grupo],
    );
    // 1.500 × 2 = 3.000 cai na faixa "1.000 em diante" do fornecedor (10%, teto 250): bruta 300, cobrada 250.
    expect(l).toMatchObject({ tipo: 'faturamento', situacao: 'faturada', taxa_origem: 'fornecedor' });
    expect(Number(l!['nota_entrada_id'])).toBe(nota);
    expect(Number(l!['valor_material'])).toBe(3000);
    expect(Number(l!['taxa_faixa_id'])).toBe(forn.ids[1]);
    expect(Number(l!['taxa_percentual'])).toBe(10);
    expect(Number(l!['taxa_bruta'])).toBe(300);
    expect(Number(l!['taxa_teto'])).toBe(250);
    expect(Number(l!['taxa_valor'])).toBe(250);
    expect(Number(l!['versao'])).toBe(1);
    expect(Number(l!['criado_por'])).toBe(usuario);
  });

  it('a nota sem o item é recusada e nada é gravado', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014f-nota' }, (e) =>
      e.executar('UPDATE nota_entrada_item SET insumo_id = ? WHERE nota_entrada_id = ?', [outroItem, nota]),
    );
    try {
      const pedido = { tipo: 'faturamento', consumos: [consumo2], nfEntrada: { ...NF, doc: nota } };
      await expect(
        porta.gravarSgh(ctx, trilha, (g) =>
          g.gravar({
            fornecedor,
            item,
            usuario: 'teste',
            chave: `c1014f-fat2-${sufixo}`,
            pedido,
            linhas: [faturar({ consumo: consumo2, nfEntrada: { ...NF, doc: nota } })],
          }),
        ),
      ).rejects.toThrow(/item-fora-da-nota/);
      const [c] = await ler('SELECT COUNT(*) AS n FROM reposicao_consignada WHERE consumo_opme_id = ?', [
        consumo2,
      ]);
      expect(Number(c?.['n'])).toBe(0);
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014f-nota' }, (e) =>
        e.executar('UPDATE nota_entrada_item SET insumo_id = ? WHERE nota_entrada_id = ?', [item, nota]),
      );
    }
  });

  it('a tabela usada em cobrança não se substitui; a geral ainda não usada se substitui no mesmo dia, sem apagar', async () => {
    await expect(
      taxa.gravar(
        ctx,
        {
          fornecedor,
          inicio: hoje,
          faixas: [{ valorInicial: 0, valorFinal: null, percentual: 5, teto: null }],
        },
        `c1014f-forn2-${sufixo}`,
      ),
    ).rejects.toThrow(/tabela-ja-cobrada/);
    const nova = await taxa.gravar(
      ctx,
      {
        fornecedor: null,
        inicio: hoje,
        faixas: [{ valorInicial: 0, valorFinal: null, percentual: 7, teto: null }],
      },
      `c1014f-geral2-${sufixo}`,
    );
    const geral = await ler(
      `SELECT id, percentual, ativo, versao, alterado_por, vigencia_fim
         FROM faixa_taxa_consignacao WHERE estabelecimento_id = ? AND empresa_fornecedora_id IS NULL ORDER BY id`,
      [est],
    );
    expect(geral).toHaveLength(2);
    expect(Number(geral[0]!['ativo'])).toBe(0);
    expect(Number(geral[0]!['versao'])).toBe(2);
    expect(Number(geral[0]!['alterado_por'])).toBe(usuario);
    expect(Number(geral[1]!['id'])).toBe(nova.ids[0]);
    expect(Number(geral[1]!['ativo'])).toBe(1);
    expect(await taxa.calcular(ctx, null, 100, null)).toMatchObject({ percentual: 7, taxa: 7 });
    const t = await taxa.tabelas(ctx, null);
    expect(t.historico.filter((f) => f.fornecedor === null).map((f) => f.percentual)).toEqual([7]);
  });
});
