// Integração da porta PRÓPRIA da contratualização SUS contra o MariaDB real (cliente f22_o2 da onda 2). Contrato de
// efeito: contrato com incentivos (linhas, versão, trilha e idempotência da operação), alteração pela versão vista e
// recusa da versão velha, metas quantitativa (procedimento SIGTAP) e qualitativa (com o indicador), apuração
// registrada e corrigida, encerramento com o motivo na trilha; recusas (campo sem lugar no modelo, outro
// estabelecimento). Massa SINTÉTICA (estabelecimentos, habilitação e SIGTAP fictícios), limpa no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { ContratoSusEntrada, MetaSusEntrada } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaContratualizacaoPropria } from './porta-propria.js';
import { CARGA_DOMINIOS_CONTRATUALIZACAO } from './vocabulario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'f2203a';
const EST_B = 'f2203b';
const CNES = '9020301';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const CONTRATO: Omit<ContratoSusEntrada, 'versaoVista' | 'chave'> = {
  numero: 'CT-F2203-1',
  esfera: 3,
  gestor: 'Secretaria Municipal de Saúde Fictícia',
  objeto: 'Prestação de serviços hospitalares ao SUS (teste)',
  inicio: '2026-01-01',
  fim: '2026-12-31',
  cnes: null,
  habilitacao: null,
  habilitacaoValidade: null,
  redeAssistencia: 2,
  valorPreMensalCentavos: 12_345_678,
  valorPosMensalCentavos: 500_000,
  parteQualitativaPct: 40,
  incentivos: [{ incentivo: null, nome: 'Incentivo de teste', valorMensalCentavos: 100_000, inicio: '2026-01-01', fim: null }],
  observacao: null,
};

const META_QUANTI: Omit<MetaSusEntrada, 'versaoVista' | 'chave'> = {
  tipo: 'quantitativa',
  descricao: 'Consultas especializadas (teste)',
  periodicidade: 5,
  inicio: '202601',
  fim: '202612',
  pontos: 10,
  nivelSigtap: 'procedimento',
  codigoSigtap: '0301010072',
  modalidade: 'ambulatorial',
  complexidade: null,
  indicador: null,
  formato: null,
  sentido: null,
  unidade: null,
  afericao: null,
  valorMeta: 100,
  ativa: true,
};

const META_QUALI: Omit<MetaSusEntrada, 'versaoVista' | 'chave'> = {
  ...META_QUANTI,
  tipo: 'qualitativa',
  descricao: 'Taxa de ocupação (teste)',
  periodicidade: 10,
  nivelSigtap: null,
  codigoSigtap: null,
  modalidade: null,
  indicador: 2,
  formato: 6,
  sentido: 'maior',
  unidade: '%',
  afericao: 2,
  valorMeta: 85,
};

