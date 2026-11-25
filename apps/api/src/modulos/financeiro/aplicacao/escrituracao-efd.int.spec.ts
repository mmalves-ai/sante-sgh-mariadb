// F3.8, 07-FIN linha 108: contrato de efeito da escrituração fiscal das entradas e da EFD-Contribuições contra o
// MariaDB real (massa SINTÉTICA "L0207"; nenhuma pessoa nem documento real). A classificação pela tela grava no item
// o CFOP, o CST, a base, a alíquota e o crédito calculado (base x alíquota), e no cabeçalho a soma dos itens, o CFOP e
// a natureza predominantes e a situação, com a trilha da operação; a recusa não grava nada; o arquivo só sai da
// competência sem pendência, com o hash do texto, o resumo da conferência e as entradas ligadas a ele; gerar de novo
// sem mudança devolve o mesmo; a entrega grava o recibo; a correção depois da entrega deixa a entrada "retificada" e
// a retificadora sai ligada ao entregue, com o recibo dele; o gerado trocado fica cancelado. Nada é apagado. O outro
// estabelecimento não vê nada.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hashDoArquivoEfd,
  OPERACOES_ESCRITURACAO,
  painelEscrituracao,
  textoDoArquivoEfd,
} from '../escrituracao-efd-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-efd-${randomUUID()}` });
const PERIODO = '2026-10';
const FONTE = 'L0207-108';
const CNPJ = '92070000000199';

