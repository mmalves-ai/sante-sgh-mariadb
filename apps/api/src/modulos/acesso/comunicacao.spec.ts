// M27 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): a página
// inicial por perfil (só componentes entregues, com a permissão e a funcionalidade ligada), a fila do médico (só com
// vínculo), a fila da recepção (prioridade legal), as mensagens (regra 7: sem dado do paciente no texto, o paciente como
// contexto, o texto fora da trilha), a ciência que resolve o aviso, o canal que avisa depois do COMMIT (regra 8), os
// comunicados (só o gestor), as mensagens do sistema anterior e o dicionário pessoal. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { PortaWorklistMemoria } from '../pep/worklist-porta.js';
import { ServicoComunicacao } from './aplicacao/comunicacao.js';
import { PortaComunicacaoMemoria } from './comunicacao-porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const documentos = new PortaDocumentosMemoria(trilha, null);
const comunicacao = new PortaComunicacaoMemoria({ estado: () => 'verde' });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    documentos,
    comunicacao,
    worklist: new PortaWorklistMemoria(documentos),
    vigia: null,
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
  'idempotency-key': `teste-m27-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const del = (s: Sessao, url: string) => app.inject({ method: 'DELETE', url: `/api${url}`, headers: h(s) });

describe('página inicial por perfil (regra 1)', () => {
  it('o médico vê a fila dele; a recepção, a dela; ninguém vê a fila ainda não entregue', async () => {
    const m = (await get(await entrar('SINT.MEDICO'), '/acesso/inicio')).json();
    const ids = m.componentes.map((c: { id: string }) => c.id);
    expect(ids).toContain('medico');
    expect(ids).toContain('mensagens');
    expect(ids).not.toContain('recepcao');
    expect(ids).not.toContain('enfermagem');
    expect(ids).not.toContain('higienizacao');
    const r = (await get(await entrar('SINT.SENHAS'), '/acesso/inicio')).json();
    expect(r.componentes.map((c: { id: string }) => c.id)).toContain('recepcao');
    expect(r.componentes.map((c: { id: string }) => c.id)).not.toContain('medico');
    expect(JSON.stringify([m, r])).not.toMatch(/SPDATA|legado|sistema atual/i);
    // M21 entregue: a fila da higienização entra na página inicial de quem executa a limpeza (e a chave ligada).
    const hig = (await get(await entrar('SINT.HIGIENIZACAO'), '/acesso/inicio')).json();
    expect(hig.componentes.map((c: { id: string; rota: string }) => [c.id, c.rota])).toContainEqual([
      'higienizacao',
      '/m/higienizacao',
    ]);
  });
});

describe('fila do médico (regra 2)', () => {
  it('só quem tem a permissão; sem vínculo, nada aparece', async () => {
    expect((await get(await entrar('SINT.SENHAS'), '/pep/worklist/medico')).statusCode).toBe(403);
    const f = (await get(await entrar('SINT.MEDICO'), '/pep/worklist/medico')).json();
    expect(f.teto).toBe(100);
    // Sem registro do médico no episódio, os pacientes sintéticos não são "dele".
    expect(f.pacientes).toEqual([]);
  });
});

describe('fila da recepção (regra 5)', () => {
  it('as senhas pela prioridade legal e a guia aguardando autorização', async () => {
    const s = await entrar('SINT.SENHAS');
    const f = await get(s, '/recepcao/worklist');
    expect(f.statusCode).toBe(200);
    const w = f.json();
    expect(w.teto).toBe(300);
    expect(w.guias[0]).toMatchObject({ convenio: 'CONVÊNIO SINTÉTICO' });
    const pesos = w.senhas.map((x: { prioridade: string }) => Number(x.prioridade));
    expect([...pesos].sort((a, b) => a - b)).toEqual(pesos);
    expect((await get(await entrar('SINT.MEDICO'), '/recepcao/worklist')).statusCode).toBe(403);
  });
});

describe('mensagens internas (regra 7) e central de avisos (regra 8)', () => {
  it('recusa dado do paciente no texto; o paciente vai como contexto; o texto não vai à trilha', async () => {
    const m = await entrar('SINT.MEDICO');
    const cpf = await post(m, '/acesso/mensagens', {
      assunto: 'Paciente do leito 3',
      texto: 'O CPF é 123.456.789-09',
      destinos: [{ tipo: 'usuario', valor: 'SINT.RESIDENTE' }],
    });
    expect(cpf.statusCode).toBe(400);
    expect(cpf.json().detail).toMatch(/Paciente \(contexto\)/);
    const r = await post(m, '/acesso/mensagens', {
      assunto: 'Ver o paciente',
      texto: 'Pode passar no leito antes das 14 h?',
      destinos: [{ tipo: 'usuario', valor: 'SINT.RESIDENTE' }],
      cienciaObrigatoria: true,
      contextoAtendimento: 10011,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ destinatarios: 1, repetida: false });
    const linhas = comunicacao.trilhaDe('aa');
    const envio = linhas.find((l) => l.evento === 'acesso.mensagem.enviada')!;
    expect(envio).toMatchObject({ atendimento: 10011, tabelaAlvo: 'SGH_ADM_MENSAGEM' });
    expect(JSON.stringify(linhas)).not.toContain('Pode passar no leito');
  });

  it('o destinatário vê o aviso, abre (lida) e dá ciência (o aviso fica resolvido)', async () => {
    const res = await entrar('SINT.RESIDENTE');
    const av = (await get(res, '/acesso/avisos')).json();
    const aviso = av.avisos.find((a: { tipo: string }) => a.tipo === 'ciencia-pendente');
    expect(aviso).toMatchObject({ estado: 'novo', gravidade: 'atencao' });
    const caixa = (await get(res, '/acesso/mensagens')).json();
    expect(caixa.naoLidas).toBe(1);
    expect(caixa.cienciasPendentes).toBe(1);
    const id = caixa.recebidas[0].id as number;
    const aberta = (await get(res, `/acesso/mensagens/${id}`)).json();
    expect(aberta.lidaEm).not.toBeNull();
    expect(aberta.contextoAtendimento).toBe(10011);
    const c = await post(res, `/acesso/mensagens/${id}/ciencia`);
    expect(c.json().cienciaEm).not.toBeNull();
    const depois = (await get(res, '/acesso/avisos')).json();
    expect(depois.avisos.find((a: { id: number }) => a.id === aviso.id).estado).toBe('resolvido');
    expect((await get(await entrar('SINT.MEDICO'), `/acesso/mensagens/${id}`)).statusCode).toBe(404);
  });

  it('regra 6 na sessão de teste: o gestor tem o aviso grave (interrompe) e o informativo (só a central)', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const av = (await get(g, '/acesso/avisos')).json();
    expect(av.avisos.map((a: { tipo: string; gravidade: string }) => [a.tipo, a.gravidade]).sort()).toEqual([
      ['alergia', 'grave'],
      ['resultado-liberado', 'informacao'],
    ]);
    expect(av.novos).toBe(2);
  });

  it('o aviso sai depois do COMMIT: a gravação que falha não avisa; o cliente relê o estado', async () => {
    const avisados: string[] = [];
    const s = new ServicoComunicacao(comunicacao, { avisar: (k) => avisados.push(k) });
    const c = { rede: 'rede-teste', hospital: 'aa' };
    const autor = { login: 'SINT.MEDICO', estacao: 'TESTE', correlacao: 'teste-m27-aviso' };
    await expect(
      s.enviar(
        c,
        autor,
        {
          assunto: 'A',
          texto: 'B',
          destinos: [{ tipo: 'usuario', valor: 'NINGUEM' }],
          cienciaObrigatoria: false,
          contextoAtendimento: null,
        },
        'chave-falha-0001',
      ),
    ).rejects.toMatchObject({ extras: { codigo: 'destino-sem-usuario' } });
    expect(avisados).toEqual([]);
    const r = await s.enviar(
      c,
      autor,
      {
        assunto: 'Reunião',
        texto: 'Reunião às 15 h.',
        destinos: [{ tipo: 'grupo', valor: 'MEDICOS' }],
        cienciaObrigatoria: false,
        contextoAtendimento: null,
      },
      'chave-ok-0001',
    );
    expect(avisados).toContain('aa|SINT.MEDICO');
    // O mesmo pedido de novo (o segundo clique): a primeira mensagem, sem novo aviso.
    const n = avisados.length;
    expect(
      await s.enviar(
        c,
        autor,
        {
          assunto: 'Reunião',
          texto: 'Reunião às 15 h.',
          destinos: [{ tipo: 'grupo', valor: 'MEDICOS' }],
          cienciaObrigatoria: false,
          contextoAtendimento: null,
        },
        'chave-ok-0001',
      ),
    ).toMatchObject({ id: r.id, repetida: true });
    expect(avisados.length).toBe(n);
    // A reconexão relê o estado gravado: o aviso continua lá, novo.
    expect((await s.avisos(c, 'SINT.MEDICO', 0)).avisos.some((a) => a.link === `/mensagens?id=${r.id}`)).toBe(
      true,
    );
  });

  it('comunicado só pelo gestor, com vigência; mensagens do sistema anterior só as próprias', async () => {
    const corpo = {
      assunto: 'Treinamento',
      texto: 'Treinamento do sistema na sexta-feira.',
      destinos: [{ tipo: 'grupo', valor: 'MEDICOS' }],
      vigenciaInicio: '2026-01-01T00:00',
      vigenciaFim: '2099-12-31T23:59',
    };
    expect((await post(await entrar('SINT.MEDICO'), '/acesso/comunicados', corpo)).statusCode).toBe(403);
    const g = await entrar('SINT.COMUNICACAO');
    expect((await post(g, '/acesso/comunicados', corpo)).statusCode).toBe(201);
    const m = await entrar('SINT.MEDICO');
    const caixa = (await get(m, '/acesso/mensagens')).json();
    expect(caixa.recebidas.some((x: { tipo: string }) => x.tipo === 'comunicado')).toBe(true);
    const ant = (await get(m, '/acesso/mensagens-anteriores')).json();
    expect(ant.mensagens).toHaveLength(2);
    expect((await get(g, '/acesso/mensagens-anteriores')).json().mensagens).toHaveLength(0);
  });

  it('marcar o aviso como lido; o de outro login não', async () => {
    const m = await entrar('SINT.MEDICO');
    const av = (await get(m, '/acesso/avisos')).json();
    const id = av.avisos.find((a: { estado: string }) => a.estado === 'novo').id as number;
    expect((await post(m, `/acesso/avisos/${id}/lido`)).json()).toEqual({ mudou: true });
    expect((await post(m, `/acesso/avisos/${id}/lido`)).json()).toEqual({ mudou: false });
    const outro = await post(await entrar('SINT.RESIDENTE'), `/acesso/avisos/${id}/resolver`);
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('aviso-inexistente');
  });
});

describe('dicionário pessoal', () => {
  it('inclui com a fonética, recusa a repetida, exclui; cada um vê só o próprio', async () => {
    const m = await entrar('SINT.MEDICO');
    expect((await post(m, '/acesso/dicionario', { palavra: 'Ecocardiograma' })).statusCode).toBe(201);
    const rep = await post(m, '/acesso/dicionario', { palavra: 'ecocardiograma' });
    expect(rep.json().codigo).toBe('palavra-existente');
    const d = (await get(m, '/acesso/dicionario')).json();
    expect(d.palavras).toEqual([{ palavra: 'ecocardiograma', fonetica: 'kkrdgrm' }]);
    expect(d.gravacao).toEqual({ incluir: null, excluir: null });
    expect((await get(await entrar('SINT.RESIDENTE'), '/acesso/dicionario')).json().palavras).toEqual([]);
    expect((await del(m, '/acesso/dicionario/ecocardiograma')).statusCode).toBe(200);
    expect((await del(m, '/acesso/dicionario/ecocardiograma')).json().codigo).toBe('palavra-inexistente');
    expect((await post(m, '/acesso/dicionario', { palavra: 'duas palavras' })).statusCode).toBe(400);
  });
});

describe('paciente de contexto da mensagem (revisão do M27, regra 7)', () => {
  const corpo = (contextoAtendimento: number | null, destino = 'SINT.COMUNICACAO') => ({
    assunto: 'Contexto',
    texto: 'Ver o paciente do contexto.',
    destinos: [{ tipo: 'usuario', valor: destino }],
    contextoAtendimento,
  });

  it('sem acesso ao prontuário, o contexto é recusado; o atendimento inexistente também', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const sem = await post(g, '/acesso/mensagens', corpo(10011, 'SINT.MEDICO'));
    expect(sem.statusCode).toBe(422);
    expect(sem.json()).toMatchObject({ codigo: 'contexto-sem-acesso', campos: ['contextoAtendimento'] });
    const m = await entrar('SINT.MEDICO');
    const inexistente = await post(m, '/acesso/mensagens', corpo(10019));
    expect(inexistente.statusCode).toBe(422);
    expect(inexistente.json()).toMatchObject({ codigo: 'contexto-invalido' });
    // Nada gravado nas recusas: o gestor não recebeu nenhuma mensagem com o contexto.
    const caixa = (await get(g, '/acesso/mensagens')).json();
    expect(caixa.recebidas.some((x: { assunto: string }) => x.assunto === 'Contexto')).toBe(false);
  });

  it('o identificador do paciente só vai a quem pode abrir o prontuário', async () => {
    const m = await entrar('SINT.MEDICO');
    expect((await post(m, '/acesso/mensagens', corpo(10011))).statusCode).toBe(201);
    const g = await entrar('SINT.COMUNICACAO');
    const caixa = (await get(g, '/acesso/mensagens')).json();
    const recebida = caixa.recebidas.find((x: { assunto: string }) => x.assunto === 'Contexto');
    expect(recebida).toMatchObject({ contextoAtendimento: 10011, contextoPaciente: null });
    const aberta = (await get(g, `/acesso/mensagens/${recebida.id}`)).json();
    expect(aberta).toMatchObject({ contextoAtendimento: 10011, contextoPaciente: null });
    // Quem tem o prontuário vê o paciente (o link abre pela autorização normal do PEP).
    expect((await post(m, '/acesso/mensagens', corpo(10011, 'SINT.MEDICO'))).statusCode).toBe(201);
    const propria = (await get(m, '/acesso/mensagens'))
      .json()
      .recebidas.find((x: { assunto: string }) => x.assunto === 'Contexto');
    expect(propria).toMatchObject({ contextoAtendimento: 10011, contextoPaciente: 1001 });
  });
});
