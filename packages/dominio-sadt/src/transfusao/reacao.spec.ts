// Regra 5 (ficha do M47): reação com conduta, devolução ou descarte, sugestão ao NSP e campos da notificação.
import { describe, expect, it } from 'vitest';
import {
  camposNotificacao,
  conferirReacao,
  iniciais,
  MENSAGENS_REACAO,
  sugestaoDeNotificacao,
} from './reacao.js';

const base = {
  atoIniciadoEm: '2026-10-24T10:00:00',
  atoEmCurso: true,
  inicioReacaoEm: '2026-10-24T10:20:00',
  tipo: 'febrilNaoHemolitica' as const,
  grau: 1 as const,
  condutas: ['interromperTransfusao' as const, 'comunicarMedico' as const],
  destinoBolsa: 'devolvida' as const,
  obito: false,
};

describe('conferência da reação (regra 5)', () => {
  it('em ordem, sem problema', () => {
    expect(conferirReacao(base)).toEqual([]);
    expect(
      conferirReacao({
        ...base,
        atoEmCurso: false,
        condutas: ['comunicarMedico'],
        destinoBolsa: 'naoSeAplica',
      }),
    ).toEqual([]);
  });

  it('ato não iniciado, reação antes do início, em curso sem interromper, destino e óbito', () => {
    expect(conferirReacao({ ...base, atoIniciadoEm: null })).toEqual(['ato-sem-inicio']);
    expect(conferirReacao({ ...base, inicioReacaoEm: '2026-10-24T09:00:00' })).toEqual([
      'reacao-antes-do-inicio',
    ]);
    expect(conferirReacao({ ...base, condutas: ['comunicarMedico'] })).toEqual(['em-curso-sem-interromper']);
    expect(conferirReacao({ ...base, destinoBolsa: 'naoSeAplica' })).toEqual(['destino-obrigatorio']);
    expect(conferirReacao({ ...base, tipo: 'aloimunizacao', destinoBolsa: 'naoSeAplica' })).toEqual([]);
    expect(conferirReacao({ ...base, obito: true, grau: 3 })).toEqual(['obito-sem-grau-4']);
  });

  it('textos de produto', () => {
    for (const m of Object.values(MENSAGENS_REACAO)) expect(m).not.toMatch(/SPDATA|legado/i);
  });
});

describe('sugestão de notificação', () => {
  it('toda reação sugere; grave ou confirmada moderada é imediata', () => {
    expect(
      sugestaoDeNotificacao({
        tipo: 'alergica',
        grau: 1,
        correlacao: 'possivel',
        destinoBolsa: 'naoSeAplica',
      }),
    ).toEqual({
      sugerida: true,
      prioridade: 'rotina',
      categoria: 'hemovigilancia',
      titulo: 'Reação transfusional: Reação alérgica (grau 1)',
      bolsaSaiDoEstoque: false,
    });
    expect(
      sugestaoDeNotificacao({ tipo: 'trali', grau: 3, correlacao: 'possivel', destinoBolsa: 'descartada' }),
    ).toMatchObject({ prioridade: 'imediata', bolsaSaiDoEstoque: true });
    expect(
      sugestaoDeNotificacao({ tipo: 'taco', grau: 2, correlacao: 'confirmada', destinoBolsa: 'devolvida' })
        .prioridade,
    ).toBe('imediata');
    expect(
      sugestaoDeNotificacao({ tipo: 'taco', grau: 2, correlacao: 'provavel', destinoBolsa: 'devolvida' })
        .prioridade,
    ).toBe('rotina');
  });
});

describe('campos da notificação', () => {
  it('só iniciais, sexo e idade do paciente (dado sintético)', () => {
    expect(iniciais('Fulana de Tal Sintética')).toBe('FTS');
    const entrada = {
      inicioTransfusaoEm: '2026-10-24T10:00:00',
      inicioReacaoEm: '2026-10-24T10:20:00',
      hemocomponente: 'CH',
      numeroBolsa: 'B123456',
      tipo: 'outra' as const,
      descricaoOutra: 'Prurido isolado',
      grau: 1 as const,
      correlacao: 'possivel' as const,
      sinaisESintomas: 'Prurido',
      condutas: ['interromperTransfusao' as const],
      nomePaciente: 'Fulana de Tal Sintética',
      sexo: 'F' as const,
      idade: 40,
    };
    const c = camposNotificacao(entrada);
    expect(c).toMatchObject({
      dataTransfusao: '2026-10-24',
      dataReacao: '2026-10-24',
      tipoReacao: 'Outra: Prurido isolado',
      tempo: 'imediata',
      paciente: { iniciais: 'FTS', sexo: 'F', idade: 40 },
    });
    expect(JSON.stringify(c)).not.toMatch(/Fulana/);
    expect(
      camposNotificacao({
        ...entrada,
        inicioTransfusaoEm: '2026-10-01T10:00',
        inicioReacaoEm: '2026-10-20T10:00',
        tipo: 'hemoliticaTardia',
        descricaoOutra: null,
        nomePaciente: 'X Y',
        sexo: 'I',
        idade: null,
        condutas: [],
      }),
    ).toMatchObject({ tipoReacao: 'Reação hemolítica tardia', tempo: 'tardia', paciente: { iniciais: '' } });
  });
});
