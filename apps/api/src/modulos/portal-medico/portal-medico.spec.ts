// M50, etapa 3 (portal do médico externo) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA
// (nada conecta a banco): a conta do portal do M26 aprovada; sem o vínculo com o corpo clínico, nada aparece e o pedido
// é recusado; a equipe interna liga a conta ao profissional (a sugestão pelo número e pela UF; sem a permissão, 403);
// com o vínculo, o extrato dos códigos de prestador DELE, a agenda só das cirurgias em que ele é o cirurgião (o paciente
// mascarado) e o pedido de cirurgia (CSRF do portal, recusas da conferência), que aparece no mapa do bloco como
// solicitação do portal e é retirado pelo próprio médico; a sessão do paciente e a interna não abrem estas rotas; a
// conta desligada volta a não ver nada. Dados sintéticos.
import { codigoTotp } from '@sgh/dominio-acesso';
import type { DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaCirurgiaMemoria } from '../cirurgia/porta-memoria.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import type { PortaRegistroMemoria, RegistroOuvido } from '../pep/registro-porta-memoria.js';
import { PortaSadtMemoria } from '../sadt/porta-memoria.js';
import { moduloCirurgia } from '../cirurgia/modulo.js';
import { moduloPep } from '../pep/modulo.js';
import { type CarregadorModulo, REGISTRO_MODULOS } from '../registro.js';
import { moduloRepasse } from '../repasse/modulo.js';
import { moduloSadt } from '../sadt/modulo.js';
import { moduloPortalMedico } from './modulo.js';
import { PortaPortalMedicoMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'sadt,cirurgia,repasse,pep,portal-medico,config',
};
/** Os módulos de que o portal depende ficam globais no teste (a integração da onda decide o mesmo no registro). */
const global = async (m: Promise<DynamicModule>): Promise<DynamicModule> => ({ ...(await m), global: true });
const trilha = new RegistradorTrilhaMemoria();
/** W0-10 (M4): os registros clínicos sintéticos (o vínculo assistencial pelo inscrição do profissional). */
const registrosClinicos: RegistroOuvido[] = [];
const documentos = new PortaDocumentosMemoria(trilha, {
  registrosDe: () => registrosClinicos,
  ouvinte: null,
} as unknown as PortaRegistroMemoria);
const sadt = new PortaSadtMemoria({ estado: () => 'verde' }, documentos);
const portalMedico = new PortaPortalMedicoMemoria(
  async (c, a) => (await sadt.acessoPorId(c, a))?.situacao ?? null,
  undefined,
  (c, a, x) => sadt.definirSituacaoAcesso(c, a, x),
  (c, a, x) => sadt.definirCredencialAcesso(c, a, x),
);
const cadastro = new PortaCadastroMemoria();
const cirurgia = new PortaCirurgiaMemoria(null, (c, ids) => cadastro.lerPacientes(c as never, ids));
/** Pedidos aceitos desta conta (o limite é de 10 por hora). */
let aceitos = 0;
let app: NestFastifyApplication;
let chave = 0;
const ORIGEM = '10.50.3.1';

