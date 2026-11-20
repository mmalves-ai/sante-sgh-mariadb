// M60, etapa 1: peças puras do orquestrador do ensaio (comandos das sessões, impressão completa, disco, relatório).
import { describe, expect, it } from 'vitest';
import { avaliarEsperas, avaliarMon, type ConferenciaCli, vereditoDoEnsaio } from './ensaio-regras.ts';
import {
  conferirEspaco,
  diferencasDasPartes,
  formatarRelatorioEnsaio,
  impressaoCompleta,
  type ResultadoEnsaio,
  sqlAtualizacao,
  sqlLeitura,
  sqlMon,
  sqlTrava,
  TABELAS_DAS_SESSOES,
} from './ensaio-relatorio.ts';

const relCli = (linhas: ConferenciaCli['aplicacao']['linhas']) => ({
  modo: 'aplicar',
  totalMs: 30,
  resultado: 'ok' as const,
  linhas,
  resumo: '',
});
const conferenciaCli: ConferenciaCli = {
  simulacaoAntes: relCli([
    { numero: 1, item: 'a.sql', hash: 'h1', ms: null, resultado: 'a aplicar (1 comando(s))' },
    { numero: 2, item: 'b.sql', hash: 'h2', ms: null, resultado: 'a aplicar (1 comando(s))' },
  ]),
  ordemEsperada: [
    { numero: 1, hash: 'h1' },
    { numero: 2, hash: 'h2' },
  ],
  objetosSghDepoisDaSimulacao: 0,
  aplicacao: relCli([
    { numero: 1, item: 'a.sql', hash: 'h1', ms: 10, resultado: 'aplicado' },
    { numero: 2, item: 'b.sql', hash: 'h2', ms: 20, resultado: 'aplicado' },
  ]),
  papelConcedido: true,
  leituraConcedida: true,
  simulacaoDepois: relCli([]),
  recolhimento: relCli([{ item: 'DROP TABLE SGH_A', ms: 3, resultado: 'removido' }]),
};

describe('comandos das sessões legadas', () => {
  it('leitura e trava só com nomes legados válidos; trava com WITH LOCK, sem UPDATE', () => {
    expect(sqlLeitura('TBCONVEN', 7)).toBe(
      'SELECT COUNT(*) N FROM (SELECT FIRST 200 SKIP 7 1 X FROM TBCONVEN) D',
    );
    expect(sqlTrava('RICADPAC', 3.9)).toBe('SELECT FIRST 1 SKIP 3 1 X FROM RICADPAC WITH LOCK');
    expect(() => sqlTrava('SGH_VERSAO_SCRIPT', 0)).toThrow(/inválido/);
    expect(() => sqlLeitura('X; SELECT 1', 0)).toThrow(/inválido/);
  });

  it('UPDATE da chave no mesmo valor e MON$ só das conexões das sessões', () => {
    expect(sqlAtualizacao('TBCONVEN', 'CODIGO', 2)).toBe(
      'UPDATE TBCONVEN SET CODIGO = CODIGO WHERE CODIGO = (SELECT FIRST 1 SKIP 2 CODIGO FROM TBCONVEN ORDER BY CODIGO)',
    );
    expect(sqlMon([10, 11])).toContain('MON$ATTACHMENT_ID IN (10, 11)');
    expect(() => sqlMon([])).toThrow();
    expect(() => sqlMon([1.5])).toThrow();
  });

  it('as tabelas das sessões são legadas e sem repetição', () => {
    expect(new Set(TABELAS_DAS_SESSOES).size).toBe(TABELAS_DAS_SESSOES.length);
    expect(TABELAS_DAS_SESSOES.some((t) => t.startsWith('SGH_'))).toBe(false);
  });
});

describe('impressão completa', () => {
  const base = { legado: 'abc', objetosSgh: { tabelas: [] }, catalogo: { INDICES: 10, PAPEIS: 2 } };
  it('igual para as mesmas partes, independente da ordem das contagens', () => {
    expect(impressaoCompleta(base)).toBe(
      impressaoCompleta({ ...base, catalogo: { PAPEIS: 2, INDICES: 10 } }),
    );
  });
  it('muda com um índice, um objeto SGH_ ou a parte legada', () => {
    const a = impressaoCompleta(base);
    expect(impressaoCompleta({ ...base, catalogo: { INDICES: 11, PAPEIS: 2 } })).not.toBe(a);
    expect(impressaoCompleta({ ...base, objetosSgh: { tabelas: ['SGH_X'] } })).not.toBe(a);
    expect(impressaoCompleta({ ...base, legado: 'abd' })).not.toBe(a);
  });
});

