// W0-09 (programa CRUD completo; script 1122) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM
// MEMÓRIA (nada conecta a banco): o ciclo de vida dos registros da implantação. Voltar o item do critério e o da
// checklist do desligamento a pendente (motivo obrigatório; o desligamento com a senha de novo), estornar a conclusão
// de treinamento (a conclusão fica fora da contagem; ninguém estorna a própria), retirar a versão da trilha (409 com a
// contagem e a oferta de inativar quando há turmas ou conclusões; sem vínculo, exclusão com retrato; a anterior volta a
// vigente). Cada mudança deixa o evento (motivo e valor anterior) e a linha da trilha.
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PORTA_COEXISTENCIA } from './porta.js';
import { type PortaCoexistenciaMemoria, TURMA_SINTETICA } from './porta-memoria.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const RAIZ_FIM = mkdtempSync(join(tmpdir(), 'w009-fim-'));
cpSync(join(FIXTURES, 'fim'), RAIZ_FIM, { recursive: true });
const RAIZ_DESLIG = mkdtempSync(join(tmpdir(), 'w009-deslig-'));
cpSync(join(FIXTURES, 'desligamento'), RAIZ_DESLIG, { recursive: true });
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_COEX_FIM: RAIZ_FIM,
  SGH_COEX_DESLIGAMENTO: RAIZ_DESLIG,
  SGH_TREINAMENTO: resolve(import.meta.dirname, '../../../../../docs/prontidao/treinamento'),
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let porta: PortaCoexistenciaMemoria;
let chave = 0;
const AA = { rede: '', hospital: 'aa' };

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  porta = app.get(PORTA_COEXISTENCIA) as PortaCoexistenciaMemoria;
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-w009-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
const put = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url, headers: h(s), payload: payload as Record<string, unknown> });
const M = '/api/administracao/coexistencia/migracao';
const D = '/api/administracao/coexistencia/desligamento';
const MOTIVO = 'Evidência anexada ao chamado errado';
const eventos = () => porta.eventosCiclo(AA);

