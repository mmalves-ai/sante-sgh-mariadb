// Envios regulatórios: CSV determinístico, os três arquivos e as recusas da geração e da transmissão.
import type { DenominadorSetor, IndicadorDaCompetencia } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  arquivoIras,
  arquivoNotivisa,
  arquivoPmQualiss,
  montarCsv,
  nomeArquivoEnvio,
  recusaGeracaoEnvio,
  recusaTransmissaoEnvio,
} from './envio.js';
import { FICHAS_INDICADOR_QUALIDADE } from './ficha-indicador.js';

const parcela = (numerador: number, denominador: number, fator: 1 | 100 | 1000) => ({
  numerador,
  denominador,
  fator,
  valor: denominador > 0 ? Math.round((numerador / denominador) * fator * 100) / 100 : null,
});
const setor = (nome: string, pd: number, cvc: number, ipcs: number): DenominadorSetor => ({
  setor: nome,
  pacientesDia: pd,
  dispositivosDia: { cvc, sondaVesical: 10, ventilacaoMecanica: 0 },
  iras: { ipcs, pav: 0, itu: 0 },
  densidade: { ipcs: parcela(ipcs, cvc, 1000), pav: parcela(0, 0, 1000), itu: parcela(0, 10, 1000) },
  utilizacao: {
    cvc: parcela(cvc, pd, 100),
    sondaVesical: parcela(10, pd, 100),
    ventilacaoMecanica: parcela(0, pd, 100),
  },
});

describe('CSV', () => {
  it('ponto e vírgula, CRLF, decimal com vírgula, S/N e aspas quando preciso', () => {
    expect(
      montarCsv(
        ['a', 'b', 'c', 'd'],
        [
          [1.5, 'x;y', true, null],
          [2, 'diz "oi"\nfim', false, 'z'],
        ],
      ),
    ).toBe('a;b;c;d\r\n1,5;"x;y";S;\r\n2;"diz ""oi"" fim";N;z\r\n');
  });
  it('linha com colunas a mais é erro', () => {
    expect(() => montarCsv(['a'], [[1, 2]])).toThrow();
  });
  it('nome do arquivo', () => {
    expect(nomeArquivoEnvio('iras', '2026-09', 2, 'pc')).toBe('iras-pc-2026-09-r2.csv');
  });
});

