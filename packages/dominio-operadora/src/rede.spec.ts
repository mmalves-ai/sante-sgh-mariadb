// Regras da rede credenciada (M56, etapa 4, F3): documento (CPF, CNPJ numérico e alfanumérico), CNES, município na
// UF, tipo × pessoa, contratação indireta, contrato, o próprio hospital, domínios lidos, movimento do RPS e o
// descredenciamento (aviso de 30 dias, substituto hospitalar, autorização da ANS). Documentos SINTÉTICOS (dígitos
// verificadores calculados aqui), nenhum de pessoa ou empresa real.
import { MOVIMENTO_RPS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  camposRpsMudados,
  cnpjValidoAlfanumerico,
  conferirDescredenciamento,
  type DadosPrestador,
  documentoExibido,
  documentoPrestadorValido,
  type DominiosRede,
  efetivoMinimo,
  movimentoDaAcao,
  municipioNaUf,
  normalizarDocumento,
  podeAlterar,
  podeReincluir,
  prestadorHospitalar,
  problemasDoPrestador,
  situacaoVigente,
  valoresRps,
} from './rede.js';

/** CNPJ sintético com os dígitos calculados (base de 12 posições, letras ou números). */
function cnpj(base: string): string {
  const dv = (b: string) => {
    let s = 0;
    let p = 2;
    for (let i = b.length - 1; i >= 0; i--) {
      s += (b.charCodeAt(i) - 48) * p;
      p = p === 9 ? 2 : p + 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const a = base + String(dv(base));
  return a + String(dv(a));
}

const CNPJ = cnpj('900000010001');
const CPF = '52998224725';

const todos = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1));
const DOMINIOS: DominiosRede = {
  tipo: todos(8),
  natureza: todos(5),
  classificacao: todos(3),
  contratacao: todos(2),
  disponibilidade: todos(2),
  isencaoOnus: todos(3),
  regime: todos(3),
  remuneracao: todos(7),
  formaReajuste: todos(8),
};
const REDE = new Set(['pc', 'hs']);

const base: DadosPrestador = {
  pessoa: 'J',
  documento: CNPJ,
  nome: 'Clínica Sintética',
  cnes: '9000001',
  uf: 'SC',
  municipioIbge: 4205407,
  tipo: 2,
  natureza: 1,
  classificacao: 3,
  contratacao: 1,
  operadoraIntermediaria: null,
  disponibilidade: 1,
  isencaoOnus: 1,
  urgencia: false,
  regime: 1,
  remuneracao: 1,
  contrato: { numero: 'C-1', inicio: '2026-11-01', fim: null, formaReajuste: 1, mesReajuste: 11 },
  ehOHospital: false,
  estabelecimento: null,
};
const codigos = (p: Partial<DadosPrestador>) =>
  problemasDoPrestador({ ...base, ...p }, DOMINIOS, REDE).map((x) => `${x.codigo}:${x.campo}`);

