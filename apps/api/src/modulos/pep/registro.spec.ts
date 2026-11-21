// M22 pela HTTP, com a sessão real sobre a fonte sintética e as portas do cadastro e do registro EM MEMÓRIA (nada
// conecta a banco; modelos e pacientes SINTÉTICOS): modelos com a situação; formulário (visão, atendimentos,
// gravação liberada); rascunho (novo, atualização, colisão 409, descarte); finalização (pendências 422,
// horário futuro e retroativo sem justificativa 422, texto fora do CP1252 400, sucesso com a trilha); pré-
// preenchimento por MANTERHIST e histórico; visualização (motivo, prova) e suspensão; regras do formulário
// (habilitar não apaga valor); permissões (recepção 403; admin do PEP); administração (consulta).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RespostaRegistro } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { textoDaResposta } from './registro-servico.js';
import { criarAppPep } from './teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppPep(env, {
    trilha,
    cadastro: new PortaCadastroMemoria(),
    registro: new PortaRegistroMemoria(trilha),
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
let chave = 0;
const post = (s: Sessao, url: string, payload: unknown, idem = true) =>
  app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      ...(idem ? { 'idempotency-key': `teste.m22.${Date.now()}.${chave++}` } : {}),
    },
    payload: payload as object,
  });

const texto = (vinculo: number, t: string): RespostaRegistro => ({
  vinculo,
  valor: {
    tipo: 'formatado',
    paragrafos: [
      {
        alinhamento: 'esquerda',
        recuo: 0,
        trechos: [{ texto: t, negrito: false, italico: false, sublinhado: false, cor: 0 }],
      },
    ],
  },
  autopreenchido: false,
  confirmado: false,
});
const agora = () => {
  const d = new Date(Date.now() - 3 * 3_600_000 - 2 * 60_000);
  return d.toISOString().slice(0, 16);
};

