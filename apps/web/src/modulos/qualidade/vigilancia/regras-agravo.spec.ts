// Regras de tela da notificação compulsória (M48, etapa 4): o texto do prazo, as entradas conferidas pelos esquemas da
// API (abrir pelo gatilho, abrir sem sugestão, notificar, descartar, configurar o exame) e o que a situação permite.
// Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import type { GatilhoTela } from './api-agravo.js';
import {
  acoesDoCaso,
  camposDoCanal,
  classeDoPrazoAgravo,
  entradaDoGatilho,
  horasAte,
  idadeEm,
  montarCasoManual,
  montarDescarte,
  montarGatilhoExame,
  montarNotificacaoAgravo,
  tempoDoPrazo,
} from './regras-agravo.js';

const GATILHO: GatilhoTela = {
  chave: 'exame:77:A90',
  origem: 'exame',
  atendimento: 948001,
  exame: 77,
  paciente: { id: 1001, nome: 'PACIENTE SINTETICO', prontuario: 501, nascimento: '1990-05-10', sexo: 'F' },
  cid: 'A90',
  nomeCid: 'DENGUE',
  periodicidade: 'semanal',
  gatilhoEm: '2026-10-20T10:15:00',
  prazoEm: '2026-10-27T10:15:00',
  estadoPrazo: 'noPrazo',
  exameNome: 'DENGUE NS1',
  resultado: 'REAGENTE',
  unidade: null,
};

describe('prazo', () => {
  it('horas até o prazo pelo relógio do servidor e o texto de vencer ou vencido', () => {
    expect(horasAte('2026-10-27T10:15:00', '2026-10-27T07:15')).toBe(3);
    expect(horasAte('2026-10-27T10:15', '2026-10-27T12:15:00')).toBe(-2);
    expect(tempoDoPrazo(3.5)).toEqual({ chave: 'venceEm', tempo: '3 h 30 min' });
    expect(tempoDoPrazo(-26)).toEqual({ chave: 'vencidoHa', tempo: '1 d 2 h' });
    expect(tempoDoPrazo(null)).toBeNull();
    expect(tempoDoPrazo(Number.NaN)).toBeNull();
  });

  it('a classe do prazo usa as cores do NSP (a cor nunca sozinha)', () => {
    expect(classeDoPrazoAgravo('vencido')).toBe('prazo prazo--vencido');
    expect(classeDoPrazoAgravo('vencendo')).toBe('prazo prazo--venceEmBreve');
    expect(classeDoPrazoAgravo('cumprido')).toBe('prazo prazo--cumprido');
    expect(classeDoPrazoAgravo('noPrazo')).toBe('prazo');
    expect(classeDoPrazoAgravo('naoSeAplica')).toBe('prazo');
  });
});

describe('abrir o caso', () => {
  it('pelo gatilho: tudo vem do gatilho; o exame só no resultado reagente', () => {
    expect(entradaDoGatilho(GATILHO)).toEqual({
      origem: 'exame',
      exame: 77,
      atendimento: 948001,
      paciente: 1001,
      cid: 'A90',
      gatilhoEm: '2026-10-20T10:15',
      observacao: null,
    });
    expect(entradaDoGatilho({ ...GATILHO, origem: 'cid', exame: 77 }, '  ').exame).toBeNull();
    expect(entradaDoGatilho({ ...GATILHO, origem: 'obito' }, ' visto ').observacao).toBe('visto');
  });

  it('sem sugestão: paciente, CID, data e hora e a descrição da suspeita', () => {
    const vazio = montarCasoManual({ paciente: null, cid: '', data: null, hora: null, observacao: '' });
    expect(vazio.ok).toBe(false);
    if (!vazio.ok)
      expect(Object.keys(vazio.erros).sort()).toEqual(['cid', 'gatilhoEm', 'observacao', 'paciente']);
    const curta = montarCasoManual({
      paciente: 1001,
      cid: 'a90',
      data: '2026-10-26',
      hora: '0930',
      observacao: 'febre',
    });
    expect(curta.ok).toBe(false);
    if (!curta.ok) expect(curta.erros.observacao).toMatch(/10 caracteres/);
    const ok = montarCasoManual({
      paciente: 1001,
      cid: 'a90',
      data: '2026-10-26',
      hora: '09:30',
      observacao: 'Comunicado pela unidade básica',
    });
    expect(ok).toEqual({
      ok: true,
      entrada: {
        origem: 'manual',
        exame: null,
        atendimento: null,
        paciente: 1001,
        cid: 'A90',
        gatilhoEm: '2026-10-26T09:30',
        observacao: 'Comunicado pela unidade básica',
      },
    });
  });
});

