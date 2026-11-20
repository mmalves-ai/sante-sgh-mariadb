// W0-07 (programa CRUD completo) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada
// conecta a banco): corrigir e excluir a solicitação de leito (recusa de órfão com a contagem), alterar e excluir a
// reserva (a convertida em internação devolve 409), retirar a DPA, alterar e encerrar a barreira, remover o limite,
// alterar o estado e limpar os atributos do leito — todas com o motivo obrigatório. Dados sintéticos.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { EstadoNirMemoria } from './nir-memoria.js';
import { PortaNirMemoria } from './nir-porta-memoria.js';
import { PortaAdtMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const pasta = resolve(import.meta.dirname, '../../../../../.tmp/nir-crud-spec');
const porFora = resolve(pasta, 'por-fora.json');
// O mapa sintético depende do dia (o movimento é gerado pela data): o relógio fixo deixa o teste determinístico (em
// 2026-10-26 nenhum leito livre de outro tipo de acomodação aparecia para o pedido). M47.2: correção de portão, como
// a do adt.spec no M47.3.
const painel = new FonteInternacaoMemoria({
  arquivoPorFora: porFora,
  agora: () => Date.UTC(2026, 9, 23, 12, 0),
});
const avancoMin = 0;
const estadoNir = new EstadoNirMemoria({ agora: () => new Date(Date.now() + avancoMin * 60_000) });
const adt = new PortaAdtMemoria(
  { estado: () => 'verde' },
  { painel, lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), nir: estadoNir },
);
const nir = new PortaNirMemoria(estadoNir, adt, trilha, (c, ids) => cadastro.lerPacientes(c, ids));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  mkdirSync(pasta, { recursive: true });
  rmSync(porFora, { force: true });
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    cadastro,
    internacao: painel,
    adt,
    nir,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  rmSync(pasta, { recursive: true, force: true });
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
  'idempotency-key': `teste-w007-nir-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const pedido = (paciente: number, x: Record<string, unknown> = {}) => ({
  origem: 'eletiva',
  paciente,
  prioridade: 'urgente',
  perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
  clinica: 'M',
  justificativa: 'Indicação sintética: pneumonia com necessidade de antibiótico venoso',
  ...x,
});
const admissao = (paciente: number, leito: { bloco: string; acomodacao: string; leito: string }, x = {}) => ({
  paciente,
  leito,
  convenio: 901,
  acomodacaoPlano: 'ENFERMARIA',
  carater: 'urgencia',
  clinica: 'M',
  especialidade: 11,
  medicoAssistente: 7101,
  medicoSolicitante: 7101,
  cidPrincipal: 50001,
  procedimento: 303010037,
  centroCusto: 300100,
  unidade: 4,
  origem: 'ambulatorio',
  ...x,
});
interface ItemFila {
  id: number;
  estado: string;
  versao: number;
  recursos: string[];
  observacao: string | null;
  perfil: { intensiva: boolean; precaucao: string | null; tiposAcomodacao: number[] };
  reserva: { id: number; chave: string; validaAte: string } | null;
  historico: { acao: string; motivo: string | null }[];
}
const fila = async (s: Sessao) => (await get(s, '/nir/fila')).json() as { itens: ItemFila[] };
const item = async (s: Sessao, id: number) => (await fila(s)).itens.find((x) => x.id === id);
const compativeis = async (s: Sessao, id: number) =>
  (
    (await get(s, `/nir/solicitacoes/${id}/leitos`)).json() as {
      leitos: {
        compativel: boolean;
        chave: string;
        leito: { bloco: string; acomodacao: string; leito: string };
      }[];
    }
  ).leitos.filter((l) => l.compativel);

describe('W0-07: solicitação de leito — corrigir e excluir (com a recusa de órfão)', () => {
  it('corrigir pede o motivo e a versão vista; grava o perfil, os recursos e a observação com o histórico', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1001))).json().id as number;
    const antes = (await item(nirS, id))!;
    expect(antes).toMatchObject({ versao: 1, recursos: [], observacao: null });
    const corpo = {
      versaoVista: 1,
      perfil: { intensiva: false, precaucao: 'contato', tiposAcomodacao: [] },
      recursos: ['monitor', 'oxigenio'],
      observacao: 'Precisa de monitor contínuo',
      motivo: 'Perfil revisto pelo plantonista',
    };
    expect((await post(nirS, `/nir/solicitacoes/${id}/corrigir`, { ...corpo, motivo: '' })).statusCode).toBe(
      400,
    );
    expect(
      (await post(nirS, `/nir/solicitacoes/${id}/corrigir`, { ...corpo, versaoVista: 9 })).json().codigo,
    ).toBe('solicitacao-desatualizada');
    const r = await post(nirS, `/nir/solicitacoes/${id}/corrigir`, corpo);
    expect(r.statusCode, r.body).toBe(200);
    const depois = (await item(nirS, id))!;
    expect(depois).toMatchObject({
      versao: 2,
      recursos: ['monitor', 'oxigenio'],
      observacao: 'Precisa de monitor contínuo',
      perfil: { precaucao: 'contato' },
    });
    expect(depois.historico.at(-1)).toMatchObject({
      acao: 'corrigir',
      motivo: 'Perfil revisto pelo plantonista',
    });
    const alt = estadoNir.alteracoes.find(
      (a) => a.tabela === 'SGH_INT_SOLIC_LEITO' && a.chave === String(id),
    );
    expect(alt).toMatchObject({
      acao: 'corrigir',
      antes: { precaucao: null, recursos: '', observacao: null },
    });
    // Sem mudança: recusa (nada a corrigir).
    expect(
      (await post(nirS, `/nir/solicitacoes/${id}/corrigir`, { ...corpo, versaoVista: 2 })).json().codigo,
    ).toBe('nada-a-corrigir');
    // O médico não opera a fila (sem a permissão de priorizar).
    expect(
      (await post(med, `/nir/solicitacoes/${id}/corrigir`, { ...corpo, versaoVista: 2 })).statusCode,
    ).toBe(403);
  });

  it('excluir pede a senha; a criada por engano sai com o retrato; com reserva vinculada, recusa com a contagem', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1002))).json().id as number;
    expect(
      (await post(nirS, `/nir/solicitacoes/${id}/excluir`, { motivo: 'Paciente errado na tela' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(nirS, `/nir/solicitacoes/${id}/excluir`, {
          motivo: 'Paciente errado na tela',
          senha: 'errada',
        })
      ).statusCode,
    ).toBe(401);
    const ok = await post(nirS, `/nir/solicitacoes/${id}/excluir`, {
      motivo: 'Paciente errado na tela',
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await item(nirS, id)).toBeUndefined();
    expect(
      estadoNir.retratos.filter((r) => r.chave === String(id) && r.tabela === 'SGH_INT_SOLIC_LEITO'),
    ).toHaveLength(1);
    expect(estadoNir.retratos.some((r) => r.tabela === 'SGH_INT_SOLIC_LEITO_EVT')).toBe(true);
    // O paciente pode ter outra solicitação depois (a marca de aberta saiu junto).
    const id2 = (await post(med, '/nir/solicitacoes', pedido(1002))).json().id as number;
    const [leito] = await compativeis(nirS, id2);
    expect((await post(nirS, '/nir/reservas', { solicitacao: id2, leito: leito!.leito })).statusCode).toBe(
      201,
    );
    const rec = await post(nirS, `/nir/solicitacoes/${id2}/excluir`, {
      motivo: 'Paciente errado',
      senha: SENHA,
    });
    expect(rec.statusCode).toBe(409);
    expect(rec.json().codigo).toBe('solicitacao-com-vinculo');
    expect(rec.json().detail).toMatch(/1 reserva de leito vinculada/);
    expect(rec.json().detail).toMatch(/1 transição/);
    expect(await item(nirS, id2)).toMatchObject({ estado: 'reservado' });
  });
});

describe('W0-07: reserva — alterar leito e validade, excluir a criada por engano, a convertida recusa', () => {
  it('alterar e excluir com motivo; a solicitação volta à análise; a convertida em internação devolve 409', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1003))).json().id as number;
    const [l1, l2] = await compativeis(nirS, id);
    const r = (await post(nirS, '/nir/reservas', { solicitacao: id, leito: l1!.leito })).json().id as number;
    expect((await post(nirS, `/nir/reservas/${r}/alterar`, { validadeMin: 60 })).statusCode).toBe(400);
    const v = await post(nirS, `/nir/reservas/${r}/alterar`, {
      validadeMin: 300,
      motivo: 'Transporte atrasado',
    });
    expect(v.statusCode, v.body).toBe(200);
    const t = await post(nirS, `/nir/reservas/${r}/alterar`, {
      leito: l2!.leito,
      motivo: 'Leito trocado pelo setor',
    });
    expect(t.statusCode, t.body).toBe(200);
    expect((await item(nirS, id))!.reserva).toMatchObject({ id: r, chave: l2!.chave });
    const mapa = (await get(nirS, '/leitos/mapa')).json() as {
      leitos: { chave: string; situacao: string }[];
    };
    expect(mapa.leitos.find((x) => x.chave === l2!.chave)?.situacao).toBe('reservado');
    expect(mapa.leitos.find((x) => x.chave === l1!.chave)?.situacao).toBe('livre');
    expect(
      estadoNir.alteracoes.filter((a) => a.tabela === 'SGH_INT_RESERVA_LEITO' && a.chave === String(r)),
    ).toHaveLength(2);
    // Excluir a reserva criada por engano: sai com retrato, a solicitação volta à análise.
    const ex = await post(nirS, `/nir/reservas/${r}/excluir`, { motivo: 'Reservado no paciente errado' });
    expect(ex.statusCode, ex.body).toBe(200);
    const depois = await item(nirS, id);
    expect(depois).toMatchObject({ estado: 'em_analise', reserva: null });
    expect(
      estadoNir.retratos.some((x) => x.tabela === 'SGH_INT_RESERVA_LEITO' && x.chave === String(r)),
    ).toBe(true);
    // O evento da volta à análise cita a reserva excluída e o retrato (o 'reservar' anterior aponta uma linha que
    // já não existe: é por esta referência que se acha a linha no histórico de exclusões).
    const nRetrato = estadoNir.retratos.findIndex(
      (x) => x.tabela === 'SGH_INT_RESERVA_LEITO' && x.chave === String(r),
    );
    expect(depois!.historico.find((e) => e.acao === 'liberarReserva')?.motivo).toContain(
      `Reserva nº ${r} excluída (criada por engano; retrato nº ${nRetrato + 1} no histórico de exclusões)`,
    );

    // A reserva convertida em internação: alterar, excluir e cancelar devolvem 409.
    const id4 = (await post(med, '/nir/solicitacoes', pedido(1004))).json().id as number;
    const [l4] = await compativeis(nirS, id4);
    const r4 = (await post(nirS, '/nir/reservas', { solicitacao: id4, leito: l4!.leito })).json()
      .id as number;
    const adm = await post(nirS, '/internacoes', admissao(1004, l4!.leito, { solicitacaoNir: id4 }));
    expect(adm.statusCode, adm.body).toBe(201);
    for (const [url, corpo] of [
      [`/nir/reservas/${r4}/excluir`, { motivo: 'Tentativa de retirar' }],
      [`/nir/reservas/${r4}/alterar`, { validadeMin: 60, motivo: 'Tentativa de alterar' }],
    ] as const) {
      const x = await post(nirS, url, corpo);
      expect(x.statusCode, url).toBe(409);
      expect(x.json().codigo).toBe('reserva-convertida');
    }
    expect(
      (await post(nirS, `/nir/reservas/${r4}/cancelar`, { motivo: 'Tentativa de cancelar' })).statusCode,
    ).toBe(409);
    // A solicitação que virou internação não se exclui (a internação gerada é desdobramento).
    const sx = await post(nirS, `/nir/solicitacoes/${id4}/excluir`, { motivo: 'Tentativa', senha: SENHA });
    expect(sx.statusCode).toBe(409);
    expect(sx.json().codigo).toBe('solicitacao-com-vinculo');
    expect(sx.json().detail).toMatch(/internação ou transferência gerada/);
  });
  it('trocar o leito da reserva confirmada a devolve a aguardar a confirmação, com a confirmação anterior no histórico', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1005))).json().id as number;
    const [l1, l2] = await compativeis(nirS, id);
    const r = (await post(nirS, '/nir/reservas', { solicitacao: id, leito: l1!.leito })).json().id as number;
    expect((await post(nirS, `/nir/reservas/${r}/confirmar`)).statusCode).toBe(200);
    expect((await item(nirS, id))!.reserva).toMatchObject({ situacao: 'confirmada' });
    // Só a validade: a confirmação continua (o leito é o mesmo que o setor confirmou).
    expect(
      (await post(nirS, `/nir/reservas/${r}/alterar`, { validadeMin: 120, motivo: 'Transporte atrasado' }))
        .statusCode,
    ).toBe(200);
    expect((await item(nirS, id))!.reserva).toMatchObject({ situacao: 'confirmada' });
    const t = await post(nirS, `/nir/reservas/${r}/alterar`, {
      leito: l2!.leito,
      motivo: 'Leito trocado pelo NIR',
    });
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json().mensagem).toMatch(/aguardar a confirmação do setor/);
    expect((await item(nirS, id))!.reserva).toMatchObject({ situacao: 'ativa', chave: l2!.chave });
    const h = estadoNir.alteracoes.filter(
      (a) => a.tabela === 'SGH_INT_RESERVA_LEITO' && a.chave === String(r),
    );
    expect(h.at(-1)!.antes).toMatchObject({ leito: l1!.chave, situacao: 'confirmada' });
  });
  it('a reserva com o paciente em trânsito não se exclui (409 reserva-com-desdobramento); a excluída deixa a referência do retrato', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1006))).json().id as number;
    const [l1] = await compativeis(nirS, id);
    const r = (await post(nirS, '/nir/reservas', { solicitacao: id, leito: l1!.leito })).json().id as number;
    const t = await post(nirS, `/nir/solicitacoes/${id}/transicoes`, {
      acao: 'transito',
      estadoVisto: 'reservado',
    });
    expect(t.statusCode, t.body).toBe(200);
    // A reserva continua 'ativa' (o trânsito não muda a situação dela), mas já tem desdobramento.
    const x = await post(nirS, `/nir/reservas/${r}/excluir`, { motivo: 'Reservado no paciente errado' });
    expect(x.statusCode, x.body).toBe(409);
    expect(x.json().codigo).toBe('reserva-com-desdobramento');
    expect(x.json().detail).toMatch(/cancele-a com o motivo/);
    expect(await item(nirS, id)).toMatchObject({ estado: 'em_transito', reserva: { id: r } });
    expect(
      estadoNir.retratos.some((y) => y.tabela === 'SGH_INT_RESERVA_LEITO' && y.chave === String(r)),
    ).toBe(false);
    // O cancelamento lógico com motivo continua disponível.
    const c = await post(nirS, `/nir/reservas/${r}/cancelar`, { motivo: 'Reserva feita por engano' });
    expect(c.statusCode, c.body).toBe(200);
  });
});

describe('W0-07: DPA, barreira e limite', () => {
  it('retirar a DPA (médico, motivo) deixa sem DPA e mantém o histórico; alterar e encerrar a barreira; remover o limite', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const a = (await get(nirS, '/nir/altas-previstas')).json();
    const i = a.itens[0];
    const hoje = a.hoje as string;
    const amanha = new Date(Date.parse(`${hoje}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const d = await post(med, '/nir/dpa', { internacao: i.internacao, data: amanha, anterior: null });
    expect(d.statusCode, d.body).toBe(201);
    const dpaId = d.json().id as number;
    expect(
      (
        await post(nirS, '/nir/dpa/retirar', {
          internacao: i.internacao,
          anterior: dpaId,
          motivo: 'Exame pendente',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(med, '/nir/dpa/retirar', { internacao: i.internacao, anterior: dpaId, motivo: '' }))
        .statusCode,
    ).toBe(400);
    const ret = await post(med, '/nir/dpa/retirar', {
      internacao: i.internacao,
      anterior: dpaId,
      motivo: 'Exame pendente',
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const depois = (await get(nirS, '/nir/altas-previstas'))
      .json()
      .itens.find((x: { internacao: number }) => x.internacao === i.internacao);
    expect(depois.dpa).toBeNull();
    expect(depois.historicoDpa).toHaveLength(2);
    expect(depois.historicoDpa[1]).toMatchObject({ retirada: true, motivo: 'Exame pendente' });
    // Outra retirada sobre a mesma versão: a sucessão é única; sobre a retirada: já retirada.
    expect(
      (
        await post(med, '/nir/dpa/retirar', { internacao: i.internacao, anterior: dpaId, motivo: 'De novo' })
      ).json().codigo,
    ).toBe('dpa-desatualizada');
    expect(
      (
        await post(med, '/nir/dpa/retirar', {
          internacao: i.internacao,
          anterior: ret.json().id,
          motivo: 'De novo',
        })
      ).json().codigo,
    ).toBe('dpa-retirada');
    // Nova DPA depois da retirada: sucede a versão retirada.
    expect(
      (
        await post(med, '/nir/dpa', {
          internacao: i.internacao,
          data: amanha,
          anterior: ret.json().id,
          motivo: 'Exame feito',
        })
      ).statusCode,
    ).toBe(201);

    const b = await post(nirS, '/nir/barreiras', {
      internacao: i.internacao,
      tipo: 'social',
      descricao: 'Aguardando vaga em ILPI',
      responsavel: 'Serviço social',
      prazo: amanha,
    });
    const bid = b.json().id as number;
    expect(
      (await post(nirS, `/nir/barreiras/${bid}/alterar`, { responsavel: 'Assistente social' })).statusCode,
    ).toBe(400);
    const alt = await post(nirS, `/nir/barreiras/${bid}/alterar`, {
      responsavel: 'Assistente social do andar',
      motivo: 'Troca de responsável',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(estadoNir.alteracoes.find((x) => x.tabela === 'SGH_INT_BARREIRA_ALTA')).toMatchObject({
      antes: { responsavel: 'Serviço social' },
      motivo: 'Troca de responsável',
    });
    expect((await post(nirS, `/nir/barreiras/${bid}/encerrar`, { resultado: 'resolvida' })).statusCode).toBe(
      400,
    );
    const enc = await post(nirS, `/nir/barreiras/${bid}/encerrar`, {
      resultado: 'resolvida',
      motivo: 'Vaga conseguida',
    });
    expect(enc.statusCode, enc.body).toBe(200);
    const fim = (await get(nirS, '/nir/altas-previstas'))
      .json()
      .itens.find((x: { internacao: number }) => x.internacao === i.internacao);
    // Encerrada, a barreira continua lá (mesmo número: o vínculo com a avaliação do serviço social não se perde).
    expect(fim.barreiras.find((x: { id: number }) => x.id === bid)).toMatchObject({
      situacao: 'resolvida',
      responsavel: 'Assistente social do andar',
    });
    expect(
      (
        await post(nirS, `/nir/barreiras/${bid}/alterar`, { prazo: amanha, motivo: 'Depois de resolvida' })
      ).json().codigo,
    ).toBe('barreira-resolvida');

    expect(
      (
        await post(nirS, '/nir/limites', {
          escopo: 'clinica',
          chave: 'C',
          amareloDias: 3,
          vermelhoDias: 6,
          origem: 'manual',
        })
      ).statusCode,
    ).toBe(200);
    expect((await post(nirS, '/nir/limites/remover', { escopo: 'clinica', chave: 'C' })).statusCode).toBe(
      400,
    );
    const rem = await post(nirS, '/nir/limites/remover', {
      escopo: 'clinica',
      chave: 'C',
      motivo: 'Volta ao padrão',
    });
    expect(rem.statusCode, rem.body).toBe(200);
    expect(estadoNir.alteracoes.find((x) => x.tabela === 'SGH_INT_LIMITE_PERMAN')).toMatchObject({
      acao: 'remover',
      antes: { amareloDias: 3, vermelhoDias: 6 },
    });
    expect(
      (await post(nirS, '/nir/limites/remover', { escopo: 'clinica', chave: 'C', motivo: 'De novo' })).json()
        .codigo,
    ).toBe('limite-inexistente');

    // Alterar o limite próprio que já existe: o motivo é obrigatório e o valor anterior vai à trilha.
    const lim = (x: Record<string, unknown>) =>
      post(nirS, '/nir/limites', {
        escopo: 'clinica',
        chave: 'D',
        amareloDias: 5,
        vermelhoDias: 10,
        origem: 'manual',
        ...x,
      });
    expect((await lim({})).statusCode).toBe(200);
    const semMotivo = await lim({ amareloDias: 7, vermelhoDias: 14 });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().codigo).toBe('motivo-obrigatorio');
    expect((await lim({ amareloDias: 7, vermelhoDias: 14, motivo: 'Nova meta' })).statusCode).toBe(200);
    expect((await lim({ amareloDias: 9, vermelhoDias: 18, motivo: 'Meta revista' })).statusCode).toBe(200);
    expect(
      estadoNir.alteracoes
        .filter((x) => x.tabela === 'SGH_INT_LIMITE_PERMAN' && x.chave === 'clinica:D')
        .map((x) => [x.acao, x.antes, x.motivo]),
    ).toEqual([
      ['alterar', { amareloDias: 5, vermelhoDias: 10 }, 'Nova meta'],
      ['alterar', { amareloDias: 7, vermelhoDias: 14 }, 'Meta revista'],
    ]);
    // Reenviar o mesmo valor não pede motivo nem grava trilha.
    expect((await lim({ amareloDias: 9, vermelhoDias: 18 })).statusCode).toBe(200);
  });
});

describe('W0-07: estado e atributos do leito', () => {
  it('altera o estado aberto sem encerrar (justificativa) e limpa os atributos (volta ao padrão)', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const mapa = (await get(s, '/leitos/mapa')).json() as {
      leitos: {
        chave: string;
        situacao: string;
        leito: { bloco: string; acomodacao: string; leito: string };
      }[];
    };
    const l = mapa.leitos.find((x) => x.situacao === 'livre')!;
    expect(
      (await post(s, '/leitos/estados', { leito: l.leito, estado: 'bloqueio', motivo: 'manutencao' }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await post(s, '/leitos/estados/alterar', {
          leito: l.leito,
          estado: 'bloqueio',
          previsaoFim: '2026-12-01',
        })
      ).statusCode,
    ).toBe(400);
    const a = await post(s, '/leitos/estados/alterar', {
      leito: l.leito,
      estado: 'bloqueio',
      previsaoFim: '2026-12-01',
      observacao: 'Troca do painel de gases',
      justificativa: 'Previsão informada pela manutenção',
    });
    expect(a.statusCode, a.body).toBe(200);
    const depois = (await get(s, '/leitos/mapa'))
      .json()
      .leitos.find((x: { chave: string }) => x.chave === l.chave);
    expect(depois.situacao).toBe('bloqueado');
    expect(adt.alteracoes.find((x) => x.tabela === 'SGH_INT_LEITO_ESTADO')).toMatchObject({
      antes: { previsaoFim: null },
      motivo: 'Previsão informada pela manutenção',
    });
    expect(
      (
        await post(s, '/leitos/estados/alterar', {
          leito: l.leito,
          estado: 'extra',
          observacao: 'x',
          justificativa: 'Sem estado',
        })
      ).json().codigo,
    ).toBe('estado-inexistente');

    expect(
      (await post(s, '/leitos/atributos', { leito: l.leito, sexo: 'F', idadeMinima: 16 })).statusCode,
    ).toBe(200);
    // Alterar os atributos que já existem: motivo obrigatório e o valor anterior na trilha.
    const semMotivo = await post(s, '/leitos/atributos', { leito: l.leito, sexo: 'F', idadeMinima: 18 });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().codigo).toBe('motivo-obrigatorio');
    expect(
      (
        await post(s, '/leitos/atributos', {
          leito: l.leito,
          sexo: 'F',
          idadeMinima: 18,
          motivo: 'Leito adulto',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      adt.alteracoes.find((x) => x.tabela === 'SGH_INT_LEITO_ATRIBUTO' && x.acao === 'alterar'),
    ).toMatchObject({ antes: { idadeMinima: 16 }, motivo: 'Leito adulto' });
    expect((await post(s, '/leitos/atributos/limpar', { leito: l.leito })).statusCode).toBe(400);
    const c = await post(s, '/leitos/atributos/limpar', {
      leito: l.leito,
      justificativa: 'Leito voltou a ser misto',
    });
    expect(c.statusCode, c.body).toBe(200);
    expect(
      adt.alteracoes.find((x) => x.tabela === 'SGH_INT_LEITO_ATRIBUTO' && x.acao === 'limpar'),
    ).toMatchObject({
      acao: 'limpar',
      antes: { sexo: 'F', idadeMinima: 18 },
    });
    expect(
      (await post(s, '/leitos/atributos/limpar', { leito: l.leito, justificativa: 'De novo' })).json().codigo,
    ).toBe('atributos-inexistentes');
  });
});
