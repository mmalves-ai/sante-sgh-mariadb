// W0-06, parte 6b-3: as solicitações do autoatendimento pela HTTP (permissões pessoas.autoatendimento.*, Zod com
// motivo, desistência só do próprio solicitante, decisão nunca do solicitante, o CID do atestado só com
// pessoas.atestado.verCid). Portas em memória; dados sintéticos; nada conecta a banco.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaAutoatendimentoMemoria } from './porta-autoatendimento-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const C = PESSOAS_SINTETICAS_M52;
const RECURSOS = ['pessoas.colaborador', 'pessoas.ponto', 'pessoas.folha'];
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
let vinculo = 0;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
pessoas.hojeFixo = '2026-10-25';
const ponto = new PortaPontoMemoria(pessoas);
ponto.agoraFixo = '2026-10-25T10:00';
const calculo = new PortaCalculoFolhaMemoria(pessoas);
calculo.agoraFixo = '2026-10-25T10:00:00';
const autoatendimento = new PortaAutoatendimentoMemoria(ponto, calculo, pessoas);

beforeAll(async () => {
  const configuracao = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => RECURSOS.map(chave),
    prerequisitosIniciais: () => RECURSOS.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, configuracao, null, new CifraCpf(Buffer.alloc(32, 7)));
  vinculo = (
    await rh.admitir(
      {
        req: {
          headers: { 'idempotency-key': 'w006-solic-http-admissao' },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: 'aa',
        rede: '',
        login: 'SINT.RH',
        porta: { rede: '', hospital: 'aa' },
        pode: () => true,
      },
      {
        cpf: C.ponto.cpf,
        nome: 'COLABORADORA DO PONTO SINTETICA',
        profissional: null,
        tipo: 'clt',
        admissao: '2025-01-05',
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanalHoras: 44,
        lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
        matricula: null,
        usuario: idUsuarioSintetico(C.ponto.login),
      },
    )
  ).id;
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas,
    ponto,
    calculoFolha: calculo,
    autoatendimento,
    configuracao,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app?.close();
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
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `w006-solic-http-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const MEU = '/api/pessoas/meu/solicitacoes';
const FILA = '/api/pessoas/solicitacoes';
const ajuste = {
  tipo: 'ajuste_ponto',
  vinculo: null,
  dia: '2026-10-20',
  ajuste: 'justificativa',
  marcacao: null,
  instante: null,
  movimento: 7,
  justificativa: 1,
  periodo: null,
  minutos: 60,
  observacao: 'Pedido sintético do teste HTTP',
};
const codigo = (r: { json: () => unknown }) => (r.json() as { codigo?: string }).codigo;

describe('W0-06 parte 6b-3: solicitações do autoatendimento pela HTTP', () => {
  it('o colaborador pede e desiste; a desistência só de quem pediu; a decisão nunca do solicitante', async () => {
    const eu = pedir(await entrar(C.ponto.login));
    const gestor = pedir(await entrar('SINT.ESCALA'));
    const r = await eu.post(MEU, ajuste);
    expect(r.statusCode).toBe(200);
    const id = r.json().id as number;
    const minhas = await eu.get(MEU);
    expect(minhas.statusCode).toBe(200);
    expect(minhas.json().itens.map((x: { id: number; vinculo: number }) => [x.id, x.vinculo])).toEqual([
      [id, vinculo],
    ]);
    // Sem motivo: 400 do Zod (o mesmo esquema da tela).
    expect((await eu.post(`${MEU}/${id}/desistencia`, { versao: 0 })).statusCode).toBe(400);
    // O gestor não desiste pelo colaborador (pela rota própria, a solicitação não é dele).
    const alheia = await gestor.post(`${MEU}/${id}/desistencia`, {
      versao: 0,
      motivo: 'Não fui eu quem pediu',
    });
    expect(alheia.statusCode).toBe(409);
    expect(codigo(alheia)).toBe('solicitacao-desistencia-so-do-solicitante');
    // O solicitante não decide a própria (nem tem a fila).
    expect((await eu.get(FILA)).statusCode).toBe(403);
    expect((await eu.post(`${FILA}/${id}/decisao`, { versao: 0, decisao: 'aprovar' })).statusCode).toBe(403);
    const d = await eu.post(`${MEU}/${id}/desistencia`, { versao: 0, motivo: 'Lancei o dia errado' });
    expect(d.statusCode).toBe(200);
    expect(d.json().solicitacao).toMatchObject({ situacao: 'desistida' });
  });

  it('o gestor vê a fila, recusa com motivo e aprova; o ajuste aprovado vai ao ponto', async () => {
    const eu = pedir(await entrar(C.ponto.login));
    const gestor = pedir(await entrar('SINT.ESCALA'));
    const a = (await eu.post(MEU, ajuste)).json().id as number;
    const b = (await eu.post(MEU, { ...ajuste, dia: '2026-10-21' })).json().id as number;
    const fila = await gestor.get(`${FILA}?situacao=pendente`);
    expect(fila.statusCode).toBe(200);
    const ids = fila.json().itens.map((x: { id: number }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    // Recusar sem motivo: 400.
    expect((await gestor.post(`${FILA}/${a}/decisao`, { versao: 0, decisao: 'recusar' })).statusCode).toBe(
      400,
    );
    const rec = await gestor.post(`${FILA}/${a}/decisao`, {
      versao: 0,
      decisao: 'recusar',
      motivo: 'O dia já tem as marcações completas',
    });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().solicitacao).toMatchObject({ situacao: 'recusada' });
    const ok = await gestor.post(`${FILA}/${b}/decisao`, { versao: 0, decisao: 'aprovar' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().solicitacao.ajustes.map((x: { situacao: string }) => x.situacao)).toEqual(['aprovado']);
  });

  it('atestado: o próprio lê o CID; o gestor sem verCid lê sem o CID e pedir o CID é 403; quem não decide recebe 403', async () => {
    const eu = pedir(await entrar(C.ponto.login));
    const gestor = pedir(await entrar('SINT.ESCALA'));
    const r = await eu.post(MEU, {
      tipo: 'atestado',
      vinculo: null,
      inicio: '2026-10-20',
      fim: '2026-10-21',
      movimento: 7,
      atestado: {
        emitidoEm: '2026-10-20',
        dias: 2,
        cid: 'J11.1',
        emitente: 'Médica sintética',
        registroConselho: null,
        arquivo: null,
      },
      observacao: null,
    });
    expect(r.statusCode).toBe(200);
    const id = r.json().id as number;
    const proprio = await eu.post(`${MEU}/${id}/atestado`, {
      finalidade: 'Conferir o que enviei',
      verCid: true,
    });
    expect(proprio.statusCode).toBe(200);
    expect(proprio.json()).toMatchObject({ cid: 'J11.1', temCid: true, dias: 2 });
    // Sem finalidade: 400.
    expect((await gestor.post(`${FILA}/${id}/atestado`, {})).statusCode).toBe(400);
    const sem = await gestor.post(`${FILA}/${id}/atestado`, { finalidade: 'Conferir os dias' });
    expect(sem.statusCode).toBe(200);
    expect(sem.json()).toMatchObject({ cid: null, temCid: true, acessos: [] });
    const cid = await gestor.post(`${FILA}/${id}/atestado`, { finalidade: 'Ver o CID', verCid: true });
    expect(cid.statusCode).toBe(403);
    expect(codigo(cid)).toBe('cid-restrito');
    // Quem não aprova solicitação não chega à fila nem ao atestado de outra pessoa.
    const sesmt = pedir(await entrar('SINT.SESMT.CONSULTA'));
    expect((await sesmt.get(FILA)).statusCode).toBe(403);
    expect((await sesmt.post(`${FILA}/${id}/atestado`, { finalidade: 'Curiosidade' })).statusCode).toBe(403);
  });
});