describe('W0-09: ciclo de vida dos registros da implantação', () => {
  it('item do critério volta a pendente com motivo: evento com o valor anterior e trilha', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = `${M}/criterio/agendamento/itens/aceite-jornada/pendente`;
    // Ainda pendente (sem registro): nada a voltar.
    expect((await post(s, url, { motivo: MOTIVO })).json().codigo).toBe('item-ja-pendente');
    const reg = await put(s, `${M}/onda1/ligar/agendamento`, {
      itens: [
        { item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'ata 7 do comitê', em: '2026-11-09' },
      ],
      justificativa: 'Justificativa sintética do comitê',
    });
    expect(reg.statusCode).toBe(200);
    // Sem motivo: 400; item calculado: 409.
    expect((await post(s, url, {})).statusCode).toBe(400);
    expect(
      (
        await post(s, `${M}/criterio/agendamento/itens/operacoes-conferidas/pendente`, { motivo: MOTIVO })
      ).json().codigo,
    ).toBe('item-calculado');
    const antes = trilha.eventos.length;
    const r = await post(s, url, { motivo: MOTIVO });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ setor: 'agendamento', item: 'aceite-jornada', situacao: 'pendente' });
    expect(trilha.eventos.slice(antes)).toEqual([
      expect.objectContaining({ evento: 'coexistencia.item.pendente', tabelaAlvo: 'SGH_CFG_COEX_LIGAR' }),
    ]);
    expect(eventos().at(-1)).toMatchObject({
      evento: 'alterado',
      tabela: 'SGH_CFG_COEX_LIGAR',
      motivo: MOTIVO,
      usuario: 'SINT.ADMIN',
      valorAnterior: { situacao: 'cumprido', evidencia: 'ata 7 do comitê', em: '2026-11-09' },
    });
    const item = (await porta.itensLigar(AA)).find(
      (x) => x.setor === 'agendamento' && x.item === 'aceite-jornada',
    );
    expect(item).toMatchObject({ situacao: 'pendente', evidencia: '', em: null });
    // De novo: já pendente.
    expect((await post(s, url, { motivo: MOTIVO })).statusCode).toBe(409);
  });

  it('item do desligamento volta a pendente: com a senha de novo e motivo; o painel mostra pendente', async () => {
    const s = await entrar('SINT.ONDA5');
    const url = `${D}/itens/paineis-tv/pendente`;
    expect(
      (
        await post(s, `${D}/itens/paineis-tv`, {
          situacao: 'aceito-como-perdido',
          contingencia: 'nenhuma',
          papelResponsavel: 'TI do hospital',
          evidencia: 'ata sintética do comitê',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(200);
    expect((await post(s, url, { motivo: MOTIVO })).statusCode).toBe(401);
    expect((await post(s, url, { senha: SENHA })).statusCode).toBe(400);
    expect(
      (await post(s, `${D}/itens/nao-existe/pendente`, { motivo: MOTIVO, senha: SENHA })).statusCode,
    ).toBe(404);
    const r = await post(s, url, { motivo: MOTIVO, senha: SENHA });
    expect(r.statusCode).toBe(200);
    expect(eventos().at(-1)).toMatchObject({
      evento: 'alterado',
      tabela: 'SGH_CFG_COEX_DESLIG',
      motivo: MOTIVO,
      valorAnterior: { situacao: 'aceito-como-perdido', papelResponsavel: 'TI do hospital' },
    });
    const item = (await get(s, D)).json().itens.find((i: { item: string }) => i.item === 'paineis-tv');
    expect(item).toMatchObject({ situacao: 'pendente', resolvido: false });
    expect((await post(s, url, { motivo: MOTIVO, senha: SENHA })).json().codigo).toBe('item-ja-pendente');
  });

  it('versão da trilha: 409 com a contagem e a oferta de inativar; conclusão estornada; sem vínculo, exclusão', async () => {
    const s = await entrar('SINT.ADMIN');
    const ex = { exercicio: 'Marcar e remarcar a consulta do paciente sintético da turma.' };
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/2`, ex)).json()).toEqual({ versao: 1 });
    const turma = TURMA_SINTETICA.slice(0, 3);
    const conc = await post(s, `${M}/treinamento/conclusoes`, {
      logins: turma,
      papel: 'recepcao',
      onda: 2,
      turma: 'T-W009',
      concluidoEm: '2026-11-04',
      resultado: 'aprovado',
    });
    expect(conc.statusCode).toBe(200);
    // Revisão: uma segunda turma (2 turmas, 5 conclusões): o total conta as 5 conclusões, não 7 (turmas fora da soma).
    const conc2 = await post(s, `${M}/treinamento/conclusoes`, {
      logins: TURMA_SINTETICA.slice(3, 5),
      papel: 'recepcao',
      onda: 2,
      turma: 'T-W009-B',
      concluidoEm: '2026-11-05',
      resultado: 'aprovado',
    });
    expect(conc2.statusCode).toBe(200);
    // A versão 2 sem conclusão (a 1 fica desatualizada).
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/2`, ex)).json()).toEqual({ versao: 2 });
    const V1 = `${M}/treinamento/trilhas/recepcao/2/versoes/1/retirada`;
    expect((await post(s, V1, {})).statusCode).toBe(400);
    const recusa = await post(s, V1, { motivo: 'Versão publicada por engano' });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json()).toMatchObject({
      codigo: 'trilha-com-vinculos',
      total: 5,
      podeInativar: true,
      dependentes: [
        { rotulo: 'turmas', quantidade: 2, amostra: [], origem: 'fk' },
        { rotulo: 'conclusões de treinamento', quantidade: 5, amostra: [], origem: 'fk' },
      ],
    });
    // Estorno da conclusão: com motivo; a conclusão sai da contagem; repetir é 409; continua vínculo da versão.
    const painel = (await get(s, `${M}/treinamento`)).json();
    const alvo = painel.conclusoes.find(
      (c: { papel: string; onda: number; login: string }) =>
        c.papel === 'recepcao' && c.onda === 2 && c.login === turma[0],
    );
    const E = `${M}/treinamento/conclusoes/${alvo.id}/estorno`;
    expect((await post(s, E, {})).statusCode).toBe(400);
    expect((await post(s, `${M}/treinamento/conclusoes/999999/estorno`, { motivo: MOTIVO })).statusCode).toBe(
      404,
    );
    const est = await post(s, E, { motivo: 'Pessoa não fez o exercício prático' });
    expect(est.statusCode).toBe(200);
    expect(eventos().at(-1)).toMatchObject({
      evento: 'inativado',
      tabela: 'SGH_CFG_COEX_TREINO',
      chave: alvo.id,
      motivo: 'Pessoa não fez o exercício prático',
      valorAnterior: { login: turma[0], turma: 'T-W009' },
    });
    expect((await post(s, E, { motivo: MOTIVO })).json().codigo).toBe('conclusao-ja-estornada');
    const depois = (await get(s, `${M}/treinamento`)).json();
    expect(depois.conclusoes.some((c: { id: string }) => c.id === alvo.id)).toBe(false);
    expect((await post(s, V1, { motivo: 'Versão publicada por engano' })).json().total).toBe(5);
    // A vigente (2), sem vínculo: exclusão física com retrato; a 1 volta a vigente.
    const antes = trilha.eventos.length;
    const exc = await post(s, `${M}/treinamento/trilhas/recepcao/2/versoes/2/retirada`, {
      motivo: 'Versão publicada por engano',
    });
    expect(exc.statusCode).toBe(200);
    expect(exc.json()).toEqual({
      papel: 'recepcao',
      onda: 2,
      versao: 2,
      resultado: 'excluida',
      promovida: 1,
    });
    expect(trilha.eventos.slice(antes)).toEqual([
      expect.objectContaining({ evento: 'coexistencia.trilha.retirada', chaveNaturalAlvo: 'recepcao:2:2' }),
    ]);
    expect(porta.retratosExclusao(AA).at(-1)).toMatchObject({
      tabela: 'SGH_CFG_COEX_TRILHA',
      chave: 'aa|recepcao|2|2',
      motivo: 'Versão publicada por engano',
    });
    expect(eventos().at(-1)).toMatchObject({ evento: 'excluido', chave: 'recepcao:2:2' });
    // Inativar a 1 (com vínculos): fica 'retirada', visível nas versões; a trilha volta a proposta.
    const ina = await post(s, V1, { motivo: 'Conteúdo substituído pelo novo roteiro', inativar: true });
    expect(ina.json()).toEqual({
      papel: 'recepcao',
      onda: 2,
      versao: 1,
      resultado: 'inativada',
      promovida: null,
    });
    const t = (await get(s, `${M}/treinamento`))
      .json()
      .trilhas.find((x: { papel: string; onda: number }) => x.papel === 'recepcao' && x.onda === 2);
    expect(t).toMatchObject({
      publicada: false,
      versoes: [{ versao: 1, situacao: 'retirada', conclusoes: 4 }],
    });
    expect((await post(s, V1, { motivo: MOTIVO, inativar: true })).json().codigo).toBe('trilha-ja-retirada');
    // Sem trilha vigente: a conclusão nova é recusada.
    expect(
      (
        await post(s, `${M}/treinamento/conclusoes`, {
          logins: [TURMA_SINTETICA[5]],
          papel: 'recepcao',
          onda: 2,
          turma: 'T-W009B',
          concluidoEm: '2026-11-05',
          resultado: 'aprovado',
        })
      ).json().codigo,
    ).toBe('trilha-nao-publicada');
    // Revisão: a próxima publicação não reaproveita o número da versão 2 excluída (o retrato e o evento de exclusão
    // continuam só da versão antiga); a nova é a 3, e a 1 retirada não vira 'desatualizada'.
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/2`, ex)).json()).toEqual({ versao: 3 });
    const t3 = (await get(s, `${M}/treinamento`))
      .json()
      .trilhas.find((x: { papel: string; onda: number }) => x.papel === 'recepcao' && x.onda === 2);
    expect(t3.versoes.map((v: { versao: number; situacao: string }) => [v.versao, v.situacao])).toEqual(
      expect.arrayContaining([
        [1, 'retirada'],
        [3, 'vigente'],
      ]),
    );
    expect(eventos().filter((e) => e.chave === 'recepcao:2:3')).toEqual([]);
  });

  it('ninguém estorna a própria conclusão; sem permissão, 403', async () => {
    const recepcao = await entrar('SINT.RECEPCAO');
    expect(
      (await post(recepcao, `${M}/treinamento/trilhas/recepcao/2/versoes/1/retirada`, { motivo: MOTIVO }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(recepcao, `${M}/criterio/agendamento/itens/tvs/pendente`, { motivo: MOTIVO })).statusCode,
    ).toBe(403);
    const s = await entrar('SINT.ADMIN');
    const ex = { exercicio: 'Marcar e remarcar a consulta do paciente sintético da turma.' };
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/1`, ex)).statusCode).toBe(200);
    const outro = await entrar('SINT.ONDA5');
    expect(
      (
        await post(outro, `${M}/treinamento/conclusoes`, {
          logins: ['SINT.ADMIN'],
          papel: 'recepcao',
          onda: 1,
          turma: 'T-ADM',
          concluidoEm: '2026-11-04',
          resultado: 'aprovado',
        })
      ).statusCode,
    ).toBe(200);
    const id = (await get(s, `${M}/treinamento`))
      .json()
      .conclusoes.find((c: { login: string; onda: number }) => c.login === 'SINT.ADMIN' && c.onda === 1)?.id;
    expect(id).toBeTruthy();
    expect(
      (await post(s, `${M}/treinamento/conclusoes/${id}/estorno`, { motivo: MOTIVO })).json().codigo,
    ).toBe('a-si-mesmo');
  });
});
