// @vitest-environment jsdom
// Telas do M59-F5 (certificação SBIS, backup verificado e concessões da coexistência): as regras de tela (recusas com o
// texto do contrato, ações por requisito, resultados por tipo de ciclo, relatório da restauração, período da
// exportação), as rotas com a permissão de leitura, o auditor que só lê, o escritório da qualidade que abre o ciclo,
// avalia, corrige, verifica e conclui com a senha, o operador de backup que registra a restauração e o administrador que
// encerra a concessão com a evidência e a senha. Dados SINTÉTICOS; o fetch é simulado.
import {
  type BackupVerificado,
  type CicloSbisDetalhe,
  type Concessao,
  type ItemCicloSbis,
  type PainelConcessoes,
  type PainelSbis,
  RECUSAS_SBIS,
  type Sessao,
  TEXTO_RECUSA_SBIS,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { criarRoteador } from '../../roteador.js';
import ConcessoesTela from '../coexistencia/telas/ConcessoesTela.vue';
import { urlExportacaoSbis } from './api-sbis.js';
import {
  acoesDoItem,
  dataCurta,
  filtrarItensSbis,
  faltaParaConcluir,
  localParaIso,
  montarRestauracao,
  ordenarCiclos,
  pedidoAvaliacao,
  periodoExportacaoSbis,
  resultadosDoCiclo,
  textoRecusaSbis,
} from './sbis-tela.js';
import BackupVerificadoTela from './telas/BackupVerificadoTela.vue';
import CertificacaoSbisTela from './telas/CertificacaoSbisTela.vue';

if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

interface Pedido {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
  chave: string | null;
}
type Responder = (p: Pedido) => { status: number; corpo: unknown } | undefined;

function simular(responder: Responder): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        chave: h['idempotency-key'] ?? null,
      };
      pedidos.push(p);
      const r = responder(p) ?? { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}

