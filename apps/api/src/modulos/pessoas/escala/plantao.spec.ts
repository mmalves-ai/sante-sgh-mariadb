// M52.3 (fatia F3) pela HTTP, com a sessão real sobre a fonte sintética e as portas da gestão de pessoas e da escala EM
// MEMÓRIA (nada conecta a banco; CPF SINTÉTICO): a colaboradora com login (todo perfil de pessoa pede a troca e consulta
// quem está de plantão) pede a troca do próprio plantão e não aprova; a gestora de escala registra o aceite da colega
// sem acesso e aprova; o RH (quadro de escalas do outro sistema) lê o dimensionamento mas não o registra (só o perfil);
// a entrada inválida dá 400.
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/public-api.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaEscalaMemoria } from './porta-escala-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveLiberacao => ({
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
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
pessoas.hojeFixo = '2026-10-25';
const escala = new PortaEscalaMemoria(pessoas);

beforeAll(async () => {
  const recursos = ['pessoas.colaborador', 'pessoas.escala', 'pessoas.dimensionamento'];
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas,
    escala,
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => recursos.map(chave),
      prerequisitosIniciais: () => recursos.map(cumprido),
    }),
  } as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
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
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m52-3-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas';
const C = PESSOAS_SINTETICAS_M52;

const p2 = (x: number) => String(x).padStart(2, '0');
const prox = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
const comp = `${prox.getFullYear()}-${p2(prox.getMonth() + 1)}`;
const admissao = (cpf: string, nome: string, profissional: number, usuario: number | null) => ({
  cpf,
  nome,
  tipo: 'clt',
  admissao: '2026-10-01',
  cargo: 'Enfermeira assistencial',
  funcao: null,
  cargaSemanalHoras: 36,
  lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 2' },
  matricula: null,
  profissional,
  usuario,
});

