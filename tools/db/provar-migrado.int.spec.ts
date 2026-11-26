// Integração contra o MariaDB real (recusas da carga, fase 2, K1): as obrigatoriedades relaxadas só no registro
// migrado. Monta um banco de validação descartável com todas as migrações e roda tools/db/provar_migrado.py: em
// cada CHECK do K1, 'sistema' sem o campo dá ERRO 4025 e 'migracao' grava; as CHECKs de origem recusam valor
// inválido; o repasse migrado com percentual e valor fixo ao mesmo tempo é recusado; e, na tabela real com as FKs,
// grava um registro clínico migrado e suspenso, com profissional e sem usuário. Se uma migração futura voltar a
// apertar uma dessas colunas ou CHECKs, este teste acusa. Sem dado de pessoa. SGH_NUCLEO_SEM_BANCO=1 pula este
// arquivo (runner do GitHub e ci-sim.sh, sem MariaDB); na VM roda com `vitest run --config tools/db/vitest.config.ts`,
// sob flock -o do pesado.lock (aplicar todas as migrações leva alguns minutos).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const SCRIPT = fileURLToPath(new URL('./provar_migrado.py', import.meta.url));

describe.skipIf(SEM_BANCO)('K1: obrigatoriedades relaxadas só no registro migrado', () => {
  it('todas as CHECKs do K1 e o registro clínico migrado na tabela real dão "ok"', () => {
    const saida = execFileSync('python3', ['-I', SCRIPT, '--banco', 'validacao_k1_prova', '--montar'], {
      encoding: 'utf-8',
      timeout: 1_800_000,
    });
    const ultima = saida.trim().split('\n').at(-1) ?? '';
    expect(ultima).toMatch(/^ok \(\d+ casos em \d+ CHECKs, 3 na tabela real com FKs\)$/);
  }, 1_800_000);
});
