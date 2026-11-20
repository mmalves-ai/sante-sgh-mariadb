// Regra 18 do M45 (etapa 4): o registro da vacina aplicada — o imunobiológico do estabelecimento, o lote na validade, a
// dose uma vez só por paciente (o reforço repete), a aplicação até 15 dias atrás e nunca no futuro, o prazo do envio RIA
// de 24 horas e a situação do envio pelo conector do M34. Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  chaveDaDose,
  conferirVacina,
  doseRepete,
  lerImunobiologicos,
  prazoEnvioRia,
  situacaoDoEnvio,
} from './vacina.js';

const IMUNOS = lerImunobiologicos('99:Vacina sintética A;98:Vacina sintética B;xx;99:repetida');
const AGORA = '2026-10-22T13:00';
const e = {
  imunobiologico: '99',
  lote: 'LOTE-SINT-1',
  fabricante: null,
  validadeLote: '2027-01-31',
  dose: 'D1' as const,
  via: 'IM',
  local: 'DD',
  aplicadaEm: null,
};

describe('regra 18: a vacina aplicada', () => {
  it('lê os imunobiológicos do parâmetro (sem repetir o código)', () => {
    expect(IMUNOS).toEqual([
      { codigo: '99', nome: 'Vacina sintética A' },
      { codigo: '98', nome: 'Vacina sintética B' },
    ]);
  });

  it('confere: a aplicação agora e o prazo do envio em 24 horas', () => {
    expect(conferirVacina(e, { agora: AGORA, imunobiologicos: IMUNOS, jaAplicadas: [] })).toEqual({
      ok: true,
      imunobiologico: { codigo: '99', nome: 'Vacina sintética A' },
      aplicadaEm: AGORA,
      prazoEnvio: '2026-10-23T13:00',
    });
    expect(prazoEnvioRia('2026-10-31T23:30')).toBe('2026-11-01T23:30');
  });

  it('recusa o imunobiológico de fora, a aplicação futura ou antiga, o lote vencido e a dose repetida', () => {
    const o = {
      agora: AGORA,
      imunobiologicos: IMUNOS,
      jaAplicadas: [{ imunobiologico: '99', dose: 'D1' as const }],
    };
    expect(conferirVacina({ ...e, imunobiologico: '01' }, o)).toMatchObject({
      codigo: 'imunobiologico-desconhecido',
    });
    expect(conferirVacina({ ...e, aplicadaEm: '2026-10-22T14:00' }, o)).toMatchObject({
      codigo: 'aplicacao-futura',
    });
    expect(conferirVacina({ ...e, aplicadaEm: '2026-10-01T08:00' }, o)).toMatchObject({
      codigo: 'aplicacao-antiga',
    });
    expect(conferirVacina({ ...e, validadeLote: '2026-10-21', dose: 'D2' }, o)).toMatchObject({
      codigo: 'lote-vencido',
    });
    expect(conferirVacina(e, o)).toMatchObject({ codigo: 'dose-ja-registrada' });
    expect(
      conferirVacina({ ...e, dose: 'REF' }, { ...o, jaAplicadas: [{ imunobiologico: '99', dose: 'REF' }] })
        .ok,
    ).toBe(true);
    expect(conferirVacina({ ...e, imunobiologico: '98' }, o).ok).toBe(true);
  });

  it('a chave da dose: uma por paciente, imunobiológico e dose; o reforço sem chave', () => {
    expect(chaveDaDose('pc', 7, '99', 'D1')).toBe('pc:7:99:D1');
    expect(chaveDaDose('pc', 7, '99', 'R1')).toBeNull();
    expect(doseRepete('DU')).toBe(false);
  });

  it('a situação do envio RIA: aguarda o conector, na fila, enviado ou falhou; vencido depois do prazo', () => {
    const base = { prazo: '2026-10-23T13:00', agora: AGORA };
    expect(situacaoDoEnvio({ ...base, conectorLigado: false, evento: 'pendente', entrega: null })).toEqual({
      situacao: 'aguardandoConector',
      vencido: false,
    });
    expect(
      situacaoDoEnvio({ ...base, conectorLigado: true, evento: 'publicado', entrega: 'pendente' }).situacao,
    ).toBe('naFila');
    expect(
      situacaoDoEnvio({ ...base, conectorLigado: true, evento: 'publicado', entrega: 'enviado' }).situacao,
    ).toBe('enviado');
    expect(situacaoDoEnvio({ ...base, conectorLigado: true, evento: 'morto', entrega: null }).situacao).toBe(
      'falhou',
    );
    expect(
      situacaoDoEnvio({ ...base, conectorLigado: true, evento: 'publicado', entrega: 'descartado' }).situacao,
    ).toBe('falhou');
    expect(
      situacaoDoEnvio({
        prazo: '2026-10-22T12:00',
        agora: AGORA,
        conectorLigado: false,
        evento: 'pendente',
        entrega: null,
      }),
    ).toEqual({ situacao: 'aguardandoConector', vencido: true });
    expect(
      situacaoDoEnvio({
        prazo: '2026-10-22T12:00',
        agora: AGORA,
        conectorLigado: true,
        evento: 'publicado',
        entrega: 'enviado',
      }).vencido,
    ).toBe(false);
  });
});
