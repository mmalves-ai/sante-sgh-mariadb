import { REQUISITOS_SBIS, type RequisitoSbis } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { checklistPacote, matrizEmMarkdown, montarMatrizSbis, projetoDoTeste } from './sbis.ts';
import { MATRIZ_SBIS } from './sbis-matriz.ts';

const req = (codigo: string, extra: Partial<RequisitoSbis> = {}): RequisitoSbis => ({
  codigo,
  nivel: 'NGS1',
  titulo: `t ${codigo}`,
  modulo: 'Plataforma',
  regime: 'novo',
  evidencias: ['matriz-rastreabilidade'],
  ...extra,
});

describe('suíte de conformidade SBIS (pnpm sbis:verificar)', () => {
  it('a matriz versionada cobre o catálogo inteiro, sem linha a mais', () => {
    const { linhas, achados } = montarMatrizSbis(REQUISITOS_SBIS, MATRIZ_SBIS, () => true);
    expect(achados).toEqual([]);
    expect(linhas).toHaveLength(REQUISITOS_SBIS.length);
    expect(Object.keys(MATRIZ_SBIS).sort()).toEqual(REQUISITOS_SBIS.map((r) => r.codigo).sort());
  });

  it('requisito sem linha, linha sem requisito, sem teste e teste não versionado são achados', () => {
    const { linhas, achados } = montarMatrizSbis(
      [req('SBIS-01'), req('SBIS-02'), req('SBIS-03')],
      {
        'SBIS-01': { funcionalidade: 'f', testes: [] },
        'SBIS-02': { funcionalidade: 'f', testes: ['a/x.spec.ts', 'a/y.ts'] },
        'SBIS-99': { funcionalidade: 'f', testes: ['a/x.spec.ts'] },
      },
      (a) => a === 'a/x.spec.ts',
    );
    expect(achados.map((a) => `${a.codigo}: ${a.motivo}`)).toEqual([
      'SBIS-99: linha da matriz sem requisito no catálogo',
      'SBIS-01: requisito sem teste',
      'SBIS-02: não é teste: a/y.ts',
      'SBIS-02: teste não versionado: a/y.ts',
      'SBIS-03: requisito sem linha na matriz',
    ]);
    expect(linhas.map((l) => l.resultado)).toEqual(['nao-conforme', 'nao-conforme']);
  });

  it('resultado da execução: falha vira achado; integração aparece como da cópia', () => {
    const { linhas, achados } = montarMatrizSbis(
      [req('SBIS-01'), req('SBIS-02')],
      {
        'SBIS-01': { funcionalidade: 'f', testes: ['a/x.spec.ts', 'a/z.int.spec.ts'] },
        'SBIS-02': { funcionalidade: 'f', testes: ['a/y.spec.ts'] },
      },
      () => true,
      new Map([
        ['a/x.spec.ts', 'passou'],
        ['a/y.spec.ts', 'falhou'],
      ]),
    );
    expect(linhas[0]!.testes.map((t) => t.resultado)).toEqual(['passou', 'na-copia']);
    expect(linhas.map((l) => l.resultado)).toEqual(['conforme', 'nao-conforme']);
    expect(achados).toEqual([{ codigo: 'SBIS-02', motivo: 'teste falhou: a/y.spec.ts' }]);
  });

  it('sem a execução, a linha completa sai "sem execução", nunca "conforme"', () => {
    const matriz = { 'SBIS-01': { funcionalidade: 'f', testes: ['a/x.spec.ts'] } };
    const estatico = montarMatrizSbis([req('SBIS-01')], matriz, () => true);
    expect(estatico.linhas.map((l) => [l.resultado, l.testes[0]!.resultado])).toEqual([
      ['sem-execucao', 'presente'],
    ]);
    expect(estatico.achados).toEqual([]);
    const md = matrizEmMarkdown(estatico.linhas, [], false);
    expect(md).toContain('0 conformes, 1 sem execução');
    expect(md).toContain('| sem-execucao |');
    const executado = montarMatrizSbis(
      [req('SBIS-01')],
      matriz,
      () => true,
      new Map([['a/x.spec.ts', 'passou']]),
    );
    expect(executado.linhas[0]!.resultado).toBe('conforme');
  });

  it('checklist do pacote: cada item com os requisitos que o pedem, e o markdown traz os dois', () => {
    const checklist = checklistPacote(REQUISITOS_SBIS);
    expect(checklist.map((c) => c.item)).toContain('matriz-rastreabilidade');
    expect(checklist.find((c) => c.item === 'restauracao-backup')!.requisitos).toContain('SBIS-13');
    const { linhas } = montarMatrizSbis(REQUISITOS_SBIS, MATRIZ_SBIS, () => true);
    const md = matrizEmMarkdown(linhas, checklist, false);
    expect(md).toContain('| SBIS-13 | NGS1 | novo |');
    expect(md).toContain('## Checklist do pacote de evidências');
  });

  it('projeto do teste: a pasta mais próxima com vitest.config.ts', () => {
    const existe = (p: string) => p === '/r/packages/x/vitest.config.ts';
    expect(projetoDoTeste('/r', 'packages/x/src/a/b.spec.ts', existe)).toBe('packages/x');
    expect(projetoDoTeste('/r', 'outro/a.spec.ts', existe)).toBeNull();
  });
});
