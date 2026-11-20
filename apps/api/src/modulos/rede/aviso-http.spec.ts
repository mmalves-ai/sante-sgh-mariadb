// M57.2 pela HTTP, com a sessão real sobre a fonte sintética e a porta do MPI EM MEMÓRIA (dois bancos SINTÉTICOS, o
// estabelecimento da sessão e o `sx`): o aviso do cabeçalho do paciente (só contagens e datas; trilha `rede.aviso.lido`
// sem dado de paciente), a permissão `rede.mpiAviso.ler`, e o acesso cruzado recusado enquanto a regra da DP-42 não
// estiver registrada (chave `rede.acessoCruzado` desligada também na sessão sintética: 403 com o motivo, nada lido).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { PortaRedeMemoria } from './porta-memoria.js';
import { RedeMpiController } from './rede.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const config = lerConfiguracao(env);
const porta = new PortaRedeMemoria({
  rede: config.rede ?? 'rede-sintetica',
  estabelecimentos: [
    { codigo: 'aa', nome: 'Estabelecimento sintético A' },
    { codigo: 'sx', nome: 'Estabelecimento sintético B' },
  ],
});
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(config, null, env, { trilha, rede: porta });
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m57-2-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });

describe('aviso de atendimentos em outro estabelecimento (M57.2)', () => {
  it('sem vínculo: sem-vinculo; depois do pareamento: só contagens e datas do outro; trilha sem dado', async () => {
    const g = await entrar('SINT.GESTORCAD');
    expect((await get(g, '/api/rede/mpi/pacientes/1/aviso')).json().situacao).toBe('sem-vinculo');
    const c = await app.inject({
      method: 'POST',
      url: '/api/rede/mpi/pareamento',
      headers: h(g),
      payload: {},
    });
    expect(c.statusCode).toBe(200);
    const m = await entrar('SINT.MEDICO');
    const r = await get(m, '/api/rede/mpi/pacientes/1/aviso');
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a.situacao).toBe('com-atendimentos');
    expect(a.estabelecimentos).toEqual([
      {
        estabelecimento: 'sx',
        estabelecimentoNome: 'Estabelecimento sintético B',
        idRemoto: 101,
        disponivel: true,
        atendimentos: 3,
        ultimoAtendimento: '2026-09-14',
        internacoes: 1,
        ultimaInternacao: '2026-08-02',
        podeAbrir: false,
      },
    ]);
    // A regra da DP-42 não está registrada: o motivo, sem botão de abrir.
    expect(a.acessoCruzado.pode).toBe(false);
    expect(a.acessoCruzado.motivo).toBeTruthy();
    const ev = trilha.eventos.filter((e) => e.evento === 'rede.aviso.lido').at(-1);
    expect(ev).toMatchObject({
      paciente: 1,
      chaveNaturalAlvo: 'aviso:com-atendimentos;n:1',
      usuario: 'SINT.MEDICO',
    });
  });

  it('quem não tem a permissão do aviso: 403', async () => {
    const s = await entrar('SINT.RH');
    expect((await get(s, '/api/rede/mpi/pacientes/1/aviso')).statusCode).toBe(403);
  });
});

describe('acesso cruzado ao prontuário (M57.2, regra 6)', () => {
  it('sem a regra da DP-42: 403 recurso-desligado com o motivo, nada lido; corpo inválido: 400', async () => {
    const m = await entrar('SINT.MEDICO');
    const url = '/api/pep/rede/paciente/1/estabelecimentos/sx/linha-do-tempo';
    const ruim = await app.inject({ method: 'POST', url, headers: h(m), payload: { motivo: 'curiosidade' } });
    expect(ruim.statusCode).toBe(400);
    const antes = trilha.eventos.filter((e) => e.evento === 'pep.prontuarioRede.lido').length;
    const r = await app.inject({
      method: 'POST',
      url,
      headers: h(m),
      payload: { motivo: 'assistencia', justificativa: 'Paciente em atendimento aqui' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('recurso-desligado');
    expect(trilha.eventos.filter((e) => e.evento === 'pep.prontuarioRede.lido').length).toBe(antes);
    const s = await entrar('SINT.RH');
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: h(s),
          payload: { motivo: 'assistencia', justificativa: 'Paciente em atendimento aqui' },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('aviso e o vínculo assistencial do M15 (correção do M57.2)', () => {
  // Pelo controlador, com a sessão montada à mão: a restrição por vínculo do estabelecimento ligada e o vínculo
  // SINTÉTICO só do paciente 1.
  function montar() {
    const t = new RegistradorTrilhaMemoria();
    const p = new PortaRedeMemoria({
      rede: 'rede-teste',
      estabelecimentos: [
        { codigo: 'aa', nome: 'Estabelecimento sintético A' },
        { codigo: 'sx', nome: 'Estabelecimento sintético B' },
      ],
    });
    const ctrl = new RedeMpiController(
      p,
      t,
      fonteConfiguracaoMemoria(t, {
        chavesIniciais: chavesIniciaisSinteticas,
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      }),
      null,
      new VinculoSintetico([{ login: 'SINT.MEDICO', idPaciente: 1, forma: 'equipe' }]),
      null,
    );
    const permissoes = ['rede.mpiAviso.ler'];
    const req = () =>
      ({
        headers: {},
        ip: '127.0.0.1',
        sgh: {
          real: false,
          permissao: 'rede.mpiAviso.ler',
          ability: criarAbility(regrasDeAcesso(permissoes, null)),
          sessao: {
            usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
            rede: 'rede-teste',
            estabelecimentos: [],
            estabelecimentoAtivo: 'aa',
            unidadeAtiva: null,
            permissoes,
            restricaoVinculo: true,
            sintetica: true,
            bloqueioInatividadeSegundos: 0,
            expiraEm: '',
          },
        },
      }) as unknown as RequisicaoAutorizada;
    return { ctrl, t, req, p };
  }

  it('com a restrição ligada e sem vínculo com o paciente: 403 sem-vinculo, nada lido, a negação na trilha', async () => {
    const m = montar();
    let lidas = 0;
    const vinculos = m.p.vinculosDoCadastro.bind(m.p);
    m.p.vinculosDoCadastro = async (c, id) => {
      lidas++;
      return vinculos(c, id);
    };
    const r = await m.ctrl.aviso('2', m.req()).then(
      () => 'aceito',
      (e: unknown) => (e instanceof ErroProblema ? `${e.getStatus()}:${e.tipo}` : 'outro'),
    );
    expect(r).toBe('403:sem-vinculo');
    expect(lidas).toBe(0);
    expect(m.t.eventos.at(-1)).toMatchObject({
      evento: 'acesso.permissao.negada',
      paciente: 2,
      resultado: 'falha',
    });
  });

  it('com vínculo com o paciente: o aviso lê o índice e responde (sem pareamento: sem-vinculo da rede)', async () => {
    const m = montar();
    const a = await m.ctrl.aviso('1', m.req());
    expect(a.situacao).toBe('sem-vinculo');
    expect(m.t.eventos.some((e) => e.evento === 'acesso.permissao.negada')).toBe(false);
  });
});
