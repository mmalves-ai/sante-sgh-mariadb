// Regra 8 da ficha do M15: suspenso, correção ligada ao original, retroativo, supervisão e o aviso de registro
// eletrônico sem assinatura ICP ficam visíveis.
import { describe, expect, it } from 'vitest';
import { BASE } from './corpus.spec-util.js';
import { marcasDoRegistro, minutos } from './registro.js';

const AGORA = new Date('2026-10-20T12:00:00Z');

describe('marcas legais', () => {
  it('registro comum: só o aviso de sem assinatura ICP', () => {
    const m = marcasDoRegistro(BASE, AGORA);
    expect(m).toMatchObject({
      suspenso: false,
      retroativo: false,
      supervisao: false,
      semConteudo: false,
      dataImpossivel: false,
      corrigeRegistro: null,
      semAssinaturaIcp: true,
    });
  });

  it('suspenso pelo cabeçalho (com a justificativa) e pela situação do documento', () => {
    const m = marcasDoRegistro(
      { ...BASE, suspensoEm: '2024-05-02T10:11:12', justificativaSuspensao: ' lançado no paciente errado ' },
      AGORA,
    );
    expect(m).toMatchObject({
      suspenso: true,
      suspensoEm: '2024-05-02T10:11',
      justificativaSuspensao: 'lançado no paciente errado',
    });
    expect(marcasDoRegistro({ ...BASE, situacoesDocumento: [1, 12] }, AGORA).suspenso).toBe(true);
  });

  it('correção ligada ao original, retroativo com a justificativa e supervisão', () => {
    const m = marcasDoRegistro(
      { ...BASE, corrigeRegistro: 123, justificativaRetroativo: 'sistema fora do ar', supervisor: 77 },
      AGORA,
    );
    expect(m).toMatchObject({
      corrigeRegistro: 123,
      retroativo: true,
      justificativaRetroativo: 'sistema fora do ar',
      supervisao: true,
    });
    expect(marcasDoRegistro({ ...BASE, corrigeRegistro: 0, supervisor: 0 }, AGORA)).toMatchObject({
      corrigeRegistro: null,
      supervisao: false,
    });
  });

  it('documento com assinatura requerida não leva o aviso; sem documento leva', () => {
    expect(marcasDoRegistro({ ...BASE, tiposDocumento: [2] }, AGORA).semAssinaturaIcp).toBe(false);
    expect(marcasDoRegistro({ ...BASE, tiposDocumento: [] }, AGORA).semAssinaturaIcp).toBe(true);
    expect(minutos(null)).toBeNull();
    expect(minutos('lixo')).toBeNull();
  });
});
