// M56 (etapa 8, F7) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco;
// dados SINTÉTICOS): o atendimento com protocolo e o portal do prestador nascem desligados (o apoio diz o motivo; o resto
// dá 403 recurso-desligado); ligados, o ciclo do protocolo: registrar (o número de 20 dígitos e o prazo; as recusas da
// conferência) → ficha (trilha) com as ações → análise → resposta (o fundamento da negativa) → escrita pedida e enviada →
// encerramento → reanálise na ouvidoria com a prorrogação → NIP → cancelamento → consulta pelo número, lista, busca e
// contagens → versão vista; e o portal: o credenciamento cria o acesso com o código de uso único → ativação (senha e
// segundo fator) → entrada → os pedidos do prestador, o pedido pelo portal (origem e prestador da conta), a consulta do
// protocolo, o cancelamento → a função não liberada → o acesso encerrado derruba a sessão.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { codigoTotp } from '@sgh/dominio-acesso';
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../config/public-api.js';
import { contextoDeTeste } from '../cadastro/teste.spec-util.js';
import { criarAppOperadora } from './infra/app-operadora.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaAtendimentoOperadoraMemoria } from './atendimento-porta-memoria.js';
import { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';
import { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';

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
  alteradoEm: '2026-10-24T10:00:00',
});
const pre = (recurso: string, tipo: PrerequisitoRecurso['tipo']): PrerequisitoRecurso => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});

const trilha = new RegistradorTrilhaMemoria();
const operadora = new PortaOperadoraMemoria(trilha);
const rede = new PortaRedeOperadoraMemoria();
const autorizacao = new PortaAutorizacaoOperadoraMemoria(operadora, rede);
const atendimento = new PortaAtendimentoOperadoraMemoria(operadora, rede, autorizacao);
// O relógio fixo da memória (segunda-feira, 26/10/2026, 10h): os prazos em dias úteis ficam determinados.
let agora = '2026-10-26T10:00:00';
autorizacao.agora = () => agora;
atendimento.agora = () => agora;
let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;

