// Fluxo da notificação no NSP (M48, etapa 1): triagem, distribuição, devolutiva, descarte e transcrição no Notivisa.
import { describe, expect, it } from 'vitest';
import {
  conferirDescarte,
  conferirDevolutiva,
  conferirDistribuicao,
  conferirOcorrencia,
  conferirTranscricaoNotivisa,
  conferirTriagem,
  situacaoNotivisa,
  type EstadoNotificacao,
} from './fluxo.js';

const recebida: EstadoNotificacao = {
  protocolo: 'NSP-2026-000010',
  situacao: 'recebida',
  versao: 1,
  ocorridoEm: '2026-10-18T03:40:00',
  tipo: 'queda',
  classificacao: 'eventoAdverso',
  dano: 'leve',
  neverEvent: false,
  triada: false,
  notivisaExportadaEm: null,
  notivisaTranscritaEm: null,
};
const triada: EstadoNotificacao = { ...recebida, situacao: 'triada', versao: 2, triada: true };

const triagem = {
  versao: 1,
  tipo: 'queda' as const,
  classificacao: 'eventoAdverso' as const,
  dano: 'leve' as const,
  neverEvent: false,
  justificativa: null,
};

describe('triagem', () => {
  it('confirma sem mudança (evento triada) e corrige com justificativa (triada e reclassificada)', () => {
    expect(conferirTriagem(recebida, triagem)).toEqual({
      ok: true,
      valor: { eventos: ['triada'], mudou: false },
    });
    expect(
      conferirTriagem(recebida, {
        ...triagem,
        dano: 'moderado',
        justificativa: 'Fratura confirmada na imagem.',
      }),
    ).toEqual({ ok: true, valor: { eventos: ['triada', 'reclassificada'], mudou: true } });
  });

  it('reclassifica a já triada; sem mudança não gera evento', () => {
    expect(conferirTriagem(triada, { ...triagem, versao: 2 })).toEqual({
      ok: true,
      valor: { eventos: [], mudou: false },
    });
    expect(
      conferirTriagem(triada, {
        ...triagem,
        versao: 2,
        neverEvent: true,
        justificativa: 'Never event pela lista.',
      }),
    ).toEqual({ ok: true, valor: { eventos: ['reclassificada'], mudou: true } });
  });

  it('recusa versão velha, situação final, incoerência e mudança sem justificativa', () => {
    expect(conferirTriagem(recebida, { ...triagem, versao: 0 })).toEqual({
      ok: false,
      motivo: 'versao-desatualizada',
    });
    expect(conferirTriagem({ ...recebida, situacao: 'descartada' }, triagem)).toEqual({
      ok: false,
      motivo: 'situacao-nao-permite',
    });
    expect(conferirTriagem(recebida, { ...triagem, classificacao: 'quaseErro' })).toEqual({
      ok: false,
      motivo: 'dano-sem-ter-atingido',
    });
    expect(conferirTriagem(recebida, { ...triagem, tipo: 'medicacao', justificativa: 'curta' })).toEqual({
      ok: false,
      motivo: 'justificativa-obrigatoria',
    });
  });
});

describe('distribuição', () => {
  it('distribui a triada e redistribui a distribuída; recusa a recebida, o prazo no passado e a versão velha', () => {
    const d = { versao: 2, prazoAnalise: '2026-11-10' };
    expect(conferirDistribuicao(triada, d, '2026-10-19')).toEqual({
      ok: true,
      valor: { evento: 'distribuida' },
    });
    expect(conferirDistribuicao({ ...triada, situacao: 'distribuida' }, d, '2026-10-19').ok).toBe(true);
    expect(conferirDistribuicao(recebida, { ...d, versao: 1 }, '2026-10-19')).toEqual({
      ok: false,
      motivo: 'situacao-nao-permite',
    });
    expect(conferirDistribuicao(triada, { ...d, prazoAnalise: '2026-10-18' }, '2026-10-19')).toEqual({
      ok: false,
      motivo: 'prazo-no-passado',
    });
    expect(conferirDistribuicao(triada, { ...d, versao: 1 }, '2026-10-19').ok).toBe(false);
  });
});

describe('devolutiva', () => {
  it('depois da triagem (inclusive descartada); nunca na recebida', () => {
    expect(conferirDevolutiva(triada, 2)).toEqual({ ok: true, valor: { evento: 'devolutiva' } });
    expect(conferirDevolutiva({ ...triada, situacao: 'descartada' }, 2).ok).toBe(true);
    expect(conferirDevolutiva(recebida, 1)).toEqual({ ok: false, motivo: 'situacao-nao-permite' });
    expect(conferirDevolutiva(triada, 1)).toEqual({ ok: false, motivo: 'versao-desatualizada' });
  });
});

