import { describe, expect, it } from 'vitest';
import { RecusaMicrobiologia } from './antibiograma.js';
import {
  conferirPainel,
  conferirPontoCorte,
  normaDoCadastro,
  type PontoCorteInformado,
  pontosAEncerrar,
  vespera,
} from './cadastro-antibiograma.js';

const codigo = (f: () => unknown) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return e instanceof RecusaMicrobiologia ? e.codigo : String(e);
  }
};

const cim: PontoCorteInformado = {
  microrganismo: 1,
  antimicrobiano: 2,
  material: null,
  metodo: 'concentracao_inibitoria',
  norma: 'brcast',
  versaoNorma: '2026',
  sensivelAte: 1,
  resistenteAcima: 4,
  haloSensivelMinimo: null,
  haloResistenteMaximo: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
};
const disco: PontoCorteInformado = {
  ...cim,
  metodo: 'disco_difusao',
  sensivelAte: null,
  resistenteAcima: null,
  haloSensivelMinimo: 20,
  haloResistenteMaximo: 15,
};

describe('ponto de corte', () => {
  it('normaliza a norma e recusa a desconhecida', () => {
    expect(normaDoCadastro(' clsi ')).toBe('CLSI');
    expect(conferirPontoCorte(cim).norma).toBe('BrCAST');
    expect(codigo(() => normaDoCadastro('NCCLS'))).toBe('norma-desconhecida');
  });
  it('CIM: precisa de limite, não leva halo, resistente não fica abaixo de sensível', () => {
    expect(codigo(() => conferirPontoCorte(cim))).toBe('ok');
    expect(codigo(() => conferirPontoCorte({ ...cim, sensivelAte: null, resistenteAcima: null }))).toBe(
      'ponto-sem-limite',
    );
    expect(codigo(() => conferirPontoCorte({ ...cim, haloSensivelMinimo: 10 }))).toBe(
      'ponto-metodo-misturado',
    );
    expect(codigo(() => conferirPontoCorte({ ...cim, sensivelAte: 8, resistenteAcima: 2 }))).toBe(
      'ponto-limites-invertidos',
    );
    expect(codigo(() => conferirPontoCorte({ ...cim, sensivelAte: 2, resistenteAcima: 2 }))).toBe('ok');
  });
  it('disco-difusão: precisa de halo, não leva CIM, halo de sensível acima do de resistente', () => {
    expect(codigo(() => conferirPontoCorte(disco))).toBe('ok');
    expect(
      codigo(() => conferirPontoCorte({ ...disco, haloSensivelMinimo: null, haloResistenteMaximo: null })),
    ).toBe('ponto-sem-limite');
    expect(codigo(() => conferirPontoCorte({ ...disco, sensivelAte: 1 }))).toBe('ponto-metodo-misturado');
    expect(
      codigo(() => conferirPontoCorte({ ...disco, haloSensivelMinimo: 10, haloResistenteMaximo: 15 })),
    ).toBe('ponto-limites-invertidos');
  });
  it('recusa versão vazia e vigência invertida', () => {
    expect(codigo(() => conferirPontoCorte({ ...cim, versaoNorma: ' ' }))).toBe('versao-norma');
    expect(codigo(() => conferirPontoCorte({ ...cim, vigenciaFim: '2025-12-31' }))).toBe(
      'vigencia-invertida',
    );
  });
});

describe('versão nova da norma', () => {
  const antigo = {
    id: 9,
    microrganismo: 1,
    antimicrobiano: 2,
    material: null,
    metodo: 'concentracao_inibitoria',
    norma: 'BrCAST',
    vigenciaInicio: '2024-01-01',
    vigenciaFim: null,
    ativo: true,
  };
  it('encerra na véspera o ponto que ainda vale', () => {
    expect(vespera('2026-03-01')).toBe('2026-02-28');
    expect(pontosAEncerrar([antigo], cim)).toEqual([{ id: 9, vigenciaFim: '2025-12-31' }]);
  });
  it('não mexe em outra norma, outro material, outro método, inativo ou já encerrado antes', () => {
    const outros = [
      { ...antigo, id: 1, norma: 'CLSI' },
      { ...antigo, id: 2, material: 7 },
      { ...antigo, id: 3, metodo: 'disco_difusao' },
      { ...antigo, id: 4, ativo: false },
      { ...antigo, id: 5, vigenciaFim: '2025-06-30' },
    ];
    expect(pontosAEncerrar(outros, cim)).toEqual([]);
  });
  it('encurta o que terminaria depois do início do novo', () => {
    expect(pontosAEncerrar([{ ...antigo, vigenciaFim: '2027-12-31' }], cim)).toEqual([
      { id: 9, vigenciaFim: '2025-12-31' },
    ]);
  });
  it('recusa a versão que começaria no mesmo dia ou antes da vigente', () => {
    expect(codigo(() => pontosAEncerrar([{ ...antigo, vigenciaInicio: '2026-01-01' }], cim))).toBe(
      'vigencia-sobreposta',
    );
    expect(codigo(() => pontosAEncerrar([{ ...antigo, vigenciaInicio: '2026-05-01' }], cim))).toBe(
      'vigencia-sobreposta',
    );
  });
});

describe('painel', () => {
  const item = (antimicrobiano: number, liberacaoRestrita = false) => ({
    antimicrobiano,
    exibeNoLaudo: true,
    liberacaoRestrita,
    indicaMultirresistencia: false,
  });
  it('numera na ordem da lista', () => {
    expect(conferirPainel([item(5), item(3, true)]).map((i) => [i.antimicrobiano, i.sequencia])).toEqual([
      [5, 1],
      [3, 2],
    ]);
  });
  it('recusa vazio, repetido e só restritos', () => {
    expect(codigo(() => conferirPainel([]))).toBe('painel-vazio');
    expect(codigo(() => conferirPainel([item(1), item(1)]))).toBe('painel-repetido');
    expect(codigo(() => conferirPainel([item(1, true), item(2, true)]))).toBe('painel-so-restritos');
  });
});
