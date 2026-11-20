// Ouvidoria: protocolo, prazo em dias úteis, estado do prazo, recusas e NPS com as parcelas.
import { describe, expect, it } from 'vitest';
import {
  estadoPrazoManifestacao,
  npsDasNotas,
  prazoRespostaOuvidoria,
  protocoloManifestacao,
  recusaAndamentoManifestacao,
  recusaRegistroManifestacao,
  recusaResposta,
} from './ouvidoria.js';

describe('protocolo e prazo', () => {
  it('protocolo pelo ano do recebimento e o número da sequência', () => {
    expect(protocoloManifestacao('2026-10-27T10:00', 42)).toBe('OUV-2026-000042');
    expect(protocoloManifestacao('2027-01-02T08:00', 1_000_123)).toBe('OUV-2027-000123');
  });
  it('dez dias úteis depois do recebimento, pulando o fim de semana e os feriados', () => {
    // Terça 27/10/2026: úteis 28, 29, 30 (sex), 3/11 (02/11 feriado de Finados), 4, 5, 6, 9, 10, 11 → 11/11.
    const feriados = new Set(['2026-11-02']);
    expect(prazoRespostaOuvidoria('2026-10-27T10:00', feriados)).toBe('2026-11-11T23:59:59');
    // Sem o feriado: 10/11.
    expect(prazoRespostaOuvidoria('2026-10-27T10:00', new Set())).toBe('2026-11-10T23:59:59');
    expect(prazoRespostaOuvidoria('2026-10-30T18:00', new Set(), 1)).toBe('2026-11-02T23:59:59');
  });
  it('estado do prazo', () => {
    const m = { situacao: 'aberta' as const, prazoEm: '2026-11-10T23:59:59', respondidaEm: null };
    expect(estadoPrazoManifestacao(m, '2026-11-01T10:00')).toBe('noPrazo');
    expect(estadoPrazoManifestacao(m, '2026-11-10T08:00')).toBe('vencendo');
    expect(estadoPrazoManifestacao(m, '2026-11-11T00:00')).toBe('vencido');
    expect(
      estadoPrazoManifestacao(
        { ...m, situacao: 'respondida', respondidaEm: '2026-11-05T10:00' },
        '2026-12-01T00:00',
      ),
    ).toBe('cumprido');
    expect(
      estadoPrazoManifestacao(
        { ...m, situacao: 'respondida', respondidaEm: '2026-11-12T10:00' },
        '2026-12-01T00:00',
      ),
    ).toBe('respondidaComAtraso');
  });
});

describe('recusas', () => {
  it('recebimento: não futuro e até 60 dias', () => {
    expect(recusaRegistroManifestacao('2026-10-27T09:00', '2026-10-27T10:00')).toBeNull();
    expect(recusaRegistroManifestacao('2026-10-27T11:00', '2026-10-27T10:00')).toBe('recebida-no-futuro');
    expect(recusaRegistroManifestacao('2026-08-27T09:00', '2026-10-27T10:00')).toBe('recebida-antiga');
  });
  it('andamento: só a não respondida, na versão lida', () => {
    expect(recusaAndamentoManifestacao({ versao: 1, situacao: 'aberta' }, 1)).toBeNull();
    expect(recusaAndamentoManifestacao({ versao: 2, situacao: 'encaminhada' }, 1)).toBe(
      'versao-desatualizada',
    );
    expect(recusaAndamentoManifestacao({ versao: 2, situacao: 'respondida' }, 2)).toBe(
      'manifestacao-respondida',
    );
  });
  it('reclamação e denúncia dizem se procedem', () => {
    expect(recusaResposta('reclamacao', null)).toBe('procedencia-obrigatoria');
    expect(recusaResposta('denuncia', false)).toBeNull();
    expect(recusaResposta('elogio', null)).toBeNull();
  });
});

describe('NPS', () => {
  it('(promotores − detratores) ÷ respostas × 100, com as parcelas', () => {
    // 10, 9, 9 promotores; 8, 7 neutros; 6, 3, 0 detratores → (3 − 3) ÷ 8 = 0.
    expect(npsDasNotas('2026-09', [10, 9, 9, 8, 7, 6, 3, 0])).toEqual({
      competencia: '2026-09',
      respostas: 8,
      promotores: 3,
      neutros: 2,
      detratores: 3,
      nps: 0,
      conta: '(3 − 3) ÷ 8 × 100 = 0',
    });
    // 2 promotores, 1 detrator em 3: 33,3.
    expect(npsDasNotas('2026-09', [10, 9, 2]).conta).toBe('(2 − 1) ÷ 3 × 100 = 33,3');
  });
  it('sem resposta: sem NPS', () => {
    expect(npsDasNotas('2026-09', [])).toMatchObject({ respostas: 0, nps: null, conta: null });
  });
});
