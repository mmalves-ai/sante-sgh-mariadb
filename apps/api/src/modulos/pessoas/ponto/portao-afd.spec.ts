// Portão W0-06 (aceite "O AFD e as marcações não têm rota de alteração"; Portaria MTP 671/2021 e Dec. 10.854/2021,
// art. 31, § 2º, I): a marcação do relógio e o arquivo AFD são SÓ DE INCLUSÃO em todas as camadas.
//   1. API: nenhuma rota de alteração ou exclusão sobre o arquivo do relógio ou a marcação (só a importação, POST
//      ponto/arquivos); nenhum @Put/@Patch/@Delete no módulo de pessoas;
//   2. gravações: nenhum UPDATE nem DELETE de SGH_PES_MARCACAO ou SGH_PES_AFD_ARQUIVO no código do pacote legado;
//   3. banco: os scripts SGH_ só concedem SELECT e INSERT nelas (nenhum UPDATE nem DELETE ao papel da aplicação).
// O ajuste só ACRESCENTA (SGH_PES_PONTO_AJUSTE, com justificativa e aprovador).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const modulo = resolve(import.meta.dirname, '..');
const legado = join(raiz, 'packages/legado/src');

function arquivos(dir: string, filtro: (f: string) => boolean): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) r.push(...arquivos(f, filtro));
    else if (filtro(f)) r.push(f);
  }
  return r;
}
const fonte = (f: string) => !/\.spec\.ts$|\.spec-util\.ts$/.test(f) && f.endsWith('.ts');

describe('portão W0-06: AFD e marcações só de inclusão', () => {
  it('nenhuma rota de alteração ou exclusão no módulo de pessoas sobre o arquivo do relógio ou a marcação', () => {
    const controllers = arquivos(modulo, (f) => f.endsWith('.controller.ts'));
    expect(controllers.length).toBeGreaterThan(10);
    const rotasPonto: string[] = [];
    for (const f of controllers) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/@(?:Put|Patch|Delete)\(/);
      for (const m of s.matchAll(/@Post\('([^']*)'\)/g)) rotasPonto.push(m[1]!);
    }
    const sobreAfd = rotasPonto.filter((r) => /arquivos|marcac/.test(r));
    expect(sobreAfd).toEqual(['ponto/arquivos']);
  });

  it('nenhum UPDATE ou DELETE de SGH_PES_MARCACAO ou SGH_PES_AFD_ARQUIVO no código das gravações', () => {
    const fontes = arquivos(legado, fonte);
    for (const f of fontes) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/UPDATE\s+SGH_PES_(?:MARCACAO|AFD_ARQUIVO)\b/i);
      expect(s, f).not.toMatch(/DELETE\s+FROM\s+SGH_PES_(?:MARCACAO|AFD_ARQUIVO)\b/i);
    }
  });

  it('o banco só concede SELECT e INSERT nas duas tabelas', () => {
    const sqls = arquivos(legado, (f) => /\/sgh\/\d{4}_.*\.sql$/.test(f)).map((f) => readFileSync(f, 'utf8'));
    const grants = sqls
      .flatMap((s) => s.split('\n'))
      .filter((l) => /^GRANT\b.*\bON\s+SGH_PES_(?:MARCACAO|AFD_ARQUIVO)\b/i.test(l.trim()));
    expect(grants.map((g) => g.trim()).sort()).toEqual([
      'GRANT SELECT, INSERT ON SGH_PES_AFD_ARQUIVO TO ROLE SGH_APLICACAO;',
      'GRANT SELECT, INSERT ON SGH_PES_MARCACAO TO ROLE SGH_APLICACAO;',
    ]);
  });
});
