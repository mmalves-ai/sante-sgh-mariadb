// @vitest-environment jsdom
// M59 (etapa 6): o cliente do painel da retrocompatibilidade valida pelo contrato (fora dele, recusa); os textos cobrem
// todo código do contrato (condições, decisões, passos, medidas, situações, motivos, retiradas), sem chave técnica nem
// o sistema anterior; a tela mostra a decisão registrada e a que vale, o aviso da extinção sem as condições, as
// condições com a data, os cinco passos com o tamanho, a ficha e o que falta, as retiradas e as medidas do banco.
import {
  CONDICOES_EXTINCAO,
  DECISOES_RETROCOMPATIBILIDADE,
  ESTADOS_OPERACAO,
  MEDIDAS_EVOLUCAO,
  MOTIVOS_BLOQUEIO_EVOLUCAO,
  OPERACOES_DE_RETIRADA,
  type PainelRetrocompatibilidade,
  PASSOS_EVOLUCAO,
  PLANO_EVOLUCAO,
  SITUACOES_PASSO_EVOLUCAO,
} from '@sgh/contratos';
import { criarI18n } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  chaveOperacao,
  lerRetrocompatibilidade,
  URL_RETROCOMPATIBILIDADE,
} from './api-retrocompatibilidade.js';
import { mensagensRetrocompatibilidade as m } from './i18n-retrocompatibilidade.js';
import Tela from './telas/MigracaoRetrocompatibilidadeTela.vue';

afterEach(() => vi.unstubAllGlobals());

const inventario = {
  tabelas: 3756,
  gatilhos: { total: 2537, ativos: 2511, tabelas: 2061 },
  colunasDeUmaLetra: { colunas: 5975, tabelas: 1231 },
  paresDataHora: { pares: 221, tabelas: 147 },
  chavesEmTexto: { chaves: 763, deTotal: 6447, tabelas: 400 },
  tabelasClinicas: { matriz: 54, presentes: 54 },
  gatilhosSghEmTabelaLegada: 0,
};
const tamanhos = {
  'tabelas-clinicas': 54,
  gatilhos: 2537,
  'colunas-de-uma-letra': 5975,
  'pares-data-hora': 221,
  'chaves-em-texto': 763,
} as const;

const painel: PainelRetrocompatibilidade = {
  hospital: 'pc',
  em: '2026-10-30T12:00:00.000Z',
  adr: { numero: '0033', caminho: 'docs/adr/0033-retrocompatibilidade-e-evolucao-do-modelo.md' },
  decisaoRegistrada: 'pendente',
  decisaoVigente: 'mantida',
  decididaEm: null,
  referencia: null,
  contingenciaLonga: false,
  revisarEm: null,
  extincaoSemCondicoes: [],
  condicoes: CONDICOES_EXTINCAO.map((c, i) => ({
    condicao: c,
    cumprida: i === 0,
    em: i === 0 ? '2026-09-15' : null,
    fonte: 'fonte',
  })),
  podeDecidirExtincao: false,
  passos: PLANO_EVOLUCAO.map((p) => ({
    passo: p.passo,
    ordem: p.ordem,
    titulo: p.titulo,
    descricao: p.descricao,
    medida: p.medida,
    tamanho: tamanhos[p.medida],
    mudaLeituraSanteApi: p.mudaLeituraSanteApi,
    ficha: p.ordem === 1 ? 'docs/adr/0033-retrocompatibilidade-e-evolucao-do-modelo.md#evo-01' : null,
    situacao: 'bloqueado',
    motivos:
      p.ordem === 1
        ? ['retrocompatibilidade-nao-extinta']
        : p.mudaLeituraSanteApi
          ? [
              'retrocompatibilidade-nao-extinta',
              'passo-anterior-pendente',
              'sem-ficha',
              'sem-combinado-hal-ai',
            ]
          : ['retrocompatibilidade-nao-extinta'],
  })),
  operacoesDeRetirada: OPERACOES_DE_RETIRADA.map((o, i) => ({
    operacao: o,
    estadoEsperado: 'especificada',
    estadoAtual: i === 0 ? 'verde' : 'especificada',
    divergente: i === 0,
  })),
  inventario,
  inventarioMedidoEm: '2026-10-30T11:00:00.000Z',
  inventarioIndisponivel: false,
  registro: 'docs/coexistencia/retrocompatibilidade/pc.yaml',
  registroInvalido: null,
};

