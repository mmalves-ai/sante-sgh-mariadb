// M08 com a sessão real sobre a fonte sintética e o banco de domínios EM MEMÓRIA (nada conecta a banco): regra 2
// (lista e busca no servidor, com teto), regra 3 (duplicidade), colisão pela versão, inativar e reativar com motivo,
// exportação auditada, referência inexistente recusada, permissão do domínio (sem a ação, 403), parâmetros (definir e
// explicar valor; nível não permitido 422) e funcionalidades (POL-3: ligar recusado sem pré-requisito, aceito com ele,
// lote por setores e reversão; reautenticação).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, tipoDoProblema } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { criarAbility } from '@sgh/dominio-acesso';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { DominiosController } from './dominios.controller.js';
import { fonteDominiosMemoria } from './dominios-fonte.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'config' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}

async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}

const h = (s: Sessao, extra: Record<string, string> = {}) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m08-${++chave}-${Date.now()}`,
  ...extra,
});

// Domínios sintéticos da memória (dominiosSinteticos): a mesma forma dos domínios da matriz de priorização do modelo.
// As permissões dos domínios (<modulo>.<recurso>.<acao>) vêm do catálogo de ações do cliente; a sessão sintética não as
// tem (pedido de carga ao integrador). Pela HTTP, o índice mostra só o que a pessoa lê; o CRUD é provado no controlador
// com uma habilidade que concede as ações dos domínios (a mesma regra CASL da guarda).
const M = 'administracao';
const DIM = 'dimensaoPriorizacaoGut';
const GRAU = 'grauPriorizacaoGut';

let chaveCrud = 0;
function requisicao(acoes: readonly string[] = ['ler', 'criar', 'editar', 'inativar', 'exportar']) {
  const regras = [DIM, GRAU].flatMap((r) => acoes.map((acao) => ({ action: acao, subject: `${M}.${r}` })));
  return {
    sgh: {
      sessao: { estabelecimentoAtivo: 'aa', rede: 'rede-teste', usuario: { id: '1', login: 'SINT.ADMIN' } },
      ability: criarAbility(regras),
    },
    headers: { 'idempotency-key': `teste-crud-${++chaveCrud}-${Date.now()}` },
    ip: '127.0.0.1',
  } as never;
}
const resposta = () => {
  const cabecalhos: Record<string, string> = {};
  return { cabecalhos, header: (k: string, v: string) => (cabecalhos[k] = v) } as never as {
    cabecalhos: Record<string, string>;
  };
};
async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ErroProblema
      ? e.getStatus()
      : ((e as { problema?: { status?: number } }).problema?.status ?? -1);
  }
}

describe('CRUD genérico (regras 2, 3 e 4)', () => {
  it('índice pela HTTP: só os domínios que a pessoa lê (sem as ações dos domínios, nenhum)', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios',
      headers: { cookie: s.cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().dominios).toEqual([]);
    const recepcao = await entrar('SINT.RECEPCAO');
    const rr = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios',
      headers: { cookie: recepcao.cookie },
    });
    expect(rr.statusCode === 403 || rr.json().dominios.length === 0).toBe(true);
  });

  it('descrição, lista no servidor (busca, página), item; sem a permissão, 403; inexistente, 404', async () => {
    const c = new DominiosController(fonteDominiosMemoria(), trilha);
    const idx = await c.indice(requisicao());
    expect(idx.dominios.map((d) => d.recurso)).toEqual(expect.arrayContaining([DIM, GRAU]));
    const desc = await c.descricao(M, DIM, requisicao());
    expect(desc).toMatchObject({ modulo: M, recurso: DIM, campoCodigo: 'codigo' });
    expect(desc.permitidas).toEqual(expect.arrayContaining(['ler', 'criar']));
    const l = await c.lista(M, DIM, { porPagina: '1' }, requisicao());
    expect(l).toMatchObject({ total: 2, porPagina: 1, truncada: false });
    expect(l.itens).toHaveLength(1);
    const b = await c.lista(M, DIM, { busca: 'urgencia' }, requisicao());
    expect(b.itens.map((x) => x.codigo)).toEqual(['U']);
    expect(await c.item(M, DIM, 'G', requisicao())).toMatchObject({ codigo: 'G', ativo: true });
    expect(await status(c.item(M, DIM, 'ZZ', requisicao()))).toBe(404);
    expect(await status(c.lista(M, DIM, {}, requisicao([])))).toBe(403);
    expect(await status(c.descricao(M, 'naoExiste', requisicao()))).toBe(404);
  });

  it('incluir, duplicidade (409), alterar com versão e colisão; sem a permissão de criar, 403', async () => {
    const c = new DominiosController(fonteDominiosMemoria(), trilha);
    expect(
      await status(
        c.incluir(M, DIM, { valores: { codigo: 'T', descricao: 'Tendência' } }, requisicao(['ler'])),
      ),
    ).toBe(403);
    expect(
      await c.incluir(M, DIM, { valores: { codigo: 'T', descricao: 'Tendência (sintética)' } }, requisicao()),
    ).toMatchObject({ codigo: 'T' });
    expect(
      await status(c.incluir(M, DIM, { valores: { codigo: 'T', descricao: 'Outra' } }, requisicao())),
    ).toBe(409);
    const lido = await c.item(M, DIM, 'T', requisicao());
    await c.alterar(
      M,
      DIM,
      'T',
      { valores: { descricao: 'Tendência (revista)' }, versao: lido.versao },
      requisicao(),
    );
    // A mesma versão lida de novo: colisão (outra pessoa já gravou).
    expect(
      await status(
        c.alterar(M, DIM, 'T', { valores: { descricao: 'Colisão' }, versao: lido.versao }, requisicao()),
      ),
    ).toBe(409);
    expect((await c.item(M, DIM, 'T', requisicao())).valores['descricao']).toBe('Tendência (revista)');
  });

  it('regra 4: inativar com versão e motivo (sem exclusão física); reativar com motivo', async () => {
    const c = new DominiosController(fonteDominiosMemoria(), trilha);
    const lido = await c.item(M, DIM, 'U', requisicao());
    expect(await c.uso(M, DIM, 'U', requisicao())).toMatchObject({ emUso: false });
    expect(await status(c.inativar(M, DIM, 'U', { versao: lido.versao }, requisicao()))).toBe(400);
    await c.inativar(M, DIM, 'U', { versao: lido.versao, motivo: 'não é mais usado (teste)' }, requisicao());
    expect((await c.lista(M, DIM, {}, requisicao())).itens.map((x) => x.codigo)).not.toContain('U');
    const inativo = await c.item(M, DIM, 'U', requisicao());
    expect(inativo.ativo).toBe(false);
    await c.reativar(
      M,
      DIM,
      'U',
      { versao: inativo.versao, motivo: 'voltou a ser usado (teste)' },
      requisicao(),
    );
    expect((await c.item(M, DIM, 'U', requisicao())).ativo).toBe(true);
    // Exclusão física: não existe nos domínios do modelo próprio (regra 4).
    expect(await status(c.excluir(M, DIM))).toBeGreaterThanOrEqual(400);
  });

  it('opções de referência e exportação auditada (CSV); referência inexistente recusada no servidor', async () => {
    const c = new DominiosController(fonteDominiosMemoria(), trilha);
    const op = (await c.opcoes(M, GRAU, `${DIM}Id`, requisicao())) as unknown;
    const lista = (Array.isArray(op) ? op : (op as { opcoes: unknown[] }).opcoes) as { rotulo: string }[];
    expect(lista.map((x) => x.rotulo)).toEqual(expect.arrayContaining(['Gravidade (sintética)']));
    const antes = trilha.eventos.length;
    const res = resposta();
    const csv = await c.exportar(M, DIM, { formato: 'csv' }, requisicao(), res as never);
    expect(res.cabecalhos['Content-Type']).toMatch(/csv/);
    expect(csv).toContain('Gravidade');
    expect(trilha.eventos.length).toBeGreaterThan(antes);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: EVENTOS_AUDITAVEIS.dominioExportado.codigo });
    const inc = c.incluir(
      M,
      GRAU,
      { valores: { codigo: 'G9', descricao: 'Grau sintético', [`${DIM}Id`]: 9999, pontuacao: 1 } },
      requisicao(),
    );
    const erro = await inc.catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroProblema);
    expect((erro as ErroProblema).getStatus()).toBe(409);
    expect((erro as ErroProblema).extras['codigo']).toBe('referencia-inexistente');
  });
});

describe('parâmetros e funcionalidades por estabelecimento (regras 7, 8, 9 e 9a)', () => {
  it('painel: parâmetros do produto com "explicar valor"; nada do sistema de origem', async () => {
    const s = await entrar('SINT.ADMIN');
    const p = await app.inject({
      method: 'GET',
      url: '/api/administracao/parametros',
      headers: { cookie: s.cookie },
    });
    expect(p.statusCode).toBe(200);
    const corpo = p.json();
    expect(
      corpo.novos.find((x: { chave: string }) => x.chave === 'cadastro.itensPorPagina').explicacao,
    ).toMatchObject({ valor: '25', origem: 'padrao' });
    // Sem a seção de parâmetros do sistema de origem (ADR 0003): só os parâmetros do produto.
    expect(corpo.legado ?? []).toEqual([]);
  });

  it('definir: versão nova com justificativa; explicar valor diz de onde veio; nível não permitido 422', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = '/api/administracao/parametros/cadastro.itensPorPagina';
    const naoPerm = await app.inject({
      method: 'PUT',
      url,
      headers: h(s),
      payload: { nivel: 'unidade', alvo: '1', valor: '40', justificativa: 'ajuste sintético de teste' },
    });
    expect(naoPerm.statusCode).toBe(422);
    const curta = await app.inject({
      method: 'PUT',
      url,
      headers: h(s),
      payload: { nivel: 'estabelecimento', alvo: 'aa', valor: '40', justificativa: 'curta' },
    });
    expect(curta.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PUT',
      url,
      headers: h(s),
      payload: {
        nivel: 'estabelecimento',
        alvo: 'aa',
        valor: '40',
        justificativa: 'ajuste sintético de teste',
      },
    });
    expect(ok.statusCode).toBe(200);
    const um = (await app.inject({ method: 'GET', url, headers: { cookie: s.cookie } })).json();
    expect(um.parametro.explicacao).toMatchObject({
      valor: '40',
      origem: 'estabelecimento',
      alvo: 'aa',
      justificativa: 'ajuste sintético de teste',
    });
    const critico = await app.inject({
      method: 'PUT',
      url: '/api/administracao/parametros/acesso.emergenciaMinutos',
      headers: h(s),
      payload: { nivel: 'rede', alvo: 'rede-teste', valor: '30', justificativa: 'ajuste sintético de teste' },
    });
    expect(critico.statusCode).toBe(401);
    const comSenha = await app.inject({
      method: 'PUT',
      url: '/api/administracao/parametros/acesso.emergenciaMinutos',
      headers: h(s),
      payload: {
        nivel: 'rede',
        alvo: 'rede-teste',
        valor: '30',
        justificativa: 'ajuste sintético de teste',
        senha: SENHA,
      },
    });
    expect(comSenha.statusCode).toBe(200);
    expect(trilha.eventos.some((x) => x.evento === EVENTOS_AUDITAVEIS.parametroDefinido.codigo)).toBe(true);
  });

  it('POL-3: ligar recusado sem o pré-requisito; aceito com ele; desligar sempre; lote por setores e reversão', async () => {
    const s = await entrar('SINT.ADMIN');
    const painel = (
      await app.inject({ method: 'GET', url: '/api/administracao/liberacao', headers: { cookie: s.cookie } })
    ).json();
    const esocial = painel.funcionalidades.find((f: { chave: string }) => f.chave === 'pessoas.esocial');
    expect(esocial).toMatchObject({ tipo: 'recurso', podeLigar: false, ligadaNoEstabelecimento: false });
    expect(esocial.motivoBloqueio).toMatch(/Certificado digital do empregador/);
    const pedido = {
      chave: 'pessoas.esocial',
      tipo: 'recurso',
      escopo: 'hospital',
      valores: ['*'],
      ligar: true,
      justificativa: 'ligação sintética de teste',
      senha: SENHA,
    };
    const semSenha = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: h(s),
      payload: { ...pedido, senha: 'errada' },
    });
    expect(semSenha.statusCode).toBe(401);
    const recusa = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: h(s),
      payload: pedido,
    });
    expect(recusa.statusCode).toBe(409);
    expect(tipoDoProblema(recusa.json())).toBe('prerequisito-pendente');
    const pre = await app.inject({
      method: 'PUT',
      url: '/api/administracao/liberacao/prerequisitos',
      headers: h(s),
      payload: {
        recurso: 'pessoas.esocial',
        tipo: 'certificado',
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'protocolo sintético 123',
        senha: SENHA,
      },
    });
    expect(pre.statusCode).toBe(200);
    const liga = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: h(s),
      payload: pedido,
    });
    expect(liga.json()).toMatchObject({ alteradas: 1, destino: 'memoria' });
    const desliga = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: h(s),
      payload: { ...pedido, ligar: false },
    });
    expect(desliga.json()).toMatchObject({ alteradas: 1 });
    // Lote (DP-4): a mesma chave para três setores numa ação só; reversível.
    const lote = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: h(s),
      payload: {
        chave: 'licitacao',
        tipo: 'recurso',
        escopo: 'setor',
        valores: ['10', '11', '12'],
        ligar: true,
        justificativa: 'lote sintético de setores',
        senha: SENHA,
      },
    });
    expect(lote.json()).toMatchObject({ alteradas: 3 });
    const rev = await app.inject({
      method: 'POST',
      url: `/api/administracao/liberacao/lotes/${lote.json().lote}/reverter`,
      headers: h(s),
      payload: { justificativa: 'reversão sintética do lote', senha: SENHA },
    });
    expect(rev.json()).toMatchObject({ alteradas: 3 });
    const fim = (
      await app.inject({ method: 'GET', url: '/api/administracao/liberacao', headers: { cookie: s.cookie } })
    ).json();
    const lic = fim.funcionalidades.find((f: { chave: string }) => f.chave === 'licitacao');
    // Criadas pelo lote e revertidas: voltam a HERDAR (fora do painel), não ficam desligadas. A chave do hospital é a da
    // sessão sintética (M55.4: a licitação ligada para o E2E), que o lote não toca.
    expect(lic.chaves.filter((c: { escopo: string }) => c.escopo === 'setor')).toEqual([]);
    expect(lic.chaves.map((c: { escopo: string }) => c.escopo)).toEqual(['hospital']);
    // As operações liberáveis vêm do catálogo próprio (operações declaradas nos contratos).
    expect(fim.funcionalidades.some((f: { tipo: string }) => f.tipo === 'operacao')).toBe(true);
    expect(
      trilha.eventos.filter((x) => x.evento === EVENTOS_AUDITAVEIS.liberacaoAlterada.codigo).length,
    ).toBeGreaterThanOrEqual(3);
    expect(trilha.eventos.some((x) => x.evento === EVENTOS_AUDITAVEIS.liberacaoRevertida.codigo)).toBe(true);
  });

  it('POL-3 (revisão): evidência e autorização no pré-requisito; data real; ligar de novo não grava', async () => {
    const s = await entrar('SINT.ADMIN');
    const base = {
      recurso: 'pessoas.esocial',
      tipo: 'certificado',
      validade: '2099-12-31',
      senha: SENHA,
    };
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: '/api/administracao/liberacao/prerequisitos',
        headers: h(s),
        payload: { ...base, ...payload },
      });
    expect((await put({ situacao: 'cumprido', evidencia: null })).statusCode).toBe(400);
    expect((await put({ situacao: 'dispensado', evidencia: 'protocolo sintético' })).statusCode).toBe(400);
    expect(
      (await put({ situacao: 'cumprido', evidencia: 'protocolo sintético', validade: '2026-13-45' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await put({
          situacao: 'dispensado',
          evidencia: 'protocolo sintético',
          referenciaAutorizacao: 'Autorização sintética 2026-10-20',
        })
      ).statusCode,
    ).toBe(200);
    const pedido = {
      chave: 'licitacao',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: ['SINT.UM'],
      ligar: true,
      justificativa: 'ligação sintética de teste',
      senha: SENHA,
    };
    const ligar = () =>
      app.inject({ method: 'POST', url: '/api/administracao/liberacao', headers: h(s), payload: pedido });
    expect((await ligar()).json()).toMatchObject({ alteradas: 1 });
    // Estado relido na transação: a mesma chave já ligada não gera lote nem trilha.
    expect((await ligar()).json()).toMatchObject({ lote: '', alteradas: 0 });
  });
});

describe('fonte do CRUD e da configuração (revisão: falha fechada)', () => {
  it('fora de dev/ci sem núcleo, 503 (nunca a memória)', async () => {
    const { fonteConfiguracaoIndisponivel } = await import('./configuracao-fonte.js');
    const { fonteDominiosIndisponivel } = await import('./dominios-fonte.js');
    await expect(fonteConfiguracaoIndisponivel().chaves('r', 'aa')).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    await expect(fonteDominiosIndisponivel().catalogo()).rejects.toMatchObject({ tipo: 'indisponivel' });
    // Fora de dev/ci e sem núcleo, o módulo sobe com a fonte indisponível: o índice responde 503 com sessão.
    const { modulo } = await import('./modulo.js');
    const m = await modulo({
      configuracao: lerConfiguracao({ AMBIENTE: 'homolog' }),
      nucleo: null,
      env: { AMBIENTE: 'homolog' },
      armazem: undefined as never,
      servico: null,
      trilha,
    });
    const dominios = (m.providers ?? []).find(
      (p) => typeof p === 'object' && 'provide' in p && String(p.provide) === 'Symbol(FONTE_DOMINIOS)',
    ) as { useValue: { catalogo(): Promise<unknown> } } | undefined;
    await expect(dominios?.useValue.catalogo()).rejects.toMatchObject({ tipo: 'indisponivel' });
  });
});
