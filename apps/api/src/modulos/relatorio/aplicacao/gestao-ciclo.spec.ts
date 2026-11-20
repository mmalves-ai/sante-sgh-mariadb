// W0-09 (programa CRUD completo) pela HTTP, sessão sintética: o ciclo do pedido de relatório (editar enquanto aberto,
// cancelar com motivo, excluir só o nunca atendido, com log; o atendido recusa com os vínculos e oferece o
// cancelamento) e do envio agendado (Alterar com motivo sem redigitar os endereços, que só aparecem mascarados;
// desativar com motivo; excluir só o que nunca rodou; o envio continua sem sair do dev: SEM_ENVIO_NO_DEV bloqueia).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SEM_ENVIO_NO_DEV } from '@sgh/contratos';
import { classificarChavesFull } from '@sgh/dominio-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../../config/configuracao-fonte.js';
import { PortaRelatorioMemoria } from '../porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let chave = 0;

async function subir(semEnvioNoDev: boolean) {
  const trilha = new RegistradorTrilhaMemoria();
  const relatorio = new PortaRelatorioMemoria(trilha);
  const semEnvio = new Set(SEM_ENVIO_NO_DEV.map((e) => e.chave));
  const configuracao = semEnvioNoDev
    ? fonteConfiguracaoMemoria(trilha, {
        // A liberação full do dev: as chaves de SEM_ENVIO_NO_DEV nunca ficam ligadas.
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => !semEnvio.has(c.chave)),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    relatorio,
    vigia: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, trilha, relatorio };
}

