// @vitest-environment jsdom
// M58 (etapa 5): o cliente da janela em produção valida pelo contrato (fora dele, recusa); os textos cobrem todo código
// do contrato (etapas do roteiro, fases, papéis, checagens, situações, achados, motivos), sem chave técnica nem o
// sistema anterior; a tela mostra a restrição de entrada com o que falta, o roteiro do passo escolhido com os minutos,
// a janela e a volta atrás estimadas e as verificações da produção e do ensaio com os achados traduzidos.
import {
  ACHADOS_JANELA,
  AMBIENTES_VERIFICACAO_JANELA,
  CHECAGENS_JANELA,
  ETAPAS_ROTEIRO_JANELA,
  FASES_ROTEIRO_JANELA,
  MOTIVOS_RETIRADA_RESTRICAO,
  type PainelJanela,
  RESPONSAVEIS_JANELA,
  SITUACOES_CHECAGEM_JANELA,
  SITUACOES_RETIRADA,
} from '@sgh/contratos';
import { criarI18n } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { lerJanela } from './api.js';
import { mensagensJanela as m } from './i18n-janela.js';
import Tela from './telas/MigracaoJanelaTela.vue';

vi.mock('../../casca/sessao/pode.js', () => ({ pode: () => true }));
afterEach(() => vi.unstubAllGlobals());

const verificacaoEnsaio = {
  ambiente: 'ensaio' as const,
  em: '2026-10-29T03:00:00.000Z',
  inicio: '2026-10-29T01:00:00.000Z',
  fim: '2026-10-29T02:30:00.000Z',
  duracaoMinutos: 90,
  checagens: [
    { checagem: 'plataforma' as const, situacao: 'aprovada' as const, achados: [] },
    { checagem: 'schema' as const, situacao: 'aprovada' as const, achados: [] },
    {
      checagem: 'contagens' as const,
      situacao: 'reprovada' as const,
      achados: ['contagens-diferentes' as const],
    },
    { checagem: 'saude' as const, situacao: 'aprovada' as const, achados: [] },
    {
      checagem: 'operacoes' as const,
      situacao: 'nao-executada' as const,
      achados: ['nao-executada' as const],
    },
  ],
  aprovada: false,
  numeros: { tabelas: 120, tabelasIguais: 119, operacoes: 0, operacoesVerdes: 0, latenciaMs: 35 },
  versaoMotor: '5.0.3',
  charsetBanco: 'NONE',
};

const painel: PainelJanela = {
  hospital: 'pc',
  em: '2026-10-29T12:00:00.000Z',
  relatorio: 'docs/marcos/M58/pc/janela.json',
  relatorioInvalido: null,
  registroInvalido: null,
  passos: [
    {
      passo: 'desligamento',
      autorizado: true,
      executado: true,
      ensaioAprovado: true,
      roteiro: [
        {
          etapa: 'confirmar-autorizacao',
          ordem: 1,
          fase: 'antes',
          responsavel: 'dono',
          comando: null,
          minutos: null,
          critica: true,
        },
        {
          etapa: 'verificar',
          ordem: 2,
          fase: 'verificacao',
          responsavel: 'ti',
          comando: 'pnpm janela:verificar pc',
          minutos: null,
          critica: true,
        },
      ],
      janelaMinutos: null,
      voltaAtrasMinutos: null,
      producao: null,
      ensaio: null,
    },
    {
      passo: 'firebird5',
      autorizado: false,
      executado: false,
      ensaioAprovado: true,
      roteiro: [
        {
          etapa: 'parar-acesso',
          ordem: 1,
          fase: 'parada',
          responsavel: 'ti',
          comando: null,
          minutos: null,
          critica: true,
        },
        {
          etapa: 'backup',
          ordem: 2,
          fase: 'execucao',
          responsavel: 'ti',
          comando: 'gbak -b -g -v <banco> <backup da versão 3>',
          minutos: 45,
          critica: true,
        },
        {
          etapa: 'restaurar-backup-anterior',
          ordem: 3,
          fase: 'volta-atras',
          responsavel: 'ti',
          comando: null,
          minutos: 60,
          critica: false,
        },
      ],
      janelaMinutos: 195,
      voltaAtrasMinutos: 60,
      producao: null,
      ensaio: verificacaoEnsaio,
    },
    {
      passo: 'utf8',
      autorizado: false,
      executado: false,
      ensaioAprovado: false,
      roteiro: [],
      janelaMinutos: null,
      voltaAtrasMinutos: null,
      producao: null,
      ensaio: null,
    },
  ],
  retirada: {
    chave: 'entrada.utf8',
    situacao: 'restrita',
    motivos: ['utf8-nao-autorizado', 'banco-nao-utf8'],
    charsetBanco: 'NONE',
    charsetParametro: 'CP1252',
  },
};

function responder(corpo: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200 })),
  );
}

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

async function montar() {
  const w = mount(Tela, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      stubs: { AbasMigracao: true, RouterLink: { template: '<a><slot /></a>' } },
    },
  });
  await flushPromises();
  return w;
}

describe('janela em produção (cliente)', () => {
  it('o painel é validado pelo contrato; fora dele, recusa', async () => {
    responder(painel);
    expect((await lerJanela()).passos).toHaveLength(3);
    responder({ ...painel, retirada: { ...painel.retirada, motivos: ['outro'] } });
    await expect(lerJanela()).rejects.toThrow();
  });
});