const recusaHttp = (codigo: string) => ({
  status: 409,
  corpo: { type: 'recusa-de-negocio', title: 'Ação recusada', status: 409, codigo },
});

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: { unmount: () => void }[] = [];
async function montar(tela: Component, caminho: string) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push(caminho);
  const w = mount(tela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { AbasMigracao: true, RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  montadas.push(w);
  return w;
}
const comPermissoes = (permissoes: string[]) => definirSessaoDaTela({ permissoes } as unknown as Sessao);

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

const submeter = async (testid: string) => {
  document.querySelector<HTMLFormElement>(`[data-testid="${testid}"]`)!.requestSubmit();
  await flushPromises();
};

// ── dados sintéticos ─────────────────────────────────────────────────────────────────────────────

const item = (requisito: string, sobre: Partial<ItemCicloSbis> = {}): ItemCicloSbis => ({
  requisito,
  nivel: 'NGS1',
  titulo: `Requisito ${requisito}`,
  resultado: 'pendente',
  severidade: null,
  origem: null,
  evidencia: null,
  observacao: null,
  avaliadoPor: null,
  avaliadoEm: null,
  correcao: null,
  correcaoDescricao: null,
  corrigidoPor: null,
  corrigidoEm: null,
  verificadoPor: null,
  verificadoEm: null,
  ...sobre,
});

const resumo = {
  pendente: 1,
  conforme: 1,
  'nao-conforme': 1,
  concessao: 0,
  'nao-aplicavel': 0,
  bloqueantesAbertas: 1,
  defeitos: 1,
};

const ciclo = (sobre: Partial<CicloSbisDetalhe> = {}): CicloSbisDetalhe => ({
  id: '7',
  tipo: 'autoavaliacao',
  competencia: '2026-10',
  versao: '1.0.0',
  referencia: 'Manual de Certificação S-RES SBIS v5.2',
  avaliador: null,
  situacao: 'aberto',
  parecer: null,
  parecerTexto: null,
  certificado: null,
  abertoPor: 'SINT.SBIS.CONFORMIDADE',
  abertoEm: '2026-10-29T10:00:00.000Z',
  concluidoPor: null,
  concluidoEm: null,
  resumo,
  itens: [
    item('SBIS-01', { resultado: 'conforme', evidencia: 'tela de login' }),
    item('SBIS-02', {
      resultado: 'nao-conforme',
      severidade: 'bloqueante',
      origem: 'defeito',
      evidencia: 'falta o bloqueio',
      correcao: 'aberta',
    }),
    item('SBIS-03', {
      resultado: 'nao-conforme',
      severidade: 'menor',
      origem: 'documentacao',
      evidencia: 'manual',
      correcao: 'corrigida',
      corrigidoPor: 'SINT.SBIS.CONFORMIDADE',
    }),
    item('SBIS-04'),
  ],
  ...sobre,
});

const painelSbis = (sobre: Partial<PainelSbis> = {}): PainelSbis => {
  const semItens: Partial<CicloSbisDetalhe> = { ...ciclo() };
  delete semItens.itens;
  return {
    hospital: 'pc',
    referencia: 'Manual de Certificação S-RES SBIS v5.2',
    desligado: false,
    auditoriaFormal: { pode: false, motivo: 'O desligamento deste estabelecimento ainda não foi concluído.' },
    certificado: null,
    requisitos: {
      total: 45,
      porNivel: { NGS1: 26, ECF: 10, NGS2: 9 },
      porRegime: { novo: 30, concessao: 8, 'pos-coexistencia': 7 },
      fase5: 6,
    },
    pacote: [
      {
        item: 'restauracao-backup',
        titulo: 'Relatório de restauração do backup',
        situacao: 'pendente',
        detalhe: 'Sem restauração mensal no prazo.',
        requisitos: ['SBIS-13'],
      },
      {
        item: 'matriz-rastreabilidade',
        titulo: 'Matriz de rastreabilidade',
        situacao: 'gerado-no-ci',
        detalhe: 'Gerada a cada versão.',
        requisitos: [],
      },
    ],
    ciclos: [semItens as PainelSbis['ciclos'][number]],
    ...sobre,
  };
};

const BASE_SBIS = '/api/administracao/auditoria/sbis';
const BASE_BACKUP = '/api/administracao/auditoria/backup';
const BASE_CONCESSOES = '/api/administracao/coexistencia/concessoes';

// ── regras de tela ───────────────────────────────────────────────────────────────────────────────

describe('regras de tela', () => {
  it('toda recusa conhecida tem o texto do contrato; o resto vai à mensagem genérica', () => {
    for (const c of RECUSAS_SBIS) expect(textoRecusaSbis(c)).toBe(TEXTO_RECUSA_SBIS[c]);
    expect(textoRecusaSbis('outra')).toBeNull();
    expect(textoRecusaSbis(null)).toBeNull();
  });

  it('ações por requisito: só em ciclo aberto e com a permissão; corrigir a aberta, verificar a corrigida', () => {
    const [ok, aberta, corrigida] = ciclo().itens;
    expect(acoesDoItem(ok!, { situacao: 'aberto' }, false)).toEqual([]);
    expect(acoesDoItem(ok!, { situacao: 'concluido' }, true)).toEqual([]);
    expect(acoesDoItem(ok!, { situacao: 'aberto' }, true)).toEqual(['avaliar']);
    // A não conformidade sem correção verificada não se reavalia (nc-sem-verificacao no servidor).
    expect(acoesDoItem(aberta!, { situacao: 'aberto' }, true)).toEqual(['corrigir']);
    expect(acoesDoItem(corrigida!, { situacao: 'aberto' }, true)).toEqual(['verificar']);
    expect(acoesDoItem({ ...corrigida!, correcao: 'verificada' }, { situacao: 'aberto' }, true)).toEqual([
      'avaliar',
    ]);
  });

  it('lista dos requisitos: padrão com pendentes e não conformes; filtro por resultado e correção; busca sem acento', () => {
    const itens = ciclo().itens;
    const cods = (f: Parameters<typeof filtrarItensSbis>[1], b = '') =>
      filtrarItensSbis(itens, f, b).map((i) => i.requisito);
    expect(cods('a-tratar')).toEqual(['SBIS-02', 'SBIS-03', 'SBIS-04']);
    expect(cods('todos')).toEqual(['SBIS-01', 'SBIS-02', 'SBIS-03', 'SBIS-04']);
    expect(cods('pendente')).toEqual(['SBIS-04']);
    expect(cods('nao-conforme')).toEqual(['SBIS-02', 'SBIS-03']);
    expect(cods('correcao-aberta')).toEqual(['SBIS-02']);
    expect(cods('correcao-corrigida')).toEqual(['SBIS-03']);
    expect(cods('todos', 'sbis-01')).toEqual(['SBIS-01']);
    expect(
      filtrarItensSbis([{ ...itens[0]!, titulo: 'Autenticação' }], 'todos', 'autenticacao'),
    ).toHaveLength(1);
    expect(cods('a-tratar', 'SBIS-01')).toEqual([]);
  });

  it('concessão só na autoavaliação; concluir pede todos avaliados', () => {
    expect(resultadosDoCiclo('autoavaliacao')).toContain('concessao');
    expect(resultadosDoCiclo('pre-auditoria')).not.toContain('concessao');
    expect(resultadosDoCiclo('auditoria')).not.toContain('pendente');
    expect(faltaParaConcluir(ciclo().itens)).toBe('itens-pendentes');
    expect(faltaParaConcluir(ciclo().itens.slice(0, 3))).toBeNull();
  });

  it('o pedido de avaliação leva só os campos do resultado', () => {
    expect(
      pedidoAvaliacao({
        resultado: 'conforme',
        severidade: 'maior',
        origem: 'defeito',
        evidencia: ' tela ',
        observacao: '',
      }),
    ).toEqual({ resultado: 'conforme', evidencia: 'tela' });
    expect(
      pedidoAvaliacao({
        resultado: 'nao-conforme',
        severidade: 'maior',
        origem: 'defeito',
        evidencia: 'x',
        observacao: 'y',
      }),
    ).toEqual({
      resultado: 'nao-conforme',
      severidade: 'maior',
      origem: 'defeito',
      evidencia: 'x',
      observacao: 'y',
    });
  });

  it('o relatório da restauração: datas locais em ISO, fim depois do início, ambiente e tamanho', () => {
    const base = {
      tipo: 'diaria' as const,
      inicio: '2026-10-29T02:00',
      fim: '2026-10-29T02:40',
      resultado: 'ok' as const,
      integridade: 'ok' as const,
      tamanhoMb: '2048',
      ambiente: ' servidor de teste ',
      observacao: '',
    };
    const m = montarRestauracao(base);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.pedido.inicio).toBe(new Date('2026-10-29T02:00').toISOString());
      expect(m.pedido).toMatchObject({ tamanhoMb: 2048, ambiente: 'servidor de teste' });
      expect(m.pedido).not.toHaveProperty('observacao');
    }
    expect(montarRestauracao({ ...base, inicio: '' })).toEqual({ ok: false, falha: 'inicio-invalido' });
    expect(montarRestauracao({ ...base, fim: 'x' })).toEqual({ ok: false, falha: 'fim-invalido' });
    expect(montarRestauracao({ ...base, fim: '2026-10-29T01:00' })).toEqual({
      ok: false,
      falha: 'fim-antes',
    });
    expect(montarRestauracao({ ...base, ambiente: ' ' })).toEqual({ ok: false, falha: 'ambiente' });
    expect(montarRestauracao({ ...base, tamanhoMb: '1,5' })).toEqual({ ok: false, falha: 'tamanho' });
    expect(localParaIso('2026-13-01T00:00')).toBeNull();
  });

  it('período da exportação para a auditoria: até 31 dias, em ordem; a URL leva formato e período', () => {
    expect(periodoExportacaoSbis('2026-10-01', '2026-10-31')).toBe('ok');
    expect(periodoExportacaoSbis('2026-10-01', '2026-11-01')).toBe('longo');
    expect(periodoExportacaoSbis('2026-10-02', '2026-10-01')).toBe('invalido');
    expect(periodoExportacaoSbis('x', '2026-10-01')).toBe('invalido');
    expect(urlExportacaoSbis('2026-10-01', '2026-10-02', 'xml')).toBe(
      '/api/administracao/auditoria/trilha/exportar-sbis?formato=xml&inicio=2026-10-01&fim=2026-10-02',
    );
  });

  it('ciclos: abertos primeiro, depois os mais recentes; datas curtas', () => {
    const c = (id: string, situacao: 'aberto' | 'concluido', abertoEm: string) => ({
      id,
      situacao,
      abertoEm,
    });
    expect(
      ordenarCiclos([
        c('1', 'concluido', '2026-08-01T00:00:00Z'),
        c('2', 'concluido', '2026-09-01T00:00:00Z'),
        c('3', 'aberto', '2026-07-01T00:00:00Z'),
      ]).map((x) => x.id),
    ).toEqual(['3', '2', '1']);
    expect(dataCurta('2026-11-30')).toBe('30/11/2026');
    expect(dataCurta(null)).toBe('—');
  });
});

