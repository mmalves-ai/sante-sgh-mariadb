// Regra 10 da ficha do M09: ZPL gerado no servidor igual, byte a byte, ao texto de referência versionado
// (a leitura física fica para o deploy, DP-15); dois identificadores legíveis; código só com IDs do legado.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACIENTE_FICTICIO as p } from './dados.spec-util.js';
import {
  campoZpl,
  ErroZpl,
  zplEtiquetaAmostra,
  zplEtiquetaLeito,
  zplEtiquetaProntuario,
  zplPulseira,
} from './modelos.js';

const referencia = (nome: string) => readFileSync(new URL(`./referencias/${nome}`, import.meta.url), 'utf8');

describe('modelos ZPL iguais à referência', () => {
  it('pulseira adulto', () => {
    const zpl = zplPulseira({ ...p, leito: '204-B', alergia: true });
    expect(zpl).toBe(referencia('pulseira-adulto.zpl'));
    expect(zpl).toContain('PACIENTE FICTICIO DE TESTE_5FUM'); // identificador 1: nome completo
    expect(zpl).toContain('NASC. 17/05/1980'); // identificador 2: nascimento
    expect(zpl).toMatch(/\^BXR,6,200\^FDP900001\|A7654321\^FS/); // DataMatrix só com IDs do legado
  });

  it('etiqueta de amostra e de prontuário', () => {
    expect(zplEtiquetaAmostra({ ...p, amostra: 'AM-0099887', exame: 'Hemograma completo' })).toBe(
      referencia('etiqueta-amostra.zpl'),
    );
    expect(zplEtiquetaProntuario(p)).toBe(referencia('etiqueta-prontuario.zpl'));
  });

  it('etiqueta do leito: o QR com a solicitação de limpeza do leito, sem dado de paciente', () => {
    const url =
      'https://sante.exemplo.invalid/higienizacao/solicitacoes?leito=INT-1%7C101%7C02&origem=qrcode';
    const zpl = zplEtiquetaLeito({ rotulo: 'INT-1 101 02', url });
    expect(zpl).toBe(referencia('etiqueta-leito.zpl'));
    expect(zpl).toContain(`^BQN,2,6^FDQA,${url}^FS`);
    expect(() => zplEtiquetaLeito({ rotulo: 'X', url: 'javascript:alert(1)' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaLeito({ rotulo: 'X', url: 'https://a.invalid/x^FS' })).toThrow(ErroZpl);
  });

  it('pulseira sem leito e sem alergia', () => {
    const zpl = zplPulseira(p);
    expect(zpl).not.toContain('LEITO');
    expect(zpl).not.toContain('ALERGIA');
  });

  it('pulseira com nome social: o social em destaque e o civil abaixo (W1-04)', () => {
    const civil = p.nomeCompleto.trim().toUpperCase();
    const zpl = zplPulseira({ ...p, nomeSocial: 'Alex Teste' });
    expect(zpl).toContain('^FO150,250^A0R,36,36^FH_^FDALEX TESTE^FS');
    expect(zpl).toContain(`^FO118,250^A0R,26,26${campoZpl(`REG.: ${civil}`)}`);
    expect(zpl).not.toContain('^A0R,42,42');
    // Nome social igual ao civil (ou vazio) não duplica a linha.
    expect(zplPulseira({ ...p, nomeSocial: ` ${civil.toLowerCase()} ` })).toBe(zplPulseira(p));
    expect(zplPulseira({ ...p, nomeSocial: null })).toBe(zplPulseira(p));
  });

  it('caracteres de comando do ZPL nunca vão crus', () => {
    expect(campoZpl('A^B~C_D')).toBe('^FH_^FDA_5EB_7EC_5FD^FS');
    expect(() => campoZpl('linha\nnova')).toThrow(ErroZpl);
  });

  it('recusa dado inválido: ID não positivo, código com texto livre, data sentinela', () => {
    expect(() => zplPulseira({ ...p, idPaciente: 0 })).toThrow(/idPaciente/);
    expect(() => zplPulseira({ ...p, atendimento: 1.5 })).toThrow(/atendimento/);
    expect(() => zplPulseira({ ...p, nascimento: '1899-12-30' })).toThrow(/nascimento/);
    expect(() => zplPulseira({ ...p, nascimento: '17/05/1980' })).toThrow(/nascimento/);
    expect(() => zplEtiquetaAmostra({ ...p, amostra: 'AM 1^', exame: 'X' })).toThrow(/só IDs/);
    expect(() => zplEtiquetaProntuario({ ...p, idPaciente: -1 })).toThrow(/idPaciente/);
  });
});