// PENDENTE (F2.2 lote 03-04): a API HTTP da escala volta quando o módulo `pessoas` for registrado em API_MODULOS (lote
// que registra a unidade pessoas; pedido em docs/obra/fatias/f22/saida/03-04.json). Até lá o criarApp não recebe mais as
// portas por opção (OpcoesAppBase), e as mesmas regras estão cobertas pelos specs do serviço sobre a memória
// (servico-escala, servico-plantao, crud-escala) e pela integração da porta própria (porta-escala-propria.int.spec).
describe.skip('fatia F3 (troca, plantão agora, dimensionamento) pela HTTP', { timeout: 120_000 }, () => {
  it('troca pedida pela colaboradora, aceite registrado e aprovação pela gestora; plantão agora; dimensionamento', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    const um = await rh.post(
      `${P}/colaboradores`,
      admissao(
        C.comLogin.cpf,
        'ENFERMEIRA SINTETICA UM',
        C.comLogin.profissional,
        idUsuarioSintetico(C.comLogin.login),
      ),
    );
    expect(um.statusCode).toBe(200);
    const tres = await rh.post(
      `${P}/colaboradores`,
      admissao(C.escalaEnfermeira.cpf, 'ENFERMEIRA SINTETICA TRES', C.escalaEnfermeira.profissional, null),
    );
    expect(tres.statusCode).toBe(200);
    const g = pedir(await entrar('SINT.ESCALA'));
    const id = (
      await g.post(`${P}/escalas`, {
        unidade: 1,
        setor: 'Posto 2',
        competencia: comp,
        tipo: 'enfermagem',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
      })
    ).json().id as number;
    const a = await g.post(`${P}/escalas/${id}/plantoes`, {
      vinculo: um.json().id,
      tipo: 'presencial',
      inicio: `${comp}-05T07:00`,
      fim: `${comp}-05T19:00`,
    });
    const b = await g.post(`${P}/escalas/${id}/plantoes`, {
      vinculo: tres.json().id,
      tipo: 'presencial',
      inicio: `${comp}-06T07:00`,
      fim: `${comp}-06T19:00`,
    });
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect((await g.post(`${P}/escalas/${id}/publicacao`, { versao: 2 })).statusCode).toBe(200);

    const colab = pedir(await entrar('SINT.COLAB'));
    const apoio = await colab.get(`${P}/trocas/apoio`);
    expect(apoio.statusCode).toBe(200);
    expect(apoio.json().acoes).toMatchObject({ pedir: true, aprovar: false, emNomeDe: false });
    const lista = (await colab.get(`${P}/trocas/escala/${id}`)).json();
    expect(lista.plantoes.map((x: { meu: boolean }) => x.meu)).toEqual([true, false]);
    expect((await colab.post(`${P}/trocas`, { tipo: 'troca', plantao: a.json().id })).statusCode).toBe(400);
    const t = await colab.post(`${P}/trocas`, {
      tipo: 'troca',
      plantao: a.json().id,
      versao: 0,
      colega: tres.json().id,
      plantaoColega: b.json().id,
      versaoColega: 0,
      motivo: 'Compromisso familiar no dia',
    });
    expect(t.statusCode).toBe(200);
    const troca = t.json().id as number;
    expect((await colab.post(`${P}/trocas/${troca}/decisao`, { versao: 0, aprovar: true })).statusCode).toBe(
      403,
    );
    expect(
      (
        await g.post(`${P}/trocas/${troca}/resposta`, {
          versao: 0,
          aceite: true,
          confirmacao: 'Confirmou por telefone com a coordenação',
        })
      ).statusCode,
    ).toBe(200);
    // Quatro olhos: quem registrou o aceite não aprova; a outra gestora de escala aprova.
    const propria = await g.post(`${P}/trocas/${troca}/decisao`, { versao: 1, aprovar: true });
    expect([propria.statusCode, propria.json().codigo]).toEqual([409, 'aprovar-o-que-registrou']);
    const g2 = pedir(await entrar('SINT.ESCALA.APROVA'));
    const d = await g2.post(`${P}/trocas/${troca}/decisao`, { versao: 1, aprovar: true });
    expect(d.statusCode).toBe(200);
    expect((await colab.get(`${P}/trocas`)).json().itens[0]).toMatchObject({ estado: 'aprovada' });

    // Quem está de plantão no dia 5 às 8 h (a colega TRES, depois da troca); a colaboradora consulta mas não aciona.
    const agora = await colab.get(`${P}/plantao-agora?instante=${comp}-05T08:00`);
    expect(agora.statusCode).toBe(200);
    expect(agora.json().linhas.map((x: { nome: string }) => x.nome)).toEqual(['ENFERMEIRA SINTETICA TRES']);
    expect(agora.json().acoes.acionar).toBe(false);
    expect((await colab.get(`${P}/plantao-agora?instante=amanha`)).statusCode).toBe(400);

    // Dimensionamento: o RH lê e calcula a prévia; registrar é só do perfil de gestor de escala.
    const e = {
      unidade: 1,
      setor: 'Posto 2',
      data: `${comp}-05`,
      turno: 'manha',
      jornadaSemanalHoras: 36,
      ist: 0.15,
      fonte: 'informada',
      pacientes: { minimos: 10, intermediarios: 8, altaDependencia: 2, semiIntensivos: 0, intensivos: 0 },
    };
    expect((await rh.get(`${P}/dimensionamento/apoio`)).statusCode).toBe(200);
    const prev = await rh.post(`${P}/dimensionamento/previa`, e);
    expect(prev.statusCode).toBe(200);
    expect(prev.json().calculo).toMatchObject({
      totalProfissionais: 25,
      enfermeiros: 9,
      coberturaSugerida: 5,
    });
    expect((await rh.post(`${P}/dimensionamentos`, e)).statusCode).toBe(403);
    expect((await g.post(`${P}/dimensionamentos`, { ...e, ist: 0.1 })).statusCode).toBe(400);
    expect((await g.post(`${P}/dimensionamentos`, e)).statusCode).toBe(200);
    expect((await g.get(`${P}/dimensionamentos?unidade=1`)).json().itens).toHaveLength(1);
    const consulta = pedir(await entrar('SINT.RH.CONSULTA'));
    expect((await consulta.get(`${P}/dimensionamento/apoio`)).statusCode).toBe(403);
  });
});
