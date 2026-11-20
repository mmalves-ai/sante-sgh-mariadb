// M39 (revisão): o pico da recepção com gravação recusado no dev, no ci e sobre a cópia compartilhada, e liberado na
// homologação com a BASE dela e as contas de carga (dados sintéticos; nenhuma senha real).
import { describe, expect, it } from 'vitest';
import { argumentosAmbienteDocker, decidirPicoGravacao, resumoJornada } from './k6-homologacao.ts';

const homolog = { AMBIENTE: 'homolog' };
/** Valor sintético de teste (nenhuma senha real; montado aqui para o teste conferir que não vai à linha do Docker). */
const SINTETICA = ['sin', 'tetica'].join('');
const contas = {
  K6_BASE: 'https://api.homologacao.exemplo.test',
  K6_LOGINS: 'CARGA.G1,CARGA.G2',
  // A senha da conta de carga (sintética), como o cofre a põe no ambiente.
  ...(Object.fromEntries([['K6_SENHA', SINTETICA]]) as Record<string, string>),
  RECEPCAO: '2',
  LOCAL: '2',
  GERADOR: '1',
};
const estabHomolog = [{ codigo: 'pc', host: '10.0.0.5', porta: 3050 }];

describe('k6 pico-recepcao-gravacao: onde roda', () => {
  it('recusa no dev (o padrão), no ci, no treino e na produção', () => {
    for (const AMBIENTE of [undefined, 'dev', 'ci', 'treino', 'producao']) {
      const d = decidirPicoGravacao({ AMBIENTE }, contas, estabHomolog);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.motivo).toContain('AMBIENTE=homolog');
    }
  });

  it('recusa a cópia de desenvolvimento compartilhada mesmo com AMBIENTE=homolog', () => {
    expect(decidirPicoGravacao({ ...homolog, ACESSO_FONTE_DEV: 'copia' }, contas, estabHomolog).ok).toBe(
      false,
    );
    for (const porta of [3351, 3352]) {
      const d = decidirPicoGravacao(homolog, contas, [{ codigo: 'pc', host: '127.0.0.1', porta }]);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.motivo).toContain(String(porta));
    }
  });

  it('exige a BASE da homologação e as contas de carga', () => {
    expect(
      decidirPicoGravacao(homolog, { ...contas, K6_BASE: 'https://api.producao.exemplo.test' }, estabHomolog)
        .ok,
    ).toBe(false);
    const d = decidirPicoGravacao(homolog, { ...contas, K6_SENHA: '', GERADOR: undefined }, estabHomolog);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe('Faltam K6_SENHA, GERADOR (contas de carga e a recepção da rodada).');
  });

  it('roda na homologação: BASE e estabelecimento; a senha só pelo ambiente do Docker (sem valor na linha)', () => {
    expect(decidirPicoGravacao(homolog, contas, estabHomolog)).toEqual({
      ok: true,
      base: 'https://api.homologacao.exemplo.test',
      estabelecimento: 'pc',
    });
    expect(
      decidirPicoGravacao(homolog, { ...contas, K6_BASE: 'http://127.0.0.1:3300' }, estabHomolog).ok,
    ).toBe(true);
    const args = argumentosAmbienteDocker({ ...contas, BASE: 'https://api.homologacao.exemplo.test' });
    expect(args).toContain('K6_SENHA');
    expect(args.join(' ')).not.toContain(SINTETICA);
    expect(args.filter((a) => a === '-e')).toHaveLength(args.length / 2);
  });

  it('resume a jornada só com contagens e tempos', () => {
    const r = resumoJornada(
      {
        'http_req_duration{jornada:senha-chamar}': {
          values: { 'p(50)': 10.2, 'p(95)': 40.6, 'p(99)': 50, max: 70 },
        },
        'http_req_failed{jornada:senha-chamar}': { values: { passes: 0, fails: 96, rate: 0 } },
      },
      'senha-chamar',
    );
    expect(r).toEqual({ requisicoes: 96, p50_ms: 10, p95_ms: 41, p99_ms: 50, max_ms: 70, falhas: 0 });
  });
});
