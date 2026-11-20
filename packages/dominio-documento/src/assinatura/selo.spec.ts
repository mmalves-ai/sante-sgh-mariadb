// Regras 6 e 8 do M49 (etapa 2): o selo visível e o rodapé legal no conteúdo da página, o QR para o verificador, os
// tipos que recebem a ICP (receita de controlado e atestado primeiro), o destino pelo tipo e o conselho pelo OID.
import { describe, expect, it } from 'vitest';
import { RODAPE_ASSINATURA_A_MAO } from '../pdf/modelos-pep.js';
import {
  assinavelIcp,
  camposDoDocumentoIcp,
  camposDoSelo,
  conselhoPeloCertificado,
  destinoDoTipo,
  prioridadeIcp,
  RODAPE_LEGAL_ICP,
  TIPOS_ASSINAVEIS_ICP,
  urlVerificador,
} from './selo.js';

const selo = {
  profissional: 'Profissional Sintético',
  registro: 'CRM-RJ 000000',
  politica: 'AD-RT' as const,
  assinadoEm: '24/10/2026 09:00',
  codigo: 'AbCdEfGhIjKlMnOpQrSt',
  urlVerificador: 'https://portal.exemplo.invalid/verificar/AbCdEfGhIjKlMnOpQrSt',
};

describe('selo e rodapé (regra 8)', () => {
  it('o selo diz quem assinou, com qual política, o código, o verificador e a base legal', () => {
    const c = camposDoSelo(selo);
    expect(c[0]!.valor).toContain('Profissional Sintético (CRM-RJ 000000)');
    expect(c[0]!.valor).toContain('carimbo do tempo (AD-RT)');
    expect(c[1]!.valor).toContain(selo.codigo);
    expect(c[2]!.valor).toBe(RODAPE_LEGAL_ICP);
    expect(RODAPE_LEGAL_ICP).toContain('validar.iti.gov.br');
    const rb = camposDoSelo({ ...selo, registro: null, politica: 'AD-RB' });
    expect(rb[0]!.valor).toContain('por Profissional Sintético em');
    expect(rb[0]!.valor).toContain('AD-RB');
  });

  it('o documento assinado com ICP não leva mais o "assinar à mão" e termina no selo', () => {
    const campos = camposDoDocumentoIcp(
      {
        modelo: 'atestado',
        identificacao: {
          paciente: 'Paciente Sintético',
          prontuario: '1',
          nascimento: null,
          atendimento: null,
          profissional: 'Profissional Sintético',
          conselho: null,
          dataHora: '24/10/2026 09:00',
        },
        corpo: ['Atestado SINTÉTICO'],
      },
      selo,
    );
    expect(campos.some((x) => x.valor === RODAPE_ASSINATURA_A_MAO)).toBe(false);
    expect(campos.at(-1)!.valor).toBe(RODAPE_LEGAL_ICP);
  });

  it('o QR leva só o código opaco no endereço do verificador', () => {
    expect(urlVerificador('https://portal.exemplo.invalid/', selo.codigo)).toBe(selo.urlVerificador);
    expect(() => urlVerificador('https://x', 'curto')).toThrow();
  });
});

describe('documento a assinar (regras 6 e 7)', () => {
  it('receita de controlado e atestado primeiro; anexo e alergia não recebem ICP', () => {
    expect(TIPOS_ASSINAVEIS_ICP.slice(0, 2)).toEqual(['receita-controlada', 'receita-antimicrobiano']);
    expect(prioridadeIcp('atestado')).toBeLessThan(prioridadeIcp('tcle'));
    expect(prioridadeIcp('anexo')).toBe(TIPOS_ASSINAVEIS_ICP.length);
    expect(assinavelIcp('atestado')).toBe(true);
    expect(assinavelIcp('anexo')).toBe(false);
    expect(assinavelIcp('alergia')).toBe(false);
  });

  it('o destino pelo tipo (D-DESTINO-49)', () => {
    expect(destinoDoTipo('atestado')).toBe('externo');
    expect(destinoDoTipo('receita-controlada')).toBe('externo');
    expect(destinoDoTipo('registro-clinico')).toBe('interno');
    expect(destinoDoTipo('tcle')).toBe('interno');
  });

  it('o conselho pelo OID do certificado (D-CONSELHO-49)', () => {
    const oids = [
      { oid: '2.16.76.1.4.2.2.1', conselho: 'crm' },
      { oid: '2.16.76.1.4.2.3.1', conselho: 'COREN' },
    ];
    expect(conselhoPeloCertificado({ '2.16.76.1.3.1': 'x', '2.16.76.1.4.2.2.1': '000000' }, oids)).toBe(
      'CRM',
    );
    expect(conselhoPeloCertificado({ '2.16.76.1.3.1': 'x' }, oids)).toBeNull();
  });
});
