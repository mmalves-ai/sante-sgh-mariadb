import { describe, expect, it } from 'vitest';
import {
  consumirFaixa,
  errosConfiguracaoTiss,
  errosFaixa,
  faixaNoFim,
  faixaParaEmitir,
  formatarNumeroGuia,
  tipoFaixaDaGuia,
  vigenciasQueCruzam,
} from './configuracao.js';

const cnpjFalso = (c: string) => c === '11222333000181';
const base = {
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  registroAns: '123456',
  identificacaoPrestador: 'codigo_operadora' as const,
  codigoPrestadorOperadora: 'P-001',
  cnpjContratado: null,
  razaoSocialContratado: null,
  limiteGuiasLote: 100,
  diasRetornoConsulta: 30,
  faturamentoEletronico: true,
  reapresentacaoEletronica: false,
  retornoEletronico: true,
  elegibilidadeEletronica: false,
  exigeElegibilidade: false,
  somenteArquivo: false,
  imprimeVersoGuia: false,
};

describe('configuração TISS', () => {
  it('aceita a configuração coerente', () => {
    expect(errosConfiguracaoTiss(base, cnpjFalso)).toEqual([]);
  });
  it('devolve todos os erros de uma vez', () => {
    expect(
      errosConfiguracaoTiss(
        {
          ...base,
          vigenciaFim: '2025-12-31',
          registroAns: '12',
          codigoPrestadorOperadora: null,
          cnpjContratado: '11222333000182',
          limiteGuiasLote: 101,
          diasRetornoConsulta: 400,
          faturamentoEletronico: false,
          reapresentacaoEletronica: true,
          elegibilidadeEletronica: true,
          somenteArquivo: true,
          imprimeVersoGuia: true,
        },
        cnpjFalso,
      ),
    ).toEqual([
      'vigencia-invertida',
      'registro-ans-invalido',
      'codigo-prestador-obrigatorio',
      'cnpj-contratado-invalido',
      'contratado-incompleto',
      'limite-lote-invalido',
      'dias-retorno-invalido',
      'reapresentacao-sem-faturamento-eletronico',
      'retorno-sem-faturamento-eletronico',
      'elegibilidade-eletronica-sem-exigencia',
      'somente-arquivo-sem-faturamento-eletronico',
      'verso-sem-guia-impressa',
    ]);
  });
  it('vigências que cruzam', () => {
    const atuais = [
      { id: 1, inicio: '2025-01-01', fim: '2025-12-31' },
      { id: 2, inicio: '2026-01-01', fim: null },
    ];
    expect(vigenciasQueCruzam(atuais, { inicio: '2026-06-01', fim: null }).map((v) => v.id)).toEqual([2]);
    expect(vigenciasQueCruzam(atuais, { id: 2, inicio: '2026-06-01', fim: null })).toEqual([]);
    expect(vigenciasQueCruzam(atuais.slice(0, 1), { inicio: '2026-01-01', fim: null })).toEqual([]);
  });
});

describe('faixa de numeração de guias', () => {
  const faixa = {
    tipoGuia: 'sp_sadt',
    formaGeracao: 'faixa_operadora' as const,
    prefixo: 'SP',
    tamanhoFixo: 8,
    numeroInicial: 1,
    numeroFinal: 1000,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('formata com prefixo e zeros', () => {
    expect(formatarNumeroGuia('SP', 8, 42)).toBe('SP00000042');
    expect(formatarNumeroGuia(null, null, 42)).toBe('42');
    expect(tipoFaixaDaGuia('resumo_internacao')).toBe('internacao');
    expect(tipoFaixaDaGuia('consulta')).toBe('consulta');
  });
  it('recusa faixa invertida, sobreposta, longa ou com tamanho curto', () => {
    expect(errosFaixa(faixa, [])).toEqual([]);
    expect(
      errosFaixa({ ...faixa, numeroInicial: 50, numeroFinal: 10, tamanhoFixo: 1, prefixo: 'A B' }, []),
    ).toEqual(['faixa-invertida', 'prefixo-invalido', 'tamanho-insuficiente']);
    expect(errosFaixa(faixa, [{ id: 1, numeroInicial: 900, numeroFinal: 2000, situacao: 'ativa' }])).toEqual([
      'faixa-sobreposta',
    ]);
    expect(
      errosFaixa(faixa, [{ id: 1, numeroInicial: 900, numeroFinal: 2000, situacao: 'encerrada' }]),
    ).toEqual([]);
    expect(errosFaixa({ ...faixa, prefixo: 'ABCDEFGHIJ', tamanhoFixo: 11 }, [])).toEqual(['numero-longo']);
  });
  it('escolhe a faixa vigente mais antiga e consome em ordem até esgotar', () => {
    const f = {
      id: 7,
      prefixo: null,
      tamanhoFixo: 3,
      numeroFinal: 10,
      proximoNumero: 9,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacao: 'ativa',
    };
    const g = { ...f, id: 8, vigenciaInicio: '2026-02-01', proximoNumero: 1 };
    expect(faixaParaEmitir([g, f], '2026-03-01')?.id).toBe(7);
    expect(faixaParaEmitir([g, f], '2025-12-31')).toBeNull();
    expect(faixaParaEmitir([{ ...f, proximoNumero: 11 }, g], '2026-03-01')?.id).toBe(8);
    expect(consumirFaixa(f)).toEqual({ numero: '009', proximo: 10, esgotada: false, restantes: 1 });
    expect(consumirFaixa({ ...f, proximoNumero: 10 })).toEqual({
      numero: '010',
      proximo: 11,
      esgotada: true,
      restantes: 0,
    });
    expect(faixaNoFim({ numeroInicial: 1, numeroFinal: 100, proximoNumero: 91 })).toBe(true);
    expect(faixaNoFim({ numeroInicial: 1, numeroFinal: 100, proximoNumero: 50 })).toBe(false);
  });
});
