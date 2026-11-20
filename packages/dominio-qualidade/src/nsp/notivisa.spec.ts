// Campos do Notivisa (M48, etapa 1): iniciais, idade na ocorrência, período do dia e o prazo. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  camposNotivisa,
  idadeNaData,
  iniciais,
  periodoDoDia,
  type NotificacaoParaNotivisa,
} from './notivisa.js';

describe('identificação mínima do paciente', () => {
  it('iniciais sem partículas e sem acento', () => {
    expect(iniciais('Paciente da Silva Exemplo')).toBe('P.S.E.');
    expect(iniciais('  ÁUREA  dos  Santos d’Ávila ')).toBe('A.S.A.');
    expect(iniciais('')).toBe('');
  });

  it('idade em anos completos na data; sem nascimento, null', () => {
    expect(idadeNaData('1945-10-19', '2026-10-18T03:40:00')).toBe(80);
    expect(idadeNaData('1945-10-18', '2026-10-18T03:40:00')).toBe(81);
    expect(idadeNaData('1945-09-30', '2026-10-18')).toBe(81);
    expect(idadeNaData(null, '2026-10-18')).toBeNull();
    expect(idadeNaData('2027-01-01', '2026-10-18')).toBeNull();
  });

  it('período do dia', () => {
    expect(periodoDoDia('2026-10-18T03:40:00')).toBe('madrugada');
    expect(periodoDoDia('2026-10-18T06:00:00')).toBe('manha');
    expect(periodoDoDia('2026-10-18T12:00:00')).toBe('tarde');
    expect(periodoDoDia('2026-10-18T18:00:00')).toBe('noite');
  });
});

describe('campos para transcrição', () => {
  const n: NotificacaoParaNotivisa = {
    protocolo: 'NSP-2026-000010',
    tipo: 'queda',
    tipoOutro: null,
    classificacao: 'eventoAdverso',
    dano: 'obito',
    neverEvent: false,
    ocorridoEm: '2026-10-18T03:40:00',
    unidade: 'Unidade sintética',
    local: '2º andar',
    descricao: 'Descrição revisada pelo NSP.',
    paciente: { nome: 'Paciente Sintetico Cinco', sexo: 'F', nascimento: '1945-10-19' },
  };
  const prazo = {
    tipo: 'notivisaObito' as const,
    venceEm: '2026-10-21T03:40:00',
    situacao: 'noPrazo' as const,
    minutosRestantes: 100,
  };

  it('com paciente (só iniciais, sexo e idade), o óbito e o prazo de 72 h', () => {
    const c = camposNotivisa(n, [
      { tipo: 'analiseCausaRaiz', venceEm: '2026-12-17T23:59:59', situacao: 'noPrazo', minutosRestantes: 9 },
      prazo,
    ]);
    expect(c).toEqual({
      protocoloInterno: 'NSP-2026-000010',
      tipoIncidente: 'Queda',
      classificacao: 'Evento adverso',
      ocorridoEm: '2026-10-18T03:40:00',
      periodo: 'madrugada',
      unidade: 'Unidade sintética',
      local: '2º andar',
      descricao: 'Descrição revisada pelo NSP.',
      dano: 'Óbito',
      obito: true,
      neverEvent: false,
      paciente: { iniciais: 'P.S.C.', sexo: 'F', idade: 80 },
      prazo,
    });
    expect(JSON.stringify(c)).not.toContain('Sintetico');
  });

  it('sem paciente, tipo "outro" descrito e sem prazo do Notivisa', () => {
    const c = camposNotivisa(
      { ...n, paciente: null, tipo: 'outro', tipoOutro: 'Dieta trocada', dano: 'leve' },
      [],
    );
    expect(c.paciente).toBeNull();
    expect(c.tipoIncidente).toBe('Outro: Dieta trocada');
    expect(c.obito).toBe(false);
    expect(c.prazo).toBeNull();
  });
});
