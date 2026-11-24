import { describe, expect, it } from 'vitest';
import {
  altaExigeSumario,
  tiposQueExigemSumario,
  fhirDoSumario,
  hashDoSumario,
  montarSumario,
  pendenciasDoSumario,
  PERFIL_FHIR_SUMARIO,
  textoDoSumario,
} from './sumario-alta.js';

const episodio = {
  motivoInternacao: 'Dor torácica',
  diagnosticos: [
    { cid: 'I21.9', descricao: 'Infarto agudo do miocárdio' },
    { cid: null, descricao: 'Hipertensão' },
  ],
  procedimentos: ['Cateterismo'],
  alergias: ['DIPIRONA'],
  medicamentos: ['AAS 100 mg 1x ao dia'],
  exames: ['Troponina'],
};

describe('sumário de alta (regra 13)', () => {
  it('montado do episódio e editável; o mínimo para finalizar', () => {
    const s = montarSumario(episodio);
    expect(s.diagnosticos).toHaveLength(2);
    expect(s.evolucao).toContain('Troponina');
    expect(pendenciasDoSumario(s).map((p) => p.campo)).toEqual(['plano', 'condicaoAlta']);
    const pronto = { ...s, condicaoAlta: 'Estável', plano: 'Retorno em 7 dias' };
    expect(pendenciasDoSumario(pronto)).toEqual([]);
    expect(pendenciasDoSumario({ ...pronto, diagnosticos: [] })[0]?.campo).toBe('diagnosticos');
    expect(pendenciasDoSumario({ ...pronto, plano: undefined, encaminhamentos: ['Cardiologia'] })).toEqual(
      [],
    );
    const vazio = montarSumario({ ...episodio, motivoInternacao: null, alergias: [], exames: [] });
    expect(vazio.motivoInternacao).toBeUndefined();
    expect(vazio.evolucao).toBeUndefined();
  });

  it('texto em seções e hash estável', async () => {
    const s = { ...montarSumario(episodio), condicaoAlta: 'Estável', plano: 'Retorno' };
    const t = textoDoSumario(s);
    expect(t).toContain('Diagnósticos:\n- I21.9 Infarto agudo do miocárdio\n- Hipertensão');
    expect(t).toContain('Condição na alta:\nEstável');
    expect(textoDoSumario({ ...s, alergias: [] })).toContain('Sem alergias registradas');
    expect(await hashDoSumario(1, 1, s)).toBe(await hashDoSumario(1, 1, { ...s }));
    expect(await hashDoSumario(1, 2, s)).not.toBe(await hashDoSumario(1, 1, s));
  });

  it('FHIR document (Composition) sem envio, perfil fixado', () => {
    const s = { ...montarSumario(episodio), condicaoAlta: 'Estável', plano: 'Retorno <7d>' };
    const b = JSON.parse(
      fhirDoSumario({
        id: 'x1',
        paciente: 9,
        atendimento: 7,
        autor: 'MEDICO SINTETICO',
        data: '2026-10-21T10:00:00-03:00',
        sumario: s,
      }),
    );
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('document');
    const c = b.entry[0].resource;
    expect(c.meta.profile[0]).toContain(PERFIL_FHIR_SUMARIO);
    expect(c.subject.reference).toBe('Patient/9');
    expect(JSON.stringify(c)).toContain('Retorno &lt;7d&gt;');
    expect(c.section.length).toBe(5);
  });

  it('a alta no novo exige sumário pelo tipo de atendimento', () => {
    expect(altaExigeSumario('I', new Set(['I']))).toBe(true);
    expect(altaExigeSumario('E', new Set(['I']))).toBe(false);
    // O parâmetro pep.sumarioAlta.exigidoNaAlta (padrão: internação).
    const exigidos = tiposQueExigemSumario(' Internacao, externo ,outro');
    expect([...exigidos].sort()).toEqual(['externo', 'internacao']);
    expect(altaExigeSumario('internacao', tiposQueExigemSumario('internacao'))).toBe(true);
    expect(tiposQueExigemSumario(null).size).toBe(0);
  });
});
