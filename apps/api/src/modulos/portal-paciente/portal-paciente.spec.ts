// M50, etapa 1 (portal do paciente) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada
// conecta a banco): o convite emitido pela recepção, o primeiro acesso em três passos (convite e nascimento com erro
// genérico, e-mail e senha com o CSRF do primeiro acesso, o segundo fator), a sessão do portal que não vale nas rotas
// internas (e a interna que não vale no portal), os resultados liberados do titular, o responsável legal de menor com a
// prova conferida por outra pessoa, a troca de pessoa, o consentimento pelo representante, o pedido do titular com a
// identidade verificada, o relatório de acessos, a entrada com o limite de tentativas e o bloqueio que derruba a
// sessão. Pacientes e e-mails SINTÉTICOS.
import { codigoTotp } from '@sgh/dominio-acesso';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { PortaSadtMemoria } from '../sadt/porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const documentos = new PortaDocumentosMemoria(trilha, null);
const sadt = new PortaSadtMemoria({ estado: () => 'verde' }, documentos);
let app: NestFastifyApplication;
let chave = 0;
/** O segredo do autenticador da conta sintética da 1003 (ativada no primeiro teste). */
let segredoCinthya = '';

/**
 * O código do autenticador vale uma vez (o passo aceito fica guardado): antes de usar o autenticador de novo, o relógio
 * do teste anda um passo (30 s). Só o Date é falso; os temporizadores seguem reais.
 */
const proximoPasso = () => vi.setSystemTime(Date.now() + 30_000);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, documentos, sadt, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  vi.useRealTimers();
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
const hi = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m50-${++chave}-${Date.now()}`,
});
const interno = (s: Sessao, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/portal-paciente${url}`,
    headers: hi(s),
    ...(payload ? { payload: payload as object } : {}),
  });

/** A sessão do portal: os cookies e o CSRF próprio. */
interface Portal {
  cookie: string;
  csrf: string;
}
function cookiesDe(set: string[] | string | undefined, base = ''): Portal {
  const lista = Array.isArray(set) ? set : set ? [set] : [];
  const mapa = new Map<string, string>();
  for (const c of base.split('; ').filter(Boolean)) mapa.set(c.split('=')[0]!, c);
  for (const c of lista) {
    const par = c.split(';')[0]!;
    const [k, v] = [par.split('=')[0]!, par.slice(par.indexOf('=') + 1)];
    if (v === '') mapa.delete(k);
    else mapa.set(k, par);
  }
  const cookie = [...mapa.values()].join('; ');
  return { cookie, csrf: (mapa.get('sgh_pac_csrf') ?? '').slice('sgh_pac_csrf='.length) };
}
const p = (
  s: Portal,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  ip = '10.50.0.1',
) =>
  app.inject({
    method,
    url: `/api/paciente${url}`,
    headers: { cookie: s.cookie, 'x-csrf-paciente': s.csrf },
    remoteAddress: ip,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const segredoDe = (otpauth: string) => new URL(otpauth).searchParams.get('secret') ?? '';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 1),
]);

async function primeiroAcesso(paciente: number, nascimento: string, email: string, ip: string) {
  const r = await entrar('SINT.RECEPCAO');
  const conv = await interno(r, 'POST', `/pacientes/${paciente}/convite`, { origem: 'recepcao' });
  expect(conv.statusCode).toBe(201);
  const codigo = conv.json().codigo as string;
  const a = await app.inject({
    method: 'POST',
    url: '/api/paciente/aa/convite',
    payload: { codigo, nascimento },
    remoteAddress: ip,
  });
  expect(a.statusCode).toBe(204);
  let s = cookiesDe(a.headers['set-cookie'] as string[]);
  const ini = await p(s, 'POST', '/ativacao', {
    codigo,
    nascimento,
    email,
    senha: 'frase-sintetica-longa',
    confirmacao: 'frase-sintetica-longa',
    termoUso: '2026.1',
    politicaPrivacidade: '2026.1',
  });
  expect(ini.statusCode).toBe(200);
  const segredo = segredoDe(ini.json().otpauth as string);
  const fim = await p(s, 'POST', '/ativacao/segundo-fator', { codigo: codigoTotp(segredo, Date.now()) });
  expect(fim.statusCode).toBe(200);
  s = cookiesDe(fim.headers['set-cookie'] as string[], s.cookie);
  return { s, segredo, sessao: fim.json() };
}

