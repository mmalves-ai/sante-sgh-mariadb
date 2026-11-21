// Integração da porta própria do financeiro contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA "L0207".
// Contrato de efeito de cada gravação: linhas, versão, trilha e outbox; e as recusas (entrada inválida, duplicado,
// segregação, sem aprovação, conflito de versão, outro estabelecimento, modelo pendente). A bateria comum de recusas
// roda sobre as duas fábricas (memória e banco) num describe.each. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, ContextoOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './aplicacao/massa-banco.spec-util.js';
import type { PortaFinanceiro } from './porta.js';
import { PortaFinanceiroMemoria } from './porta-memoria.js';
import { PortaFinanceiroPropria } from './porta-propria.js';
import { formaDoCodigo, versaoTexto } from './vocabulario.js';

const op = (c: ContextoNucleo, chave = `t0207-${randomUUID()}`): ContextoOperacao => ({ ...c, chaveIdempotencia: chave });
/** O contexto com a Idempotency-Key do pedido (uma por pedido, como a tela manda). */
const comChave = (c: ContextoNucleo, chave = `t0207-${randomUUID()}`) => ({ ...c, chaveIdempotencia: chave });
const trilha = { estabelecimento: null, usuario: null, acao: 'operacao' as const, entidade: 'teste', entidadeId: null, correlacao: null };

