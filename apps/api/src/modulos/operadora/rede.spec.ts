// M56 (etapa 4, F3) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco):
// a rede credenciada nasce desligada (o apoio diz o motivo; o resto dá 403 recurso-desligado); ligada pelo
// administrador (o registro na ANS cumprido, a chave do módulo e a da rede), o credenciamento com as regras (documento,
// pessoa × tipo, município na UF, domínios, contratação indireta, o próprio hospital com o convênio), o CPF mascarado na
// lista e por inteiro na ficha lida (com a trilha), a alteração com e sem campo do RPS, a versão vista, o
// descredenciamento do hospitalar (substituto ou autorização da ANS, prazo do aviso), a reinclusão, os movimentos do RPS
// e quem só consulta. Documentos SINTÉTICOS (dígitos calculados).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { cnpjSintetico } from './rede-porta-memoria.js';
import { moduloOperadora } from './modulo.js';
import { cursorPrestador, lerCursorPrestador } from './rede.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'config,operadora' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let n = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      config: () => import('../config/modulo.js'),
      operadora: async () => ({ modulo: (ctx) => moduloOperadora(ctx) }),
    },
  });
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
  'idempotency-key': `teste-m56-4-${++n}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as object });

const O = '/api/operadora';
const CPF = '52998224725';
const CNPJ = cnpjSintetico('900000990001');
const CNPJ_HOSP = cnpjSintetico('900000980001');

const hoje = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const somaDias = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

const contrato = { numero: 'SINT-C1', inicio: '2026-11-01', fim: null, formaReajuste: 1, mesReajuste: 11 };
const consultorio = {
  pessoa: 'F',
  documento: '529.982.247-25',
  nome: 'Consultório sintético Delta',
  nomeFantasia: null,
  cnes: null,
  uf: 'SC',
  municipioIbge: 4205407,
  tipo: 1,
  natureza: 1,
  classificacao: 3,
  contratacao: 1,
  operadoraIntermediaria: null,
  disponibilidade: 1,
  isencaoOnus: 1,
  urgencia: false,
  regime: 1,
  remuneracao: 1,
  contrato,
  ehOHospital: false,
  estabelecimento: null,
  convenio: null,
};

async function ligar(admin: Sessao, chave: string, ligar = true) {
  const r = await post(admin, '/api/administracao/liberacao', {
    chave,
    tipo: 'recurso',
    escopo: 'hospital',
    valores: ['*'],
    ligar,
    justificativa: 'ligação sintética de teste da rede',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

describe('rede credenciada da operadora (etapa 4, F3), pela HTTP', { timeout: 120_000 }, () => {
  it('desligada: o apoio diz o motivo; a lista e a gravação dão 403 recurso-desligado; sem perfil, 403', async () => {
    const c = await entrar('SINT.CREDENCIAMENTO');
    const a = await get(c, `${O}/rede/apoio`);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ ligada: false, podeEditar: false });
    expect(a.json().motivo).toMatch(/desligada/);
    expect(JSON.stringify(a.json())).not.toMatch(/SPDATA|legado/i);
    const l = await get(c, `${O}/prestadores`);
    expect(l.statusCode).toBe(403);
    expect(l.json().codigo).toBe('recurso-desligado');
    expect((await post(c, `${O}/prestadores`, consultorio)).statusCode).toBe(403);
    for (const login of ['SINT.ADMIN', 'SINT.FATURAMENTO'])
      expect((await get(await entrar(login), `${O}/rede/apoio`)).statusCode, login).toBe(403);
  });

  it('ligada pelo administrador: apoio, lista, credenciamento com as regras, ficha, alteração, descredenciamento, reinclusão e RPS', async () => {
    const admin = await entrar('SINT.ADMIN');
    // A fatia ligada sem o módulo não vale (regra 1).
    await ligar(admin, 'operadora.rede');
    const c = await entrar('SINT.CREDENCIAMENTO');
    expect((await get(c, `${O}/rede/apoio`)).json().ligada).toBe(false);
    const pre = await app.inject({
      method: 'PUT',
      url: '/api/administracao/liberacao/prerequisitos',
      headers: h(admin),
      payload: {
        recurso: 'operadora',
        tipo: 'credenciamento',
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'registro sintético 900001',
        senha: SENHA,
      },
    });
    expect(pre.statusCode, pre.body).toBe(200);
    await ligar(admin, 'operadora');

    const apoio = (await get(c, `${O}/rede/apoio`)).json();
    expect(apoio).toMatchObject({ ligada: true, motivo: null, podeEditar: true });
    expect(apoio.dominios.tipo).toHaveLength(8);
    expect(apoio.dominios.tipo[2]).toEqual({ codigo: 3, rotulo: 'Hospital geral' });
    expect(apoio.dominios.movimento.map((m: { rotulo: string }) => m.rotulo)).toEqual([
      'Inclusão',
      'Alteração',
      'Exclusão',
      'Reinclusão',
    ]);
    expect(apoio.convenios[0]).toEqual({
      codigo: 990,
      nome: 'Operadora própria (sintético)',
      registroAns: 900001,
    });
    expect(apoio.estabelecimentos.map((e: { codigo: string }) => e.codigo)).toContain('aa');

    const l0 = (await get(c, `${O}/prestadores`)).json();
    expect(l0.itens.map((p: { nome: string }) => p.nome)).toEqual([
      'Hospital sintético Beta',
      'Hospital sintético Gama',
      'Laboratório sintético Alfa',
    ]);
    expect(l0.totais).toEqual({
      credenciados: 3,
      descredenciados: 0,
      hospitalares: 2,
      saidasAgendadas: 0,
      rpsPendentes: 0,
    });

    // Regras do credenciamento (nada gravado).
    const recusa = async (x: object, codigo: string) => {
      const r = await post(c, `${O}/prestadores`, { ...consultorio, ...x });
      expect(r.statusCode, codigo).toBe(409);
      expect(r.json().codigo).toBe(codigo);
      return r.json();
    };
    await recusa({ documento: '52998224724' }, 'documento-invalido');
    expect((await recusa({ tipo: 3 }, 'pessoa-incompativel-com-tipo')).detail).toMatch(/consultório médico/);
    await recusa({ municipioIbge: 3550308 }, 'municipio-fora-da-uf');
    await recusa({ natureza: 9 }, 'dominio-invalido');
    await recusa({ contratacao: 2 }, 'intermediaria-obrigatoria');
    await recusa({ convenio: 12345 }, 'convenio-inexistente');
    await recusa({ contrato: { ...contrato, fim: '2026-10-01' } }, 'contrato-fim-antes-do-inicio');
    expect((await post(c, `${O}/prestadores`, { ...consultorio, pessoa: 'X' })).statusCode).toBe(400);
    expect((await get(c, `${O}/prestadores`)).json().totais.credenciados).toBe(3);

    // Credencia o consultório (pessoa física): CPF mascarado na lista, inteiro na ficha (leitura na trilha).
    const cred = await post(c, `${O}/prestadores`, consultorio);
    expect(cred.statusCode, cred.body).toBe(200);
    expect(cred.json()).toMatchObject({ ok: true, versao: 1, movimento: 1 });
    const id = cred.json().id as number;
    expect(
      trilha.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS.operadoraPrestadorCredenciado.codigo),
    ).toBe(true);
    const busca = (await get(c, `${O}/prestadores?busca=${encodeURIComponent('delta')}`)).json();
    expect(busca.itens).toHaveLength(1);
    expect(busca.itens[0].documento).toBe('***.***.247-25');
    expect((await get(c, `${O}/prestadores?busca=${CPF}`)).json().itens[0].id).toBe(id);
    const ficha = await get(c, `${O}/prestadores/${id}`);
    expect(ficha.json()).toMatchObject({
      documento: '529.982.247-25',
      situacao: 'credenciado',
      hospitalar: false,
    });
    expect(ficha.json().movimentos.map((m: { movimento: number }) => m.movimento)).toEqual([1]);
    expect(trilha.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS.operadoraPrestadorLido.codigo)).toBe(
      true,
    );
    expect((await get(c, `${O}/prestadores/999999`)).statusCode).toBe(404);
    expect((await post(c, `${O}/prestadores`, consultorio)).json().codigo).toBe('documento-ja-credenciado');

    // O próprio hospital (pessoa jurídica, estabelecimento da Rede, convênio do hospital); um por estabelecimento.
    const hosp = {
      ...consultorio,
      pessoa: 'J',
      documento: CNPJ_HOSP,
      nome: 'Hospital da Rede (sintético)',
      cnes: '9000098',
      tipo: 3,
      classificacao: 1,
      regime: 3,
      ehOHospital: true,
      estabelecimento: 'aa',
      convenio: 990,
    };
    const rh = await post(c, `${O}/prestadores`, hosp);
    expect(rh.statusCode, rh.body).toBe(200);
    expect((await post(c, `${O}/prestadores`, { ...hosp, documento: CNPJ })).json().codigo).toBe(
      'hospital-ja-na-rede',
    );
    expect(
      (await post(c, `${O}/prestadores`, { ...hosp, documento: CNPJ, estabelecimento: 'zz' })).json().codigo,
    ).toBe('estabelecimento-fora-da-rede');

    // Alteração: o regime não vai ao RPS; o CNES vai; a versão velha é recusada.
    const base = { ...consultorio };
    delete (base as Partial<typeof base>).pessoa;
    delete (base as Partial<typeof base>).documento;
    const a1 = await post(c, `${O}/prestadores/${id}/alterar`, { ...base, versao: 1, regime: 2 });
    expect(a1.json()).toMatchObject({ versao: 2, movimento: null });
    expect(a1.json().mensagem).toMatch(/Nada muda/);
    const a2 = await post(c, `${O}/prestadores/${id}/alterar`, {
      ...base,
      versao: 2,
      regime: 2,
      cnes: '9000077',
    });
    expect(a2.json()).toMatchObject({ versao: 3, movimento: 2 });
    expect((await post(c, `${O}/prestadores/${id}/alterar`, { ...base, versao: 1 })).json().codigo).toBe(
      'prestador-desatualizado',
    );
    const movs = (await get(c, `${O}/prestadores/${id}`)).json().movimentos;
    expect(movs[0]).toMatchObject({ movimento: 2, campos: ['cnes'], situacao: 'pendente' });

    // Descredenciamento do hospitalar Beta (ID 2): substituto ou autorização da ANS; aviso de 30 dias.
    const beta = (await get(c, `${O}/prestadores/2`)).json();
    const desc = {
      versao: beta.versao,
      motivo: 'Encerramento do contrato pela diretoria (sintético)',
      efetivoEm: somaDias(hoje(), 30),
      avisoBeneficiariosEm: hoje(),
      substituto: null,
      autorizacaoAns: null,
    };
    expect((await post(c, `${O}/prestadores/2/descredenciar`, desc)).json().codigo).toBe(
      'substituto-obrigatorio',
    );
    expect(
      (
        await post(c, `${O}/prestadores/2/descredenciar`, {
          ...desc,
          substituto: 3,
          efetivoEm: somaDias(hoje(), 29),
        })
      ).json().codigo,
    ).toBe('prazo-do-aviso');
    expect(
      (await post(c, `${O}/prestadores/2/descredenciar`, { ...desc, substituto: 1 })).json().codigo,
    ).toBe('substituto-nao-hospitalar');
    const d = await post(c, `${O}/prestadores/2/descredenciar`, { ...desc, substituto: 3 });
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json()).toMatchObject({ movimento: 3 });
    expect(d.json().avisos[0]).toMatch(/outro município/);
    expect(
      (
        await post(c, `${O}/prestadores/2/descredenciar`, { ...desc, versao: beta.versao + 1, substituto: 3 })
      ).json().codigo,
    ).toBe('saida-ja-agendada');
    // A saída fica agendada: até a data o Beta segue credenciado (lista, contagens), com a data da saída.
    expect((await get(c, `${O}/prestadores/2`)).json()).toMatchObject({
      situacao: 'credenciado',
      saidaEm: somaDias(hoje(), 30),
    });
    const ids = async (q: string) =>
      (await get(c, `${O}/prestadores${q}`)).json().itens.map((p: { id: number }) => p.id);
    expect(await ids('?situacao=credenciado')).toContain(2);
    expect(await ids('?situacao=descredenciado')).toEqual([]);
    expect((await get(c, `${O}/prestadores`)).json().totais).toMatchObject({
      credenciados: 5,
      descredenciados: 0,
      hospitalares: 3,
      saidasAgendadas: 1,
    });
    // Com a exclusão no RPS, não se altera (movimento incoerente) e não substitui outro hospitalar.
    const alterarAgendado = await post(c, `${O}/prestadores/2/alterar`, { ...base, versao: beta.versao + 1 });
    expect(alterarAgendado.statusCode).toBe(409);
    expect(alterarAgendado.json().codigo).toBe('so-credenciado');
    const gama = (await get(c, `${O}/prestadores/3`)).json();
    expect(
      (
        await post(c, `${O}/prestadores/3/descredenciar`, { ...desc, versao: gama.versao, substituto: 2 })
      ).json().codigo,
    ).toBe('substituto-com-saida-agendada');

    // Reinclusão antes da data: cancela a saída (o movimento de reinclusão vai ao RPS).
    const r = await post(c, `${O}/prestadores/2/reincluir`, {
      versao: beta.versao + 1,
      motivo: 'Novo contrato assinado (sintético)',
      contrato: { ...contrato, numero: 'SINT-C2' },
    });
    expect((await get(c, `${O}/prestadores/2`)).json()).toMatchObject({
      situacao: 'credenciado',
      saidaEm: null,
    });
    expect(r.json()).toMatchObject({ movimento: 4, versao: beta.versao + 2 });
    expect(
      (
        await post(c, `${O}/prestadores/2/reincluir`, {
          versao: beta.versao + 2,
          motivo: 'Novo contrato assinado (sintético)',
          contrato,
        })
      ).json().codigo,
    ).toBe('so-descredenciado');

    // Os movimentos do RPS pendentes: inclusão (2), alteração, exclusão e reinclusão.
    const p = (await get(c, `${O}/rede/movimentos?situacao=pendente`)).json();
    expect(p.itens.map((m: { movimento: number }) => m.movimento)).toEqual([4, 3, 2, 1, 1]);
    expect((await get(c, `${O}/prestadores`)).json().totais).toMatchObject({
      credenciados: 5,
      rpsPendentes: 5,
    });
    // A saída com a data de hoje (aviso dado há 30 dias) vale na hora; o descredenciado não se altera.
    const cons = (await get(c, `${O}/prestadores/${id}`)).json();
    const dc = await post(c, `${O}/prestadores/${id}/descredenciar`, {
      ...desc,
      versao: cons.versao,
      avisoBeneficiariosEm: somaDias(hoje(), -30),
      efetivoEm: hoje(),
    });
    expect(dc.statusCode, dc.body).toBe(200);
    expect((await get(c, `${O}/prestadores/${id}`)).json()).toMatchObject({
      situacao: 'descredenciado',
      saidaEm: null,
    });
    expect(await ids('?situacao=descredenciado')).toEqual([id]);
    const alterarExcluido = await post(c, `${O}/prestadores/${id}/alterar`, {
      ...base,
      versao: cons.versao + 1,
      cnes: '9000066',
    });
    expect(alterarExcluido.statusCode).toBe(409);
    expect(alterarExcluido.json().codigo).toBe('so-credenciado');
    expect((await get(c, `${O}/prestadores/${id}`)).json().movimentos[0]).toMatchObject({ movimento: 3 });

    for (const ev of ['Alterado', 'Descredenciado', 'Reincluido'] as const)
      expect(
        trilha.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS[`operadoraPrestador${ev}`].codigo),
        ev,
      ).toBe(true);

    // Quem só consulta (auditor da operadora): lê, não grava.
    const aud = await entrar('SINT.OPE.AUDITOR');
    expect((await get(aud, `${O}/rede/apoio`)).json()).toMatchObject({ ligada: true, podeEditar: false });
    expect((await get(aud, `${O}/prestadores`)).statusCode).toBe(200);
    expect((await post(aud, `${O}/prestadores`, { ...consultorio, documento: CNPJ })).statusCode).toBe(403);

    // Entrada inválida e cursor.
    expect((await get(c, `${O}/prestadores?situacao=outra`)).statusCode).toBe(400);
    expect((await get(c, `${O}/prestadores?apos=${'!'.repeat(5)}`)).statusCode).toBe(400);
    expect((await get(c, `${O}/rede/movimentos?apos=x`)).statusCode).toBe(400);

    // Recolher: desligar o módulo tira a rede de uso.
    await ligar(admin, 'operadora', false);
    expect((await get(c, `${O}/prestadores`)).statusCode).toBe(403);
    await ligar(admin, 'operadora.rede', false);
  });

  it('o cursor da lista: nome de busca e ID, opaco', () => {
    const k = cursorPrestador({ nome: 'HOSPITAL SINTETICO', id: 12 });
    expect(lerCursorPrestador(k)).toEqual({ nome: 'HOSPITAL SINTETICO', id: 12 });
    expect(lerCursorPrestador('AAAA')).toBeNull();
  });
});
