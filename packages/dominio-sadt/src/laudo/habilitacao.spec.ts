// Regra 8 (ficha do M26): laudo de imagem privativo de médico; resultado de laboratório pelo responsável habilitado.
import { describe, expect, it } from 'vitest';
import { ehMedico, ehResponsavelLaboratorio, podeLaudar, podeLiberar } from './habilitacao.js';

describe('quem assina (regra 8)', () => {
  it('médico e responsável técnico pelo CBO', () => {
    expect(ehMedico('225125')).toBe(true);
    expect(ehMedico('2231-05')).toBe(true);
    expect(ehMedico('221205')).toBe(false);
    expect(ehResponsavelLaboratorio('221205')).toBe(true);
    expect(ehResponsavelLaboratorio('223415')).toBe(true);
    expect(ehResponsavelLaboratorio('225335')).toBe(true);
    expect(ehResponsavelLaboratorio('225125')).toBe(false);
  });

  it('liberar laboratório: biomédico sim; médico clínico e técnico não', () => {
    expect(podeLiberar(15, { cbo: '221205', conselhoAtivo: true }).pode).toBe(true);
    expect(podeLiberar(15, { cbo: '225125', conselhoAtivo: true }).motivo).toMatch(/responsável técnico/);
    expect(podeLiberar(15, { cbo: '324205', conselhoAtivo: true }).pode).toBe(false);
    expect(podeLiberar(15, { cbo: '221205', conselhoAtivo: false }).motivo).toMatch(/não está ativo/);
    expect(podeLiberar(15, null).motivo).toMatch(/vínculo/);
  });

  it('laudo de imagem, endoscopia e métodos gráficos: só médico', () => {
    expect(podeLaudar(24, { cbo: '225320', conselhoAtivo: true }).pode).toBe(true);
    expect(podeLaudar(16, { cbo: '221205', conselhoAtivo: true }).motivo).toMatch(/privativo de médico/);
    expect(podeLaudar(90, { cbo: '225120', conselhoAtivo: true }).pode).toBe(true);
    expect(podeLaudar(21, { cbo: '223505', conselhoAtivo: true }).pode).toBe(false);
    expect(podeLaudar(15, { cbo: '221205', conselhoAtivo: true }).pode).toBe(true);
  });
});