function responder(corpo: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', f);
  return f;
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

describe('retrocompatibilidade (cliente)', () => {
  it('lê por GET no endereço do painel, validado pelo contrato; fora dele, recusa', async () => {
    const f = responder(painel);
    expect((await lerRetrocompatibilidade()).passos).toHaveLength(5);
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit | undefined];
    expect(url).toBe(URL_RETROCOMPATIBILIDADE);
    expect(init?.method ?? 'GET').toBe('GET');
    responder({ ...painel, decisaoVigente: 'pendente' });
    await expect(lerRetrocompatibilidade()).rejects.toThrow();
  });

  it('a recusa do servidor vira erro', async () => {
    responder({ type: 'about:blank', title: 'Proibido', status: 403 }, 403);
    await expect(lerRetrocompatibilidade()).rejects.toThrow();
  });
});

describe('textos da retrocompatibilidade', () => {
  it('todo código do contrato tem texto', () => {
    expect(Object.keys(m.condicoes.nomes).sort()).toEqual([...CONDICOES_EXTINCAO].sort());
    for (const c of CONDICOES_EXTINCAO) {
      expect(m.condicoes.nomes[c].titulo.length).toBeGreaterThan(3);
      expect(m.condicoes.nomes[c].fonte.length).toBeGreaterThan(10);
    }
    expect(Object.keys(m.decisao.nomes).sort()).toEqual([...DECISOES_RETROCOMPATIBILIDADE].sort());
    expect(Object.keys(m.passos.nomes).sort()).toEqual([...PASSOS_EVOLUCAO].sort());
    for (const p of PASSOS_EVOLUCAO) {
      expect(m.passos.nomes[p].titulo.length).toBeGreaterThan(3);
      expect(m.passos.nomes[p].descricao.length).toBeGreaterThan(10);
    }
    expect(Object.keys(m.passos.medidas).sort()).toEqual([...MEDIDAS_EVOLUCAO].sort());
    expect(Object.keys(m.retiradas.estadosCatalogo).sort()).toEqual([...ESTADOS_OPERACAO].sort());
    // cada medida tem singular e plural
    for (const v of Object.values(m.passos.medidas)) expect(v.split(' | ')).toHaveLength(2);
    expect(Object.keys(m.passos.situacoes).sort()).toEqual([...SITUACOES_PASSO_EVOLUCAO].sort());
    expect(Object.keys(m.passos.motivosBloqueio).sort()).toEqual([...MOTIVOS_BLOQUEIO_EVOLUCAO].sort());
    expect(Object.keys(m.retiradas.nomes).sort()).toEqual(OPERACOES_DE_RETIRADA.map(chaveOperacao).sort());
  });

  it('nenhum texto mostra nome de tabela, chave técnica, marco ou o sistema anterior', () => {
    // a barra só vale como separador de singular e plural nas medidas (a tela nunca a mostra)
    const visivel = ([k, t]: [string, string]): [string, string] => [
      k,
      k.startsWith('passos.medidas.') ? t.replace(/ \| /g, ' ') : t,
    ];
    const achados = textos(m)
      .map(visivel)
      .filter(
        ([, t]) =>
          /\b[A-Z][A-Z0-9_]{5,}\b|\bSGH_|\bM\d{2}\b|\bDP-\d/.test(t) ||
          /legado|sistema atual|spdata|sante-api|firebird|trigger|@|\|/i.test(t),
      );
    expect(achados).toEqual([]);
  });
});