// ── rotas ────────────────────────────────────────────────────────────────────────────────────────

describe('rotas', () => {
  const sessao = (permissoes: string[]) => async () => ({
    usuario: { id: 's', nome: 'S' },
    rede: null,
    estabelecimentos: [],
    estabelecimentoAtivo: null,
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  const casos: [string, string, string][] = [
    ['/administracao/auditoria/sbis', 'auditoria.sbis.ler', 'adm.sbis'],
    ['/administracao/auditoria/backup', 'auditoria.backup.ler', 'adm.backupVerificado'],
    ['/administracao/coexistencia/concessoes', 'config.coexistencia.ler', 'coexistencia.concessoes'],
  ];
  it.each(casos)('%s abre com %s; sem ela, sem permissão', async (caminho, permissao, nome) => {
    const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await sem.push(caminho);
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(sessao(['acesso.inicio.ler', permissao]), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await com.push(caminho);
    expect(com.currentRoute.value.name).toBe(nome);
  });
});

// ── certificação ─────────────────────────────────────────────────────────────────────────────────

describe('certificação SBIS', () => {
  it('o auditor só lê: situação, requisitos, pacote, ciclos e o detalhe sem ações', async () => {
    comPermissoes(['auditoria.sbis.ler']);
    simular((p) => {
      if (p.url === BASE_SBIS) return { status: 200, corpo: painelSbis() };
      if (p.url === `${BASE_SBIS}/ciclos/7`) return { status: 200, corpo: ciclo() };
      return undefined;
    });
    const w = await montar(CertificacaoSbisTela, '/administracao/auditoria/sbis');
    await flushPromises();
    expect(w.find('[data-testid="sbis-sem-edicao"]').exists()).toBe(true);
    expect(w.find('[data-testid="sbis-certificado"]').text()).toContain('Ainda sem certificado');
    expect(w.find('[data-testid="sbis-auditoria-formal"]').text()).toContain('desligamento');
    expect(w.find('[data-testid="sbis-requisitos"]').text()).toContain('45 requisito(s)');
    expect(w.find('[data-testid="sbis-pacote-restauracao-backup"]').text()).toContain('Pendente');
    expect(w.find('[data-testid="sbis-pacote-matriz-rastreabilidade"]').text()).toContain(
      'Gerado a cada versão',
    );
    expect(w.find('[data-testid="sbis-ciclo-7"]').text()).toContain('1 não conforme(s)');
    expect(w.find('[data-testid="form-sbis-abrir"]').exists()).toBe(false);
    await w.find('[data-testid="sbis-ver-ciclo-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sbis-item-SBIS-02"]').text()).toContain('Bloqueante');
    expect(w.find('[data-testid="sbis-avaliar-SBIS-04"]').exists()).toBe(false);
    expect(w.find('[data-testid="form-sbis-concluir"]').exists()).toBe(false);
    // Padrão: pendentes e não conformes; o conforme aparece com "todos" ou pela busca.
    expect(w.find('[data-testid="sbis-item-SBIS-01"]').exists()).toBe(false);
    expect(w.find('[data-testid="sbis-itens-exibindo"]').text()).toBe('3 de 4 requisito(s)');
    await w.find('[data-testid="sbis-itens-busca"]').setValue('SBIS-04');
    expect(w.findAll('[data-testid^="sbis-item-SBIS-"]').map((x) => x.attributes('data-testid'))).toEqual([
      'sbis-item-SBIS-04',
    ]);
    await w.find('[data-testid="sbis-itens-busca"]').setValue('SBIS-01');
    expect(w.find('[data-testid="sbis-itens-nenhum"]').exists()).toBe(true);
  });

  it('o certificado aparece no rodapé da situação só depois de emitido', async () => {
    comPermissoes(['auditoria.sbis.ler']);
    simular((p) =>
      p.url === BASE_SBIS ? { status: 200, corpo: painelSbis({ certificado: 'SBIS-2027-001' }) } : undefined,
    );
    const w = await montar(CertificacaoSbisTela, '/administracao/auditoria/sbis');
    await flushPromises();
    expect(w.find('[data-testid="sbis-certificado"]').text()).toBe(
      'Sistema certificado SBIS nº SBIS-2027-001',
    );
  });

  it('a qualidade abre o ciclo, avalia, corrige, verifica e conclui com a senha; recusa com o texto', async () => {
    comPermissoes(['auditoria.sbis.ler', 'auditoria.sbis.avaliar']);
    let verificarRecusa = true;
    const pedidos = simular((p) => {
      if (p.metodo === 'GET' && p.url === BASE_SBIS) return { status: 200, corpo: painelSbis() };
      if (p.metodo === 'GET' && p.url === `${BASE_SBIS}/ciclos/7`) return { status: 200, corpo: ciclo() };
      if (p.metodo === 'POST' && p.url === `${BASE_SBIS}/ciclos`) return { status: 201, corpo: ciclo() };
      if (p.url === `${BASE_SBIS}/ciclos/7/itens/SBIS-04`)
        return { status: 200, corpo: item('SBIS-04', { resultado: 'nao-conforme' }) };
      if (p.url === `${BASE_SBIS}/ciclos/7/itens/SBIS-02/corrigir`)
        return { status: 200, corpo: { corrigido: true } };
      if (p.url === `${BASE_SBIS}/ciclos/7/itens/SBIS-03/verificar`) {
        if (verificarRecusa) {
          verificarRecusa = false;
          return recusaHttp('verificador-igual');
        }
        return { status: 200, corpo: { verificado: true } };
      }
      if (p.url === `${BASE_SBIS}/ciclos/7/concluir`)
        return { status: 200, corpo: ciclo({ situacao: 'concluido', itens: ciclo().itens.slice(0, 3) }) };
      return undefined;
    });
    const w = await montar(CertificacaoSbisTela, '/administracao/auditoria/sbis');
    await flushPromises();
    // Abrir: a versão é obrigatória; o avaliador vai só quando preenchido.
    await w.find('[data-testid="sbis-novo-versao"]').setValue('1.0.0');
    await submeter('form-sbis-abrir');
    const abrir = pedidos.find((p) => p.metodo === 'POST' && p.url === `${BASE_SBIS}/ciclos`)!;
    expect(abrir.corpo).toEqual({ tipo: 'autoavaliacao', versao: '1.0.0' });
    expect(abrir.chave).toMatch(/^web-/);
    expect(w.find('[data-testid="sbis-ciclo"]').exists()).toBe(true);
    // Avaliar o pendente: conforme (o padrão) com a evidência; o pedido leva só os campos do resultado.
    await w.find('[data-testid="sbis-avaliar-SBIS-04"]').trigger('click');
    expect(w.find('[data-testid="form-sbis-avaliar"]').exists()).toBe(true);
    await w.find('[data-testid="sbis-avaliar-evidencia"]').setValue('falta o registro');
    await submeter('form-sbis-avaliar');
    const avaliar = pedidos.find((p) => p.url === `${BASE_SBIS}/ciclos/7/itens/SBIS-04`)!;
    expect(avaliar.corpo).toEqual({ resultado: 'conforme', evidencia: 'falta o registro' });
    expect(w.find('[data-testid="sbis-aviso"]').text()).toContain('Avaliação registrada');
    // Corrigir a não conformidade aberta.
    await w.find('[data-testid="sbis-corrigir-SBIS-02"]').trigger('click');
    await w.find('[data-testid="sbis-corrigir-descricao"]').setValue('bloqueio por tentativas ligado');
    await submeter('form-sbis-corrigir');
    expect(pedidos.find((p) => p.url.endsWith('/SBIS-02/corrigir'))!.corpo).toEqual({
      descricao: 'bloqueio por tentativas ligado',
    });
    // Verificar: a primeira volta recusada (mesma pessoa), com o texto do contrato.
    await w.find('[data-testid="sbis-verificar-SBIS-03"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sbis-recusa"]').text()).toBe(TEXTO_RECUSA_SBIS['verificador-igual']);
    await w.find('[data-testid="sbis-verificar-SBIS-03"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sbis-recusa"]').exists()).toBe(false);
    expect(w.find('[data-testid="sbis-aviso"]').text()).toContain('Correção verificada');
    // Concluir: com pendente o botão fica desligado.
    expect(w.find('[data-testid="sbis-pendentes"]').exists()).toBe(true);
    expect(w.find('[data-testid="sbis-concluir"]').attributes('disabled')).toBeDefined();
  });

  it('conclui com o parecer e a senha (que não fica no campo)', async () => {
    comPermissoes(['auditoria.sbis.ler', 'auditoria.sbis.avaliar']);
    const avaliado = ciclo({ itens: ciclo().itens.slice(0, 3) });
    const pedidos = simular((p) => {
      if (p.metodo === 'GET' && p.url === BASE_SBIS) return { status: 200, corpo: painelSbis() };
      if (p.metodo === 'GET' && p.url === `${BASE_SBIS}/ciclos/7`) return { status: 200, corpo: avaliado };
      if (p.url === `${BASE_SBIS}/ciclos/7/concluir`)
        return { status: 200, corpo: { ...avaliado, situacao: 'concluido' } };
      if (p.url === `${BASE_SBIS}/ciclos/7/cancelar`) return recusaHttp('ciclo-fechado');
      return undefined;
    });
    const w = await montar(CertificacaoSbisTela, '/administracao/auditoria/sbis');
    await flushPromises();
    await w.find('[data-testid="sbis-ver-ciclo-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sbis-concluir-certificado"]').exists()).toBe(false);
    await w.find('[data-testid="sbis-concluir-parecer"]').setValue('Uma não conformidade menor, corrigida.');
    await w.find('[data-testid="sbis-concluir-senha"]').setValue('senha-sintetica');
    await submeter('form-sbis-concluir');
    const concluir = pedidos.find((p) => p.url.endsWith('/concluir'))!;
    expect(concluir.corpo).toEqual({
      parecerTexto: 'Uma não conformidade menor, corrigida.',
      senha: 'senha-sintetica',
    });
    expect((w.find('[data-testid="sbis-concluir-senha"]').element as HTMLInputElement).value).toBe('');
    expect(w.find('[data-testid="sbis-aviso"]').text()).toContain('Ciclo concluído');
    await w.find('[data-testid="sbis-cancelar-motivo"]').setValue('aberto por engano');
    await submeter('form-sbis-cancelar');
    expect(w.find('[data-testid="sbis-recusa"]').text()).toBe(TEXTO_RECUSA_SBIS['ciclo-fechado']);
  });
});

