// Contrato de efeito do reembolso ao beneficiário (08-SGO linha 106, C2-047) contra o MariaDB real (cliente f22_o2).
// Massa sintética "L0209" mais um procedimento com termo TUSS sintético. Prova o que fica no banco: a tabela de
// referência do município (tabela_reembolso_referencia + _item) e a regra do plano (regra_reembolso_plano, multiplicador
// e teto por evento); o pedido com o comprovante guardado pela porta de arquivos e ligado ao pedido (arquivo.entidade),
// o limite do item pela tabela do município e o prazo legal; a recusa sem comprovante; a pendência de documento e a
// volta à análise com o novo comprovante; a análise com glosa por item (pedido_reembolso_glosa) e o teto; o pagamento
// com o crédito na conta corrente do beneficiário (lancamento_conta_beneficiario); o cancelamento recusado no pago.
// Trilha de cada gravação. SGH_NUCLEO_SEM_BANCO=1 pula.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaReembolsoPropria } from './reembolso-propria.js';

describe.skipIf(SEM_BANCO)('reembolso ao beneficiário (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaReembolsoPropria;
  let m: MassaOperadora;
  let raiz = '';
  let procedimento = 0;
  let municipio = 0;
  let plano = 0;
  let pedido = 0;
  let versao = 1;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2047' }, (l) => l.consultar(sql, p));
  const T = (tabela: string, ev: string) => trilhaTela(m, tabela, ev);
  const hoje = new Date().toISOString().slice(0, 10);
  const pdf = (marca: string) => ({
    nome: `recibo-${marca}.pdf`,
    tipoMime: 'application/pdf',
    base64: Buffer.from(`%PDF-1.4 comprovante sintetico ${marca} ${Date.now()}`).toString('base64'),
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2047' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE l FROM lancamento_conta_beneficiario l JOIN pedido_reembolso p ON p.id = l.pedido_reembolso_id WHERE p.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'DELETE g FROM pedido_reembolso_glosa g JOIN pedido_reembolso_item i ON i.id = g.pedido_reembolso_item_id JOIN pedido_reembolso p ON p.id = i.pedido_reembolso_id WHERE p.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'DELETE i FROM pedido_reembolso_item i JOIN pedido_reembolso p ON p.id = i.pedido_reembolso_id WHERE p.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        "UPDATE arquivo SET entidade_id = NULL WHERE entidade = 'pedido_reembolso' AND estabelecimento_id IN (?, ?)",
        est,
      );
      await e.executar('DELETE FROM pedido_reembolso WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM regra_reembolso_plano WHERE operadora_saude_id = ?', [m.operadora]);
      await e.executar(
        'DELETE i FROM tabela_reembolso_referencia_item i JOIN tabela_reembolso_referencia t ON t.id = i.tabela_reembolso_referencia_id WHERE t.operadora_saude_id = ?',
        [m.operadora],
      );
      await e.executar('DELETE FROM tabela_reembolso_referencia WHERE operadora_saude_id = ?', [m.operadora]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-c2047' }, async (e) => {
      const it = await e.uma<{ id: number }>("SELECT id FROM item_faturavel WHERE codigo = 'L0209RB1'");
      if (it) procedimento = Number(it.id);
      else {
        const g = await e.uma<{ id: number }>('SELECT id FROM grupo_faturamento ORDER BY id LIMIT 1');
        procedimento = await e.inserir(
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, termo_terminologia_id, criado_em)
           VALUES ('L0209RB1', 'CONSULTA SINTETICA DE REEMBOLSO', 'procedimento', ?, ?, ?)`,
          [Number(g!.id), m.termo, new Date()],
        );
      }
      await e.executar('UPDATE item_faturavel SET termo_terminologia_id = ? WHERE id = ?', [
        m.termo,
        procedimento,
      ]);
      const b = await e.uma<{ plano: number }>(
        'SELECT plano_comercializado_id AS plano FROM beneficiario_plano WHERE id = ?',
        [m.beneficiario],
      );
      plano = Number(b!.plano);
      const mu = await e.uma<{ id: number }>("SELECT id FROM municipio_ibge WHERE codigo_ibge = '9990209'");
      municipio = mu
        ? Number(mu.id)
        : Number((await e.uma<{ id: number }>('SELECT id FROM municipio_ibge ORDER BY id LIMIT 1'))!.id);
    });
    raiz = mkdtempSync(join(tmpdir(), 'c2047-reembolso-'));
    const armazem = criarArmazemLocal(nucleo as unknown as NucleoArmazem, {
      raiz,
      executor: nucleo.criarExecutor(),
    });
    let n = 0;
    const fora = () => Promise.reject(new Error('fora do teste'));
    const ctx = (sufixo: string) => ({
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.usuario,
      correlacao: `c2047-arq-${sufixo}`,
    });
    const arquivos: ArquivosDoModulo = {
      async guardar(_h, e) {
        const g = await armazem.guardar(e, {
          ...ctx('g'),
          chaveIdempotencia: `c2047-arq-${Date.now()}-${++n}`,
        });
        return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
      },
      metadado: fora,
      async ler(_h, id) {
        const r = await armazem.ler(ctx('l'), id);
        return { metadado: r.metadado, conteudo: r.conteudo };
      },
      excluir: fora,
      fixarRetencao: fora,
    };
    porta = new PortaReembolsoPropria(nucleo, CLIENTE, undefined, arquivos);
  }, 180_000);
  afterAll(async () => {
    if (m) await limpar().catch(() => undefined);
    await nucleo?.encerrar();
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('cadastra a tabela do município e a regra do plano com multiplicador e teto', async () => {
    const t = await porta.incluirTabela(
      contexto(m),
      m.operadora,
      {
        codigo: 'ref-l0209',
        nome: 'Referência sintética do município',
        produto: null,
        municipio,
        modalidade: null,
        fator: null,
        padrao: false,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        itens: [{ procedimento, valor: 100, quantidadeMaxima: 2 }],
      },
      T('tabela_reembolso_referencia', 'operadora.reembolso.tabela-incluida'),
    );
    const [x] = await ler(
      'SELECT t.codigo, t.municipio_ibge_id, i.procedimento_termo_terminologia_id AS termo, i.valor_referencia FROM tabela_reembolso_referencia t JOIN tabela_reembolso_referencia_item i ON i.tabela_reembolso_referencia_id = t.id WHERE t.id = ?',
      [t.id],
    );
    expect(x).toMatchObject({ codigo: 'REF-L0209', municipio_ibge_id: municipio, termo: m.termo });
    expect(Number(x!['valor_referencia'])).toBe(100);
    const r = await porta.incluirRegra(
      contexto(m),
      m.operadora,
      {
        plano,
        modalidade: null,
        tabela: t.id,
        multiplicador: 1.5,
        percentual: null,
        livreEscolha: true,
        limitePorEvento: 400,
        limiteAnual: null,
        prazoPagamentoDias: 30,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
      T('regra_reembolso_plano', 'operadora.reembolso.regra-incluida'),
    );
    const [g] = await ler(
      'SELECT multiplicador, limite_por_evento, prazo_pagamento_dias FROM regra_reembolso_plano WHERE id = ?',
      [r.id],
    );
    expect(Number(g!['multiplicador'])).toBe(1.5);
    expect(Number(g!['limite_por_evento'])).toBe(400);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'regra_reembolso_plano' AND entidade_id = ?",
        [r.id],
      ),
    ).toHaveLength(1);
    await expect(
      porta.incluirRegra(
        contexto(m),
        m.operadora,
        {
          plano,
          modalidade: null,
          tabela: null,
          multiplicador: 1,
          percentual: null,
          livreEscolha: false,
          limitePorEvento: null,
          limiteAnual: null,
          prazoPagamentoDias: 45,
          vigenciaInicio: '2026-02-01',
          vigenciaFim: null,
        },
        T('regra_reembolso_plano', 'x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'base-obrigatoria' } });
  });

  const entrada = (anexos: ReturnType<typeof pdf>[]) => ({
    beneficiario: m.beneficiario,
    canal: 'presencial' as const,
    prestadorNome: 'CLINICA SINTETICA L0209',
    prestadorDocumento: '11.222.333/0001-81',
    dataAtendimento: hoje,
    dataAlta: null,
    numeroDocumentoFiscal: 'NF-L0209',
    modalidade: null,
    municipio,
    observacao: null,
    itens: [
      { procedimento, quantidade: 3, valorApresentado: 450, dataRealizacao: null },
      { procedimento, quantidade: 1, valorApresentado: 200, dataRealizacao: null },
    ],
    anexos,
  });

  it('grava o pedido com o comprovante ligado, o limite pela tabela do município e o prazo legal; sem comprovante recusa', async () => {
    expect(
      codigoDe(
        await porta
          .incluirPedido(contexto(m), entrada([]), T('pedido_reembolso', 'x'))
          .catch((e: unknown) => e),
      ),
    ).toBe('comprovante-obrigatorio');
    const r = await porta.incluirPedido(
      contexto(m),
      entrada([pdf('a')]),
      T('pedido_reembolso', 'operadora.reembolso.pedido-incluido'),
    );
    pedido = r.id;
    versao = r.versao;
    const [p] = await ler(
      'SELECT situacao, valor_apresentado, prazo_pagamento, prestador_tipo_pessoa, prestador_cpf_cnpj, tabela_reembolso_referencia_id FROM pedido_reembolso WHERE id = ?',
      [pedido],
    );
    expect(p).toMatchObject({
      situacao: 'em_analise',
      prestador_tipo_pessoa: 'juridica',
      prestador_cpf_cnpj: '11222333000181',
    });
    expect(p!['tabela_reembolso_referencia_id']).not.toBeNull();
    expect(Number(p!['valor_apresentado'])).toBe(650);
    expect(r.prazoPagamento).toBe(
      new Date(Date.parse(`${hoje}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10),
    );
    // 100 × 1,5 × 2 (quantidade máxima) = 300 no primeiro; 100 × 1,5 × 1 = 150 no segundo.
    const itens = await ler(
      'SELECT valor_referencia FROM pedido_reembolso_item WHERE pedido_reembolso_id = ? ORDER BY sequencia',
      [pedido],
    );
    expect(itens.map((i) => Number(i['valor_referencia']))).toEqual([300, 150]);
    expect(
      await ler(
        "SELECT id FROM arquivo WHERE entidade = 'pedido_reembolso' AND entidade_id = ? AND finalidade = 'comprovante_reembolso'",
        [pedido],
      ),
    ).toHaveLength(1);
    expect(
      await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'pedido_reembolso' AND entidade_id = ?", [
        pedido,
      ]),
    ).toHaveLength(1);
  });

  it('pendência de documento e volta à análise com o novo comprovante', async () => {
    const pend = await porta.analisar(
      contexto(m),
      pedido,
      { versao, decisao: 'pendente_documento', observacao: 'Falta o pedido médico', itens: [] },
      T('pedido_reembolso', 'operadora.reembolso.pedido-pendente'),
    );
    expect(pend.situacao).toBe('pendente_documento');
    const a = await porta.anexar(
      contexto(m),
      pedido,
      pend.versao,
      pdf('b'),
      T('pedido_reembolso', 'operadora.reembolso.anexo'),
    );
    versao = a.versao;
    const [p] = await ler('SELECT situacao FROM pedido_reembolso WHERE id = ?', [pedido]);
    expect(p!['situacao']).toBe('em_analise');
    expect((await porta.pedido(contexto(m), pedido)).anexos).toHaveLength(2);
    const c = await porta.comprovante(
      contexto(m),
      pedido,
      (await porta.pedido(contexto(m), pedido)).anexos[0]!.id,
    );
    expect(c.tipoMime).toBe('application/pdf');
  });

  it('analisa com glosa por item e teto por evento; paga com o crédito na conta do beneficiário; pago não cancela', async () => {
    const itens = await ler(
      'SELECT id FROM pedido_reembolso_item WHERE pedido_reembolso_id = ? ORDER BY sequencia',
      [pedido],
    );
    const r = await porta.analisar(
      contexto(m),
      pedido,
      {
        versao,
        decisao: 'concluir',
        observacao: null,
        itens: [
          { item: Number(itens[0]!['id']), coparticipacao: 0, glosas: [] },
          {
            item: Number(itens[1]!['id']),
            coparticipacao: 0,
            glosas: [{ motivo: m.motivoGlosa, valor: 30, justificativa: 'Sessão sem pedido' }],
          },
        ],
      },
      T('pedido_reembolso', 'operadora.reembolso.pedido-analisado'),
    );
    expect(r.situacao).toBe('aprovado_parcial');
    const [p] = await ler(
      'SELECT valor_glosado, valor_reembolsado, analisado_em FROM pedido_reembolso WHERE id = ?',
      [pedido],
    );
    expect(Number(p!['valor_glosado'])).toBe(30);
    expect(Number(p!['valor_reembolsado'])).toBe(400); // 300 + 120 = 420, cortado pelo teto por evento de 400
    expect(p!['analisado_em']).not.toBeNull();
    const gl = await ler(
      'SELECT g.valor_glosado, g.motivo_glosa_id, g.responsavel_usuario_id FROM pedido_reembolso_glosa g WHERE g.pedido_reembolso_item_id = ?',
      [Number(itens[1]!['id'])],
    );
    expect(gl).toHaveLength(1);
    expect(gl[0]).toMatchObject({ motivo_glosa_id: m.motivoGlosa, responsavel_usuario_id: m.usuario });
    const it2 = await ler(
      'SELECT situacao, valor_reembolsado FROM pedido_reembolso_item WHERE pedido_reembolso_id = ? ORDER BY sequencia',
      [pedido],
    );
    expect(it2.map((i) => [i['situacao'], Number(i['valor_reembolsado'])])).toEqual([
      ['aprovado', 300],
      ['parcial', 100],
    ]);
    await expect(
      porta.analisar(
        contexto(m),
        pedido,
        { versao: r.versao, decisao: 'concluir', observacao: null, itens: [] },
        T('pedido_reembolso', 'x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'situacao-invalida' } });
    const pg = await porta.pagar(
      contexto(m),
      pedido,
      { versao: r.versao, pagoEm: hoje },
      T('pedido_reembolso', 'operadora.reembolso.pago'),
    );
    const [l] = await ler(
      'SELECT natureza, tipo_movimento, valor, beneficiario_plano_id FROM lancamento_conta_beneficiario WHERE pedido_reembolso_id = ?',
      [pedido],
    );
    expect(l).toMatchObject({
      natureza: 'credito',
      tipo_movimento: 'reembolso',
      beneficiario_plano_id: m.beneficiario,
    });
    expect(Number(l!['valor'])).toBe(400);
    const [x] = await ler('SELECT situacao, pago_em FROM pedido_reembolso WHERE id = ?', [pedido]);
    expect(x!['situacao']).toBe('pago');
    await expect(
      porta.cancelar(
        contexto(m),
        pedido,
        { versao: pg.versao, motivo: 'Tentativa sintética' },
        T('pedido_reembolso', 'x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'situacao-invalida' } });
    const visao = await porta.doBeneficiario(contexto(m), m.beneficiario);
    expect(visao.pedidos.map((v) => v.id)).toContain(pedido);
    expect(visao.reembolsadoNoAno).toBeGreaterThanOrEqual(400);
    expect((await porta.fila(contexto(m), 'pago')).map((v) => v.id)).toContain(pedido);
  });
});