describe('portal do paciente: conta, primeiro acesso e separação das sessões', () => {
  it('convite, os três passos do primeiro acesso, os resultados liberados e as sessões que não se misturam', async () => {
    const r = await entrar('SINT.RECEPCAO');
    const antes = await interno(r, 'GET', '/pacientes/1003/conta');
    expect(antes.json()).toMatchObject({ conta: null, ligado: true });
    // Menor de idade não tem conta própria; o paciente com óbito não recebe convite.
    expect(
      (await interno(r, 'POST', '/pacientes/1005/convite', { origem: 'recepcao' })).json(),
    ).toMatchObject({
      codigo: 'menor-sem-conta-propria',
    });
    expect(
      (await interno(r, 'POST', '/pacientes/1007/convite', { origem: 'recepcao' })).json(),
    ).toMatchObject({
      codigo: 'obito',
    });
    const conv = await interno(r, 'POST', '/pacientes/1003/convite', { origem: 'recepcao' });
    expect(conv.statusCode).toBe(201);
    expect(conv.json()).toMatchObject({ destino: 'memoria' });
    const codigo = conv.json().codigo as string;
    expect(codigo).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    // Erro genérico: a data errada e o código errado dão a mesma resposta.
    const errada = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/convite',
      payload: { codigo, nascimento: '1990-07-02' },
    });
    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/convite',
      payload: { codigo: 'ABCD-EFGH-JKLM', nascimento: '1990-07-01' },
    });
    expect(errada.statusCode).toBe(401);
    expect(inexistente.json().detail).toBe(errada.json().detail);
    const a = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/convite',
      payload: { codigo, nascimento: '1990-07-01' },
    });
    expect(a.statusCode).toBe(204);
    const s0 = cookiesDe(a.headers['set-cookie'] as string[]);
    const dados = {
      codigo,
      nascimento: '1990-07-01',
      email: 'cinthya.sintetica@portal.test',
      senha: 'frase-sintetica-longa',
      confirmacao: 'frase-sintetica-longa',
      termoUso: '2026.1',
      politicaPrivacidade: '2026.1',
    };
    // Sem o CSRF do primeiro acesso, recusado; senha fraca, recusada; termo antigo, recusado.
    expect((await p({ cookie: s0.cookie, csrf: '' }, 'POST', '/ativacao', dados)).statusCode).toBe(403);
    expect(
      (await p(s0, 'POST', '/ativacao', { ...dados, senha: 'curta', confirmacao: 'curta' })).statusCode,
    ).toBe(400);
    expect((await p(s0, 'POST', '/ativacao', { ...dados, termoUso: '2025.9' })).statusCode).toBe(409);
    const ini = await p(s0, 'POST', '/ativacao', dados);
    expect(ini.statusCode).toBe(200);
    expect(ini.json().otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(ini.json().otpauth).not.toContain('cinthya.sintetica');
    const segredo = segredoDe(ini.json().otpauth as string);
    segredoCinthya = segredo;
    expect((await p(s0, 'POST', '/ativacao/segundo-fator', { codigo: '000000' })).statusCode).toBe(401);
    const fim = await p(s0, 'POST', '/ativacao/segundo-fator', { codigo: codigoTotp(segredo, Date.now()) });
    expect(fim.statusCode).toBe(200);
    expect(fim.json()).toMatchObject({ hospital: 'aa', soResponsavel: false, ativo: { vinculo: null } });
    const s = cookiesDe(fim.headers['set-cookie'] as string[], s0.cookie);
    // A conta vista pela recepção: ativa, e-mail só mascarado.
    const depois = (await interno(r, 'GET', '/pacientes/1003/conta')).json();
    expect(depois.conta).toMatchObject({ situacao: 'ativa', segundoFator: true });
    expect(depois.conta.emailMascarado).toMatch(/^ci\*\*\*@po\*\*\*\.test$/);
    // Os resultados liberados de setor publicado (a regra do M26) aparecem; o resultado aberto grava a visualização.
    const docs = await p(s, 'GET', '/documentos');
    expect(docs.statusCode).toBe(200);
    const itens = docs.json().itens as { origem: string; item: string; visto: boolean }[];
    expect(itens.some((i) => i.origem === 'resultado')).toBe(true);
    const res = itens.find((i) => i.origem === 'resultado')!;
    expect((await p({ ...s, csrf: '' }, 'POST', `/documentos/resultado/${res.item}`, {})).statusCode).toBe(
      403,
    );
    const aberto = await p(s, 'POST', `/documentos/resultado/${res.item}`, {});
    expect(aberto.statusCode).toBe(200);
    expect(aberto.json().laudo).toMatchObject({ visualizado: true, paciente: null });
    // Um resultado de outro paciente não abre (o número existe, o dono não confere).
    expect((await p(s, 'POST', '/documentos/resultado/999999', {})).statusCode).toBe(404);
    // A sessão do portal não vale nas rotas internas; a interna não vale no portal.
    expect([401, 403]).toContain(
      (
        await app.inject({
          method: 'GET',
          url: '/api/portal-paciente/pacientes/1003/conta',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/paciente/eu', headers: { cookie: r.cookie } }))
        .statusCode,
    ).toBe(401);
    // Conta e segurança: e-mail mascarado; trocar a senha pede a atual e o código.
    expect((await p(s, 'GET', '/seguranca')).json().emailMascarado).toMatch(/\*\*\*/);
    // O código da ativação não vale de novo (replay): nem na troca da senha.
    const repetido = {
      atual: 'frase-sintetica-longa',
      nova: 'outra-frase-longa',
      confirmacao: 'outra-frase-longa',
      codigo: codigoTotp(segredo, Date.now()),
    };
    expect((await p(s, 'POST', '/senha', repetido)).statusCode).toBe(401);
    proximoPasso();
    const troca = {
      atual: 'errada-errada',
      nova: 'outra-frase-longa',
      confirmacao: 'outra-frase-longa',
      codigo: codigoTotp(segredo, Date.now()),
    };
    expect((await p(s, 'POST', '/senha', troca)).statusCode).toBe(401);
    expect((await p(s, 'POST', '/senha', { ...troca, atual: 'frase-sintetica-longa' })).statusCode).toBe(204);
    // Sair e entrar de novo com e-mail, senha nova e código (o do passo seguinte).
    proximoPasso();
    expect((await p(s, 'DELETE', '/sessao')).statusCode).toBe(204);
    const e = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/entrada',
      payload: {
        email: 'CINTHYA.sintetica@portal.test',
        senha: 'outra-frase-longa',
        codigo: codigoTotp(segredo, Date.now()),
      },
      remoteAddress: '10.50.0.9',
    });
    expect(e.statusCode).toBe(200);
    expect(e.json().primeiroNome).toBe('Cinthya');
  });

  it('entrada: erro genérico, limite de tentativas da conta e bloqueio pelo hospital que derruba a sessão', async () => {
    const { s, segredo } = await primeiroAcesso(
      1001,
      '1958-03-12',
      'jose.sintetico@portal.test',
      '10.50.1.1',
    );
    const entrarCom = (senha: string, ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/paciente/aa/entrada',
        payload: { email: 'jose.sintetico@portal.test', senha, codigo: codigoTotp(segredo, Date.now()) },
        remoteAddress: ip,
      });
    const semConta = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/entrada',
      payload: { email: 'ninguem@portal.test', senha: 'x', codigo: '123456' },
      remoteAddress: '10.50.1.2',
    });
    const errada = await entrarCom('errada', '10.50.1.3');
    expect(semConta.statusCode).toBe(401);
    expect(errada.json().detail).toBe(semConta.json().detail);
    for (let i = 0; i < 4; i++) await entrarCom('errada', `10.50.1.${10 + i}`);
    expect((await entrarCom('frase-sintetica-longa', '10.50.1.20')).statusCode).toBe(429);
    // O limite de taxa por origem (10 por minuto).
    let ultimo = 0;
    for (let i = 0; i < 11; i++)
      ultimo = (
        await app.inject({
          method: 'POST',
          url: '/api/paciente/aa/entrada',
          payload: { email: 'x@portal.test', senha: 'x', codigo: '123456' },
          remoteAddress: '10.50.2.1',
        })
      ).statusCode;
    expect(ultimo).toBe(429);
    // O hospital bloqueia (crítica; a sessão sintética sem cookie de dev não reautentica): a sessão cai na hora.
    const adm = await entrar('SINT.PRIVACIDADE');
    const conta = (await interno(adm, 'GET', '/pacientes/1001/conta')).json().conta.conta as string;
    const b = await interno(adm, 'POST', `/contas/${conta}/bloqueio`, {
      motivo: 'suspeita-de-fraude',
      justificativa: 'teste sintético de bloqueio da conta',
      senha: SENHA,
    });
    expect(b.statusCode).toBe(200);
    {
      expect(b.json()).toMatchObject({ situacao: 'bloqueada', motivo: 'suspeita-de-fraude' });
      expect((await p(s, 'GET', '/eu')).statusCode).toBe(401);
    }
  });
});