describe('documento do prestador', () => {
  it('CNPJ numérico e alfanumérico pelo módulo 11 (valor do caractere menos 48)', () => {
    expect(cnpjValidoAlfanumerico('11.222.333/0001-81')).toBe(true);
    expect(cnpjValidoAlfanumerico('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValidoAlfanumerico(cnpj('SINTETICO0A1'))).toBe(true);
    expect(cnpjValidoAlfanumerico('12ABC34501DE36')).toBe(false);
    expect(cnpjValidoAlfanumerico('11222333000182')).toBe(false);
    expect(cnpjValidoAlfanumerico('11111111111111')).toBe(false);
    expect(cnpjValidoAlfanumerico('12ABC34501DEXX')).toBe(false);
    expect(cnpjValidoAlfanumerico('123')).toBe(false);
  });
  it('CPF só para pessoa física; CNPJ só para jurídica', () => {
    expect(documentoPrestadorValido('F', '529.982.247-25')).toBe(true);
    expect(documentoPrestadorValido('F', '52998224724')).toBe(false);
    expect(documentoPrestadorValido('F', CNPJ)).toBe(false);
    expect(documentoPrestadorValido('J', CPF)).toBe(false);
    expect(documentoPrestadorValido('J', CNPJ)).toBe(true);
    expect(normalizarDocumento(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
  });
  it('na lista, o CPF mascarado; o CNPJ por inteiro', () => {
    expect(documentoExibido('F', CPF, true)).toBe('***.***.247-25');
    expect(documentoExibido('F', CPF, false)).toBe('529.982.247-25');
    expect(documentoExibido('J', '11222333000181', true)).toBe('11.222.333/0001-81');
  });
});

describe('credenciamento', () => {
  it('o caso completo não tem problema', () => {
    expect(codigos({})).toEqual([]);
    expect(codigos({ pessoa: 'F', documento: CPF, tipo: 1, cnes: null })).toEqual([]);
  });
  it('documento, tipo × pessoa, CNES e município', () => {
    expect(codigos({ documento: '11222333000182' })).toEqual(['documento-invalido:documento']);
    expect(codigos({ pessoa: 'F', documento: CPF, tipo: 3, cnes: null })).toEqual([
      'pessoa-incompativel-com-tipo:tipo',
    ]);
    expect(codigos({ cnes: null })).toEqual(['cnes-obrigatorio:cnes']);
    expect(codigos({ cnes: '' })).toEqual(['cnes-obrigatorio:cnes']);
    expect(codigos({ cnes: '12345' })).toEqual(['cnes-invalido:cnes']);
    expect(codigos({ pessoa: 'F', documento: CPF, tipo: 5, cnes: '12A4567' })).toEqual([
      'cnes-invalido:cnes',
    ]);
    expect(codigos({ municipioIbge: 3550308 })).toEqual(['municipio-fora-da-uf:municipioIbge']);
    expect(codigos({ uf: 'XX' })).toEqual(['municipio-fora-da-uf:municipioIbge']);
  });
  it('códigos fora do domínio lido, inclusive a forma de reajuste do contrato', () => {
    expect(codigos({ tipo: 9, natureza: 6, remuneracao: 8 })).toEqual([
      'dominio-invalido:tipo',
      'dominio-invalido:natureza',
      'dominio-invalido:remuneracao',
    ]);
    expect(codigos({ contrato: { ...base.contrato, formaReajuste: 99 } })).toEqual([
      'dominio-invalido:contrato.formaReajuste',
    ]);
  });
  it('contratação indireta só com a intermediária (6 dígitos), e a intermediária só na indireta', () => {
    expect(codigos({ contratacao: 2 })).toEqual(['intermediaria-obrigatoria:operadoraIntermediaria']);
    expect(codigos({ contratacao: 2, operadoraIntermediaria: '12345' })).toEqual([
      'intermediaria-invalida:operadoraIntermediaria',
    ]);
    expect(codigos({ contratacao: 2, operadoraIntermediaria: '123456' })).toEqual([]);
    expect(codigos({ operadoraIntermediaria: '123456' })).toEqual([
      'intermediaria-so-na-indireta:operadoraIntermediaria',
    ]);
  });
  it('contrato com o fim antes do início', () => {
    expect(codigos({ contrato: { ...base.contrato, fim: '2026-10-31' } })).toEqual([
      'contrato-fim-antes-do-inicio:contrato.fim',
    ]);
    expect(codigos({ contrato: { ...base.contrato, fim: '2026-11-01' } })).toEqual([]);
  });
  it('o próprio hospital: pessoa jurídica, com um estabelecimento da Rede', () => {
    expect(codigos({ ehOHospital: true, estabelecimento: 'pc', tipo: 3, classificacao: 1 })).toEqual([]);
    expect(codigos({ ehOHospital: true })).toEqual(['hospital-sem-estabelecimento:estabelecimento']);
    expect(codigos({ ehOHospital: true, estabelecimento: 'zz' })).toEqual([
      'estabelecimento-fora-da-rede:estabelecimento',
    ]);
    expect(
      codigos({ ehOHospital: true, estabelecimento: 'pc', pessoa: 'F', documento: CPF, tipo: 1, cnes: null }),
    ).toEqual(['hospital-pessoa-juridica:pessoa']);
    expect(codigos({ estabelecimento: 'pc' })).toEqual(['estabelecimento-so-do-hospital:estabelecimento']);
  });
  it('município na UF e prestador hospitalar', () => {
    expect(municipioNaUf('SC', 4205407)).toBe(true);
    expect(municipioNaUf('SP', 4205407)).toBe(false);
    expect(municipioNaUf('SC', 4205407.5)).toBe(false);
    expect(prestadorHospitalar({ tipo: 3, classificacao: 3 })).toBe(true);
    expect(prestadorHospitalar({ tipo: 2, classificacao: 1 })).toBe(true);
    expect(prestadorHospitalar({ tipo: 2, classificacao: 2 })).toBe(false);
  });
});

describe('movimento do RPS', () => {
  it('inclusão, exclusão e reinclusão sempre; alteração só quando muda um campo do RPS', () => {
    expect(movimentoDaAcao('credenciar')).toBe(MOVIMENTO_RPS.inclusao);
    expect(movimentoDaAcao('descredenciar')).toBe(MOVIMENTO_RPS.exclusao);
    expect(movimentoDaAcao('reincluir')).toBe(MOVIMENTO_RPS.reinclusao);
    expect(movimentoDaAcao('alterar', [])).toBeNull();
    expect(movimentoDaAcao('alterar')).toBeNull();
    expect(movimentoDaAcao('alterar', ['cnes'])).toBe(MOVIMENTO_RPS.alteracao);
  });
  it('compara o nome sem caixa e sem espaços nas pontas; vazio é o mesmo que nulo', () => {
    const a = valoresRps(base);
    expect(camposRpsMudados(a, valoresRps({ ...base, nome: '  CLÍNICA SINTÉTICA ' }))).toEqual([]);
    expect(camposRpsMudados(a, valoresRps({ ...base, cnes: '9000002', urgencia: true }))).toEqual([
      'cnes',
      'urgencia',
    ]);
    expect(camposRpsMudados(valoresRps({ ...base, operadoraIntermediaria: '' }), valoresRps(base))).toEqual(
      [],
    );
    // Contrato, remuneração e regime não vão ao RPS.
    expect(
      camposRpsMudados(a, valoresRps({ ...base, ...{ regime: 2, remuneracao: 3 } } as DadosPrestador)),
    ).toEqual([]);
  });
});

describe('descredenciamento', () => {
  const HOJE = '2026-10-24';
  const hosp = {
    id: 1,
    situacao: 'credenciado' as const,
    saidaEm: null as string | null,
    tipo: 3,
    classificacao: 1,
    uf: 'SC',
    municipioIbge: 4205407,
  };
  const clinica = { ...hosp, id: 2, tipo: 2, classificacao: 3 };
  const pedido = {
    efetivoEm: '2026-11-23',
    avisoBeneficiariosEm: HOJE,
    substituto: null as number | null,
    autorizacaoAns: null as string | null,
  };
  const conferir = (p: typeof hosp, x: Partial<typeof pedido>, s: typeof hosp | null = null) =>
    conferirDescredenciamento(p, { ...pedido, ...x }, s, HOJE);

  it('o prazo: 30 dias do aviso; a data efetiva de hoje em diante; o aviso não fica no futuro', () => {
    expect(efetivoMinimo('2026-10-24')).toBe('2026-11-23');
    expect(conferir(clinica, {}).problemas).toEqual([]);
    expect(conferir(clinica, { efetivoEm: '2026-11-22' }).problemas).toEqual(['prazo-do-aviso']);
    expect(conferir(clinica, { efetivoEm: '2026-10-23' }).problemas).toEqual([
      'efetivo-no-passado',
      'prazo-do-aviso',
    ]);
    expect(
      conferir(clinica, { avisoBeneficiariosEm: '2026-10-25', efetivoEm: '2026-12-31' }).problemas,
    ).toEqual(['aviso-no-futuro']);
    expect(conferir({ ...clinica, situacao: 'descredenciado' as never }, {}).problemas).toEqual([
      'ja-descredenciado',
    ]);
  });
  it('o hospitalar só sai com substituto hospitalar credenciado na mesma UF ou com a autorização da ANS', () => {
    expect(conferir(hosp, {}).problemas).toEqual(['substituto-obrigatorio']);
    expect(conferir(hosp, { autorizacaoAns: '  ' }).problemas).toEqual(['substituto-obrigatorio']);
    expect(conferir(hosp, { autorizacaoAns: '33910.000001/2026-01' })).toEqual({
      problemas: [],
      avisos: ['reducao-autorizada'],
    });
    const outro = { ...hosp, id: 3 };
    expect(conferir(hosp, { substituto: 3 }, outro)).toEqual({ problemas: [], avisos: [] });
    expect(conferir(hosp, { substituto: 1 }, hosp).problemas).toEqual(['substituto-ele-mesmo']);
    expect(conferir(hosp, { substituto: 9 }, null).problemas).toEqual(['substituto-inexistente']);
    expect(
      conferir(hosp, { substituto: 3 }, { ...outro, situacao: 'descredenciado' as never }).problemas,
    ).toEqual(['substituto-descredenciado']);
    expect(conferir(hosp, { substituto: 3 }, { ...outro, tipo: 2, classificacao: 3 }).problemas).toEqual([
      'substituto-nao-hospitalar',
    ]);
    expect(
      conferir(hosp, { substituto: 3 }, { ...outro, uf: 'PR', municipioIbge: 4106902 }).problemas,
    ).toEqual(['substituto-outra-uf']);
    expect(conferir(hosp, { substituto: 3 }, { ...outro, municipioIbge: 4209102 })).toEqual({
      problemas: [],
      avisos: ['substituto-outro-municipio'],
    });
  });
  it('o não hospitalar sai sem substituto; com substituto, qualquer tipo serve', () => {
    expect(conferir(clinica, {})).toEqual({ problemas: [], avisos: [] });
    expect(conferir(clinica, { substituto: 3 }, { ...clinica, id: 3, tipo: 4 })).toEqual({
      problemas: [],
      avisos: [],
    });
  });
  it('a saída agendada: não se agenda de novo nem serve de substituto', () => {
    expect(conferir({ ...clinica, saidaEm: '2026-12-31' }, {}).problemas).toEqual(['saida-ja-agendada']);
    expect(conferir(hosp, { substituto: 3 }, { ...hosp, id: 3, saidaEm: '2026-12-31' }).problemas).toEqual([
      'substituto-com-saida-agendada',
    ]);
  });
  it('a situação vigente: o descredenciado com a data no futuro segue credenciado até ela', () => {
    expect(situacaoVigente('descredenciado', '2026-11-23', HOJE)).toEqual({
      situacao: 'credenciado',
      saidaEm: '2026-11-23',
    });
    expect(situacaoVigente('descredenciado', HOJE, HOJE)).toEqual({
      situacao: 'descredenciado',
      saidaEm: null,
    });
    expect(situacaoVigente('descredenciado', '2026-10-01', HOJE)).toEqual({
      situacao: 'descredenciado',
      saidaEm: null,
    });
    expect(situacaoVigente('credenciado', '2026-01-01', HOJE)).toEqual({
      situacao: 'credenciado',
      saidaEm: null,
    });
  });
  it('a reinclusão do descredenciado ou da saída agendada; a alteração só do credenciado sem saída', () => {
    expect(podeReincluir({ situacao: 'descredenciado', saidaEm: null })).toBe(true);
    expect(podeReincluir({ situacao: 'credenciado', saidaEm: '2026-12-31' })).toBe(true);
    expect(podeReincluir({ situacao: 'credenciado', saidaEm: null })).toBe(false);
    expect(podeAlterar({ situacao: 'credenciado', saidaEm: null })).toBe(true);
    expect(podeAlterar({ situacao: 'credenciado', saidaEm: '2026-12-31' })).toBe(false);
    expect(podeAlterar({ situacao: 'descredenciado', saidaEm: null })).toBe(false);
  });
});
