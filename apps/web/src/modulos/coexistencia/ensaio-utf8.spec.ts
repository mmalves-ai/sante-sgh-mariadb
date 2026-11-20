// @vitest-environment jsdom
// M58 (etapa 3): o cliente do ensaio do UTF-8 valida pelo contrato (fora dele, recusa); os textos cobrem todo código
// do contrato e todo achado que a regra produz, sem chave técnica nem o sistema anterior; a tela mostra as etapas
// reavaliadas, os achados traduzidos, a janela, a página, os índices que pedem página maior, a dependência do ensaio
// da versão 5 e o aviso do relatório ausente; o cartão da estrutura do banco ganha a linha do ensaio.
import {
  ETAPAS_ENSAIO_UTF8,
  MOTIVOS_ETAPA_BLOQUEADA,
  type ResumoEnsaioUtf8,
  SITUACOES_ETAPA_ENSAIO,
} from '@sgh/contratos';
import { criarI18n } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { buscarEnsaioUtf8 } from '../config/api.js';
import PlataformaBanco from '../config/componentes/PlataformaBanco.vue';
import { lerEnsaioUtf8 } from './api.js';
import { chaveAchadoUtf8, mensagensEnsaioUtf8 as m } from './i18n-ensaio-utf8.js';
import Tela from './telas/MigracaoEnsaioUtf8Tela.vue';

afterEach(() => vi.unstubAllGlobals());

const etapas = ETAPAS_ENSAIO_UTF8.map((etapa) => ({
  etapa,
  situacao:
    etapa === 'equivalencia'
      ? 'reprovada'
      : etapa === 'sante-api'
        ? 'bloqueada'
        : etapa === 'carga'
          ? 'nao-executada'
          : 'aprovada',
  bloqueio: etapa === 'sante-api' ? 'equipe-hal-ai' : null,
  achados:
    etapa === 'equivalencia'
      ? ['coluna-diferente:TX_SINTETICA.NOME', 'tabela-nao-verificada:TY_SINTETICA']
      : etapa === 'carga'
        ? ['slo-nao-medido-ou-falhou']
        : [],
}));
const resumo: ResumoEnsaioUtf8 = {
  hospital: 'pc',
  em: '2026-10-27T12:00:00.000Z',
  relatorio: 'docs/marcos/M58/pc/utf8.json',
  relatorioInvalido: null,
  ensaiadoEm: '2026-10-27',
  origem: '5.0.3 (NONE)',
  alvo: '5.0.3 (UTF8)',
  etapas: etapas as ResumoEnsaioUtf8['etapas'],
  aprovavel: false,
  janelaMinutos: 240,
  indicesEstourados: [
    { nome: 'IX_SINTETICO', tabela: 'TX_SINTETICA', chaveBytes: 4_000, paginaMinima: 16384 },
  ],
  paginaAlvo: 16384,
  firebird5Aprovado: false,
  registro: null,
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
      stubs: { AbasMigracao: true, RouterLink: true },
    },
  });
  await flushPromises();
  return w;
}

describe('ensaio do UTF-8 (cliente)', () => {
  it('o resumo é validado pelo contrato nos dois clientes; fora dele, recusa', async () => {
    responder(resumo);
    expect((await lerEnsaioUtf8()).paginaAlvo).toBe(16384);
    expect((await buscarEnsaioUtf8()).etapas).toHaveLength(16);
    responder({ ...resumo, etapas: [{ etapa: 'outra', situacao: 'aprovada', bloqueio: null, achados: [] }] });
    await expect(lerEnsaioUtf8()).rejects.toThrow();
  });
});

describe('textos do ensaio do UTF-8', () => {
  it('todo código do contrato tem texto', () => {
    for (const e of ETAPAS_ENSAIO_UTF8) {
      expect(m.etapas[e].titulo.length).toBeGreaterThan(3);
      expect(m.etapas[e].descricao.length).toBeGreaterThan(10);
    }
    expect(Object.keys(m.etapas).sort()).toEqual([...ETAPAS_ENSAIO_UTF8].sort());
    for (const s of SITUACOES_ETAPA_ENSAIO) expect(m.situacoes[s]).toBeTruthy();
    for (const b of MOTIVOS_ETAPA_BLOQUEADA) expect(m.bloqueios[b]).toBeTruthy();
  });

  it('todo achado que a regra produz tem texto; o desconhecido cai no genérico', () => {
    // Os códigos de achadosDaEtapa e explicarDesvioCharset (packages/dominio-config/src/desligamento/ensaio-utf8.ts);
    // a web não importa o domínio (fronteiras), então a lista fica aqui.
    const codigos = [
      'sem-impressao-base',
      'integridade-nao-verificada',
      'sem-inventario',
      'catalogada-ausente',
      'indice-sem-pagina',
      'sem-pagina',
      'pagina-alvo-insuficiente',
      'literal-a-rever',
      'literal-mudou',
      'funcao-por-byte',
      'fonte-sem-ida-e-volta',
      'tabela-rejeitada',
      'sem-tempo',
      'sem-tabelas',
      'tabela-diferente',
      'coluna-diferente',
      'tabela-nao-verificada',
      'sem-resumo',
      'resumo-diferente',
      'contagem-diferente',
      'sem-catalogadas',
      'catalogada-sem-ida-e-volta',
      'sem-blobs',
      'blob-diferente',
      'rtf-nao-abre',
      'sem-objetos',
      'invalido',
      'corpus-incompleto',
      'corpus-sem-ida-e-volta',
      'charset-nao-conferido',
      'sem-impressao',
      'schema-ausentes',
      'schema-novos',
      'schema-alterados',
      'sem-operacoes',
      'assinaturas-diferentes',
      'slo-nao-medido-ou-falhou',
      'contratos-nao-verdes',
      'parceiro-com-erro',
      'parceiros-nao-avisados',
      'sem-parceiros',
    ];
    expect(Object.keys(m.achados).sort()).toEqual([...codigos, 'desconhecido'].sort());
    expect(chaveAchadoUtf8('coluna-diferente:TX.NOME')).toEqual({
      codigo: 'coluna-diferente',
      nome: 'TX.NOME',
    });
    expect(chaveAchadoUtf8('sem-resumo')).toEqual({ codigo: 'sem-resumo', nome: '' });
    expect(chaveAchadoUtf8('xyz:1')).toEqual({ codigo: 'desconhecido', nome: 'xyz:1' });
  });

  it('nenhum texto mostra nome de tabela, chave técnica ou o sistema anterior', () => {
    const achados = textos(m).filter(
      ([, t]) =>
        /\b[A-Z][A-Z0-9_]{5,}\b/.test(t) ||
        /\bsante-api\b|legado|sistema atual|spdata|gbak|win1252|\bnone\b/i.test(t),
    );
    expect(achados).toEqual([]);
  });
});

