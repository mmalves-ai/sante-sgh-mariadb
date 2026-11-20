// M08 pela HTTP, com a sessão real sobre a fonte sintética e o banco de domínios EM MEMÓRIA (nada conecta a
// banco): regra 2 (lista, filtro e ordenação no servidor, com teto), regra 3 (duplicidade, 409 apontando o
// existente), colisão (409 com o que mudou), inativar com versão, exportação auditada, permissão do domínio
// (recepção sem a opção do legado recebe 403 e a negação vai à trilha), parâmetros (definir e explicar
// valor; nível não permitido 422) e funcionalidades (POL-3: ligar recusado sem pré-requisito, aceito com
// ele, lote por setores e reversão; reautenticação).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, tipoDoProblema } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
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

const BASE = '/api/cadastros/dominios/cadastro/religiao';

describe('CRUD genérico pela HTTP (regras 2, 3 e 4)', () => {
  it('índice só com os domínios que a pessoa lê; descrição com campos e ações permitidas', async () => {
    const s = await entrar('SINT.ADMIN');
    const i = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios',
      headers: { cookie: s.cookie },
    });
    expect(i.statusCode).toBe(200);
    // M10: mais os blocos (SINT.ADMIN ganhou as opções de leitos da Recepção interna) e, desde a revisão (D-PERM-4),
    // centros de custo, locais de atendimento e locais de conta (as opções de consulta desses domínios).
    // M14: e os do lote gerado que as opções do SINT.ADMIN concedem (marcados com o marco).
    const lidos = i.json().dominios as { marco?: string }[];
    // M24: mais os locais de assistência e o hemocomponente prescritível (área genérica de Tabelas) e, da P-CAD-1, as
    // frequências e os horários relativos (a mesma área). M26: mais um domínio do portal ou das modalidades que as
    // opções do SINT.ADMIN concedem.
    // M21: e o setor e a operação do arquivo (as opções do controle de prontuários). M34: e um domínio do de-para do
    // laboratório de apoio ou das interfaces que as opções do diagnóstico do SINT.ADMIN concedem. M32: e os 13 cadastros
    // financeiros que as opções de tabelas e parâmetros do SINT.ADMIN concedem. M49 (etapa 3): e os 7 cadastros da
    // assinatura digital (SINT.ADMIN ganhou as opções da assinatura avançada). M51 (etapa 4): e os leitos de UTI
    // habilitados (as opções de tabelas do faturamento A.I.H. que o SINT.ADMIN tem; eram da consulta do M14).
    // W0-02 (rodada 2): e os 4 cadastros da nutrição clínica (SINT.ADMIN ganhou as opções 2675 e 4656, para o e2e dos
    // pilotos da exclusão física e do texto longo).
    // W1-04: e a procedência (saiu do lote do M14 para o prefixo da recepção, M19).
    expect(lidos.filter((x) => x.marco !== 'M14')).toHaveLength(62);
    expect(lidos.filter((x) => x.marco === 'M14').length).toBeGreaterThan(50);
    const d = await app.inject({ method: 'GET', url: BASE, headers: { cookie: s.cookie } });
    expect(d.json()).toMatchObject({
      recurso: 'religiao',
      rota: '/cadastros/dominios/cadastro/religiao',
      permitidas: ['ler', 'criar', 'editar', 'exportar'],
      campoCodigo: 'codigo',
      campoDescricao: 'nome',
    });
    expect(JSON.stringify(d.json())).not.toMatch(/TBRELIG/);
    const sis = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios/internacao/tipoAcomodacao',
      headers: { cookie: s.cookie },
    });
    expect(sis.json()).toMatchObject({ natureza: 'sistema', permitidas: ['ler', 'exportar'] });
    const r = await entrar('SINT.RECEPCAO');
    const ir = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios',
      headers: { cookie: r.cookie },
    });
    expect(ir.json().dominios).toEqual([]);
    const nao = await app.inject({ method: 'GET', url: BASE, headers: { cookie: r.cookie } });
    expect(nao.statusCode).toBe(403);
    expect(
      trilha.eventos.some(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.recurso === 'cadastro.religiao.ler',
      ),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/cadastros/dominios/x/naoExiste',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('regra 2: lista no servidor (filtro sem acento, ordem, página) e item; código fora do formato é 404', async () => {
    const s = await entrar('SINT.ADMIN');
    const l = await app.inject({
      method: 'GET',
      url: `${BASE}/itens?ordem=nome&direcao=desc&porPagina=2`,
      headers: { cookie: s.cookie },
    });
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ total: 3, porPagina: 2, pagina: 1, truncada: false });
    const b = await app.inject({
      method: 'GET',
      url: `${BASE}/itens?busca=religiao 2`,
      headers: { cookie: s.cookie },
    });
    expect(b.json().itens.map((x: { codigo: string }) => x.codigo)).toEqual(['2']);
    const i = await app.inject({ method: 'GET', url: `${BASE}/itens/1`, headers: { cookie: s.cookie } });
    expect(i.json()).toMatchObject({ codigo: '1', ativo: true });
    expect(
      (await app.inject({ method: 'GET', url: `${BASE}/itens/abc`, headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `${BASE}/itens/999`, headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `${BASE}/itens?porPagina=999`, headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(400);
  });

  it('incluir, duplicidade (409 apontando o existente), alterar com versão e colisão', async () => {
    const s = await entrar('SINT.ADMIN');
    const semChave = await app.inject({
      method: 'POST',
      url: `${BASE}/itens`,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: { valores: { codigo: 50, nome: 'Religião sintética' } },
    });
    expect(semChave.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `${BASE}/itens`,
      headers: h(s),
      payload: { valores: { codigo: 50, nome: 'Religião sintética' } },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ codigo: '50', operacao: 'cadastro.incluirReligiao', destino: 'memoria' });
    const dup = await app.inject({
      method: 'POST',
      url: `${BASE}/itens`,
      headers: h(s),
      payload: { valores: { codigo: 51, nome: 'religiao sintetica' } },
    });
    expect(dup.statusCode).toBe(409);
    expect(tipoDoProblema(dup.json())).toBe('recusa-de-negocio');
    expect(dup.json()).toMatchObject({ codigo: 'duplicado' });
    expect(dup.json().detail).toMatch(/código 50/);
    const invalido = await app.inject({
      method: 'POST',
      url: `${BASE}/itens`,
      headers: h(s),
      payload: { valores: { codigo: 52, nome: 'X 😀' } },
    });
    expect(invalido.statusCode).toBe(400);
    const item = (
      await app.inject({ method: 'GET', url: `${BASE}/itens/50`, headers: { cookie: s.cookie } })
    ).json();
    const alt = await app.inject({
      method: 'PUT',
      url: `${BASE}/itens/50`,
      headers: h(s),
      payload: { versao: item.versao, valores: { nome: 'Religião alterada' } },
    });
    expect(alt.statusCode).toBe(200);
    const colisao = await app.inject({
      method: 'PUT',
      url: `${BASE}/itens/50`,
      headers: h(s),
      payload: { versao: item.versao, valores: { nome: 'Outra' } },
    });
    expect(colisao.statusCode).toBe(409);
    expect(tipoDoProblema(colisao.json())).toBe('conflito-de-versao');
    expect(colisao.json().alteracoes).toEqual([
      { campo: 'nome', rotulo: 'Descrição', lido: 'Religião sintética', atual: 'Religião alterada' },
    ]);
    expect(
      trilha.eventos.filter((e) => e.evento === EVENTOS_AUDITAVEIS.dominioGravado.codigo).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('regra 4: inativar com versão (sem exclusão física); já inativo recusa', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = '/api/cadastros/dominios/internacao/tipoLimpeza';
    const i = (
      await app.inject({ method: 'GET', url: `${url}/itens/2`, headers: { cookie: s.cookie } })
    ).json();
    const uso = await app.inject({ method: 'GET', url: `${url}/itens/2/uso`, headers: { cookie: s.cookie } });
    expect(uso.json()).toEqual({ emUso: false, referencias: [], aviso: null });
    const r = await app.inject({
      method: 'POST',
      url: `${url}/itens/2/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: i.versao },
    });
    expect(r.statusCode).toBe(200);
    const depois = (
      await app.inject({ method: 'GET', url: `${url}/itens/2`, headers: { cookie: s.cookie } })
    ).json();
    expect(depois.ativo).toBe(false);
    const lista = (
      await app.inject({ method: 'GET', url: `${url}/itens`, headers: { cookie: s.cookie } })
    ).json();
    expect(lista.itens.map((x: { codigo: string }) => x.codigo)).not.toContain('2');
    const comInativos = (
      await app.inject({ method: 'GET', url: `${url}/itens?inativos=sim`, headers: { cookie: s.cookie } })
    ).json();
    expect(comInativos.itens.map((x: { codigo: string }) => x.codigo)).toContain('2');
    const de = await app.inject({
      method: 'POST',
      url: `${url}/itens/2/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: depois.versao },
    });
    expect(de.json()).toMatchObject({ codigo: 'ja-inativo' });
    const semInativar = await app.inject({
      method: 'POST',
      url: `${BASE}/itens/1/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: 'x' },
    });
    expect(semInativar.statusCode).toBe(403);
  });

  it('W0-02: reativar pela coluna de situação (sem o 409 sem-inativacao-no-novo), com motivo obrigatório; excluir só onde declarado', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = '/api/cadastros/dominios/internacao/tipoLimpeza';
    const descr = (await app.inject({ method: 'GET', url, headers: { cookie: s.cookie } })).json();
    expect(descr.reativaNaSituacao).toBe(true);
    expect(descr.estados).toHaveProperty('reativar');
    const i = (
      await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })
    ).json();
    await app.inject({
      method: 'POST',
      url: `${url}/itens/3/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: i.versao },
    });
    const inativo = (
      await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })
    ).json();
    expect(inativo.ativo).toBe(false);
    const semMotivo = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/reativar`,
      headers: h(s),
      payload: { versao: inativo.versao },
    });
    expect(semMotivo.statusCode).toBe(400);
    const r = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/reativar`,
      headers: h(s),
      payload: { versao: inativo.versao, motivo: 'voltou a ser usado no hospital' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ codigo: '3', operacao: 'internacao.reativarTipoLimpeza' });
    expect(r.json().codigo).not.toBe('sem-inativacao-no-novo');
    const depois = (
      await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })
    ).json();
    expect(depois.ativo).toBe(true);
    const ja = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/reativar`,
      headers: h(s),
      payload: { versao: depois.versao, motivo: 'de novo, para conferir' },
    });
    expect(ja.json()).toMatchObject({ codigo: 'ja-ativo' });
    // O domínio que não declara `excluir`: 403 (a negação vai à trilha), nada apagado.
    const ex = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/excluir`,
      headers: h(s),
      payload: { versao: depois.versao, motivo: 'tentativa sem a ação declarada' },
    });
    expect(ex.statusCode).toBe(403);
  });

  it('revisão W0-02: inativar sem motivo é recusado (400); excluir confere a senha da sessão real (401) e exclui com ela', async () => {
    const s = await entrar('SINT.ADMIN');
    const lim = '/api/cadastros/dominios/internacao/tipoLimpeza';
    const i1 = (
      await app.inject({ method: 'GET', url: `${lim}/itens/1`, headers: { cookie: s.cookie } })
    ).json();
    const semMotivo = await app.inject({
      method: 'POST',
      url: `${lim}/itens/1/inativar`,
      headers: h(s),
      payload: { versao: i1.versao },
    });
    expect(semMotivo.statusCode).toBe(400);
    const url = '/api/cadastros/dominios/pep/caracteristicaDieta';
    const descr = (await app.inject({ method: 'GET', url, headers: { cookie: s.cookie } })).json();
    // A exclusão do domínio (categoria protegida) guarda o retrato: a tela pode prometer o histórico.
    expect(descr.exclusaoProtegida).toBe(true);
    const item = (
      await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })
    ).json();
    const pedido = { versao: item.versao, motivo: 'incluído por engano (teste)' };
    const errada = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/excluir`,
      headers: h(s),
      payload: { ...pedido, senha: 'senha-errada' },
    });
    expect(errada.statusCode).toBe(401);
    const semSenha = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/excluir`,
      headers: h(s),
      payload: pedido,
    });
    expect(semSenha.statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })).statusCode,
    ).toBe(200);
    const ok = await app.inject({
      method: 'POST',
      url: `${url}/itens/3/excluir`,
      headers: h(s),
      payload: { ...pedido, senha: SENHA },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ codigo: '3', operacao: 'pep.excluirCaracteristicaDieta' });
    expect(
      (await app.inject({ method: 'GET', url: `${url}/itens/3`, headers: { cookie: s.cookie } })).statusCode,
    ).toBe(404);
  });

  it('revisão W0-02: o relatório da vigia de reconciliação tem rota, permissão e trilha (fonte em memória: sem rodada)', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios/vigia/exclusoes-fora',
      headers: { cookie: s.cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ligada: false, disponivel: false, linhas: [], ultimaRodada: null });
    expect(
      trilha.eventos.some((x) => x.evento === EVENTOS_AUDITAVEIS.vigiaReconciliacaoConsultada.codigo),
    ).toBe(true);
    const recepcao = await entrar('SINT.RECEPCAO');
    const negado = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios/vigia/exclusoes-fora',
      headers: { cookie: recepcao.cookie },
    });
    expect(negado.statusCode).toBe(403);
  });

  it('opções de referência e exportação auditada (CSV, sem dado pessoal: sem justificativa)', async () => {
    const s = await entrar('SINT.ADMIN');
    const o = await app.inject({
      method: 'GET',
      url: '/api/cadastros/dominios/pep/tipoAlergia/opcoes/classificacao',
      headers: { cookie: s.cookie },
    });
    expect(o.json().opcoes).toHaveLength(3);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/cadastros/dominios/pep/tipoAlergia/opcoes/nome',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const e = await app.inject({
      method: 'POST',
      url: `${BASE}/exportar`,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: {},
    });
    expect(e.statusCode).toBe(200);
    expect(e.headers['content-type']).toMatch(/text\/csv/);
    // BOM do UTF-8 (Excel em pt-BR) e a contagem na trilha.
    expect(e.body.split('\r\n')[0]).toBe('\uFEFFCódigo;Descrição;Situação');
    const ev = trilha.eventos.find((x) => x.evento === EVENTOS_AUDITAVEIS.dominioExportado.codigo);
    expect(ev?.chaveNaturalAlvo).toMatch(/^linhas:\d+$/);
  });
});

