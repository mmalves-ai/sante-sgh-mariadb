// Contrato de efeito do cadastro do antibiograma e da cultura pela digitação (F7, 05-SADT linha 12) no MariaDB do
// cliente de teste. Massa SINTÉTICA: a do SADT (exame pedido ainda sem resultado) com germe, antimicrobianos e material.
// Prova o que fica no banco: o painel criado com os itens na ordem do laudo e o padrão do germe; a alteração que
// reordena, retira um item por exclusão lógica e o traz de volta; o conflito de versão; o ponto de corte criado; a versão
// nova da norma que encerra a anterior na véspera; a recusa da versão que começaria antes; a cultura gravada pelo exame
// pedido, que abre o resultado em digitação e interpreta pelo ponto vigente; o ponto usado que não muda (só encerra).
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoCadastroMicrobiologia } from './microbiologia-cadastro-propria.js';
import { ServicoMicrobiologia } from './microbiologia-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
};

describe.skipIf(SEM_BANCO)('cadastro do antibiograma e cultura pela digitação (MariaDB)', () => {
  const nucleo = new NucleoProprio();
  const cad = new ServicoCadastroMicrobiologia(nucleo);
  const micro = new ServicoMicrobiologia(nucleo);
  let m: MassaSadt | null = null;
  const marca = `MC${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const ids = { material: 0, germe: 0, am1: 0, am2: 0, am3: 0, painel: 0, ponto1: 0, ponto2: 0, cultura: 0 };
  const ler = { cliente: CLIENTE, correlacao: 't-micro-cad' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ler, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) => nucleo.lerSomente(ler, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    m = await montarMassaSadt(nucleo, 'MC');
    await nucleo.escrever(ler, async (e) => {
      const agora = new Date();
      ids.material = Number(
        (await e.uma<{ id: number }>("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []))!.id,
      );
      ids.germe = await e.inserir(
        "INSERT INTO microrganismo (codigo, descricao, grupo, criado_em) VALUES (?, ?, 'bacteria', ?)",
        [marca, `GERME SINTETICO ${marca}`, agora],
      );
      const am = (k: number) =>
        e.inserir('INSERT INTO antimicrobiano (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
          `${marca}-${k}`,
          `DROGA SINTETICA ${k}`,
          agora,
        ]);
      ids.am1 = await am(1);
      ids.am2 = await am(2);
      ids.am3 = await am(3);
    });
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever(ler, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          'DELETE rs FROM resultado_sensibilidade rs JOIN isolado_microbiano im ON im.id = rs.isolado_microbiano_id WHERE im.resultado_cultura_id = ?',
          [ids.cultura],
        );
        await x('DELETE FROM isolado_microbiano WHERE resultado_cultura_id = ?', [ids.cultura]);
        await x('DELETE FROM resultado_cultura WHERE id = ?', [ids.cultura]);
        await x('DELETE FROM ponto_corte_antimicrobiano WHERE microrganismo_id = ?', [ids.germe]);
        await x('UPDATE microrganismo SET painel_antibiograma_id = NULL WHERE id = ?', [ids.germe]);
        await x('DELETE FROM painel_antibiograma_item WHERE painel_antibiograma_id = ?', [ids.painel]);
        await x('DELETE FROM painel_antibiograma WHERE id = ?', [ids.painel]);
        await x('DELETE FROM microrganismo WHERE id = ?', [ids.germe]);
        await x('DELETE FROM antimicrobiano WHERE codigo LIKE ?', [`${marca}-%`]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  const itensDoPainel = () =>
    todos(
      `SELECT antimicrobiano_id AS am, sequencia, liberacao_restrita AS restrita, excluido_em IS NOT NULL AS fora
         FROM painel_antibiograma_item WHERE painel_antibiograma_id = ? ORDER BY fora, sequencia`,
      [ids.painel],
    ).then((rs) =>
      rs.map((r) => [Number(r['am']), Number(r['sequencia']), Number(r['restrita']), Number(r['fora'])]),
    );

  it('cria o painel com os itens na ordem do laudo e o torna padrão do germe', async () => {
    const r = await cad.gravarPainel(contexto(m!), null, {
      codigo: marca,
      descricao: `PAINEL SINTETICO ${marca}`,
      microrganismo: ids.germe,
      metodo: 'concentracao_inibitoria',
      norma: 'brcast',
      padraoDoMicrorganismo: true,
      itens: [
        { antimicrobiano: ids.am1 },
        { antimicrobiano: ids.am2, liberacaoRestrita: true, indicaMultirresistencia: true },
        { antimicrobiano: ids.am3 },
      ],
    });
    ids.painel = r.id;
    expect([r.itens, r.retirados, r.padrao]).toEqual([3, 0, true]);
    const p = await um('SELECT norma_referencia, versao FROM painel_antibiograma WHERE id = ?', [ids.painel]);
    expect(p?.['norma_referencia']).toBe('BrCAST');
    expect(await itensDoPainel()).toEqual([
      [ids.am1, 1, 0, 0],
      [ids.am2, 2, 1, 0],
      [ids.am3, 3, 0, 0],
    ]);
    const g = await um('SELECT painel_antibiograma_id FROM microrganismo WHERE id = ?', [ids.germe]);
    expect(Number(g?.['painel_antibiograma_id'])).toBe(ids.painel);
    const t = await um(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'painel_antibiograma' AND entidade_id = ?",
      [ids.painel],
    );
    expect(Number(t?.['q'])).toBeGreaterThanOrEqual(1);
  });

  it('reordena, retira por exclusão lógica, traz de volta e recusa a versão velha e o painel só de restritos', async () => {
    const base = {
      codigo: marca,
      descricao: `PAINEL SINTETICO ${marca}`,
      microrganismo: ids.germe,
      metodo: 'concentracao_inibitoria',
      norma: 'BrCAST',
    };
    await cad.gravarPainel(contexto(m!), ids.painel, {
      ...base,
      versao: 1,
      itens: [{ antimicrobiano: ids.am3 }, { antimicrobiano: ids.am1 }],
    });
    expect(await itensDoPainel()).toEqual([
      [ids.am3, 1, 0, 0],
      [ids.am1, 2, 0, 0],
      [ids.am2, 30001, 1, 1],
    ]);
    expect(
      await codigoDe(
        cad.gravarPainel(contexto(m!), ids.painel, {
          ...base,
          versao: 1,
          itens: [{ antimicrobiano: ids.am1 }],
        }),
      ),
    ).toBe('conflito-versao');
    expect(
      await codigoDe(
        cad.gravarPainel(contexto(m!), ids.painel, {
          ...base,
          versao: 2,
          itens: [{ antimicrobiano: ids.am1, liberacaoRestrita: true }],
        }),
      ),
    ).toBe('painel-so-restritos');
    await cad.gravarPainel(contexto(m!), ids.painel, {
      ...base,
      versao: 2,
      itens: [
        { antimicrobiano: ids.am1 },
        { antimicrobiano: ids.am2, liberacaoRestrita: true, indicaMultirresistencia: true },
        { antimicrobiano: ids.am3 },
      ],
    });
    expect(await itensDoPainel()).toEqual([
      [ids.am1, 1, 0, 0],
      [ids.am2, 2, 1, 0],
      [ids.am3, 3, 0, 0],
    ]);
  });

  const ponto = (extra: Record<string, unknown> = {}) => ({
    microrganismo: ids.germe,
    antimicrobiano: ids.am1,
    metodo: 'concentracao_inibitoria',
    norma: 'BrCAST',
    versaoNorma: '2024',
    sensivelAte: 1,
    resistenteAcima: 4,
    vigenciaInicio: '2024-01-01',
    ...extra,
  });

  it('cria o ponto; a versão nova da norma encerra a anterior na véspera; a que começaria antes recusa', async () => {
    ids.ponto1 = (await cad.criarPonto(contexto(m!), ponto())).id;
    expect(await codigoDe(cad.criarPonto(contexto(m!), ponto({ sensivelAte: 9, resistenteAcima: 2 })))).toBe(
      'ponto-limites-invertidos',
    );
    expect(await codigoDe(cad.criarPonto(contexto(m!), ponto({ vigenciaInicio: '2025-01-01' })))).toBe(
      'versao-norma-repetida',
    );
    const r = await cad.criarPonto(
      contexto(m!),
      ponto({ versaoNorma: '2026', sensivelAte: 0.5, resistenteAcima: 2, vigenciaInicio: '2026-01-01' }),
    );
    ids.ponto2 = r.id;
    expect(r.encerrados).toEqual([ids.ponto1]);
    const a = await um(
      'SELECT DATE_FORMAT(vigencia_fim, "%Y-%m-%d") AS fim FROM ponto_corte_antimicrobiano WHERE id = ?',
      [ids.ponto1],
    );
    expect(a?.['fim']).toBe('2025-12-31');
    expect(
      await codigoDe(
        cad.criarPonto(contexto(m!), ponto({ versaoNorma: '2023', vigenciaInicio: '2023-01-01' })),
      ),
    ).toBe('vigencia-sobreposta');
    const lista = await cad.pontos(contexto(m!), { microrganismo: ids.germe });
    expect(lista.map((p) => [p.id, p.versaoNorma, p.emUso])).toEqual([
      [ids.ponto2, '2026', false],
      [ids.ponto1, '2024', false],
    ]);
  });

  it('a cultura pelo exame pedido abre o resultado em digitação e interpreta pelo ponto vigente', async () => {
    const antes = await micro.culturaDoExame(contexto(m!), m!.itemLab2);
    expect(antes).toEqual({ resultado: null, cultura: null });
    const r = await micro.registrar(
      contexto(m!),
      { exameItem: m!.itemLab2 },
      {
        material: ids.material,
        crescimento: 'com_crescimento',
        isolados: [{ sequencia: 1, microrganismo: ids.germe, testes: [{ antimicrobiano: ids.am1, cim: 1 }] }],
      },
    );
    ids.cultura = r.id;
    const depois = await micro.culturaDoExame(contexto(m!), m!.itemLab2);
    expect(depois.resultado).not.toBeNull();
    const re = await um('SELECT situacao, paciente_id FROM resultado_exame WHERE id = ?', [depois.resultado]);
    expect(re?.['situacao']).toBe('em_digitacao');
    // CIM 1 com o ponto de 2026 (sensível até 0,5; resistente acima de 2): faixa média, sensível aumentando a exposição.
    expect(depois.cultura?.isolados[0]?.testes.map((t) => [t.interpretacao, t.pontoCorte])).toEqual([
      ['sensivel_dose_dependente', ids.ponto2],
    ]);
    expect(depois.cultura?.situacao).toBe('parcial');
    // A segunda gravação pelo exame reaproveita o resultado (não abre outro) e exige a versão lida.
    expect(
      await codigoDe(
        micro.registrar(
          contexto(m!),
          { exameItem: m!.itemLab2 },
          { material: ids.material, crescimento: 'em_andamento' },
        ),
      ),
    ).toBe('conflito-versao');
    const q = await um('SELECT COUNT(*) AS q FROM resultado_exame WHERE exame_item_id = ?', [m!.itemLab2]);
    expect(Number(q?.['q'])).toBe(1);
  });

  it('o ponto usado não muda: só encerra; o ainda não usado aceita a correção', async () => {
    const lido = (await cad.pontos(contexto(m!), { microrganismo: ids.germe })).find(
      (p) => p.id === ids.ponto2,
    )!;
    expect(lido.emUso).toBe(true);
    expect(
      await codigoDe(
        cad.alterarPonto(contexto(m!), ids.ponto2, {
          ...ponto({
            versaoNorma: '2026',
            sensivelAte: 0.25,
            resistenteAcima: 2,
            vigenciaInicio: '2026-01-01',
          }),
          versao: lido.versao,
        }),
      ),
    ).toBe('ponto-em-uso');
    expect(
      await codigoDe(
        cad.encerrarPonto(contexto(m!), ids.ponto2, { versao: lido.versao, vigenciaFim: '2025-01-01' }),
      ),
    ).toBe('vigencia-invertida');
    await cad.encerrarPonto(contexto(m!), ids.ponto2, { versao: lido.versao, vigenciaFim: '2026-12-31' });
    const p = await um(
      'SELECT DATE_FORMAT(vigencia_fim, "%Y-%m-%d") AS fim, sensivel_ate FROM ponto_corte_antimicrobiano WHERE id = ?',
      [ids.ponto2],
    );
    expect([p?.['fim'], Number(p?.['sensivel_ate'])]).toEqual(['2026-12-31', 0.5]);
    // O ponto ainda não usado aceita a correção.
    const velho = (await cad.pontos(contexto(m!), { microrganismo: ids.germe })).find(
      (x) => x.id === ids.ponto1,
    )!;
    await cad.alterarPonto(contexto(m!), ids.ponto1, {
      ...ponto({ sensivelAte: 2, vigenciaFim: '2025-12-31' }),
      versao: velho.versao,
    });
    const c = await um('SELECT sensivel_ate FROM ponto_corte_antimicrobiano WHERE id = ?', [ids.ponto1]);
    expect(Number(c?.['sensivel_ate'])).toBe(2);
  });
});
