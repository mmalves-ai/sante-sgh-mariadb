// Portão W0-06 (aceite "O AFD e as marcações não têm rota de alteração"; Portaria MTP 671/2021 e Dec. 10.854/2021,
// art. 31, § 2º, I): a marcação do relógio e o arquivo AFD são SÓ DE INCLUSÃO em todas as camadas.
//   1. API: nenhuma rota de alteração ou exclusão sobre o arquivo do relógio ou a marcação (só a importação, POST
//      ponto/arquivos); nenhum @Put/@Patch/@Delete no módulo de pessoas;
//   2. gravações: nenhum UPDATE nem DELETE de marcacao_ponto ou arquivo_ponto no código das portas (nem pela
//      alteração auditada do núcleo);
//   3. banco: o modelo guarda a marcação uma vez só (chaves únicas por relógio e NSR e por vínculo e instante) e o
//      arquivo uma vez por estabelecimento e hash. A concessão só de SELECT e INSERT ao papel da aplicação é pedido
//      do lote 03-09 (não há papel por cliente no modelo ainda).
// O ajuste só ACRESCENTA (ajuste_ponto, com justificativa e aprovador).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const modulo = resolve(import.meta.dirname, '..');
const migracoes = join(raiz, 'db/migracoes');

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

  it('nenhum UPDATE ou DELETE de marcacao_ponto ou arquivo_ponto no código das gravações', () => {
    const fontes = arquivos(modulo, fonte);
    expect(fontes.some((f) => f.endsWith('porta-ponto-propria.ts'))).toBe(true);
    for (const f of fontes) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/UPDATE\s+(?:marcacao_ponto|arquivo_ponto)\b/i);
      expect(s, f).not.toMatch(/DELETE\s+FROM\s+(?:marcacao_ponto|arquivo_ponto)\b/i);
      expect(s, f).not.toMatch(
        /(?:alterarAuditado\([^,]+,|\.alterar\(|\.excluir\()\s*'(?:marcacao_ponto|arquivo_ponto)'/,
      );
    }
  });

  it('o banco guarda a mesma marcação e o mesmo arquivo uma vez só', () => {
    const ddl = arquivos(migracoes, (f) => f.endsWith('.sql'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(ddl).toMatch(/UNIQUE KEY uq_marcacao_ponto_relogio_ponto_id_nsr \(relogio_ponto_id, nsr\)/);
    expect(ddl).toMatch(
      /UNIQUE KEY uq_marcacao_ponto_vinculo_trabalho_id_marcado_em_fonte \(vinculo_trabalho_id, marcado_em, fonte\)/,
    );
    expect(ddl).toMatch(
      /UNIQUE KEY uq_arquivo_ponto_estabelecimento_hash_sha256 \(estabelecimento_id, hash_sha256\)/,
    );
  });
});
