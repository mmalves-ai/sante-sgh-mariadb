// W0-04 (M2 e M3): fichas da segurança do paciente e das linhas de cuidado, numeradores, mediana, % no alvo e a
// planilha das parcelas. Contas escritas no teste.
import { type ConteudoGerenciado, INDICADORES_QUALIDADE, LINHAS_DE_CUIDADO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { faltasDaFicha, FICHAS_INDICADOR_QUALIDADE } from './ficha-indicador.js';
import {
  contaDaMediana,
  csvIndicadores,
  FICHAS_SEGURANCA_PACIENTE,
  fichasDaLinha,
  linhaDeCuidado,
  mediana,
  numeradoresSeguranca,
  type ProtocoloParaLinha,
} from './indicadores-seguranca.js';

describe('fichas (M2 e M3)', () => {
  it('as cinco da segurança do paciente por 1.000 pacientes-dia, com o denominador do censo e menor-melhor', () => {
    expect(FICHAS_SEGURANCA_PACIENTE.map((f) => f.codigo)).toEqual([
      'taxaQueda',
      'incidenciaLpp',
      'taxaErroMedicacao',
      'taxaFlebite',
      'taxaExtubacaoNaoPlanejada',
    ]);
    for (const f of FICHAS_SEGURANCA_PACIENTE) {
      expect(faltasDaFicha(f), f.codigo).toEqual([]);
      expect(f).toMatchObject({
        fator: 1000,
        unidade: 'densidade',
        polaridade: 'menor-melhor',
        origem: 'seguranca',
      });
      expect(f.denominador).toBe('Pacientes-dia do censo diário na competência');
      expect(f.referencia).toContain('RDC 36/2013');
      expect(f.formula).toMatch(/÷ pacientes-dia × 1\.000$/);
    }
  });
  it('duas por linha de cuidado: % no alvo (maior-melhor) e mediana em minutos (sem denominador, menor-melhor)', () => {
    const sepse = fichasDaLinha(LINHAS_DE_CUIDADO[0]);
    expect(sepse.map((f) => [f.codigo, f.unidade, f.polaridade, f.fator])).toEqual([
      ['sepseNoAlvo', 'percentual', 'maior-melhor', 100],
      ['sepseMediana', 'minutos', 'menor-melhor', 1],
    ]);
    for (const f of sepse) expect(faltasDaFicha(f)).toEqual([]);
    expect(fichasDaLinha(LINHAS_DE_CUIDADO[2]).map((f) => f.codigo)).toEqual([
      'dorToracicaNoAlvo',
      'dorToracicaMediana',
    ]);
  });
  it('o catálogo inteiro tem ficha completa e o mesmo código e ordem dos parâmetros de meta (qualidade.meta.*)', () => {
    expect(FICHAS_INDICADOR_QUALIDADE.map((f) => f.codigo)).toEqual(
      INDICADORES_QUALIDADE.map((i) => i.codigo),
    );
    for (const f of FICHAS_INDICADOR_QUALIDADE) expect(faltasDaFicha(f), f.codigo).toEqual([]);
    // o nome do parâmetro é o nome da ficha
    for (const i of INDICADORES_QUALIDADE.slice(7))
      expect(FICHAS_INDICADOR_QUALIDADE.find((f) => f.codigo === i.codigo)?.nome).toBe(i.nome);
  });
});

describe('numeradores da segurança do paciente (M2)', () => {
  it('queda, LPP e flebite contam o que atingiu; medicação conta o quase erro; a circunstância nunca conta', () => {
    const n = numeradoresSeguranca({
      competencia: '2026-10',
      notificacoes: [
        { tipo: 'queda', classificacao: 'eventoAdverso', total: 2 },
        { tipo: 'queda', classificacao: 'incidenteSemDano', total: 3 },
        { tipo: 'queda', classificacao: 'quaseErro', total: 4 },
        { tipo: 'lesaoPressao', classificacao: 'eventoAdverso', total: 5 },
        { tipo: 'medicacao', classificacao: 'quaseErro', total: 6 },
        { tipo: 'medicacao', classificacao: 'eventoAdverso', total: 1 },
        { tipo: 'medicacao', classificacao: 'circunstanciaNotificavel', total: 9 },
        { tipo: 'flebite', classificacao: 'incidenteSemDano', total: 2 },
        { tipo: 'dispositivo', classificacao: 'eventoAdverso', total: 7 },
      ],
      dispositivos: [
        { tipo: 'ventilacaoMecanica', retiradoEm: '2026-10-03T10:00:00', motivoRetirada: 'acidental' },
        { tipo: 'ventilacaoMecanica', retiradoEm: '2026-10-04T10:00:00', motivoRetirada: 'eletiva' },
        // cancelado (lançado errado) não conta
        {
          tipo: 'ventilacaoMecanica',
          retiradoEm: '2026-10-05T10:00:00',
          motivoRetirada: 'acidental',
          canceladoEm: '2026-10-05T11:00:00',
        },
        // de outra competência e de outro tipo
        { tipo: 'ventilacaoMecanica', retiradoEm: '2026-09-30T23:00:00', motivoRetirada: 'acidental' },
        { tipo: 'sondaVesical', retiradoEm: '2026-10-05T10:00:00', motivoRetirada: 'acidental' },
        { tipo: 'ventilacaoMecanica', retiradoEm: null, motivoRetirada: null },
      ],
    });
    expect(n).toEqual({
      taxaQueda: 5,
      incidenciaLpp: 5,
      taxaErroMedicacao: 7,
      taxaFlebite: 2,
      taxaExtubacaoNaoPlanejada: 1,
    });
  });
});

const DEF_SEPSE: ConteudoGerenciado = {
  tipo: 'sepse',
  nome: 'Sepse SINTETICO',
  criterios: [{ codigo: 'sirs', titulo: 'Dois ou mais critérios' }],
  metas: [
    { codigo: 'lactato', titulo: 'Lactato', prazoMin: 30, desde: 'inclusao' },
    { codigo: 'antibiotico', titulo: 'Antibiótico', prazoMin: 60, desde: 'inclusao' },
  ],
  checklist: [],
};
const DEF_SEM_META: ConteudoGerenciado = { ...DEF_SEPSE, metas: [DEF_SEPSE.metas[0]!] };
const DEF_DOR: ConteudoGerenciado = {
  tipo: 'dor-toracica',
  nome: 'Dor SINTETICO',
  criterios: [{ codigo: 'dor', titulo: 'Dor torácica típica' }],
  metas: [{ codigo: 'ecg', titulo: 'ECG', prazoMin: 10, desde: 'chegada' }],
  checklist: [],
};

const prot = (
  gerenciado: number,
  tipo: string,
  meta: { codigo: string; situacao: string; quando: string | null } | null,
  descartado = false,
): ProtocoloParaLinha => ({
  tipo,
  gerenciado,
  chegadaEm: '2026-10-10T08:00:00',
  incluidoEm: '2026-10-10T08:20:00',
  eventos: [
    ...(meta ? [{ tipo: 'meta', ...meta }] : []),
    ...(descartado
      ? [{ tipo: 'encerramento', codigo: 'encerramento', situacao: 'descartado', quando: null }]
      : []),
  ],
});

describe('linhas de cuidado (M3)', () => {
  const definicoes = new Map<number, ConteudoGerenciado>([
    [1, DEF_SEPSE],
    [2, DEF_SEM_META],
    [3, DEF_DOR],
  ]);
  it('sepse: tempo desde a inclusão, no alvo até o prazo; perdida e sem registro ficam fora do alvo', () => {
    const r = linhaDeCuidado({
      tipo: 'sepse',
      metaChave: 'antibiotico',
      definicoes,
      protocolos: [
        prot(1, 'sepse', { codigo: 'antibiotico', situacao: 'cumprida', quando: '2026-10-10T09:00:00' }), // 40
        prot(1, 'sepse', { codigo: 'antibiotico', situacao: 'cumprida', quando: '2026-10-10T09:20:00' }), // 60 (no alvo)
        prot(1, 'sepse', { codigo: 'antibiotico', situacao: 'cumprida', quando: '2026-10-10T10:35:00' }), // 135
        prot(1, 'sepse', { codigo: 'antibiotico', situacao: 'perdida', quando: null }),
        prot(1, 'sepse', null), // sem registro
        prot(
          1,
          'sepse',
          { codigo: 'antibiotico', situacao: 'cumprida', quando: '2026-10-10T08:30:00' },
          true,
        ),
        prot(2, 'sepse', { codigo: 'lactato', situacao: 'cumprida', quando: '2026-10-10T08:30:00' }), // sem a meta
        prot(3, 'dor-toracica', { codigo: 'ecg', situacao: 'cumprida', quando: '2026-10-10T08:05:00' }),
      ],
    });
    expect(r).toEqual({
      tipo: 'sepse',
      metaChave: 'antibiotico',
      avaliadas: 5,
      noAlvo: 2,
      tempos: [40, 60, 135],
      mediana: 60,
      descartadas: 1,
    });
    expect(contaDaMediana(r.tempos)).toBe('mediana de 3 tempos (40, 60 e 135 min) = 60 min');
  });
  it('dor torácica: tempo desde a chegada (porta-ECG)', () => {
    const r = linhaDeCuidado({
      tipo: 'dor-toracica',
      metaChave: 'ecg',
      definicoes,
      protocolos: [
        prot(3, 'dor-toracica', { codigo: 'ecg', situacao: 'cumprida', quando: '2026-10-10T08:08:00' }),
        prot(3, 'dor-toracica', { codigo: 'ecg', situacao: 'cumprida', quando: '2026-10-10T08:14:00' }),
      ],
    });
    expect(r).toMatchObject({ avaliadas: 2, noAlvo: 1, tempos: [8, 14], mediana: 11 });
    expect(contaDaMediana([8, 14])).toBe('mediana de 2 tempos (8 e 14 min) = 11 min');
    expect(contaDaMediana([])).toBeNull();
  });
  it('mediana: ímpar, par e vazia', () => {
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe('planilha das parcelas', () => {
  it('CSV com ponto e vírgula, decimal com vírgula e a conta entre aspas quando precisa', () => {
    const csv = csvIndicadores([
      {
        ficha: {
          codigo: 'taxaQueda',
          nome: 'Taxa de queda por 1.000 pacientes-dia',
          fator: 1000,
          unidade: 'densidade',
          fonte: 'NSP; censo',
          origem: 'seguranca',
        },
        competencia: '2026-10',
        numerador: 3,
        denominador: 1250,
        valor: 2.4,
        conta: '3 ÷ 1.250 × 1.000 = 2,4',
        meta: 1.5,
        situacaoMeta: 'fora-da-meta',
        parcial: false,
      },
    ]);
    const [cab, linha] = csv.split('\r\n');
    expect(cab).toBe(
      'codigo;indicador;origem;competencia;numerador;denominador;fator;valor;unidade;conta;meta;situacao;parcial;fonte',
    );
    expect(linha).toBe(
      'taxaQueda;Taxa de queda por 1.000 pacientes-dia;seguranca;2026-10;3;1250;1000;2,4;densidade;3 ÷ 1.250 × 1.000 = 2,4;1,5;fora-da-meta;nao;"NSP; censo"',
    );
  });
});
