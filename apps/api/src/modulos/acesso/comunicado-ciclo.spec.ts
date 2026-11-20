// W0-09: o ciclo de vida do comunicado pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (as
// mesmas recusas das gravações do banco): o texto ainda não lido se corrige com motivo; o lido ou com ciência não se
// edita (409); a vigência só encurta; o encerramento leva o motivo e mantém o comunicado e as ciências visíveis; tudo
// vai à trilha sem o texto. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { PortaWorklistMemoria } from '../pep/worklist-porta.js';
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
  'idempotency-key': `teste-w009-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const put = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'PUT', url: `/api${url}`, headers: h(s), payload: payload as object });

const futuro = '2099-12-31T23:59';
async function publicar(g: Sessao, assunto: string, valor = 'MEDICOS'): Promise<number> {
  const r = await post(g, '/acesso/comunicados', {
    assunto,
    texto: 'Texto do comunicado de teste.',
    destinos: [{ tipo: 'grupo', valor }],
    cienciaObrigatoria: true,
    vigenciaInicio: '2026-01-01T00:00',
    vigenciaFim: futuro,
  });
  expect(r.statusCode).toBe(201);
  return r.json().id as number;
}
const eventosDaTrilha = () => comunicacao.trilhaDe('aa').map((l) => l.evento);

describe('comunicado: correção do texto só enquanto ninguém leu (W0-09)', () => {
  it('corrige com motivo o texto não lido; o anterior fica no evento; o texto não vai à trilha', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const id = await publicar(g, 'Plantão de domingo');
    const d = (await get(g, `/acesso/comunicados/${id}`)).json();
    expect(d.podeCorrigir).toBe(true);
    expect(d.destinatarios.length).toBeGreaterThan(0);
    const sem = await put(g, `/acesso/comunicados/${id}`, { assunto: 'Plantão', texto: 'Novo texto.' });
    expect(sem.statusCode).toBe(400);
    const r = await put(g, `/acesso/comunicados/${id}`, {
      assunto: 'Plantão de domingo (corrigido)',
      texto: 'Texto corrigido do comunicado.',
      motivo: 'Horário errado no texto',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().texto).toBe('Texto corrigido do comunicado.');
    const ev = r.json().eventos;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      evento: 'correcao',
      motivo: 'Horário errado no texto',
      por: 'SINT.COMUNICACAO',
    });
    expect(JSON.parse(ev[0].antes)).toEqual({
      assunto: 'Plantão de domingo',
      texto: 'Texto do comunicado de teste.',
    });
    expect(eventosDaTrilha()).toContain('acesso.comunicado.corrigido');
    expect(JSON.stringify(comunicacao.trilhaDe('aa'))).not.toContain('Texto corrigido');
  });

  it('lido ou com ciência: 409 na edição do texto, com a contagem e o caminho (encerrar e publicar outro)', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const id = await publicar(g, 'Vacinação');
    const m = await entrar('SINT.MEDICO');
    expect((await get(m, `/acesso/mensagens/${id}`)).statusCode).toBe(200);
    expect((await get(g, `/acesso/comunicados/${id}`)).json().podeCorrigir).toBe(false);
    const r = await put(g, `/acesso/comunicados/${id}`, {
      assunto: 'Vacinação',
      texto: 'Outro texto.',
      motivo: 'Corrigir a data',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('comunicado-ja-lido');
    expect(r.json().detail).toContain('lido por 1 destinatário(s), 0 com ciência');
    expect(r.json().detail).toContain('encerre');
    expect((await post(m, `/acesso/mensagens/${id}/ciencia`)).statusCode).toBe(200);
    const r2 = await put(g, `/acesso/comunicados/${id}`, {
      assunto: 'Vacinação',
      texto: 'Outro texto.',
      motivo: 'Corrigir a data',
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().detail).toContain('1 com ciência');
    expect((await get(g, `/acesso/comunicados/${id}`)).json().texto).toBe('Texto do comunicado de teste.');
  });
});

describe('comunicado: vigência só encurta, com motivo (W0-09)', () => {
  it('recusa estender, terminar antes do início ou no passado; encurta e guarda o fim anterior', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const id = await publicar(g, 'Obra no estacionamento');
    const url = `/acesso/comunicados/${id}/vigencia`;
    expect((await post(g, url, { vigenciaFim: '2099-01-01T00:00' })).statusCode).toBe(400);
    for (const fim of ['2100-01-01T00:00', '2025-12-31T00:00', '2026-01-02T00:00']) {
      const r = await post(g, url, { vigenciaFim: fim, motivo: 'Teste de recusa' });
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('vigencia-invalida');
    }
    const r = await post(g, url, { vigenciaFim: '2098-06-30T18:00', motivo: 'A obra termina antes' });
    expect(r.statusCode).toBe(200);
    expect(r.json().vigenciaFim.slice(0, 16)).toBe('2098-06-30T18:00');
    expect(r.json().eventos[0]).toMatchObject({ evento: 'vigencia', antes: '2099-12-31T23:59:00' });
    expect(eventosDaTrilha()).toContain('acesso.comunicado.vigenciaEncurtada');
  });
});

describe('comunicado: encerramento com motivo, visível com as ciências (W0-09)', () => {
  it('encerra; o comunicado e as ciências continuam visíveis; nada mais muda; quem não leu não o vê', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    const lido = await publicar(g, 'Troca de sistema na farmácia');
    const naoLido = await publicar(g, 'Manutenção do elevador');
    const m = await entrar('SINT.MEDICO');
    expect((await post(m, `/acesso/mensagens/${lido}/ciencia`)).statusCode).toBe(200);
    expect(
      (await post(m, `/acesso/comunicados/${lido}/encerramento`, { motivo: 'Sem permissão' })).statusCode,
    ).toBe(403);
    expect((await post(g, `/acesso/comunicados/${lido}/encerramento`, {})).statusCode).toBe(400);
    const r = await post(g, `/acesso/comunicados/${lido}/encerramento`, { motivo: 'Data da troca adiada' });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.encerradoEm).not.toBeNull();
    expect(d).toMatchObject({ encerradoPor: 'SINT.COMUNICACAO', motivoEncerramento: 'Data da troca adiada' });
    expect(
      d.destinatarios.find((x: { login: string }) => x.login === 'SINT.MEDICO').cienciaEm,
    ).not.toBeNull();
    expect(d.eventos.at(-1)).toMatchObject({ evento: 'encerramento', motivo: 'Data da troca adiada' });
    expect(
      (await post(g, `/acesso/comunicados/${naoLido}/encerramento`, { motivo: 'Já resolvido' })).statusCode,
    ).toBe(200);
    const caixa = (await get(m, '/acesso/mensagens')).json();
    const ids = caixa.recebidas.map((x: { id: number }) => x.id);
    expect(ids).toContain(lido);
    expect(ids).not.toContain(naoLido);
    expect(caixa.recebidas.find((x: { id: number }) => x.id === lido).motivoEncerramento).toBe(
      'Data da troca adiada',
    );
    expect(caixa.cienciasPendentes).toBe(
      caixa.recebidas.filter(
        (x: { cienciaObrigatoria: boolean; cienciaEm: string | null }) =>
          x.cienciaObrigatoria && x.cienciaEm === null,
      ).length,
    );
    const enviadas = (await get(g, '/acesso/mensagens')).json().enviadas;
    expect(enviadas.find((x: { id: number }) => x.id === lido)).toMatchObject({ ciencias: 1 });
    expect(enviadas.find((x: { id: number }) => x.id === lido).encerradoEm).not.toBeNull();
    // Encerrado não muda mais: nem de novo, nem o texto, nem a vigência; a ciência pendente também não se dá.
    const de_novo = await post(g, `/acesso/comunicados/${lido}/encerramento`, { motivo: 'Outra vez' });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.json().codigo).toBe('comunicado-encerrado');
    expect(
      (await put(g, `/acesso/comunicados/${naoLido}`, { assunto: 'x', texto: 'y', motivo: 'Corrigir' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await post(g, `/acesso/comunicados/${naoLido}/vigencia`, {
          vigenciaFim: '2098-01-01T00:00',
          motivo: 'Teste',
        })
      ).statusCode,
    ).toBe(409);
    expect((await post(m, `/acesso/mensagens/${naoLido}/ciencia`)).statusCode).toBe(409);
    expect(eventosDaTrilha()).toContain('acesso.comunicado.encerrado');
  });

  it('comunicado inexistente: 404', async () => {
    const g = await entrar('SINT.COMUNICACAO');
    expect((await get(g, '/acesso/comunicados/999999')).statusCode).toBe(404);
    expect(
      (await post(g, '/acesso/comunicados/999999/encerramento', { motivo: 'Não existe' })).statusCode,
    ).toBe(404);
  });
});
