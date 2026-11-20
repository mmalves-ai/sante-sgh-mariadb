// M56 (etapa 7, F6): a competência sugerida de cada obrigação (o último período encerrado, com a virada do ano), o
// formato conferido antes da prévia, a competência para a tela, o corpo do retorno da ANS e a leitura dos atendimentos
// colados do aviso de ressarcimento.
import { describe, expect, it } from 'vitest';
import {
  competenciaNoFormato,
  competenciaSugerida,
  competenciaTela,
  corpoRetorno,
  lerAtendimentos,
} from './comum';

describe('competência dos envios à ANS', () => {
  it('sugere o último período encerrado, com a virada do ano', () => {
    expect(competenciaSugerida('SIB', '2026-10-26')).toBe('2026-09');
    expect(competenciaSugerida('MONITORAMENTO_TISS', '2026-01-05')).toBe('2025-12');
    expect(competenciaSugerida('SIP', '2026-10-26')).toBe('2026-T3');
    expect(competenciaSugerida('TPS', '2026-03-31')).toBe('2025-T4');
    expect(competenciaSugerida('DIOPS', '2026-04-01')).toBe('2026-T1');
    expect(competenciaSugerida('RESSARCIMENTO_SUS', '2026-10-26')).toBe('2026-10-26');
  });

  it('confere o formato pela periodicidade', () => {
    expect(competenciaNoFormato('SIB', '2026-09')).toBe(true);
    expect(competenciaNoFormato('SIB', '2026-13')).toBe(false);
    expect(competenciaNoFormato('SIB', '2026-T3')).toBe(false);
    expect(competenciaNoFormato('SIP', '2026-T3')).toBe(true);
    expect(competenciaNoFormato('DIOPS', '2026-T5')).toBe(false);
    expect(competenciaNoFormato('RESSARCIMENTO_SUS', '2026-10-26')).toBe(true);
    expect(competenciaNoFormato('RESSARCIMENTO_SUS', '2026-10')).toBe(false);
  });

  it('mostra a competência na tela', () => {
    expect(competenciaTela('2026-09')).toBe('09/2026');
    expect(competenciaTela('2026-T3')).toBe('3º trimestre de 2026');
    expect(competenciaTela('2026-10-26')).toBe('26/10/2026');
    expect(competenciaTela('outra')).toBe('outra');
  });
});

describe('retorno da ANS', () => {
  const marcas = [
    { ordem: 1, aceito: true, cco: ' 123456789012 ', erro: 'ignorado' },
    { ordem: 2, aceito: true, cco: '', erro: '' },
    { ordem: 3, aceito: false, cco: '999', erro: ' CPF divergente ' },
    { ordem: 4, aceito: false, cco: '', erro: '' },
  ];
  it('simulado: só o pedido de simular', () => {
    expect(corpoRetorno(3, 'simular', 'x', marcas)).toEqual({ versao: 3, simular: true });
  });
  it('rejeitado inteiro: com o resumo (vazio vira nulo)', () => {
    expect(corpoRetorno(3, 'rejeitado', ' Leiaute ', [])).toEqual({
      versao: 3,
      rejeitado: true,
      resumo: 'Leiaute',
    });
    expect(corpoRetorno(3, 'rejeitado', '  ', [])).toEqual({ versao: 3, rejeitado: true, resumo: null });
  });
  it('por item: o aceito com o CCO informado, o rejeitado com o erro', () => {
    expect(corpoRetorno(3, 'itens', '', marcas)).toEqual({
      versao: 3,
      resumo: null,
      itens: [
        { ordem: 1, aceito: true, cco: '123456789012' },
        { ordem: 2, aceito: true },
        { ordem: 3, aceito: false, erro: 'CPF divergente' },
        { ordem: 4, aceito: false, erro: null },
      ],
    });
  });
});

describe('atendimentos colados do aviso de ressarcimento', () => {
  it('lê ponto e vírgula ou tabulação, datas brasileiras e valor com vírgula; aponta as linhas incompletas', () => {
    const r = lerAtendimentos(
      [
        'aih;1234567890123;1234567890123456;01/09/2026;05/09/2026;0303010010;1.234,56',
        '',
        'APAC\t9876543210987\t123456789012345\t2026-09-10\t2026-09-10\t0304010014\t89.9',
        'AIH;123;sem campos',
        'AIH;1;2;2026-01-01;2026-01-02;3;abc',
      ].join('\n'),
    );
    expect(r.itens).toEqual([
      {
        tipo: 'AIH',
        numero: '1234567890123',
        identificacao: '1234567890123456',
        inicio: '2026-09-01',
        fim: '2026-09-05',
        procedimento: '0303010010',
        valor: 1234.56,
      },
      {
        tipo: 'APAC',
        numero: '9876543210987',
        identificacao: '123456789012345',
        inicio: '2026-09-10',
        fim: '2026-09-10',
        procedimento: '0304010014',
        valor: 89.9,
      },
    ]);
    expect(r.invalidas).toEqual([4, 5]);
  });
  it('texto vazio: nada lido', () => {
    expect(lerAtendimentos('  \n ')).toEqual({ itens: [], invalidas: [] });
  });
});
