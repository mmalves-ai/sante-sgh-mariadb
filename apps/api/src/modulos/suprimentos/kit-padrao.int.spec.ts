// Contrato de efeito do kit padrão (F3.6, 05-SUP linha 13) contra o MariaDB real (cliente de teste do lote, massa
// SINTÉTICA, nenhuma pessoa real). Pelo Executor: inclui o kit com a composição e o vínculo à cirurgia (unidade do
// estoque do insumo, trilha e outbox), altera a quantidade, tira um item (marca de exclusão, nada apagado) e o devolve
// (a mesma linha volta), troca o vínculo, recusa o código repetido, o insumo inativo, o segundo kit padrão do mesmo
// procedimento e a versão velha, e repete a mesma chave sem gravar de novo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
const PROC = 'F36KITPROC';
let k = 0;

describe.skipIf(SEM_BANCO)('kit padrão na porta própria (MariaDB, cliente de teste do lote)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let proc = 0;
  let proc2 = 0;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-kit' }, (l) => l.consultar<T>(sql, p));
  const op = (entrada: unknown, chave = `f36kit-${RODADA}-${++k}`) =>
    porta.executar(c, 'suprimentos.gravarKitPadrao', entrada, { ...c, chaveIdempotencia: chave });

  const limparKits = async (e: Escritor) => {
    const kits = 'SELECT id FROM kit_material WHERE estabelecimento_id IN (?, ?)';
    for (const t of ['kit_material_procedimento', 'kit_material_item'])
      await e.executar(`DELETE FROM ${t} WHERE kit_material_id IN (${kits})`, [m.estA, m.estB]);
    await e.executar(
      'DELETE FROM kit_material_procedimento WHERE procedimento_cirurgico_id IN (SELECT id FROM procedimento_cirurgico WHERE codigo LIKE ?)',
      [`${PROC}%`],
    );
    await e.executar(
      'DELETE FROM kit_material WHERE estabelecimento_id IN (?, ?) AND id NOT IN (SELECT kit_material_id FROM kit_rastreavel WHERE kit_material_id IS NOT NULL)',
      [m.estA, m.estB],
    );
    await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', [`${PROC}%`]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'f36-kit') } as ContextoSuprimentos;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-kit' }, async (e) => {
      await limparKits(e);
      const agora = new Date();
      proc = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${PROC}1`, 'CIRURGIA SINTETICA F36 UM', agora],
      );
      proc2 = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${PROC}2`, 'CIRURGIA SINTETICA F36 DOIS', agora],
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      if (m) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-kit' }, (e) => limparKits(e));
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  const kit = (extra: Record<string, unknown> = {}) => ({
    codigo: `KP-${RODADA}`.slice(0, 30),
    nome: 'KIT SINTETICO CURATIVO',
    tipo: 'procedimento',
    permiteQuantidadeAcima: false,
    permiteSimilar: true,
    observacao: null,
    ativo: true,
    itens: [
      { insumo: m.insumo, quantidade: 2, obrigatorioRastreavel: false, permiteSubstituto: false },
      { insumo: m.insumoOpme, quantidade: 1, obrigatorioRastreavel: false, permiteSubstituto: true },
    ],
    procedimentos: [{ procedimentoCirurgico: proc, itemFaturavel: null, quantidadeKits: 1, padrao: true }],
    ...extra,
  });

  it('inclui, altera, tira e devolve item, troca o vínculo, sem apagar nada; trilha, outbox e idempotência', async () => {
    const chave = `f36kit-${RODADA}-inclui`;
    const r = await op(kit(), chave);
    const id = Number(r.resultado['kit']);
    expect(id).toBeGreaterThan(0);
    expect((await op(kit(), chave)).repetida).toBe(true);
    const itens = () =>
      ler<{ id: unknown; insumo_id: unknown; quantidade: unknown; unidade_medida_id: unknown; ex: unknown }>(
        `SELECT id, insumo_id, quantidade, unidade_medida_id, excluido_em IS NOT NULL AS ex
           FROM kit_material_item WHERE kit_material_id = ? ORDER BY sequencia`,
        [id],
      );
    const i1 = await itens();
    expect(i1.map((x) => [Number(x.insumo_id), Number(x.quantidade), Number(x.ex)])).toEqual([
      [m.insumo, 2, 0],
      [m.insumoOpme, 1, 0],
    ]);
    const [un] = await ler<{ u: unknown }>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [
      m.insumo,
    ]);
    expect(Number(i1[0]?.unidade_medida_id)).toBe(Number(un?.u));
    const [t] = await ler<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'kit_material' AND entidade_id = ?",
      [id],
    );
    expect(Number(t?.n)).toBeGreaterThan(0);
    const [o] = await ler<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'suprimentos.gravar_kit_padrao' AND estabelecimento_id = ?",
      [m.estA],
    );
    expect(Number(o?.n)).toBeGreaterThan(0);

    // Altera a quantidade e tira o segundo item: a linha fica, com a marca de exclusão.
    const r2 = await op(
      kit({
        kit: id,
        versao: 1,
        itens: [{ insumo: m.insumo, quantidade: 3, obrigatorioRastreavel: true, permiteSubstituto: false }],
        procedimentos: [
          { procedimentoCirurgico: proc2, itemFaturavel: null, quantidadeKits: 2, padrao: false },
        ],
      }),
    );
    expect(r2.resultado).toMatchObject({ entram: 0, mudam: 1, saem: 1, vinculados: 1, desvinculados: 1 });
    const i2 = await itens();
    expect(i2.map((x) => [Number(x.insumo_id), Number(x.quantidade), Number(x.ex)])).toEqual([
      [m.insumo, 3, 0],
      [m.insumoOpme, 1, 1],
    ]);
    const vinc = await ler<{ p: unknown; ex: unknown; q: unknown }>(
      'SELECT procedimento_cirurgico_id AS p, excluido_em IS NOT NULL AS ex, quantidade_kits AS q FROM kit_material_procedimento WHERE kit_material_id = ? ORDER BY id',
      [id],
    );
    expect(vinc.map((x) => [Number(x.p), Number(x.ex), Number(x.q)])).toEqual([
      [proc, 1, 1],
      [proc2, 0, 2],
    ]);

    // Devolve o item: a mesma linha volta (nada duplicado).
    await op(kit({ kit: id, versao: 2 }));
    const i3 = await itens();
    expect(i3.length).toBe(2);
    expect(i3.map((x) => [Number(x.id), Number(x.ex)])).toEqual(i2.map((x) => [Number(x.id), 0]));

    // A leitura do cadastro mostra só o que vale.
    const cad = (await porta.kitsPadraoCadastro(c)).find((x) => x.id === id);
    expect(cad?.versao).toBe(3);
    expect(cad?.itens.map((x) => x.insumo)).toEqual([m.insumo, m.insumoOpme]);
    expect(cad?.procedimentos.map((x) => x.procedimentoCirurgico).sort()).toEqual([proc, proc2].sort());
    expect((await porta.procedimentosKit(c, 'CIRURGIA SINTETICA F36')).length).toBeGreaterThanOrEqual(2);

    // Inativa o kit: ele continua no cadastro (nunca é apagado).
    await op(kit({ kit: id, versao: 3, ativo: false, procedimentos: [] }));
    expect((await porta.kitsPadraoCadastro(c)).find((x) => x.id === id)?.ativo).toBe(false);
    const [kt] = await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM kit_material WHERE id = ?', [id]);
    expect(Number(kt?.n)).toBe(1);
  });

  it('recusas antes de gravar: código repetido, insumo inativo, segundo padrão, versão velha e regra do domínio', async () => {
    const a = await op(kit({ codigo: `KA-${RODADA}`.slice(0, 30) }));
    const id = Number(a.resultado['kit']);
    expect(await codigoDe(op(kit({ codigo: `KA-${RODADA}`.slice(0, 30) })))).toBe('kit-codigo-duplicado');
    expect(
      await codigoDe(
        op(
          kit({
            codigo: `KB-${RODADA}`.slice(0, 30),
            itens: [
              {
                insumo: m.insumoInativo,
                quantidade: 1,
                obrigatorioRastreavel: false,
                permiteSubstituto: false,
              },
            ],
          }),
        ),
      ),
    ).toBe('referencia-inexistente');
    expect(await codigoDe(op(kit({ codigo: `KC-${RODADA}`.slice(0, 30) })))).toBe('kit-padrao-duplicado');
    expect(await codigoDe(op(kit({ codigo: `KA-${RODADA}`.slice(0, 30), kit: id, versao: 9 })))).toBe(
      'conflito-versao',
    );
    expect(await codigoDe(op(kit({ codigo: `KD-${RODADA}`.slice(0, 30), itens: [] })))).toBe('kit-sem-itens');
    const [n] = await ler<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM kit_material WHERE estabelecimento_id = ? AND codigo IN (?, ?, ?)',
      [m.estA, `KB-${RODADA}`, `KC-${RODADA}`, `KD-${RODADA}`],
    );
    expect(Number(n?.n)).toBe(0);
    // Outro estabelecimento não enxerga nem altera o kit.
    const cB = { ...contexto(m, m.estB, 'f36-kit-b') } as ContextoSuprimentos;
    expect((await porta.kitsPadraoCadastro(cB)).some((x) => x.id === id)).toBe(false);
    expect(
      await codigoDe(
        porta.executar(cB, 'suprimentos.gravarKitPadrao', kit({ kit: id, versao: 1, procedimentos: [] }), {
          ...cB,
          chaveIdempotencia: `f36kit-${RODADA}-b`,
        }),
      ),
    ).toBe('kit-inexistente');
  });
});
