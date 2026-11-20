// Regras da agenda de exames (ficha do M18, regras 1 a 4): categoria, TP_AGE, estado do horário, resíduo da
// sante-api, vínculo pelo prontuário e cobertura por exame. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  aceitaMarcacao,
  avaliarCoberturaExame,
  categoriaExame,
  contarResiduo,
  estadoDoHorarioExame,
  type HorarioExameLido,
  legendaHorarioExame,
  ROTULOS_ESTADO_EXAME,
  rotuloCategoria,
  rotuloTipoHorario,
  tipoHorarioValido,
  tpAgeDaMarcacao,
  vinculoDaMarcacao,
} from './exame.js';

const h = (x: Partial<HorarioExameLido> = {}): HorarioExameLido => ({
  data: '2026-11-03',
  hora: '0740',
  exame: 'U',
  paciente: '',
  livre: 'S',
  situacao: '',
  tipo: 'N',
  temMarcacao: false,
  ...x,
});

describe('categoria e TP_AGE (regra 4)', () => {
  it('rotula as categorias do catálogo e o ato 90, que não tem linha no catálogo', () => {
    expect(categoriaExame(24)?.rotulo).toBe('Ultrassonografia');
    expect(categoriaExame(90)).toEqual({ codigo: 90, rotulo: 'Métodos gráficos', noCatalogo: false });
    expect(rotuloCategoria(21)).toBe('Endoscopia digestiva');
    expect(rotuloCategoria(77)).toBe('Categoria 77');
    expect(rotuloCategoria(null)).toBe('Categoria não informada');
  });

  it('TP_AGE: 90 no horário de exame O; a categoria da agenda nos demais', () => {
    expect(tpAgeDaMarcacao(42, 'O')).toBe(90);
    expect(tpAgeDaMarcacao(24, 'O')).toBe(90);
    expect(tpAgeDaMarcacao(24, 'U')).toBe(24);
    expect(tpAgeDaMarcacao(21, 'E ')).toBe(21);
  });

  it('tipos de horário vistos (E, U, O); o resto é recusado', () => {
    expect(tipoHorarioValido('U')).toBe(true);
    expect(tipoHorarioValido('X')).toBe(false);
    expect(rotuloTipoHorario('O')).toMatch(/gráficos/);
    expect(rotuloTipoHorario(null)).toBe('Não informado');
    expect(legendaHorarioExame({ hora: '0740', exame: 'U' })).toBe('07:40 · Ultrassonografia');
  });
});

describe('estado do horário (regra 1: C é Confirmado, X é Cancelado)', () => {
  it('vago, bloqueado e o encaixe que nunca vira vaga', () => {
    expect(estadoDoHorarioExame(h())).toBe('vago');
    expect(aceitaMarcacao(h())).toBe(true);
    expect(estadoDoHorarioExame(h({ livre: 'N' }))).toBe('bloqueado');
    expect(estadoDoHorarioExame(h({ tipo: 'E' }))).toBe('outro');
    expect(aceitaMarcacao(h({ tipo: 'E' }))).toBe(false);
  });

  it('ocupado com marcação: marcado, confirmado, realizado, transferido', () => {
    const o = { paciente: 'SINTETICO', temMarcacao: true };
    expect(estadoDoHorarioExame(h(o))).toBe('marcado');
    expect(estadoDoHorarioExame(h({ ...o, situacao: 'C' }))).toBe('confirmado');
    expect(estadoDoHorarioExame(h({ ...o, situacao: 'S' }))).toBe('realizado');
    expect(estadoDoHorarioExame(h({ ...o, situacao: 'T' }))).toBe('transferido');
    expect(estadoDoHorarioExame(h({ ...o, situacao: 'Z' }))).toBe('outro');
    expect(aceitaMarcacao(h(o))).toBe(false);
  });

  it('resíduo da sante-api: ocupado sem marcação e C sem paciente', () => {
    expect(estadoDoHorarioExame(h({ paciente: 'SINTETICO' }))).toBe('marcacao-incompleta');
    expect(estadoDoHorarioExame(h({ situacao: 'C' }))).toBe('residuo-confirmado-sem-paciente');
    expect(estadoDoHorarioExame(h({ situacao: 'X' }))).toBe('outro');
    const r = contarResiduo([
      h(),
      h({ paciente: 'A' }),
      h({ situacao: 'C' }),
      h({ situacao: 'C' }),
      h({ paciente: 'B', temMarcacao: true }),
    ]);
    expect(r).toEqual({ confirmadosSemPaciente: 2, ocupadosSemMarcacao: 1, total: 3 });
    expect(Object.keys(ROTULOS_ESTADO_EXAME)).toHaveLength(9);
  });
});

describe('vínculo pelo prontuário (regra 3)', () => {
  it('prontuário vale; nome igual é só sugestão; sem nada, sem vínculo', () => {
    expect(vinculoDaMarcacao(123, 4)).toEqual({ tipo: 'prontuario', prontuario: 123 });
    expect(vinculoDaMarcacao(0, 2)).toEqual({ tipo: 'sugestao-por-nome', candidatos: 2 });
    expect(vinculoDaMarcacao(0, 0)).toEqual({ tipo: 'sem-vinculo' });
  });
});

describe('cobertura por exame do novo', () => {
  const linhas = [
    { exame: 10, convenio: null },
    { exame: 11, convenio: null },
    { exame: 11, convenio: 306 },
  ];
  it('sem linha ou sem exame escolhido: vale a lista de convênios da agenda', () => {
    expect(avaliarCoberturaExame([], 10, 306)).toEqual({ ok: true });
    expect(avaliarCoberturaExame(linhas, null, 306)).toEqual({ ok: true });
  });
  it('exame que a agenda não faz e convênio que não cobre são recusados', () => {
    expect(avaliarCoberturaExame(linhas, 99, 306)).toMatchObject({ ok: false, codigo: 'exame-nao-feito' });
    expect(avaliarCoberturaExame(linhas, 11, 10)).toMatchObject({
      ok: false,
      codigo: 'convenio-nao-cobre-exame',
    });
    expect(avaliarCoberturaExame(linhas, 11, 306)).toEqual({ ok: true });
    expect(avaliarCoberturaExame(linhas, 10, 10)).toEqual({ ok: true });
  });
});