// Modelos sintéticos: 61 EVAM (6100 seção; 6101 Quadro clínico, obrigatório; 6102 Exame físico; 6103 Conduta,
// MANTERHIST 1) e 62 M10 (6201 Sim/Não; 6202 data habilitada pelo Sim/Não; 6203 hora; 6204 lista; 6205 FC; 6206).
describe('registro clínico nos modelos do formulário (M22)', () => {
  let medico: Sessao;
  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
  });

  it('liberação, modelos com a situação e o formulário com a visão e os atendimentos', async () => {
    expect((await get(medico, '/api/pep/registro/liberacao')).json()).toEqual({ ligada: true, motivo: null });
    const m = await get(medico, '/api/pep/registro/1003/modelos');
    expect(m.statusCode).toBe(200);
    expect(m.json().map((x: { codigo: string; situacao: string }) => [x.codigo, x.situacao])).toEqual([
      ['EVAM', 'liberado'],
      ['M10', 'liberado'],
      // M23: os modelos do pedido e da resposta de parecer (liberados na sessão sintética).
      ['MED09', 'liberado'],
      ['MED10', 'liberado'],
    ]);
    const f = await get(medico, '/api/pep/registro/1003/formulario/61');
    expect(f.statusCode).toBe(200);
    const corpo = f.json();
    expect(corpo.gravacao).toEqual({ pode: true, motivo: null });
    expect(corpo.campos[0].tipo).toBe('secao');
    expect(corpo.campos[0].itens.map((c: { titulo: string }) => c.titulo)).toEqual([
      'Quadro clínico',
      'Exame físico',
      'Conduta',
    ]);
    expect(corpo.atendimentos.map((a: { tipo: string; aberto: boolean }) => [a.tipo, a.aberto])).toEqual([
      ['internacao', true],
      ['externo', false],
    ]);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'pep.formulario.aberto', paciente: 1003 });
    expect(JSON.stringify(trilha.eventos.at(-1))).not.toMatch(/Quadro/);
    expect((await get(medico, '/api/pep/registro/999999/formulario/61')).statusCode).toBe(404);
    expect((await get(medico, '/api/pep/registro/1003/formulario/77')).statusCode).toBe(404);
  });

  it('rascunho: novo, atualização, colisão (409), lista e reabertura; descarte', async () => {
    const base = { modelo: 61, atendimento: 10031, dataHoraClinica: agora() };
    const r1 = await post(medico, '/api/pep/registro/1003/rascunho', {
      ...base,
      respostas: [texto(6102, 'Exame SINTETICO')],
    });
    expect(r1.statusCode).toBe(200);
    const { rascunho, versao } = r1.json();
    const r2 = await post(medico, '/api/pep/registro/1003/rascunho', {
      ...base,
      rascunho: { id: rascunho, versao },
      respostas: [texto(6102, 'Exame SINTETICO 2'), texto(6101, 'Quadro SINTETICO')],
    });
    expect(r2.statusCode).toBe(200);
    const velho = await post(medico, '/api/pep/registro/1003/rascunho', {
      ...base,
      rascunho: { id: rascunho, versao },
      respostas: [],
    });
    expect(velho.statusCode).toBe(409);
    expect(velho.json().codigo).toBe('conflito-versao');
    // Como o legado: salvar de novo cria a versão encadeada (outro ID) e arquiva a anterior.
    const novo = r2.json().rascunho as number;
    expect(novo).not.toBe(rascunho);
    const lista = await get(medico, '/api/pep/rascunhos');
    const ids = lista.json().map((x: { id: number }) => x.id);
    expect(ids).toContain(novo);
    expect(ids).not.toContain(rascunho);
    expect(
      lista.json().some((x: { id: number; respostas: number }) => x.id === novo && x.respostas === 2),
    ).toBe(true);
    const aberto = await get(medico, `/api/pep/registro/1003/formulario/61?rascunho=${novo}`);
    expect(
      aberto
        .json()
        .rascunho.respostas.map((x: RespostaRegistro) => x.vinculo)
        .sort(),
    ).toEqual([6101, 6102]);
    expect(aberto.json().rascunho.resumo).toMatchObject({ somenteLeitura: false, deOutroSistema: false });
    const d = await post(medico, `/api/pep/rascunhos/${novo}/descartar`, { versao: r2.json().versao });
    expect(d.statusCode).toBe(200);
    expect((await get(medico, '/api/pep/rascunhos')).json().some((x: { id: number }) => x.id === novo)).toBe(
      false,
    );
    expect(trilha.eventos.map((e) => e.evento)).toEqual(
      expect.arrayContaining(['pep.rascunho.salvo', 'pep.rascunho.descartado']),
    );
    // Sem Idempotency-Key: recusado antes de gravar.
    expect(
      (await post(medico, '/api/pep/registro/1003/rascunho', { ...base, respostas: [] }, false)).statusCode,
    ).toBe(400);
  });

  it('finalizar: pendências, horário futuro, retroativo sem justificativa e texto fora do CP1252', async () => {
    const f = (await get(medico, '/api/pep/registro/1003/formulario/61')).json();
    const base = { modelo: 61, atendimento: 10031, impressao: f.impressao };
    const semObrigatorio = await post(medico, '/api/pep/registro/1003/finalizar', {
      ...base,
      dataHoraClinica: agora(),
      respostas: [texto(6102, 'x')],
    });
    expect(semObrigatorio.statusCode).toBe(422);
    expect(semObrigatorio.json().codigo).toBe('pendencias');
    const futuro = new Date(Date.now() - 3 * 3_600_000 + 3_600_000).toISOString().slice(0, 16);
    const fut = await post(medico, '/api/pep/registro/1003/finalizar', {
      ...base,
      dataHoraClinica: futuro,
      respostas: [texto(6101, 'x')],
    });
    expect(fut.json().codigo).toBe('horario-futuro');
    const retro = new Date(Date.now() - 3 * 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 16);
    const r = await post(medico, '/api/pep/registro/1003/finalizar', {
      ...base,
      dataHoraClinica: retro,
      respostas: [texto(6101, 'x')],
    });
    expect(r.json().codigo).toBe('justificativa-necessaria');
    const emoji = await post(medico, '/api/pep/registro/1003/finalizar', {
      ...base,
      dataHoraClinica: agora(),
      respostas: [
        {
          vinculo: 6101,
          valor: { tipo: 'texto', texto: 'dor 😀' },
          autopreenchido: false,
          confirmado: false,
        },
      ],
    });
    expect(emoji.statusCode).toBe(400);
    const outro = await post(medico, '/api/pep/registro/1003/finalizar', {
      ...base,
      impressao: 'a'.repeat(64),
      dataHoraClinica: agora(),
      respostas: [texto(6101, 'x')],
    });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('formulario-mudou');
  });

  let registro = 0;
  it('finaliza (trilha), pré-preenche a Conduta (MANTERHIST 1) no próximo e mostra o histórico', async () => {
    const f = (await get(medico, '/api/pep/registro/1003/formulario/61')).json();
    const r = await post(medico, '/api/pep/registro/1003/finalizar', {
      modelo: 61,
      atendimento: 10031,
      impressao: f.impressao,
      dataHoraClinica: agora(),
      respostas: [texto(6101, 'Quadro SINTETICO'), texto(6103, 'Conduta SINTETICA')],
    });
    expect(r.statusCode).toBe(201);
    registro = r.json().registro;
    expect(r.json().hash).toMatch(/^[0-9a-f]{64}$/);
    expect(trilha.eventos.at(-1)).toMatchObject({
      evento: 'pep.evolucao.registrada',
      paciente: 1003,
      idAlvo: String(registro),
    });
    const proximo = (await get(medico, '/api/pep/registro/1003/formulario/61')).json();
    expect(proximo.preenchidos).toEqual([
      expect.objectContaining({ vinculo: 6103, autopreenchido: true, confirmado: false }),
    ]);
    const h = await get(medico, '/api/pep/registro/1003/historico/61/6103');
    expect(h.statusCode).toBe(200);
    expect(h.json().valores.map((v: { valor: string }) => v.valor)).toEqual(['Conduta SINTETICA']);
    // O pré-preenchido sem confirmação não finaliza.
    const sem = await post(medico, '/api/pep/registro/1003/finalizar', {
      modelo: 61,
      atendimento: 10031,
      impressao: f.impressao,
      dataHoraClinica: agora(),
      respostas: [texto(6101, 'x'), { ...proximo.preenchidos[0] }],
    });
    expect(sem.statusCode).toBe(422);
  });

  it('visualiza (motivo da sessão, prova conferida) e suspende com justificativa; recusa suspender de novo', async () => {
    const v = await get(medico, `/api/pep/registro/1003/registros/${registro}`);
    expect(v.statusCode).toBe(200);
    const corpo = v.json();
    expect(corpo.prova.situacao).toBe('confere');
    expect(corpo.podeSuspender).toBe(true);
    expect(corpo.respostas.map((x: RespostaRegistro) => x.vinculo).sort()).toEqual([6101, 6103]);
    expect(trilha.eventos.at(-1)).toMatchObject({
      evento: 'pep.evolucao.visualizada',
      idAlvo: String(registro),
    });
    const s = await post(medico, `/api/pep/registro/1003/registros/${registro}/suspender`, {
      justificativa: 'Registro no paciente errado',
      senha: SENHA,
    });
    expect(s.statusCode).toBe(200);
    const depois = (await get(medico, `/api/pep/registro/1003/registros/${registro}`)).json();
    expect(depois).toMatchObject({
      suspenso: true,
      justificativaSuspensao: 'Registro no paciente errado',
      podeSuspender: false,
    });
    const de_novo = await post(medico, `/api/pep/registro/1003/registros/${registro}/suspender`, {
      justificativa: 'Registro no paciente errado',
      senha: SENHA,
    });
    expect(de_novo.statusCode).toBe(409);
    expect(
      (
        await post(medico, `/api/pep/registro/1003/registros/${registro}/suspender`, {
          justificativa: 'curta',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('registro de outro paciente na visualização: 404; motivo pedido para paciente sem motivo na sessão', async () => {
    expect((await get(medico, `/api/pep/registro/1001/registros/${registro}`)).statusCode).toBe(422);
    const m = await post(medico, '/api/pep/registro/1001/motivo', { motivo: 'assistencia' }, false);
    expect(m.statusCode).toBe(200);
    expect((await get(medico, `/api/pep/registro/1001/registros/${registro}`)).statusCode).toBe(404);
  });

  it('regras: o Sim/Não "Não" desabilita a data, que continua gravada (só habilita e desabilita)', async () => {
    const f = (await get(medico, '/api/pep/registro/1003/formulario/62')).json();
    const sec = f.campos[0];
    const data = sec.itens.find((c: { tipo: string }) => c.tipo === 'data');
    expect(data.habilitar).toBeTruthy();
    const r = await post(medico, '/api/pep/registro/1003/finalizar', {
      modelo: 62,
      atendimento: 10031,
      impressao: f.impressao,
      dataHoraClinica: agora(),
      respostas: [
        { vinculo: 6201, valor: { tipo: 'escolha', indice: 1 }, autopreenchido: false, confirmado: false },
        {
          vinculo: 6202,
          valor: { tipo: 'data', data: '2026-10-01' },
          autopreenchido: false,
          confirmado: false,
        },
        {
          vinculo: 6204,
          valor: { tipo: 'multipla', indices: [0, 2] },
          autopreenchido: false,
          confirmado: false,
        },
        { vinculo: 6205, valor: { tipo: 'numero', valor: 72 }, autopreenchido: false, confirmado: false },
        { vinculo: 6203, valor: { tipo: 'hora', hora: '07:30' }, autopreenchido: false, confirmado: false },
      ],
    });
    expect(r.statusCode).toBe(201);
    const v = (await get(medico, `/api/pep/registro/1003/registros/${r.json().registro}`)).json();
    expect(v.respostas.map((x: RespostaRegistro) => x.vinculo).sort()).toEqual([
      6201, 6202, 6203, 6204, 6205,
    ]);
    expect(textoDaResposta(v.respostas.find((x: RespostaRegistro) => x.vinculo === 6205))).toBe('72');
  });

  it('permissões: a recepção não registra (403); o administrador do PEP consulta os modelos e a impressão', async () => {
    const recepcao = await entrar('SINT.RECEPCAO');
    expect((await get(recepcao, '/api/pep/registro/1003/modelos')).statusCode).toBe(403);
    expect((await get(recepcao, '/api/pep/rascunhos')).statusCode).toBe(403);
    const admin = await entrar('SINT.ADMIN');
    const l = await get(admin, '/api/pep/admin/modelos');
    expect(l.statusCode).toBe(200);
    expect(
      l
        .json()
        .map((m: { codigo: string; componentesMapeados: number; componentes: number }) => [
          m.codigo,
          m.componentesMapeados === m.componentes,
        ]),
    ).toEqual([
      ['EVAM', true],
      ['M10', true],
      ['MED09', true],
      ['MED10', true],
    ]);
    const d = await get(admin, '/api/pep/admin/modelos/62');
    expect(d.json().expressoesDetalhe).toEqual([
      expect.objectContaining({ tipo: 'habilitar', convertida: true }),
    ]);
    expect((await get(admin, '/api/pep/admin/impressao')).json().fichas.length).toBe(1);
    expect((await get(medico, '/api/pep/admin/modelos')).statusCode).toBe(403);
  });
});
