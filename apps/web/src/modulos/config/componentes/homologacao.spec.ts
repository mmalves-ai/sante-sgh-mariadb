// @vitest-environment jsdom
// M36: as seções da homologação nas telas de coexistência — a rodada de conferência (contagens por onda e
// estabelecimento, o bloqueio do Serrano, o teste de invasão bloqueando a liberação, a fila de cenários controlados),
// os triggers vistos no rastreamento × catálogo e as impressões do schema. O cliente valida pelo contrato.
import type { PainelHomologacao } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { buscarPainelHomologacao, conferirTriggers } from '../api.js';
import ImpressoesHomologacao from './ImpressoesHomologacao.vue';
import RodadaConferencia from './RodadaConferencia.vue';
import TriggersVistos from './TriggersVistos.vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);
const plugins = () => ({ global: { plugins: [i18n(), ui] } });

const painel: PainelHomologacao = {
  formato: 1,
  geradoEm: '2026-10-23T12:00:00.000Z',
  versaoRoteiro: '2026-10-23.1',
  hospitais: [
    {
      codigo: 'pc',
      bloqueio: null,
      impressaoHomologada: 'a1b2c3d4e5f60718',
      impressoesConferidas: { a1b2c3d4e5f60718: 2 },
    },
    {
      codigo: 'hs',
      bloqueio: 'HS-1: sem a cópia do Serrano',
      impressaoHomologada: null,
      impressoesConferidas: {},
    },
  ],
  producao: 'sem leitura pela equipe de construção',
  rodadas: [
    {
      onda: 0,
      rotulo: 'Onda 0 (leituras e eventos de acesso)',
      quem: 'TI e gestor de acessos',
      porHospital: {
        pc: { operacoes: 4, verdes: 3, conferidas: 1, comCenarioControlado: 1 },
        hs: { operacoes: 4, verdes: 0, conferidas: 0, comCenarioControlado: 0 },
      },
    },
  ],
  operacoes: [
    {
      nome: 'acesso.trocarSenha',
      onda: 0,
      santeApi: false,
      origens: { 'cenario-controlado': 1 },
      estados: { pc: 'conferida', hs: 'especificada' },
      conferencias: { pc: { data: '2026-11-03', papeis: ['ti'], resultado: 'conferida', problemas: [] } },
      triggers: { catalogo: ['TRG_A', 'TRG_B'], vistos: ['TRG_A', 'TRG_C'] },
    },
    {
      nome: 'agenda.agendarConsulta',
      onda: 1,
      santeApi: true,
      origens: { perfil: 2 },
      estados: { pc: 'verde', hs: 'especificada' },
      conferencias: {},
      triggers: { catalogo: ['TRG_X'], vistos: null },
    },
  ],
  filaCenarioControlado: [{ operacao: 'enfermagem.aprazarHorario', motivo: 'cenário controlado no M36' }],
  pentest: {
    situacao: 'nao-iniciado',
    abertosCriticosOuAltos: 0,
    porSeveridade: {},
    reteste: null,
    bloqueiaLiberacao: true,
  },
  problemas: [],
};

describe('homologação nas telas de coexistência (M36)', () => {
  it('conferirTriggers: ausentes e a mais; sem cenário controlado, nada', () => {
    expect(conferirTriggers({ catalogo: ['A', 'B'], vistos: ['A', 'C'] })).toEqual({
      ausentes: ['B'],
      aMais: ['C'],
    });
    expect(conferirTriggers({ catalogo: ['A'], vistos: null })).toEqual({ ausentes: [], aMais: [] });
  });

  it('o cliente valida pelo contrato e aceita o painel ainda não gerado', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ painel }), { status: 200 }));
    expect((await buscarPainelHomologacao(ok as unknown as typeof fetch))?.versaoRoteiro).toBe(
      '2026-10-23.1',
    );
    const nulo = vi.fn(async () => new Response(JSON.stringify({ painel: null }), { status: 200 }));
    expect(await buscarPainelHomologacao(nulo as unknown as typeof fetch)).toBeNull();
    const erro = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(buscarPainelHomologacao(erro as unknown as typeof fetch)).rejects.toThrow(/403/);
  });

  it('rodada de conferência: contagens, bloqueio do Serrano, teste de invasão bloqueando e a fila', () => {
    const w = mount(RodadaConferencia, { props: { painel }, ...plugins() });
    expect(w.findAll('[data-testid="linha-rodada"]')).toHaveLength(1);
    expect(w.text()).toContain('Onda 0 (leituras e eventos de acesso)');
    expect(w.text()).toContain('HS-1');
    expect(w.find('[data-testid="situacao-pentest"]').text()).toMatch(
      /não iniciado.*não pode ir à primeira liberação/s,
    );
    expect(w.find('[data-testid="fila-controlado"]').text()).toContain('1 operação');
    expect(w.text()).toContain('Nenhum problema nos registros de conferência.');
  });

  it('triggers vistos × catálogo só nas operações com cenário controlado, com o filtro', () => {
    const w = mount(TriggersVistos, { props: { painel, filtro: '' }, ...plugins() });
    const linhas = w.findAll('tbody tr');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.text()).toContain('TRG_B');
    expect(linhas[0]?.text()).toContain('TRG_C');
    const vazio = mount(TriggersVistos, { props: { painel, filtro: 'agenda' }, ...plugins() });
    expect(vazio.find('[data-testid="triggers-nenhum"]').exists()).toBe(true);
  });

  it('impressões: homologada, nas conferências (com a quantidade), bloqueio e produção', () => {
    const w = mount(ImpressoesHomologacao, { props: { painel }, ...plugins() });
    expect(w.text()).toContain('a1b2c3d4e5f60718 (2)');
    expect(w.text()).toContain('HS-1');
    expect(w.text()).toContain('sem leitura pela equipe de construção');
  });
});
