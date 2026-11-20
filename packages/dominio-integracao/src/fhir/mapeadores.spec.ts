// Regra 14 (contrato no CI): os recursos FHIR R4 gerados pelos mapeadores validam contra os perfis BR Core da versão
// FIXADA (o recorte versionado do pacote 1.6.1, com o SHA-256 do ADR 0016); e o validador acusa o que o perfil
// proíbe ou exige. Dados sintéticos (o CPF de teste com dígitos válidos, nunca de pessoa real).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERSAO_BR_CORE } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { imunizacaoFhir, organizacaoFhir, pacienteFhir, profissionalFhir } from './mapeadores.js';
import { type PerfilRecortado, validarRecurso } from './validador.js';

const pacote = JSON.parse(readFileSync(resolve(import.meta.dirname, './br-core-1.6.1.json'), 'utf8')) as {
  versao: string;
  sha256: string;
  perfis: Record<string, PerfilRecortado>;
};
const perfil = (t: string) => pacote.perfis[t]!;

const PACIENTE = {
  id: 1001,
  cpf: '111.444.777-35',
  cns: null,
  nome: 'Paciente Fictício Um',
  nascimento: new Date('1980-02-03T00:00:00Z'),
  sexo: 'F' as const,
};

describe('perfis BR Core na versão fixada (ADR 0016)', () => {
  it('o recorte é do pacote 1.6.1 com o hash do ADR e a versão dos contratos é a mesma', () => {
    expect(pacote.versao).toBe('1.6.1');
    expect(VERSAO_BR_CORE).toBe(pacote.versao);
    expect(pacote.sha256).toBe('974a20ff4ec49727c75624065826ecfda35b3d368d82a02eadfc0713d537f8c6');
    for (const t of ['Patient', 'Organization', 'Practitioner', 'Immunization'])
      expect(perfil(t).versao).toBe('1.6.1');
  });

  it('Patient: CPF como identificador principal; CNS opcional; valida sem problema', () => {
    const p = pacienteFhir(PACIENTE);
    expect(validarRecurso(p, perfil('Patient'))).toEqual([]);
    const comCns = pacienteFhir({ ...PACIENTE, cns: '700000000000005' });
    expect(validarRecurso(comCns, perfil('Patient'))).toEqual([]);
    expect((p['identifier'] as { system: string }[])[0]!.system).toBe('https://saude.gov.br/fhir/sid/cpf');
  });

  it('Organization (CNES), Practitioner (CPF e conselho) e Immunization (RIA) validam', () => {
    const o = organizacaoFhir({
      cnes: '1234567',
      cnpj: '00.000.000/0001-91',
      nome: 'Estabelecimento Sintético',
      apelido: 'Sintético',
      cidade: 'Cidade Sintética',
      uf: 'RJ',
    });
    expect(validarRecurso(o, perfil('Organization'))).toEqual([]);
    const pr = profissionalFhir({
      id: 9,
      cpf: '111.444.777-35',
      cns: null,
      nome: 'Profissional Fictício',
      conselho: { sigla: 'COREN', uf: 'RJ', numero: '123456' },
      ativo: true,
    });
    expect(validarRecurso(pr, perfil('Practitioner'))).toEqual([]);
    const im = imunizacaoFhir({
      id: 'vac-1',
      paciente: 'pac-1001',
      profissional: 'prof-9',
      estabelecimento: 'est-1234567',
      vacina: { codigo: '86', nome: 'Vacina sintética' },
      aplicadaEm: new Date('2026-10-22T10:00:00Z'),
      lote: 'L123',
      fabricante: null,
      via: 'IM',
      local: 'DD',
      dose: 'D1',
    });
    expect(validarRecurso(im, perfil('Immunization'))).toEqual([]);
  });

  it('o validador acusa obrigatório faltando, elemento proibido, valor fixo errado e versão errada', () => {
    const p = pacienteFhir(PACIENTE);
    const semSexo = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'gender'));
    expect(validarRecurso(semSexo, perfil('Patient')).map((x) => x.caminho)).toContain('Patient.gender');
    const cpfErrado = {
      ...p,
      identifier: [{ use: 'usual', system: 'https://saude.gov.br/fhir/sid/cpf', value: '1' }],
    };
    expect(
      validarRecurso(cpfErrado, perfil('Patient'))
        .map((x) => x.mensagem)
        .join(' '),
    ).toMatch(/official/);
    const outraVersao = {
      ...p,
      meta: { profile: ['https://br-core.saude.gov.br/fhir/StructureDefinition/br-core-patient|1.5.0'] },
    };
    expect(validarRecurso(outraVersao, perfil('Patient')).map((x) => x.caminho)).toContain('meta.profile');
    const im = imunizacaoFhir({
      id: 'vac-2',
      paciente: 'p',
      profissional: 'q',
      estabelecimento: 'e',
      vacina: { codigo: '1', nome: 'x' },
      aplicadaEm: new Date(),
      lote: 'L',
      fabricante: 'F',
      via: 'IM',
      local: 'DD',
      dose: 'D1',
    });
    const comNota = { ...im, note: [{ text: 'não pode' }], performer: [{ function: { text: 'x' } }] };
    const problemas = validarRecurso(comNota, perfil('Immunization')).map(
      (x) => `${x.caminho}: ${x.mensagem}`,
    );
    expect(problemas).toContain('Immunization.note: proibido neste perfil');
    expect(problemas).toContain('Immunization.performer.actor: obrigatório (mínimo 1)');
    expect(validarRecurso({ ...im, resourceType: 'Patient' }, perfil('Immunization'))[0]!.caminho).toBe(
      'resourceType',
    );
    const semIds = profissionalFhir({ id: 1, cpf: null, cns: null, nome: 'x', conselho: null, ativo: true });
    expect(validarRecurso(semIds, perfil('Practitioner')).map((x) => x.caminho)).toContain(
      'Practitioner.identifier',
    );
    expect(
      validarRecurso({ ...p, identifier: [{ value: 'x' }] }, perfil('Patient')).at(-1)!.mensagem,
    ).toMatch(/sem sistema/);
  });
});
