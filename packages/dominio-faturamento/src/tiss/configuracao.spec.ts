import { describe, expect, it } from 'vitest';
import {
  avisoFaixaNoFim,
  consumirFaixa,
  errosConfiguracaoTiss,
  errosFaixa,
  faixaNoFim,
  faixaParaEmitir,
  formatarNumeroGuia,
  numerosCoincidem,
  origemNumeroGuia,
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
    expect(
      errosFaixa(faixa, [
        { id: 1, numeroInicial: 900, numeroFinal: 2000, proximoNumero: 900, situacao: 'ativa' },
      ]),
    ).toEqual(['faixa-sobreposta']);
    // Encerrada sem uso não reserva número.
    expect(
      errosFaixa(faixa, [
        { id: 1, numeroInicial: 900, numeroFinal: 2000, proximoNumero: 900, situacao: 'encerrada' },
      ]),
    ).toEqual([]);
  });
  it('a faixa encerrada no meio do consumo reserva os números já usados em guias', () => {
    // 1 a 100 encerrada com o próximo em 50: os números 1 a 49 já foram para guias.
    const usada = { id: 7, numeroInicial: 1, numeroFinal: 100, proximoNumero: 50, situacao: 'encerrada' };
    expect(errosFaixa({ ...faixa, numeroInicial: 1, numeroFinal: 500 }, [usada])).toEqual([
      'faixa-sobreposta',
    ]);
    expect(errosFaixa({ ...faixa, numeroInicial: 49, numeroFinal: 60 }, [usada])).toEqual([
      'faixa-sobreposta',
    ]);
    // A parte não consumida (50 a 100) pode ser pedida de novo.
    expect(errosFaixa({ ...faixa, numeroInicial: 50, numeroFinal: 500 }, [usada])).toEqual([]);
    // Encerrada já esgotada reserva a faixa inteira.
    expect(
      errosFaixa({ ...faixa, numeroInicial: 100, numeroFinal: 200 }, [{ ...usada, proximoNumero: 101 }]),
    ).toEqual(['faixa-sobreposta']);
    expect(errosFaixa({ ...faixa, prefixo: 'ABCDEFGHIJ', tamanhoFixo: 11 }, [])).toEqual(['numero-longo']);
  });
  it('faixa de outro tipo de guia da mesma fonte pagadora não pode escrever o mesmo número de guia', () => {
    const outra = {
      id: 9,
      numeroInicial: 1,
      numeroFinal: 2000,
      proximoNumero: 1,
      situacao: 'ativa',
      tipoGuia: 'internacao',
      prefixo: faixa.prefixo,
      tamanhoFixo: faixa.tamanhoFixo,
    };
    expect(errosFaixa(faixa, [outra])).toEqual(['faixa-repete-numero-de-outro-tipo']);
    // Prefixo diferente escreve outro número: as duas faixas convivem.
    expect(errosFaixa(faixa, [{ ...outra, prefixo: 'ZZ' }])).toEqual([]);
    // Números que não se cruzam convivem, e a encerrada sem uso não reserva nada.
    expect(errosFaixa(faixa, [{ ...outra, numeroInicial: 5000, numeroFinal: 6000 }])).toEqual([]);
    expect(errosFaixa(faixa, [{ ...outra, situacao: 'encerrada' }])).toEqual([]);
    // A do mesmo tipo segue conflitando pelo intervalo, qualquer que seja o prefixo.
    expect(errosFaixa(faixa, [{ ...outra, tipoGuia: faixa.tipoGuia, prefixo: 'ZZ' }])).toEqual([
      'faixa-sobreposta',
    ]);
    // Tamanho fixo diferente só distingue enquanto o número não ocupa o maior tamanho.
    const semPrefixo = { prefixo: null, tamanhoFixo: 4 };
    expect(numerosCoincidem(semPrefixo, { prefixo: null, tamanhoFixo: 4 }, 9)).toBe(true);
    expect(numerosCoincidem(semPrefixo, { prefixo: null, tamanhoFixo: null }, 999)).toBe(false);
    expect(numerosCoincidem(semPrefixo, { prefixo: null, tamanhoFixo: null }, 1000)).toBe(true);
    expect(numerosCoincidem(semPrefixo, { prefixo: 'A', tamanhoFixo: 4 }, 9)).toBe(false);
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
  it('número da guia na emissão: o da guia fica; com faixa da operadora sai da faixa; sem faixa, o da conta', () => {
    expect(origemNumeroGuia({ numeroDaGuia: 'G-1', situacoesDasFaixas: ['ativa'] })).toBe('guia');
    expect(origemNumeroGuia({ numeroDaGuia: null, situacoesDasFaixas: ['encerrada', 'ativa'] })).toBe(
      'faixa',
    );
    // Faixa esgotada ainda prende a numeração: a emissão recusa até a nova faixa ser cadastrada.
    expect(origemNumeroGuia({ numeroDaGuia: ' ', situacoesDasFaixas: ['esgotada'] })).toBe('faixa');
    expect(origemNumeroGuia({ numeroDaGuia: null, situacoesDasFaixas: ['encerrada'] })).toBe('conta');
    expect(origemNumeroGuia({ numeroDaGuia: null, situacoesDasFaixas: [] })).toBe('conta');
    expect(avisoFaixaNoFim({ esgotada: true, noFim: true, restantes: 0 })).toContain('esgotou');
    expect(avisoFaixaNoFim({ esgotada: false, noFim: true, restantes: 3 })).toContain('restam 3');
    expect(avisoFaixaNoFim({ esgotada: false, noFim: false, restantes: 50 })).toBeNull();
  });
});
