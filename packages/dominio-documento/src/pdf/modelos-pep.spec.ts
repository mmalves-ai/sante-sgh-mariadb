import { describe, expect, it } from 'vitest';
import { htmlDocumento } from './modelo.js';
import {
  camposDoDocumentoPep,
  MODELOS_PEP,
  modeloDoTipo,
  RODAPE_ASSINATURA_A_MAO,
  TITULOS_PEP,
} from './modelos-pep.js';

const ident = {
  paciente: 'PACIENTE SINTETICO',
  prontuario: '000123',
  nascimento: '01/01/1980',
  atendimento: '31337',
  profissional: 'MEDICO SINTETICO',
  conselho: 'CRM 12345/SP',
  dataHora: '21/10/2026 10:30',
};

describe('modelos dos documentos do prontuário (regras 6 a 8)', () => {
  it('receita de controle especial e atestado levam o rodapé "assinar à mão"; a simples não', () => {
    const controlada = camposDoDocumentoPep({
      modelo: 'receita-controlada',
      identificacao: ident,
      corpo: ['1) X'],
    });
    expect(controlada.at(-1)?.valor).toBe(RODAPE_ASSINATURA_A_MAO);
    expect(
      camposDoDocumentoPep({ modelo: 'atestado', identificacao: ident, corpo: ['Atesto'] }).at(-1)?.valor,
    ).toMatch(/Assinar à mão/);
    const simples = camposDoDocumentoPep({ modelo: 'receita', identificacao: ident, corpo: ['1) X'] });
    expect(simples.some((c) => c.valor === RODAPE_ASSINATURA_A_MAO)).toBe(false);
    expect(simples.find((c) => c.rotulo === 'Profissional')?.valor).toBe('MEDICO SINTETICO (CRM 12345/SP)');
  });

  it('cada modelo tem título e gera HTML autocontido (snapshot dos campos)', () => {
    for (const m of MODELOS_PEP) {
      const campos = camposDoDocumentoPep({
        modelo: m,
        identificacao: { ...ident, nascimento: null, atendimento: null, conselho: null },
        corpo: [],
        extras: [{ rotulo: 'Vias', valor: '2' }],
      });
      expect(campos.find((c) => c.rotulo === TITULOS_PEP[m])?.valor).toBe('-');
      const html = htmlDocumento({
        titulo: TITULOS_PEP[m],
        produto: 'Produto',
        estabelecimento: 'Hospital sintético',
        emitidoEm: '21/10/2026',
        via: '2ª via',
        campos,
        qrSvg: '<svg/>',
        identificadorQr: 'abc',
        fontesCss: '',
      });
      expect(html).toContain(TITULOS_PEP[m]);
      expect(html).toContain('2ª via');
    }
    expect(
      camposDoDocumentoPep({ modelo: 'tcle', identificacao: ident, corpo: ['Termo'] }).map((c) => c.rotulo),
    ).toMatchInlineSnapshot(`
      [
        "Paciente",
        "Prontuário",
        "Nascimento",
        "Atendimento",
        "Profissional",
        "Data e hora",
        "Termo de consentimento livre e esclarecido",
      ]
    `);
  });

  it('modelo pelo tipo gravado', () => {
    expect(modeloDoTipo('receita-controlada')).toBe('receita-controlada');
    expect(modeloDoTipo('anexo')).toBe('prontuario');
  });
});
