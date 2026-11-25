import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { definicaoParametro, PARAMETROS_NOVOS } from './definicoes.js';
import { PARAMETROS_SADT_SETOR } from './sadt-setor.js';

const SEMENTE = fileURLToPath(
  new URL('../../../../db/migracoes/10_SADT/97_parametros_setor_chaves.sql', import.meta.url),
);

describe('parâmetros do diagnóstico por setor (05-SADT linha 25)', () => {
  it('oito parâmetros por setor, todos no registro do produto e sem chave repetida', () => {
    expect(PARAMETROS_SADT_SETOR).toHaveLength(32);
    for (const d of PARAMETROS_SADT_SETOR) expect(PARAMETROS_NOVOS).toContain(d);
    expect(new Set(PARAMETROS_NOVOS.map((d) => d.chave)).size).toBe(PARAMETROS_NOVOS.length);
    expect(definicaoParametro('sadt.laboratorio.exigeMaterial')?.padrao).toBe('true');
    expect(definicaoParametro('sadt.imagem.exigeMaterial')?.padrao).toBe('false');
    expect(definicaoParametro('sadt.endoscopia.numeracaoExame')?.opcoes).toContain('anual');
  });

  it('a semente do banco traz cada parâmetro sadt.* do contrato com o mesmo padrão', () => {
    const sql = readFileSync(SEMENTE, 'utf8');
    const sadt = PARAMETROS_NOVOS.filter((d) => d.chave.startsWith('sadt.'));
    expect(sadt.length).toBe(38);
    for (const d of sadt) expect(sql).toContain(`'${d.chave}' AS chave`);
    for (const d of PARAMETROS_SADT_SETOR)
      expect(sql).toMatch(
        new RegExp(
          `'${d.chave.replace(/\./g, '\\.')}' AS chave, '[^']*' AS descricao, '${d.tipo}' AS tipo, '${d.padrao}' AS padrao`,
        ),
      );
  });
});