describe('parâmetros e funcionalidades por estabelecimento (regras 7, 8, 9 e 9a)', () => {
  it('painel: novos com "explicar valor" e legado como o legado vê (não declarada sem valor; credencial oculta)', async () => {
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
    expect(corpo.legado.find((x: { campo: string }) => x.campo === 'CHECKENF')).toMatchObject({
      situacao: 'interpretada',
      valor: 'Sim',
      bruto: 'T',
    });
    expect(corpo.legado.find((x: { campo: string }) => x.campo === 'SENHAALTPLAN')).toMatchObject({
      situacao: 'oculta',
      valor: null,
      bruto: null,
    });
    expect(corpo.legado.find((x: { campo: string }) => x.campo === 'MAT')).toMatchObject({
      situacao: 'nao-interpretada',
      valor: null,
    });
    expect(corpo.resumoLegado.ocultas).toBeGreaterThan(0);
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
    const op = fim.funcionalidades.find((f: { chave: string }) => f.chave === 'cadastro.incluirReligiao');
    expect(op).toMatchObject({ tipo: 'operacao', estadoCatalogo: 'especificada' });
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

  it('CRUD (revisão): referência a item inexistente recusada no servidor; situação de sistema não inativa', async () => {
    const s = await entrar('SINT.ADMIN');
    const inc = await app.inject({
      method: 'POST',
      url: '/api/cadastros/dominios/pep/tipoAlergia/itens',
      headers: h(s),
      payload: { valores: { nome: 'Alergia sintética de referência', classificacao: 9999 } },
    });
    expect(inc.statusCode).toBe(409);
    expect(inc.json()).toMatchObject({ codigo: 'referencia-invalida' });
    const url = '/api/cadastros/dominios/internacao/situacaoHigienizacao';
    const i = await app.inject({ method: 'GET', url: `${url}/itens/1`, headers: { cookie: s.cookie } });
    expect(i.statusCode).toBe(200);
    const r = await app.inject({
      method: 'POST',
      url: `${url}/itens/1/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: i.json().versao },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'item-de-sistema' });
  });
});

describe('fonte do CRUD e da configuração (revisão: falha fechada)', () => {
  it('CONFIG_FONTE em dev/ci recusa a partida; fora de dev/ci sem núcleo, 503 (nunca a memória)', async () => {
    await expect(
      criarApp(lerConfiguracao(env), null, { ...env, CONFIG_FONTE: 'legado' }, { trilha }),
    ).rejects.toThrow(/CONFIG_FONTE/);
    const { fonteConfiguracaoIndisponivel } = await import('./configuracao-fonte.js');
    const { fonteDominiosIndisponivel } = await import('./dominios-fonte.js');
    await expect(fonteConfiguracaoIndisponivel().chaves('r', 'aa')).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    await expect(fonteDominiosIndisponivel().ler('r', 'aa', async () => 1)).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
  });
});