describe('tela do ensaio do UTF-8', () => {
  it('mostra as etapas reavaliadas, os achados traduzidos, a janela, a página e os índices', async () => {
    responder(resumo);
    const w = await montar();
    expect(w.get('[data-testid="ensaio-aprovavel"]').text()).toContain('Aprovadas 13 de 16');
    expect(w.get('[data-testid="ensaio-janela"]').text()).toContain('240 minutos');
    expect(w.get('[data-testid="ensaio-pagina"]').text()).toBe('16384 bytes');
    expect(w.get('[data-testid="ensaio-firebird5"]').text()).toContain('ainda não aprovado');
    expect(w.get('[data-testid="situacao-equivalencia"]').text()).toBe('Reprovada');
    const eq = w.get('[data-testid="etapa-equivalencia"]').text();
    expect(eq).toContain('TX_SINTETICA.NOME');
    expect(eq).toContain('não pôde ser percorrida');
    expect(w.get('[data-testid="etapa-sante-api"]').text()).toContain('equipe da Hal-AI');
    expect(w.get('[data-testid="situacao-carga"]').text()).toBe('Não executada');
    const ix = w.get('[data-testid="indice-IX_SINTETICO"]').text();
    expect(ix).toContain('4000 bytes');
    expect(ix).toContain('16384 bytes');
    expect(w.get('[data-testid="ensaio-registro"]').text()).toBe('Sem registro do ensaio');
    expect(w.find('[data-testid="ensaio-invalido"]').exists()).toBe(false);
  });

  it('sem relatório: o aviso com o motivo, nenhuma etapa aprovada e sem índices', async () => {
    responder({
      ...resumo,
      relatorioInvalido: 'ensaio ainda não executado',
      ensaiadoEm: null,
      origem: null,
      alvo: null,
      etapas: etapas.map((e) => ({ ...e, situacao: 'nao-executada', bloqueio: null })),
      janelaMinutos: null,
      indicesEstourados: [],
      paginaAlvo: null,
      firebird5Aprovado: true,
    });
    const w = await montar();
    expect(w.get('[data-testid="ensaio-invalido"]').text()).toContain('ensaio ainda não executado');
    expect(w.get('[data-testid="ensaio-aprovavel"]').text()).toContain('Aprovadas 0 de 16');
    expect(w.get('[data-testid="ensaio-janela"]').text()).toContain('Sem o tempo');
    expect(w.get('[data-testid="ensaio-pagina"]').text()).toBe('Não definida');
    expect(w.get('[data-testid="ensaio-indices"]').text()).toContain('cabem na página atual');
    expect(w.get('[data-testid="ensaio-firebird5"]').text()).toContain('aprovado no registro');
  });
});

describe('cartão da estrutura do banco com o ensaio do UTF-8', () => {
  const cartao = {
    hospital: 'pc',
    em: '2026-10-27T12:00:00.000Z',
    plataforma: {
      versaoMotor: '3.0.14',
      versaoMaior: 3,
      ods: '12.0',
      charsetBanco: 'NONE',
      charsetParametro: 'CP1252',
      charsetConfere: true,
      funcoesExternas: [],
      impressao: 'fd04f7760ccb8e45',
    },
    restricaoEntrada: 'cp1252',
    funcoesPendentes: [],
    colunasTexto: [{ tipo: 'varchar', charset: 'NONE', colunas: 10 }],
    indicesComTexto: 3,
  };
  const montarCartao = async (ensaio: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/ensaios/utf8')
          ? ensaio === null
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify(ensaio), { status: 200 })
          : url.endsWith('/ensaios/firebird5')
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify(cartao), { status: 200 }),
      ),
    );
    const w = mount(PlataformaBanco, {
      global: {
        plugins: [criarI18n(mensagensWeb as unknown as Record<string, unknown>)],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await flushPromises();
    return w;
  };

  it('mostra quantas etapas o ensaio aprovou e o caminho para a tela', async () => {
    const w = await montarCartao(resumo);
    const linha = w.get('[data-testid="plataforma-ensaio-utf8"]').text();
    expect(linha).toContain('aprovadas 13 de 16 etapas');
    expect(linha).toContain('Ver o ensaio do UTF-8');
  });

  it('sem o resumo do ensaio, o cartão segue sem a linha', async () => {
    const w = await montarCartao(null);
    expect(w.find('[data-testid="plataforma-ensaio-utf8"]').exists()).toBe(false);
    expect(w.text()).toContain('3.0.14');
  });
});
