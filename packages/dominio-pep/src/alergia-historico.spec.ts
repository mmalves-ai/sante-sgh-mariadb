import { describe, expect, it } from 'vitest';
import {
  type EstadoAlergia,
  eventoDaAlergia,
  linhaDoTempoDaAlergia,
  manifestacoesDoPedido,
  RecusaHistoricoAlergia,
} from './alergia-historico.js';

const estado = (x: Partial<EstadoAlergia> = {}): EstadoAlergia => ({
  tipoRegistro: 'alergia',
  alergeno: 7,
  descricaoLivre: false,
  gravidade: 'grave',
  certeza: null,
  fonte: 'relato_paciente',
  ativa: true,
  principios: [3, 1, 3],
  manifestacoes: [9, 2],
  ...x,
});

const codigo = (f: () => unknown): string => {
  try {
    f();
    return 'sem-erro';
  } catch (e) {
    return e instanceof RecusaHistoricoAlergia ? e.codigo : String(e);
  }
};

describe('eventoDaAlergia', () => {
  it('inclusão grava o estado depois da mudança, com ids em ordem e sem texto livre', () => {
    const e = eventoDaAlergia('inclusao', estado({ descricaoLivre: true }));
    expect(e.operacao).toBe('inclusao');
    expect(e.evento).toBe('inclusao');
    expect(e.motivo).toBeNull();
    expect(JSON.parse(e.dados)).toEqual({
      tipoRegistro: 'alergia',
      alergeno: 7,
      descricaoLivre: true,
      gravidade: 'grave',
      certeza: null,
      fonte: 'relato_paciente',
      ativa: true,
      principios: [1, 3],
      manifestacoes: [2, 9],
    });
  });

  it('inativação exige motivo de 10 caracteres e a alergia já inativa', () => {
    expect(codigo(() => eventoDaAlergia('inativacao', estado({ ativa: false }), 'curto'))).toBe(
      'motivo-curto',
    );
    expect(codigo(() => eventoDaAlergia('inativacao', estado(), 'Informação corrigida'))).toBe(
      'estado-incoerente',
    );
    const e = eventoDaAlergia('inativacao', estado({ ativa: false }), '  Informação corrigida  ');
    expect(e.operacao).toBe('alteracao');
    expect(e.motivo).toBe('Informação corrigida');
  });

  it('reativação exige motivo e a alergia ativa; a declaração "nega" entra como inclusão', () => {
    expect(codigo(() => eventoDaAlergia('reativacao', estado(), null))).toBe('motivo-curto');
    expect(codigo(() => eventoDaAlergia('reativacao', estado({ ativa: false }), 'Reação observada'))).toBe(
      'estado-incoerente',
    );
    expect(
      eventoDaAlergia(
        'inclusao',
        estado({
          tipoRegistro: 'nega_alergias',
          alergeno: null,
          ativa: false,
          principios: [],
          manifestacoes: [],
        }),
      ).evento,
    ).toBe('inclusao');
  });
});

describe('manifestacoesDoPedido', () => {
  it('sem repetição e em ordem; nega sem manifestação; no máximo 10', () => {
    expect(manifestacoesDoPedido(false, [5, 2, 5])).toEqual([2, 5]);
    expect(manifestacoesDoPedido(false, undefined)).toEqual([]);
    expect(manifestacoesDoPedido(true, [])).toEqual([]);
    expect(codigo(() => manifestacoesDoPedido(true, [1]))).toBe('manifestacao-em-declaracao');
    expect(codigo(() => manifestacoesDoPedido(false, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBe(
      'manifestacoes-demais',
    );
  });
});

describe('linhaDoTempoDaAlergia', () => {
  it('da mais antiga para a mais recente, com título em português', () => {
    const l = linhaDoTempoDaAlergia([
      { id: 2, evento: 'inativacao', ocorridoEm: '2026-11-24T10:00', profissional: 'B', motivo: 'Corrigida' },
      { id: 1, evento: 'inclusao', ocorridoEm: '2026-11-24T09:00', profissional: 'A', motivo: null },
    ]);
    expect(l.map((p) => p.titulo)).toEqual(['Registrada', 'Retirada da lista']);
    expect(l[1]!.motivo).toBe('Corrigida');
  });
});