describe('notificar', () => {
  const base = {
    autoridade: 'SMS',
    canal: 'fichaImpressa',
    numero: '',
    data: '2026-10-27',
    hora: '08:00',
    recebidoPor: '',
    observacao: '',
  };
  it('ficha impressa: sem número nem quem recebeu; vai com a versão lida e sem o caso', () => {
    expect(montarNotificacaoAgravo(base, 3)).toEqual({
      ok: true,
      entrada: {
        versao: 3,
        autoridade: 'SMS',
        canal: 'fichaImpressa',
        numero: null,
        notificadoEm: '2026-10-27T08:00',
        recebidoPor: null,
        observacao: null,
      },
    });
  });
  it('Sinan exige o número; telefone exige quem recebeu; data e hora obrigatórias', () => {
    const sinan = montarNotificacaoAgravo({ ...base, canal: 'sinanOnline' }, 1);
    expect(!sinan.ok && sinan.erros.numero).toMatch(/número/);
    const letras = montarNotificacaoAgravo({ ...base, canal: 'sinanOnline', numero: '12a' }, 1);
    expect(!letras.ok && letras.erros.numero).toMatch(/dígitos/);
    const tel = montarNotificacaoAgravo({ ...base, canal: 'telefone', recebidoPor: 'x' }, 1);
    expect(!tel.ok && tel.erros.recebidoPor).toMatch(/quem recebeu/);
    const semData = montarNotificacaoAgravo({ ...base, autoridade: '', canal: '', data: null }, 1);
    expect(semData.ok).toBe(false);
    if (!semData.ok)
      expect(Object.keys(semData.erros)).toEqual(
        expect.arrayContaining(['autoridade', 'canal', 'notificadoEm']),
      );
  });
  it('os campos que o canal pede', () => {
    expect(camposDoCanal('sinanOnline')).toEqual({ numero: true, recebidoPor: false });
    expect(camposDoCanal('esusSinan')).toEqual({ numero: true, recebidoPor: false });
    expect(camposDoCanal('telefone')).toEqual({ numero: false, recebidoPor: true });
    expect(camposDoCanal('email')).toEqual({ numero: false, recebidoPor: true });
    expect(camposDoCanal('fichaImpressa')).toEqual({ numero: false, recebidoPor: false });
    expect(camposDoCanal('')).toEqual({ numero: false, recebidoPor: false });
  });
});

describe('descartar e configurar o exame', () => {
  it('descarte com motivo e justificativa de 10 caracteres', () => {
    const r = montarDescarte({ motivo: '', justificativa: 'curta' }, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['justificativa', 'motivo']);
    expect(montarDescarte({ motivo: 'jaNotificado', justificativa: '  Notificado pela UPA  ' }, 2)).toEqual({
      ok: true,
      entrada: { versao: 2, motivo: 'jaNotificado', justificativa: 'Notificado pela UPA' },
    });
  });
  it('exame: trecho de 3 letras e CID; a exceção vazia vira nula', () => {
    const r = montarGatilhoExame({
      gatilho: null,
      versao: null,
      padrao: 'ab',
      exceto: '',
      cid: '',
      ativo: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['cid', 'padrao']);
    expect(
      montarGatilhoExame({
        gatilho: 4,
        versao: 2,
        padrao: ' Dengue ',
        exceto: ' IgG ',
        cid: 'a90',
        ativo: false,
      }),
    ).toEqual({
      ok: true,
      entrada: { gatilho: 4, versao: 2, padrao: 'Dengue', exceto: 'IgG', cid: 'A90', ativo: false },
    });
  });
});

describe('situação e idade', () => {
  it('só o caso aberto se notifica ou descarta, e só com a permissão e a funcionalidade ligada', () => {
    expect(acoesDoCaso('aberto', true)).toEqual({ notificar: true, descartar: true });
    expect(acoesDoCaso('aberto', false)).toEqual({ notificar: false, descartar: false });
    expect(acoesDoCaso('notificado', true)).toEqual({ notificar: false, descartar: false });
    expect(acoesDoCaso('descartado', true)).toEqual({ notificar: false, descartar: false });
  });
  it('idade em anos completos na data do gatilho', () => {
    expect(idadeEm('1990-05-10', '2026-05-09T23:00')).toBe(35);
    expect(idadeEm('1990-05-10', '2026-05-10')).toBe(36);
    expect(idadeEm(null, '2026-05-10')).toBeNull();
    expect(idadeEm('2027-01-01', '2026-05-10')).toBeNull();
  });
});
