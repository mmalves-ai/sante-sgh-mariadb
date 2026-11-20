// @vitest-environment jsdom
// M58 (etapa 2): o cliente do ensaio da versão 5 valida pelo contrato (fora dele, recusa); os textos cobrem todo código
// do contrato e todo achado que a regra produz, sem chave técnica; a tela mostra as etapas reavaliadas, os achados
// traduzidos, a janela, as funções externas e o aviso do relatório ausente.
import {
  ETAPAS_ENSAIO_FIREBIRD5,
  MOTIVOS_ETAPA_BLOQUEADA,
  RESOLUCOES_FUNCAO_EXTERNA,
  type ResumoEnsaioFirebird5,
  SITUACOES_ETAPA_ENSAIO,
} from '@sgh/contratos';
import { criarI18n } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { buscarEnsaioFirebird5 } from '../config/api.js';
import { lerEnsaioFirebird5 } from './api.js';
import { chaveAchado, mensagensEnsaioFirebird5 as m } from './i18n-ensaio-firebird5.js';
import PlataformaBanco from '../config/componentes/PlataformaBanco.vue';
import Tela from './telas/MigracaoEnsaioFirebird5Tela.vue';

afterEach(() => vi.unstubAllGlobals());

const etapas = ETAPAS_ENSAIO_FIREBIRD5.map((etapa) => ({
  etapa,
  situacao: etapa === 'carga' ? 'reprovada' : etapa === 'parceiros' ? 'bloqueada' : 'aprovada',
  bloqueio: etapa === 'parceiros' ? 'lista-da-ti' : null,
  achados:
    etapa === 'carga'
      ? ['slo-nao-medido-ou-falhou']
      : etapa === 'parceiros'
        ? ['parceiro-com-erro:V_EPIMED_', 'parceiros-nao-avisados']
        : [],
}));
const resumo: ResumoEnsaioFirebird5 = {
  hospital: 'pc',
  em: '2026-10-26T12:00:00.000Z',
  relatorio: 'docs/marcos/M58/pc/firebird5.json',
  relatorioInvalido: null,
  ensaiadoEm: '2026-10-26',
  origem: '3.0.14 (ODS 12.0)',
  alvo: '5.0.3 (ODS 13.1)',
  etapas: etapas as ResumoEnsaioFirebird5['etapas'],
  aprovavel: false,
  janelaMinutos: 105,
  funcoes: [
    {
      nome: 'VLR_MED',
      modulo: 'vlr_med',
      bibliotecaPresente: false,
      chamadaOk: null,
      dependentes: 3,
      dependentesValidos: 3,
      resolucaoProposta: 'pendente',
    },
  ],
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

describe('ensaio da versão 5 (cliente)', () => {
  it('o resumo é validado pelo contrato nos dois clientes; fora dele, recusa', async () => {
    responder(resumo);
    expect((await lerEnsaioFirebird5()).janelaMinutos).toBe(105);
    expect((await buscarEnsaioFirebird5()).etapas).toHaveLength(13);
    responder({ ...resumo, etapas: [{ etapa: 'outra', situacao: 'aprovada', bloqueio: null, achados: [] }] });
    await expect(lerEnsaioFirebird5()).rejects.toThrow();
  });
});

describe('textos do ensaio da versão 5', () => {
  it('todo código do contrato tem texto', () => {
    for (const e of ETAPAS_ENSAIO_FIREBIRD5) {
      expect(m.etapas[e].titulo.length).toBeGreaterThan(3);
      expect(m.etapas[e].descricao.length).toBeGreaterThan(10);
    }
    expect(Object.keys(m.etapas).sort()).toEqual([...ETAPAS_ENSAIO_FIREBIRD5].sort());
    for (const s of SITUACOES_ETAPA_ENSAIO) expect(m.situacoes[s]).toBeTruthy();
    for (const b of MOTIVOS_ETAPA_BLOQUEADA) expect(m.bloqueios[b]).toBeTruthy();
    for (const r of RESOLUCOES_FUNCAO_EXTERNA) expect(m.resolucoes[r]).toBeTruthy();
  });

  it('todo achado que a regra produz tem texto; o desconhecido cai no genérico', () => {
    // Os códigos de achadosDaEtapa (packages/dominio-config/src/desligamento/ensaio-firebird5.ts); a web não importa
    // o domínio (fronteiras), então a lista fica aqui e a falta de um texto cai no genérico, com o código à vista.
    const codigos = [
      'sem-tempo',
      'integridade-nao-verificada',
      'sem-tabelas',
      'contagens-diferentes',
      'tabelas-ausentes',
      'resumo-diferente',
      'objetos-invalidos',
      'funcao-pendente',
      'udf-access-fechado',
      'sem-conexao',
      'sem-impressao',
      'sem-homologada',
      'schema-ausentes',
      'schema-novos',
      'schema-alterados',
      'sem-operacoes',
      'assinaturas-diferentes',
      'gatilho-a-corrigir',
      'slo-nao-medido-ou-falhou',
      'contratos-nao-verdes',
      'parceiro-com-erro',
      'parceiros-nao-avisados',
      'sem-parceiros',
    ];
    expect(Object.keys(m.achados).sort()).toEqual([...codigos, 'desconhecido'].sort());
    expect(chaveAchado('funcao-pendente:VLR_MED')).toEqual({ codigo: 'funcao-pendente', nome: 'VLR_MED' });
    expect(chaveAchado('schema-novos:funcoes')).toEqual({ codigo: 'schema-novos', nome: 'funcoes' });
    expect(chaveAchado('gatilho-a-corrigir:TRG_SIRES01_AIU')).toEqual({
      codigo: 'gatilho-a-corrigir',
      nome: 'TRG_SIRES01_AIU',
    });
    expect(chaveAchado('xyz:1')).toEqual({ codigo: 'desconhecido', nome: 'xyz:1' });
  });

  it('nenhum texto mostra nome de tabela, chave técnica ou o sistema anterior', () => {
    const achados = textos(m).filter(
      ([, t]) => /\b[A-Z][A-Z0-9_]{5,}\b/.test(t) || /\bsante-api\b|legado|sistema atual|gbak|\budf/i.test(t),
    );
    expect(achados).toEqual([]);
  });
});

describe('tela do ensaio da versão 5', () => {
  it('mostra as etapas reavaliadas, os achados traduzidos, a janela e as funções', async () => {
    responder(resumo);
    const w = await montar();
    expect(w.get('[data-testid="ensaio-aprovavel"]').text()).toContain('Aprovadas 11 de 13');
    expect(w.get('[data-testid="ensaio-janela"]').text()).toContain('105 minutos');
    expect(w.get('[data-testid="situacao-carga"]').text()).toBe('Reprovada');
    expect(w.get('[data-testid="etapa-carga"]').text()).toContain('objetivos de tempo');
    const parceiros = w.get('[data-testid="etapa-parceiros"]').text();
    expect(parceiros).toContain('lista de parceiros');
    expect(parceiros).toContain('V_EPIMED_');
    expect(w.get('[data-testid="resolucao-VLR_MED"]').text()).toBe('Pendente');
    expect(w.get('[data-testid="ensaio-registro"]').text()).toBe('Sem registro do ensaio');
    expect(w.find('[data-testid="ensaio-invalido"]').exists()).toBe(false);
  });

  it('sem relatório: o aviso com o motivo e nenhuma etapa aprovada', async () => {
    responder({
      ...resumo,
      relatorioInvalido: 'ensaio ainda não executado',
      ensaiadoEm: null,
      origem: null,
      alvo: null,
      etapas: etapas.map((e) => ({ ...e, situacao: 'nao-executada', bloqueio: null })),
      janelaMinutos: null,
      funcoes: [],
    });
    const w = await montar();
    expect(w.get('[data-testid="ensaio-invalido"]').text()).toContain('ensaio ainda não executado');
    expect(w.get('[data-testid="ensaio-aprovavel"]').text()).toContain('Aprovadas 0 de 13');
    expect(w.get('[data-testid="ensaio-janela"]').text()).toContain('Sem os tempos');
    expect(w.get('[data-testid="ensaio-funcoes"]').text()).toContain('Nenhuma função externa');
  });
});

describe('cartão da estrutura do banco com o ensaio', () => {
  const cartao = {
    hospital: 'pc',
    em: '2026-10-26T12:00:00.000Z',
    plataforma: {
      versaoMotor: '3.0.14',
      versaoMaior: 3,
      ods: '12.0',
      charsetBanco: 'NONE',
      charsetParametro: 'CP1252',
      charsetConfere: true,
      funcoesExternas: [{ nome: 'SUBSTR', modulo: 'ib_udf', dependentes: 45, esperada: true }],
      impressao: 'fd04f7760ccb8e45',
    },
    restricaoEntrada: 'cp1252',
    funcoesPendentes: ['SUBSTR'],
    colunasTexto: [{ tipo: 'varchar', charset: 'NONE', colunas: 10 }],
    indicesComTexto: 3,
  };
  const montarCartao = async (ensaio: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/ensaios/firebird5')
          ? ensaio === null
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify(ensaio), { status: 200 })
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

  it('mostra quantas etapas o ensaio aprovou e o caminho para a tela do ensaio', async () => {
    const w = await montarCartao(resumo);
    const linha = w.get('[data-testid="plataforma-ensaio"]').text();
    expect(linha).toContain(`aprovadas 11 de 13 etapas`);
    expect(linha).toContain('Ver o ensaio da versão 5');
  });

  it('sem o resumo do ensaio, o cartão segue sem a linha', async () => {
    const w = await montarCartao(null);
    expect(w.find('[data-testid="plataforma-ensaio"]').exists()).toBe(false);
    expect(w.text()).toContain('3.0.14');
  });
});
