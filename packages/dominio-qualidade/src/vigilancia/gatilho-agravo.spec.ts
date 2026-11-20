// Gatilhos da notificação compulsória (regra 8): CID registrado, resultado reagente e óbito. Dados sintéticos.
import type { GatilhoExameLido, PacienteAgravo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type CasoExistente,
  type CidCadastro,
  chaveGatilho,
  cidDoExame,
  cidNotificavel,
  ehResultadoReagente,
  type EntradaFilaAgravos,
  GATILHOS_EXAME_PADRAO,
  gatilhosExameVigentes,
  montarFilaAgravos,
  normalizarTexto,
} from './gatilho-agravo.js';

const cadastro = new Map<string, CidCadastro>(
  [
    { cid: 'A90', nome: 'DENGUE [DENGUE CLASSICO]', periodicidade: 'semanal' as const },
    { cid: 'A150', nome: 'TUBERCULOSE PULMONAR (SINTETICO)', periodicidade: 'semanal' as const },
    { cid: 'A820', nome: 'RAIVA SILVESTRE', periodicidade: 'imediata' as const },
    { cid: 'A821', nome: 'RAIVA URBANA', periodicidade: 'semanal' as const },
    { cid: 'B24', nome: 'DOENCA PELO HIV NAO ESPECIFICADA', periodicidade: 'semanal' as const },
  ].map((c) => [c.cid, c]),
);
const pac = (id: number): PacienteAgravo => ({
  id,
  nome: `PACIENTE SINTETICO ${String(id)}`,
  prontuario: id * 10,
  nascimento: '1990-05-01',
  sexo: 'F',
});

describe('texto e resultado', () => {
  it('normaliza acento, caixa e espaços', () => {
    expect(normalizarTexto('  Hepatite B - HBsAg  - antígeno ')).toBe('HEPATITE B - HBSAG - ANTIGENO');
  });
  it('reagente, positivo e detectável sim; não reagente, negativo, indeterminado não', () => {
    for (const r of ['REAGENTE', 'Reagente (0,09)', 'POSITIVO', 'Detectável', 'DETECTADO'])
      expect(ehResultadoReagente(r), r).toBe(true);
    for (const r of [
      'NãO REAGENTE',
      'NAO  REAGENTE',
      'Não reagente (0,01)',
      'NEGATIVO',
      'NÃO DETECTÁVEL',
      'INDETERMINADO',
      'Inconclusivo',
      'FRACAMENTE REAGENTE',
      '',
      null,
      undefined,
    ])
      expect(ehResultadoReagente(r), String(r)).toBe(false);
  });
});

describe('exame → agravo', () => {
  it('lista padrão: IgM e NS1 da dengue sim, IgG não; HIV, sífilis, hepatites', () => {
    const g = gatilhosExameVigentes([]);
    expect(g).toBe(GATILHOS_EXAME_PADRAO);
    expect(cidDoExame('DENGUE IGM', g)).toBe('A90');
    expect(cidDoExame('ANTIGENO NS1 DO VIRUS DA DENGUE, PESQUISA', g)).toBe('A90');
    expect(cidDoExame('DENGUE IGG', g)).toBeNull();
    expect(cidDoExame('HIV 1/2, ANTICORPOS (TESTE RAPIDO)', g)).toBe('B24');
    expect(cidDoExame('VDRL', g)).toBe('A539');
    expect(cidDoExame('SIFILIS - FTA-ABS-IGG - PESQUISA', g)).toBeNull();
    expect(cidDoExame('SIFILIS - FTA-ABS-IGM - PESQUISA', g)).toBe('A539');
    expect(cidDoExame('HEPATITE B - HBSAG - ANTÍGENO AUSTRÁLIA', g)).toBe('B169');
    expect(cidDoExame('HEPATITE C - ANTI - HCV', g)).toBe('B171');
    expect(cidDoExame('HEPATITE A - IGM', g)).toBe('B159');
    expect(cidDoExame('TROPONINA I', g)).toBeNull();
  });
  it('a configuração do estabelecimento substitui a padrão; inativo não vale', () => {
    const conf: GatilhoExameLido[] = [
      { id: 1, versao: 1, padrao: 'Influenza', exceto: null, cid: 'J11', ativo: false, fonte: 'configurado' },
      { id: 2, versao: 1, padrao: 'dengue', exceto: null, cid: 'A90', ativo: true, fonte: 'configurado' },
    ];
    const g = gatilhosExameVigentes(conf);
    expect(cidDoExame('INFLUENZA PESQUISA RAPIDA A E B', g)).toBeNull();
    expect(cidDoExame('DENGUE IGG', g)).toBe('A90');
    expect(cidDoExame('HIV 1/2', g)).toBeNull();
  });
});

