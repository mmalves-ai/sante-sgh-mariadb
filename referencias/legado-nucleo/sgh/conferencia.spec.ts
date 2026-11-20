// Leituras das telas do M04 no adaptador: triggers no RDB$TRIGGERS e provas recentes na SGH_TRILHA. Dublê.
import { describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import { estadoDosTriggers, provasRecentes, ULTIMAS_LINHAS_TRILHA } from './conferencia.js';

describe('conferência de gravação: leituras do adaptador', () => {
  it('triggers: ativo, inativo ou ausente; nome inválido nem vai ao banco; lotes de 100', async () => {
    const e = escritorDuble(() => [
      { N: 'TRG_A ', I: 0 },
      { N: 'TRG_B', I: 1 },
    ]);
    const nomes = [
      'TRG_A',
      'TRG_B',
      'TRG_C',
      'x; DROP',
      ...Array.from({ length: 120 }, (_, i) => `TRG_N${i}`),
    ];
    const r = await estadoDosTriggers(e, nomes);
    expect([r['TRG_A'], r['TRG_B'], r['TRG_C']]).toEqual(['ativo', 'inativo', 'ausente']);
    expect(r).not.toHaveProperty('x; DROP');
    expect(e.comandos).toHaveLength(2);
    expect(e.comandos[0]?.parametros).toHaveLength(100);
  });

  it('provas: contagem por operação nas últimas linhas da trilha do estabelecimento', async () => {
    const e = escritorDuble(() => [{ OPERACAO: 'cadastro.cadastrarPaciente ', N: 3 }, { N: null }]);
    expect(await provasRecentes(e, 'pc')).toEqual({ 'cadastro.cadastrarPaciente': 3, '': 0 });
    expect(e.comandos[0]?.sql).toContain(`FIRST ${ULTIMAS_LINHAS_TRILHA}`);
    expect(e.comandos[0]?.parametros).toEqual(['pc']);
    await provasRecentes(e, 'pc', 10 ** 9);
    expect(e.comandos[1]?.sql).toContain('FIRST 100000');
  });
});