describe.skipIf(SEM_BANCO)(
  'escrituração fiscal das entradas e EFD-Contribuições: classificar, conferir, gerar, entregar e retificar (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let docA = 0;
    let docB = 0;
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) => l.consultar(sql, p));
    const executar = (nome: keyof typeof OPERACOES_ESCRITURACAO, entrada: unknown, est?: number) =>
      m.nucleo
        .criarExecutor()
        .executar(OPERACOES_ESCRITURACAO[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, est)))
        .then((r) => r.resultado as Record<string, unknown>);
    const painel = (est: number) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) =>
        painelEscrituracao(l, est, PERIODO),
      );
    const entrada = async (id: number) => (await painel(m.est)).entradas.find((x) => x.id === id)!;
    const limparProprio = () =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-efd-108' }, async (e) => {
        const ests = [m.est, m.outroEst];
        const q = '?, ?';
        await e.executar(
          `DELETE i FROM escrituracao_item_entrada i JOIN escrituracao_entrada x ON x.id = i.escrituracao_entrada_id WHERE x.estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(`DELETE FROM escrituracao_entrada WHERE estabelecimento_id IN (${q})`, ests);
        // A retificadora aponta o entregue: sai primeiro (a ordem respeita a chave para o próprio arquivo).
        await e.executar(
          `DELETE FROM arquivo_efd_contribuicoes WHERE estabelecimento_id IN (${q}) ORDER BY sequencia_envio DESC`,
          ests,
        );
        await e.executar(
          `DELETE FROM entrada_servico WHERE estabelecimento_id IN (${q}) AND numero LIKE 'L0207-108-%'`,
          ests,
        );
        await e.executar('UPDATE estabelecimento SET cnpj = NULL WHERE id = ? AND cnpj = ?', [m.est, CNPJ]);
        await e.executar('DELETE FROM cfop WHERE versao_fonte = ?', [FONTE]);
      });

    beforeAll(async () => {
      m = await montarMassa();
      await limparProprio();
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-efd-108' }, async (e) => {
        const agora = new Date();
        const cfop = async (codigo: string, sentido: string) =>
          Number(
            (await e.uma<{ id: number }>('SELECT id FROM cfop WHERE codigo_cfop = ?', [codigo]))?.id ?? 0,
          ) ||
          e.inserir(
            `INSERT INTO cfop (codigo_cfop, descricao, sentido, abrangencia, versao_fonte, criado_em)
             VALUES (?, 'CFOP SINTETICO L0207', ?, 'estadual', ?, ?)`,
            [codigo, sentido, FONTE, agora],
          );
        const entradaCfop = await cfop('1933', 'entrada');
        const saidaCfop = await cfop('5933', 'saida');
        /** Serviço tomado com a escrituração: itens = [valor, cfop]. */
        const documento = async (est: number, n: string, itens: [number, number][]) => {
          const total = itens.reduce((s, [v]) => s + v, 0);
          const es = await e.inserir(
            `INSERT INTO entrada_servico (estabelecimento_id, numero, empresa_fornecedora_id, numero_documento,
               data_emissao, data_entrada, competencia, valor_total, criado_em)
             VALUES (?, ?, ?, ?, '2026-10-05', '2026-10-06', '2026-10-01', ?, ?)`,
            [est, `L0207-108-${n}`, m.fornecedor, `${n}${est}`, total, agora],
          );
          const esc = await e.inserir(
            `INSERT INTO escrituracao_entrada (estabelecimento_id, entrada_servico_id, empresa_fornecedora_id,
               modelo_documento, numero_documento, data_emissao, data_entrada, competencia, valor_documento, criado_em)
             VALUES (?, ?, ?, '99', ?, '2026-10-05', '2026-10-06', '2026-10-01', ?, ?)`,
            [est, es, m.fornecedor, `${n}${est}`, total, agora],
          );
          let seq = 0;
          for (const [valor, cf] of itens)
            await e.inserir(
              `INSERT INTO escrituracao_item_entrada (escrituracao_entrada_id, sequencia, cfop_id, codigo_item,
                 descricao, quantidade, valor_item, criado_em) VALUES (?, ?, ?, ?, 'SERVICO SINTETICO', 1, ?, ?)`,
              [esc, ++seq, cf, `SINT-${seq}`, valor, agora],
            );
          return esc;
        };
        // A: o item veio com o CFOP de saída do prestador (pendência). B: dois itens com CFOP de entrada, sem CST.
        docA = await documento(m.est, '901', [[1000, saidaCfop]]);
        docB = await documento(m.est, '902', [
          [300, entradaCfop],
          [200, entradaCfop],
        ]);
        await documento(m.outroEst, '903', [[50, entradaCfop]]);
      });
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await limparProprio();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }, 120_000);

    const credito = (sequencia: number, base: number) => ({
      sequencia,
      cfop: '1933',
      cstPis: '50',
      basePis: base,
      aliquotaPis: 1.65,
      cstCofins: '50',
      baseCofins: base,
      aliquotaCofins: 7.6,
      naturezaCredito: '03',
    });
    const semCredito = (sequencia: number) => ({
      sequencia,
      cfop: '1933',
      cstPis: '70',
      basePis: 0,
      aliquotaPis: null,
      cstCofins: '70',
      baseCofins: 0,
      aliquotaCofins: null,
      naturezaCredito: null,
    });

    it('a competência abre com as pendências; a classificação grava o item, o cabeçalho e a trilha; a recusa não grava', async () => {
      const antes = await painel(m.est);
      expect(antes.entradas.map((x) => x.id)).toEqual([docA, docB]);
      // A: CFOP de saída e os dois CST; B: os dois CST em cada um dos dois itens.
      expect(antes.conferencia.pendencias.length).toBe(3 + 4);
      expect(antes.conferencia.liberado).toBe(false);
      expect((await painel(m.outroEst)).entradas.length).toBe(1);
      const a = await entrada(docA);
      // Recusas: base acima do item, CFOP de saída, CST sem crédito com base, entrada de outro estabelecimento.
      const tentar = (item: object, est?: number) =>
        codigoDaGravacao(
          executar(
            'financeiro.escrituracaoClassificarEntrada',
            { entrada: docA, versao: a.versao, itens: [item] },
            est,
          ),
        );
      expect(await tentar(credito(1, 1000.01))).toBe('base-maior-que-item');
      expect(await tentar({ ...credito(1, 1000), cfop: '5933' })).toBe('cfop-nao-e-de-entrada');
      expect(await tentar({ ...semCredito(1), basePis: 10 })).toBe('credito-indevido');
      expect(await tentar({ ...credito(1, 1000), naturezaCredito: null })).toBe(
        'natureza-credito-obrigatoria',
      );
      expect(await tentar(credito(1, 1000), m.outroEst)).toBe('entrada-nao-encontrada');
      expect((await entrada(docA)).versao).toBe(a.versao);

      const r = await executar('financeiro.escrituracaoClassificarEntrada', {
        entrada: docA,
        versao: a.versao,
        itens: [credito(1, 1000)],
      });
      // 1000 x 1,65% = 16,50; 1000 x 7,6% = 76,00.
      expect(r).toMatchObject({ pendencias: 0, valorPis: 16.5, valorCofins: 76, situacao: 'escriturada' });
      const [item] = await consultar(
        `SELECT cf.codigo_cfop, i.cst_pis, i.base_pis, i.aliquota_pis, i.valor_pis, i.cst_cofins, i.base_cofins,
                i.valor_cofins, i.natureza_credito_pis_cofins, i.versao, i.alterado_por
           FROM escrituracao_item_entrada i JOIN cfop cf ON cf.id = i.cfop_id WHERE i.escrituracao_entrada_id = ?`,
        [docA],
      );
      expect(item).toMatchObject({
        codigo_cfop: '1933',
        cst_pis: '50',
        cst_cofins: '50',
        natureza_credito_pis_cofins: '03',
      });
      expect([Number(item!['base_pis']), Number(item!['valor_pis']), Number(item!['valor_cofins'])]).toEqual([
        1000, 16.5, 76,
      ]);
      expect(Number(item!['versao'])).toBe(2);
      expect(Number(item!['alterado_por'])).toBe(m.lanca);
      const [cab] = await consultar(
        `SELECT e.valor_pis, e.valor_cofins, e.situacao, e.natureza_credito_pis_cofins, cf.codigo_cfop
           FROM escrituracao_entrada e LEFT JOIN cfop cf ON cf.id = e.cfop_id WHERE e.id = ?`,
        [docA],
      );
      expect(cab).toMatchObject({
        situacao: 'escriturada',
        natureza_credito_pis_cofins: '03',
        codigo_cfop: '1933',
      });
      expect([Number(cab!['valor_pis']), Number(cab!['valor_cofins'])]).toEqual([16.5, 76]);
      const trilha = await consultar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'escrituracao_entrada' AND entidade_id = ?",
        [docA],
      );
      expect(Number(trilha[0]!['n'])).toBe(1);
      // A versão antiga da tela não passa por cima da gravação de outro usuário.
      expect(
        await codigoDaGravacao(
          executar('financeiro.escrituracaoClassificarEntrada', {
            entrada: docA,
            versao: a.versao,
            itens: [semCredito(1)],
          }),
        ),
      ).toBe('conflito-versao');
    }, 120_000);

    it('o arquivo não sai com pendência; conferido, grava hash, resumo e liga as entradas; repetir devolve o mesmo', async () => {
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-efd-108' }, (e) =>
        e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ? AND cnpj IS NULL', [CNPJ, m.est]),
      );
      const cnpj = String(
        (await consultar('SELECT cnpj FROM estabelecimento WHERE id = ?', [m.est]))[0]!['cnpj'],
      );
      const gerar = () =>
        executar('financeiro.efdContribuicoesGerar', { periodo: PERIODO, regime: 'nao_cumulativo' });
      expect(await codigoDaGravacao(gerar())).toBe('escrituracao-pendente');
      expect(
        (
          await consultar(
            'SELECT COUNT(*) AS n FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ?',
            [m.est],
          )
        )[0]!['n'],
      ).toBe(0);

      const b = await entrada(docB);
      await executar('financeiro.escrituracaoClassificarEntrada', {
        entrada: docB,
        versao: b.versao,
        itens: [credito(1, 300), semCredito(2)],
      });
      const p = await painel(m.est);
      // Bases 1000 + 300 = 1300; PIS 16,50 + 4,95 = 21,45; COFINS 76,00 + 22,80 = 98,80.
      expect(p.conferencia).toMatchObject({
        liberado: true,
        documentos: 2,
        itens: 3,
        totalBasePis: 1300,
        totalCreditoPis: 21.45,
        totalBaseCofins: 1300,
        totalCreditoCofins: 98.8,
      });
      expect(
        await codigoDaGravacao(
          executar('financeiro.efdContribuicoesGerar', { periodo: PERIODO, regime: 'cumulativo' }),
        ),
      ).toBe('credito-no-regime-cumulativo');

      const g = await gerar();
      expect(g).toMatchObject({
        sequencia: 1,
        finalidade: 'original',
        igual: false,
        documentos: 2,
        itens: 3,
        creditoPis: 21.45,
        creditoCofins: 98.8,
      });
      const id = Number(g['arquivo']);
      const [arq] = await consultar(
        `SELECT situacao, finalidade, regime, hash_sha256, recibo_anterior, mensagem_validacao, gerador_usuario_id
           FROM arquivo_efd_contribuicoes WHERE id = ?`,
        [id],
      );
      expect(arq).toMatchObject({
        situacao: 'gerado',
        finalidade: 'original',
        regime: 'nao_cumulativo',
        recibo_anterior: null,
      });
      expect(Number(arq!['gerador_usuario_id'])).toBe(m.lanca);
      expect(String(arq!['mensagem_validacao'])).toContain('documentos=2; itens=3;');
      expect(String(arq!['mensagem_validacao'])).toContain(
        'credito_pis=21.45; base_cofins=1300.00; credito_cofins=98.80',
      );
      const ligadas = await consultar(
        'SELECT COUNT(*) AS n FROM escrituracao_entrada WHERE estabelecimento_id = ? AND arquivo_efd_contribuicoes_id = ?',
        [m.est, id],
      );
      expect(Number(ligadas[0]!['n'])).toBe(2);
      // O texto baixado é o do hash gravado, com a apuração e a contagem de linhas.
      const t = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) =>
        textoDoArquivoEfd(l, m.est, id),
      );
      if (t === null || t === 'desatualizado') throw new Error('texto do arquivo indisponível');
      expect(hashDoArquivoEfd(t.conteudo)).toBe(arq!['hash_sha256']);
      const linhas = t.conteudo.trimEnd().split('\r\n');
      expect(linhas[0]).toContain(`|01102026|31102026|ESTAB L0207 SINTETICO|${cnpj}|`);
      expect(linhas.filter((x) => x.startsWith('|A100|')).length).toBe(2);
      expect(linhas.filter((x) => x.startsWith('|A170|')).length).toBe(3);
      expect(linhas.find((x) => x.startsWith('|M100|'))).toContain('|101|0|1300,00|1,6500|||21,45|');
      expect(linhas.find((x) => x.startsWith('|M500|'))).toContain('|101|0|1300,00|7,6000|||98,80|');
      expect(linhas.at(-1)).toBe(`|9999|${linhas.length}|`);
      expect(
        await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) =>
          textoDoArquivoEfd(l, m.outroEst, id),
        ),
      ).toBeNull();

      const de_novo = await gerar();
      expect(de_novo).toMatchObject({ arquivo: id, igual: true });
      expect(
        (
          await consultar(
            'SELECT COUNT(*) AS n FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ?',
            [m.est],
          )
        )[0]!['n'],
      ).toBe(1);
    }, 120_000);

    it('a entrega grava o recibo; a correção depois dela pede a retificadora, ligada ao entregue; o trocado fica cancelado', async () => {
      const p = await painel(m.est);
      const original = p.arquivos[0]!;
      expect(original.confere).toBe(true);
      expect(
        await codigoDaGravacao(
          executar('financeiro.efdContribuicoesRegistrarEntrega', { arquivo: original.id, recibo: 'x' }),
        ),
      ).toBe('recibo-invalido');
      await executar('financeiro.efdContribuicoesRegistrarEntrega', {
        arquivo: original.id,
        recibo: 'REC-SINT-0001',
      });
      const [ent] = await consultar(
        'SELECT situacao, recibo, transmitido_em FROM arquivo_efd_contribuicoes WHERE id = ?',
        [original.id],
      );
      expect(ent).toMatchObject({ situacao: 'transmitido', recibo: 'REC-SINT-0001' });
      expect(ent!['transmitido_em']).not.toBeNull();
      expect(
        await codigoDaGravacao(
          executar('financeiro.efdContribuicoesRegistrarEntrega', {
            arquivo: original.id,
            recibo: 'REC-SINT-0002',
          }),
        ),
      ).toBe('arquivo-nao-entregavel');
      const gerar = () =>
        executar('financeiro.efdContribuicoesGerar', { periodo: PERIODO, regime: 'nao_cumulativo' });
      expect(await codigoDaGravacao(gerar())).toBe('nada-a-retificar');

      // Correção depois da entrega: o segundo item de B passa a dar crédito sobre 200.
      const b = await entrada(docB);
      const c = await executar('financeiro.escrituracaoClassificarEntrada', {
        entrada: docB,
        versao: b.versao,
        itens: [credito(2, 200)],
      });
      // PIS 4,95 + 3,30 = 8,25; COFINS 22,80 + 15,20 = 38,00.
      expect(c).toMatchObject({ situacao: 'retificada', valorPis: 8.25, valorCofins: 38 });
      expect((await painel(m.est)).arquivos[0]!.confere).toBe(false);
      expect(
        await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) =>
          textoDoArquivoEfd(l, m.est, original.id),
        ),
      ).toBe('desatualizado');

      const r1 = await gerar();
      expect(r1).toMatchObject({
        sequencia: 2,
        finalidade: 'retificadora',
        igual: false,
        creditoPis: 24.75,
        creditoCofins: 114,
      });
      // Outra correção antes de entregar a retificadora: a gerada é trocada e fica cancelada.
      const b2 = await entrada(docB);
      expect(b2.situacao).toBe('escriturada');
      await executar('financeiro.escrituracaoClassificarEntrada', {
        entrada: docB,
        versao: b2.versao,
        itens: [credito(2, 100)],
      });
      const r2 = await gerar();
      expect(r2).toMatchObject({ sequencia: 3, finalidade: 'retificadora' });
      const arquivos = await consultar(
        `SELECT sequencia_envio, situacao, finalidade, arquivo_retificado_id, recibo_anterior FROM arquivo_efd_contribuicoes
          WHERE estabelecimento_id = ? ORDER BY sequencia_envio`,
        [m.est],
      );
      expect(
        arquivos.map((x) => [
          Number(x['sequencia_envio']),
          x['situacao'],
          x['finalidade'],
          x['recibo_anterior'],
        ]),
      ).toEqual([
        [1, 'transmitido', 'original', null],
        [2, 'cancelado', 'retificadora', 'REC-SINT-0001'],
        [3, 'gerado', 'retificadora', 'REC-SINT-0001'],
      ]);
      expect(Number(arquivos[2]!['arquivo_retificado_id'])).toBe(original.id);
      const t = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-108' }, (l) =>
        textoDoArquivoEfd(l, m.est, Number(r2['arquivo'])),
      );
      if (t === null || t === 'desatualizado') throw new Error('texto da retificadora indisponível');
      expect(t.conteudo.split('\r\n')[0]).toContain('|0000|006|1||REC-SINT-0001|');
      // O outro estabelecimento não ganhou arquivo nem teve a entrada tocada.
      const outro = await painel(m.outroEst);
      expect(outro.arquivos.length).toBe(0);
      expect(outro.entradas[0]!.versao).toBe(1);
    }, 120_000);
  },
);
