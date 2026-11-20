// Os textos do SESMT não citam o sistema antigo nem tabela (ADR 0023), avisam que a leitura do dado de saúde fica
// registrada (regra 16) e que o registro de saúde não é apagado (a retificação).
import { describe, expect, it } from 'vitest';
import { mensagensSesmt } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos do SESMT', () => {
  it('nenhum texto cita o sistema antigo nem nome de tabela', () => {
    const achados = textos(mensagensSesmt).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|\bTB[A-Z]{3,}|\bFP[A-Z_]{3,}|\bST[A-Z_]{3,}|SGH_/i.test(t),
    );
    expect(achados).toEqual([]);
  });
  it('leitura auditada, retificação sem apagar e a fonte nunca identificada', () => {
    expect(mensagensSesmt.leituraAuditada).toMatch(/fica registrada/);
    expect(mensagensSesmt.retificacaoAviso).toMatch(/não é apagado/);
    expect(mensagensSesmt.cat.fonteAviso).toMatch(/nunca é identificada/);
  });
});
