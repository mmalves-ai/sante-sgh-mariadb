// Etapa 2 do M47 (regras 3 e 6): tipagem ABO e Rh com a prova direta e a reversa, dupla conferência da liberação,
// tipagem do receptor (a da agência prevalece; divergência bloqueia), prova cruzada e compatibilidade com a agência.
import { describe, expect, it } from 'vitest';
import {
  conferirBolsaDaAgenciaNoAto,
  conferirCompatibilidadeDaAgencia,
  conferirLiberacaoImuno,
  conferirProvaCruzada,
  interpretarAboRh,
  MENSAGENS_IMUNO,
  type ResultadoImunoResumo,
  tipagemDoReceptor,
} from './imuno.js';

const d = (antiA: number, antiB: number, antiD: number, controle = 0) => ({ antiA, antiB, antiD, controle });
const r = (hemaciaA1: number, hemaciaB: number) => ({ hemaciaA1, hemaciaB });

describe('interpretarAboRh', () => {
  it('os quatro grupos com a reversa concordante e o RhD', () => {
    expect(interpretarAboRh(d(4, 0, 4), r(0, 4)).tipagem).toEqual({ abo: 'A', rh: 'positivo' });
    expect(interpretarAboRh(d(0, 3, 0), r(4, 0)).tipagem).toEqual({ abo: 'B', rh: 'negativo' });
    expect(interpretarAboRh(d(4, 4, 2), r(0, 0)).tipagem).toEqual({ abo: 'AB', rh: 'positivo' });
    expect(interpretarAboRh(d(0, 0, 0), r(3, 4)).tipagem).toEqual({ abo: 'O', rh: 'negativo' });
  });
  it('discrepância entre direta e reversa, controle positivo e D fraco: tipagem nula', () => {
    expect(interpretarAboRh(d(4, 0, 4), r(4, 4))).toEqual({ tipagem: null, problemas: ['discrepancia-abo'] });
    expect(interpretarAboRh(d(0, 0, 4, 1), r(4, 4)).problemas).toEqual(['controle-positivo']);
    expect(interpretarAboRh(d(0, 0, 1), r(4, 4))).toEqual({ tipagem: null, problemas: ['rh-fraco'] });
  });
});

describe('conferirLiberacaoImuno', () => {
  const base = {
    estado: 'registrado' as const,
    tipo: 'aboRh' as const,
    registradoPor: 'BIO.A',
    liberador: 'BIO.B',
    tipagem: { abo: 'O' as const, rh: 'positivo' as const },
  };
  it('outro profissional libera o registrado conclusivo', () => {
    expect(conferirLiberacaoImuno(base)).toEqual([]);
  });
  it('o mesmo profissional, já liberado, invalidado ou inconclusivo: recusa', () => {
    expect(conferirLiberacaoImuno({ ...base, liberador: ' bio.a ' })).toEqual(['mesmo-profissional']);
    expect(conferirLiberacaoImuno({ ...base, estado: 'liberado' })).toEqual(['ja-liberado']);
    expect(conferirLiberacaoImuno({ ...base, estado: 'invalidado' })).toEqual(['invalidado']);
    expect(conferirLiberacaoImuno({ ...base, tipagem: null })).toEqual(['tipagem-inconclusiva']);
    expect(conferirLiberacaoImuno({ ...base, tipo: 'pai', tipagem: null })).toEqual([]);
  });
});