let app: NestFastifyApplication;
let trilha: RegistradorTrilhaMemoria;
let porta: PortaRelatorioMemoria;
beforeAll(async () => {
  ({ app, trilha, relatorio: porta } = await subir(false));
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string, a = app) {
  const r = await a.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  const set = r.headers['set-cookie'] as string[];
  return {
    a,
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
type S = Awaited<ReturnType<typeof entrar>>;
const get = (s: S, url: string) =>
  s.a.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: S, url: string, payload: unknown = {}) =>
  s.a.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-w009-rel-${++chave}-${Date.now()}`,
    },
    payload: payload as object,
  });

const PEDIDO = {
  titulo: 'Leitos bloqueados por mês',
  descricao: 'Quantidade de leitos bloqueados por motivo e unidade, mês a mês, com o total.',
  finalidade: 'Planejamento de manutenção dos leitos.',
  area: 'Coordenação de leitos',
  prazo: '2099-12-31',
};
const ENVIO = {
  relatorio: 'atendimentosPorDia',
  titulo: 'Atendimentos de ontem',
  parametros: { inicio: 'ontem', fim: 'ontem' },
  grupos: [],
  enderecos: ['diretoria@exemplo.invalid', 'qualidade@hospital.invalid'],
  periodicidade: 'diaria',
  hora: 700,
  diaSemana: null,
  diaMes: null,
};
const semOsEnderecos = (): Omit<typeof ENVIO, 'enderecos'> => {
  const x: Partial<typeof ENVIO> = { ...ENVIO };
  delete x.enderecos;
  return x as Omit<typeof ENVIO, 'enderecos'>;
};
/** A operação da trilha (sem x-correlacao, a correlação é a operação). */
const operacoes = (recurso: string) =>
  trilha.eventos.filter((l) => l.recurso === recurso).map((l) => l.correlacao);

describe('pedido de relatório: editar enquanto aberto, cancelar com motivo, excluir só o nunca atendido', () => {
  it('corrige o aberto com motivo (o anterior fica no histórico); respondido, recusa a edição', async () => {
    const area = await entrar('SINT.LEITOS');
    const id = (await post(area, '/relatorios/pedidos', PEDIDO)).json().id as string;
    const lido = (await get(area, '/relatorios/pedidos')).json()[0];
    expect(lido).toMatchObject({ situacao: 'aberto', editavel: true, cancelavel: true, excluivel: true });
    // Sem motivo: 400.
    expect((await post(area, `/relatorios/pedidos/${id}`, PEDIDO)).statusCode).toBe(400);
    const ok = await post(area, `/relatorios/pedidos/${id}`, {
      ...PEDIDO,
      titulo: 'Leitos bloqueados por mês e unidade',
      motivo: 'Faltou a unidade no título',
    });
    expect(ok.statusCode).toBe(200);
    expect((await get(area, '/relatorios/pedidos')).json()[0].titulo).toBe(
      'Leitos bloqueados por mês e unidade',
    );
    const h = (await get(area, `/relatorios/pedidos/${id}/historico`)).json();
    expect(h).toEqual([
      expect.objectContaining({ evento: 'alteracao', motivo: 'Faltou a unidade no título' }),
    ]);
    // Outro usuário (sem ser o curador) não mexe no pedido de quem pediu.
    const outro = await entrar('SINT.DIRETORIA');
    expect(
      (await post(outro, `/relatorios/pedidos/${id}/cancelamento`, { motivo: 'Não é meu pedido' }))
        .statusCode,
    ).toBe(404);
    // O curador põe em análise: o pedido não se edita mais.
    const cur = await entrar('SINT.ADMIN');
    await post(cur, `/relatorios/pedidos/${id}/resposta`, {
      situacao: 'em-analise',
      relatorio: null,
      resposta: 'Vamos ver.',
    });
    const r = await post(area, `/relatorios/pedidos/${id}`, { ...PEDIDO, motivo: 'Outra correção' });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('pedido-nao-aberto');
  });

  it('o atendido não se exclui: 409 com os vínculos e a oferta de cancelar; cancelar com motivo o mantém visível', async () => {
    const area = await entrar('SINT.LEITOS');
    const cur = await entrar('SINT.ADMIN');
    const id = (await post(area, '/relatorios/pedidos', { ...PEDIDO, titulo: 'Pedido atendido' })).json()
      .id as string;
    await post(cur, `/relatorios/pedidos/${id}/resposta`, {
      situacao: 'em-analise',
      relatorio: null,
      resposta: 'Em análise.',
    });
    const ex = await post(area, `/relatorios/pedidos/${id}/exclusao`, { motivo: 'Não preciso mais' });
    expect(ex.statusCode).toBe(409);
    expect(ex.json()).toMatchObject({
      codigo: 'pedido-ja-executado',
      total: 1,
      podeInativar: true,
      dependentes: [{ rotulo: 'resposta do curador', quantidade: 1 }],
    });
    expect((await post(area, `/relatorios/pedidos/${id}/cancelamento`, {})).statusCode).toBe(400);
    expect(
      (await post(area, `/relatorios/pedidos/${id}/cancelamento`, { motivo: 'A área mudou de prioridade' }))
        .statusCode,
    ).toBe(200);
    const p = (await get(area, '/relatorios/pedidos')).json().find((x: { id: string }) => x.id === id);
    expect(p).toMatchObject({
      situacao: 'cancelado',
      motivoCancelamento: 'A área mudou de prioridade',
      canceladoPor: 'SINT.LEITOS',
      resposta: 'Em análise.',
      editavel: false,
      cancelavel: false,
      excluivel: false,
    });
    // Cancelado: o curador não responde mais, nem se cancela de novo.
    expect(
      (
        await post(cur, `/relatorios/pedidos/${id}/resposta`, {
          situacao: 'recusado',
          relatorio: null,
          resposta: 'Tarde demais.',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await post(area, `/relatorios/pedidos/${id}/cancelamento`, { motivo: 'De novo, por engano' })).json()
        .codigo,
    ).toBe('pedido-nao-cancelavel');
    const ex2 = await post(area, `/relatorios/pedidos/${id}/exclusao`, { motivo: 'Limpar a lista' });
    expect(ex2.json()).toMatchObject({ codigo: 'pedido-ja-executado', podeInativar: false });
  });

  it('o nunca atendido se exclui com motivo, com log (o evento leva a linha) e a trilha', async () => {
    const area = await entrar('SINT.LEITOS');
    const id = (await post(area, '/relatorios/pedidos', { ...PEDIDO, titulo: 'Pedido por engano' })).json()
      .id as string;
    expect((await post(area, `/relatorios/pedidos/${id}/exclusao`, {})).statusCode).toBe(400);
    expect(
      (await post(area, `/relatorios/pedidos/${id}/exclusao`, { motivo: 'Pedido feito por engano' }))
        .statusCode,
    ).toBe(200);
    expect((await get(area, '/relatorios/pedidos')).json().some((x: { id: string }) => x.id === id)).toBe(
      false,
    );
    expect(operacoes('relatorio.pedido')).toEqual(expect.arrayContaining(['alterar', 'cancelar', 'excluir']));
  });
});

describe('envio agendado: Alterar sem redigitar (mascarados), desativar com motivo, excluir só o que nunca rodou', () => {
  it('os endereços só mascarados; Alterar com motivo mantém os gravados; o que rodou não se exclui', async () => {
    const s = await entrar('SINT.ADMIN');
    const id = (await post(s, '/relatorios/agendamentos', ENVIO)).json().id as string;
    const lista = (await get(s, '/relatorios/agendamentos')).json();
    const a = lista.agendamentos.find((x: { id: string }) => x.id === id);
    expect(a).toMatchObject({
      enderecos: 2,
      enderecosMascarados: ['di***@ex***.invalid', 'qu***@ho***.invalid'],
    });
    expect(JSON.stringify(lista)).not.toMatch(/diretoria@|qualidade@/);
    const semEnderecos = semOsEnderecos();
    // Alterar sem motivo: 400; com motivo e "manter os endereços": os gravados ficam.
    expect(
      (
        await post(s, `/relatorios/agendamentos/${id}`, {
          ...semEnderecos,
          enderecos: [],
          manterEnderecos: true,
        })
      ).statusCode,
    ).toBe(400);
    const alt = await post(s, `/relatorios/agendamentos/${id}`, {
      ...semEnderecos,
      enderecos: [],
      manterEnderecos: true,
      hora: 830,
      motivo: 'A diretoria pediu o envio mais tarde',
    });
    expect(alt.statusCode).toBe(200);
    const depois = (await get(s, '/relatorios/agendamentos'))
      .json()
      .agendamentos.find((x: { id: string }) => x.id === id);
    expect(depois).toMatchObject({
      hora: 830,
      enderecos: 2,
      proximoEnvio: expect.stringMatching(/T08:30:00$/),
    });
    // Desativar sem motivo: 400; com motivo, vai ao histórico.
    expect((await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: false })).statusCode).toBe(400);
    expect(
      (await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: false, motivo: 'Diretoria em férias' }))
        .statusCode,
    ).toBe(200);
    const h = (await get(s, `/relatorios/agendamentos/${id}/historico`)).json();
    expect(h.map((x: { evento: string }) => x.evento)).toEqual(['alteracao', 'desativacao']);
    expect(JSON.stringify(h)).not.toMatch(/diretoria@/);
    // Revisão: reativar também exige o motivo (400 sem ele; nada de texto padrão); com motivo, vai ao histórico.
    expect((await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: true })).statusCode).toBe(400);
    expect(
      (await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: true, motivo: 'abc' })).statusCode,
    ).toBe(400);
    const ainda = (await get(s, '/relatorios/agendamentos'))
      .json()
      .agendamentos.find((x: { id: string }) => x.id === id);
    expect(ainda.ativo).toBe(false);
    expect(
      (await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: true, motivo: 'Voltou a enviar' }))
        .statusCode,
    ).toBe(200);
    const h2 = (await get(s, `/relatorios/agendamentos/${id}/historico`)).json();
    expect(h2.at(-1)).toMatchObject({ evento: 'ativacao', motivo: 'Voltou a enviar' });
    expect(JSON.stringify(h2)).not.toMatch(/Envio reativado/);
    // Rodou ("enviar agora" registra a execução): a exclusão recusa com a contagem e oferece desativar.
    expect((await post(s, `/relatorios/agendamentos/${id}/enviar`)).statusCode).toBe(200);
    const ex = await post(s, `/relatorios/agendamentos/${id}/exclusao`, { motivo: 'Não precisa mais' });
    expect(ex.statusCode).toBe(409);
    expect(ex.json()).toMatchObject({
      codigo: 'agendamento-ja-executado',
      total: 1,
      podeInativar: true,
      dependentes: [{ rotulo: 'envios e execuções registrados', quantidade: 1 }],
    });
    // Revisão: o envio que rodou e já está desativado não oferece desativar de novo (podeInativar: false).
    expect(
      (await post(s, `/relatorios/agendamentos/${id}/ativo`, { ativo: false, motivo: 'Diretoria em férias' }))
        .statusCode,
    ).toBe(200);
    const ex2 = await post(s, `/relatorios/agendamentos/${id}/exclusao`, { motivo: 'Não precisa mais' });
    expect(ex2.statusCode).toBe(409);
    expect(ex2.json()).toMatchObject({
      codigo: 'agendamento-ja-executado',
      podeInativar: false,
      detail: expect.stringMatching(/já está desativado/),
    });
  });

  it('o que nunca rodou se exclui com motivo e log', async () => {
    const s = await entrar('SINT.ADMIN');
    const id = (await post(s, '/relatorios/agendamentos', { ...ENVIO, titulo: 'Criado por engano' })).json()
      .id as string;
    expect((await post(s, `/relatorios/agendamentos/${id}/exclusao`, {})).statusCode).toBe(400);
    expect(
      (await post(s, `/relatorios/agendamentos/${id}/exclusao`, { motivo: 'Criado por engano' })).statusCode,
    ).toBe(200);
    expect(
      (await get(s, '/relatorios/agendamentos')).json().agendamentos.some((x: { id: string }) => x.id === id),
    ).toBe(false);
    expect((await get(s, `/relatorios/agendamentos/${id}/historico`)).json()).toEqual([
      expect.objectContaining({ evento: 'exclusao', motivo: 'Criado por engano' }),
    ]);
    expect(operacoes('relatorio.agendamento')).toContain('excluir');
  });
});

describe('o envio alterado continua sem sair do dev (SEM_ENVIO_NO_DEV)', () => {
  it('a liberação full do dev não liga relatorio.envioAgendado', () => {
    const c = classificarChavesFull({
      ambiente: 'dev',
      recursos: ['relatorio.envioAgendado'],
      operacoes: [],
    });
    expect(c.ligar).toEqual([]);
    expect(c.excluidas).toEqual([
      expect.objectContaining({ chave: 'relatorio.envioAgendado', lista: 'sem-envio-no-dev' }),
    ]);
  });

  it('com a chave fora (dev): Alterar grava, mas o envio é recusado (403) e nada é registrado como enviado', async () => {
    const dev = await subir(true);
    try {
      const s = await entrar('SINT.ADMIN', dev.app);
      const id = (await post(s, '/relatorios/agendamentos', ENVIO)).json().id as string;
      const semEnderecos = semOsEnderecos();
      expect(
        (
          await post(s, `/relatorios/agendamentos/${id}`, {
            ...semEnderecos,
            enderecos: ['nova@exemplo.invalid'],
            motivo: 'Troca do destinatário',
          })
        ).statusCode,
      ).toBe(200);
      const l = (await get(s, '/relatorios/agendamentos')).json();
      expect(l.envioLigado).toBe(false);
      expect(l.agendamentos[0].enderecosMascarados).toEqual(['no***@ex***.invalid']);
      expect(JSON.stringify(l)).not.toContain('nova@exemplo.invalid');
      const e = await post(s, `/relatorios/agendamentos/${id}/enviar`);
      expect(e.statusCode).toBe(403);
      expect(e.json().codigo).toBe('recurso-desligado');
      // Nada rodou: o envio continua excluível (nenhuma execução registrada).
      expect(
        (await post(s, `/relatorios/agendamentos/${id}/exclusao`, { motivo: 'Fim do teste do dev' }))
          .statusCode,
      ).toBe(200);
      expect(dev.trilha.eventos.some((x) => x.correlacao.startsWith('enviar:'))).toBe(false);
    } finally {
      await dev.app.close();
    }
  });
});

describe('revisão W0-09: o valor anterior é o vigente na transação, não o lido antes (edições concorrentes)', () => {
  const ctx = { rede: 'rede', hospital: 'aa' };
  /** Simula a leitura feita antes da gravação de outro operador: a porta devolve a cópia velha fora da transação. */
  function leituraVelha<K extends 'pedido' | 'agendamento'>(metodo: K, id: string) {
    const original = porta[metodo].bind(porta) as (c: typeof ctx, i: string) => Promise<unknown>;
    let velha: unknown = null;
    (porta as unknown as Record<K, unknown>)[metodo] = async (c: typeof ctx, i: string) =>
      i === id && velha !== null ? velha : original(c, i);
    return {
      congelar: async () => {
        velha = structuredClone(await original(ctx, id));
      },
      soltar: () => {
        (porta as unknown as Record<K, unknown>)[metodo] = original;
      },
    };
  }
  const antesDe = async (alvo: 'pedido' | 'agendamento', id: string) =>
    (await porta.eventos(ctx, alvo, id)).map((e) => JSON.parse(e.antes ?? 'null') as Record<string, unknown>);

  it('pedido: A grava v1 sobre v0; B, que leu v0, grava v2 e o evento dele traz v1 como anterior', async () => {
    const area = await entrar('SINT.LEITOS');
    const id = (await post(area, '/relatorios/pedidos', PEDIDO)).json().id as string;
    const v = leituraVelha('pedido', id);
    try {
      await v.congelar(); // B abre o pedido em v0
      const a = await post(area, `/relatorios/pedidos/${id}`, {
        ...PEDIDO,
        titulo: 'Versão A',
        motivo: 'Correção de A',
      });
      expect(a.statusCode).toBe(200);
      const b = await post(area, `/relatorios/pedidos/${id}`, {
        ...PEDIDO,
        titulo: 'Versão B',
        motivo: 'Correção de B',
      });
      expect(b.statusCode).toBe(200);
      const c = await post(area, `/relatorios/pedidos/${id}/cancelamento`, { motivo: 'Cancelado por C' });
      expect(c.statusCode).toBe(200);
    } finally {
      v.soltar();
    }
    expect((await antesDe('pedido', id)).map((x) => x['titulo'])).toEqual([
      PEDIDO.titulo,
      'Versão A',
      'Versão B',
    ]);
  });

  it('envio: alterado por A; B, que leu o anterior, desativa: o anterior é o de A e a linha fica com o que A gravou', async () => {
    const s = await entrar('SINT.ADMIN');
    const id = (await post(s, '/relatorios/agendamentos', ENVIO)).json().id as string;
    const v = leituraVelha('agendamento', id);
    try {
      await v.congelar(); // B abre o envio com a hora 7:00
      const alt = await post(s, `/relatorios/agendamentos/${id}`, {
        ...semOsEnderecos(),
        enderecos: [],
        manterEnderecos: true,
        hora: 930,
        motivo: 'A pediu 9:30',
      });
      expect(alt.statusCode).toBe(200);
      const des = await post(s, `/relatorios/agendamentos/${id}/ativo`, {
        ativo: false,
        motivo: 'B desativou',
      });
      expect(des.statusCode).toBe(200);
    } finally {
      v.soltar();
    }
    expect((await antesDe('agendamento', id)).map((x) => x['hora'])).toEqual([700, 930]);
    expect(await porta.agendamento(ctx, id)).toMatchObject({ hora: 930, ativo: false });
  });
});
