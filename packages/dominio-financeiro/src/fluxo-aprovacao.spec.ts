// F8, 07-FIN linha 65: regras do fluxo de aprovação configurável (massa sintética).
import { describe, expect, it } from 'vitest';
import {
  type AgrupadorConfigurado,
  andamentoDepois,
  type AprovadorConfigurado,
  aprovadoresAptos,
  conferirDecisao,
  conferirFluxo,
  conferirSubmissao,
  type DocumentoEmAprovacao,
  documentoNoAgrupador,
  escolherFluxo,
  type EtapaConfigurada,
  etapasExigidas,
  type FluxoConfigurado,
  type NovoFluxo,
  type PedidoDecisao,
} from './fluxo-aprovacao.js';

const HOJE = '2026-11-25';
const doc = (valor: number, centro: number | null = 10, credor: number | null = 7): DocumentoEmAprovacao => ({
  tipo: 'pedido_compra',
  estabelecimento: 1,
  valor,
  atributos: { centro_custo: centro, credor },
  solicitante: 99,
});
const fluxo = (p: Partial<FluxoConfigurado>): FluxoConfigurado => ({
  id: 1,
  tipo: 'pedido_compra',
  estabelecimento: null,
  centroCusto: null,
  valorMinimo: 0,
  valorMaximo: null,
  prioridade: 1,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const etapa = (p: Partial<EtapaConfigurada>): EtapaConfigurada => ({
  id: 1,
  sequencia: 1,
  nome: 'Gestor',
  valorMinimo: null,
  valorMaximo: null,
  condicao: null,
  regraQuorum: 'qualquer',
  minimo: null,
  obrigatoria: true,
  ...p,
});
const aprovador = (p: Partial<AprovadorConfigurado>): AprovadorConfigurado => ({
  id: 1,
  etapa: 1,
  usuario: 1,
  papel: null,
  substituto: null,
  agrupador: null,
  valorLimite: null,
  aprovaPeloCelular: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const agrupador: AgrupadorConfigurado = {
  id: 5,
  criterio: 'centro_custo',
  aceitaVazio: false,
  ativo: true,
  membros: [10],
};

describe('escolha do fluxo', () => {
  it('filtra tipo, faixa, vigência e ativo; vence a menor prioridade e depois o mais específico', () => {
    const fs = [
      fluxo({ id: 1, prioridade: 2 }),
      fluxo({ id: 2, prioridade: 1 }),
      fluxo({ id: 3, prioridade: 1, centroCusto: 10 }),
      fluxo({ id: 4, prioridade: 0, ativo: false }),
      fluxo({ id: 5, prioridade: 0, vigenciaFim: '2026-06-30' }),
      fluxo({ id: 6, prioridade: 0, tipo: 'contrato_fornecedor' }),
      fluxo({ id: 7, prioridade: 0, valorMinimo: 5000 }),
    ];
    expect(escolherFluxo(fs, doc(1000), HOJE)?.id).toBe(3);
    expect(escolherFluxo(fs, doc(1000, 11), HOJE)?.id).toBe(2);
    expect(escolherFluxo(fs, doc(6000), HOJE)?.id).toBe(7);
    expect(escolherFluxo([fluxo({ estabelecimento: 2 })], doc(10), HOJE)).toBeNull();
  });
});

describe('agrupador, etapas e aprovadores aptos', () => {
  it('o documento entra no agrupador pelo valor do critério; vazio só se aceitar', () => {
    expect(documentoNoAgrupador(agrupador, doc(1))).toBe(true);
    expect(documentoNoAgrupador(agrupador, doc(1, 11))).toBe(false);
    expect(documentoNoAgrupador(agrupador, doc(1, null))).toBe(false);
    expect(documentoNoAgrupador({ ...agrupador, aceitaVazio: true }, doc(1, null))).toBe(true);
    expect(documentoNoAgrupador({ ...agrupador, ativo: false }, doc(1))).toBe(false);
  });
  it('aprovador fora do agrupador, acima da alçada ou fora da vigência não serve', () => {
    const aps = [
      aprovador({ id: 1, usuario: 1, agrupador: 5 }),
      aprovador({ id: 2, usuario: 2, valorLimite: 500 }),
      aprovador({ id: 3, usuario: 3, vigenciaInicio: '2027-01-01' }),
      aprovador({ id: 4, usuario: 4 }),
    ];
    expect(aprovadoresAptos(1, aps, [agrupador], doc(1000), HOJE).map((a) => a.id)).toEqual([1, 4]);
    expect(aprovadoresAptos(1, aps, [agrupador], doc(1000, 11), HOJE).map((a) => a.id)).toEqual([4]);
  });
  it('a etapa entra pela faixa e pela condição; a opcional sem aprovador é pulada', () => {
    const es = [
      etapa({ id: 2, sequencia: 2, nome: 'Diretoria', valorMinimo: 5000 }),
      etapa({ id: 1, sequencia: 1 }),
      etapa({ id: 3, sequencia: 3, nome: 'Credor 7', condicao: { credor: [7] } }),
      etapa({ id: 4, sequencia: 4, nome: 'Opcional', obrigatoria: false }),
    ];
    const aps = [aprovador({ etapa: 1 }), aprovador({ id: 2, etapa: 2 }), aprovador({ id: 3, etapa: 3 })];
    expect(etapasExigidas(es, aps, [], doc(1000), HOJE).map((e) => e.id)).toEqual([1, 3]);
    expect(etapasExigidas(es, aps, [], doc(9000, 10, 8), HOJE).map((e) => e.id)).toEqual([1, 2]);
  });
  it('a submissão recusa sem fluxo (o título segue a alçada), sem etapa e com etapa sem aprovador', () => {
    expect(conferirSubmissao(null, [], [], [], { ...doc(1), tipo: 'titulo_pagar' }, HOJE)?.mensagem).toMatch(
      /alçada/,
    );
    expect(conferirSubmissao(fluxo({}), [], [], [], doc(1), HOJE)?.codigo).toBe('sem-etapa');
    expect(conferirSubmissao(fluxo({}), [etapa({})], [], [], doc(1), HOJE)?.codigo).toBe(
      'etapa-sem-aprovador',
    );
    expect(conferirSubmissao(fluxo({}), [etapa({})], [aprovador({})], [], doc(1), HOJE)).toBeNull();
  });
});

describe('decisão', () => {
  const base: PedidoDecisao = {
    situacao: 'em_aprovacao',
    fluxo: 1,
    etapa: etapa({}),
    aptos: [
      aprovador({ usuario: 1, substituto: 2 }),
      aprovador({ id: 2, usuario: null, papel: 30, aprovaPeloCelular: false }),
    ],
    decisoes: [],
    solicitante: 99,
    usuario: 1,
    papeis: [],
    resposta: { id: 1, efeito: 'aprova', exigeJustificativa: false, fluxo: null, ativo: true },
    justificativa: '',
    canal: 'web',
  };
  it('o titular, o substituto e quem tem o papel decidem', () => {
    expect(conferirDecisao(base)).toBeNull();
    expect(conferirDecisao({ ...base, usuario: 2 })).toBeNull();
    expect(conferirDecisao({ ...base, usuario: 3, papeis: [30] })).toBeNull();
    expect(conferirDecisao({ ...base, usuario: 3 })?.codigo).toBe('sem-alcada');
  });
  it('quem pediu não decide; ninguém decide duas vezes; pedido concluído recusa', () => {
    expect(conferirDecisao({ ...base, usuario: 99 })?.codigo).toBe('aprovador-solicitante');
    expect(conferirDecisao({ ...base, decisoes: [{ etapa: 1, usuario: 1, efeito: 'aprova' }] })?.codigo).toBe(
      'decisao-repetida',
    );
    expect(conferirDecisao({ ...base, situacao: 'aprovado' })?.codigo).toBe('pedido-concluido');
  });
  it('pelo celular só o aprovador liberado; resposta de outro fluxo e justificativa curta recusam', () => {
    expect(conferirDecisao({ ...base, canal: 'celular' })).toBeNull();
    expect(conferirDecisao({ ...base, usuario: 3, papeis: [30], canal: 'celular' })?.codigo).toBe(
      'celular-nao-liberado',
    );
    expect(conferirDecisao({ ...base, resposta: { ...base.resposta!, fluxo: 2 } })?.codigo).toBe(
      'resposta-invalida',
    );
    expect(conferirDecisao({ ...base, resposta: null })?.codigo).toBe('resposta-invalida');
    const reprova = { ...base.resposta!, efeito: 'reprova' as const };
    expect(conferirDecisao({ ...base, resposta: reprova, justificativa: 'ab' })?.codigo).toBe(
      'justificativa-obrigatoria',
    );
    expect(conferirDecisao({ ...base, resposta: reprova, justificativa: 'sem verba' })).toBeNull();
    const exige = { ...base.resposta!, exigeJustificativa: true };
    expect(conferirDecisao({ ...base, resposta: exige })?.codigo).toBe('justificativa-obrigatoria');
  });
});

describe('andamento', () => {
  const es = [
    etapa({ id: 1, regraQuorum: 'minimo', minimo: 2 }),
    etapa({ id: 2, sequencia: 2, regraQuorum: 'todos' }),
  ];
  const aptos = new Map([
    [1, 3],
    [2, 2],
  ]);
  it('quórum mínimo segura a etapa; fechado, passa à próxima; "todos" pede cada apto', () => {
    expect(andamentoDepois(es, 1, aptos, [{ etapa: 1, usuario: 1, efeito: 'aprova' }])).toEqual({
      situacao: 'em_aprovacao',
      etapa: 1,
      nivel: 1,
      faltam: 1,
    });
    const duas = [
      { etapa: 1, usuario: 1, efeito: 'aprova' as const },
      { etapa: 1, usuario: 2, efeito: 'aprova' as const },
    ];
    expect(andamentoDepois(es, 1, aptos, duas)).toEqual({
      situacao: 'em_aprovacao',
      etapa: 2,
      nivel: 2,
      faltam: 2,
    });
    const fim = [
      ...duas,
      { etapa: 2, usuario: 3, efeito: 'aprova' as const },
      { etapa: 2, usuario: 4, efeito: 'aprova' as const },
    ];
    expect(andamentoDepois(es, 2, aptos, fim).situacao).toBe('aprovado');
  });
  it('reprovar ou devolver encerra o pedido na hora', () => {
    expect(andamentoDepois(es, 1, aptos, [{ etapa: 1, usuario: 1, efeito: 'reprova' }]).situacao).toBe(
      'reprovado',
    );
    expect(andamentoDepois(es, 1, aptos, [{ etapa: 1, usuario: 1, efeito: 'devolve' }]).situacao).toBe(
      'devolvido',
    );
  });
});

describe('configuração do fluxo', () => {
  const ok: NovoFluxo = {
    valorMinimo: 0,
    valorMaximo: 1000,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    etapas: [
      {
        sequencia: 1,
        nome: 'Gestor',
        valorMinimo: null,
        valorMaximo: null,
        regraQuorum: 'qualquer',
        minimo: null,
        obrigatoria: true,
        aprovadores: [
          {
            usuario: 1,
            papel: null,
            substituto: 2,
            valorLimite: null,
            vigenciaInicio: '2026-01-01',
            vigenciaFim: null,
          },
        ],
      },
    ],
  };
  const e0 = ok.etapas[0]!;
  const a0 = e0.aprovadores[0]!;
  it('aceita o fluxo bem formado e recusa cada erro com o código', () => {
    expect(conferirFluxo(ok)).toBeNull();
    expect(conferirFluxo({ ...ok, valorMaximo: -1 })?.codigo).toBe('faixa-invalida');
    expect(conferirFluxo({ ...ok, vigenciaFim: '2025-01-01' })?.codigo).toBe('vigencia-invalida');
    expect(conferirFluxo({ ...ok, etapas: [] })?.codigo).toBe('sem-etapa');
    expect(conferirFluxo({ ...ok, etapas: [e0, e0] })?.codigo).toBe('etapa-repetida');
    expect(conferirFluxo({ ...ok, etapas: [{ ...e0, aprovadores: [] }] })?.codigo).toBe(
      'etapa-sem-aprovador',
    );
    expect(conferirFluxo({ ...ok, etapas: [{ ...e0, regraQuorum: 'minimo', minimo: 2 }] })?.codigo).toBe(
      'quorum-invalido',
    );
    expect(conferirFluxo({ ...ok, etapas: [{ ...e0, aprovadores: [{ ...a0, papel: 3 }] }] })?.codigo).toBe(
      'aprovador-invalido',
    );
    expect(
      conferirFluxo({ ...ok, etapas: [{ ...e0, aprovadores: [{ ...a0, substituto: 1 }] }] })?.codigo,
    ).toBe('substituto-invalido');
    expect(conferirFluxo({ ...ok, etapas: [{ ...e0, aprovadores: [a0, a0] }] })?.codigo).toBe(
      'aprovador-repetido',
    );
  });
});
