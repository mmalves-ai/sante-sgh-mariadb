// Contrato de efeito dos parâmetros, preferências e alçada do faturamento (F3.7, 06-FAT linha 38) contra o MariaDB real.
// Massa SINTÉTICA com códigos "C135" (nenhuma pessoa real): o catálogo tipado faturamento.* carregado (lote 95); a
// preferência do faturista gravada na própria conta (parametro_valor nível usuário com histórico; a troca fecha a
// vigência anterior e não apaga); valor fora do tipo recusado sem gravar; parâmetro da rede recusado como preferência;
// a precedência estabelecimento > rede; a rotina diária lendo faturamento.rotinaDiaria e a hora de início do
// estabelecimento; a alçada por faixa de valor e cargo com quem pede não aprovando. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  type Escritor,
  ErroOperacao,
  type Executor,
  NucleoProprio,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoParametrosFaturamento } from './parametros-faturamento.controller.js';
import {
  conferirAlcadaFaturamentoNoBanco,
  lerParametrosFaturamento,
} from './parametros-faturamento-propria.js';
import { cicloRotinaDiaria } from './rotina-diaria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C135';
type Linha = Record<string, unknown>;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema.type ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('parâmetros, preferências e alçada do faturamento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoParametrosFaturamento;
  const ids: Record<string, number> = {};
  const op = (usuario = ids['faturista'] as number): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario,
    correlacao: 'teste-c135',
    chaveIdempotencia: `c135-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: null,
    correlacao: 'teste-c135',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c135' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Linha>(sql, p));
  const usuarios = () => [ids['faturista'], ids['supervisor'], ids['auxiliar']];

  const limpar = async (e: Escritor) => {
    const us = usuarios();
    await e.executar(
      `DELETE h FROM parametro_valor_historico h JOIN parametro_valor v ON v.id = h.parametro_valor_id
        WHERE v.usuario_id IN (?, ?, ?) OR v.estabelecimento_id = ?`,
      [...us, ids['est']],
    );
    await e.executar('DELETE FROM parametro_valor WHERE usuario_id IN (?, ?, ?) OR estabelecimento_id = ?', [
      ...us,
      ids['est'],
    ]);
    await e.executar(
      'DELETE nv FROM alcada_aprovacao_nivel nv JOIN alcada_aprovacao a ON a.id = nv.alcada_aprovacao_id WHERE a.estabelecimento_id = ?',
      [ids['est']],
    );
    await e.executar('DELETE FROM alcada_aprovacao WHERE estabelecimento_id = ?', [ids['est']]);
    await e.executar('DELETE FROM usuario_perfil WHERE estabelecimento_id = ?', [ids['est']]);
  };
  const valorEstab = (e: Escritor, chave: string, valor: string) =>
    e.executar(
      `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio, criado_em)
       SELECT id, 'estabelecimento', ?, ?, NOW(3) - INTERVAL 1 SECOND, NOW(3) FROM parametro_definicao WHERE chave = ?`,
      [ids['est'], valor, chave],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    s = new ServicoParametrosFaturamento(nucleo);
    await escrever(async (e) => {
      const agora = new Date();
      ids['est'] = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      for (const u of ['faturista', 'supervisor', 'auxiliar'])
        ids[u] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [`c135.${u}`],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [`c135.${u}`, `USUARIO SINTETICO ${P} ${u}`, agora],
        );
      for (const p of ['FAT1', 'FAT2'])
        ids[p] = await garantir(
          e,
          'SELECT id FROM perfil_acesso WHERE codigo = ?',
          [`${P}${p}`],
          'INSERT INTO perfil_acesso (codigo, nome, criado_em) VALUES (?, ?, ?)',
          [`${P}${p}`, `PERFIL SINTETICO ${P} ${p}`, agora],
        );
      await limpar(e);
    });
  }, 60_000);

  afterAll(async () => {
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est'] as number] });
    });
    await nucleo.encerrar();
  });

  it('o catálogo tipado do faturamento está carregado (lote 95)', async () => {
    const r = await linhas(
      `SELECT chave, tipo, permite_usuario FROM parametro_definicao WHERE chave LIKE 'faturamento.%' ORDER BY chave`,
      [],
    );
    expect(r.length).toBe(7);
    expect(r.filter((x) => Number(x['permite_usuario']) === 1).map((x) => x['chave'])).toEqual([
      'faturamento.preferencia.agruparPorPaciente',
      'faturamento.preferencia.itensPorPagina',
      'faturamento.preferencia.telaInicial',
    ]);
    const t = await linhas(
      `SELECT COUNT(*) AS n FROM tipo_documento_aprovacao WHERE codigo LIKE 'fat\\_%'`,
      [],
    );
    expect(Number(t[0]!['n'])).toBe(3);
  });

  it('preferência do faturista: grava na própria conta, troca fecha a vigência e guarda o histórico', async () => {
    const r1 = await s.gravarPreferencias(op(), {
      preferencias: {
        'faturamento.preferencia.telaInicial': 'glosas',
        'faturamento.preferencia.itensPorPagina': '100',
      },
    });
    expect(r1['gravados']).toBe('faturamento.preferencia.telaInicial,faturamento.preferencia.itensPorPagina');
    await s.gravarPreferencias(op(), { preferencias: { 'faturamento.preferencia.telaInicial': 'guias' } });
    const v = await linhas(
      `SELECT d.chave, v.nivel, v.valor, v.vigencia_fim IS NULL AS vigente, v.criado_por
         FROM parametro_valor v JOIN parametro_definicao d ON d.id = v.parametro_definicao_id
        WHERE v.usuario_id = ? ORDER BY v.id`,
      [ids['faturista']],
    );
    expect(v.map((x) => [x['chave'], x['nivel'], x['valor'], Number(x['vigente'])])).toEqual([
      ['faturamento.preferencia.telaInicial', 'usuario', 'glosas', 0],
      ['faturamento.preferencia.itensPorPagina', 'usuario', '100', 1],
      ['faturamento.preferencia.telaInicial', 'usuario', 'guias', 1],
    ]);
    expect(v.every((x) => Number(x['criado_por']) === ids['faturista'])).toBe(true);
    const h = await linhas(
      `SELECT h.operacao, h.valor_anterior, h.valor_novo, h.usuario_id FROM parametro_valor_historico h
         JOIN parametro_valor v ON v.id = h.parametro_valor_id WHERE v.usuario_id = ? ORDER BY h.id`,
      [ids['faturista']],
    );
    expect(h.map((x) => [x['operacao'], x['valor_anterior'], x['valor_novo']])).toEqual([
      ['inclusao', null, 'glosas'],
      ['inclusao', null, '100'],
      ['alteracao', 'glosas', 'guias'],
    ]);
    const lidos = await s.ler(ctxL(), (l, est) =>
      lerParametrosFaturamento(l, est, ids['faturista'] as number),
    );
    expect(lidos.preferencias).toEqual({
      telaInicial: 'guias',
      itensPorPagina: 100,
      agruparPorPaciente: true,
    });
    // A preferência de um não vaza para outro usuário.
    const outro = await s.ler(ctxL(), (l, est) =>
      lerParametrosFaturamento(l, est, ids['auxiliar'] as number),
    );
    expect(outro.preferencias.telaInicial).toBe('contas');
  });

  it('recusa valor fora do tipo e parâmetro da rede como preferência, sem gravar', async () => {
    const antes = await linhas('SELECT COUNT(*) AS n FROM parametro_valor WHERE usuario_id = ?', [
      ids['faturista'],
    ]);
    expect(
      await codigoDo(
        s.gravarPreferencias(op(), { preferencias: { 'faturamento.preferencia.itensPorPagina': '5' } }),
      ),
    ).toBe('preferencia-invalida');
    expect(
      await codigoDo(s.gravarPreferencias(op(), { preferencias: { 'faturamento.rotinaDiaria': 'false' } })),
    ).toBe('preferencia-invalida');
    const depois = await linhas('SELECT COUNT(*) AS n FROM parametro_valor WHERE usuario_id = ?', [
      ids['faturista'],
    ]);
    expect(Number(depois[0]!['n'])).toBe(Number(antes[0]!['n']));
  });

  it('parâmetro do estabelecimento vence o padrão; a rotina diária lê ligada e hora de início', async () => {
    const chamados: number[] = [];
    const executor = {
      executar: async (_op: unknown, _c: string, _e: unknown, ctx: ContextoOperacao) => {
        chamados.push(Number(ctx.estabelecimento));
        return { resultado: {} };
      },
    } as unknown as Executor;
    const est = ids['est'] as number;
    // 13h UTC = 10h em São Paulo.
    const agora = new Date('2026-11-25T13:00:00Z');
    await escrever((e) => valorEstab(e, 'faturamento.rotinaDiaria', 'false'));
    await cicloRotinaDiaria(nucleo, CLIENTE, new Map(), agora, executor);
    expect(chamados.includes(est)).toBe(false);
    await escrever(async (e) => {
      await e.executar(
        `UPDATE parametro_valor SET vigencia_fim = NOW(3) WHERE estabelecimento_id = ? AND vigencia_fim IS NULL`,
        [est],
      );
      await valorEstab(e, 'faturamento.rotinaDiaria', 'true');
      await valorEstab(e, 'faturamento.rotinaDiariaHora', '11');
      await valorEstab(e, 'faturamento.prazoRecursoGlosaDias', '60');
    });
    const p = await s.ler(ctxL(), (l, e) => lerParametrosFaturamento(l, e, null));
    expect(p.parametros).toEqual({
      rotinaDiaria: true,
      rotinaDiariaHora: 11,
      prazoRecursoGlosaDias: 60,
      fechamentoDiaLimite: 5,
    });
    chamados.length = 0;
    await cicloRotinaDiaria(nucleo, CLIENTE, new Map(), agora, executor);
    expect(chamados.includes(est)).toBe(false);
    chamados.length = 0;
    await cicloRotinaDiaria(nucleo, CLIENTE, new Map(), new Date('2026-11-25T14:30:00Z'), executor);
    expect(chamados.includes(est)).toBe(true);
  });

  it('alçada: faixa por valor e cargo; quem pede não aprova; sem cargo na alçada, recusa', async () => {
    await escrever(async (e) => {
      const agora = new Date();
      const tipo = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_documento_aprovacao WHERE codigo = 'fat_aceite_glosa'",
        [],
      );
      const a = await e.inserir(
        `INSERT INTO alcada_aprovacao (estabelecimento_id, tipo_documento_aprovacao_id, descricao, quantidade_niveis,
           vigencia_inicio, criado_em) VALUES (?, ?, ?, 2, '2026-01-01', ?)`,
        [ids['est'], Number(tipo!.id), `ALCADA ${P}`, agora],
      );
      await e.executar(
        `INSERT INTO alcada_aprovacao_nivel (alcada_aprovacao_id, sequencia, nivel, perfil_acesso_id,
           valor_unitario_minimo, valor_unitario_maximo, criado_em) VALUES (?, 1, 1, ?, 0, 1000, ?), (?, 2, 2, ?, 0, NULL, ?)`,
        [a, ids['FAT1'], agora, a, ids['FAT2'], agora],
      );
      await e.executar(
        `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?), (?, ?, ?, '2026-01-01', ?)`,
        [ids['faturista'], ids['FAT1'], ids['est'], agora, ids['supervisor'], ids['FAT2'], ids['est'], agora],
      );
    });
    const conferir = (valor: number, solicitante: string, decisor: string) =>
      s.ler(ctxL(), (l, est) =>
        conferirAlcadaFaturamentoNoBanco(
          l,
          est,
          'fat_aceite_glosa',
          valor,
          ids[solicitante] as number,
          ids[decisor] as number,
          '2026-11-25',
        ),
      );
    expect(await conferir(500, 'auxiliar', 'faturista')).toEqual({ pode: true, nivel: 1, motivo: null });
    const acima = await conferir(5000, 'auxiliar', 'faturista');
    expect(acima.pode).toBe(false);
    expect(acima.motivo).toMatch(/passa a sua alçada/);
    expect(await conferir(5000, 'auxiliar', 'supervisor')).toEqual({ pode: true, nivel: 2, motivo: null });
    expect((await conferir(5000, 'supervisor', 'supervisor')).motivo).toMatch(/Quem pede não aprova/);
    expect((await conferir(10, 'faturista', 'auxiliar')).motivo).toMatch(/não está na alçada/);
    expect(
      await codigoDo(s.ler(ctxL(), (l, est) => conferirAlcadaFaturamentoNoBanco(l, est, 'outro', 1, 1, 2))),
    ).toBe('documento-invalido');
  });
});