describe('diferenças da impressão completa', () => {
  it('nomeia a parte e as contagens que mudaram', () => {
    const a = { legado: 'x', objetosSgh: [], catalogo: { INDICES: 1, PAPEIS: 2 } };
    expect(diferencasDasPartes(a, a)).toEqual([]);
    expect(
      diferencasDasPartes(a, { legado: 'y', objetosSgh: ['SGH_A'], catalogo: { INDICES: 3, PAPEIS: 2 } }),
    ).toEqual(['impressão legada', 'objetos SGH_', 'INDICES 1 → 3']);
  });
});

describe('disco', () => {
  it('recusa quando a matriz e a folga não cabem', () => {
    const gb = 2 ** 30;
    expect(() => conferirEspaco(100 * gb, 48 * gb)).not.toThrow();
    expect(() => conferirEspaco(55 * gb, 48 * gb)).toThrow(/Disco insuficiente/);
  });
});

describe('relatório', () => {
  it('traz veredito, critérios, tempos e contagens com <5', () => {
    const esperas = avaliarEsperas([{ sessao: 0, operacao: 'leitura', ms: 12 }]);
    const mon = avaliarMon([{ instante: 1, paradosLegados: 0, maiorParadoMs: 0 }]);
    const veredito = vereditoDoEnsaio({
      copiaLimpa: { objetosSghAntes: 0 },
      aplicacao: { ok: true, scripts: 2, totalMs: 30 },
      impressaoLegadaAntes: 'x',
      impressaoLegadaDepois: 'x',
      contagensAntes: { TBCONVEN: 3, RICADPAC: 900 },
      contagensDepois: { TBCONVEN: 3, RICADPAC: 900 },
      esperas,
      mon,
      recolhimento: {
        ok: true,
        impressaoCompletaAntes: 'c',
        impressaoCompletaDepois: 'c',
        objetosSghDepois: 0,
      },
      cli: conferenciaCli,
    });
    const r: ResultadoEnsaio = {
      inicio: '2026-10-27T10:00:00.000Z',
      porta: 3361,
      matriz: '../banco-dev/backups/pc.fdb',
      sessoes: 4,
      tabelasAtualizadas: ['TBCONVEN'],
      etapasMs: { recolhimento: 10 },
      tempos: [
        { numero: 1, arquivo: 'a.sql', ms: 10, situacao: 'aplicado' },
        { numero: 2, arquivo: 'b.sql', ms: 20, situacao: 'aplicado' },
      ],
      totalMs: 30,
      objetosSghDepoisDaAplicacao: 5,
      comandosDoRecolhimento: 5,
      recolhimentoMs: 10,
      contagensAntes: { TBCONVEN: 3, RICADPAC: 900 },
      contagensDepois: { TBCONVEN: 3, RICADPAC: 900 },
      esperas,
      mon,
      veredito,
      relatoriosCli: ['docs/marcos/M60/ensaio-cli/aplicar.json'],
    };
    const md = formatarRelatorioEnsaio(r);
    expect(md).toContain('2 tabela(s) legada(s) contadas antes e depois');
    expect(md).toContain('- `docs/marcos/M60/ensaio-cli/aplicar.json`');
    expect(veredito.ok).toBe(true);
    expect(md).toContain('**APROVADO**');
    expect(md).toContain('| TBCONVEN | <5 | <5 |');
    expect(md).toContain('| RICADPAC | 900 | 900 |');
    expect(md).toContain('| 0002 | b.sql | 20 ms | aplicado |');
    expect(md.indexOf('| 0002 | b.sql')).toBeLessThan(md.indexOf('| 0001 | a.sql'));
    expect(formatarRelatorioEnsaio({ ...r, erro: 'Error: x' })).toContain('- Erro: Error: x');
    const comResto = formatarRelatorioEnsaio({
      ...r,
      privilegiosOrfaosDeDominio: 12,
      diferencasDoRecolhimento: ['PRIVILEGIOS 1 → 2'],
    });
    expect(comResto).toContain('deixou 12 linha(s) de privilégio USAGE');
    expect(comResto).toContain('Diferenças em relação ao antes: PRIVILEGIOS 1 → 2.');
  });
});