describe('CID no cadastro de notificáveis', () => {
  it('exato, pela categoria de 3 caracteres (a mais restritiva das subcategorias) e a subcategoria pela categoria', () => {
    expect(cidNotificavel('A90', cadastro)?.periodicidade).toBe('semanal');
    expect(cidNotificavel('A82', cadastro)).toEqual({
      cid: 'A82',
      nome: 'RAIVA SILVESTRE',
      periodicidade: 'imediata',
    });
    expect(cidNotificavel('A909', cadastro)?.cid).toBe('A90');
    expect(cidNotificavel('A151', cadastro)).toBeNull();
    expect(cidNotificavel('J18', cadastro)).toBeNull();
  });
});

describe('fila de gatilhos', () => {
  const base: EntradaFilaAgravos = {
    cids: [],
    exames: [],
    obitos: [],
    cadastro,
    gatilhosExame: GATILHOS_EXAME_PADRAO,
    casos: [],
    agora: '2026-10-27T12:00',
  };

  it('CID notificável vira gatilho com o prazo da periodicidade; o não notificável não', () => {
    const f = montarFilaAgravos({
      ...base,
      cids: [
        { atendimento: 1, paciente: pac(1), unidade: 'PS', cid: 'A90', registradoEm: '2026-10-26T10:00' },
        { atendimento: 2, paciente: pac(2), unidade: 'PS', cid: 'J18', registradoEm: '2026-10-26T10:00' },
        { atendimento: 3, paciente: pac(3), unidade: 'UTI', cid: 'A820', registradoEm: '2026-10-27T09:00' },
      ],
    });
    expect(f.map((g) => g.chave)).toEqual(['cid:3:A820', 'cid:1:A90']);
    expect(f[0]).toMatchObject({
      periodicidade: 'imediata',
      prazoEm: '2026-10-28T09:00:00',
      estadoPrazo: 'noPrazo',
      nomeCid: 'RAIVA SILVESTRE',
      unidade: 'UTI',
      exame: null,
    });
    expect(f[1]).toMatchObject({ periodicidade: 'semanal', prazoEm: '2026-11-02T10:00:00' });
  });

  it('registro com data depois de agora não vira sugestão (até 5 minutos de tolerância do relógio)', () => {
    const f = montarFilaAgravos({
      ...base,
      cids: [
        { atendimento: 1, paciente: pac(1), unidade: 'PS', cid: 'A90', registradoEm: '2026-10-27T12:04' },
        { atendimento: 2, paciente: pac(2), unidade: 'PS', cid: 'A90', registradoEm: '2026-10-27T12:06' },
        { atendimento: 3, paciente: pac(3), unidade: 'PS', cid: 'A90', registradoEm: '2026-11-03T08:00' },
      ],
    });
    expect(f.map((g) => g.chave)).toEqual(['cid:1:A90']);
  });

  it('resultado reagente de exame configurado vira gatilho (semanal se o CID não estiver no cadastro)', () => {
    const f = montarFilaAgravos({
      ...base,
      exames: [
        {
          exame: 900,
          atendimento: 10,
          paciente: pac(10),
          unidade: null,
          nomeExame: 'VDRL',
          resultado: '  REAGENTE (1:8) ',
          liberadoEm: '2026-10-25T08:00',
        },
        {
          exame: 901,
          atendimento: 11,
          paciente: pac(11),
          unidade: null,
          nomeExame: 'HIV 1/2',
          resultado: 'NÃO REAGENTE',
          liberadoEm: '2026-10-25T08:00',
        },
        {
          exame: 902,
          atendimento: 12,
          paciente: pac(12),
          unidade: null,
          nomeExame: 'TROPONINA I',
          resultado: 'REAGENTE',
          liberadoEm: '2026-10-25T08:00',
        },
        {
          exame: 903,
          atendimento: 13,
          paciente: pac(13),
          unidade: null,
          nomeExame: 'HIV 1/2',
          resultado: 'REAGENTE',
          liberadoEm: '2026-10-25T09:00',
        },
      ],
    });
    expect(f.map((g) => g.chave)).toEqual(['exame:900:A539', 'exame:903:B24']);
    expect(f[0]).toMatchObject({
      periodicidade: 'semanal',
      nomeCid: 'A539',
      exameNome: 'VDRL',
      resultado: 'REAGENTE (1:8)',
      exame: 900,
    });
    expect(f[1]?.nomeCid).toBe('DOENCA PELO HIV NAO ESPECIFICADA');
  });

  it('óbito com CID notificável é imediato e absorve o CID do mesmo atendimento; sem CID notificável, nada', () => {
    const f = montarFilaAgravos({
      ...base,
      agora: '2026-10-27T12:00',
      cids: [
        { atendimento: 5, paciente: pac(5), unidade: 'UTI', cid: 'A90', registradoEm: '2026-10-20T10:00' },
      ],
      obitos: [
        { atendimento: 5, paciente: pac(5), unidade: 'UTI', cid: 'A90', obitoEm: '2026-10-27T03:00' },
        { atendimento: 6, paciente: pac(6), unidade: 'UTI', cid: 'I219', obitoEm: '2026-10-27T03:00' },
      ],
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      chave: 'obito:5:A90',
      origem: 'obito',
      periodicidade: 'imediata',
      prazoEm: '2026-10-28T03:00:00',
      estadoPrazo: 'noPrazo',
    });
  });

  it('o mesmo agravo do mesmo paciente aparece uma vez (o gatilho mais antigo define o prazo); vencido marcado', () => {
    const f = montarFilaAgravos({
      ...base,
      agora: '2026-11-05T12:00',
      cids: [
        { atendimento: 21, paciente: pac(7), unidade: null, cid: 'A90', registradoEm: '2026-10-28T10:00' },
        { atendimento: 20, paciente: pac(7), unidade: null, cid: 'A90', registradoEm: '2026-10-26T10:00' },
      ],
      exames: [
        {
          exame: 950,
          atendimento: 20,
          paciente: pac(7),
          unidade: null,
          nomeExame: 'DENGUE IGM',
          resultado: 'REAGENTE',
          liberadoEm: '2026-10-27T10:00',
        },
      ],
    });
    expect(f.map((g) => [g.chave, g.estadoPrazo])).toEqual([['cid:20:A90', 'vencido']]);
  });

  it('o que já virou caso não volta: pela chave (mesmo descartado) e pelo mesmo agravo do paciente em 30 dias', () => {
    const casos: CasoExistente[] = [
      {
        origem: 'cid',
        atendimento: 30,
        exame: null,
        paciente: 30,
        cid: 'A90',
        situacao: 'descartado',
        gatilhoEm: '2026-10-20T10:00',
      },
      {
        origem: 'manual',
        atendimento: null,
        exame: null,
        paciente: 31,
        cid: 'A909',
        situacao: 'notificado',
        gatilhoEm: '2026-10-01T10:00',
      },
      {
        origem: 'exame',
        atendimento: 32,
        exame: 777,
        paciente: 32,
        cid: 'B24',
        situacao: 'aberto',
        gatilhoEm: '2026-08-01T10:00',
      },
    ];
    const f = montarFilaAgravos({
      ...base,
      casos,
      cids: [
        // Mesma chave do descartado: some.
        { atendimento: 30, paciente: pac(30), unidade: null, cid: 'A90', registradoEm: '2026-10-20T10:00' },
        // Mesmo agravo (A90 x A909) notificado há 26 dias: some.
        { atendimento: 31, paciente: pac(31), unidade: null, cid: 'A90', registradoEm: '2026-10-27T10:00' },
        // Caso de 87 dias atrás: fora da janela, volta.
        { atendimento: 33, paciente: pac(32), unidade: null, cid: 'B24', registradoEm: '2026-10-27T10:00' },
        // Paciente com descartado de outra chave e agravo: volta (descartado não segura).
        { atendimento: 34, paciente: pac(30), unidade: null, cid: 'A90', registradoEm: '2026-10-26T09:00' },
      ],
      exames: [
        {
          exame: 777,
          atendimento: 32,
          paciente: pac(32),
          unidade: null,
          nomeExame: 'HIV',
          resultado: 'REAGENTE',
          liberadoEm: '2026-08-01T10:00',
        },
      ],
    });
    expect(f.map((g) => g.chave)).toEqual(['cid:34:A90', 'cid:33:B24']);
  });

  it('chave estável do gatilho', () => {
    expect(chaveGatilho('exame', 12, 'A90')).toBe('exame:12:A90');
  });
});