describe.skipIf(SEM_BANCO)('porta própria do financeiro (MariaDB, cliente f22_o2)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const contar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2'), correlacao: 'conta-02-07' }, async (l) => Number((await l.uma(sql, p))?.['n'] ?? 0));

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('lança o título com parcelas e retenção: linhas, número, versão, trilha e outbox; o duplicado é recusado', async () => {
    const c = m.ctx(m.lanca);
    const trilhas0 = await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est]);
    const saida0 = await contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE estabelecimento_id = ?', [m.est]);
    const e = { ...tituloDaMassa(m, 7001, 1000, 2), retencoes: [{ codigo: m.tributo, valor: 15 }] };
    const r = await porta.executar(c, 'financeiro.criarTituloPagar', e, op(c));
    expect(r.repetida).toBe(false);
    const titulo = Number(r.resultado['tituloPagar']);
    const linha = await m.nucleo.lerSomente({ cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2'), correlacao: 'x' }, (l) =>
      l.uma('SELECT numero, valor_bruto, valor_retencoes, valor_liquido, versao, situacao FROM titulo_pagar WHERE id = ?', [titulo]),
    );
    expect(String(linha?.['numero'])).toMatch(/^TP-\d+$/);
    // Parcelas impressas: 1000,00 bruto − 15,00 retido = 985,00 líquido.
    expect([Number(linha?.['valor_bruto']), Number(linha?.['valor_retencoes']), Number(linha?.['valor_liquido'])]).toEqual([
      1000, 15, 985,
    ]);
    expect(Number(linha?.['versao'])).toBe(1);
    expect(await contar('SELECT COUNT(*) AS n FROM parcela_pagar WHERE titulo_pagar_id = ?', [titulo])).toBe(2);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id WHERE p.titulo_pagar_id = ?',
        [titulo],
      ),
    ).toBe(1);
    expect(await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est])).toBe(trilhas0 + 1);
    expect(await contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE estabelecimento_id = ?', [m.est])).toBe(saida0 + 1);
    const lista = await porta.titulosPagar(c, {
      situacao: null,
      vencimentoDe: null,
      vencimentoAte: null,
      credor: m.fornecedor,
      tipo: 'F',
      pagina: 0,
      hoje: '2026-01-01',
    });
    expect(lista.itens.filter((t) => t.documento === 7001).map((t) => t.parcela).sort()).toEqual([1, 2]);
    expect(await codigoDaGravacao(porta.executar(c, 'financeiro.criarTituloPagar', e, op(c)))).toBe('duplicado');
    // A mesma chave com a mesma entrada devolve o resultado anterior, sem gravar de novo.
    const chave = `t0207-${randomUUID()}`;
    const e2 = tituloDaMassa(m, 7002, 50);
    const a = await porta.executar(c, 'financeiro.criarTituloPagar', e2, op(c, chave));
    const b = await porta.executar(c, 'financeiro.criarTituloPagar', e2, op(c, chave));
    expect(b.repetida).toBe(true);
    expect(b.resultado['tituloPagar']).toBe(a.resultado['tituloPagar']);
  });

  it('alçada, aprovação e pagamento: segregação, aprovação registrada e a baixa com o movimento da conta', async () => {
    const faixa = await porta.gravarSgh(comChave(m.ctx(m.lanca)), trilha, (g) =>
      g.salvarFaixa({
        id: null,
        centroCusto: null,
        tipoCredor: null,
        valorDe: 0,
        valorAte: null,
        aprovacoes: 1,
        permissao: 'financeiro.tituloPagar.aprovar',
        vigenciaInicio: '2000-01-01',
        vigenciaFim: null,
        ativa: true,
        usuario: 'x',
      }),
    );
    expect((await porta.faixas(m.ctx(m.lanca))).map((f) => f.id)).toContain(faixa.id);
    const c = m.ctx(m.lanca);
    const r = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, 7101, 321.45), op(c));
    const parcela = Number(r.resultado['titulo']);
    const aprovar = (u: number) =>
      porta.gravarSgh(comChave(m.ctx(u)), trilha, (g) =>
        g.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
      );
    expect(await codigoDaGravacao(aprovar(m.lanca))).toBe('segregacao-lancou-aprova');
    const pagar = (u: number, versao: string | null = null) =>
      porta.executar(
        m.ctx(u),
        'financeiro.baixarTitulo',
        {
          cenario: 'pagar',
          titulos: [{ titulo: parcela, versao }],
          conta: m.contaA,
          dataPagamento: new Date().toISOString().slice(0, 10),
          formaPagamento: 1,
          porBordero: true,
        },
        op(m.ctx(u)),
      );
    expect(await codigoDaGravacao(pagar(m.paga))).toBe('sem-aprovacao');
    const ap = await aprovar(m.aprova);
    expect(ap.aprovado).toBe(true);
    expect(
      await contar("SELECT COUNT(*) AS n FROM pedido_aprovacao WHERE entidade = 'titulo_pagar' AND entidade_id = ? AND situacao = 'aprovado'", [
        Number(r.resultado['tituloPagar']),
      ]),
    ).toBe(1);
    expect(await codigoDaGravacao(pagar(m.aprova))).toBe('segregacao-aprovou-paga');
    expect(await codigoDaGravacao(pagar(m.paga, versaoTexto(9)))).toBe('conflito-versao');
    const pago = await pagar(m.paga, versaoTexto(1));
    expect(pago.resultado['titulos']).toBe(1);
    const p = await m.nucleo.lerSomente({ cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2'), correlacao: 'x' }, (l) =>
      l.uma('SELECT situacao, saldo, valor_pago, versao FROM parcela_pagar WHERE id = ?', [parcela]),
    );
    expect([String(p?.['situacao']), Number(p?.['saldo']), Number(p?.['valor_pago']), Number(p?.['versao'])]).toEqual([
      'paga',
      0,
      321.45,
      2,
    ]);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM baixa_titulo b JOIN movimento_bancario mv ON mv.id = b.movimento_bancario_id
          WHERE b.parcela_pagar_id = ? AND b.forma_pagamento = ? AND mv.baixa_titulo_id = b.id AND mv.natureza = 'debito'
            AND b.bordero_pagamento_id IS NOT NULL`,
        [parcela, formaDoCodigo(1)],
      ),
    ).toBe(1);
    expect(await codigoDaGravacao(pagar(m.paga))).toBe('titulo-ja-baixado');
    const det = await porta.tituloPagar(c, parcela, new Date().toISOString().slice(0, 10));
    expect(det?.situacao).toBe('pago');
    expect(det?.aprovacoesFeitas.map((a) => a.aprovador)).toEqual(['l0207.aprova']);
  });

  it('exclui o título em aberto (lógica, com versão); conflito de versão e outro estabelecimento são recusados', async () => {
    const c = m.ctx(m.lanca);
    const r = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, 7201, 10), op(c));
    const parcela = Number(r.resultado['titulo']);
    const excluir = (ctx: ContextoNucleo, versao: string | null) =>
      porta.executar(ctx, 'financeiro.criarTituloPagar', { acao: 'excluir', titulo: parcela, versao }, op(ctx));
    expect(await codigoDaGravacao(excluir(m.ctx(m.lanca, m.outroEst), null))).toBe('titulo-inexistente');
    expect(await porta.tituloPagar(m.ctx(m.lanca, m.outroEst), parcela, '2026-01-01')).toBeNull();
    expect(await codigoDaGravacao(excluir(c, versaoTexto(5)))).toBe('conflito-versao');
    expect(await codigoDaGravacao(excluir(c, versaoTexto(1)))).toBe('gravou');
    expect(
      await contar('SELECT COUNT(*) AS n FROM titulo_pagar WHERE id = ? AND excluido_em IS NOT NULL AND versao = 2', [
        Number(r.resultado['tituloPagar']),
      ]),
    ).toBe(1);
    expect(await porta.tituloPagar(c, parcela, '2026-01-01')).toBeNull();
  });

  it('tesouraria: transferência em duas linhas, extrato importado uma vez e conciliado com o movimento', async () => {
    const c = m.ctx(m.lanca);
    const hoje = new Date().toISOString().slice(0, 10);
    const t = await porta.executar(
      c,
      'financeiro.lancarMovimento',
      {
        tipo: 'T',
        data: hoje,
        contaCredito: m.contaB,
        contaDebito: m.contaA,
        valor: 77.7,
        historico: 'TRANSFERENCIA SINTETICA L0207',
        classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
      },
      op(c),
    );
    const ids = String(t.resultado['ids']).split(',').map(Number);
    expect(ids).toHaveLength(2);
    const movB = await porta.movimento(c, m.contaB, hoje, hoje);
    const credito = movB.find((x) => ids.includes(x.id));
    expect([credito?.tipo, credito?.contaCredito, credito?.contaDebito]).toEqual(['T', m.contaB, m.contaA]);
    const extrato = { conta: m.contaB, origem: 'csv' as const, hashArquivo: 'a'.repeat(64), chaveObjeto: null, usuario: 'x' };
    const linhas = [{ data: hoje, valor: 77.7, historico: 'TED RECEBIDA', documento: '' }];
    const i1 = await porta.gravarSgh(comChave(c), trilha, (g) => g.importarExtrato({ ...extrato, linhas }));
    const i2 = await porta.gravarSgh(comChave(c), trilha, (g) => g.importarExtrato({ ...extrato, linhas }));
    expect([i1.linhas, i1.repetido, i2.repetido, i2.id === i1.id]).toEqual([1, false, true, true]);
    // Uma segunda linha (50,00) que não casa com o movimento de 77,70.
    await porta.gravarSgh(comChave(c), trilha, (g) =>
      g.importarExtrato({ ...extrato, hashArquivo: 'e'.repeat(64), linhas: [{ ...linhas[0]!, valor: 50 }] }),
    );
    const pendentes = await porta.linhasExtrato(c, m.contaB, 'pendente');
    const linha = pendentes.find((x) => x.valor === 77.7);
    const outra = pendentes.find((x) => x.valor === 50);
    const conciliar = (u: number, escopo: number[], idLinha = linha!.id, mov = credito!.id) =>
      porta.gravarSgh(comChave(m.ctx(u)), trilha, (g) =>
        g.conciliar({
          linha: idLinha,
          alvo: { tipo: 'movimento', id: mov },
          regra: 'valor-data',
          usuario: 'x',
          contasEscopo: escopo,
        }),
      );
    expect(await codigoDaGravacao(conciliar(m.paga, [m.contaA]))).toBe('fora-do-escopo');
    // Quem lançou a transferência não concilia o próprio movimento (segregação).
    expect(await codigoDaGravacao(conciliar(m.lanca, [m.contaA, m.contaB]))).toBe('segregacao-pagou-concilia');
    // A linha de 50,00 não casa com o movimento de 77,70; o débito da conta A não é movimento da conta B.
    expect(await codigoDaGravacao(conciliar(m.paga, [m.contaA, m.contaB], outra!.id))).toBe('valor-divergente');
    const debito = ids.find((x) => x !== credito!.id)!;
    expect(await codigoDaGravacao(conciliar(m.paga, [m.contaA, m.contaB], linha!.id, debito))).toBe('alvo-sem-movimento');
    expect(await codigoDaGravacao(conciliar(m.paga, [m.contaA, m.contaB]))).toBe('gravou');
    expect(await contar('SELECT COUNT(*) AS n FROM movimento_bancario WHERE id = ? AND conciliado = TRUE', [credito!.id])).toBe(1);
    expect((await porta.linhasExtrato(c, m.contaB, 'conciliada')).map((x) => x.id)).toEqual([linha!.id]);
  });

  it('fiscal: o lote contábil e a remessa ficam registrados; a NFS-e simulada aguarda o modelo', async () => {
    const c = m.ctx(m.lanca);
    const lote = await porta.gravarSgh(comChave(c), trilha, (g) =>
      g.registrarLoteContabil({
        usuario: 'x',
        periodo: '2026-10',
        regua: 'caixa',
        lancamentos: 3,
        somaDebitos: 30,
        somaCreditos: 30,
        semDePara: 1,
        hashArquivo: 'b'.repeat(64),
        chaveObjeto: null,
      }),
    );
    // O mesmo arquivo (hash) com outra chave de pedido devolve o lote já registrado.
    const lote2 = await porta.gravarSgh(comChave(c), trilha, (g) =>
      g.registrarLoteContabil({
        usuario: 'x',
        periodo: '2026-10',
        regua: 'caixa',
        lancamentos: 3,
        somaDebitos: 30,
        somaCreditos: 30,
        semDePara: 1,
        hashArquivo: 'b'.repeat(64),
        chaveObjeto: null,
      }),
    );
    expect(lote2.id).toBe(lote.id);
    const lotes = await porta.registrosFiscais(c, 'lote');
    expect(lotes.find((x) => x['ID'] === lote.id)).toMatchObject({ PERIODO: '2026-10', REGUA: 'caixa', LANCAMENTOS: 3 });
    const rem = await porta.gravarSgh(comChave(c), trilha, (g) =>
      g.registrarRemessa({
        usuario: 'x',
        conta: m.contaA,
        leiaute: 'cnab240',
        titulos: 1,
        valorTotal: 10,
        hashArquivo: 'c'.repeat(64),
        chaveObjeto: null,
        destino: 'simulador',
        situacao: 'gerada',
        hashRetorno: null,
        ocorrencias: null,
      }),
    );
    expect(rem.sequencial).toBeGreaterThan(0);
    // O reenvio com a mesma chave do pedido devolve a remessa gravada: nem número nem sequência avançam.
    const chaveRem = `t0207-${randomUUID()}`;
    const remessa = (hash: string) =>
      porta.gravarSgh(comChave(c, chaveRem), trilha, (g) =>
        g.registrarRemessa({
          usuario: 'x',
          conta: m.contaA,
          leiaute: 'cnab240',
          titulos: 1,
          valorTotal: 10,
          hashArquivo: hash,
          chaveObjeto: null,
          destino: 'simulador',
          situacao: 'gerada',
          hashRetorno: null,
          ocorrencias: null,
        }),
      );
    const r1 = await remessa('f'.repeat(64));
    const r2 = await remessa('f'.repeat(64));
    expect([r2.id, r2.sequencial]).toEqual([r1.id, r1.sequencial]);
    expect(await contar('SELECT COUNT(*) AS n FROM remessa_bancaria WHERE estabelecimento_id = ? AND hash_arquivo = ?', [m.est, 'f'.repeat(64)])).toBe(1);
    expect((await porta.registrosFiscais(c, 'remessa')).map((x) => x['CONTA'])).toContain(m.contaA);
    expect(
      await codigoDaGravacao(
        porta.gravarSgh(comChave(c), trilha, (g) =>
          g.registrarNfse({
            usuario: 'x',
            tituloReceber: null,
            conta: null,
            momento: 'apresentacao',
            classificacao: 'x',
            itemServico: '4.03',
            valorServicos: 1,
            aliquotaIss: 2,
            valorIss: 0.02,
            issRetido: false,
            valorIbs: 0,
            valorCbs: 0,
            retencoes: 0,
            valorLiquido: 0.98,
            destino: 'simulador',
            situacao: 'simulada',
            numero: null,
            hashXml: 'd'.repeat(64),
            chaveObjeto: null,
          }),
        ),
      ),
    ).toBe('modelo-pendente');
  });

  it('glosa no título: item de outra conta, sem retorno ou acima do item é recusado; só a aceita reduz o saldo; o recurso deferido vira recebível', async () => {
    const c = m.ctx(m.lanca);
    const r = await porta.executar(
      c,
      'financeiro.criarTituloReceber',
      { contas: [{ conta: m.contasHospitalares[2]!, versao: null }], vencimento: '2026-12-15', documento: 90_217, referente: '' },
      op(c),
    );
    const titulo = Number(r.resultado['titulo']);
    // Itens sintéticos: A (cobrado 500, pago 400, com retorno) e B (sem retorno) na conta do título; C em outra conta.
    const [itemA, itemB, itemC] = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-glosa-02-07' }, async (e) => {
      const agora = new Date();
      const porCodigo = async (tabela: string, codigo: string, colunas: string, valores: unknown[]) => {
        const ja = await e.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo]);
        if (ja) return Number(ja.id);
        return e.inserir(
          `INSERT INTO ${tabela} (codigo, ${colunas}, criado_em) VALUES (?, ${valores.map(() => '?').join(', ')}, ?)`,
          [codigo, ...valores, agora],
        );
      };
      const grupo = await porCodigo('grupo_faturamento', 'L0207-GF', 'descricao, tipo_grupo', ['GRUPO FAT L0207', 'servico_hospitalar']);
      const fat = await porCodigo('item_faturavel', 'L0207-IF', 'descricao, tipo_item, grupo_faturamento_id', ['ITEM L0207', 'taxa', grupo]);
      const item = (conta: number, seq: number, total: number, pago: number, glosado: number, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, valor_pago, valor_glosado, situacao, criado_em) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [conta, seq, fat, agora, total, total, pago, glosado, situacao, agora],
        );
      return [
        await item(m.contasHospitalares[2]!, 1, 500, 400, 100, 'conferido'),
        await item(m.contasHospitalares[2]!, 2, 100, 0, 0, 'lancado'),
        await item(m.contasHospitalares[0]!, 1, 100, 50, 50, 'conferido'),
      ];
    });
    const glosa = (
      item: number | null,
      valor: number,
      situacao: 'aceita' | 'recurso-deferido' | 'recurso-indeferido',
      extra = {},
      chave = `t0207-${randomUUID()}`,
    ) =>
      porta.gravarSgh(comChave(c, chave), trilha, (g) =>
        g.registrarGlosaTitulo({
          tituloReceber: titulo,
          item,
          situacao,
          valor,
          motivo: `GLOSA SINTETICA L0207 ${situacao} ${valor}`,
          usuario: 'x',
          origem: 'tela',
          ...extra,
        }),
      );
    const valores = () =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conta-02-07' }, async (l) => {
        const t = await l.uma('SELECT valor_glosa, valor_glosa_aceita FROM titulo_receber WHERE id = ?', [titulo]);
        const p = await l.uma('SELECT SUM(valor_recurso) AS recurso FROM parcela_receber WHERE titulo_receber_id = ?', [titulo]);
        return [Number(t?.['valor_glosa']), Number(t?.['valor_glosa_aceita']), Number(p?.['recurso'])];
      });
    expect(await codigoDaGravacao(glosa(itemC, 10, 'aceita'))).toBe('item-fora-do-titulo');
    expect(await codigoDaGravacao(glosa(itemB, 10, 'aceita'))).toBe('item-sem-retorno');
    expect(await codigoDaGravacao(glosa(itemA, 150, 'aceita'))).toBe('glosa-acima-do-item');
    expect(await codigoDaGravacao(glosa(itemA, 60, 'aceita', { chaveEvento: 'evt-l0207-1' }))).toBe('modelo-pendente');
    expect(await valores()).toEqual([0, 0, 0]);
    // O reenvio do mesmo pedido (mesma Idempotency-Key) não soma a glosa de novo.
    const chave = `t0207-${randomUUID()}`;
    expect((await glosa(itemA, 60, 'aceita', {}, chave)).repetida).toBe(false);
    expect((await glosa(itemA, 60, 'aceita', {}, chave)).repetida).toBe(true);
    // Sem a Idempotency-Key, a gravação direta é recusada.
    expect(
      await codigoDaGravacao(
        porta.gravarSgh(c, trilha, (g) =>
          g.registrarGlosaTitulo({ tituloReceber: titulo, item: null, situacao: 'aceita', valor: 1, motivo: 'SEM CHAVE L0207', usuario: 'x', origem: 'tela' }),
        ),
      ),
    ).toBe('entrada-invalida');
    // Somas impressas: glosa 60 (aceita) + 30 (indeferida) + 40 (deferida) = 130; aceita só 60; recurso 40.
    expect(await codigoDaGravacao(glosa(itemA, 30, 'recurso-indeferido'))).toBe('gravou');
    expect(await codigoDaGravacao(glosa(null, 40, 'recurso-deferido'))).toBe('gravou');
    expect(await valores()).toEqual([130, 60, 40]);
    const det = await porta.tituloReceber(c, titulo, '2026-11-01');
    expect([det?.glosaAceita, det?.recursoDeferido]).toEqual([60, 40]);
  });

  it('contas a receber paginadas: passa da primeira página e avisa que há mais', async () => {
    const c = m.ctx(m.lanca);
    const r = await porta.executar(
      c,
      'financeiro.criarTituloReceber',
      { contas: [{ conta: m.contasHospitalares[1]!, versao: null }], vencimento: '2026-12-15', documento: 90_218, referente: '' },
      op(c),
    );
    const base = Number(r.resultado['titulo']);
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-paginas-02-07' }, async (e) => {
      for (let i = 1; i <= 205; i++)
        await e.executar(
          `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
             tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
             natureza_financeira_id, situacao, conta_hospitalar_id, criado_em)
           SELECT estabelecimento_id, ?, tipo_devedor, fonte_pagadora_id, tipo_origem, tipo_documento_financeiro_id,
             numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido, natureza_financeira_id, situacao,
             conta_hospitalar_id, NOW(3)
             FROM titulo_receber WHERE id = ?`,
          [`L0207-PG${i}`, base],
        );
    });
    const filtro = { devedor: null, convenio: m.convenio, aberto: null, vencimentoDe: null, vencimentoAte: null, hoje: '2026-11-01' };
    const p0 = await porta.titulosReceber(c, { ...filtro, pagina: 0 });
    const p1 = await porta.titulosReceber(c, { ...filtro, pagina: 1 });
    expect([p0.itens.length, p0.mais, p1.pagina, p1.mais]).toEqual([200, true, 1, false]);
    expect(p1.itens.length).toBeGreaterThan(0);
    expect(p1.itens.some((t) => p0.itens.some((x) => x.id === t.id))).toBe(false);
  });
});

// A mesma bateria de recusas na memória e no banco.
const fabricas: [string, () => Promise<{ porta: PortaFinanceiro; c: ContextoNucleo; fim: () => Promise<void> }>][] = [
  [
    'memória',
    async () => ({
      porta: new PortaFinanceiroMemoria(null),
      c: { cliente: 'memoria', estabelecimento: 1, usuario: 1, correlacao: 'teste-02-07' },
      fim: async () => undefined,
    }),
  ],
  ...(SEM_BANCO
    ? []
    : ([
        [
          'banco',
          async () => {
            const m = await montarMassa();
            return {
              porta: new PortaFinanceiroPropria(m.nucleo),
              c: m.ctx(m.lanca),
              fim: async () => {
                await limparMassa(m.nucleo, [m.est, m.outroEst]);
                await m.nucleo.encerrar();
              },
            };
          },
        ],
      ] as [string, () => Promise<{ porta: PortaFinanceiro; c: ContextoNucleo; fim: () => Promise<void> }>][])),
];

describe.each(fabricas)('recusas comuns do financeiro (%s)', (_nome, fabrica) => {
  let f: Awaited<ReturnType<typeof fabrica>>;
  beforeAll(async () => {
    f = await fabrica();
  }, 180_000);
  afterAll(async () => {
    await f?.fim();
  });

  it('entrada inválida é recusada sem gravar', async () => {
    expect(
      await codigoDaGravacao(f.porta.executar(f.c, 'financeiro.lancarMovimento', { tipo: 'Z' }, op(f.c))),
    ).toBe('entrada-invalida');
  });

  it('excluir título inexistente é recusado', async () => {
    expect(
      await codigoDaGravacao(
        f.porta.executar(f.c, 'financeiro.criarTituloPagar', { acao: 'excluir', titulo: 987_654_321, versao: null }, op(f.c)),
      ),
    ).toBe('titulo-inexistente');
  });

  it('as formas de pagamento têm código e nome', async () => {
    const formas = await f.porta.formasPagamento(f.c);
    expect(formas.length).toBeGreaterThan(0);
    expect(formas.every((x) => Number.isInteger(x.codigo) && x.nome.length > 0)).toBe(true);
  });
});