// ── backup verificado ────────────────────────────────────────────────────────────────────────────

const backup = (sobre: Partial<BackupVerificado> = {}): BackupVerificado => ({
  hospital: 'pc',
  diaria: { tipo: 'diaria', ultimaComSucesso: '2026-10-29T05:40:00.000Z', emDia: true, falhasRecentes: 0 },
  mensal: { tipo: 'mensal', ultimaComSucesso: null, emDia: false, falhasRecentes: 1 },
  alertas: ['Sem restauração mensal com a integridade conferida nos últimos 32 dias.'],
  restauracoes: [
    {
      id: '3',
      tipo: 'diaria',
      inicio: '2026-10-29T05:00:00.000Z',
      fim: '2026-10-29T05:40:00.000Z',
      duracaoMinutos: 40,
      resultado: 'ok',
      integridade: 'ok',
      tamanhoMb: 2048,
      ambiente: 'servidor de teste',
      observacao: null,
      registradoPor: 'SINT.SBIS.BACKUP',
      registradoEm: '2026-10-29T06:00:00.000Z',
    },
  ],
  destino: 'memoria',
  ...sobre,
});

describe('backup verificado', () => {
  it('quem só lê vê a diária em dia, a mensal atrasada, os alertas e as restaurações, sem registrar', async () => {
    comPermissoes(['auditoria.backup.ler']);
    simular((p) => (p.url === BASE_BACKUP ? { status: 200, corpo: backup() } : undefined));
    const w = await montar(BackupVerificadoTela, '/administracao/auditoria/backup');
    await flushPromises();
    expect(w.find('[data-testid="backup-situacao-diaria"]').text()).toContain('Em dia');
    expect(w.find('[data-testid="backup-situacao-mensal"]').text()).toContain('Atrasada');
    expect(w.find('[data-testid="backup-situacao-mensal"]').text()).toContain('1 falha(s)');
    expect(w.find('[data-testid="backup-alertas"]').text()).toContain('32 dias');
    expect(w.find('[data-testid="backup-restauracao-3"]').text()).toContain('40 min');
    expect(w.find('[data-testid="backup-sem-registro"]').exists()).toBe(true);
    expect(w.find('[data-testid="form-backup-registrar"]').exists()).toBe(false);
  });

  it('o operador registra a restauração; a falha local não chama o servidor', async () => {
    comPermissoes(['auditoria.backup.ler', 'auditoria.backup.registrar']);
    const pedidos = simular((p) => {
      if (p.metodo === 'GET' && p.url === BASE_BACKUP) return { status: 200, corpo: backup() };
      if (p.url === `${BASE_BACKUP}/restauracoes`) return { status: 201, corpo: { id: '4' } };
      return undefined;
    });
    const w = await montar(BackupVerificadoTela, '/administracao/auditoria/backup');
    await flushPromises();
    await w.find('[data-testid="backup-inicio"]').setValue('2026-10-29T02:00');
    await w.find('[data-testid="backup-fim"]').setValue('2026-10-29T01:00');
    await w.find('[data-testid="backup-ambiente"]').setValue('servidor de teste');
    await submeter('form-backup-registrar');
    expect(w.find('[data-testid="backup-falha"]').text()).toContain('O fim vem depois do início');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    await w.find('[data-testid="backup-fim"]').setValue('2026-10-29T02:45');
    await w.find('[data-testid="backup-tamanho"]').setValue('1024');
    await submeter('form-backup-registrar');
    const post = pedidos.find((p) => p.metodo === 'POST')!;
    expect(post.corpo).toMatchObject({
      tipo: 'diaria',
      resultado: 'ok',
      integridade: 'ok',
      tamanhoMb: 1024,
      ambiente: 'servidor de teste',
      inicio: new Date('2026-10-29T02:00').toISOString(),
    });
    expect(w.find('[data-testid="backup-aviso"]').text()).toContain('Restauração registrada');
  });
});

