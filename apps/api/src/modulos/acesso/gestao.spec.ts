// ADR 0022 pela HTTP, sobre a fonte SINTÉTICA (nenhuma conexão real, nenhum dado de pessoa), com a tela num módulo
// de teste: "Perfis e permissões" (efetivas com a origem, perfil concedido e revogado, mapa aprovado muda as
// efetivas, operações da conta e recusa das de grupo, política de senha e limites, cache invalidado na hora).
// O acesso total da plataforma é provado no módulo suporte (a partida antiga que o montava sai na desmontagem).
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaSessao } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ServicoAutorizacao } from '../../autorizacao/servico-autorizacao.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import {
  estadoAcessoSintetico,
  FonteAcessoSintetica,
  reiniciarEstadoAcessoSintetico,
} from './fonte-sintetica.js';
import { FONTE_GESTAO, fonteGestaoMemoria } from './gestao-fonte.js';
import { GestaoAcessoController } from './gestao.controller.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'gestao_teste',
};
const trilha = new RegistradorTrilhaMemoria();
const armazem = new ArmazemMemoria();
let app: NestFastifyApplication;
let chave = 0;

/** O módulo do teste: a tela de gestão sobre a fonte de memória (estado sintético). */
@Module({})
class GestaoTeste {}

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    armazem,
    registro: {
      gestao_teste: async () => ({
        modulo: (ctx) => ({
          module: GestaoTeste,
          controllers: [GestaoAcessoController],
          providers: [{ provide: FONTE_GESTAO, useValue: fonteGestaoMemoria(ctx.trilha) }],
        }),
      }),
    },
  });
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
const cabecalhos = (n: Navegador) => ({
  cookie: cookie(n),
  'x-csrf': n.cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-gestao-${++chave}-${Date.now()}`,
});

async function entrarConta(login: string): Promise<Navegador> {
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

describe('Perfis e permissões (ADR 0022)', () => {
  it('sem acesso.perfil.gerir: 403 (a recepção não administra acessos)', async () => {
    const n = await entrarConta('SINT.RECEPCAO');
    const r = await app.inject({ method: 'GET', url: '/api/acesso/gestao/mapa', headers: cabecalhos(n) });
    expect(r.statusCode).toBe(403);
  });

  it('efetivas com a origem; aprovar o mapa grupo → perfil muda as permissões efetivas de todo o grupo', async () => {
    const n = await entrarConta('SINT.GESTOR');
    const antes = await app.inject({
      method: 'GET',
      url: '/api/acesso/gestao/usuarios/SINT.MEDICO',
      headers: cabecalhos(n),
    });
    expect(antes.statusCode).toBe(200);
    const a = antes.json();
    expect(a.permissoes.some((p: { codigo: string }) => p.codigo === 'config.schema.ler')).toBe(false);
    const doGrupo = a.permissoes.find((p: { origens: { tipo: string }[] }) =>
      p.origens.some((o) => o.tipo === 'grupo'),
    );
    expect(doGrupo.origens[0]).toMatchObject({ tipo: 'grupo', grupo: 'MEDICOS' });
    const mapa = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/mapa', headers: cabecalhos(n) })
    ).json();
    expect(
      mapa.grupoPerfil.some(
        (l: { grupo: string; situacao: string }) => l.grupo === 'MEDICOS' && l.situacao === 'proposta',
      ),
    ).toBe(true);
    const decidir = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/decidir',
      headers: cabecalhos(n),
      payload: {
        chave: { tipo: 'grupo-perfil', grupo: 'MEDICOS', perfil: 'administrador-sistema' },
        situacao: 'aprovada',
        senha: SENHA,
      },
    });
    expect(decidir.statusCode).toBe(200);
    expect(decidir.json()).toMatchObject({ invalidado: 'estabelecimento', destino: 'memoria' });
    const depois = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/usuarios/SINT.MEDICO', headers: cabecalhos(n) })
    ).json();
    const schema = depois.permissoes.find((p: { codigo: string }) => p.codigo === 'config.schema.ler');
    expect(schema.origens).toEqual([{ tipo: 'perfil', perfil: 'administrador-sistema', via: 'grupo' }]);
    expect(depois.perfis).toContainEqual({ perfil: 'administrador-sistema', origens: ['grupo'] });
    // Recusar volta atrás.
    await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/decidir',
      headers: cabecalhos(n),
      payload: {
        chave: { tipo: 'grupo-perfil', grupo: 'MEDICOS', perfil: 'administrador-sistema' },
        situacao: 'recusada',
        motivo: 'revisão da área médica',
        senha: SENHA,
      },
    });
    const recusado = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/usuarios/SINT.MEDICO', headers: cabecalhos(n) })
    ).json();
    expect(recusado.permissoes.some((p: { codigo: string }) => p.codigo === 'config.schema.ler')).toBe(false);
  });

  it('concede e revoga perfil (início, fim, motivo); a si mesmo e sem a senha, recusados; a sessão do afetado vê na hora', async () => {
    const gestor = await entrarConta('SINT.GESTOR');
    const alvo = await entrarConta('SINT.RECEPCAO');
    const s0 = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: cabecalhos(alvo) })).json(),
    );
    expect(s0.permissoes).not.toContain('config.parametro.ler');
    const semSenha = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: cabecalhos(gestor),
      payload: { login: 'SINT.RECEPCAO', perfil: 'administrador-sistema', motivo: 'teste', senha: 'errada' },
    });
    expect(semSenha.statusCode).toBe(401);
    const aSi = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: cabecalhos(gestor),
      payload: { login: 'SINT.GESTOR', perfil: 'auditor', motivo: 'teste', senha: SENHA },
    });
    expect(aSi.statusCode).toBe(409);
    const r = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: cabecalhos(gestor),
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
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: cabecalhos(alvo) })).json(),
    );
    expect(s1.permissoes).toContain('config.parametro.ler');
    const ef = (
      await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO',
        headers: cabecalhos(gestor),
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
      headers: cabecalhos(gestor),
      payload: { senha: SENHA },
    });
    expect(semMotivo.statusCode).toBe(400);
    const rev = await app.inject({
      method: 'POST',
      url: `/api/acesso/gestao/perfis/${r.json().id}/revogar`,
      headers: cabecalhos(gestor),
      payload: { motivo: 'fim do chamado 42', senha: SENHA },
    });
    expect(rev.statusCode).toBe(200);
    const revogada = (
      await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO',
        headers: cabecalhos(gestor),
      })
    ).json().concessoes[0];
    expect(revogada).toMatchObject({ vigente: false, revogadoMotivo: 'fim do chamado 42' });
    expect(revogada.revogadoPor).toBeTruthy();
    const s2 = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: cabecalhos(alvo) })).json(),
    );
    expect(s2.permissoes).not.toContain('config.parametro.ler');
    expect(
      trilha.eventos.some((e) => e.evento === 'acesso.perfil.concedido' && e.usuario === 'SINT.GESTOR'),
    ).toBe(true);
  });

  it('operações da conta (estado sintético): papel de segurança pela rota nova; as de grupo recusadas com o motivo', async () => {
    const n = await entrarConta('SINT.GESTOR');
    const ops = (
      await app.inject({ method: 'GET', url: '/api/acesso/gestao/operacoes', headers: cabecalhos(n) })
    ).json() as { operacao: string; ligada: boolean; motivo: string | null }[];
    const ligadas = ops.filter((o) => o.ligada).map((o) => o.operacao).sort();
    expect(ligadas).toEqual([
      'acesso.concederPapelUsuario',
      'acesso.reativarPapelUsuario',
      'acesso.revogarPapelUsuario',
    ]);
    expect(ops.find((o) => o.operacao === 'acesso.criarGrupo')?.motivo).toMatch(/não tem grupos/);
    const op = (operacao: string, entrada: unknown, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: `/api/acesso/gestao/operacoes/${operacao}`,
        headers: cabecalhos(n),
        payload: { entrada, senha },
      });
    const g = await op('acesso.criarGrupo', { nome: 'SINT_NOVO' });
    expect(g.statusCode).toBe(409);
    expect(g.json().codigo).toBe('operacao-desligada');
    expect((await op('acesso.concederPapelUsuario', { login: 'SINT.RECEPCAO', papel: 2 }, 'errada')).statusCode).toBe(401);
    const c = await op('acesso.concederPapelUsuario', { login: 'SINT.RECEPCAO', papel: 2 });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ operacao: 'acesso.concederPapelUsuario', invalidado: 'usuario', destino: 'memoria' });
    expect(estadoAcessoSintetico().contas.get('SINT.RECEPCAO')?.papeis.get(2)).toBe(true);
    const r = await op('acesso.revogarPapelUsuario', { login: 'SINT.RECEPCAO', papel: 2 });
    expect(r.statusCode).toBe(200);
    expect(estadoAcessoSintetico().contas.get('SINT.RECEPCAO')?.papeis.get(2)).toBe(false);
    expect((await op('acesso.revogarPapelUsuario', { login: 1, papel: 2 })).statusCode).toBe(400);
  });

  it('W1-01 (parte 5): política de senha por versão com vigência (senha e motivo), agendar e cancelar; trilha sem senha; a efetiva aperta a da sessão', async () => {
    const n = await entrarConta('SINT.GESTOR');
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
        headers: cabecalhos(n),
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
        await app.inject({ method: 'GET', url: '/api/acesso/gestao/politica-senha', headers: cabecalhos(n) })
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
        headers: cabecalhos(n),
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
          headers: cabecalhos(n),
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
    const n = await entrarConta('SINT.GESTOR');
    const definir = (extra: Record<string, unknown>, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/limites-sessao',
        headers: cabecalhos(n),
        payload: { perfil: '*', limite: 3, motivo: 'estações compartilhadas', senha, ...extra },
      });
    const tela = async () =>
      (
        await app.inject({ method: 'GET', url: '/api/acesso/gestao/limites-sessao', headers: cabecalhos(n) })
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

  it('decisão 17 pelo caminho indireto: nem o mapa do próprio grupo nem o do próprio perfil', async () => {
    const n = await entrarConta('SINT.GESTOR');
    const conta = estadoAcessoSintetico().contas.get('SINT.GESTOR');
    if (!conta) throw new Error('conta sintética ausente');
    const grupoAntes = conta.grupo;
    conta.grupo = 'MEDICOS';
    try {
      const decidir = (chave: unknown) =>
        app.inject({
          method: 'POST',
          url: '/api/acesso/gestao/mapa/decidir',
          headers: cabecalhos(n),
          payload: { chave, situacao: 'aprovada', senha: SENHA },
        });
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
    // A leitura da fonte acontece com a opção ainda concedida…
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
    // …até a invalidação do estabelecimento (nova geração): a próxima leitura vai à fonte.
    await a.invalidarEstabelecimento(REDE, 'aa');
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).toContain('acesso.grupo.ler');
    estadoAcessoSintetico().opcoesGrupo.get('ATENDIMENTO')?.delete(5429);
    await a.invalidar(REDE, 'aa', 'SINT.RECEPCAO');
    expect((await a.obter(REDE, 'aa', 'SINT.RECEPCAO')).permissoes).not.toContain('acesso.grupo.ler');
  });
});
