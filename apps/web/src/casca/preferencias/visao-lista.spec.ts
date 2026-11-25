import { COLUNAS_VISAO_POR_ROTA, ROTA_TRILHA_AUDITORIA } from '@sgh/contratos';
import { describe, expect, it, vi } from 'vitest';
import type { PreferenciasDaConta } from './preferencias-servidor.js';
import { codigoDaLista, usarVisaoLista } from './visao-lista.js';

const FABRICA = [...COLUNAS_VISAO_POR_ROTA[ROTA_TRILHA_AUDITORIA]!];

function conta(visoes: PreferenciasDaConta['visoes'], inicial: Record<string, string>): PreferenciasDaConta {
  return {
    guardadas: true,
    geral: { tema: 'sistema', densidade: 'normal', textoAmpliado: false, tipoAtendimentoPadrao: null },
    telaInicial: null,
    telasDoMenu: [{ codigo: 'TRILHA', titulo: 'Trilha', rota: ROTA_TRILHA_AUDITORIA }],
    visoes,
    visaoInicialPorTela: inicial,
  };
}

const resposta = (corpo: unknown, status = 200) =>
  new Response(corpo === null ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

describe('visão de lista por usuário', () => {
  it('o código da lista é o do menu da pessoa; sem ele, o código estável do endereço', () => {
    expect(codigoDaLista(ROTA_TRILHA_AUDITORIA, [{ codigo: 'TRILHA', rota: ROTA_TRILHA_AUDITORIA }])).toBe(
      'TRILHA',
    );
    expect(codigoDaLista(ROTA_TRILHA_AUDITORIA, [])).toBe('administracao.auditoria.trilha');
  });

  it('abre na visão padrão da conta, ignorando coluna que a lista não oferece mais', async () => {
    const buscar = vi.fn(async () =>
      resposta(
        conta(
          [
            {
              tela: 'TRILHA',
              nome: 'Enxuta',
              colunas: ['usuario', 'dataHora', 'coluna-antiga'],
              ordenacao: [],
              filtros: null,
              itensPorPagina: null,
              padrao: true,
            },
          ],
          { TRILHA: 'Enxuta' },
        ),
      ),
    );
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    expect(v.visiveis.value).toEqual(FABRICA);
    expect(v.situacao.value).toBe('fabrica');
    await v.carregar();
    expect(v.visiveis.value).toEqual(['usuario', 'dataHora']);
    expect(v.codigo.value).toBe('TRILHA');
    expect(v.situacao.value).toBe('guardada');
  });

  it('sem visão guardada ou com falha de leitura, fica nas colunas de fábrica', async () => {
    const semVisao = usarVisaoLista(ROTA_TRILHA_AUDITORIA, (async () =>
      resposta(conta([], {}))) as unknown as typeof fetch);
    await semVisao.carregar();
    expect(semVisao.visiveis.value).toEqual(FABRICA);
    const falha = usarVisaoLista(ROTA_TRILHA_AUDITORIA, (async () => {
      throw new Error('rede');
    }) as unknown as typeof fetch);
    await falha.carregar();
    expect(falha.visiveis.value).toEqual(FABRICA);
  });

  it('esconder e mover mudam só a tela; guardar grava na conta as colunas na ordem', async () => {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const buscar = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, ...(init ? { init } : {}) });
      return init?.method === 'PUT' ? resposta(null, 204) : resposta(conta([], {}));
    });
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    await v.carregar();
    v.alternar('estacao');
    v.alternar('ator');
    v.mover('usuario', -1);
    expect(v.visiveis.value).toEqual(['dataHora', 'usuario', 'origem', 'acao', 'opcao', 'alvo', 'paciente']);
    expect(v.situacao.value).toBe('mudada');
    expect(chamadas.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
    expect(await v.guardar()).toBe(true);
    const put = chamadas.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toBe('/api/acesso/preferencias/minhas/telas/TRILHA');
    expect(JSON.parse(String(put.init!.body))).toEqual({
      colunas: ['dataHora', 'usuario', 'origem', 'acao', 'opcao', 'alvo', 'paciente'],
      ordenacao: [],
      itensPorPagina: null,
      padrao: true,
    });
    expect(v.situacao.value).toBe('guardada');
  });

  it('a última coluna visível não sai; voltar às de fábrica grava todas na ordem de fábrica', async () => {
    const corpos: unknown[] = [];
    const buscar = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') corpos.push(JSON.parse(String(init.body)));
      return init?.method === 'PUT' ? resposta(null, 204) : resposta(conta([], {}));
    });
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    for (const c of FABRICA) v.alternar(c);
    expect(v.visiveis.value).toEqual(['ator']);
    await v.voltarAFabrica();
    expect(v.visiveis.value).toEqual(FABRICA);
    expect((corpos[0] as { colunas: string[] }).colunas).toEqual(FABRICA);
  });

  it('a recusa do servidor fica na tela e a visão não é dada como guardada', async () => {
    const buscar = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? resposta({ title: 'Recusada', detail: 'Uma das colunas não existe nesta tela.', status: 422 }, 422)
        : resposta(conta([], {})),
    );
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    v.alternar('ator');
    expect(await v.guardar()).toBe(false);
    expect(v.erro.value).not.toBe('');
    expect(v.situacao.value).toBe('mudada');
  });

  it('lista sem colunas no contrato não lê nem grava', async () => {
    const buscar = vi.fn();
    const v = usarVisaoLista('/sem/lista', buscar as unknown as typeof fetch);
    await v.carregar();
    expect(await v.guardar()).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('carrega a Enxuta, muda e guarda: o PUT regrava a Enxuta como padrão sem perder ordenação, filtros e itens', async () => {
    // A conta como o servidor a guarda: a visão pelo nome, que a próxima leitura devolve.
    let guardada: PreferenciasDaConta['visoes'][number] = {
      tela: 'TRILHA',
      nome: 'Enxuta',
      colunas: ['usuario', 'dataHora', 'acao'],
      ordenacao: [{ coluna: 'usuario', direcao: 'desc' }],
      filtros: { origem: 'produto' },
      itensPorPagina: 50,
      padrao: true,
    };
    const corpos: Record<string, unknown>[] = [];
    const buscar = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const c = JSON.parse(String(init.body)) as Record<string, unknown>;
        corpos.push(c);
        guardada = { ...guardada, ...(c as object), tela: 'TRILHA', nome: String(c['nome'] ?? 'padrao') };
        return resposta(null, 204);
      }
      return resposta(conta([guardada], { TRILHA: guardada.nome }));
    });
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    await v.carregar();
    expect(v.ordenacao.value).toEqual([{ coluna: 'usuario', direcao: 'desc' }]);
    expect(v.itensPorPagina.value).toBe(50);
    v.alternar('origem');
    expect(await v.guardar()).toBe(true);
    expect(corpos[0]).toEqual({
      nome: 'Enxuta',
      colunas: ['origem', 'usuario', 'dataHora', 'acao'],
      ordenacao: [{ coluna: 'usuario', direcao: 'desc' }],
      itensPorPagina: 50,
      filtros: { origem: 'produto' },
      padrao: true,
    });
    const outra = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    await outra.carregar();
    expect(outra.visiveis.value).toEqual(['origem', 'usuario', 'dataHora', 'acao']);
    expect(outra.situacao.value).toBe('guardada');
  });

  it('ordenar pelo cabeçalho e itens por página entram na visão; esconder a coluna ordenada tira a ordenação', async () => {
    const corpos: Record<string, unknown>[] = [];
    const buscar = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return init?.method === 'PUT' ? resposta(null, 204) : resposta(conta([], {}));
    });
    const v = usarVisaoLista(ROTA_TRILHA_AUDITORIA, buscar as unknown as typeof fetch);
    await v.carregar();
    v.ordenarPor('usuario');
    expect(v.ordenacao.value).toEqual([{ coluna: 'usuario', direcao: 'asc' }]);
    expect(v.situacao.value).toBe('mudada');
    v.ordenarPor('usuario');
    expect(v.ordenacao.value).toEqual([{ coluna: 'usuario', direcao: 'desc' }]);
    v.alternar('usuario');
    expect(v.ordenacao.value).toEqual([]);
    v.ordenarPor('acao');
    v.definirItensPorPagina(25);
    v.definirItensPorPagina(3); // fora da faixa: volta ao bloco inteiro
    expect(v.itensPorPagina.value).toBeNull();
    v.definirItensPorPagina(25);
    expect(await v.guardar()).toBe(true);
    expect(corpos[0]).toMatchObject({
      ordenacao: [{ coluna: 'acao', direcao: 'asc' }],
      itensPorPagina: 25,
      padrao: true,
    });
    expect(corpos[0]).not.toHaveProperty('nome');
    expect(v.situacao.value).toBe('guardada');
    await v.voltarAFabrica();
    expect(corpos[1]).toEqual({ colunas: FABRICA, ordenacao: [], itensPorPagina: null, padrao: true });
    expect(v.ordenacao.value).toEqual([]);
  });
});