describe('textos da janela em produção', () => {
  it('todo código do contrato tem texto', () => {
    expect(Object.keys(m.etapas).sort()).toEqual([...ETAPAS_ROTEIRO_JANELA].sort());
    for (const e of ETAPAS_ROTEIRO_JANELA) {
      expect(m.etapas[e].titulo.length).toBeGreaterThan(3);
      expect(m.etapas[e].descricao.length).toBeGreaterThan(10);
    }
    expect(Object.keys(m.fases).sort()).toEqual([...FASES_ROTEIRO_JANELA].sort());
    expect(Object.keys(m.responsaveis).sort()).toEqual([...RESPONSAVEIS_JANELA].sort());
    expect(Object.keys(m.checagens).sort()).toEqual([...CHECAGENS_JANELA].sort());
    expect(Object.keys(m.situacoesChecagem).sort()).toEqual([...SITUACOES_CHECAGEM_JANELA].sort());
    expect(Object.keys(m.achados).sort()).toEqual([...ACHADOS_JANELA].sort());
    expect(Object.keys(m.motivos).sort()).toEqual([...MOTIVOS_RETIRADA_RESTRICAO].sort());
    expect(Object.keys(m.situacoesRetirada).sort()).toEqual([...SITUACOES_RETIRADA].sort());
    expect(Object.keys(m.ambientes).sort()).toEqual([...AMBIENTES_VERIFICACAO_JANELA].sort());
  });

  it('nenhum texto mostra nome de tabela, chave técnica ou o sistema anterior', () => {
    const achados = textos(m).filter(
      ([, t]) =>
        /\b[A-Z][A-Z0-9_]{5,}\b/.test(t) ||
        /entrada\.utf8|legado|sistema atual|spdata|gbak|gfix|win1252|cp1252|\bnone\b|@|\|/i.test(t),
    );
    expect(achados).toEqual([]);
  });
});

describe('tela da janela em produção', () => {
  it('abre no primeiro passo não executado: roteiro, minutos, janela, volta atrás e o ensaio com os achados', async () => {
    responder(painel);
    const w = await montar();
    expect(w.get('[data-testid="passo-estado"]').text()).toContain('Não autorizado');
    expect(w.get('[data-testid="passo-janela"]').text()).toContain('195 minutos');
    expect(w.get('[data-testid="passo-volta-atras"]').text()).toBe('60 minutos');
    const backup = w.get('[data-testid="etapa-backup"]').text();
    expect(backup).toContain('Cópia de segurança');
    expect(backup).toContain('gbak -b');
    expect(backup).toContain('45');
    expect(backup).toContain('crítica');
    expect(w.get('[data-testid="etapa-restaurar-backup-anterior"]').text()).toContain('Volta atrás');
    expect(w.get('[data-testid="verificacao-producao"]').text()).toContain('Ainda não verificada');
    const ensaio = w.get('[data-testid="verificacao-ensaio-resumo"]').text();
    expect(ensaio).toContain('Reprovada');
    expect(ensaio).toContain('90 minutos');
    expect(ensaio).toContain('5.0.3');
    expect(w.get('[data-testid="verificacao-ensaio"]').text()).toContain('Tabelas iguais: 119 de 120');
    expect(w.get('[data-testid="checagem-ensaio-contagens"]').text()).toContain(
      'contagem diferente da tirada antes',
    );
    expect(w.get('[data-testid="checagem-ensaio-operacoes"]').text()).toContain('Não executada');
  });

  it('a restrição de entrada mostra a situação, os charsets e o que falta; sem atalho enquanto restrita', async () => {
    responder(painel);
    const w = await montar();
    expect(w.get('[data-testid="retirada-situacao"]').text()).toContain('Restrita');
    expect(w.get('[data-testid="retirada-banco"]').text()).toBe('NONE');
    expect(w.get('[data-testid="retirada-parametro"]').text()).toBe('CP1252');
    expect(w.get('[data-testid="motivo-utf8-nao-autorizado"]').text()).toContain('ainda não foi autorizada');
    expect(w.get('[data-testid="motivo-banco-nao-utf8"]').text()).toContain('ainda não está em UTF-8');
    expect(w.find('[data-testid="ir-funcionalidades"]').exists()).toBe(false);
  });

  it('o passo que não para o banco diz isso; pode retirar dá o caminho; relatório inválido avisa', async () => {
    responder({
      ...painel,
      relatorioInvalido: 'formato inválido',
      passos: painel.passos.map((p) => ({ ...p, executado: true })),
      retirada: { ...painel.retirada, situacao: 'pode-retirar', motivos: [] },
    });
    const w = await montar();
    expect(w.get('[data-testid="janela-relatorio-invalido"]').text()).toContain('formato inválido');
    expect(w.get('[data-testid="retirada-situacao"]').text()).toContain('Pode ser retirada');
    expect(w.find('[data-testid="retirada-motivos"]').exists()).toBe(false);
    expect(w.find('[data-testid="ir-funcionalidades"]').exists()).toBe(true);
    // todos executados: abre no último (utf8, roteiro vazio, sem parada)
    await w.get('[data-testid="passo-desligamento"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="passo-janela"]').text()).toBe('Este passo não para o banco');
    expect(w.get('[data-testid="etapa-verificar"]').text()).toContain('pnpm janela:verificar pc');
  });
});
