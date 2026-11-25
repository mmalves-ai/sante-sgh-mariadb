// Importação do arquivo do tarifador (F8, 06-FAT linha 23): layout, classificação do número e leitura das linhas.
// Números e ramais SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  classificarNumero,
  conferirLigacaoDoAtendimento,
  dividirLinhaTarifador,
  type LayoutTarifador,
  lerArquivoTarifador,
  lerDataHoraTarifador,
  lerDuracaoTarifador,
  lerValorTarifador,
  MAX_LINHAS_TARIFADOR,
  validarLayoutTarifador,
} from './tarifador.js';

const LAYOUT: LayoutTarifador = {
  separador: 'ponto_virgula',
  cabecalho: true,
  formatoData: 'dia_mes_ano',
  formatoDuracao: 'horas_minutos_segundos',
  decimal: ',',
  dddLocal: '54',
  colunaRamal: 1,
  colunaDataHora: 2,
  colunaHora: null,
  colunaDuracao: 3,
  colunaNumero: 4,
  colunaValor: 5,
  colunaAtendimento: null,
};

describe('layout do tarifador', () => {
  it('aceita o layout completo e recusa coluna faltando, repetida ou fora da faixa', () => {
    expect(validarLayoutTarifador(LAYOUT)).toEqual({});
    expect(validarLayoutTarifador({ ...LAYOUT, colunaNumero: null as unknown as number })).toHaveProperty(
      'colunaNumero',
    );
    expect(validarLayoutTarifador({ ...LAYOUT, colunaValor: 2 })).toEqual({
      colunaValor: 'Duas informações na mesma coluna.',
    });
    expect(validarLayoutTarifador({ ...LAYOUT, colunaRamal: 0 })).toHaveProperty('colunaRamal');
    expect(validarLayoutTarifador({ ...LAYOUT, colunaHora: 61 })).toHaveProperty('colunaHora');
    expect(validarLayoutTarifador({ ...LAYOUT, dddLocal: '5' })).toHaveProperty('dddLocal');
    expect(Object.keys(validarLayoutTarifador({}))).toEqual(
      expect.arrayContaining(['separador', 'formatoData', 'formatoDuracao', 'decimal', 'colunaDataHora']),
    );
  });
});

describe('classificação do número discado', () => {
  it.each([
    ['32221234', 'local', null, '32221234'],
    ['991234567', 'celular_local', null, '991234567'],
    ['5432221234', 'local', '54', '32221234'],
    ['054991234567', 'celular_local', '54', '991234567'],
    ['0215132221234', 'interurbano', '51', '32221234'],
    ['0 15 11 99123-4567', 'celular_interurbano', '11', '991234567'],
    ['(11) 3222-1234', 'interurbano', '11', '32221234'],
    ['00351211234567', 'internacional', null, '351211234567'],
    ['+5511991234567', 'celular_interurbano', '11', '991234567'],
    ['08007771234', 'gratuita', null, '08007771234'],
    ['192', 'gratuita', null, '192'],
  ])('%s é %s', (n, abrangencia, ddd, telefone) => {
    expect(classificarNumero(n, '54')).toMatchObject({ abrangencia, ddd, telefone });
  });
  it('recusa o que não é número de telefone', () => {
    for (const n of ['', 'abc', '1234', '12345678901234', '0001', '18765432', '0055991234567'])
      expect(classificarNumero(n, '54')).toBeNull();
  });
  it('sem DDD do hospital, todo número com DDD é interurbano', () => {
    expect(classificarNumero('5432221234', null)?.abrangencia).toBe('interurbano');
  });
});

describe('campos do bilhete', () => {
  it('data nos dois formatos, com a hora junta ou em coluna separada; data impossível recusada', () => {
    expect(lerDataHoraTarifador('05/03/2026 14:07:09', null, 'dia_mes_ano')).toBe('2026-03-05 14:07:09');
    expect(lerDataHoraTarifador('5-3-2026', '9:07', 'dia_mes_ano')).toBe('2026-03-05 09:07:00');
    expect(lerDataHoraTarifador('2026-03-05T14:07', null, 'ano_mes_dia')).toBe('2026-03-05 14:07:00');
    expect(lerDataHoraTarifador('31/02/2026 10:00', null, 'dia_mes_ano')).toBeNull();
    expect(lerDataHoraTarifador('05/03/2026', null, 'dia_mes_ano')).toBeNull();
    expect(lerDataHoraTarifador('2026-03-05 25:00', null, 'ano_mes_dia')).toBeNull();
  });
  it('duração em segundos, minutos (fração arredonda para cima) e h:mm:ss', () => {
    expect(lerDuracaoTarifador('125', 'segundos', ',')).toBe(125);
    expect(lerDuracaoTarifador('2,5', 'minutos', ',')).toBe(150);
    expect(lerDuracaoTarifador('0.01', 'minutos', '.')).toBe(1);
    expect(lerDuracaoTarifador('1:02:03', 'horas_minutos_segundos', ',')).toBe(3723);
    expect(lerDuracaoTarifador('02:03', 'horas_minutos_segundos', ',')).toBe(123);
    expect(lerDuracaoTarifador('2,5', 'segundos', ',')).toBeNull();
    expect(lerDuracaoTarifador('02:73', 'horas_minutos_segundos', ',')).toBeNull();
    expect(lerDuracaoTarifador('86401', 'segundos', ',')).toBeNull();
  });
  it('valor com vírgula ou ponto decimal, com R$ e milhar', () => {
    expect(lerValorTarifador('R$ 1.234,567', ',')).toBe(1234.57);
    expect(lerValorTarifador('1,234.5', '.')).toBe(1234.5);
    expect(lerValorTarifador('-1', ',')).toBeNull();
  });
  it('divide respeitando aspas', () => {
    expect(dividirLinhaTarifador('"a;b";"c""d"; e ', ';')).toEqual(['a;b', 'c"d', 'e']);
  });
});

