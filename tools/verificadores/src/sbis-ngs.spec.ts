import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATRIZ_SBIS } from './sbis-matriz.ts';
import { matrizNgsEmMarkdown, montarMatrizNgs, REQUISITOS_NGS } from './sbis-ngs.ts';

const raiz = resolve(import.meta.dirname, '../../..');

describe('W1-01: matriz SBIS NGS1/NGS2 requisito a requisito', () => {
  it('cada requisito aponta arquivo de evidência versionado ou marca a lacuna; nenhum achado', () => {
    const versionados = new Set(
      execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0'),
    );
    const { linhas, achados } = montarMatrizNgs(REQUISITOS_NGS, MATRIZ_SBIS, (a) => versionados.has(a));
    expect(achados).toEqual([]);
    expect(linhas.filter((l) => l.nivel === 'NGS1').length).toBeGreaterThan(60);
    expect(linhas.filter((l) => l.nivel === 'NGS2').length).toBeGreaterThan(25);
    for (const l of linhas)
      expect(l.situacao === 'evidencia' ? l.evidencias.length > 0 : (l.lacuna ?? '').length > 0).toBe(true);
    // As evidências do acesso (W1-01) entram nos requisitos de senha, identidade e administrador mínimo.
    const de = (c: string) => linhas.find((l) => l.codigo === c)?.evidencias ?? [];
    expect(de('NGS1.02.03')).toContain('packages/dominio-acesso/src/politica-senha-sante.spec.ts');
    expect(de('NGS1.03.09')).toContain('apps/api/src/modulos/administracao/usuarios-cpf.spec.ts');
    expect(de('NGS1.03.10')).toContain('packages/dominio-acesso/src/usuario/ultimo-gestor.spec.ts');
    expect(de('NGS1.11.01')).toContain('apps/api/src/modulos/administracao/termo-publicar.spec.ts');
    // Lacunas conhecidas ficam marcadas, nunca somem.
    expect(linhas.find((l) => l.codigo === 'NGS2.02.02')?.situacao).toBe('lacuna');
    const md = matrizNgsEmMarkdown(linhas);
    expect(md).toContain('| NGS2.02.02 |');
    expect(md).toContain('**LACUNA**');
  });

  it('acusa requisito sem evidência nem lacuna, grupo inexistente, arquivo não versionado e repetido', () => {
    const { achados } = montarMatrizNgs(
      [
        { codigo: 'NGS1.01.01', titulo: 't', grupo: null },
        { codigo: 'NGS1.01.02', titulo: 't', grupo: 'SBIS-99' },
        { codigo: 'NGS1.01.03', titulo: 't', grupo: null, evidencias: ['x/nao.spec.ts'] },
        { codigo: 'NGS1.01.03', titulo: 't', grupo: null, lacuna: 'motivo' },
        { codigo: 'XYZ', titulo: 't', grupo: null, lacuna: 'motivo' },
      ],
      {},
      () => false,
    );
    expect(achados.map((a) => `${a.codigo}: ${a.motivo}`)).toEqual([
      'NGS1.01.01: requisito sem evidência e sem lacuna marcada',
      'NGS1.01.02: grupo sem linha na matriz: SBIS-99',
      'NGS1.01.02: requisito sem evidência e sem lacuna marcada',
      'NGS1.01.03: evidência não versionada: x/nao.spec.ts',
      'NGS1.01.03: requisito repetido',
      'XYZ: código fora do formato NGSn.nn.nn',
    ]);
  });
});