describe('arquivos', () => {
  it('IRAS: uma linha por setor e o total, com as densidades', () => {
    const uti = setor('UTI ADULTO', 300, 200, 1);
    const cli = setor('CLINICA', 900, 50, 0);
    const total = setor('todos', 1200, 250, 1);
    const a = arquivoIras('2026-09', [uti, cli], total);
    expect(a.linhas).toBe(3);
    expect(a.conteudo.split('\r\n')[1]).toBe('2026-09;UTI ADULTO;300;200;1;5;10;0;0;0;0;');
    expect(a.conteudo.split('\r\n')[3]).toBe('2026-09;TOTAL;1200;250;1;4;10;0;0;0;0;');
    expect(a.resumo).toEqual({ setores: 2, pacientesDia: 1200, ipcs: 1, itu: 0, pav: 0 });
    // Determinístico: as mesmas linhas, os mesmos bytes.
    expect(arquivoIras('2026-09', [uti, cli], total).conteudo).toBe(a.conteudo);
  });
  it('PM-QUALISS: só os do programa, em ordem de código, com a análise registrada', () => {
    const ficha = (codigo: string) => FICHAS_INDICADOR_QUALIDADE.find((f) => f.codigo === codigo)!;
    const ind = (codigo: string, valor: number | null, analise: boolean): IndicadorDaCompetencia => ({
      ficha: ficha(codigo),
      competencia: '2026-09',
      numerador: 3,
      denominador: 1250,
      valor,
      conta: null,
      meta: 2,
      situacaoMeta: valor === null ? 'sem-valor' : valor > 2 ? 'fora-da-meta' : 'na-meta',
      parcial: false,
      analise: analise ? ({ id: 1 } as IndicadorDaCompetencia['analise']) : null,
      pendente: !analise,
    });
    const a = arquivoPmQualiss('2026-09', [
      ind('densidadePavVm', null, false),
      ind('utilizacaoCvc', 20, false),
      ind('densidadeIpcsCvc', 2.4, true),
    ]);
    expect(a.linhas).toBe(2);
    const l = a.conteudo.split('\r\n');
    expect(l[1]).toMatch(/^2026-09;densidadeIpcsCvc;.*;3;1250;2,4;2;fora-da-meta;S$/);
    expect(l[2]).toMatch(/^2026-09;densidadePavVm;.*;3;1250;;2;sem-valor;N$/);
    expect(a.resumo).toEqual({ indicadores: 2, semValor: 1, semAnalise: 1, foraDaMeta: 1 });
  });
  it('Notivisa: os incidentes da competência em ordem, sem pessoa, com a transcrição', () => {
    const a = arquivoNotivisa('2026-09', [
      {
        numero: 'N-2',
        ocorridoEm: '2026-09-20T10:00:00',
        tipo: 'queda',
        classificacao: 'eventoAdverso',
        grauDano: 'leve',
        obito: false,
        prazoEm: '2026-10-21T23:59:59',
        transcritaEm: null,
        numeroNotivisa: null,
      },
      {
        numero: 'N-1',
        ocorridoEm: '2026-09-02T08:30:00',
        tipo: 'medicacao',
        classificacao: 'eventoAdverso',
        grauDano: 'obito',
        obito: true,
        prazoEm: '2026-09-05T08:30:00',
        transcritaEm: '2026-09-03T09:00:00',
        numeroNotivisa: '123456',
      },
    ]);
    const l = a.conteudo.split('\r\n');
    expect(l[1]).toBe(
      '2026-09;N-1;2026-09-02 08:30;medicacao;eventoAdverso;obito;S;2026-09-05 08:30;2026-09-03 09:00;123456',
    );
    expect(l[2]).toBe('2026-09;N-2;2026-09-20 10:00;queda;eventoAdverso;leve;N;2026-10-21 23:59;;');
    expect(a.resumo).toEqual({ notificacoes: 2, obitos: 1, transcritas: 1, pendentes: 1 });
  });
});

describe('recusas do envio', () => {
  const AGORA = '2026-10-27T10:00:00';
  it('geração só de competência terminada e não transmitida', () => {
    expect(recusaGeracaoEnvio('2026-09', AGORA, [])).toBeNull();
    expect(recusaGeracaoEnvio('2026-10', AGORA, [])).toBe('competencia-aberta');
    expect(
      recusaGeracaoEnvio('2026-09', AGORA, [{ situacao: 'substituido' }, { situacao: 'gerado' }]),
    ).toBeNull();
    expect(recusaGeracaoEnvio('2026-09', AGORA, [{ situacao: 'transmitido' }])).toBe('ja-transmitido');
  });
  it('transmissão do gerado, na versão, com o mesmo resumo, depois da geração e não no futuro', () => {
    const h = 'a'.repeat(64);
    const envio = { versao: 1, situacao: 'gerado' as const, hash: h, geradoEm: '2026-10-20T09:00:00' };
    const e = { versao: 1, hash: h, transmitidoEm: '2026-10-21T14:00' };
    expect(recusaTransmissaoEnvio(envio, e, AGORA)).toBeNull();
    expect(recusaTransmissaoEnvio({ ...envio, situacao: 'transmitido' }, e, AGORA)).toBe(
      'envio-nao-pendente',
    );
    expect(recusaTransmissaoEnvio(envio, { ...e, versao: 2 }, AGORA)).toBe('versao-desatualizada');
    expect(recusaTransmissaoEnvio(envio, { ...e, hash: 'b'.repeat(64) }, AGORA)).toBe('hash-diferente');
    expect(recusaTransmissaoEnvio(envio, { ...e, transmitidoEm: '2026-10-20T08:59' }, AGORA)).toBe(
      'transmissao-antes-da-geracao',
    );
    expect(recusaTransmissaoEnvio(envio, { ...e, transmitidoEm: '2026-10-27T11:00' }, AGORA)).toBe(
      'transmissao-futura',
    );
  });
});
