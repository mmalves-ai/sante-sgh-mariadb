// Unidade da porta própria das integrações do worker: as conversões puras (situação, causa da falha, chave do evento,
// versão da vacina, hora local) e o ciclo do worker sem cliente configurado. O SQL roda no porta-propria.int.spec.
import { describe, expect, it } from 'vitest';
import { clientesDoAmbiente } from './integracao.service.js';
import {
  categoriaDaFalha,
  chaveEvento,
  horaLocal,
  situacaoDoEnvio,
  type VacinaParaRia,
  vacinaNaVersao,
} from './porta-propria.js';

describe('porta própria das integrações (unidade)', () => {
  it('a situação da mensagem de saída no vocabulário da fila', () => {
    expect(
      ['pendente', 'enviando', 'enviada', 'confirmada', 'erro', 'rejeitada', 'expirada', 'cancelada'].map(
        situacaoDoEnvio,
      ),
    ).toEqual(['pendente', 'pendente', 'enviado', 'enviado', 'morto', 'morto', 'morto', 'descartado']);
  });

  it('a causa da falha pela resposta curta (sem conteúdo)', () => {
    expect(categoriaDaFalha('tempo esgotado')).toBe('tempo_esgotado');
    expect(categoriaDaFalha('destino indisponível (TypeError)')).toBe('indisponibilidade');
    expect(categoriaDaFalha('HTTP 503')).toBe('indisponibilidade');
    expect(categoriaDaFalha('AE: Exame sem de-para no laboratório')).toBe('regra_negocio');
    expect(categoriaDaFalha('HTTP 422')).toBe('regra_negocio');
    expect(categoriaDaFalha('parceiro sem destino configurado')).toBe('validacao');
    expect(categoriaDaFalha('xyz')).toBe('desconhecida');
  });

  it('a chave do evento é o resumo da chave composta (64 hexadecimais, estável)', () => {
    const k = chaveEvento('fato:resultado.liberado:pc:10:20261022100000000');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveEvento('fato:resultado.liberado:pc:10:20261022100000000')).toBe(k);
  });

  it('a vacina na versão: a última retificação até ela, nunca fora da lista', () => {
    const v = (lote: string) => ({
      id: 7,
      imunobiologico: '33',
      nome: 'Vacina sintetica',
      lote,
      fabricante: null,
      dose: 'D1',
      via: 'IM',
      local: 'DD',
      aplicadaEm: '2031-01-06T09:00',
      vacinador: '41',
    });
    const x: VacinaParaRia = { paciente: 5, versoes: [v('A'), v('B')] };
    expect([0, 1, 2, 9, -1].map((n) => vacinaNaVersao(x, n).lote)).toEqual(['A', 'B', 'B', 'B', 'A']);
  });

  it('a hora local no fuso do estabelecimento e a lista de clientes do ambiente', () => {
    const d = new Date('2026-10-25T12:30:00Z');
    expect(horaLocal(d, 'America/Sao_Paulo')).toBe('2026-10-25T09:30');
    expect(horaLocal(d, 'America/Manaus')).toBe('2026-10-25T08:30');
    expect(horaLocal(d, 'America/Rio_Branco')).toBe('2026-10-25T07:30');
    expect(horaLocal(d, 'America/Noronha')).toBe('2026-10-25T10:30');
    expect(horaLocal(new Date('2026-10-25T02:10:00Z'), 'America/Manaus')).toBe('2026-10-24T22:10');
    expect(clientesDoAmbiente(' f22_o5, X!, cliente_b ,')).toEqual(['f22_o5', 'cliente_b']);
    expect(clientesDoAmbiente(undefined)).toEqual([]);
  });
});
