// M44, seção 5 e regra 7: a classificação no formulário de classificação do prontuário (modelo E08). O modelo abaixo
// reproduz a forma do convertido do estabelecimento pc (docs/marcos/M09/dfm/e08.json: títulos, tipos e a ordem das
// opções de "Prioridade clínica"); vínculos e textos clínicos são SINTÉTICOS.
import type { CampoRegistro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  corDoTextoDaOpcao,
  mapaDoModeloE08,
  normalizarTitulo,
  proporDeParaE08,
  respostasE08,
} from './e08.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';

const campo = (
  vinculo: number,
  titulo: string,
  tipo: CampoRegistro['tipo'],
  extra: Partial<CampoRegistro> = {},
): CampoRegistro => ({
  linkId: String(vinculo),
  vinculo,
  componente: null,
  tipo,
  titulo,
  obrigatorio: false,
  unidade: null,
  tamanhoMaximo: null,
  colunas: 2,
  opcoes: [],
  colunasGrade: [],
  habilitar: null,
  calcular: null,
  regraPendente: false,
  manterHistorico: 2,
  ambiguo: false,
  itens: [],
  ...extra,
});

const OPCOES = [
  'Emergência- Vermelho',
  'Muito urgente- Laranja',
  'Urgente- Amarelo',
  'Pouco urgente- Verde',
  'Não urgente- Azul',
].map((texto, i) => ({ indice: i + 1, texto }));

const MODELO: CampoRegistro[] = [
  campo(1, 'ADMISSÃO', 'secao', {
    itens: [
      campo(2, 'Queixa principal', 'texto-formatado'),
      campo(3, 'SINAIS VITAIS', 'secao', {
        itens: [
          campo(4, 'PA', 'texto'),
          campo(5, 'FC', 'quantidade'),
          campo(6, 'Temperatura', 'texto'),
          campo(7, 'FR', 'quantidade'),
          campo(8, 'HGT', 'texto'),
          campo(9, 'Saturação', 'quantidade'),
        ],
      }),
      campo(90, 'Prioridade clínica', 'sem-campo'),
    ],
  }),
  campo(10, 'Alergias', 'escolha-com-texto', {
    opcoes: [
      { indice: 1, texto: 'Sim' },
      { indice: 2, texto: 'Não' },
    ],
    itens: [campo(14, 'Alergias', 'alergias')],
  }),
  campo(11, 'Comorbidade prévias', 'multipla', {
    opcoes: ['HAS', 'DM', 'Coronopatias', 'Gravidez', 'Outros'].map((texto, indice) => ({ indice, texto })),
  }),
  campo(12, 'Prioridade clínica', 'escolha', { opcoes: OPCOES }),
  campo(13, 'Observações', 'texto-formatado'),
];

const TODOS = new Set([1, 2, 3, 4, 5]);
const sinais = {
  pas: 130,
  pad: 85,
  fc: 96,
  fr: 18,
  temperatura: 37.8,
  saturacao: 97,
  glicemia: null,
  dor: 6,
  glasgow: null,
};

