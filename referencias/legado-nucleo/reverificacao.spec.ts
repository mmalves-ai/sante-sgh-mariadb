// Pendência do M02 fechada no M09: intervalo da nova tentativa dos estabelecimentos indisponíveis por chave.
import { describe, expect, it } from 'vitest';
import { lerConfiguracaoNucleo } from './configuracao.js';
import { ErroConfiguracaoEstabelecimentos } from './estabelecimentos.js';

describe('FB_REVERIFICACAO_MS', () => {
  it('padrão 60 s; aceita de 5 s a 1 h', () => {
    expect(lerConfiguracaoNucleo({}).reverificacaoMs).toBe(60_000);
    expect(lerConfiguracaoNucleo({ FB_REVERIFICACAO_MS: '15000' }).reverificacaoMs).toBe(15_000);
  });
  it.each(['1000', '3600001', 'x'])('recusa %s', (v) => {
    expect(() => lerConfiguracaoNucleo({ FB_REVERIFICACAO_MS: v })).toThrow(ErroConfiguracaoEstabelecimentos);
  });
});

describe('FB_TRILHA_ELO_ESPERA_MS / FB_TRILHA_ELO_TETO_MS (18/11/2026)', () => {
  it('padrão 1 s de espera por inclusão e 3 s de teto; aceita ajuste', () => {
    // Produção: teto de 25 s (transação legítima que segura o elo alguns segundos só atrasa as concorrentes).
    expect(lerConfiguracaoNucleo({})).toMatchObject({ esperaEloTrilhaMs: 1_000, tetoEloTrilhaMs: 25_000 });
    // Dev (AMBIENTE=dev): teto curto de 3 s; a chave explícita vale sobre os dois.
    expect(lerConfiguracaoNucleo({ AMBIENTE: 'dev' })).toMatchObject({ tetoEloTrilhaMs: 3_000 });
    expect(lerConfiguracaoNucleo({ AMBIENTE: 'producao' })).toMatchObject({ tetoEloTrilhaMs: 25_000 });
    expect(lerConfiguracaoNucleo({ AMBIENTE: 'dev', FB_TRILHA_ELO_TETO_MS: '8000' })).toMatchObject({
      tetoEloTrilhaMs: 8_000,
    });
    expect(
      lerConfiguracaoNucleo({ FB_TRILHA_ELO_ESPERA_MS: '500', FB_TRILHA_ELO_TETO_MS: '2000' }),
    ).toMatchObject({ esperaEloTrilhaMs: 500, tetoEloTrilhaMs: 2_000 });
  });
  it.each([
    [{ FB_TRILHA_ELO_ESPERA_MS: '50' }],
    [{ FB_TRILHA_ELO_TETO_MS: '60000' }],
    [{ FB_TRILHA_ELO_ESPERA_MS: '2000', FB_TRILHA_ELO_TETO_MS: '1000' }],
  ])('recusa %o', (env) => {
    expect(() => lerConfiguracaoNucleo(env)).toThrow(ErroConfiguracaoEstabelecimentos);
  });
});