describe('leitura do arquivo', () => {
  it('pula o cabeçalho e as linhas vazias, lê as boas e devolve as ruins só com a linha e o motivo', () => {
    const arquivo = [
      'RAMAL;DATA;DURACAO;NUMERO;VALOR',
      '201;05/03/2026 14:07:09;00:02:05;5432221234;0,45',
      '',
      '201;05/03/2026 15:00;00:01:00;0215132221234;',
      '202;31/02/2026 10:00;00:01:00;32221234;1,00',
      '202;05/03/2026 10:00;xx;32221234;1,00',
      '202;05/03/2026 10:00;00:00:30;12;1,00',
      '202;05/03/2026 10:00;00:00:30;32221234;abc',
      '202;05/03/2026 10:00',
    ].join('\r\n');
    const r = lerArquivoTarifador(arquivo, LAYOUT);
    expect(r.lidas).toBe(7);
    expect(r.ligacoes).toEqual([
      {
        linha: 2,
        ramal: '201',
        atendimento: null,
        iniciadaEm: '2026-03-05 14:07:09',
        duracaoSegundos: 125,
        valor: 0.45,
        abrangencia: 'local',
        ddi: null,
        ddd: '54',
        telefone: '32221234',
      },
      expect.objectContaining({ linha: 4, abrangencia: 'interurbano', valor: null, duracaoSegundos: 60 }),
    ]);
    expect(r.recusadas).toEqual([
      { linha: 5, motivo: 'data_invalida' },
      { linha: 6, motivo: 'duracao_invalida' },
      { linha: 7, motivo: 'numero_invalido' },
      { linha: 8, motivo: 'valor_invalido' },
      { linha: 9, motivo: 'colunas_faltando' },
    ]);
    expect(JSON.stringify(r.recusadas)).not.toContain('3222');
  });
  it('sem cabeçalho, com tabulação, hora separada e coluna do atendimento', () => {
    const l: LayoutTarifador = {
      ...LAYOUT,
      separador: 'tabulacao',
      cabecalho: false,
      formatoData: 'ano_mes_dia',
      formatoDuracao: 'segundos',
      colunaRamal: null,
      colunaHora: 3,
      colunaDuracao: 4,
      colunaNumero: 5,
      colunaValor: null,
      colunaAtendimento: 1,
    };
    const r = lerArquivoTarifador('A900\t2026-03-05\t08:30\t61\t991234567\n', l);
    expect(r.ligacoes).toEqual([
      expect.objectContaining({
        linha: 1,
        atendimento: 'A900',
        ramal: null,
        iniciadaEm: '2026-03-05 08:30:00',
        duracaoSegundos: 61,
        abrangencia: 'celular_local',
      }),
    ]);
  });
  it('limita as linhas por arquivo', () => {
    const linhas = Array.from(
      { length: MAX_LINHAS_TARIFADOR + 2 },
      () => '1;05/03/2026 10:00;00:00:10;32221234;',
    );
    const r = lerArquivoTarifador(['x', ...linhas].join('\n'), LAYOUT);
    expect(r.ligacoes).toHaveLength(MAX_LINHAS_TARIFADOR);
    expect(r.recusadas).toEqual([{ linha: MAX_LINHAS_TARIFADOR + 2, motivo: 'limite_de_linhas' }]);
  });
});

describe('conferirLigacaoDoAtendimento', () => {
  const destino = { ramal: '201', entradaEm: '2026-01-20 08:00:00', saidaEm: '2026-01-25 18:00:00' };
  it('do ramal do quarto e dentro do atendimento: ok (limites inclusos)', () => {
    expect(conferirLigacaoDoAtendimento({ ramal: '201', iniciadaEm: '2026-01-20 10:00:00' }, destino)).toBe(
      'ok',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: '201', iniciadaEm: '2026-01-20 08:00:00' }, destino)).toBe(
      'ok',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: '201', iniciadaEm: '2026-01-25 18:00:00' }, destino)).toBe(
      'ok',
    );
  });
  it('outro ramal ou linha sem ramal ficam de fora quando o ramal foi pedido', () => {
    expect(conferirLigacaoDoAtendimento({ ramal: '202', iniciadaEm: '2026-01-20 10:00:00' }, destino)).toBe(
      'outro_ramal',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: null, iniciadaEm: '2026-01-20 10:00:00' }, destino)).toBe(
      'outro_ramal',
    );
  });
  it('antes da entrada ou depois da saída: fora do atendimento (paciente anterior do mesmo ramal)', () => {
    expect(conferirLigacaoDoAtendimento({ ramal: '201', iniciadaEm: '2026-01-19 23:59:59' }, destino)).toBe(
      'fora_do_atendimento',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: '201', iniciadaEm: '2026-01-25 18:00:01' }, destino)).toBe(
      'fora_do_atendimento',
    );
  });
  it('sem filtro de ramal (importação pelo número do atendimento) só confere o período', () => {
    const semRamal = { ...destino, ramal: null };
    expect(conferirLigacaoDoAtendimento({ ramal: null, iniciadaEm: '2026-01-21 09:00:00' }, semRamal)).toBe(
      'ok',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: '305', iniciadaEm: '2026-01-21 09:00:00' }, semRamal)).toBe(
      'ok',
    );
    expect(conferirLigacaoDoAtendimento({ ramal: null, iniciadaEm: '2026-01-26 09:00:00' }, semRamal)).toBe(
      'fora_do_atendimento',
    );
  });
});