beforeAll(async () => {
  ligado = await criarAppOperadora(env, {
    trilha,
    operadora,
    rede: rede,
    autorizacao: autorizacao,
    atendimento: atendimento,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [
        chave('operadora'),
        chave('operadora.beneficiarios'),
        chave('operadora.autorizacao'),
        chave('operadora.atendimento'),
        chave('operadora.portalPrestador'),
      ],
      prerequisitosIniciais: () => [
        pre('operadora', 'credenciamento'),
        pre('operadora.autorizacao', 'aprovacao'),
      ],
    }),
  });
  desligado = await criarAppOperadora(env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
let n = 0;
async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
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
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m56-8-${++n}-${Date.now()}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const O = '/api/operadora';
const P = `${O}/protocolos`;
const PP = '/api/portal-prestador';

describe(
  'atendimento com protocolo e portal do prestador (etapa 8, F7), pela HTTP',
  { timeout: 120_000 },
  () => {
    it('desligados: o apoio e as contas dizem o motivo; o resto dá 403 recurso-desligado', async () => {
      const c = pedir(desligado, await entrar(desligado, 'SINT.OPE.ATENDE'));
      const a = await c.get(`${P}/apoio`);
      expect(a.statusCode).toBe(200);
      expect(a.json()).toMatchObject({ ligada: false, operadoras: [] });
      expect(a.json().parametros.diasUteisAssistencial).toBe(5);
      for (const u of [P, `${P}/1`, `${P}/consulta?numero=${'9'.repeat(20)}`])
        expect((await c.get(u)).json().codigo, u).toBe('recurso-desligado');
      expect((await c.post(`${P}/1/analise`, { versao: 1 })).json().codigo).toBe('recurso-desligado');
      const g = pedir(desligado, await entrar(desligado, 'SINT.OPERADORA'));
      expect((await g.get(`${O}/portal/acessos`)).json()).toMatchObject({ ligada: false, itens: [] });
      const portal = await desligado.inject({
        method: 'POST',
        url: `${PP}/aa/entrada`,
        payload: { login: 'x@y.invalid', senha: 'x', codigo: '000000' },
      });
      expect(portal.json().codigo).toBe('recurso-desligado');
      // Quem não tem perfil da operadora nem lê o apoio.
      const adm = pedir(desligado, await entrar(desligado, 'SINT.ADMIN'));
      expect((await adm.get(`${P}/apoio`)).statusCode).toBe(403);
    });

    it('o ciclo do protocolo: registrar → análise → resposta → escrita → encerrar → reanálise → NIP → cancelar', async () => {
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (
        await gestor.post(`${O}/empresas`, {
          registroAns: '900008',
          cnpj: cnpjSintetico('900000080001'),
          razaoSocial: 'Operadora Sintética F7',
          modalidade: 'medicinaGrupo',
        })
      ).json().id as number;
      const prod = await gestor.post(`${O}/produtos`, {
        operadora: ope,
        codigo: 'F7',
        nome: 'Plano sintético F7',
        natureza: 'plano',
        registroAns: '900000081',
        tipoContratacao: 1,
        segmentacao: 'ambulatorialHospitalar',
        abrangencia: 'estadual',
        acomodacao: 2,
        coparticipacao: { tipo: 1, valor: null },
        carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
        precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
      });
      expect(prod.statusCode, prod.body).toBe(201);
      const ctr = await gestor.post(`${O}/contratos`, {
        produto: prod.json().id,
        numero: 'F7-0001',
        tipo: 1,
        contratanteNome: 'Contratante Sintético F7',
        contratanteDocumento: cpfSintetico('900000081'),
        formaReajuste: 1,
        mesReajuste: 5,
        tipoVigencia: 2,
        inicio: '2026-01-01',
      });
      expect(ctr.statusCode, ctr.body).toBe(201);
      const ben = await gestor.post(`${O}/beneficiarios`, {
        contrato: ctr.json().id,
        vinculo: 1,
        nome: 'Beneficiária Sintética Protocolo',
        cpf: cpfSintetico('900000082'),
        nascimento: '1980-05-10',
        sexo: 'F',
        nomeMae: 'Mãe Sintética',
        inclusao: '2026-02-01',
      });
      expect(ben.statusCode, ben.body).toBe(201);
      const carteirinha = ben.json().carteirinha as string;

      const apoio = (await atende.get(`${P}/apoio`)).json();
      expect(apoio).toMatchObject({ ligada: true, podeRegistrar: true });
      expect(apoio.operadoras.map((o: { id: number }) => o.id)).toContain(ope);
      expect(apoio.dominios.origem.map((o: { rotulo: string }) => o.rotulo)).toContain(
        'Serviço de atendimento ao cliente',
      );

      const base = {
        operadora: ope,
        instancia: 'atendimento',
        natureza: 'cobertura',
        canal: 'telefone',
        origem: 6,
        solicitante: 'beneficiario',
        carteirinha,
        assunto: 'Pedido de ressonância sintético',
        relato: 'A beneficiária pergunta pela cobertura de um exame sintético.',
      };
      // Recusas da conferência: o canal da ANS fora da NIP; a carteirinha que não existe; a origem fora do domínio.
      expect((await atende.post(P, { ...base, canal: 'ans' })).json().codigo).toBe('ans-so-na-nip');
      expect((await atende.post(P, { ...base, carteirinha: '9'.repeat(16) })).json().codigo).toBe(
        'beneficiario-inexistente',
      );
      expect((await atende.post(P, { ...base, origem: 99 })).json().codigo).toBe('origem-inexistente');
      // O gestor lê, mas não registra.
      expect((await gestor.post(P, base)).statusCode).toBe(403);

      const reg = await atende.post(P, base);
      expect(reg.statusCode, reg.body).toBe(200);
      const protocolo = reg.json().protocolo as string;
      expect(protocolo).toMatch(/^900008202610265\d{5}$/);
      expect(reg.json().mensagem).toBe(`Protocolo ${protocolo}: resposta até 02/11/2026 23:59.`);
      const id = reg.json().id as number;

      let f = (await atende.get(`${P}/${id}`)).json();
      expect(f).toMatchObject({
        situacao: 'aberto',
        prazoTipo: 'assistencial',
        classe: 'assistencial',
        versao: 1,
      });
      expect(f.acoes).toEqual(['analisar', 'interagir', 'responder', 'pedirEscrita', 'cancelar']);
      expect(trilha.eventos.some((e) => e.evento === 'operadora.protocolo.lido')).toBe(true);

      expect((await atende.post(`${P}/${id}/analise`, { versao: 1 })).json()).toMatchObject({
        situacao: 'em-analise',
      });
      // A versão vista: a segunda análise com a versão velha é recusada.
      expect(
        (await atende.post(`${P}/${id}/interacao`, { versao: 1, texto: 'Contato sintético' })).json().codigo,
      ).toBe('protocolo-desatualizado');
      expect((await atende.post(`${P}/${id}/escrita`, { versao: 2 })).json().mensagem).toContain(
        'o prazo começa',
      );
      // A negativa sem o fundamento é recusada; a informativa não vale na assistencial.
      const resp = {
        versao: 3,
        conclusao: 'desfavoravel',
        resposta: 'O exame sintético não tem cobertura no plano.',
        meio: 'telefone',
      };
      expect((await atende.post(`${P}/${id}/resposta`, resp)).json().codigo).toBe('fundamento-obrigatorio');
      expect(
        (await atende.post(`${P}/${id}/resposta`, { ...resp, conclusao: 'informativa' })).json().codigo,
      ).toBe('informativa-so-nao-assistencial');
      agora = '2026-10-27T09:00:00';
      const r = await atende.post(`${P}/${id}/resposta`, { ...resp, fundamento: 'Cláusula 7 do contrato' });
      expect(r.json().mensagem).toContain('até 2026-10-28 09:00');
      f = (await atende.get(`${P}/${id}`)).json();
      expect(f.acoes).toEqual(['interagir', 'enviarEscrita', 'reanalise']);
      expect(f.textoEscrito).toContain('Fundamento: Cláusula 7 do contrato.');
      expect((await atende.post(`${P}/${id}/encerrar`, { versao: 4 })).json().codigo).toBe(
        'escrita-pendente',
      );
      expect((await atende.post(`${P}/${id}/escrita/envio`, { versao: 4, meio: 'email' })).statusCode).toBe(
        200,
      );
      expect((await atende.post(`${P}/${id}/encerrar`, { versao: 5 })).json()).toMatchObject({
        situacao: 'encerrado',
      });

      // A reanálise pela ouvidoria: o novo protocolo com a origem; a segunda reanálise em aberto é recusada.
      const re = await atende.post(`${P}/${id}/reanalise`, {
        versao: 6,
        canal: 'telefone',
        origem: 6,
        relato: 'A beneficiária pede a reanálise da negativa sintética.',
      });
      expect(re.statusCode, re.body).toBe(200);
      expect(re.json().protocolo).not.toBe(protocolo);
      const ouv = re.json().id as number;
      f = (await atende.get(`${P}/${ouv}`)).json();
      expect(f).toMatchObject({ instancia: 'ouvidoria', prazoTipo: 'ouvidoria', origemProtocolo: { id } });
      expect(f.prorrogavelAte).toBe('2026-12-08T23:59:59');
      expect(f.acoes).toContain('prorrogar');
      expect((await atende.get(`${P}/${id}`)).json().reanalises).toHaveLength(1);
      expect(
        (
          await atende.post(`${P}/${id}/reanalise`, {
            versao: 7,
            canal: 'telefone',
            origem: 6,
            relato: 'Outra reanálise sintética',
          })
        ).json().codigo,
      ).toBe('reanalise-ja-aberta');
      expect(
        (
          await atende.post(`${P}/${ouv}/prorrogacao`, {
            versao: 1,
            ate: '2026-12-09',
            motivo: 'Acordado com a beneficiária',
          })
        ).json().codigo,
      ).toBe('prorrogacao-acima-do-limite');
      expect(
        (
          await atende.post(`${P}/${ouv}/prorrogacao`, {
            versao: 1,
            ate: '2026-11-20',
            motivo: 'Acordado com a beneficiária',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await atende.post(`${P}/${ouv}/prorrogacao`, {
            versao: 2,
            ate: '2026-11-25',
            motivo: 'Acordado de novo',
          })
        ).json().codigo,
      ).toBe('prorrogacao-ja-feita');

      // A NIP: o canal e o solicitante da ANS e o número da demanda; prazo de 10 dias úteis na não assistencial.
      const nip = await atende.post(P, {
        ...base,
        instancia: 'nip',
        natureza: 'financeiro',
        canal: 'ans',
        solicitante: 'ans',
        numeroNip: '1234567',
        assunto: 'NIP sintética de reajuste',
      });
      expect(nip.json().mensagem).toContain('resposta até 10/11/2026');
      // O cancelamento do contrato: resposta imediata; cancelar o protocolo pede o motivo.
      const canc = await atende.post(P, {
        ...base,
        natureza: 'cancelamento',
        assunto: 'Cancelamento sintético',
      });
      expect(canc.json().mensagem).toContain('resposta imediata');
      expect(
        (
          await atende.post(`${P}/${canc.json().id}/cancelar`, {
            versao: 1,
            motivo: 'Registrado em duplicidade',
          })
        ).json(),
      ).toMatchObject({ situacao: 'cancelado' });

      // Consulta pelo número, lista, busca e contagens.
      expect((await atende.get(`${P}/consulta?numero=${protocolo}`)).json()).toMatchObject({
        tipo: 'atendimento',
        situacaoRotulo: 'Encerrado',
      });
      expect((await atende.get(`${P}/consulta?numero=${'1'.repeat(20)}`)).json().codigo).toBe(
        'protocolo-inexistente',
      );
      const l = (await atende.get(`${P}?busca=1234567`)).json();
      expect(l.itens).toHaveLength(1);
      expect(l.itens[0]).toMatchObject({ instancia: 'nip', prazoEm: '2026-11-10T23:59:59' });
      const todos = (await atende.get(P)).json();
      expect(todos.itens.length).toBe(4);
      expect(todos.totais).toMatchObject({ abertos: 2 });
      agora = '2026-12-01T10:00:00';
      expect((await atende.get(`${P}?vencidos=sim`)).json().itens.map((x: { id: number }) => x.id)).toContain(
        ouv,
      );
      agora = '2026-10-27T09:00:00';
    });

    it('o portal do prestador: acesso → ativação → entrada → pedidos e protocolos dele → função não liberada → encerrado', async () => {
      // O portal confere a validade da ativação no relógio do processo, e a memória a calcula no relógio fixo:
      // o relógio do processo (só o Date, andando) parte do relógio fixo, senão o teste vence com o calendário.
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const contas = (await gestor.get(`${O}/portal/acessos`)).json();
      expect(contas).toMatchObject({ ligada: true, podeEditar: true });
      expect(
        contas.funcoes
          .filter((x: { liberavel: boolean }) => x.liberavel)
          .map((x: { codigo: number }) => x.codigo),
      ).toEqual([1, 2, 3, 7]);
      const prestador = contas.prestadores[0].id as number;
      const novo = {
        operadora: ope,
        prestador,
        login: 'Responsavel@Clinica.invalid',
        nome: 'Responsável Sintético',
        tipoAtendimento: 1,
      };
      expect((await gestor.post(`${O}/portal/acessos`, { ...novo, funcoes: [4] })).json().codigo).toBe(
        'funcao-nao-liberavel',
      );
      expect((await gestor.post(`${O}/portal/acessos`, { ...novo, funcoes: [2, 3] })).json().codigo).toBe(
        'cancelar-sem-solicitar',
      );
      expect((await atende.post(`${O}/portal/acessos`, { ...novo, funcoes: [3] })).statusCode).toBe(403);
      const cria = await gestor.post(`${O}/portal/acessos`, { ...novo, funcoes: [7, 1, 2, 3] });
      expect(cria.statusCode, cria.body).toBe(200);
      const codigo = cria.json().codigoAtivacao as string;
      expect(codigo).toMatch(/^[A-Z2-9]{12}$/);
      expect((await gestor.post(`${O}/portal/acessos`, { ...novo, funcoes: [3] })).json().codigo).toBe(
        'login-em-uso',
      );
      const acesso = cria.json().id as number;
      const lista = (await gestor.get(`${O}/portal/acessos`)).json().itens;
      expect(lista[0]).toMatchObject({
        login: 'responsavel@clinica.invalid',
        funcoes: [1, 2, 3, 7],
        situacao: 'pendente',
      });
      expect(JSON.stringify(lista)).not.toMatch(/senha|segundoFator|ativacaoResumo/i);

      const login = 'responsavel@clinica.invalid';
      const ativar = (c: string) =>
        ligado.inject({
          method: 'POST',
          url: `${PP}/aa/ativacao`,
          remoteAddress: '10.0.0.8',
          payload: { login, codigo: c, senha: 'senha-sintetica-12' },
        });
      expect((await ativar('ABCDEFGHJKMN')).json().codigo).toBe('ativacao-invalida');
      const at = await ativar(codigo);
      expect(at.statusCode, at.body).toBe(200);
      const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
      expect((await ativar(codigo)).json().codigo).toBe('ativacao-invalida');

      const entrada = (c: string) =>
        ligado.inject({
          method: 'POST',
          url: `${PP}/aa/entrada`,
          remoteAddress: '10.0.0.9',
          payload: { login, senha: 'senha-sintetica-12', codigo: c },
        });
      expect((await entrada('000000')).statusCode).toBe(401);
      const ok = await entrada(codigoTotp(segredo, Date.now()));
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toMatchObject({ prestador, funcoes: [1, 2, 3, 7] });
      const set = ok.headers['set-cookie'] as string[];
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      const csrf =
        set
          .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
          ?.split(';')[0]
          ?.split('=')[1] ?? '';
      const pget = (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } });
      const ppost = (u: string, payload: object, comCsrf = true) =>
        ligado.inject({
          method: 'POST',
          url: u,
          payload,
          headers: { cookie, ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}) },
        });
      expect((await pget(`${PP}/sessao`)).json()).toMatchObject({ nome: 'Responsável Sintético' });
      // A sessão interna não vale no portal, nem a do portal nas telas internas.
      expect((await gestor.get(`${PP}/sessao`)).statusCode).toBe(401);
      expect([401, 403]).toContain((await pget(`${P}/apoio`)).statusCode);

      // O apoio do pedido pelo portal (os tipos de guia e a data, nada da rede) e a busca TUSS (função 1).
      const apoioPortal = (await pget(`${PP}/apoio`)).json();
      expect(apoioPortal.tiposGuia.length).toBeGreaterThan(0);
      expect(apoioPortal).not.toHaveProperty('prestadores');
      expect((await pget(`${PP}/procedimentos?busca=x`)).statusCode).toBe(400);
      expect((await pget(`${PP}/procedimentos?busca=40304361`)).json().itens.length).toBeGreaterThan(0);

      // O pedido pelo portal: o prestador e a origem saem da conta (o que a tela mandar é ignorado).
      const carteirinha = (await atende.get(P))
        .json()
        .itens.find((x: { carteirinha: string | null }) => x.carteirinha)?.carteirinha as string;
      const pedido = {
        carteirinha,
        prestador: 999,
        origem: 1,
        executante: null,
        tipoGuia: 4,
        carater: 'E',
        altaComplexidade: false,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação clínica sintética do pedido pelo portal',
        profissional: { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' },
        internacao: null,
        itens: [{ tabela: 22, codigo: '40304361', descricao: null, quantidade: 1 }],
      };
      expect((await ppost(`${PP}/autorizacoes`, pedido, false)).statusCode).toBe(403);
      const sol = await ppost(`${PP}/autorizacoes`, pedido);
      expect(sol.statusCode, sol.body).toBe(200);
      const guia = sol.json().id as number;
      const prot = sol.json().protocolo as string;
      const minhas = (await pget(`${PP}/autorizacoes`)).json();
      expect(minhas.itens.map((x: { id: number }) => x.id)).toContain(guia);
      expect(minhas.itens[0].beneficiarioIniciais).toBe('B. S. P.');
      expect((await pget(`${PP}/autorizacoes/${guia}`)).json().itens).toHaveLength(1);
      expect((await pget(`${PP}/protocolos/${prot}`)).json()).toMatchObject({
        tipo: 'autorizacao',
        situacaoRotulo: 'Em análise',
      });
      // O protocolo do atendimento ao beneficiário não é do prestador.
      const doAtendimento = (await atende.get(P)).json().itens[0].protocolo as string;
      expect((await pget(`${PP}/protocolos/${doAtendimento}`)).json().codigo).toBe('protocolo-inexistente');
      expect(
        (
          await ppost(`${PP}/autorizacoes/${guia}/cancelar`, {
            versao: 1,
            motivo: 'Pedido sintético em duplicidade',
          })
        ).json(),
      ).toMatchObject({
        situacao: 'cancelada',
      });

      // O credenciamento tira a função de solicitar: o portal recusa; encerrado, a sessão cai.
      const alt = await gestor.post(`${O}/portal/acessos/${acesso}`, {
        versao: 2,
        funcoes: [3],
        tipoAtendimento: 1,
      });
      expect(alt.statusCode, alt.body).toBe(200);
      expect((await ppost(`${PP}/autorizacoes`, pedido)).json().codigo).toBe('funcao-nao-liberada');
      expect((await pget(`${PP}/apoio`)).json().codigo).toBe('funcao-nao-liberada');
      expect(
        (
          await gestor.post(`${O}/portal/acessos/${acesso}/encerrar`, {
            versao: 3,
            motivo: 'Prestador sintético descredenciado',
          })
        ).statusCode,
      ).toBe(200);
      expect((await pget(`${PP}/autorizacoes`)).statusCode).toBe(401);
      expect((await entrada(codigoTotp(segredo, Date.now()))).statusCode).toBe(401);
    });

    it('o portal: o executante não vem da tela; o descredenciamento derruba a sessão e a entrada; o bloqueio vale sob pedidos simultâneos e não revela a conta', async () => {
      // O portal confere a validade da ativação no relógio do processo, e a memória a calcula no relógio fixo:
      // o relógio do processo (só o Date, andando) parte do relógio fixo, senão o teste vence com o calendário.
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const contas = (await gestor.get(`${O}/portal/acessos`)).json();
      const prestador = contas.prestadores[0].id as number;
      const outro = contas.prestadores[1].id as number;
      expect(outro).not.toBe(prestador);
      const login = 'segundo@clinica.invalid';
      const cria = await gestor.post(`${O}/portal/acessos`, {
        operadora: ope,
        prestador,
        login,
        nome: 'Segundo Responsável Sintético',
        tipoAtendimento: 1,
        funcoes: [1, 2, 3, 7],
      });
      expect(cria.statusCode, cria.body).toBe(200);
      const at = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/ativacao`,
        remoteAddress: '10.0.1.8',
        payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-34' },
      });
      expect(at.statusCode, at.body).toBe(200);
      const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
      let ipN = 0;
      // Cada entrada de um IP sintético próprio (a taxa por IP não interfere no que se mede aqui).
      const entrada = (c: string, senha = 'senha-sintetica-34', l = login) =>
        ligado.inject({
          method: 'POST',
          url: `${PP}/aa/entrada`,
          remoteAddress: `10.0.2.${++ipN}`,
          payload: { login: l, senha, codigo: c },
        });
      const ok = await entrada(codigoTotp(segredo, Date.now()));
      expect(ok.statusCode, ok.body).toBe(200);
      const set = ok.headers['set-cookie'] as string[];
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      const csrf =
        set
          .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
          ?.split(';')[0]
          ?.split('=')[1] ?? '';
      const pget = (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } });
      const ppost = (u: string, payload: object) =>
        ligado.inject({
          method: 'POST',
          url: u,
          payload,
          headers: { cookie, 'x-csrf-portal-prestador': csrf },
        });

      // O executante mandado pela tela é ignorado (D-PORTAL-FORM-568): a guia nasce sem executante.
      const carteirinha = (await atende.get(P))
        .json()
        .itens.find((x: { carteirinha: string | null }) => x.carteirinha)?.carteirinha as string;
      const sol = await ppost(`${PP}/autorizacoes`, {
        carteirinha,
        prestador: 999,
        origem: 1,
        executante: outro,
        tipoGuia: 4,
        carater: 'E',
        altaComplexidade: false,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação clínica sintética com executante forjado',
        profissional: { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' },
        internacao: null,
        itens: [{ tabela: 22, codigo: '40304361', descricao: null, quantidade: 1 }],
      });
      expect(sol.statusCode, sol.body).toBe(200);
      const ficha = await atende.get(`${O}/autorizacoes/${sol.json().id}`);
      expect(ficha.statusCode, ficha.body).toBe(200);
      expect(ficha.json()).toMatchObject({ prestador: { id: prestador }, executante: null });

      // Descredenciado na rede depois da ativação (a conta segue ativa): a sessão cai e a entrada certa é recusada.
      const prestadorReal = rede.prestador.bind(rede);
      const espiao = vi.spyOn(rede, 'prestador').mockImplementation(async (c, id) => {
        const p = await prestadorReal(c, id);
        return p && id === prestador ? { ...p, situacao: 'descredenciado' as const } : p;
      });
      try {
        const lista = await pget(`${PP}/autorizacoes`);
        expect(lista.statusCode).toBe(403);
        expect(lista.json().codigo).toBe('prestador-descredenciado');
        expect((await pget(`${PP}/autorizacoes`)).statusCode).toBe(401);
        const recusada = await entrada(codigoTotp(segredo, Date.now()));
        expect(recusada.statusCode).toBe(403);
        expect(recusada.json().codigo).toBe('prestador-descredenciado');
        // A senha errada continua só credencial inválida (não revela o credenciamento).
        expect((await entrada('000000', 'senha-errada-1234')).statusCode).toBe(401);
      } finally {
        espiao.mockRestore();
      }

      // Cinco entradas erradas SIMULTÂNEAS (todas leem o mesmo contador antes de gravar): o banco soma e a conta bloqueia.
      const erradas = await Promise.all(
        Array.from({ length: 5 }, () => entrada('000000', 'senha-errada-1234')),
      );
      expect(erradas.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
      // Bloqueada, até a entrada certa responde igual à de um e-mail sem conta (nada de 429 que confirme a conta).
      const bloqueada = await entrada(codigoTotp(segredo, Date.now()));
      const semConta = await entrada('000000', 'senha-errada-1234', 'ninguem@clinica.invalid');
      expect(bloqueada.statusCode).toBe(401);
      const semCorrelacao = (r: Record<string, unknown>) => ({ ...r, correlacao: null });
      expect(semCorrelacao(bloqueada.json())).toEqual(semCorrelacao(semConta.json()));
    });

    it('W0-10: o prestador troca a senha e o autenticador (reautenticação, confirmação pelo app novo, outras sessões caem)', async () => {
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const prestador = (await gestor.get(`${O}/portal/acessos`)).json().prestadores[0].id as number;
      const login = 'troca@clinica.invalid';
      const cria = await gestor.post(`${O}/portal/acessos`, {
        operadora: ope,
        prestador,
        login,
        nome: 'Responsável da Troca Sintético',
        tipoAtendimento: 1,
        funcoes: [3],
      });
      expect(cria.statusCode, cria.body).toBe(200);
      const at = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/ativacao`,
        remoteAddress: '10.0.3.1',
        payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-56' },
      });
      expect(at.statusCode, at.body).toBe(200);
      let segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
      let ipN = 10;
      const entrada = (senha: string, c = codigoTotp(segredo, Date.now())) =>
        ligado.inject({
          method: 'POST',
          url: `${PP}/aa/entrada`,
          remoteAddress: `10.0.3.${++ipN}`,
          payload: { login, senha, codigo: c },
        });
      const sessaoDe = (r: { headers: Record<string, unknown> }) => {
        const set = r.headers['set-cookie'] as string[];
        const cookie = set.map((c) => c.split(';')[0]).join('; ');
        const csrf =
          set
            .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
            ?.split(';')[0]
            ?.split('=')[1] ?? '';
        return {
          get: (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } }),
          post: (u: string, payload: object, comCsrf = true) =>
            ligado.inject({
              method: 'POST',
              url: u,
              payload,
              remoteAddress: `10.0.4.${++ipN}`,
              headers: { cookie, ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}) },
            }),
        };
      };
      const r1 = await entrada('senha-sintetica-56');
      expect(r1.statusCode, r1.body).toBe(200);
      const a1 = sessaoDe(r1);
      const r2 = await entrada('senha-sintetica-56');
      expect(r2.statusCode, r2.body).toBe(200);
      const a2 = sessaoDe(r2);
      const versaoAntes = (await atendimento.acesso(contextoDeTeste('aa', REDE), cria.json().id))?.versao;

      // A troca da senha: sem CSRF, 403; senha nova igual à atual ou fraca, 400; senha atual errada, 422 (conta no contador).
      const ROTA_SENHA = `${PP}/conta/senha`;
      const troca = {
        senhaAtual: 'senha-sintetica-56',
        codigo: codigoTotp(segredo, Date.now()),
        senhaNova: 'senha-nova-sint-78',
      };
      expect((await a1.post(ROTA_SENHA, troca, false)).statusCode).toBe(403);
      expect((await a1.post(ROTA_SENHA, { ...troca, senhaNova: 'senha-sintetica-56' })).statusCode).toBe(400);
      expect((await a1.post(ROTA_SENHA, { ...troca, senhaNova: 'semnumeros-sintetica' })).statusCode).toBe(
        400,
      );
      const errada = await a1.post(ROTA_SENHA, { ...troca, senhaAtual: 'senha-errada-0000' });
      expect(errada.statusCode).toBe(422);
      expect(errada.json().codigo).toBe('credencial-nao-confere');
      expect((await a1.post(ROTA_SENHA, { ...troca, codigo: '000000' })).json().codigo).toBe(
        'credencial-nao-confere',
      );
      const trocou = await a1.post(ROTA_SENHA, troca);
      expect(trocou.statusCode, trocou.body).toBe(200);
      expect(trocou.json().mensagem).toMatch(/Senha trocada/);
      // A sessão que trocou segue; a outra cai; a senha antiga deixa de entrar e a nova entra.
      expect((await a1.get(`${PP}/sessao`)).statusCode).toBe(200);
      expect((await a2.get(`${PP}/sessao`)).statusCode).toBe(401);
      expect((await entrada('senha-sintetica-56')).statusCode).toBe(401);
      const r3 = await entrada('senha-nova-sint-78');
      expect(r3.statusCode, r3.body).toBe(200);
      const a3 = sessaoDe(r3);
      const versaoDepois = (await atendimento.acesso(contextoDeTeste('aa', REDE), cria.json().id))?.versao;
      expect(versaoDepois).toBe((versaoAntes as number) + 1);

      // A troca do autenticador: confirmar sem iniciar, 409; iniciar confere a senha e o código atual.
      const AUT = `${PP}/conta/autenticador`;
      expect((await a1.post(`${AUT}/confirmacao`, { codigo: '123456' })).json().codigo).toBe(
        'autenticador-sem-pedido',
      );
      expect(
        (await a1.post(AUT, { senha: 'senha-sintetica-56', codigo: codigoTotp(segredo, Date.now()) })).json()
          .codigo,
      ).toBe('credencial-nao-confere');
      const ini = await a1.post(AUT, {
        senha: 'senha-nova-sint-78',
        codigo: codigoTotp(segredo, Date.now()),
      });
      expect(ini.statusCode, ini.body).toBe(200);
      const novo = new URL(ini.json().otpauth as string).searchParams.get('secret') as string;
      expect(novo).not.toBe(segredo);
      expect(ini.json().validoAte).toMatch(/^\d{4}-/);
      // O segredo novo é só da sessão que pediu; até a confirmação, o app atual segue valendo.
      expect(
        (await a3.post(`${AUT}/confirmacao`, { codigo: codigoTotp(novo, Date.now()) })).json().codigo,
      ).toBe('autenticador-sem-pedido');
      const errado = await a1.post(`${AUT}/confirmacao`, { codigo: codigoTotp(segredo, Date.now()) });
      expect(errado.json().codigo).toBe('codigo-novo-nao-confere');
      const conf = await a1.post(`${AUT}/confirmacao`, { codigo: codigoTotp(novo, Date.now()) });
      expect(conf.statusCode, conf.body).toBe(200);
      expect(conf.json().mensagem).toMatch(/Aplicativo autenticador trocado/);
      expect((await a3.get(`${PP}/sessao`)).statusCode).toBe(401);
      // O app antigo deixa de entrar; o novo entra.
      expect((await entrada('senha-nova-sint-78')).statusCode).toBe(401);
      segredo = novo;
      expect((await entrada('senha-nova-sint-78')).statusCode).toBe(200);
      // Encerrada a conta pelo credenciamento, a troca não acontece (a sessão cai).
      const v = (await atendimento.acesso(contextoDeTeste('aa', REDE), cria.json().id))?.versao as number;
      expect(
        (
          await gestor.post(`${O}/portal/acessos/${cria.json().id}/encerrar`, {
            versao: v,
            motivo: 'Conta sintética da troca encerrada',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await a1.post(ROTA_SENHA, {
            ...troca,
            senhaAtual: 'senha-nova-sint-78',
            senhaNova: 'outra-senha-sint-90',
          })
        ).statusCode,
      ).toBe(401);
    });

    it('W0-10: o prestador responde ao complemento com anexos (corpo grande pelo tipo próprio, recusas, só o dele, download)', async () => {
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const prestador = (await gestor.get(`${O}/portal/acessos`)).json().prestadores[0].id as number;
      const login = 'complemento@clinica.invalid';
      const cria = await gestor.post(`${O}/portal/acessos`, {
        operadora: ope,
        prestador,
        login,
        nome: 'Responsável do Complemento Sintético',
        tipoAtendimento: 1,
        funcoes: [1, 3],
      });
      expect(cria.statusCode, cria.body).toBe(200);
      const at = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/ativacao`,
        remoteAddress: '10.0.5.1',
        payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-57' },
      });
      expect(at.statusCode, at.body).toBe(200);
      const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
      const ok = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/entrada`,
        remoteAddress: '10.0.5.2',
        payload: { login, senha: 'senha-sintetica-57', codigo: codigoTotp(segredo, Date.now()) },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const set = ok.headers['set-cookie'] as string[];
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      const csrf =
        set
          .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
          ?.split(';')[0]
          ?.split('=')[1] ?? '';
      const pget = (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } });
      const ppost = (u: string, payload: object) =>
        ligado.inject({
          method: 'POST',
          url: u,
          payload,
          headers: { cookie, 'x-csrf-portal-prestador': csrf },
        });
      const responder = (u: string, corpo: object, comCsrf = true) =>
        ligado.inject({
          method: 'POST',
          url: u,
          payload: JSON.stringify(corpo),
          headers: {
            cookie,
            'content-type': 'application/vnd.sgh.anexos+json',
            ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}),
          },
        });
      const carteirinha = (await atende.get(P))
        .json()
        .itens.find((x: { carteirinha: string | null }) => x.carteirinha)?.carteirinha as string;
      const sol = await ppost(`${PP}/autorizacoes`, {
        carteirinha,
        tipoGuia: 4,
        carater: 'E',
        altaComplexidade: false,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação clínica sintética do complemento pelo portal',
        profissional: { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' },
        internacao: null,
        itens: [{ tabela: 22, codigo: '40304361', descricao: null, quantidade: 1 }],
      });
      expect(sol.statusCode, sol.body).toBe(200);
      const guia = sol.json().id as number;
      const ROTA = `${PP}/autorizacoes/${guia}/complemento`;
      const pdf = Buffer.from('%PDF-1.4\n% laudo sintetico\n%%EOF\n').toString('base64');
      // Um PNG de 1,5 MB: passa do teto padrão do JSON e entra pelo tipo próprio.
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(1_500_000, 7),
      ]).toString('base64');

      // Sem complemento pedido, a resposta não entra; o detalhe diz que não aguarda.
      expect((await pget(`${PP}/autorizacoes/${guia}`)).json().complemento).toEqual({
        pedido: null,
        aguardando: false,
        respostas: [],
      });
      expect(
        (await responder(ROTA, { versao: 1, resposta: 'Segue o laudo sintético', anexos: [] })).json().codigo,
      ).toBe('complemento-nao-pedido');

      // O auditor pede o complemento (pela porta, como a tela interna grava).
      await autorizacao.gravar(contextoDeTeste('aa', REDE), null as never, (g) =>
        g.pedirComplemento({
          id: guia,
          versao: 1,
          usuario: 'SINT.AUDITOR',
          pedido: 'Envie o laudo anterior',
        }),
      );
      const det = (await pget(`${PP}/autorizacoes/${guia}`)).json();
      expect(det.complemento).toMatchObject({
        pedido: 'Envie o laudo anterior',
        aguardando: true,
        respostas: [],
      });
      const versao = det.versao as number;
      const corpoOk = {
        versao,
        resposta: 'Segue o laudo anterior e a imagem sintética',
        anexos: [
          { nome: 'C:\\docs\\laudo.pdf', conteudo: pdf },
          { nome: 'imagem.png', conteudo: png },
        ],
      };

      // Recusas: sem CSRF; JSON comum grande (teto padrão); tipo errado; 6 anexos; versão velha; outra autorização.
      expect((await responder(ROTA, corpoOk, false)).statusCode).toBe(403);
      expect((await ppost(ROTA, corpoOk)).statusCode).toBe(413);
      const txt = Buffer.from('texto qualquer sintético').toString('base64');
      expect(
        (await responder(ROTA, { ...corpoOk, anexos: [{ nome: 'a.txt', conteudo: txt }] })).json().codigo,
      ).toBe('anexo-tipo');
      expect(
        (
          await responder(ROTA, {
            ...corpoOk,
            anexos: Array.from({ length: 6 }, (_, i) => ({ nome: `l${i}.pdf`, conteudo: pdf })),
          })
        ).statusCode,
      ).toBe(400);
      expect((await responder(ROTA, { ...corpoOk, versao: versao - 1 })).json().codigo).toBe(
        'autorizacao-desatualizada',
      );
      expect((await responder(`${PP}/autorizacoes/${guia + 999}/complemento`, corpoOk)).statusCode).toBe(404);
      expect((await pget(`${PP}/autorizacoes/${guia}`)).json().complemento.respostas).toEqual([]);

      const r = await responder(ROTA, corpoOk);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, versao: versao + 1, anexos: 2 });
      const depois = (await pget(`${PP}/autorizacoes/${guia}`)).json();
      expect(depois.situacao).toBe('em-analise');
      expect(depois.complemento.aguardando).toBe(false);
      expect(depois.complemento.respostas).toHaveLength(1);
      const resp = depois.complemento.respostas[0];
      expect(resp.texto).toBe('Segue o laudo anterior e a imagem sintética [anexos: laudo.pdf, imagem.png]');
      expect(resp.anexos.map((x: { nome: string; tipo: string }) => [x.nome, x.tipo])).toEqual([
        ['laudo.pdf', 'application/pdf'],
        ['imagem.png', 'image/png'],
      ]);
      // Respondido, não se responde de novo (o enviado não se edita).
      expect((await responder(ROTA, { ...corpoOk, versao: versao + 1 })).json().codigo).toBe(
        'complemento-nao-pedido',
      );

      // O download: o conteúdo, o tipo e o hash; de outra autorização, 404.
      const baixa = await pget(`${PP}/autorizacoes/${guia}/anexos/${resp.anexos[0].id}`);
      expect(baixa.statusCode).toBe(200);
      expect(baixa.headers['content-type']).toBe('application/pdf');
      expect(baixa.headers['x-anexo-sha256']).toBe(resp.anexos[0].sha256);
      expect(baixa.rawPayload.toString('base64')).toBe(pdf);
      expect((await pget(`${PP}/autorizacoes/${guia}/anexos/${resp.anexos[1].id}`)).rawPayload.length).toBe(
        1_500_008,
      );
      expect((await pget(`${PP}/autorizacoes/${guia + 999}/anexos/${resp.anexos[0].id}`)).statusCode).toBe(
        404,
      );
      expect((await pget(`${PP}/autorizacoes/${guia}/anexos/abc`)).statusCode).toBe(404);

      // A ficha interna da autorização lista os anexos (sem conteúdo) e baixa cada um; de outra autorização, 404.
      const ficha = (await atende.get(`${O}/autorizacoes/${guia}`)).json();
      expect(ficha.anexos.map((x: { nome: string; evento: number }) => [x.nome, x.evento])).toEqual([
        ['laudo.pdf', resp.evento],
        ['imagem.png', resp.evento],
      ]);
      const interna = await atende.get(`${O}/autorizacoes/${guia}/anexos/${ficha.anexos[0].id}`);
      expect(interna.statusCode).toBe(200);
      expect(interna.headers['content-type']).toBe('application/pdf');
      expect(interna.headers['x-anexo-sha256']).toBe(ficha.anexos[0].sha256);
      expect(interna.rawPayload.toString('base64')).toBe(pdf);
      expect(
        (await atende.get(`${O}/autorizacoes/${guia + 999}/anexos/${ficha.anexos[0].id}`)).statusCode,
      ).toBe(404);
    });

    it('W0-10: o prestador responde à interação da operadora no protocolo, com anexo (recusas, só o dele, ficha e download)', async () => {
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const prestador = (await gestor.get(`${O}/portal/acessos`)).json().prestadores[0].id as number;
      const login = 'interacao@clinica.invalid';
      const cria = await gestor.post(`${O}/portal/acessos`, {
        operadora: ope,
        prestador,
        login,
        nome: 'Responsável da Interação Sintética',
        tipoAtendimento: 1,
        funcoes: [3, 7],
      });
      expect(cria.statusCode, cria.body).toBe(200);
      const at = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/ativacao`,
        remoteAddress: '10.0.6.1',
        payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-58' },
      });
      expect(at.statusCode, at.body).toBe(200);
      const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
      const ok = await ligado.inject({
        method: 'POST',
        url: `${PP}/aa/entrada`,
        remoteAddress: '10.0.6.2',
        payload: { login, senha: 'senha-sintetica-58', codigo: codigoTotp(segredo, Date.now()) },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const set = ok.headers['set-cookie'] as string[];
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      const csrf =
        set
          .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
          ?.split(';')[0]
          ?.split('=')[1] ?? '';
      const pget = (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } });
      const responder = (u: string, corpo: object, comCsrf = true) =>
        ligado.inject({
          method: 'POST',
          url: u,
          payload: JSON.stringify(corpo),
          headers: {
            cookie,
            'content-type': 'application/vnd.sgh.anexos+json',
            ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}),
          },
        });

      // Um protocolo de atendimento aberto pelo prestador (como o canal do portal grava) e outro de outro prestador.
      const C = contextoDeTeste('aa', REDE);
      const base = {
        operadora: ope,
        instancia: 'atendimento',
        natureza: 'informacao',
        classe: 'nao-assistencial',
        canal: 'portal-prestador',
        origem: 1,
        solicitante: 'prestador',
        solicitanteNome: 'Clínica Sintética',
        beneficiario: null,
        carteirinha: null,
        autorizacao: null,
        origemProtocolo: null,
        numeroNip: null,
        urgente: false,
        altaComplexidade: false,
        assunto: 'Dúvida sintética do prestador',
        relato: 'Relato sintético da dúvida do prestador pelo portal',
        abertoEm: agora.slice(0, 19),
        prazoTipo: 'nao-assistencial',
        prazoEm: '2026-11-30T23:59:59',
        escritaPedida: false,
        usuario: 'SGH.PORTAL.PRESTADOR',
      };
      const registrar = (numero: string, pre: number) =>
        atendimento.gravar(C, null as never, (g) =>
          g.registrar({ ...base, protocolo: numero, prestador: pre }),
        ) as Promise<{ id: number; versao: number }>;
      // O protocolo do prestador nasce pelo portal (POST protocolos): CSRF, natureza do portal e regras do registro.
      const abrir = (corpo: object, comCsrf = true) =>
        ligado.inject({
          method: 'POST',
          url: `${PP}/protocolos`,
          payload: corpo,
          headers: { cookie, ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}) },
        });
      const carteirinhaPp = (await atende.get(P))
        .json()
        .itens.find((x: { carteirinha: string | null }) => x.carteirinha)?.carteirinha as string;
      const pedido = {
        natureza: 'informacao',
        carteirinha: carteirinhaPp,
        assunto: 'Dúvida sintética do prestador',
        relato: 'Relato sintético da dúvida do prestador pelo portal',
      };
      expect((await abrir(pedido, false)).statusCode).toBe(403);
      expect((await abrir({ ...pedido, natureza: 'reembolso' })).statusCode).toBe(400);
      expect((await abrir({ ...pedido, canal: 'telefone' })).statusCode).toBe(400);
      expect((await abrir({ ...pedido, carteirinha: undefined })).statusCode).toBe(400);
      const alheia = await abrir({ ...pedido, carteirinha: '9'.repeat(16) });
      expect(alheia.statusCode, alheia.body).toBe(409);
      expect(alheia.json().bloqueios).toContain('beneficiario-inexistente');
      const aberto = await abrir(pedido);
      expect(aberto.statusCode, aberto.body).toBe(200);
      expect(aberto.json()).toMatchObject({ ok: true });
      const numMeu = aberto.json().protocolo as string;
      expect(numMeu).toMatch(/^\d{20}$/);
      const meu = { id: aberto.json().id as number };
      expect((await atende.get(`${P}/${meu.id}`)).json()).toMatchObject({
        canal: 'portal-prestador',
        solicitante: 'prestador',
        solicitanteNome: 'Responsável da Interação Sintética',
        prestador,
        operadora: ope,
        situacao: 'aberto',
      });
      const outro = await registrar('90000820261118900002', prestador + 999);
      const ROTA = (id: number, ev: number) => `${PP}/protocolos/${id}/interacoes/${ev}/resposta`;

      // Sem interação da operadora, o portal não mostra nada para responder.
      let consulta = (await pget(`${PP}/protocolos/${numMeu}`)).json();
      expect(consulta).toMatchObject({ tipo: 'atendimento', versao: 1, respondivel: true, interacoes: [] });
      // A de outro prestador nem aparece.
      expect((await pget(`${PP}/protocolos/90000820261118900002`)).statusCode).toBe(409);

      // A operadora registra a interação (pela tela interna).
      const it1 = await atende.post(`${P}/${meu.id}/interacao`, {
        versao: 1,
        texto: 'Envie a nota fiscal sintética',
      });
      expect(it1.statusCode, it1.body).toBe(200);
      await atende.post(`${P}/${outro.id}/interacao`, { versao: 1, texto: 'Pergunta a outro prestador' });
      consulta = (await pget(`${PP}/protocolos/${numMeu}`)).json();
      expect(consulta.versao).toBe(2);
      expect(consulta.interacoes).toHaveLength(1);
      expect(consulta.interacoes[0]).toMatchObject({ texto: 'Envie a nota fiscal sintética', respostas: [] });
      const evento = consulta.interacoes[0].evento as number;
      const pdf = Buffer.from('%PDF-1.4\n% nota sintetica\n%%EOF\n').toString('base64');
      const corpoOk = {
        versao: 2,
        texto: 'Segue a nota fiscal sintética',
        anexo: { nome: 'nota.pdf', conteudo: pdf },
      };

      // Recusas: sem CSRF; tipo do anexo; versão velha; interação inexistente; protocolo de outro prestador.
      expect((await responder(ROTA(meu.id, evento), corpoOk, false)).statusCode).toBe(403);
      const txt = Buffer.from('texto sintético').toString('base64');
      expect(
        (
          await responder(ROTA(meu.id, evento), { ...corpoOk, anexo: { nome: 'a.txt', conteudo: txt } })
        ).json().codigo,
      ).toBe('anexo-tipo');
      expect((await responder(ROTA(meu.id, evento), { ...corpoOk, versao: 1 })).json().codigo).toBe(
        'protocolo-desatualizado',
      );
      expect((await responder(ROTA(meu.id, evento + 999), corpoOk)).json().codigo).toBe(
        'interacao-inexistente',
      );
      expect((await responder(ROTA(outro.id, evento), corpoOk)).statusCode).toBe(404);
      expect((await pget(`${PP}/protocolos/${numMeu}`)).json().interacoes[0].respostas).toEqual([]);

      const r = await responder(ROTA(meu.id, evento), corpoOk);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, id: meu.id, versao: 3 });
      consulta = (await pget(`${PP}/protocolos/${numMeu}`)).json();
      // A resposta gerou um evento no histórico, que não vira uma nova "interação" a responder.
      expect(consulta.interacoes).toHaveLength(1);
      expect(consulta.interacoes[0].respostas).toHaveLength(1);
      const resp = consulta.interacoes[0].respostas[0];
      expect(resp).toMatchObject({
        id: r.json().resposta,
        evento: r.json().evento,
        texto: 'Segue a nota fiscal sintética',
        anexo: { nome: 'nota.pdf', tipo: 'application/pdf' },
      });
      // A resposta não se edita; o prestador pode mandar outra (registro novo, a anterior fica). A resposta não é
      // interação a responder.
      expect((await responder(ROTA(meu.id, resp.evento), { ...corpoOk, versao: 3 })).json().codigo).toBe(
        'interacao-inexistente',
      );

      // O download pelo portal: conteúdo, tipo e hash; de outro protocolo, 404.
      const baixa = await pget(`${PP}/protocolos/${meu.id}/respostas/${resp.id}/anexo`);
      expect(baixa.statusCode).toBe(200);
      expect(baixa.headers['content-type']).toBe('application/pdf');
      expect(baixa.headers['x-anexo-sha256']).toBe(resp.anexo.sha256);
      expect(baixa.rawPayload.toString('base64')).toBe(pdf);
      expect((await pget(`${PP}/protocolos/${outro.id}/respostas/${resp.id}/anexo`)).statusCode).toBe(404);

      // A ficha interna mostra a resposta e o histórico; o anexo se baixa por quem lê os protocolos.
      const ficha = (await atende.get(`${P}/${meu.id}`)).json();
      expect(ficha.respostasPrestador).toEqual([resp]);
      expect(ficha.eventos.at(-1)).toMatchObject({
        evento: 'interacao',
        texto: 'Resposta do prestador: Segue a nota fiscal sintética [anexo: nota.pdf]',
      });
      const interna = await atende.get(`${P}/${meu.id}/respostas/${resp.id}/anexo`);
      expect(interna.statusCode).toBe(200);
      expect(interna.rawPayload.toString('base64')).toBe(pdf);
      expect((await atende.get(`${P}/${outro.id}/respostas/${resp.id}/anexo`)).statusCode).toBe(404);

      // Encerrado, a resposta não entra mais.
      const it2 = await atende.post(`${P}/${meu.id}/interacao`, {
        versao: 3,
        texto: 'Mais uma dúvida sintética',
      });
      expect(it2.statusCode, it2.body).toBe(200);
      const ev2 = (await pget(`${PP}/protocolos/${numMeu}`)).json().interacoes[1].evento as number;
      await atendimento.gravar(C, null as never, (g) =>
        g.cancelar({ id: meu.id, versao: 4, usuario: 'SINT', motivo: 'Cancelamento sintético' }),
      );
      const fechado = (await pget(`${PP}/protocolos/${numMeu}`)).json();
      expect(fechado.respondivel).toBe(false);
      expect((await responder(ROTA(meu.id, ev2), { ...corpoOk, versao: 5 })).json().codigo).toBe(
        'protocolo-fechado',
      );
    });

    it('W0-10 (M7): o prestador consulta a elegibilidade (validade, carências, cobertura), a consulta fica registrada; sem a função, 403', async () => {
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date(agora));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
      const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
      const ope = (await atende.get(`${P}/apoio`))
        .json()
        .operadoras.find((o: { registroAns: string }) => o.registroAns === '900008').id as number;
      const prestador = (await gestor.get(`${O}/portal/acessos`)).json().prestadores[0].id as number;
      const portal = async (login: string, funcoes: number[], ip: string) => {
        const cria = await gestor.post(`${O}/portal/acessos`, {
          operadora: ope,
          prestador,
          login,
          nome: 'Responsável da Elegibilidade Sintético',
          tipoAtendimento: 1,
          funcoes,
        });
        expect(cria.statusCode, cria.body).toBe(200);
        const at = await ligado.inject({
          method: 'POST',
          url: `${PP}/aa/ativacao`,
          remoteAddress: ip,
          payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-57' },
        });
        expect(at.statusCode, at.body).toBe(200);
        const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
        const ok = await ligado.inject({
          method: 'POST',
          url: `${PP}/aa/entrada`,
          remoteAddress: ip,
          payload: { login, senha: 'senha-sintetica-57', codigo: codigoTotp(segredo, Date.now()) },
        });
        expect(ok.statusCode, ok.body).toBe(200);
        const set = ok.headers['set-cookie'] as string[];
        const cookie = set.map((c) => c.split(';')[0]).join('; ');
        const csrf =
          set
            .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
            ?.split(';')[0]
            ?.split('=')[1] ?? '';
        return {
          get: (u: string) => ligado.inject({ method: 'GET', url: u, headers: { cookie } }),
          post: (u: string, payload: object, comCsrf = true) =>
            ligado.inject({
              method: 'POST',
              url: u,
              payload,
              headers: { cookie, ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}) },
            }),
        };
      };
      const pp = await portal('elegibilidade@clinica.invalid', [3], '10.0.7.1');
      const carteirinha = (await atende.get(P))
        .json()
        .itens.find((x: { carteirinha: string | null }) => x.carteirinha)?.carteirinha as string;
      const ok = await pp.post(`${PP}/elegibilidade`, { carteirinha });
      expect(ok.statusCode, ok.body).toBe(200);
      const r = ok.json();
      expect(r.data).toBe(agora.slice(0, 10));
      expect(r.beneficiario).not.toBeNull();
      expect(r.plano).not.toBeNull();
      expect(typeof r.registro).toBe('number');
      expect(r.cobertura.map((x: { atendimento: string }) => x.atendimento)).toEqual([
        'consulta',
        'sadt',
        'internacao',
        'parto',
      ]);
      expect(r.carteirinhaVencida).toBe(r.motivos.includes('carteirinha-vencida'));
      expect(r.elegivel).toBe(r.motivos.length === 0);
      // A carteirinha que não existe: inelegível, sem beneficiário, também registrada.
      const nao = (await pp.post(`${PP}/elegibilidade`, { carteirinha: '1234', data: '2026-10-20' })).json();
      expect(nao).toMatchObject({
        elegivel: false,
        beneficiario: null,
        plano: null,
        cobertura: [],
        data: '2026-10-20',
      });
      expect(nao.motivos.length).toBeGreaterThan(0);
      // As últimas consultas do prestador (mais nova primeiro), sem o nome do beneficiário.
      const lista = (await pp.get(`${PP}/elegibilidade`)).json().itens;
      expect(lista.slice(0, 2).map((x: { id: number }) => x.id)).toEqual([nao.registro, r.registro]);
      expect(JSON.stringify(lista)).not.toContain(r.beneficiario.nome);
      // Sem CSRF a consulta não entra; sem a função 1 ou 3, 403.
      expect((await pp.post(`${PP}/elegibilidade`, { carteirinha }, false)).statusCode).toBe(403);
      const so7 = await portal('elegibilidade7@clinica.invalid', [7], '10.0.7.2');
      const neg = await so7.post(`${PP}/elegibilidade`, { carteirinha });
      expect(neg.statusCode, neg.body).toBe(403);
      expect(neg.json().codigo).toBe('funcao-nao-liberada');
      expect((await so7.get(`${PP}/elegibilidade`)).statusCode).toBe(403);
    });
  },
);
