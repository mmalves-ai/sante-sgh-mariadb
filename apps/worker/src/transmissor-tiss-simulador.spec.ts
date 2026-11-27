// Simulador do transmissor TISS (decisão 53, central de integrações externas, entrada operadora-tiss-webservice):
// recibo pelo contrato do serviço da operadora, determinístico, nos três caminhos (aceite, recusa, erro de transporte),
// lido pelas mesmas regras do domínio que leem o recibo real. Massa sintética, sem banco.
import { respostaElegibilidadeDoRetorno } from '@sgh/dominio-faturamento';
import { retornoDaIntegracao } from '@sgh/dominio-internacao';
import { describe, expect, it } from 'vitest';
import {
  chaveSimuladorTiss,
  destinoDoAmbiente,
  destinoFalsoTiss,
  reciboSimuladoTiss,
} from './transmissor-tiss.service.js';

const eleg = (r: Record<string, unknown>) =>
  respostaElegibilidadeDoRetorno({ situacaoMensagem: 'processada', resposta: JSON.stringify(r), erro: null });
const com = (r: Record<string, unknown>) =>
  retornoDaIntegracao({
    situacaoComunicacao: 'enviada',
    situacaoMensagem: 'processada',
    resposta: JSON.stringify(r),
    erro: null,
  }).retorno;

describe('simulador do transmissor TISS', () => {
  it('aceite: elegível com código de validação e comunicação confirmada com protocolo, sempre os mesmos', () => {
    const a = reciboSimuladoTiss('tiss.elegibilidade', 'sint-1');
    expect(a).toEqual(reciboSimuladoTiss('tiss.elegibilidade', 'sint-1'));
    expect(eleg(a)).toMatchObject({ situacao: 'elegivel', codigoValidacao: expect.stringMatching(/^SIM-/) });
    expect(com(reciboSimuladoTiss('tiss.comunicacao_beneficiario', 'sint-1'))).toMatchObject({
      acao: 'confirmar',
      protocolo: expect.stringMatching(/^SIM-/),
    });
  });

  it('recusa: inelegível e comunicação rejeitada, com o motivo do serviço', () => {
    expect(eleg(reciboSimuladoTiss('tiss.elegibilidade', 'sint-recusa'))).toMatchObject({
      situacao: 'inelegivel',
      motivoNegativa: expect.stringContaining('SIM-RECUSA'),
    });
    expect(com(reciboSimuladoTiss('tiss.comunicacao_beneficiario', 'sint-recusa'))).toMatchObject({
      acao: 'rejeitar',
    });
  });

  it('erro de transporte: o simulador lança (a mensagem vira erro com o código)', () => {
    expect(() => reciboSimuladoTiss('tiss.elegibilidade', 'sint-erro')).toThrow(/Simulador/);
  });

  it('o destino falso é o simulador pela chave da mensagem; em produção, sem transporte real, nenhum', async () => {
    const m = { id: 9, ponto: 'tiss.comunicacao_beneficiario' as const, carga: {} };
    expect(chaveSimuladorTiss(m)).toBe('tiss.comunicacao_beneficiario:9');
    await expect(destinoFalsoTiss(m)).resolves.toEqual(
      reciboSimuladoTiss('tiss.comunicacao_beneficiario', 'tiss.comunicacao_beneficiario:9'),
    );
    expect(destinoDoAmbiente({ AMBIENTE: 'dev' })).toBe(destinoFalsoTiss);
    expect(destinoDoAmbiente({ AMBIENTE: 'producao' })).toBeNull();
  });
});
