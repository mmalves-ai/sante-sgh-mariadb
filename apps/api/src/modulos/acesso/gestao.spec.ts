// ADR 0022 pela HTTP, sobre a fonte SINTÉTICA e o banco da plataforma EM MEMÓRIA (nenhuma conexão real, nenhum
// dado de pessoa): acesso total da plataforma (todas as permissões, sem segregação, faixa, auditoria com o ator
// real; o suporte não tem), e a tela "Perfis e permissões" (efetivas com a origem, perfil concedido e revogado,
// mapa aprovado muda as efetivas, receitas do legado sobre o estado sintético, cache invalidado na hora).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaSessao, faixaAcessoTotal } from '@sgh/contratos';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ServicoAutorizacao } from '../../autorizacao/servico-autorizacao.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import {
  CONTAS_PLATAFORMA_SINTETICAS as C,
  RepositorioPlataformaMemoria,
  SENHA_PLATAFORMA_SINTETICA,
} from '../suporte/repositorio.js';
import { emNomeDePadrao } from '../../app.module.js';
import {
  estadoAcessoSintetico,
  FonteAcessoSintetica,
  reiniciarEstadoAcessoSintetico,
} from './fonte-sintetica.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SUPORTE_SESSAO_MINUTOS: '60',
  PLATAFORMA_EM_NOME_DE: 'aa=SINT.ADMIN;bb=fora do formato ',
};
const trilha = new RegistradorTrilhaMemoria();
const armazem = new ArmazemMemoria();
let repo: RepositorioPlataformaMemoria;
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  repo = RepositorioPlataformaMemoria.sintetico(REDE, ['aa', 'bb'], (s) =>
    cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 }),
  );
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem, plataforma: repo });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Navegador {
  cookies: Map<string, string>;
}
function guardar(n: Navegador, set: string | string[] | undefined): void {
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (!par || i < 0) continue;
    if (/Max-Age=0/.test(c) || par.slice(i + 1) === '') n.cookies.delete(par.slice(0, i));
    else n.cookies.set(par.slice(0, i), par.slice(i + 1));
  }
}
const cookie = (n: Navegador) => [...n.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const plat = (n: Navegador) => ({ cookie: cookie(n), 'x-csrf-plataforma': n.cookies.get('sgh_pcsrf') ?? '' });
const spdata = (n: Navegador) => ({
  cookie: cookie(n),
  'x-csrf': n.cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-gestao-${++chave}-${Date.now()}`,
});

async function entrarPlataforma(email: string): Promise<Navegador> {
  const n: Navegador = { cookies: new Map() };
  const r = await app.inject({
    method: 'POST',
    url: '/api/plataforma/sessao',
    payload: { email, senha: SENHA_PLATAFORMA_SINTETICA },
  });
  expect(r.statusCode).toBe(200);
  guardar(n, r.headers['set-cookie']);
  return n;
}

async function entrarSpdata(login: string): Promise<Navegador> {
  const n: Navegador = { cookies: new Map() };
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  guardar(n, r.headers['set-cookie']);
  return n;
}

async function acessoTotal(n: Navegador, estabelecimento: string, login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/plataforma/como',
    headers: plat(n),
    payload: { estabelecimento, login, modo: 'acesso-total', motivo: 'CHAMADO-1' },
  });
  guardar(n, r.headers['set-cookie']);
  return r;
}

describe('acesso total da plataforma (ADR 0022)', () => {
  it('concede TODAS as permissões do catálogo (inclusive as do legado), com a faixa e o modo na sessão', async () => {
    const n = await entrarPlataforma(C.plataforma);
    const eu = await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(n) });
    expect(eu.json().podeAcessoTotal).toBe(true);
    const padrao = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/em-nome-de?estabelecimento=aa',
      headers: plat(n),
    });
    expect(padrao.json()).toEqual({ estabelecimento: 'aa', login: 'SINT.ADMIN' });
    const r = await acessoTotal(n, 'aa', 'SINT.RECEPCAO');
    expect(r.statusCode).toBe(201);
    const s = esquemaSessao.parse(r.json());
    expect(s.como?.modo).toBe('acesso-total');
    expect(faixaAcessoTotal(s.como?.estabelecimentoNome ?? '')).toBe(
      'Você está com acesso total da plataforma em Estabelecimento A (teste)',
    );
    const todas = new Set(CATALOGO_COMPLETO.map((p) => p.codigo));
    expect(new Set(s.permissoes)).toEqual(todas);
    // As telas da Fase 0 que o diretor não via: todas abrem.
    const tela = await app.inject({ method: 'GET', url: '/api/acesso/gestao/mapa', headers: spdata(n) });
    expect(tela.statusCode).toBe(200);
    const sessoes = await app.inject({
      method: 'GET',
      url: '/api/plataforma/auditoria/sessoes',
      headers: plat(n),
    });
    expect(sessoes.json()[0]).toMatchObject({
      modo: 'acesso-total',
      alvoLogin: 'SINT.RECEPCAO',
      estabelecimento: 'aa',
    });
    // O ator real vai à auditoria da conta.
    const eventos = await app.inject({
      method: 'GET',
      url: '/api/plataforma/auditoria/contas',
      headers: plat(n),
    });
    expect(eventos.json().some((e: { evento: string }) => e.evento === 'suporte.acessoTotal.aberto')).toBe(
      true,
    );
    await app.inject({ method: 'DELETE', url: '/api/plataforma/como', headers: plat(n) });
  });

  it('o suporte técnico NÃO obtém acesso total (403, sem sessão de suporte aberta)', async () => {
    const n = await entrarPlataforma(C.suporte);
    const eu = await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(n) });
    expect(eu.json().podeAcessoTotal).toBe(false);
    const antes = repo.sessoes.size;
    const r = await acessoTotal(n, 'aa', 'SINT.RECEPCAO');
    expect(r.statusCode).toBe(403);
    expect(repo.sessoes.size).toBe(antes);
    const padrao = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/em-nome-de?estabelecimento=aa',
      headers: plat(n),
    });
    expect(padrao.statusCode).toBe(403);
  });

  it('PLATAFORMA_EM_NOME_DE: entrada fora do formato é ignorada', () => {
    const f = emNomeDePadrao('aa=SINT.X; bb = Y;cc=;=Z;dd= espaco');
    expect(f('aa')).toBe('SINT.X');
    expect(f('bb')).toBeNull();
    expect(f('cc')).toBeNull();
    expect(f('dd')).toBeNull();
    expect(emNomeDePadrao(undefined)('aa')).toBeNull();
  });
});

describe('Perfis e permissões (ADR 0022)', () => {
  it('sem acesso.perfil.gerir: 403 (a recepção não administra acessos)', async () => {
    const n = await entrarSpdata('SINT.RECEPCAO');
    const r = await app.inject({ method: 'GET', url: '/api/acesso/gestao/mapa', headers: spdata(n) });
    expect(r.statusCode).toBe(403);
  });

  it('efetivas com a origem; aprovar o mapa grupo → perfil muda as permissões efetivas de todo o grupo', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const antes = await app.inject({
      method: 'GET',
      url: '/api/acesso/gestao/usuarios/SINT.MEDICO',
      headers: spdata(n),
    });
    expect(antes.statusCode).toBe(200);
    const a = antes.json();
    expect(a.permissoes.some((p: { codigo: string }) => p.codigo === 'config.schema.ler')).toBe(false);
    const doGrupo = a.permissoes.find((p: { origens: { tipo: string }[] }) =>
      p.origens.some((o) => o.tipo === 'grupo'),
    );
    expect(doGrupo.origens[0]).toMatchObject({ tipo: 'grupo', grupo: 'MEDICOS' });
    const mapa = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/mapa', headers: spdata(n) })
    ).json();
    expect(
      mapa.grupoPerfil.some(
        (l: { grupo: string; situacao: string }) => l.grupo === 'MEDICOS' && l.situacao === 'proposta',
      ),
    ).toBe(true);
    const decidir = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/decidir',
      headers: spdata(n),
      payload: {
        chave: { tipo: 'grupo-perfil', grupo: 'MEDICOS', perfil: 'administrador-sistema' },
        situacao: 'aprovada',
        senha: SENHA,
      },
    });
    expect(decidir.statusCode).toBe(200);
    expect(decidir.json()).toMatchObject({ invalidado: 'estabelecimento', destino: 'memoria' });
    const depois = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/usuarios/SINT.MEDICO', headers: spdata(n) })
    ).json();
    const schema = depois.permissoes.find((p: { codigo: string }) => p.codigo === 'config.schema.ler');
    expect(schema.origens).toEqual([{ tipo: 'perfil', perfil: 'administrador-sistema', via: 'grupo' }]);
    expect(depois.perfis).toContainEqual({ perfil: 'administrador-sistema', origens: ['grupo'] });
    // Recusar volta atrás.
    await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/decidir',
      headers: spdata(n),
      payload: {
        chave: { tipo: 'grupo-perfil', grupo: 'MEDICOS', perfil: 'administrador-sistema' },
        situacao: 'recusada',
        motivo: 'revisão da área médica',
        senha: SENHA,
      },
    });
    const recusado = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/usuarios/SINT.MEDICO', headers: spdata(n) })
    ).json();
    expect(recusado.permissoes.some((p: { codigo: string }) => p.codigo === 'config.schema.ler')).toBe(false);
  });

  it('concede e revoga perfil (início, fim, motivo); a si mesmo e sem a senha, recusados; a sessão do afetado vê na hora', async () => {
    const gestor = await entrarSpdata('SINT.GESTOR');
    const alvo = await entrarSpdata('SINT.RECEPCAO');
    const s0 = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: spdata(alvo) })).json(),
    );
    expect(s0.permissoes).not.toContain('config.parametro.ler');
    const semSenha = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: spdata(gestor),
      payload: { login: 'SINT.RECEPCAO', perfil: 'administrador-sistema', motivo: 'teste', senha: 'errada' },
    });
    expect(semSenha.statusCode).toBe(401);
    const aSi = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: spdata(gestor),
      payload: { login: 'SINT.GESTOR', perfil: 'auditor', motivo: 'teste', senha: SENHA },
    });
    expect(aSi.statusCode).toBe(409);
    const r = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: spdata(gestor),
      payload: {
        login: 'SINT.RECEPCAO',
        perfil: 'administrador-sistema',
        motivo: 'chamado 42',
        fim: new Date(Date.now() + 86_400_000).toISOString(),
        senha: SENHA,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ invalidado: 'usuario' });
    // Cache invalidado: a sessão aberta do afetado já tem a permissão (sem esperar os 3 min).
    const s1 = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: spdata(alvo) })).json(),
    );
    expect(s1.permissoes).toContain('config.parametro.ler');
    const ef = (
      await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO',
        headers: spdata(gestor),
      })
    ).json();
    expect(ef.concessoes[0]).toMatchObject({
      perfil: 'administrador-sistema',
      motivo: 'chamado 42',
      vigente: true,
    });
    // W0-09: revogar exige motivo (400 sem ele; a concessão segue vigente).
    const semMotivo = await app.inject({
      method: 'POST',
      url: `/api/acesso/gestao/perfis/${r.json().id}/revogar`,
      headers: spdata(gestor),
      payload: { senha: SENHA },
    });
    expect(semMotivo.statusCode).toBe(400);
    const rev = await app.inject({
      method: 'POST',
      url: `/api/acesso/gestao/perfis/${r.json().id}/revogar`,
      headers: spdata(gestor),
      payload: { motivo: 'fim do chamado 42', senha: SENHA },
    });
    expect(rev.statusCode).toBe(200);
    const revogada = (
      await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO',
        headers: spdata(gestor),
      })
    ).json().concessoes[0];
    expect(revogada).toMatchObject({ vigente: false, revogadoMotivo: 'fim do chamado 42' });
    expect(revogada.revogadoPor).toBeTruthy();
    const s2 = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: spdata(alvo) })).json(),
    );
    expect(s2.permissoes).not.toContain('config.parametro.ler');
    expect(
      trilha.eventos.some((e) => e.evento === 'acesso.perfil.concedido' && e.usuario === 'SINT.GESTOR'),
    ).toBe(true);
  });

  it('permissões do próprio legado (estado sintético): opções do grupo, papel, troca de grupo, grupo; recusas da receita', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const ops = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/operacoes', headers: spdata(n) })
    ).json();
    expect(ops).toHaveLength(13); // W1-01 4b: + renomearGrupo e excluirGrupo.
    expect(ops.every((o: { ligada: boolean }) => o.ligada)).toBe(true);
    const leg = (operacao: string, entrada: unknown, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: `/api/acesso/gestao/legado/${operacao}`,
        headers: spdata(n),
        payload: { entrada, senha },
      });
    expect((await leg('acesso.criarGrupo', { nome: 'SINT_NOVO' })).statusCode).toBe(200);
    const dup = await leg('acesso.criarGrupo', { nome: 'sint_novo' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('grupo-existente');
    expect((await leg('acesso.concederOpcoesGrupo', { grupo: 'SINT_NOVO', opcoes: [5429] })).statusCode).toBe(
      200,
    );
    expect(estadoAcessoSintetico().opcoesGrupo.get('SINT_NOVO')?.has(5429)).toBe(true);
    const troca = await leg('acesso.trocarGrupoUsuario', { login: 'SINT.AUDITOR', grupo: 'SINT_NOVO' });
    expect(troca.json()).toMatchObject({ invalidado: 'usuario' });
    const ef = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/usuarios/SINT.AUDITOR', headers: spdata(n) })
    ).json();
    expect(ef.usuario.grupo).toBe('SINT_NOVO');
    expect(
      ef.permissoes.find((p: { codigo: string }) => p.codigo === 'acesso.grupo.ler')?.origens,
    ).toContainEqual({
      tipo: 'grupo',
      grupo: 'SINT_NOVO',
      opcao: 5429,
    });
    expect((await leg('acesso.desativarGrupo', { nome: 'SINT_NOVO' })).json().codigo).toBe(
      'grupo-com-usuarios',
    );
    expect((await leg('acesso.concederPapelUsuario', { login: 'SINT.GESTOR', papel: 3 })).json().codigo).toBe(
      'a-si-mesmo',
    );
    expect((await leg('acesso.concederPapelUsuario', { login: 'SINT.AUDITOR', papel: 3 })).statusCode).toBe(
      200,
    );
    expect((await leg('acesso.revogarPapelUsuario', { login: 'SINT.AUDITOR', papel: 3 })).statusCode).toBe(
      200,
    );
    // W1-01 (parte 4b): o grupo usado não se renomeia nem se exclui (quantos e quais; oferece inativar); o nunca
    // usado se renomeia (sem colisão) e se exclui com motivo.
    for (const [op, entrada] of [
      ['acesso.renomearGrupo', { nome: 'SINT_NOVO', novoNome: 'SINT_NOVO2' }],
      ['acesso.excluirGrupo', { nome: 'SINT_NOVO', motivo: 'engano' }],
    ] as const) {
      const r = await leg(op, entrada);
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('com-dependentes');
    }
    expect((await leg('acesso.criarGrupo', { nome: 'SINT_VAZIO' })).statusCode).toBe(200);
    expect(
      (await leg('acesso.renomearGrupo', { nome: 'SINT_VAZIO', novoNome: 'sint_novo' })).json().codigo,
    ).toBe('grupo-existente');
    expect(
      (await leg('acesso.renomearGrupo', { nome: 'SINT_VAZIO', novoNome: 'SINT_VAZIO2' })).statusCode,
    ).toBe(200);
    expect(estadoAcessoSintetico().grupos.has('SINT_VAZIO')).toBe(false);
    expect((await leg('acesso.excluirGrupo', { nome: 'SINT_VAZIO2' })).statusCode).toBe(400);
    expect(
      (await leg('acesso.excluirGrupo', { nome: 'SINT_VAZIO2', motivo: 'criado por engano' })).statusCode,
    ).toBe(200);
    expect(estadoAcessoSintetico().grupos.has('SINT_VAZIO2')).toBe(false);
    // Revisão (achado 3): a campanha de recertificação por grupo é dependente (nome no ALVO).
    expect((await leg('acesso.criarGrupo', { nome: 'SINT_CAMP' })).statusCode).toBe(200);
    estadoAcessoSintetico().recert.abrir({
      hospital: 'aa',
      escopo: 'grupo',
      alvo: 'SINT_CAMP',
      prazo: '2999-12-31',
      motivo: 'recertificação do grupo de teste',
      por: 'SINT.GESTOR',
      hoje: '2026-11-19',
      itens: [{ login: 'SINT.USUARIO', grupo: 'SINT_CAMP', perfis: [] }],
    });
    const comCampanha = await leg('acesso.excluirGrupo', { nome: 'SINT_CAMP', motivo: 'criado por engano' });
    expect(comCampanha.statusCode).toBe(409);
    expect(comCampanha.json().codigo).toBe('com-dependentes');
    expect(
      (await leg('acesso.renomearGrupo', { nome: 'SINT_CAMP', novoNome: 'SINT_CAMP2' })).json().codigo,
    ).toBe('com-dependentes');
    expect(estadoAcessoSintetico().grupos.has('SINT_CAMP')).toBe(true);
    expect((await leg('acesso.criarGrupo', { nome: 'X' }, 'errada')).statusCode).toBe(401);
    const sem = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/legado/acesso.criarGrupo',
      headers: { ...spdata(n), 'idempotency-key': '' },
      payload: { entrada: { nome: 'Y' }, senha: SENHA },
    });
    expect(sem.statusCode).toBe(400);
    expect((await leg('acesso.naoExiste', {})).statusCode).toBe(404);
  });

  it('W1-01 (parte 4c): descrição do grupo por versão, com senha e motivo; acompanha o renomear e sai com a exclusão', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const leg = (operacao: string, entrada: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/acesso/gestao/legado/${operacao}`,
        headers: spdata(n),
        payload: { entrada, senha: SENHA },
      });
    const descrever = (grupo: string, descricao: string, motivo = 'organização', senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/grupos/descricao',
        headers: spdata(n),
        payload: { grupo, descricao, motivo, senha },
      });
    const versoes = async (grupo: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/acesso/gestao/grupos/${grupo}/descricoes`,
          headers: spdata(n),
        })
      ).json() as {
        versao: number;
        descricao: string;
        situacao: string;
        motivo: string;
        criadoPor: string;
      }[];
    expect((await leg('acesso.criarGrupo', { nome: 'SINT_DESCR' })).statusCode).toBe(200);
    const v1 = await descrever('SINT_DESCR', 'Recepção do pronto-socorro');
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ versao: 1, anterior: null, operacao: 'acesso.descreverGrupo' });
    expect((await descrever('SINT_DESCR', 'Recepção do pronto-socorro')).json().codigo).toBe('sem-mudanca');
    expect((await descrever('SINT_DESCR', 'Recepção e triagem')).json()).toMatchObject({
      versao: 2,
      anterior: 1,
    });
    expect((await descrever('SINT_DESCR', 'Outra', ' ')).statusCode).toBe(400);
    expect((await descrever('SINT_DESCR', 'Outra coisa', 'motivo', 'errada')).statusCode).toBe(401);
    expect((await descrever('SINT_NAO_EXISTE', 'Qualquer')).statusCode).toBe(404);
    // A versão anterior continua visível, com quem e o motivo.
    expect(
      (await versoes('SINT_DESCR')).map((v) => [v.versao, v.descricao, v.situacao, v.criadoPor]),
    ).toEqual([
      [2, 'Recepção e triagem', 'vigente', 'SINT.GESTOR'],
      [1, 'Recepção do pronto-socorro', 'substituida', 'SINT.GESTOR'],
    ]);
    // Renomear leva as versões ao nome novo; excluir retira a vigente (nada se apaga).
    expect(
      (await leg('acesso.renomearGrupo', { nome: 'SINT_DESCR', novoNome: 'SINT_DESCR2' })).statusCode,
    ).toBe(200);
    expect(await versoes('SINT_DESCR')).toEqual([]);
    expect((await versoes('SINT_DESCR2')).map((v) => v.versao)).toEqual([2, 1]);
    expect(
      (await leg('acesso.excluirGrupo', { nome: 'SINT_DESCR2', motivo: 'criado por engano' })).statusCode,
    ).toBe(200);
    expect((await versoes('SINT_DESCR2')).map((v) => v.situacao)).toEqual(['retirada', 'substituida']);
  });

  it('W1-01 (parte 5): política de senha por versão com vigência (senha e motivo), agendar e cancelar; trilha sem senha; a efetiva aperta a da sessão', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const regras = {
      minimoCaracteres: 12,
      exigeEspecial: true,
      exigeMinuscula: true,
      exigeMaiuscula: false,
      trocaDias: 60,
      reusoDias: 365,
      recusaNome: true,
      recusaNascimento: true,
      recusaComuns: true,
      senhasProibidas: ['Redesante'],
    };
    const publicar = (extra: Record<string, unknown> = {}, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/politica-senha',
        headers: spdata(n),
        payload: {
          ...regras,
          vigenteDesde: new Date().toISOString(),
          motivo: 'auditoria SBIS',
          senha,
          ...extra,
        },
      });
    const tela = async () =>
      (
        await app.inject({ method: 'GET', url: '/api/acesso/gestao/politica-senha', headers: spdata(n) })
      ).json() as {
        efetiva: { minimoCaracteres: number; recusaComuns: boolean; trocaDias: number };
        legado: { minimoCaracteres: number | null };
        versoes: {
          versao: number;
          estado: string;
          minimoCaracteres: number;
          motivoCancelamento: string | null;
        }[];
      };
    const antes = trilha.eventos.length;
    expect((await tela()).versoes).toEqual([]);
    expect((await publicar({}, 'errada')).statusCode).toBe(401);
    expect((await publicar({ minimoCaracteres: 6 })).statusCode).toBe(400);
    expect((await publicar({ motivo: ' ' })).statusCode).toBe(400);
    const v1 = await publicar();
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ versao: 1, anterior: null, operacao: 'acesso.publicarPoliticaSenha' });
    expect((await publicar()).json().codigo).toBe('sem-mudanca');
    expect((await publicar({ vigenteDesde: '2020-01-01T00:00:00Z' })).json().codigo).toBe(
      'vigencia-no-passado',
    );
    // Agendada para daqui a 10 dias: a 1 continua em vigor.
    const futura = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const v2 = await publicar({ minimoCaracteres: 14, vigenteDesde: futura });
    expect(v2.json()).toMatchObject({ versao: 2, anterior: 1, diferenca: ['MINIMO_CARACTERES: 12 -> 14'] });
    let t = await tela();
    expect(t.versoes.map((v) => [v.versao, v.estado])).toEqual([
      [2, 'agendada'],
      [1, 'em-vigor'],
    ]);
    expect(t.efetiva).toMatchObject({ minimoCaracteres: 12, recusaComuns: true, trocaDias: 60 });
    // A sessão (troca de senha) já lê a política nova (o cache da política foi esquecido na publicação).
    expect((await new FonteAcessoSintetica(env).configLogin()).sante).toMatchObject({
      versao: 1,
      minimoCaracteres: 12,
    });
    // Cancelar a agendada (com motivo e senha); a em vigor não se cancela.
    const cancelar = (versao: number, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: `/api/acesso/gestao/politica-senha/${versao}/cancelar`,
        headers: spdata(n),
        payload: { motivo: 'agendada por engano', senha },
      });
    expect((await cancelar(2, 'errada')).statusCode).toBe(401);
    expect((await cancelar(2)).json()).toMatchObject({ versao: 2, operacao: 'acesso.cancelarPoliticaSenha' });
    expect((await cancelar(1)).json().codigo).toBe('ja-em-vigor');
    expect((await cancelar(9)).json().codigo).toBe('nao-encontrado');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/acesso/gestao/politica-senha/abc/cancelar',
          headers: spdata(n),
          payload: { motivo: 'x', senha: SENHA },
        })
      ).statusCode,
    ).toBe(400);
    t = await tela();
    expect(t.versoes.map((v) => [v.versao, v.estado, v.motivoCancelamento])).toEqual([
      [2, 'cancelada', 'agendada por engano'],
      [1, 'em-vigor', null],
    ]);
    // Trilha: quem e o evento; nenhuma senha digitada aparece (nem a do gestor, nem a errada).
    const eventos = trilha.eventos.slice(antes);
    expect(eventos.map((e) => e.evento)).toEqual(
      expect.arrayContaining(['acesso.politica-senha.publicada', 'acesso.politica-senha.cancelada']),
    );
    expect(
      eventos
        .filter((e) => e.evento.startsWith('acesso.politica-senha'))
        .every((e) => e.usuario === 'SINT.GESTOR'),
    ).toBe(true);
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain('errada');
  });

  it('W1-01 (parte 8): limite de sessões por perfil: incluir, alterar e retirar (senha e motivo), cada mudança é linha nova; a sessão lê o limite', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const definir = (extra: Record<string, unknown>, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/limites-sessao',
        headers: spdata(n),
        payload: { perfil: '*', limite: 3, motivo: 'estações compartilhadas', senha, ...extra },
      });
    const tela = async () =>
      (
        await app.inject({ method: 'GET', url: '/api/acesso/gestao/limites-sessao', headers: spdata(n) })
      ).json() as {
        vigentes: { perfil: string; limite: number }[];
        historico: { perfil: string; limite: number | null; situacao: string; criadoPor: string }[];
        perfis: string[];
      };
    const antes = trilha.eventos.length;
    const t0 = await tela();
    expect(t0.vigentes).toEqual([]);
    expect(t0.perfis.length).toBeGreaterThan(0);
    const perfil = t0.perfis[0]!;
    expect((await definir({}, 'errada')).statusCode).toBe(401);
    expect((await definir({ limite: 0 })).statusCode).toBe(400);
    expect((await definir({ perfil: 'nao-existe' })).statusCode).toBe(400);
    expect((await definir({ motivo: ' ' })).statusCode).toBe(400);
    expect((await definir({ limite: null })).json().codigo).toBe('sem-limite');
    expect((await definir({})).json()).toMatchObject({
      anterior: null,
      limite: 3,
      operacao: 'acesso.definirLimiteSessao',
    });
    expect((await definir({})).json().codigo).toBe('sem-mudanca');
    expect((await definir({ perfil, limite: 1 })).statusCode).toBe(200);
    expect((await definir({ limite: 2 })).json()).toMatchObject({ anterior: 3, limite: 2 });
    expect((await definir({ perfil, limite: null, motivo: 'sem necessidade' })).json()).toMatchObject({
      anterior: 1,
      limite: null,
    });
    const t = await tela();
    expect(t.vigentes).toEqual([{ perfil: '*', limite: 2 }]);
    expect(t.historico.map((x) => [x.perfil, x.limite, x.situacao])).toEqual([
      [perfil, null, 'retirado'],
      ['*', 2, 'vigente'],
      [perfil, 1, 'vigente'],
      ['*', 3, 'vigente'],
    ]);
    expect(t.historico.every((x) => x.criadoPor === 'SINT.GESTOR')).toBe(true);
    // A sessão lê o limite em vigor (o cache da política foi esquecido na gravação).
    expect((await new FonteAcessoSintetica(env).configLogin()).limitesSessao).toEqual({ '*': 2 });
    const eventos = trilha.eventos.slice(antes).filter((e) => e.evento === 'acesso.limite-sessao.definido');
    expect(eventos).toHaveLength(4);
    expect(JSON.stringify(eventos)).not.toContain(SENHA);
    // Volta ao estado sem limite para os outros testes.
    expect((await definir({ limite: null, motivo: 'fim do teste' })).statusCode).toBe(200);
  });

  it('decisão 17 pelo caminho indireto: nem o próprio grupo, nem o próprio papel, nem o mapa do próprio grupo ou perfil', async () => {
    const n = await entrarSpdata('SINT.GESTOR');
    const conta = estadoAcessoSintetico().contas.get('SINT.GESTOR');
    if (!conta) throw new Error('conta sintética ausente');
    const grupoAntes = conta.grupo;
    conta.grupo = 'MEDICOS';
    try {
      const leg = (operacao: string, entrada: unknown) =>
        app.inject({
          method: 'POST',
          url: `/api/acesso/gestao/legado/${operacao}`,
          headers: spdata(n),
          payload: { entrada, senha: SENHA },
        });
      const decidir = (chave: unknown) =>
        app.inject({
          method: 'POST',
          url: '/api/acesso/gestao/mapa/decidir',
          headers: spdata(n),
          payload: { chave, situacao: 'aprovada', senha: SENHA },
        });
      const g = await leg('acesso.concederOpcoesGrupo', { grupo: 'MEDICOS', opcoes: [5429] });
      expect(g.statusCode).toBe(409);
      expect(g.json().codigo).toBe('a-si-mesmo');
      // Papel 0 (gestor-acessos): ativo no operador.
      const pa = await leg('acesso.concederOpcoesPapel', { papel: 0, opcoes: [5435] });
      expect(pa.json().codigo).toBe('a-si-mesmo');
      expect(estadoAcessoSintetico().opcoesPapel.get(0)?.has(5435)).toBe(false);
      const m = await decidir({ tipo: 'grupo-perfil', grupo: 'MEDICOS', perfil: 'administrador-sistema' });
      expect(m.statusCode).toBe(409);
      expect(m.json().codigo).toBe('a-si-mesmo');
      const pp = await decidir({
        tipo: 'perfil-permissao',
        perfil: 'gestor-acessos',
        permissao: [...CATALOGO_COMPLETO.filter((p) => p.concessaoPorPerfil !== null)][0]?.codigo,
      });
      expect(pp.statusCode).toBe(409);
      expect(pp.json().codigo).toBe('a-si-mesmo');
      expect(
        estadoAcessoSintetico().mapa.some((l) => l.grupo === 'MEDICOS' && l.situacao === 'aprovada'),
      ).toBe(false);
    } finally {
      conta.grupo = grupoAntes;
    }
  });

  it('invalidação por usuário sem corrida: o cálculo que leu antes da revogação não volta ao cache', async () => {
    let agora = 2_000_000;
    const fonte = new FonteAcessoSintetica(envTeste);
    let pausa: (() => void) | null = null;
    let lido: (() => void) | null = null;
    const lendo = new Promise<void>((r) => (lido = r));
    const original = fonte.dadosDeAutorizacao.bind(fonte);
    fonte.dadosDeAutorizacao = async (...args: Parameters<typeof original>) => {
      const d = await original(...args);
      if (lido) {
        lido();
        lido = null;
        await new Promise<void>((r) => (pausa = r));
      }
      return d;
    };
    const a = new ServicoAutorizacao(fonte, new ArmazemMemoria(() => agora), () => agora);
    estadoAcessoSintetico().opcoesGrupo.get('ATENDIMENTO')?.add(5429);
    // A leitura do legado acontece com a opção ainda concedida…
    const emCurso = a.obter(REDE, 'aa', 'SINT.RECEPCAO');
    await lendo;
    // …a revogação grava e invalida o usuário antes de o cálculo gravar o cache.
    estadoAcessoSintetico().opcoesGrupo.get('ATENDIMENTO')?.delete(5429);
    await a.invalidar(REDE, 'aa', 'SINT.RECEPCAO');
    (pausa as (() => void) | null)?.();
    expect((await emCurso).permissoes).toContain('acesso.grupo.ler');
    agora += 1_000;
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).not.toContain('acesso.grupo.ler');
  });

  it('invalidar o cache do usuário e do estabelecimento (ServicoAutorizacao: geração no armazém)', async () => {
    let agora = 1_000_000;
    const a = new ServicoAutorizacao(
      new FonteAcessoSintetica(envTeste),
      new ArmazemMemoria(() => agora),
      () => agora,
    );
    const p1 = await a.obter(REDE, 'aa', 'SINT.RECEPCAO');
    estadoAcessoSintetico().opcoesGrupo.get('ATENDIMENTO')?.add(5429);
    // Dentro dos 3 min, o cache vale…
    agora += 1_000;
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).toEqual(p1.permissoes);
    // …até a invalidação do estabelecimento (nova geração): a próxima leitura vai ao legado.
    await a.invalidarEstabelecimento(REDE, 'aa');
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).toContain('acesso.grupo.ler');
    estadoAcessoSintetico().opcoesGrupo.get('ATENDIMENTO')?.delete(5429);
    await a.invalidar(REDE, 'aa', 'SINT.RECEPCAO');
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).not.toContain('acesso.grupo.ler');
  });
});