describe.skipIf(SEM_BANCO)('porta própria da contratualização contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContratualizacaoPropria;
  let estA = 0;
  let estB = 0;
  let ctxA: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  let contrato = 0;
  let versaoContrato = 1;
  let metaQuanti = 0;
  let metaQuali = 0;
  const correlacao = `f22-0203-${Date.now()}`;

  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0203-conta' }, (l) => l.uma<T>(sql, p));
  const trilha = (entidade: string): ((r: { id: number }) => TrilhaDaGravacao) => (r) => ({
    estabelecimento: estA,
    usuario: null,
    acao: 'operacao',
    entidade,
    entidadeId: r.id,
    dadosDepois: { evento: 'teste' },
    correlacao,
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar('DELETE FROM afericao_meta_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          `DELETE m FROM meta_contratual_sus m JOIN contrato_gestor_sus g ON g.id = m.contrato_gestor_sus_id
            WHERE g.estabelecimento_id = ?`,
          [est],
        );
        await e.executar('DELETE FROM indicador_contratual_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM incentivo_contratual_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM contrato_gestor_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao LIKE 'contratualizacao.%' AND estabelecimento_id = ?",
          [est],
        );
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string, cnes: string | null) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, cnes, agora],
        );
      estA = await est(EST_A, CNES);
      estB = await est(EST_B, null);
      const hab = await garantir(
        e,
        'SELECT id FROM habilitacao_sus WHERE codigo_cnes = ?',
        ['F22031'],
        'INSERT INTO habilitacao_sus (codigo_cnes, descricao, criado_em) VALUES (?, ?, ?)',
        ['F22031', 'Habilitação fictícia de teste', agora],
      );
      await garantir(
        e,
        'SELECT id FROM habilitacao_estabelecimento WHERE estabelecimento_id = ? AND habilitacao_sus_id = ?',
        [estA, hab],
        'INSERT INTO habilitacao_estabelecimento (estabelecimento_id, habilitacao_sus_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [estA, hab, '2025-01-01', agora],
      );
      for (const d of CARGA_DOMINIOS_CONTRATUALIZACAO)
        await garantir(
          e,
          'SELECT id FROM dominio_contratualizacao_sus WHERE lista = ? AND codigo = ?',
          [d.lista, d.codigo],
          `INSERT INTO dominio_contratualizacao_sus (lista, codigo, descricao, meses_periodo, ordem, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [d.lista, d.codigo, d.descricao, d.mesesPeriodo, d.ordem, agora],
        );
      const grupo = (nivel: string, codigo: string, pai: number | null) =>
        garantir(
          e,
          'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? AND vigencia_inicio = ?',
          [codigo, '2008-01-01'],
          `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, pai_grupo_sigtap_id, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, ?, '2008-01-01', 'teste', ?)`,
          [nivel, codigo, pai, `Grupo fictício ${codigo}`, agora],
        );
      const g = await grupo('grupo', '03', null);
      const sg = await grupo('subgrupo', '0301', g);
      const f = await grupo('forma_organizacao', '030101', sg);
      await garantir(
        e,
        'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
        ['0301010072'],
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, ?, ?, 'ambos', '2008-01-01', 'teste', ?)`,
        ['0301010072', 'Consulta especializada (teste)', f, agora],
      );
      for (const [codigo, descricao] of [
        ['01', 'Ambulatorial'],
        ['02', 'Hospitalar'],
      ] as const)
        await garantir(
          e,
          "SELECT id FROM dominio_sigtap WHERE lista = 'modalidade' AND codigo_sigtap = ?",
          [codigo],
          `INSERT INTO dominio_sigtap (lista, codigo_sigtap, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES ('modalidade', ?, ?, '2008-01-01', 'teste', ?)`,
          [codigo, descricao, agora],
        );
    });
    porta = new PortaContratualizacaoPropria(nucleo);
    ctxA = { cliente: CLIENTE, estabelecimento: estA, usuario: null, correlacao };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario: null, correlacao };
    await limpar();
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('as listas saem no código da tela, a partir do código neutro gravado', async () => {
    const d = await porta.dominios(ctxA);
    expect(d.esfera.map((x) => x.codigo)).toEqual([1, 2, 3]);
    expect(d.periodicidade.find((x) => x.codigo === 5)?.nome).toBe('Mensal');
    expect(d.escore.map((x) => x.codigo).sort()).toEqual([1, 2, 3, 4]);
    const r = await porta.relogio(ctxA);
    expect(r.competencia).toMatch(/^\d{6}$/);
  });

  it('inclui o contrato com os incentivos: linhas, versão 1, trilha e idempotência na mesma transação', async () => {
    const r = await porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), (g) =>
      g.incluirContrato({ entrada: CONTRATO, usuario: 'teste', chave: 'f22-0203-contrato-1' }),
    );
    contrato = r.id;
    expect(r.versao).toBe(1);
    const linha = await ler(
      `SELECT g.situacao, g.versao, g.valor_pre_fixado_mensal, e.codigo AS esfera, r.codigo AS rede
         FROM contrato_gestor_sus g
         JOIN dominio_contratualizacao_sus e ON e.id = g.esfera_dominio_contratualizacao_sus_id
         JOIN dominio_contratualizacao_sus r ON r.id = g.rede_assistencial_dominio_contratualizacao_sus_id
        WHERE g.id = ?`,
      [contrato],
    );
    expect(linha).toMatchObject({ situacao: 'vigente', versao: 1, esfera: 'municipal', rede: 'urgencia_emergencia' });
    expect(Number(linha?.['valor_pre_fixado_mensal'])).toBeCloseTo(123_456.78, 2);
    const inc = await ler('SELECT COUNT(*) AS n FROM incentivo_contratual_sus WHERE contrato_gestor_sus_id = ?', [contrato]);
    expect(Number(inc?.['n'])).toBe(1);
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'contrato_gestor_sus' AND entidade_id = ? AND correlacao = ?",
      [contrato, correlacao],
    );
    expect(Number(t?.['n'])).toBe(1);
    const i = await ler(
      "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'contratualizacao.contrato.incluir' AND chave = ? AND estabelecimento_id = ?",
      ['f22-0203-contrato-1', estA],
    );
    expect(Number(i?.['n'])).toBe(1);
    // O reenvio com a mesma chave acha o contrato original (o fluxo do controlador): nenhuma linha nova.
    const de = await porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), async (g) => {
      const ja = await g.contratoPelaChave('f22-0203-contrato-1');
      return ja ? { id: ja.id, versao: ja.versao } : g.incluirContrato({ entrada: CONTRATO, usuario: 'teste', chave: 'f22-0203-contrato-1' });
    });
    expect(de).toEqual({ id: contrato, versao: 1 });
    const n = await ler('SELECT COUNT(*) AS n FROM contrato_gestor_sus WHERE estabelecimento_id = ? AND numero_contrato = ?', [
      estA,
      CONTRATO.numero,
    ]);
    expect(Number(n?.['n'])).toBe(1);
    // Chave já guardada não inclui de novo, nem chamada direta (a chave única do banco recusa).
    await expect(
      porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), (g) =>
        g.incluirContrato({ entrada: { ...CONTRATO, numero: `${CONTRATO.numero}9` }, usuario: 'teste', chave: 'f22-0203-contrato-1' }),
      ),
    ).rejects.toThrow();
    const lido = await porta.contrato(ctxA, contrato);
    expect(lido).toMatchObject({
      numero: CONTRATO.numero,
      esfera: 3,
      redeAssistencia: 2,
      valorPreMensalCentavos: 12_345_678,
      situacao: 'ativo',
      cnes: CNES,
      habilitacao: 'Habilitação fictícia de teste',
      versao: 1,
    });
    expect(lido?.incentivos).toEqual([
      { incentivo: null, nome: 'Incentivo de teste', valorMensalCentavos: 100_000, inicio: '2026-01-01', fim: null },
    ]);
    expect((await porta.contratos(ctxA)).itens.map((c) => c.id)).toContain(contrato);
  });

  it('altera pela versão vista; a versão velha é recusada e nada muda', async () => {
    const r = await porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), async (g) => {
      expect(await g.numeroEmUso(CONTRATO.numero, null)).toBe(true);
      expect(await g.numeroEmUso(CONTRATO.numero, contrato)).toBe(false);
      return g.alterarContrato({
        entrada: { ...CONTRATO, gestor: 'Secretaria Estadual Fictícia', esfera: 2, incentivos: [] },
        usuario: 'teste',
        id: contrato,
        versaoVista: 1,
      });
    });
    versaoContrato = r.versao;
    expect(r.versao).toBe(2);
    await expect(
      porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), (g) =>
        g.alterarContrato({ entrada: CONTRATO, usuario: 'teste', id: contrato, versaoVista: 1 }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    const lido = await porta.contrato(ctxA, contrato);
    expect(lido).toMatchObject({ esfera: 2, gestor: 'Secretaria Estadual Fictícia', versao: 2, incentivos: [] });
  });

  it('o campo sem lugar no modelo é recusado (modelo-pendente) e nada é gravado', async () => {
    await expect(
      porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), (g) =>
        g.incluirContrato({
          entrada: { ...CONTRATO, numero: 'CT-F2203-2', observacao: 'Observação' },
          usuario: 'teste',
          chave: 'f22-0203-contrato-2',
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    const n = await ler('SELECT COUNT(*) AS n FROM contrato_gestor_sus WHERE estabelecimento_id = ?', [estA]);
    expect(Number(n?.['n'])).toBe(1);
  });

  it('metas: a quantitativa aponta o procedimento SIGTAP; a qualitativa ganha o indicador', async () => {
    expect(await porta.sigtapExiste(ctxA, '0301')).toBe(true);
    expect(await porta.sigtapExiste(ctxA, '9999')).toBe(false);
    expect((await porta.buscarSigtap(ctxA, '030101')).map((x) => x.codigo)).toContain('0301010072');
    metaQuanti = (
      await porta.gravarSgh(ctxA, trilha('meta_contratual_sus'), (g) =>
        g.incluirMeta({ entrada: META_QUANTI, usuario: 'teste', contrato, chave: 'f22-0203-meta-1' }),
      )
    ).id;
    metaQuali = (
      await porta.gravarSgh(ctxA, trilha('meta_contratual_sus'), (g) =>
        g.incluirMeta({ entrada: META_QUALI, usuario: 'teste', contrato, chave: 'f22-0203-meta-2' }),
      )
    ).id;
    // Reenvio da meta com a mesma chave: a mesma meta, uma linha só (meta_contratual_sus não tem unicidade própria).
    const reenvio = await porta.gravarSgh(ctxA, trilha('meta_contratual_sus'), async (g) => {
      const ja = await g.metaPelaChave('f22-0203-meta-1');
      return ja
        ? { id: ja.id, versao: ja.versao }
        : g.incluirMeta({ entrada: META_QUANTI, usuario: 'teste', contrato, chave: 'f22-0203-meta-1' });
    });
    expect(reenvio.id).toBe(metaQuanti);
    const nm = await ler('SELECT COUNT(*) AS n FROM meta_contratual_sus WHERE contrato_gestor_sus_id = ?', [contrato]);
    expect(Number(nm?.['n'])).toBe(2);
    // Outro estabelecimento não acha a meta pela chave.
    const deB = await porta.gravarSgh(ctxB, trilha('meta_contratual_sus'), async (g) => ({
      id: (await g.metaPelaChave('f22-0203-meta-1'))?.id ?? 0,
    }));
    expect(deB.id).toBe(0);
    const m = await ler(
      `SELECT m.sequencia, m.periodicidade_meses, m.vigencia_fim, m.nivel_sigtap, m.procedimento_sigtap_id IS NOT NULL AS proc
         FROM meta_contratual_sus m WHERE m.id = ?`,
      [metaQuanti],
    );
    expect(m).toMatchObject({ sequencia: 1, periodicidade_meses: 1, nivel_sigtap: 'procedimento' });
    expect(Number(m?.['proc'])).toBe(1);
    const q = await ler(
      `SELECT m.sequencia, m.periodicidade_meses, m.fonte_afericao, i.codigo, i.fonte FROM meta_contratual_sus m
         JOIN indicador_contratual_sus i ON i.id = m.indicador_contratual_sus_id WHERE m.id = ?`,
      [metaQuali],
    );
    expect(q).toMatchObject({
      sequencia: 2,
      periodicidade_meses: 3,
      fonte_afericao: 'sistema_externo',
      codigo: `M${contrato}-2`,
      fonte: 'sistemas_datasus',
    });
    const metas = await porta.metas(ctxA, contrato);
    expect(metas.find((x) => x.id === metaQuanti)).toMatchObject({
      tipo: 'quantitativa',
      periodicidade: 5,
      inicio: '202601',
      fim: '202612',
      codigoSigtap: '0301010072',
      modalidade: 'ambulatorial',
      versao: 1,
    });
    expect(metas.find((x) => x.id === metaQuali)).toMatchObject({
      tipo: 'qualitativa',
      periodicidade: 10,
      indicador: 2,
      formato: 6,
      sentido: 'maior',
      afericao: 2,
    });
    const alterada = await porta.gravarSgh(ctxA, trilha('meta_contratual_sus'), (g) =>
      g.alterarMeta({ entrada: { ...META_QUALI, indicador: 4 }, usuario: 'teste', id: metaQuali, versaoVista: 1 }),
    );
    expect(alterada.versao).toBe(2);
    expect((await porta.meta(ctxA, metaQuali))?.indicador).toBe(4);
    await expect(
      porta.gravarSgh(ctxA, trilha('meta_contratual_sus'), (g) =>
        g.incluirMeta({ entrada: { ...META_QUALI, formato: 7 }, usuario: 'teste', contrato, chave: 'f22-0203-meta-3' }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
  });

  it('a apuração do período é registrada e corrigida pela versão; a leitura devolve as duas competências', async () => {
    const base = {
      meta: metaQuali,
      competencia: '202603',
      inicioPeriodo: '202601',
      metaPeriodo: 85,
      realizado: 90,
      cumprimentoPct: 105.88,
      escore: 4 as const,
      origem: 'informado' as const,
      observacao: null,
      usuario: 'teste',
    };
    const r = await porta.gravarSgh(ctxA, trilha('afericao_meta_sus'), (g) =>
      g.registrarApuracao({ ...base, chave: 'f22-0203-apuracao-1' }),
    );
    const c = await porta.gravarSgh(ctxA, trilha('afericao_meta_sus'), async (g) => {
      const atual = await g.apuracao(metaQuali, '202603');
      expect(atual?.id).toBe(r.id);
      return g.corrigirApuracao({ ...base, realizado: 70, cumprimentoPct: 82.35, escore: 2, id: r.id, versaoVista: 1 });
    });
    expect(c.versao).toBe(2);
    const a = await porta.apuracoes(ctxA, [metaQuali, metaQuanti]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      meta: metaQuali,
      competencia: '202603',
      inicioPeriodo: '202601',
      realizado: 70,
      escore: 2,
      origem: 'informado',
      versao: 2,
    });
    const linha = await ler(
      `SELECT a.situacao, es.codigo AS escore FROM afericao_meta_sus a
         JOIN dominio_contratualizacao_sus es ON es.id = a.escore_dominio_contratualizacao_sus_id WHERE a.id = ?`,
      [r.id],
    );
    expect(linha).toMatchObject({ situacao: 'apurada', escore: 'regular' });
  });

  it('outro estabelecimento não vê o contrato nem as metas', async () => {
    expect(await porta.contrato(ctxB, contrato)).toBeNull();
    expect(await porta.metas(ctxB, contrato)).toEqual([]);
    expect(await porta.apuracoes(ctxB, [metaQuali])).toEqual([]);
    expect((await porta.contratos(ctxB)).itens).toEqual([]);
  });

  it('encerra o contrato com o motivo na trilha; a produção do faturamento SUS lê sem linhas', async () => {
    const r = await porta.gravarSgh(ctxA, trilha('contrato_gestor_sus'), (g) =>
      g.encerrarContrato({ id: contrato, versaoVista: versaoContrato, motivo: 'Fim do convênio de teste', usuario: 'teste' }),
    );
    expect(r.versao).toBe(versaoContrato + 1);
    expect((await porta.contrato(ctxA, contrato))?.situacao).toBe('encerrado');
    const t = await ler(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'contrato_gestor_sus' AND entidade_id = ? AND correlacao = ? ORDER BY id DESC LIMIT 1",
      [contrato, correlacao],
    );
    expect(t?.['motivo']).toBe('Fim do convênio de teste');
    expect(await porta.producaoFaturamentoSus(ctxA, '202601', '202612')).toEqual([]);
    await expect(porta.producaoContasSus()).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
  });
});