describe('tipagemDoReceptor', () => {
  const lib = (abo: 'A' | 'O', em: string): ResultadoImunoResumo => ({
    tipo: 'aboRh',
    estado: 'liberado',
    tipagem: { abo, rh: 'positivo' },
    pai: null,
    anticorpos: null,
    liberadoEm: em,
  });
  const cadastro = { abo: 'B' as const, rh: 'negativo' as const };
  it('a liberada pela agência prevalece sobre o cadastro', () => {
    const t = tipagemDoReceptor([lib('A', '2026-10-01T10:00')], cadastro);
    expect(t).toEqual({
      tipagem: { abo: 'A', rh: 'positivo' },
      origem: 'agencia',
      divergente: false,
      pai: null,
      anticorpos: null,
    });
  });
  it('duas liberadas que discordam: divergente, sem tipagem', () => {
    const t = tipagemDoReceptor([lib('A', '2026-10-01T10:00'), lib('O', '2026-10-02T10:00')], cadastro);
    expect(t.divergente).toBe(true);
    expect(t.tipagem).toEqual({ abo: null, rh: null });
  });
  it('sem a da agência: o cadastro (ponto de partida) ou nada; a registrada não vale', () => {
    const registrada = { ...lib('A', '2026-10-01T10:00'), estado: 'registrado' as const };
    expect(tipagemDoReceptor([registrada], cadastro).origem).toBe('cadastro');
    expect(tipagemDoReceptor([], { abo: null, rh: null })).toEqual({
      tipagem: { abo: null, rh: null },
      origem: null,
      divergente: false,
      pai: null,
      anticorpos: null,
    });
  });
  it('a pesquisa de anticorpos liberada mais recente acompanha', () => {
    const pai: ResultadoImunoResumo = {
      tipo: 'pai',
      estado: 'liberado',
      tipagem: null,
      pai: 'positivo',
      anticorpos: 'anti-E',
      liberadoEm: '2026-10-03T08:00',
    };
    expect(tipagemDoReceptor([pai], cadastro)).toMatchObject({ pai: 'positivo', anticorpos: 'anti-E' });
  });
});

describe('conferirProvaCruzada', () => {
  const base = {
    classe: 'hemacias' as const,
    amostraValidaAte: '2026-10-27T10:00',
    agora: '2026-10-25T10:00',
    bolsaNoEstoque: true,
    hemocomponenteDaBolsa: 'CH',
    hemocomponenteRequisitado: 'ch',
    estadoRequisicao: 'amostraColetada',
    pai: 'negativo' as const,
    faseAntiglobulina: false,
  };
  it('hemácias com amostra válida e bolsa do estoque: aceita', () => {
    expect(conferirProvaCruzada(base)).toEqual([]);
  });
  it('as recusas', () => {
    expect(conferirProvaCruzada({ ...base, classe: 'plaquetas' })).toEqual(['prova-so-hemacias']);
    expect(conferirProvaCruzada({ ...base, amostraValidaAte: null })).toEqual(['amostra-ausente']);
    expect(conferirProvaCruzada({ ...base, amostraValidaAte: '2026-10-25T09:00' })).toEqual([
      'amostra-vencida',
    ]);
    expect(conferirProvaCruzada({ ...base, bolsaNoEstoque: false })).toEqual(['bolsa-fora-do-estoque']);
    expect(conferirProvaCruzada({ ...base, hemocomponenteDaBolsa: 'CP' })).toEqual([
      'bolsa-de-outro-hemocomponente',
    ]);
    expect(conferirProvaCruzada({ ...base, estadoRequisicao: 'atendida' })).toEqual(['requisicao-encerrada']);
    expect(conferirProvaCruzada({ ...base, pai: 'positivo' })).toEqual(['antiglobulina-obrigatoria']);
    expect(conferirProvaCruzada({ ...base, pai: 'positivo', faseAntiglobulina: true })).toEqual([]);
  });
});

describe('conferirCompatibilidadeDaAgencia', () => {
  const receptor = {
    tipagem: { abo: 'A' as const, rh: 'positivo' as const },
    origem: 'agencia' as const,
    divergente: false,
    pai: null,
    anticorpos: null,
  };
  const prova = {
    bolsa: 'B123',
    requisicao: 7,
    estado: 'liberado' as const,
    resultado: 'compativel' as const,
  };
  const base = {
    classe: 'hemacias' as const,
    numeroBolsa: 'B123',
    requisicao: 7,
    extremaUrgencia: false,
    receptor,
    provas: [prova],
  };
  it('hemácias com a prova compatível liberada: passa', () => {
    expect(conferirCompatibilidadeDaAgencia(base)).toEqual({ bloqueios: [], alertas: [] });
  });
  it('sem a prova, com a incompatível, a de outra requisição ou a ainda não liberada: bloqueia', () => {
    expect(conferirCompatibilidadeDaAgencia({ ...base, provas: [] }).bloqueios).toEqual([
      'prova-cruzada-pendente',
    ]);
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, provas: [{ ...prova, resultado: 'incompativel' }] })
        .bloqueios,
    ).toEqual(['prova-incompativel']);
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, provas: [{ ...prova, requisicao: 8 }] }).bloqueios,
    ).toEqual(['prova-cruzada-pendente']);
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, provas: [{ ...prova, estado: 'registrado' }] }).bloqueios,
    ).toEqual(['prova-cruzada-pendente']);
  });
  it('extrema urgência sem prova: alerta; plaquetas não pedem prova', () => {
    expect(conferirCompatibilidadeDaAgencia({ ...base, provas: [], extremaUrgencia: true })).toEqual({
      bloqueios: [],
      alertas: ['sem-prova-cruzada'],
    });
    expect(conferirCompatibilidadeDaAgencia({ ...base, classe: 'plaquetas', provas: [] }).bloqueios).toEqual(
      [],
    );
  });
  it('tipagem só do cadastro ou divergente, e a pesquisa de anticorpos positiva', () => {
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, receptor: { ...receptor, origem: 'cadastro' } }).bloqueios,
    ).toEqual(['sem-tipagem-da-agencia']);
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, receptor: { ...receptor, divergente: true } }).bloqueios,
    ).toEqual(['tipagem-divergente']);
    expect(
      conferirCompatibilidadeDaAgencia({ ...base, receptor: { ...receptor, pai: 'positivo' } }).alertas,
    ).toEqual(['pai-positivo']);
  });
  it('toda recusa e todo alerta têm mensagem de produto', () => {
    for (const c of [
      'prova-cruzada-pendente',
      'prova-incompativel',
      'sem-prova-cruzada',
      'tipagem-divergente',
    ])
      expect(MENSAGENS_IMUNO[c]).toBeTruthy();
  });
});