// ── concessões ───────────────────────────────────────────────────────────────────────────────────

const concessao = (sobre: Partial<Concessao> = {}): Concessao => ({
  codigo: 'senha-formato-antigo',
  titulo: 'Senha no formato antigo, lida pelos dois sistemas',
  requisitos: ['SBIS-03', 'SBIS-04'],
  situacao: 'vigente',
  indicador: 'pendente',
  medida: '12 usuário(s) ainda com a senha no formato antigo.',
  fimPrevisto: '2026-12-31',
  evidencia: null,
  encerradaPor: null,
  encerradaEm: null,
  reabertaPor: null,
  reabertaEm: null,
  motivoReabertura: null,
  recusa: null,
  ...sobre,
});

const painelConcessoes = (): PainelConcessoes => ({
  hospital: 'pc',
  desligado: true,
  contingenciaAtiva: false,
  vigentes: 1,
  encerradas: 1,
  concessoes: [
    concessao(),
    concessao({
      codigo: 'segredos-em-tabela',
      titulo: 'Credenciais de parceiros guardadas em tabela',
      requisitos: ['ICP-06'],
      situacao: 'encerrada',
      indicador: 'atendido',
      medida: 'Todas as credenciais em envelope.',
      fimPrevisto: null,
      evidencia: 'rotação concluída',
      encerradaPor: 'SINT.ADMIN',
      encerradaEm: '2026-10-20T12:00:00.000Z',
    }),
  ],
});

