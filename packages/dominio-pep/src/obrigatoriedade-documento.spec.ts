import { describe, expect, it } from 'vitest';
import {
  type AtendimentoAvaliado,
  cidCoberto,
  idadeEmDias,
  pendenciasObrigatorias,
  type RegraObrigatoriedade,
  regraAplica,
  tipoAtendimentoDaCategoria,
  validarRegraObrigatoriedade,
} from './obrigatoriedade-documento.js';

const agora = new Date('2026-11-24T12:00:00.000Z');
const regra = (p: Partial<RegraObrigatoriedade> = {}): RegraObrigatoriedade => ({
  id: 1,
  modelo: 10,
  titulo: 'Escala de dor torácica',
  setor: null,
  sexo: null,
  tipoAtendimento: 'todos',
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  cids: [],
  momento: 'admissao',
  exigencia: 'bloquear',
  prazoMinutos: 120,
  intervaloDias: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const atendimento = (p: Partial<AtendimentoAvaliado> = {}): AtendimentoAvaliado => ({
  tipo: 'internacao',
  setor: 5,
  sexo: 1,
  nascimento: '1960-05-10',
  cids: ['I21.0'],
  entrada: '2026-11-24T06:00:00.000Z',
  altaMedica: null,
  saida: null,
  primeiraPrescricao: null,
  ...p,
});

describe('obrigatoriedade de documentos (03-PEP L132)', () => {
  it('valida a regra antes de gravar: faixa invertida, periódico sem intervalo, CID inválido e repetido', () => {
    const f = validarRegraObrigatoriedade({
      ...regra({
        idadeMinimaDias: 100,
        idadeMaximaDias: 10,
        momento: 'periodico',
        cids: ['I21', 'i21', 'XX'],
      }),
    });
    expect(f.map((x) => x.codigo).sort()).toEqual(
      ['cid-invalido', 'cid-repetido', 'faixa-etaria-invertida', 'periodico-sem-intervalo'].sort(),
    );
    expect(validarRegraObrigatoriedade(regra({ cids: ['I21', 'Z00.0'] }))).toEqual([]);
    expect(validarRegraObrigatoriedade(regra({ vigenciaFim: '2025-01-01' })).map((x) => x.codigo)).toEqual([
      'vigencia-invertida',
    ]);
    expect(validarRegraObrigatoriedade(regra({ intervaloDias: 2 })).map((x) => x.codigo)).toEqual([
      'intervalo-fora-do-periodico',
    ]);
  });

  it('CID pela categoria cobre o código completo; idade em dias completos', () => {
    expect(cidCoberto(['I21'], ['I21.0', 'E11'])).toBe('I210');
    expect(cidCoberto(['I210'], ['I21'])).toBeNull();
    expect(idadeEmDias('2026-11-20', agora)).toBe(4);
  });

  it('aplica por diagnóstico, idade, setor, sexo e tipo; sem nascimento a faixa etária não se presume', () => {
    expect(regraAplica(regra({ cids: ['I21'] }), atendimento(), agora)).toContain('diagnóstico I210');
    expect(regraAplica(regra({ cids: ['J18'] }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ idadeMinimaDias: 65 * 365 }), atendimento(), agora)).toContain('faixa etária');
    expect(regraAplica(regra({ idadeMaximaDias: 28 }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ idadeMaximaDias: 28 }), atendimento({ nascimento: null }), agora)).toBeNull();
    expect(regraAplica(regra({ setor: 6 }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ sexo: 2 }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ tipoAtendimento: 'urgencia' }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ ativo: false }), atendimento(), agora)).toBeNull();
    expect(regraAplica(regra({ vigenciaInicio: '2027-01-01' }), atendimento(), agora)).toBeNull();
  });

  it('pendência com prazo e vencimento; documento feito no atendimento resolve', () => {
    const [p] = pendenciasObrigatorias([regra({ cids: ['I21'] })], atendimento(), [], agora);
    expect(p).toMatchObject({
      regra: 1,
      modelo: 10,
      exigencia: 'bloquear',
      prazo: '2026-11-24T08:00:00.000Z',
      vencida: true,
    });
    expect(
      pendenciasObrigatorias(
        [regra()],
        atendimento(),
        [{ modelo: 10, em: '2026-11-24T07:00:00.000Z' }],
        agora,
      ),
    ).toEqual([]);
    // Documento de outro atendimento (antes da entrada) não conta.
    expect(
      pendenciasObrigatorias(
        [regra()],
        atendimento(),
        [{ modelo: 10, em: '2026-11-20T07:00:00.000Z' }],
        agora,
      ),
    ).toHaveLength(1);
  });

  it('momento da alta só exige depois da alta médica; periódico exige a cada ciclo', () => {
    const alta = regra({ momento: 'alta', prazoMinutos: null });
    expect(pendenciasObrigatorias([alta], atendimento(), [], agora)).toEqual([]);
    const [p] = pendenciasObrigatorias(
      [alta],
      atendimento({ altaMedica: '2026-11-24T11:00:00.000Z' }),
      [],
      agora,
    );
    expect(p).toMatchObject({ prazo: null, vencida: false, exigidoDesde: '2026-11-24T11:00:00.000Z' });
    const periodica = regra({ momento: 'periodico', intervaloDias: 1, prazoMinutos: 60 });
    const a = atendimento({ entrada: '2026-11-22T10:00:00.000Z' });
    const ontem = [{ modelo: 10, em: '2026-11-23T11:00:00.000Z' }];
    const [c] = pendenciasObrigatorias([periodica], a, ontem, agora);
    expect(c).toMatchObject({ exigidoDesde: '2026-11-24T10:00:00.000Z', vencida: true });
    expect(
      pendenciasObrigatorias(
        [periodica],
        a,
        [...ontem, { modelo: 10, em: '2026-11-24T10:30:00.000Z' }],
        agora,
      ),
    ).toEqual([]);
  });

  it('regra de todos os estabelecimentos não aceita setor; atendimento encerrado não abre ciclo periódico novo', () => {
    const global = {
      ...regra({ setor: 5 }),
      todosEstabelecimentos: true,
    };
    expect(validarRegraObrigatoriedade(global).map((f) => f.codigo)).toEqual(['setor-em-regra-global']);
    expect(validarRegraObrigatoriedade({ ...global, setor: null })).toEqual([]);
    expect(validarRegraObrigatoriedade({ ...global, todosEstabelecimentos: false })).toEqual([]);
    // Saída em 23/11 15h: o ciclo que vale é o de 23/11 10h, não o de 24/11 (o atendimento já fechou).
    const periodica = regra({ momento: 'periodico', intervaloDias: 1, prazoMinutos: 60 });
    const encerrado = atendimento({ entrada: '2026-11-22T10:00:00.000Z', saida: '2026-11-23T15:00:00.000Z' });
    const [c] = pendenciasObrigatorias([periodica], encerrado, [], agora);
    expect(c).toMatchObject({ exigidoDesde: '2026-11-23T10:00:00.000Z', vencida: true });
    expect(
      pendenciasObrigatorias([periodica], encerrado, [{ modelo: 10, em: '2026-11-23T11:00:00.000Z' }], agora),
    ).toEqual([]);
    // O documento do fechamento continua exigido depois da saída.
    const [f] = pendenciasObrigatorias([regra({ momento: 'fechamento_atendimento' })], encerrado, [], agora);
    expect(f).toMatchObject({ exigidoDesde: '2026-11-23T15:00:00.000Z', vencida: true });
  });

  it('ordena vencidas e bloqueantes primeiro e não repete o mesmo documento no mesmo momento', () => {
    const l = pendenciasObrigatorias(
      [
        regra({ id: 1, modelo: 11, exigencia: 'alertar', prazoMinutos: null }),
        regra({ id: 2, modelo: 10, prazoMinutos: 60 }),
        regra({ id: 3, modelo: 10, cids: ['I21'] }),
      ],
      atendimento(),
      [],
      agora,
    );
    expect(l.map((x) => x.regra)).toEqual([2, 1]);
    expect(tipoAtendimentoDaCategoria('pronto_atendimento')).toBe('urgencia');
    expect(tipoAtendimentoDaCategoria('telessaude')).toBe('ambulatorial');
  });
});