describe('conferirBolsaDaAgenciaNoAto', () => {
  const receptor = {
    tipagem: { abo: 'A' as const, rh: 'positivo' as const },
    origem: 'agencia' as const,
    divergente: false,
    pai: null,
    anticorpos: null,
  };
  const etiqueta = {
    numero: 'B123',
    hemocomponente: 'CH',
    abo: 'O' as const,
    rh: 'positivo' as const,
    validade: '2026-11-20T00:00',
  };
  const bolsa = {
    situacao: 'reservada',
    reservadaPara: 7,
    hemocomponente: 'CH',
    abo: 'O' as const,
    rh: 'positivo' as const,
    validade: '2026-11-20T00:00:00',
  };
  const base = {
    bolsa,
    etiqueta,
    requisicao: 7,
    classe: 'hemacias' as const,
    extremaUrgencia: false,
    receptor,
    provas: [{ bolsa: 'B123', requisicao: 7, estado: 'liberado' as const, resultado: 'compativel' as const }],
  };
  it('a bolsa reservada para a requisição, com a prova compatível: passa com a situação do estoque', () => {
    expect(conferirBolsaDaAgenciaNoAto(base)).toEqual({ bloqueios: [], alertas: [], situacao: 'reservada' });
  });
  it('fora do estoque, etiqueta diferente, reservada para outra, hemácias sem reserva', () => {
    expect(conferirBolsaDaAgenciaNoAto({ ...base, bolsa: null }).bloqueios).toEqual([
      'bolsa-fora-do-estoque',
    ]);
    expect(conferirBolsaDaAgenciaNoAto({ ...base, etiqueta: { ...etiqueta, abo: 'A' } }).bloqueios).toEqual([
      'etiqueta-diferente-do-estoque',
    ]);
    expect(conferirBolsaDaAgenciaNoAto({ ...base, bolsa: { ...bolsa, reservadaPara: 8 } }).bloqueios).toEqual(
      ['bolsa-reservada-outra'],
    );
    expect(
      conferirBolsaDaAgenciaNoAto({ ...base, bolsa: { ...bolsa, situacao: 'liberada', reservadaPara: null } })
        .bloqueios,
    ).toEqual(['bolsa-sem-reserva']);
  });
  it('plaquetas liberadas passam sem reserva nem prova; extrema urgência com alerta', () => {
    expect(
      conferirBolsaDaAgenciaNoAto({
        ...base,
        classe: 'plaquetas',
        provas: [],
        bolsa: { ...bolsa, situacao: 'liberada', reservadaPara: null },
      }).bloqueios,
    ).toEqual([]);
    expect(
      conferirBolsaDaAgenciaNoAto({
        ...base,
        extremaUrgencia: true,
        provas: [],
        bolsa: { ...bolsa, situacao: 'liberada', reservadaPara: null },
      }),
    ).toEqual({ bloqueios: [], alertas: ['sem-prova-cruzada'], situacao: 'liberada' });
  });
});