describe('formulário do prontuário (E08)', () => {
  it('as perguntas saem do modelo pelo título (a inativa "sem campo" é ignorada)', () => {
    const { mapa, faltam } = mapaDoModeloE08(MODELO);
    expect(faltam).toEqual([]);
    expect(mapa.prioridade?.vinculo).toBe(12);
    expect(mapa.saturacao).toMatchObject({ vinculo: 9, tipo: 'quantidade' });
    expect(mapa.queixa?.vinculo).toBe(2);
    expect(normalizarTitulo(' Saturação ')).toBe('saturacao');
  });

  it('modelo sem uma pergunta obrigatória não recebe a classificação', () => {
    const sem = MODELO.filter((c) => c.vinculo !== 12);
    const { mapa, faltam } = mapaDoModeloE08(sem);
    expect(faltam).toEqual(['prioridade']);
    const r = respostasE08(
      { cor: 'amarelo', cores: PROTOCOLO_SINTETICO.cores, sinais, queixa: 'Febre', observacoes: null },
      mapa,
      TODOS,
      faltam,
    );
    expect(r).toEqual({ situacao: 'modelo-diferente', faltam: ['prioridade'] });
  });

  it('cor no texto da opção e o de-para proposto só com índices vistos', () => {
    expect(corDoTextoDaOpcao('Urgente- Amarelo')).toBe('amarelo');
    expect(corDoTextoDaOpcao('Vermelho ou laranja')).toBeNull();
    expect(corDoTextoDaOpcao('Sem cor')).toBeNull();
    const { mapa } = mapaDoModeloE08(MODELO);
    expect(proporDeParaE08(mapa.prioridade, TODOS)).toEqual({
      vermelho: 1,
      laranja: 2,
      amarelo: 3,
      verde: 4,
      azul: 5,
    });
    expect(proporDeParaE08(mapa.prioridade, new Set([2, 3, 4, 5]))).toMatchObject({
      vermelho: null,
      laranja: 2,
    });
    expect(proporDeParaE08(undefined, TODOS).verde).toBeNull();
  });

  it('as respostas: queixa, PA em texto, números conforme o tipo, prioridade pelo de-para; glicemia não medida não vai', () => {
    const { mapa } = mapaDoModeloE08(MODELO);
    const r = respostasE08(
      { cor: 'laranja', cores: PROTOCOLO_SINTETICO.cores, sinais, queixa: 'Dor no peito', observacoes: '  ' },
      mapa,
      TODOS,
    );
    expect(r.situacao).toBe('respostas');
    if (r.situacao !== 'respostas') return;
    expect(r.comPrioridade).toBe(true);
    expect(r.respostas.map((x) => [x.vinculo, x.valor])).toEqual([
      [2, { tipo: 'texto', texto: 'Dor no peito' }],
      [4, { tipo: 'texto', texto: '130/85' }],
      [5, { tipo: 'numero', valor: 96 }],
      [6, { tipo: 'texto', texto: '37,8' }],
      [7, { tipo: 'numero', valor: 18 }],
      [9, { tipo: 'numero', valor: 97 }],
      [12, { tipo: 'escolha', indice: 2 }],
    ]);
    expect(r.respostas.every((x) => !x.autopreenchido && !x.confirmado)).toBe(true);
  });

  it('cor sem opção equivalente (ou índice nunca visto) grava sem prioridade e avisa', () => {
    const { mapa } = mapaDoModeloE08(MODELO);
    const semAzul = PROTOCOLO_SINTETICO.cores.map((c) => (c.cor === 'azul' ? { ...c, opcaoE08: null } : c));
    const a = respostasE08(
      { cor: 'azul', cores: semAzul, sinais, queixa: 'Receita', observacoes: 'Retorno' },
      mapa,
      TODOS,
    );
    expect(a).toMatchObject({ situacao: 'respostas', comPrioridade: false });
    if (a.situacao === 'respostas') {
      expect(a.respostas.some((x) => x.vinculo === 12)).toBe(false);
      expect(a.respostas.at(-1)).toMatchObject({ vinculo: 13, valor: { tipo: 'texto', texto: 'Retorno' } });
    }
    const nuncaVisto = respostasE08(
      { cor: 'vermelho', cores: PROTOCOLO_SINTETICO.cores, sinais, queixa: 'Parada', observacoes: null },
      mapa,
      new Set([2, 3, 4, 5]),
    );
    expect(nuncaVisto).toMatchObject({ comPrioridade: false });
    const foraDoModelo = respostasE08(
      {
        cor: 'verde',
        cores: PROTOCOLO_SINTETICO.cores.map((c) => (c.cor === 'verde' ? { ...c, opcaoE08: 9 } : c)),
        sinais,
        queixa: 'Tosse',
        observacoes: null,
      },
      mapa,
      new Set([9]),
    );
    expect(foraDoModelo).toMatchObject({ comPrioridade: false });
  });

  it('alergia relatada (Sim/Não) e comorbidades pelo texto das opções; o componente da lista de alergias não recebe nada', () => {
    const { mapa } = mapaDoModeloE08(MODELO);
    expect(mapa.alergia?.vinculo).toBe(10);
    const r = respostasE08(
      {
        cor: 'verde',
        cores: PROTOCOLO_SINTETICO.cores,
        sinais,
        queixa: 'Tosse',
        observacoes: null,
        alergia: 'nao',
        comorbidades: ['dm', 'has', 'outros'],
      },
      mapa,
      TODOS,
    );
    if (r.situacao !== 'respostas') throw new Error('esperava respostas');
    expect(r.respostas.find((x) => x.vinculo === 10)?.valor).toEqual({ tipo: 'escolha', indice: 2 });
    expect(r.respostas.find((x) => x.vinculo === 11)?.valor).toEqual({
      tipo: 'multipla',
      indices: [0, 1, 4],
    });
    expect(r.respostas.some((x) => x.vinculo === 14)).toBe(false);
    const sem = respostasE08(
      {
        cor: 'verde',
        cores: PROTOCOLO_SINTETICO.cores,
        sinais,
        queixa: 'Tosse',
        observacoes: null,
        alergia: null,
      },
      mapa,
      TODOS,
    );
    if (sem.situacao === 'respostas')
      expect(sem.respostas.some((x) => x.vinculo === 10 || x.vinculo === 11)).toBe(false);
  });

  it('pressão só com as duas medidas', () => {
    const { mapa } = mapaDoModeloE08(MODELO);
    const r = respostasE08(
      {
        cor: 'verde',
        cores: PROTOCOLO_SINTETICO.cores,
        sinais: { ...sinais, pad: null },
        queixa: 'Tosse',
        observacoes: null,
      },
      mapa,
      TODOS,
    );
    if (r.situacao === 'respostas') expect(r.respostas.some((x) => x.vinculo === 4)).toBe(false);
  });
});
