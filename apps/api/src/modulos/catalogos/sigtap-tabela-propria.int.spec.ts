// Tabela unificada do SUS por competência no MariaDB real (06-SUS L50; cliente f22_o3; massa SINTÉTICA de
// procedimentos 99999911xx, nenhuma pessoa). Contrato de leitura: o histórico do procedimento traz a competência em
// uso (a carregada marcada vigente em `competencia_sigtap`), as competências carregadas da mais nova para a mais
// antiga e só os pares de `compatibilidade_sigtap` vigentes nela (o encerrado antes fica de fora, um por tipo).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { competenciaEmUso } from '@sgh/dominio-faturamento';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historicoProprio } from './consultas-proprias.js';
import { competenciasSigtapLidas } from './sigtap-tabela-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGOS = ['9999991101', '9999991102', '9999991103', '9999991104'];

describe.skipIf(SEM_BANCO)('tabela unificada do SUS por competência (MariaDB)', () => {
  let nucleo: NucleoProprio;
  const ctx = { cliente: CLIENTE, correlacao: 't-f3711-sigtap' };
  const limpar = async (e: Escritor) => {
    const m = CODIGOS.map(() => '?').join(', ');
    await e.executar(
      `DELETE c FROM compatibilidade_sigtap c JOIN procedimento_sigtap p ON p.id = c.principal_procedimento_sigtap_id
        WHERE p.codigo_sigtap IN (${m})`,
      CODIGOS,
    );
    await e.executar(`DELETE FROM procedimento_sigtap WHERE codigo_sigtap IN (${m})`, CODIGOS);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever(ctx, async (e) => {
      await limpar(e);
      const g = await e.uma<{ id: number }>('SELECT id FROM grupo_sigtap ORDER BY id LIMIT 1');
      const agora = new Date();
      const id: number[] = [];
      for (const c of CODIGOS)
        id.push(
          await e.inserir(
            `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, vigencia_inicio, versao_fonte, criado_em)
             VALUES (?, ?, ?, '2020-01-01', 'teste', ?)`,
            [c, `PROCEDIMENTO SINTETICO ${c.slice(-2)}`, Number(g!.id), agora],
          ),
        );
      for (const [sec, tipo, qtd, ini, fim] of [
        [1, 'compativel', 2, '2020-01-01', null],
        [1, 'compativel', 1, '2019-01-01', '2019-12-31'],
        [2, 'incompativel', null, '2020-01-01', null],
        [3, 'concomitante', null, '2020-01-01', '2020-12-31'],
      ] as const)
        await e.inserir(
          `INSERT INTO compatibilidade_sigtap (principal_procedimento_sigtap_id, compativel_procedimento_sigtap_id,
             tipo_compatibilidade, quantidade_maxima, vigencia_inicio, vigencia_fim, versao_fonte, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'teste', ?)`,
          [id[0], id[sec], tipo, qtd, ini, fim, agora],
        );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever(ctx, limpar);
    await nucleo.encerrar();
  });

  it('competência em uso e competências carregadas lidas do banco próprio', async () => {
    const lidas = await nucleo.lerSomente(ctx, competenciasSigtapLidas);
    const vigentes = await nucleo.lerSomente(ctx, (l) =>
      l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM competencia_sigtap WHERE situacao_carga = 'carregada' AND vigente",
      ),
    );
    expect(lidas.length).toBeGreaterThan(0);
    expect(Number(vigentes?.n)).toBeGreaterThan(0);
    const h = await nucleo.lerSomente(ctx, (l) => historicoProprio(l, CODIGOS[0]!));
    expect(h?.competenciaEmUso).toBe(competenciaEmUso(lidas)?.codigo);
    expect(h?.competenciaEmUso).toMatch(/^\d{6}$/);
    expect(h?.competenciasCarregadas?.map((c) => c.codigo)).toEqual(
      [...lidas].map((c) => c.codigo).sort((a, b) => b.localeCompare(a)),
    );
  });

  it('só os pares vigentes na competência em uso: o encerrado fica de fora, um por tipo', async () => {
    const h = await nucleo.lerSomente(ctx, (l) => historicoProprio(l, CODIGOS[0]!));
    expect(
      h?.compatibilidades?.map((p) => [p.secundario, p.tipo, p.quantidadeMaxima, p.vigenciaFim]),
    ).toEqual([
      ['9999991102', 'compativel', 2, null],
      ['9999991103', 'incompativel', null, null],
    ]);
    expect(h?.compatibilidades?.[0]?.descricao).toBe('PROCEDIMENTO SINTETICO 02');
    const sem = await nucleo.lerSomente(ctx, (l) => historicoProprio(l, CODIGOS[3]!));
    expect(sem?.compatibilidades).toEqual([]);
  });

  it('carga oficial: há pares vigentes na competência em uso (contagem agregada)', async () => {
    const r = await nucleo.lerSomente(ctx, (l) =>
      l.uma<{ n: number }>(
        `SELECT COUNT(*) AS n FROM compatibilidade_sigtap c
          WHERE c.versao_fonte <> 'teste' AND c.vigencia_fim IS NULL`,
      ),
    );
    expect(Number(r?.n)).toBeGreaterThan(0);
  });
});