describe('descarte', () => {
  it('descarta com motivo; duplicada exige outro protocolo', () => {
    expect(conferirDescarte(recebida, { versao: 1, motivo: 'naoEIncidente', duplicadaDe: null })).toEqual({
      ok: true,
      valor: { evento: 'descartada' },
    });
    expect(conferirDescarte(recebida, { versao: 1, motivo: 'duplicada', duplicadaDe: null })).toEqual({
      ok: false,
      motivo: 'duplicada-sem-protocolo',
    });
    expect(
      conferirDescarte(recebida, { versao: 1, motivo: 'duplicada', duplicadaDe: 'NSP-2026-000010' }),
    ).toEqual({ ok: false, motivo: 'duplicada-de-si-mesma' });
    expect(
      conferirDescarte(
        { ...triada, situacao: 'distribuida' },
        { versao: 2, motivo: 'outroCanal', duplicadaDe: null },
      ),
    ).toEqual({ ok: false, motivo: 'situacao-nao-permite' });
    expect(conferirDescarte(recebida, { versao: 9, motivo: 'outroCanal', duplicadaDe: null }).ok).toBe(false);
  });
});

describe('transcrição no Notivisa', () => {
  const agora = '2026-10-20T12:00:00';
  it('registra uma vez, depois da triagem, sem instante futuro nem anterior à ocorrência', () => {
    expect(
      conferirTranscricaoNotivisa(triada, { versao: 2, transcritaEm: '2026-10-20T10:00:00' }, agora),
    ).toEqual({ ok: true, valor: { evento: 'notivisaTranscrita' } });
    expect(
      conferirTranscricaoNotivisa(recebida, { versao: 1, transcritaEm: '2026-10-20T10:00:00' }, agora),
    ).toEqual({ ok: false, motivo: 'situacao-nao-permite' });
    expect(
      conferirTranscricaoNotivisa(
        { ...triada, notivisaTranscritaEm: '2026-10-19T10:00:00' },
        { versao: 2, transcritaEm: '2026-10-20T10:00:00' },
        agora,
      ),
    ).toEqual({ ok: false, motivo: 'ja-transcrita' });
    expect(
      conferirTranscricaoNotivisa(triada, { versao: 2, transcritaEm: '2026-10-21T10:00:00' }, agora),
    ).toEqual({ ok: false, motivo: 'instante-futuro' });
    expect(
      conferirTranscricaoNotivisa(triada, { versao: 2, transcritaEm: '2026-10-17T10:00:00' }, agora),
    ).toEqual({ ok: false, motivo: 'antes-da-ocorrencia' });
    expect(
      conferirTranscricaoNotivisa(triada, { versao: 1, transcritaEm: '2026-10-20T10:00:00' }, agora).ok,
    ).toBe(false);
  });
});

describe('ocorrência e situação no Notivisa', () => {
  it('ocorrência: tolera 5 minutos do relógio; recusa futuro e mais de um ano', () => {
    expect(conferirOcorrencia('2026-10-20T12:04:00', '2026-10-20T12:00:00')).toBeNull();
    expect(conferirOcorrencia('2026-10-20T12:06:00', '2026-10-20T12:00:00')).toBe('instante-futuro');
    expect(conferirOcorrencia('2025-10-01T12:00:00', '2026-10-20T12:00:00')).toBe('muito-antigo');
  });

  it('pendente, exportada, transcrita e não obrigatória', () => {
    const b = { classificacao: 'eventoAdverso' as const, situacao: 'triada' as const };
    expect(situacaoNotivisa({ ...b, notivisaExportadaEm: null, notivisaTranscritaEm: null })).toBe(
      'pendente',
    );
    expect(
      situacaoNotivisa({ ...b, notivisaExportadaEm: '2026-10-20T10:00:00', notivisaTranscritaEm: null }),
    ).toBe('exportada');
    expect(
      situacaoNotivisa({
        ...b,
        notivisaExportadaEm: '2026-10-20T10:00:00',
        notivisaTranscritaEm: '2026-10-20T11:00:00',
      }),
    ).toBe('transcrita');
    expect(
      situacaoNotivisa({
        ...b,
        situacao: 'descartada',
        notivisaExportadaEm: null,
        notivisaTranscritaEm: null,
      }),
    ).toBe('naoObrigatoria');
    expect(
      situacaoNotivisa({
        classificacao: 'quaseErro',
        situacao: 'triada',
        notivisaExportadaEm: null,
        notivisaTranscritaEm: null,
      }),
    ).toBe('naoObrigatoria');
  });
});