describe('portal do paciente: responsável legal de menor, consentimento, pedido e acessos', () => {
  it('a mãe pede o acesso do filho com a prova; outra pessoa confere; troca de pessoa, consente, pede e vê os acessos', async () => {
    proximoPasso();
    const e = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/entrada',
      payload: {
        email: 'cinthya.sintetica@portal.test',
        senha: 'outra-frase-longa',
        codigo: codigoTotp(segredoCinthya, Date.now()),
      },
      remoteAddress: '10.50.3.1',
    });
    expect(e.statusCode).toBe(200);
    const s = cookiesDe(e.headers['set-cookie'] as string[]);
    // A prova: o tipo conferido pelos primeiros bytes (o "PNG" que não é PNG é recusado).
    expect(
      (
        await p(s, 'POST', '/vinculos/arquivo', {
          tipo: 'image/png',
          conteudo: Buffer.alloc(40, 7).toString('base64'),
        })
      ).statusCode,
    ).toBe(400);
    // Cada recusa consome o arquivo enviado: cada tentativa vai com um envio novo.
    const enviar = async () => {
      const arq = await p(s, 'POST', '/vinculos/arquivo', {
        tipo: 'image/png',
        conteudo: PNG.toString('base64'),
      });
      expect(arq.statusCode).toBe(201);
      return arq.json().arquivo as string;
    };
    const pedido = {
      prontuario: 501005,
      nascimento: '2016-05-10',
      tipo: 'pai-mae',
      prova: 'certidao-nascimento',
      validade: null,
    };
    // Recusas: a data que não confere (erro genérico), a prova que não serve ao vínculo e o arquivo de outra sessão.
    const usado = await enviar();
    expect(
      (await p(s, 'POST', '/vinculos', { ...pedido, arquivo: usado, nascimento: '2016-05-11' })).json(),
    ).toMatchObject({
      codigo: 'titular-inativo',
    });
    // O arquivo da tentativa recusada não serve de novo.
    expect((await p(s, 'POST', '/vinculos', { ...pedido, arquivo: usado })).json()).toMatchObject({
      codigo: 'arquivo-ausente',
    });
    expect(
      (await p(s, 'POST', '/vinculos', { ...pedido, arquivo: await enviar(), prova: 'procuracao' })).json(),
    ).toMatchObject({
      codigo: 'prova-nao-aceita',
    });
    expect(
      (await p(s, 'POST', '/vinculos', { ...pedido, arquivo: 'portal/provas/0000000000000000-png' }))
        .statusCode,
    ).toBe(400);
    // Pedido para maior com vínculo de menor: recusado.
    expect(
      (
        await p(s, 'POST', '/vinculos', {
          ...pedido,
          arquivo: await enviar(),
          prontuario: 501001,
          nascimento: '1958-03-12',
        })
      ).json(),
    ).toMatchObject({ codigo: 'titular-maior' });
    const arquivo = await enviar();
    const v = await p(s, 'POST', '/vinculos', { ...pedido, arquivo });
    expect(v.statusCode).toBe(201);
    // Pendente: o nome do titular não volta a quem pediu (só depois da aprovação).
    expect(v.json()).toMatchObject({ situacao: 'pendente', tipo: 'pai-mae', primeiroNomeOutro: '' });
    expect((await p(s, 'POST', '/vinculos', { ...pedido, arquivo })).statusCode).toBe(400);
    const vinculo = v.json().vinculo as string;
    // Pendente: o menor ainda não aparece entre as pessoas da sessão.
    expect((await p(s, 'GET', '/eu')).json().titulares).toHaveLength(1);
    // A conferência (outra pessoa): a fila com o pedido, a prova e a aprovação.
    const adm = await entrar('SINT.PRIVACIDADE');
    const fila = await interno(adm, 'GET', '/vinculos?situacao=pendente');
    expect(fila.statusCode).toBe(200);
    const item = (
      fila.json() as {
        itens: { vinculo: string; temArquivo: boolean; canal: string; primeiroNomeResponsavel: string }[];
      }
    ).itens.find((x) => x.vinculo === vinculo);
    expect(item).toMatchObject({ temArquivo: true, canal: 'portal', primeiroNomeResponsavel: 'Cinthya' });
    // A busca pelo prontuário do titular e o filtro inválido.
    const busca = await interno(adm, 'GET', '/vinculos?situacao=todas&prontuario=501005');
    expect(busca.json()).toMatchObject({ itens: [expect.objectContaining({ vinculo })], proximo: null });
    expect((await interno(adm, 'GET', '/vinculos?situacao=todas&prontuario=999999')).json()).toEqual({
      itens: [],
      proximo: null,
    });
    expect((await interno(adm, 'GET', '/vinculos?prontuario=abc')).statusCode).toBe(400);
    // Na ficha do paciente: os responsáveis vigentes do titular.
    const ficha = await interno(adm, 'GET', '/pacientes/1005/responsaveis');
    expect(ficha.statusCode).toBe(200);
    expect(ficha.json()).toEqual([expect.objectContaining({ vinculo, situacao: 'pendente' })]);
    const prova = await interno(adm, 'GET', `/vinculos/${vinculo}/prova`);
    expect(prova.json()).toMatchObject({ tipo: 'image/png', conteudo: PNG.toString('base64') });
    const sem = await entrar('SINT.RECEPCAO');
    expect((await interno(sem, 'GET', '/vinculos?situacao=pendente')).statusCode).toBe(403);
    const dec = await interno(adm, 'POST', `/vinculos/${vinculo}/decisao`, {
      decisao: 'aprovar',
      escopos: ['documentos', 'consentimentos', 'pedidos'],
      validade: null,
      senha: SENHA,
    });
    expect(dec.statusCode).toBe(200);
    expect(dec.json()).toMatchObject({
      situacao: 'ativo',
      escopos: ['consentimentos', 'documentos', 'pedidos'],
    });
    expect(
      (
        await interno(adm, 'POST', `/vinculos/${vinculo}/decisao`, {
          decisao: 'recusar',
          motivo: 'decisão repetida de teste',
          senha: SENHA,
        })
      ).json(),
    ).toMatchObject({
      codigo: 'ja-decidido',
    });
    // Aprovado: agora quem pediu vê o primeiro nome do titular.
    expect(
      ((await p(s, 'GET', '/vinculos')).json().meus as { vinculo: string; primeiroNomeOutro: string }[]).find(
        (x) => x.vinculo === vinculo,
      ),
    ).toMatchObject({ primeiroNomeOutro: 'Enzo' });
    // A sessão da mãe: duas pessoas; troca para o filho.
    const eu = (await p(s, 'GET', '/eu')).json();
    expect(eu.titulares.map((t: { primeiroNome: string }) => t.primeiroNome)).toEqual(['Cinthya', 'Enzo']);
    const troca = await p(s, 'PUT', '/titular', { vinculo });
    expect(troca.json().ativo).toMatchObject({ vinculo, primeiroNome: 'Enzo' });
    expect((await p(s, 'PUT', '/titular', { vinculo: '999999' })).statusCode).toBe(404);
    expect((await p(s, 'GET', '/documentos')).statusCode).toBe(200);
    // Consentimento pelo representante: "atendimento" não se muda pelo portal; a decisão nova substitui a anterior.
    expect(
      (
        await p(s, 'POST', '/consentimentos', {
          acao: 'consentir',
          finalidade: 'atendimento',
          versao: '2026.1',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await p(s, 'POST', '/consentimentos', { acao: 'consentir', finalidade: 'pesquisa', versao: '2025.1' }))
        .statusCode,
    ).toBe(409);
    await p(s, 'POST', '/consentimentos', { acao: 'consentir', finalidade: 'pesquisa', versao: '2026.1' });
    const cons = await p(s, 'POST', '/consentimentos', {
      acao: 'nao-consentir',
      finalidade: 'pesquisa',
      versao: '2026.1',
    });
    expect(cons.statusCode).toBe(200);
    const lista = cons.json() as {
      finalidade: string;
      consentiu: boolean;
      signatario: string;
      revogadoEm: string | null;
      consentimento: number;
    }[];
    const vigente = lista.find((c) => c.finalidade === 'pesquisa' && c.revogadoEm === null)!;
    expect(vigente).toMatchObject({ consentiu: false, signatario: 'representante-legal' });
    expect(lista.filter((c) => c.finalidade === 'pesquisa' && c.revogadoEm !== null)).toHaveLength(1);
    const rev = await p(s, 'POST', '/consentimentos', {
      acao: 'revogar',
      consentimento: vigente.consentimento,
    });
    expect((rev.json() as { revogadoEm: string | null }[]).every((c) => c.revogadoEm !== null)).toBe(true);
    // Pedido do titular pelo responsável: identidade verificada (D-IDENT-50).
    const ped = await p(s, 'POST', '/pedidos', {
      tipo: 'acesso',
      descricao: 'Cópia dos dados do meu filho (teste sintético)',
    });
    expect(ped.statusCode).toBe(201);
    expect(ped.json().protocolo).toMatch(/^\d{4}-\d{6}$/);
    expect((await p(s, 'GET', '/pedidos')).json()[0]).toMatchObject({
      tipo: 'acesso',
      situacao: 'identidade-verificada',
      atrasado: false,
    });
    // O relatório de acessos do filho: a abertura pelo portal aparece como "Seu responsável"? (não houve abertura: vazio)
    const hoje = new Date().toISOString().slice(0, 10);
    const ac = await p(s, 'GET', `/acessos?de=2026-01-01&ate=${hoje}`);
    expect(ac.statusCode).toBe(200);
    expect(ac.json()).toMatchObject({ de: '2026-01-01', ate: hoje });
    expect((await p(s, 'GET', '/acessos?de=2020-01-01&ate=2026-10-24')).statusCode).toBe(400);
    // Volta para si: o próprio relatório tem a abertura do resultado pelo portal ("Você").
    await p(s, 'PUT', '/titular', { vinculo: null });
    const meu = (await p(s, 'GET', `/acessos?de=2026-01-01&ate=${hoje}`)).json();
    expect(
      meu.itens.some((i: { natureza: string; quem: string }) => i.natureza === 'portal' && i.quem === 'Você'),
    ).toBe(true);
    // Vínculos vistos dos dois lados; a mãe não revoga o próprio vínculo de pai/mãe (não é titular dele).
    expect((await p(s, 'GET', '/vinculos')).json().meus).toHaveLength(1);
    expect((await p(s, 'DELETE', `/vinculos/${vinculo}`)).statusCode).toBe(404);
    // O hospital encerra o vínculo: o filho some da sessão.
    expect(
      (
        await interno(adm, 'POST', `/vinculos/${vinculo}/encerramento`, {
          motivo: 'revogado-pelo-hospital',
          justificativa: 'teste sintético de encerramento',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(204);
    expect((await p(s, 'GET', '/eu')).json().titulares).toHaveLength(1);
  });

  it('responsável sem cadastro no balcão (D-RESP-50): conta de responsável e vínculo já liberado; ativa e vê só o representado', async () => {
    const adm = await entrar('SINT.PRIVACIDADE');
    const r = await interno(adm, 'POST', '/pacientes/1005/responsavel', {
      nome: 'Tutora Sintetica Teste',
      nascimento: '1975-02-02',
      tipo: 'tutor',
      prova: 'termo-tutela',
      validade: null,
      escopos: ['documentos'],
      senha: SENHA,
    });
    expect(r.statusCode).toBe(201);
    const codigo = r.json().codigo as string;
    const a = await app.inject({
      method: 'POST',
      url: '/api/paciente/aa/convite',
      payload: { codigo, nascimento: '1975-02-02' },
      remoteAddress: '10.50.4.1',
    });
    expect(a.statusCode).toBe(204);
    const s0 = cookiesDe(a.headers['set-cookie'] as string[]);
    const ini = await p(s0, 'POST', '/ativacao', {
      codigo,
      nascimento: '1975-02-02',
      email: 'tutora.sintetica@portal.test',
      senha: 'frase-sintetica-longa',
      confirmacao: 'frase-sintetica-longa',
      termoUso: '2026.1',
      politicaPrivacidade: '2026.1',
    });
    const fim = await p(s0, 'POST', '/ativacao/segundo-fator', {
      codigo: codigoTotp(segredoDe(ini.json().otpauth as string), Date.now()),
    });
    expect(fim.statusCode).toBe(200);
    expect(fim.json()).toMatchObject({
      soResponsavel: true,
      primeiroNome: 'Tutora',
      ativo: { primeiroNome: 'Enzo', escopos: ['documentos'] },
    });
    const s = cookiesDe(fim.headers['set-cookie'] as string[], s0.cookie);
    // Sem o escopo dos consentimentos e dos pedidos.
    expect((await p(s, 'GET', '/consentimentos')).statusCode).toBe(403);
    expect((await p(s, 'POST', '/pedidos', { tipo: 'acesso', descricao: null })).statusCode).toBe(403);
    expect((await p(s, 'GET', '/documentos')).statusCode).toBe(200);
  });
});
