import { describe, expect, it } from 'vitest';
import {
  type AlergiaParaMudanca,
  RecusaMudancaAlergia,
  alteracaoDaAlergia,
  conferirEstadoLido,
  conferirReativacao,
  descricaoComparavel,
} from './alergia-mudanca.js';

const base: AlergiaParaMudanca = {
  id: 1,
  ativa: false,
  agente: 10,
  descricaoLivre: null,
  gravidade: 'leve',
  reacao: null,
  fonte: null,
  observacao: null,
  manifestacoes: [3],
};
const codigo = (f: () => unknown): string => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return e instanceof RecusaMudancaAlergia ? e.codigo : String(e);
  }
};

describe('reativação da alergia', () => {
  it('volta à lista quando o agente não está ativo em outra alergia', () => {
    expect(codigo(() => conferirReativacao(base, [{ id: 2, agente: 11, descricaoLivre: null }]))).toBe('ok');
  });
  it('recusa a alergia já ativa e o agente repetido (catálogo e descrição livre)', () => {
    expect(codigo(() => conferirReativacao({ ...base, ativa: true }, []))).toBe('ja-ativa');
    expect(codigo(() => conferirReativacao(base, [{ id: 2, agente: 10, descricaoLivre: null }]))).toBe(
      'duplicada',
    );
    const livre = { ...base, agente: null, descricaoLivre: 'Dipirona Sódica' };
    expect(
      codigo(() => conferirReativacao(livre, [{ id: 2, agente: null, descricaoLivre: ' dipirona  SODICA' }])),
    ).toBe('duplicada');
    expect(descricaoComparavel(null)).toBeNull();
  });
});

describe('alteração da alergia', () => {
  const ativa = { ...base, ativa: true };
  it('devolve só o que mudou e as manifestações a incluir e retirar', () => {
    const r = alteracaoDaAlergia(ativa, {
      gravidade: 'grave',
      reacao: '  urticária ',
      fonte: null,
      observacao: null,
      manifestacoes: [5, 5, 4],
    });
    expect(r.campos).toEqual({ gravidade: 'grave', reacao: 'urticária' });
    expect([r.incluir, r.retirar, r.manifestacoes]).toEqual([[4, 5], [3], [4, 5]]);
  });
  it('recusa a alergia retirada e o pedido sem mudança', () => {
    const igual = { gravidade: 'leve', reacao: ' ', fonte: null, observacao: null, manifestacoes: [3] };
    expect(codigo(() => alteracaoDaAlergia(base, igual))).toBe('ja-retirada');
    expect(codigo(() => alteracaoDaAlergia(ativa, igual))).toBe('sem-mudanca');
  });
});

describe('estado lido na alteração (concorrência)', () => {
  const ativa = { ...base, ativa: true, reacao: 'urticária', manifestacoes: [4, 3] };
  const lido = {
    gravidade: 'leve',
    reacao: ' urticária',
    fonte: null,
    observacao: '',
    manifestacoes: [3, 4, 4],
  };
  it('aceita o mesmo estado (ordem das manifestações e espaços não contam)', () => {
    expect(codigo(() => conferirEstadoLido(ativa, lido))).toBe('ok');
  });
  it('recusa quando outra pessoa mudou a gravidade ou uma manifestação depois da leitura', () => {
    expect(codigo(() => conferirEstadoLido({ ...ativa, gravidade: 'grave' }, lido))).toBe('estado-mudou');
    expect(codigo(() => conferirEstadoLido({ ...ativa, manifestacoes: [3] }, lido))).toBe('estado-mudou');
    expect(codigo(() => conferirEstadoLido({ ...ativa, fonte: 'relato_paciente' }, lido))).toBe(
      'estado-mudou',
    );
  });
});