beforeAll(async () => {
  const registro: Record<string, CarregadorModulo> = {
    sadt: async () => ({
      modulo: (ctx) => global(moduloSadt(ctx, { porta: sadt, estabelecimentos: ['aa'] })),
    }),
    cirurgia: async () => ({ modulo: (ctx) => global(moduloCirurgia(ctx, { cirurgia })) }),
    repasse: async () => ({ modulo: (ctx) => global(moduloRepasse(ctx)) }),
    pep: async () => ({ modulo: (ctx) => global(moduloPep(ctx, { documentos, cadastro })) }),
    'portal-medico': async () => ({ modulo: (ctx) => moduloPortalMedico(ctx, { porta: portalMedico }) }),
    config: REGISTRO_MODULOS['config']!,
  };
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro });
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
const cookies = (set: string[], nomeCsrf: string): Sessao => ({
  cookie: set.map((c) => c.split(';')[0]).join('; '),
  csrf:
    set
      .find((c) => c.startsWith(`${nomeCsrf}=`))
      ?.split(';')[0]
      ?.slice(nomeCsrf.length + 1) ?? '',
});
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  return cookies(r.headers['set-cookie'] as string[], 'sgh_csrf');
}
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m503-${++chave}-${Date.now()}` },
    payload: payload as object,
  });
const doPortal = {
  get: (s: Sessao, url: string) =>
    app.inject({ method: 'GET', url: `/api/portal/medico-externo${url}`, headers: { cookie: s.cookie } }),
  post: (s: Sessao, url: string, payload: unknown = {}, csrf = true) =>
    app.inject({
      method: 'POST',
      url: `/api/portal/medico-externo${url}`,
      headers: { cookie: s.cookie, ...(csrf ? { 'x-csrf-portal': s.csrf } : {}) },
      payload: payload as object,
    }),
};
const somar = (d: string, k: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
};

let segredo = '';
async function entrarMedico(): Promise<Sessao> {
  const r = await app.inject({
    remoteAddress: ORIGEM,
    method: 'POST',
    url: '/api/portal/aa/medico',
    payload: {
      conselho: 'CRM',
      uf: 'SP',
      numero: '54321',
      senha: 'senha-longa-sintetica',
      codigo: codigoTotp(segredo, Date.now()),
    },
  });
  expect(r.statusCode).toBe(200);
  return cookies(r.headers['set-cookie'] as string[], 'sgh_portal_csrf');
}

describe('portal do médico externo (M50, etapa 3)', () => {
  let medico: Sessao;
  let acesso = 0;

  beforeAll(async () => {
    const cad = await app.inject({
      remoteAddress: ORIGEM,
      method: 'POST',
      url: '/api/portal/aa/autocadastro',
      payload: {
        nome: 'Cirurgiao externo sintetico',
        conselho: 'CRM',
        uf: 'SP',
        numero: '54321',
        email: 'cirurgiao@exemplo.invalid',
        senha: 'senha-longa-sintetica',
        aceiteTermo: true,
      },
    });
    expect(cad.statusCode).toBe(200);
    segredo = new URL(cad.json().otpauth).searchParams.get('secret')!;
    const r = await entrar('SINT.RECEPCAO.SADT');
    const pendente = (await get(r, '/sadt/solicitantes/autocadastro'))
      .json()
      .find((a: { numero: string }) => a.numero === '54321');
    acesso = pendente.id;
    expect(
      (await post(r, `/sadt/solicitantes/autocadastro/${acesso}`, { decisao: 'aprovar', solicitante: 6602 }))
        .statusCode,
    ).toBe(200);
    medico = await entrarMedico();
  });

  it('sem o vínculo com o corpo clínico: nada aparece e o pedido é recusado', async () => {
    const ex = await doPortal.get(medico, '/extrato');
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toEqual({ vinculado: false, profissional: null, extrato: null, retidos: 0 });
    const ag = (await doPortal.get(medico, '/agenda')).json();
    expect(ag).toMatchObject({ vinculado: false, agendamentos: [], pedidos: [], podePedir: false });
    const p = await doPortal.post(medico, '/pedidos', {
      sala: 1,
      data: somar(new Date().toISOString().slice(0, 10), 7),
      hora: '08:00',
      duracaoMin: 90,
      procedimento: 30101271,
      convenio: 10,
      paciente: { nome: 'PACIENTE INFORMADO SINTETICO', nascimento: '1970-05-02' },
    });
    expect(p.statusCode).toBe(409);
    expect(p.json().codigo).toBe('sem-vinculo');
    // W0-10 (M4): sem o profissional ligado, nenhum paciente e nenhum prontuário.
    expect((await doPortal.get(medico, '/pacientes')).json()).toMatchObject({
      vinculado: false,
      pacientes: [],
    });
    expect((await doPortal.get(medico, '/pacientes/1001')).statusCode).toBe(403);
  });

  it('a equipe interna liga a conta ao profissional (sugestão pelo conselho; sem a permissão, 403)', async () => {
    expect((await get(await entrar('SINT.AGENDA'), '/portal-medico/contas')).statusCode).toBe(403);
    const r = await entrar('SINT.RECEPCAO.SADT');
    const contas = (await get(r, '/portal-medico/contas')).json();
    const c = contas.contas.find((x: { acesso: number }) => x.acesso === acesso);
    expect(c).toMatchObject({ profissional: null, sugestoes: [{ id: 6801, nome: 'CIRURGIAO SINTETICO A' }] });
    expect(JSON.stringify(contas)).not.toMatch(/senha|segundoFator|email/i);
    expect((await get(r, '/portal-medico/profissionais?q=OUTRA')).json()).toEqual([
      { id: 6802, nome: 'OUTRA MEDICA SINTETICA B' },
    ]);
    // Profissional inexistente: recusa do banco (sem registro).
    const x = await post(r, `/portal-medico/contas/${acesso}/vinculo`, { profissional: 9999 });
    expect(x.statusCode).toBe(409);
    expect(x.json().codigo).toBe('profissional-sem-registro');
    const ok = await post(r, `/portal-medico/contas/${acesso}/vinculo`, { profissional: 6801 });
    expect(ok.statusCode).toBe(200);
    const depois = (await get(r, '/portal-medico/contas')).json();
    expect(depois.contas.find((y: { acesso: number }) => y.acesso === acesso)).toMatchObject({
      profissional: { id: 6801, nome: 'CIRURGIAO SINTETICO A' },
      vinculadoPor: 'SINT.RECEPCAO.SADT',
    });
    // A trilha do vínculo diz qual profissional foi ligado.
    expect(
      portalMedico.trilhas
        .filter((t) => t.evento === 'portal.medico.vinculado')
        .map((t) => t.chaveNaturalAlvo),
    ).toEqual(['profissional=6801']);
  });

  it('a lista interna filtra pelo nome ou número e pela situação do vínculo, com a página', async () => {
    const r = await entrar('SINT.RECEPCAO.SADT');
    const pelo = async (qs: string) => (await get(r, `/portal-medico/contas${qs}`)).json();
    const porNumero = await pelo('?q=54321');
    expect(porNumero.contas.map((c: { acesso: number }) => c.acesso)).toEqual([acesso]);
    expect(porNumero).toMatchObject({ total: 1, pagina: 1, porPagina: 25 });
    expect((await pelo('?q=cirurgiao%20externo')).contas.map((c: { acesso: number }) => c.acesso)).toContain(
      acesso,
    );
    expect((await pelo('?q=54321&situacao=sem-vinculo')).total).toBe(0);
    expect((await pelo('?q=54321&situacao=ligadas')).total).toBe(1);
    expect((await pelo('?q=ninguem-assim')).contas).toEqual([]);
    // A página além da última volta à última; filtro inválido é recusado.
    expect((await pelo('?pagina=99')).pagina).toBe(1);
    expect((await get(r, '/portal-medico/contas?situacao=outra')).statusCode).toBe(400);
  });

  it('com o vínculo: o extrato e a agenda só dele (paciente mascarado), na trilha sem dado pessoal', async () => {
    const ex = (await doPortal.get(medico, '/extrato')).json();
    expect(ex.vinculado).toBe(true);
    expect(ex.profissional).toBe('CIRURGIAO SINTETICO A');
    expect([...ex.extrato.prestadores].sort()).toEqual([54321, 7001, 9001].sort());
    expect(ex.retidos).toBe(0);
    expect(ex.extrato.lancamentos.every((l: { prestador: number }) => l.prestador === 7001)).toBe(true);
    expect((await doPortal.get(medico, '/extrato?competencia=13-2026')).statusCode).toBe(400);
    expect((await doPortal.get(medico, '/extrato/conta?competencia=2026-06')).statusCode).toBe(200);
    const ag = (await doPortal.get(medico, '/agenda')).json();
    expect(ag.vinculado).toBe(true);
    expect(ag.podePedir).toBe(true);
    expect(ag.agendamentos.length).toBeGreaterThan(0);
    for (const a of ag.agendamentos) {
      expect(a.paciente).not.toMatch(/SINTETICO/);
      expect(a.procedimento).toBe('COLECISTECTOMIA');
    }
    expect((await doPortal.get(medico, '/agenda?de=2026-01-01&ate=2026-12-31')).statusCode).toBe(400);
    const lidos = portalMedico.trilhas.filter((t) =>
      /^portal\.medico\.(extratoLido|agendaLida)$/.test(t.evento),
    );
    expect(lidos.length).toBeGreaterThanOrEqual(3);
    expect(lidos.every((t) => t.idPaciente === null && t.usuario === `SGH.PORTAL.M${acesso}`)).toBe(true);
  });

  it('W0-10 (M4): meus pacientes só com vínculo assistencial; o outro é negado; cada acesso vai à trilha', async () => {
    // Antes de qualquer registro do profissional: a lista está vazia e o prontuário de qualquer um é negado.
    const vazia = (await doPortal.get(medico, '/pacientes')).json();
    expect(vazia).toMatchObject({ vinculado: true, profissional: 'CIRURGIAO SINTETICO A', total: 0 });
    // O registro de cirurgião dele (5001) evoluiu o paciente 1001: o vínculo assistencial.
    registrosClinicos.push({
      id: 990_001,
      paciente: 1001,
      atendimento: 0,
      modelo: 'EVOL',
      nomeModelo: 'EVOLUÇÃO',
      cbo: 5001,
      dataHoraClinica: new Date().toISOString().slice(0, 19),
      suspenso: false,
      hash: 'x',
      fluxo: null,
      login: null,
    });
    const r = await doPortal.get(medico, '/pacientes');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const lista = r.json();
    expect(lista.pacientes.map((p: { paciente: number }) => p.paciente)).toEqual([1001]);
    expect(lista.pacientes[0]).toMatchObject({ prontuario: '501001' });
    expect(lista.pacientes[0].resultadosNovos + lista.pacientes[0].criticos).toBeGreaterThanOrEqual(0);
    // O prontuário do paciente dele abre (resultados com o crítico marcado); o de outro paciente, 403.
    const pr = await doPortal.get(medico, '/pacientes/1001');
    expect(pr.statusCode).toBe(200);
    const corpo = pr.json();
    expect(corpo.paciente.paciente).toBe(1001);
    expect(corpo.resultados.length).toBeGreaterThan(0);
    expect(corpo.resultados.some((x: { critico: boolean }) => x.critico)).toBe(true);
    const negado = await doPortal.get(medico, '/pacientes/1003');
    expect(negado.statusCode).toBe(403);
    expect(negado.json().codigo).toBe('sem-vinculo-assistencial');
    expect((await doPortal.get(medico, '/pacientes/abc')).statusCode).toBe(404);
    // Trilha: a lista sem dado pessoal; o acesso remoto com o paciente, momento e responsável; o negado também.
    const acessos = portalMedico.trilhas.filter((t) => t.evento === 'portal.medico.prontuarioAcessado');
    expect(acessos.map((t) => [t.idPaciente, t.resultado])).toEqual([
      [1001, 'falha'],
      [1001, 'sucesso'],
      [1003, 'falha'],
    ]);
    expect(acessos.every((t) => t.usuario === `SGH.PORTAL.M${acesso}` && t.tabelaAlvo === 'paciente')).toBe(
      true,
    );
    const listas = portalMedico.trilhas.filter((t) => t.evento === 'portal.medico.pacientesLidos');
    expect(listas.length).toBe(2);
    expect(listas.every((t) => t.idPaciente === null)).toBe(true);
    // A sessão interna não abre a rota do portal.
    expect((await get(await entrar('SINT.AGENDA'), '/portal/medico-externo/pacientes')).statusCode).not.toBe(
      200,
    );
  });

  it('o número do conselho repetido em outro cadastro fica fora do extrato do portal, com o aviso ao hospital', async () => {
    // Outro profissional sintético com o mesmo número 7001 (o do repasse sintético), noutra UF.
    portalMedico.registrosAvulsos.push({
      id: 6899,
      nome: 'REGISTRO REPETIDO SINTETICO',
      registros: [{ id: 5199, codigo: 7001, uf: 'RJ', numero: '7001' }],
      vinculoAssistencial: [5199],
    });
    try {
      const ex = (await doPortal.get(medico, '/extrato')).json();
      expect([...ex.extrato.prestadores].sort()).toEqual([54321, 9001].sort());
      expect(ex.retidos).toBe(1);
      expect(ex.extrato.lancamentos).toEqual([]);
      const r = await entrar('SINT.RECEPCAO.SADT');
      const c = (await get(r, '/portal-medico/contas?q=54321')).json().contas[0];
      expect(c.codigosCompartilhados).toEqual([7001]);
    } finally {
      portalMedico.registrosAvulsos.length = 0;
    }
    expect((await doPortal.get(medico, '/extrato')).json().retidos).toBe(0);
  });

  it('o pedido de cirurgia: CSRF, recusas da conferência, solicitação no mapa do bloco e retirada pelo médico', async () => {
    const op = (await doPortal.get(medico, '/opcoes')).json();
    expect(op.salas.length).toBeGreaterThan(0);
    expect((await doPortal.get(medico, '/procedimentos?q=COLE')).json()).toEqual([
      { codigo: 30101271, nome: 'COLECISTECTOMIA' },
    ]);
    const data = somar(op.hoje, 9);
    const pedido = {
      sala: 2,
      data,
      hora: '14:00',
      duracaoMin: 90,
      procedimento: 30101271,
      convenio: 10,
      paciente: { nome: 'paciente   informado sintetico', nascimento: '1970-05-02' },
      observacao: 'Levar a ressonância',
    };
    expect((await doPortal.post(medico, '/pedidos', pedido, false)).statusCode).toBe(403);
    const passada = await doPortal.post(medico, '/pedidos', { ...pedido, data: op.hoje });
    expect(passada.json().codigo).toBe('data-passada');
    const semSala = await doPortal.post(medico, '/pedidos', { ...pedido, sala: 99 });
    expect(semSala.json().codigo).toBe('sala-inexistente');
    const ok = await doPortal.post(medico, '/pedidos', pedido);
    expect(ok.statusCode).toBe(201);
    aceitos++;
    const id = ok.json().id as number;
    const ag = (await doPortal.get(medico, `/agenda?de=${op.hoje}&ate=${somar(op.hoje, 30)}`)).json();
    expect(ag.pedidos).toEqual([
      expect.objectContaining({
        id,
        data,
        hora: '14:00',
        paciente: 'PACIENTE INFORMADO SINTETICO',
        nascimento: '1970-05-02',
        estado: 'solicitado',
        retiravel: true,
      }),
    ]);
    // A secretaria do bloco vê a solicitação do portal no mapa (mascarada) e o detalhe completo para localizar o cadastro.
    const bloco = await entrar('SINT.BLOCO');
    const mapa = (await get(bloco, `/cirurgia/mapa?inicio=${data}&dias=1`)).json();
    const s = mapa.solicitacoes.find((x: { estadoId: number }) => x.estadoId === id);
    expect(s.pedidoPortal).toEqual({
      medico: 'CIRURGIAO SINTETICO A',
      paciente: 'PACIENTE I. S.',
      nascimento: null,
    });
    expect(s.paciente).toBe('PACIENTE I. S.');
    const det = (await get(bloco, `/cirurgia/estados/${id}`)).json();
    expect(det.agendamento.pedidoPortal).toEqual({
      medico: 'CIRURGIAO SINTETICO A',
      paciente: 'PACIENTE INFORMADO SINTETICO',
      nascimento: '1970-05-02',
      cirurgiao: { id: 5102, cod: 54321, nome: 'CIRURGIAO SINTETICO A' },
    });
    expect(det.pacienteNome).toBe('PACIENTE INFORMADO SINTETICO');
    // W0-10: o médico altera o pedido não confirmado (versão vista e motivo); a versão anterior fica visível.
    const alt = { ...pedido, hora: '15:00', sala: 1, versao: 1, motivo: 'Paciente pediu a tarde' };
    expect((await doPortal.post(medico, `/pedidos/${id}/alteracao`, alt, false)).statusCode).toBe(403);
    expect(
      (await doPortal.post(medico, `/pedidos/${id}/alteracao`, { ...alt, motivo: 'x' })).statusCode,
    ).toBe(400);
    const passadaAlt = await doPortal.post(medico, `/pedidos/${id}/alteracao`, { ...alt, data: op.hoje });
    expect(passadaAlt.json().codigo).toBe('data-passada');
    const alterado = await doPortal.post(medico, `/pedidos/${id}/alteracao`, alt);
    expect(alterado.statusCode).toBe(200);
    expect(alterado.json().mensagem).toMatch(/versão 2/);
    const velha = await doPortal.post(medico, `/pedidos/${id}/alteracao`, { ...alt, hora: '16:00' });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('versao-desatualizada');
    expect((await doPortal.post(medico, '/pedidos/999999/alteracao', { ...alt, versao: 1 })).statusCode).toBe(
      404,
    );
    const agAlt = (await doPortal.get(medico, `/agenda?de=${op.hoje}&ate=${somar(op.hoje, 30)}`)).json();
    expect(agAlt.pedidos[0]).toMatchObject({
      id,
      hora: '15:00',
      versao: 2,
      edicao: expect.objectContaining({ sala: 1, hora: '15:00', procedimento: 30101271, convenio: 10 }),
    });
    expect(agAlt.pedidos[0].versoes).toEqual([
      expect.objectContaining({ versao: 1, hora: '14:00', motivo: 'Paciente pediu a tarde' }),
    ]);
    // O médico retira o próprio pedido; a segunda vez é recusada.
    const ret = await doPortal.post(medico, `/pedidos/${id}/retirar`, { motivo: 'Paciente remarcou' });
    expect(ret.statusCode).toBe(200);
    const de2 = await doPortal.post(medico, `/pedidos/${id}/retirar`, {});
    expect(de2.statusCode).toBe(409);
    expect(de2.json().codigo).toBe('solicitacao-encerrada');
    const depois = (await doPortal.get(medico, `/agenda?de=${op.hoje}`)).json();
    expect(depois.pedidos[0]).toMatchObject({ id, estado: 'cancelado', retiravel: false });
    expect(portalMedico.trilhas.length).toBeGreaterThan(0);
  });

  it('a secretaria confirma o pedido com o cirurgião que ainda não atuou no bloco; o estado ganha o paciente', async () => {
    const op = (await doPortal.get(medico, '/opcoes')).json();
    const data = somar(op.hoje, 12);
    const ok = await doPortal.post(medico, '/pedidos', {
      sala: 1,
      data,
      hora: '09:00',
      duracaoMin: 60,
      procedimento: 30101271,
      convenio: 10,
      paciente: { nome: 'PACIENTE CONFIRMADO SINTETICO', nascimento: '1965-03-04' },
    });
    expect(ok.statusCode).toBe(201);
    aceitos++;
    const id = ok.json().id as number;
    const bloco = await entrar('SINT.BLOCO');
    // A tela interna das contas lista o pedido em aberto, com o paciente mascarado.
    const interna = (await get(await entrar('SINT.RECEPCAO.SADT'), '/portal-medico/contas?q=54321')).json();
    expect(interna.contas[0].pedidos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          data,
          hora: '09:00',
          procedimento: 'COLECISTECTOMIA',
          paciente: 'PACIENTE C. S.',
        }),
      ]),
    );
    // O registro do conselho do cirurgião externo não está entre os profissionais do bloco: vem pelo detalhe.
    const opcoes = (await get(bloco, '/cirurgia/opcoes')).json();
    expect(opcoes.profissionais.some((p: { id: number }) => p.id === 5102)).toBe(false);
    const det = (await get(bloco, `/cirurgia/estados/${id}`)).json();
    const cir = det.agendamento.pedidoPortal.cirurgiao;
    expect(cir).toEqual({ id: 5102, cod: 54321, nome: 'CIRURGIAO SINTETICO A' });
    const conf = await post(bloco, '/cirurgia/agendamentos', {
      sala: 1,
      data,
      hora: '09:00',
      duracaoMin: 60,
      paciente: 1003,
      reg: 0,
      atendimento: 'I',
      especialidade: 33,
      convenio: 10,
      procedimento: 30101271,
      anestesia: 1,
      equipe: { cirurgiao: { id: cir.id, cod: cir.cod } },
      solicitacao: id,
    });
    expect(conf.statusCode).toBe(201);
    const e = await cirurgia.estado(
      {
        cliente: '',
        estabelecimento: null,
        usuario: null,
        correlacao: 't',
        rede: REDE,
        hospital: 'aa',
      } as never,
      id,
    );
    expect(e).toMatchObject({ estado: 'confirmado', idPaciente: 1003 });
    // W0-10: o pedido confirmado pelo bloco não se altera pelo portal (409).
    const altConf = await doPortal.post(medico, `/pedidos/${id}/alteracao`, {
      sala: 1,
      data,
      hora: '10:00',
      duracaoMin: 60,
      procedimento: 30101271,
      convenio: 10,
      paciente: { nome: 'PACIENTE CONFIRMADO SINTETICO', nascimento: '1965-03-04' },
      versao: 1,
      motivo: 'Mudar o horário',
    });
    expect(altConf.statusCode).toBe(409);
    expect(altConf.json().codigo).toBe('solicitacao-encerrada');
    // Confirmado, sai da lista dos pedidos em aberto da conta e aparece na agenda do médico.
    const depois = (await get(await entrar('SINT.RECEPCAO.SADT'), '/portal-medico/contas?q=54321')).json();
    expect(depois.contas[0].pedidos.some((x: { id: number }) => x.id === id)).toBe(false);
    const ag = (await doPortal.get(medico, `/agenda?de=${data}&ate=${data}`)).json();
    expect(
      ag.agendamentos.some((a: { data: string; hora: string }) => a.data === data && a.hora === '09:00'),
    ).toBe(true);
  });

  it('o limite de 10 pedidos por hora vale também para pedidos simultâneos', async () => {
    const op = (await doPortal.get(medico, '/opcoes')).json();
    const pedidos = Array.from({ length: 11 }, (_, k) =>
      doPortal.post(medico, '/pedidos', {
        sala: 1,
        data: somar(op.hoje, 20 + k),
        hora: '10:00',
        duracaoMin: 60,
        procedimento: 30101271,
        convenio: 10,
        paciente: { nome: 'PACIENTE SIMULTANEO SINTETICO', nascimento: '1980-01-01' },
      }),
    );
    const r = await Promise.all(pedidos);
    const ok = r.filter((x) => x.statusCode === 201).length;
    expect(ok).toBe(10 - aceitos);
    expect(r.filter((x) => x.statusCode === 429).length).toBe(11 - ok);
  });

  it('a sessão do paciente e a interna não abrem o portal do médico; a desligada volta a não ver nada', async () => {
    const r = await entrar('SINT.RECEPCAO.SADT');
    const p = await post(r, '/sadt/requisicoes/31338/protocolo');
    const pac = await app.inject({
      remoteAddress: '10.50.3.2',
      method: 'POST',
      url: '/api/portal/aa/paciente',
      payload: { protocolo: p.json().protocolo, nascimento: '1990-07-01' },
    });
    expect(pac.statusCode).toBe(200);
    const sPac = cookies(pac.headers['set-cookie'] as string[], 'sgh_portal_csrf');
    expect((await doPortal.get(sPac, '/agenda')).statusCode).toBe(403);
    expect((await doPortal.get(r, '/extrato')).statusCode).toBe(401);
    expect((await post(r, `/portal-medico/contas/${acesso}/desvinculo`)).statusCode).toBe(200);
    expect((await doPortal.get(medico, '/extrato')).json()).toMatchObject({ vinculado: false });
    expect((await post(r, `/portal-medico/contas/${acesso}/desvinculo`)).json().codigo).toBe('sem-vinculo');
    // Ligar e desligar ficam distintos na trilha, cada um com o profissional.
    const vinc = portalMedico.trilhas.filter((t) =>
      /^portal\.medico\.(vinculado|desvinculado)$/.test(t.evento),
    );
    expect(vinc.map((t) => [t.evento, t.chaveNaturalAlvo])).toEqual([
      ['portal.medico.vinculado', 'profissional=6801'],
      ['portal.medico.desvinculado', 'profissional=6801'],
    ]);
  });

  it('W0-10: o médico troca a senha e o e-mail (link no e-mail novo pelo simulador), com o ato no histórico', async () => {
    const r = await entrar('SINT.RECEPCAO.SADT');
    const codigo = () => codigoTotp(segredo, Date.now());
    const ANTIGA = 'senha-longa-sintetica';
    const NOVA = 'outra-senha-sintetica-10';
    const outra = await entrarMedico();
    // Senha: sem CSRF 403; atual errada 401; curta ou igual à confirmação diferente 400.
    expect((await doPortal.post(medico, '/conta/senha', {}, false)).statusCode).toBe(403);
    const errada = await doPortal.post(medico, '/conta/senha', {
      atual: 'errada-errada',
      nova: NOVA,
      confirmacao: NOVA,
      codigo: codigo(),
    });
    expect([errada.statusCode, errada.json().codigo]).toEqual([401, 'dados-nao-conferem']);
    expect(
      (
        await doPortal.post(medico, '/conta/senha', {
          atual: ANTIGA,
          nova: 'curta',
          confirmacao: 'curta',
          codigo: codigo(),
        })
      ).statusCode,
    ).toBe(400);
    const ok = await doPortal.post(medico, '/conta/senha', {
      atual: ANTIGA,
      nova: NOVA,
      confirmacao: NOVA,
      codigo: codigo(),
    });
    expect(ok.statusCode).toBe(200);
    // A outra sessão aberta da conta cai; a de quem trocou segue.
    expect((await doPortal.get(outra, '/agenda')).statusCode).toBe(401);
    expect((await doPortal.get(medico, '/opcoes')).statusCode).toBe(200);
    // Volta à senha antiga (os outros testes entram com ela).
    expect(
      (
        await doPortal.post(medico, '/conta/senha', {
          atual: NOVA,
          nova: ANTIGA,
          confirmacao: ANTIGA,
          codigo: codigo(),
        })
      ).statusCode,
    ).toBe(200);

    // E-mail: credenciais erradas 401; o pedido vai ao simulador e a conta segue com o antigo até a confirmação.
    expect(
      (
        await doPortal.post(medico, '/conta/email', {
          email: 'novo@exemplo.invalid',
          senha: ANTIGA,
          codigo: '000000',
        })
      ).statusCode,
    ).toBe(401);
    const pedido = await doPortal.post(medico, '/conta/email', {
      email: 'Novo.Cirurgiao@Exemplo.invalid',
      senha: ANTIGA,
      codigo: codigo(),
    });
    expect(pedido.statusCode).toBe(201);
    expect(pedido.json()).toMatchObject({ envio: 'simulador' });
    expect(pedido.json().emailMascarado).not.toContain('novo.cirurgiao');
    expect((await doPortal.get(medico, '/conta/email')).json().pendente).toMatchObject({
      envio: 'simulador',
    });
    const caixa = (await get(r, `/portal-medico/simulador/mensagens?acesso=${acesso}`)).json().mensagens;
    expect(caixa[0]).toMatchObject({ destino: 'novo.cirurgiao@exemplo.invalid', tipo: 'confirmacao-email' });
    const link = new URL(caixa[0].link as string, 'https://portal.invalid');
    expect(link.pathname).toBe('/medico-externo/email/confirmar');
    const token = link.searchParams.get('t') ?? '';
    const confirmar = (t: string) =>
      app.inject({
        method: 'POST',
        url: '/api/portal/medico-externo/email/confirmacao?h=aa',
        payload: { token: t },
      });
    expect((await confirmar('A'.repeat(43))).statusCode).toBe(410);
    const conf = await confirmar(token);
    expect(conf.statusCode).toBe(200);
    expect(conf.json().emailMascarado).toMatch(/@/);
    // O link usado não vale de novo; a confirmação encerra as sessões da conta.
    expect((await confirmar(token)).json()).toMatchObject({ status: 410, codigo: 'link-invalido' });
    expect((await doPortal.get(medico, '/opcoes')).statusCode).toBe(401);
    medico = await entrarMedico();
    expect((await doPortal.get(medico, '/conta/email')).json().pendente).toBeNull();
    // Desistir: o pedido pendente fica cancelado; cancelar de novo, 404; o link cancelado, 410.
    await doPortal.post(medico, '/conta/email', {
      email: 'terceiro@exemplo.invalid',
      senha: ANTIGA,
      codigo: codigo(),
    });
    const t3 = new URL(
      (await get(r, `/portal-medico/simulador/mensagens?acesso=${acesso}`)).json().mensagens[0]
        .link as string,
      'https://portal.invalid',
    ).searchParams.get('t');
    expect((await doPortal.post(medico, '/conta/email/cancelar')).statusCode).toBe(200);
    expect((await doPortal.post(medico, '/conta/email/cancelar')).statusCode).toBe(404);
    expect((await confirmar(t3 ?? '')).statusCode).toBe(410);
    // O histórico (fato novo, sem motivo) e a trilha sem o e-mail.
    const atos = (await get(r, `/portal-medico/contas/${acesso}/atos`)).json();
    expect(atos.map((x: { ato: string }) => x.ato)).toEqual(['troca-email', 'troca-senha', 'troca-senha']);
    const eventos = portalMedico.trilhas
      .filter((t) => /^portal\.medico\.(senhaTrocada|emailTroca|emailTrocado)/.test(t.evento))
      .map((t) => t.evento);
    expect(eventos).toEqual([
      'portal.medico.senhaTrocada',
      'portal.medico.senhaTrocada',
      'portal.medico.emailTrocaPedida',
      'portal.medico.emailTrocado',
      'portal.medico.emailTrocaPedida',
      'portal.medico.emailTrocaPedida',
    ]);
    expect(JSON.stringify(portalMedico.trilhas)).not.toContain('exemplo.invalid');
  });

  it('W0-10: bloquear, desbloquear e encerrar a conta, com motivo, senha e a decisão sobre os pedidos pendentes', async () => {
    const r = await entrar('SINT.RECEPCAO.SADT');
    const url = `/portal-medico/contas/${acesso}/ato`;
    // Sem a permissão: 403; sem a senha (sessão real): 401; motivo curto: 400.
    expect(
      (await post(await entrar('SINT.AGENDA'), url, { ato: 'bloqueio', motivo: 'Teste' })).statusCode,
    ).toBe(403);
    expect((await post(r, url, { ato: 'bloqueio', motivo: 'Documentação vencida' })).statusCode).toBe(401);
    expect((await post(r, url, { ato: 'bloqueio', motivo: 'abc', senha: SENHA })).statusCode).toBe(400);
    // Bloqueio: a sessão aberta cai e o login mostra o bloqueio a quem acerta a senha.
    const b = await post(r, url, { ato: 'bloqueio', motivo: 'Documentação vencida', senha: SENHA });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ situacao: 'bloqueado', pedidosRetirados: 0 });
    expect((await doPortal.get(medico, '/agenda')).statusCode).toBe(401);
    const login = await app.inject({
      remoteAddress: ORIGEM,
      method: 'POST',
      url: '/api/portal/aa/medico',
      payload: {
        conselho: 'CRM',
        uf: 'SP',
        numero: '54321',
        senha: 'senha-longa-sintetica',
        codigo: '000000',
      },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().title).toBe('Acesso bloqueado');
    // A lista interna: 'todas' mostra a bloqueada com a situação; o filtro próprio também.
    const bloq = (await get(r, '/portal-medico/contas?situacao=bloqueadas')).json();
    expect(bloq.contas.map((x: { acesso: number; situacao: string }) => [x.acesso, x.situacao])).toEqual([
      [acesso, 'bloqueado'],
    ]);
    // Bloquear de novo: 409; desbloquear volta a ativa.
    expect(
      (await post(r, url, { ato: 'bloqueio', motivo: 'De novo sem razão', senha: SENHA })).json().codigo,
    ).toBe('conta-nao-ativa');
    const d = await post(r, url, { ato: 'desbloqueio', motivo: 'Documentação entregue', senha: SENHA });
    expect(d.json()).toMatchObject({ situacao: 'ativo' });
    // Encerrar com pedidos aguardando o bloco: a contagem e a decisão exigida.
    const semDecisao = await post(r, url, {
      ato: 'encerramento',
      motivo: 'Deixou o corpo clínico',
      senha: SENHA,
    });
    expect(semDecisao.statusCode).toBe(409);
    const problema = semDecisao.json();
    expect(problema.codigo).toBe('pedidos-pendentes');
    const n = problema.dependentes[0].quantidade as number;
    expect(n).toBeGreaterThan(0);
    expect(problema.dependentes[0].amostra.length).toBe(Math.min(n, 10));
    expect(problema.detail).toContain(`${n} pedido(s)`);
    const enc = await post(r, url, {
      ato: 'encerramento',
      motivo: 'Deixou o corpo clínico',
      pedidos: 'retirar',
      senha: SENHA,
    });
    expect(enc.statusCode).toBe(200);
    expect(enc.json()).toMatchObject({ situacao: 'encerrado', pedidosRetirados: n, pedidosNaoRetirados: 0 });
    // Encerrada é definitiva: some de 'todas', aparece em 'encerradas', sem pedidos abertos; nada mais muda.
    const todas = (await get(r, '/portal-medico/contas')).json();
    expect(todas.contas.some((x: { acesso: number }) => x.acesso === acesso)).toBe(false);
    const encerradas = (await get(r, '/portal-medico/contas?situacao=encerradas')).json();
    expect(encerradas.contas).toEqual([
      expect.objectContaining({ acesso, situacao: 'encerrado', pedidosAbertos: 0 }),
    ]);
    expect(
      (await post(r, url, { ato: 'desbloqueio', motivo: 'Reabrir a conta', senha: SENHA })).json().codigo,
    ).toBe('conta-encerrada');
    // O histórico (fato novo por ato) e a trilha com a decisão.
    const atos = (await get(r, `/portal-medico/contas/${acesso}/atos`))
      .json()
      .filter((a: { ato: string }) => !a.ato.startsWith('troca-'));
    expect(atos.map((a: { ato: string; situacaoAnterior: string }) => [a.ato, a.situacaoAnterior])).toEqual([
      ['encerramento', 'ativo'],
      ['desbloqueio', 'bloqueado'],
      ['bloqueio', 'ativo'],
    ]);
    expect(atos[0]).toMatchObject({
      pedidosPendentes: n,
      decisaoPedidos: 'retirar',
      usuario: 'SINT.RECEPCAO.SADT',
    });
    expect(
      portalMedico.trilhas
        .filter((t) => t.evento === 'portal.medico.contaEncerrada')
        .map((t) => t.chaveNaturalAlvo),
    ).toEqual([`pedidos=${n};decisao=retirar`]);
  });
});