describe('concessões da coexistência', () => {
  it('quem só lê vê o termo com a medida, sem ações', async () => {
    comPermissoes(['config.coexistencia.ler']);
    simular((p) => (p.url === BASE_CONCESSOES ? { status: 200, corpo: painelConcessoes() } : undefined));
    const w = await montar(ConcessoesTela, '/administracao/coexistencia/concessoes');
    await flushPromises();
    expect(w.find('[data-testid="concessoes-situacao"]').text()).toContain('1 vigente(s) e 1 encerrada(s)');
    expect(w.find('[data-testid="concessao-medida-senha-formato-antigo"]').text()).toContain('Pendente');
    expect(w.find('[data-testid="concessao-senha-formato-antigo"]').text()).toContain('31/12/2026');
    expect(w.find('[data-testid="concessao-segredos-em-tabela"]').text()).toContain(
      'Encerrada por SINT.ADMIN',
    );
    expect(w.find('[data-testid="concessoes-sem-edicao"]').exists()).toBe(true);
    expect(w.find('[data-testid="concessao-encerrar-senha-formato-antigo"]').exists()).toBe(false);
  });

  it('o administrador encerra com a evidência e a senha; a recusa aparece; reabre a encerrada', async () => {
    comPermissoes(['config.coexistencia.ler', 'auditoria.concessao.encerrar']);
    const pedidos = simular((p) => {
      if (p.metodo === 'GET' && p.url === BASE_CONCESSOES) return { status: 200, corpo: painelConcessoes() };
      if (p.url === `${BASE_CONCESSOES}/senha-formato-antigo/encerrar`)
        return recusaHttp('indicador-pendente');
      if (p.url === `${BASE_CONCESSOES}/segredos-em-tabela/reabrir`)
        return { status: 200, corpo: { reaberta: true } };
      return undefined;
    });
    const w = await montar(ConcessoesTela, '/administracao/coexistencia/concessoes');
    await flushPromises();
    expect(w.find('[data-testid="concessao-reabrir-senha-formato-antigo"]').exists()).toBe(false);
    await w.find('[data-testid="concessao-encerrar-senha-formato-antigo"]').trigger('click');
    await w.find('[data-testid="concessao-texto"]').setValue('senhas regravadas no esquema forte');
    await w.find('[data-testid="concessao-senha"]').setValue('senha-sintetica');
    await submeter('form-concessao');
    const enc = pedidos.find((p) => p.url.endsWith('/encerrar'))!;
    expect(enc.corpo).toEqual({ evidencia: 'senhas regravadas no esquema forte', senha: 'senha-sintetica' });
    expect(w.find('[data-testid="concessoes-recusa"]').text()).toBe(TEXTO_RECUSA_SBIS['indicador-pendente']);
    await w.find('[data-testid="concessao-reabrir-segredos-em-tabela"]').trigger('click');
    await w.find('[data-testid="concessao-texto"]').setValue('parceiro novo');
    await w.find('[data-testid="concessao-senha"]').setValue('senha-sintetica');
    await submeter('form-concessao');
    expect(pedidos.find((p) => p.url.endsWith('/reabrir'))!.corpo).toEqual({
      motivo: 'parceiro novo',
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="concessoes-aviso"]').text()).toContain('Termo atualizado');
    expect(w.find('[data-testid="form-concessao"]').exists()).toBe(false);
  });
});