describe('tela da retrocompatibilidade', () => {
  it('pendente vale mantida: condições com a data, passos com tamanho, ficha e o que falta; retiradas e medidas', async () => {
    responder(painel);
    const w = await montar();
    expect(w.get('[data-testid="retro-decisao-registrada"]').text()).toContain('Pendente');
    expect(w.get('[data-testid="retro-decisao-vigente"]').text()).toBe('Mantida');
    expect(w.find('[data-testid="retro-extincao-sem-condicoes"]').exists()).toBe(false);
    expect(w.get('[data-testid="retro-pode-decidir"]').text()).toContain('Ainda faltam');
    const fim = w.get('[data-testid="condicao-fim-da-coexistencia-registrado"]').text();
    expect(fim).toContain('Cumprida');
    expect(fim).toContain('15/09/2026');
    expect(w.get('[data-testid="condicao-dp6-decidida"]').text()).toContain('Pendente');
    expect(w.get('[data-testid="passo-tamanho-imutabilidade-por-linha"]').text()).toBe('54 tabelas clínicas');
    expect(w.get('[data-testid="passo-tamanho-regras-dos-gatilhos"]').text()).toBe('2.537 gatilhos');
    expect(w.get('[data-testid="passo-ficha-imutabilidade-por-linha"]').text()).toContain('#evo-01');
    expect(w.get('[data-testid="passo-ficha-booleanos"]').text()).toBe('sem ficha');
    expect(w.get('[data-testid="passo-situacao-booleanos"]').text()).toBe('Bloqueado');
    expect(w.get('[data-testid="passo-motivos-booleanos"]').text()).toContain('combinado com a Hal-AI');
    expect(w.get('[data-testid="passo-imutabilidade-por-linha"]').text()).toContain('não muda o que ela lê');
    expect(w.get('[data-testid="retirada-acesso-retirarSenhaLegado"]').text()).toContain('Especificada');
    // o catálogo não acompanha a decisão numa das retiradas: a linha e o aviso mostram
    expect(w.get('[data-testid="retirada-atual-acesso-retirarSenhaLegado"]').text()).toBe('Verde');
    expect(w.get('[data-testid="retirada-confere-acesso-retirarSenhaLegado"]').text()).toBe('não');
    expect(w.get('[data-testid="retirada-confere-acesso-retirarSenhaSecundaria"]').text()).toBe('sim');
    const div = w.get('[data-testid="retiradas-divergencia"]').text();
    expect(div).toContain('Retirar a senha antiga das pessoas');
    expect(div).not.toContain('senha secundária');
    const inv = w.get('[data-testid="retro-inventario"]').text();
    expect(inv).toContain('3.756');
    expect(inv).toContain('Gatilhos: 2.537 (2.511 ativos) em 2.061 tabelas');
    expect(inv).toContain('Chaves em texto: 763 de 6.447 chaves');
    expect(inv).toContain('54 de 54');
    expect(w.find('[data-testid="retro-gatilhos-sgh-alerta"]').exists()).toBe(false);
    // ordem do plano: imutabilidade por linha primeiro
    const linhas = w.findAll('[data-testid="retro-passos"] tbody tr').map((r) => r.attributes('data-testid'));
    expect(linhas).toEqual(PASSOS_EVOLUCAO.map((p) => `passo-${p}`));
  });

  it('extinção sem as condições vale mantida e diz o que falta; registro inválido e catálogo indisponível avisam', async () => {
    responder({
      ...painel,
      decisaoRegistrada: 'extinta',
      decisaoVigente: 'mantida',
      decididaEm: '2026-10-29',
      referencia: 'planejamento/ESTADO.md',
      extincaoSemCondicoes: ['outro-sistema-desligado', 'contingencia-encerrada'],
      registroInvalido: 'formato inválido',
      inventario: null,
      inventarioMedidoEm: null,
      inventarioIndisponivel: true,
      passos: painel.passos.map((p) => ({ ...p, tamanho: null })),
      operacoesDeRetirada: painel.operacoesDeRetirada.map((o) => ({
        ...o,
        estadoAtual: null,
        divergente: true,
      })),
    });
    const w = await montar();
    expect(w.get('[data-testid="retro-decisao-registrada"]').text()).toBe('Extinta');
    expect(w.get('[data-testid="retro-decisao-vigente"]').text()).toBe('Mantida');
    const aviso = w.get('[data-testid="retro-extincao-sem-condicoes"]').text();
    expect(aviso).toContain('Outro sistema desligado; Período de contingência encerrado');
    expect(w.get('[data-testid="retro-registro-invalido"]').text()).toContain('formato inválido');
    expect(w.find('[data-testid="retro-inventario-indisponivel"]').exists()).toBe(true);
    expect(w.find('[data-testid="retro-inventario"]').exists()).toBe(false);
    expect(w.get('[data-testid="passo-tamanho-booleanos"]').text()).toBe('sem medida');
    expect(w.get('[data-testid="retirada-atual-integracao-cifrarSegredoLegado"]').text()).toBe('Sem leitura');
    expect(w.find('[data-testid="retiradas-divergencia"]').exists()).toBe(true);
  });

  it('extinta com as condições: pode decidir, retiradas verdes; gatilho do Sante em tabela do outro sistema alerta', async () => {
    responder({
      ...painel,
      decisaoRegistrada: 'extinta',
      decisaoVigente: 'extinta',
      condicoes: painel.condicoes.map((c) => ({ ...c, cumprida: true, em: '2026-10-01' })),
      podeDecidirExtincao: true,
      passos: painel.passos.map((p) =>
        p.ordem === 1
          ? { ...p, situacao: 'pronto-para-autorizar' as const, motivos: [] }
          : { ...p, tamanho: 1 },
      ),
      operacoesDeRetirada: painel.operacoesDeRetirada.map((o) => ({
        ...o,
        estadoEsperado: 'verde' as const,
        estadoAtual: 'liberada' as const,
        divergente: false,
      })),
      inventario: { ...inventario, gatilhosSghEmTabelaLegada: 2 },
    });
    const w = await montar();
    expect(w.get('[data-testid="retro-decisao-vigente"]').text()).toBe('Extinta');
    expect(w.get('[data-testid="retro-pode-decidir"]').text()).toContain('pode ser decidida');
    expect(w.get('[data-testid="passo-situacao-imutabilidade-por-linha"]').text()).toBe(
      'Pronto para autorizar',
    );
    expect(w.find('[data-testid="passo-motivos-imutabilidade-por-linha"]').exists()).toBe(false);
    expect(w.get('[data-testid="retirada-integracao-cifrarSegredoLegado"]').text()).toContain('Verde');
    expect(w.get('[data-testid="retirada-atual-integracao-cifrarSegredoLegado"]').text()).toBe('Liberada');
    expect(w.find('[data-testid="retiradas-divergencia"]').exists()).toBe(false);
    // singular com 1 (e plural com 0 e os demais)
    expect(w.get('[data-testid="passo-tamanho-chaves-por-id"]').text()).toBe('1 chave em texto');
    expect(w.get('[data-testid="passo-tamanho-regras-dos-gatilhos"]').text()).toBe('1 gatilho');
    expect(w.get('[data-testid="passo-tamanho-data-e-hora"]').text()).toBe('1 par de data e hora');
    expect(w.get('[data-testid="retro-gatilhos-sgh"]').text()).toContain(': 2');
    expect(w.find('[data-testid="retro-gatilhos-sgh-alerta"]').exists()).toBe(true);
  });

  it('erro do servidor aparece no lugar do painel', async () => {
    responder({ type: 'about:blank', title: 'Proibido', status: 403 }, 403);
    const w = await montar();
    expect(w.find('[data-testid="retro-decisao"]').exists()).toBe(false);
  });
});
