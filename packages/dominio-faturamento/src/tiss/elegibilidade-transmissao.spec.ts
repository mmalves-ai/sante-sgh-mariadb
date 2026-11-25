// Consulta de elegibilidade pelo serviço web da operadora (C2-070, 06-FAT linha 26).
import { describe, expect, it } from 'vitest';
import { conferirRespostaElegibilidade } from './elegibilidade.js';
import {
  conferirTransmissaoElegibilidade,
  PONTO_ELEGIBILIDADE,
  respostaElegibilidadeDoRetorno,
  SEM_TRANSPORTE_TISS,
  transporteTissDisponivel,
} from './elegibilidade-transmissao.js';

describe('conferirTransmissaoElegibilidade', () => {
  it('a pendente não enviada sai com o serviço web cadastrado', () => {
    expect(
      conferirTransmissaoElegibilidade({
        situacao: 'pendente',
        jaEnviada: false,
        servicoWeb: true,
        transporte: true,
      }),
    ).toEqual([]);
    expect(PONTO_ELEGIBILIDADE).toMatch(/^[a-z][a-z0-9_.]{0,79}$/);
  });
  it('recusa a respondida, a já enviada e sem serviço web', () => {
    expect(
      conferirTransmissaoElegibilidade({
        situacao: 'elegivel',
        jaEnviada: false,
        servicoWeb: true,
        transporte: true,
      })[0]?.campo,
    ).toBe('consulta');
    expect(
      conferirTransmissaoElegibilidade({
        situacao: 'pendente',
        jaEnviada: true,
        servicoWeb: true,
        transporte: true,
      })[0]?.mensagem,
    ).toMatch(/retorno/);
    expect(
      conferirTransmissaoElegibilidade({
        situacao: 'pendente',
        jaEnviada: false,
        servicoWeb: false,
        transporte: true,
      })[0]?.campo,
    ).toBe('canal');
  });
  it('sem transporte no ambiente nada sai: a recepção registra a resposta à mão', () => {
    expect(
      conferirTransmissaoElegibilidade({
        situacao: 'pendente',
        jaEnviada: false,
        servicoWeb: true,
        transporte: false,
      }),
    ).toEqual([{ campo: 'canal', mensagem: SEM_TRANSPORTE_TISS }]);
  });
});

describe('transporteTissDisponivel', () => {
  it('fora de produção só com o transmissor ligado (destino falso)', () => {
    expect(
      transporteTissDisponivel({ transmissorLigado: true, producao: false, transporteProducao: false }),
    ).toBe(true);
    expect(
      transporteTissDisponivel({ transmissorLigado: false, producao: false, transporteProducao: false }),
    ).toBe(false);
  });
  it('em produção só com o transporte da operadora configurado', () => {
    expect(
      transporteTissDisponivel({ transmissorLigado: true, producao: true, transporteProducao: false }),
    ).toBe(false);
    expect(
      transporteTissDisponivel({ transmissorLigado: true, producao: true, transporteProducao: true }),
    ).toBe(true);
  });
});

describe('respostaElegibilidadeDoRetorno', () => {
  const ret = (
    situacaoMensagem: 'pendente' | 'enviada' | 'processada' | 'erro' | 'descartada',
    resposta: string | null,
    erro: string | null = null,
  ) => respostaElegibilidadeDoRetorno({ situacaoMensagem, resposta, erro });
  it('na fila, nada muda', () => {
    expect(ret('pendente', null)).toBeNull();
    expect(ret('enviada', null)).toBeNull();
  });
  it('elegível com o código de validação; a resposta passa na regra da resposta', () => {
    const r = ret('processada', JSON.stringify({ elegivel: true, codigoValidacao: 'V123' }))!;
    expect(r).toMatchObject({ situacao: 'elegivel', codigoValidacao: 'V123', motivoNegativa: null });
    expect(conferirRespostaElegibilidade('pendente', r)).toEqual([]);
  });
  it('negada com o motivo da operadora, ou com o motivo padrão', () => {
    expect(ret('processada', JSON.stringify({ elegivel: false, motivo: 'Carência' }))).toMatchObject({
      situacao: 'inelegivel',
      motivoNegativa: 'Carência',
    });
    const r = ret('processada', JSON.stringify({ elegivel: false }))!;
    expect(r.motivoNegativa).toMatch(/sem motivo/);
    expect(conferirRespostaElegibilidade('pendente', r)).toEqual([]);
  });
  it('falha, descarte, ilegível, sem recibo e código inválido', () => {
    expect(ret('erro', null, 'HTTP_503')).toMatchObject({
      situacao: 'erro',
      motivoNegativa: expect.stringContaining('HTTP_503'),
    });
    expect(ret('descartada', null)?.situacao).toBe('erro');
    expect(ret('processada', '{x')?.motivoNegativa).toMatch(/ilegível/);
    expect(ret('processada', '{"ok":1}')?.situacao).toBe('erro');
    expect(ret('processada', null)?.situacao).toBe('sem_resposta');
    expect(
      ret('processada', JSON.stringify({ elegivel: true, codigoValidacao: 'X'.repeat(21) }))?.situacao,
    ).toBe('erro');
    for (const s of ['erro', 'descartada', 'processada'] as const)
      expect(conferirRespostaElegibilidade('pendente', ret(s, '{x')!)).toEqual([]);
  });
});
