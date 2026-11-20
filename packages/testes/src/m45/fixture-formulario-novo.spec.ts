// O JSON da publicação do formulário novo usado pelos testes do adaptador está em dia com o domínio (M45, etapa 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMINHO_FIXTURE_M45, fixtureFormularioNovo } from './fixture-formulario-novo.js';

describe('fixture da publicação do formulário novo (M45.1)', () => {
  it('o JSON do adaptador é o que o domínio monta', async () => {
    const atual = `${JSON.stringify(await fixtureFormularioNovo(), null, 2)}\n`;
    if (process.env['FIXTURE_M45_REGRAVAR'] === 'sim') writeFileSync(CAMINHO_FIXTURE_M45, atual);
    expect(readFileSync(CAMINHO_FIXTURE_M45, 'utf8')).toBe(atual);
  });
});
