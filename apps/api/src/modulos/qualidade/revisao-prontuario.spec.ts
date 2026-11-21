// W0-04 (M5): a comissão de revisão de prontuários pela API, sobre a porta em memória (dados SINTÉTICOS): o checklist
// versionado, o sorteio reproduzível com a semente registrada, a revisão com as pendências ao médico assistente, a
// resposta do próprio profissional, o aval (crítico) lido pelo SAME, o percentual conforme por clínica e as recusas.
import { criarAppQualidade } from './teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCcihMemoria } from './porta-ccih-memoria.js';
import { PortaGestaoMemoria } from './porta-gestao-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-27 12:00 em São Paulo. */
const agora = () => new Date('2026-10-27T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}
let app: NestFastifyApplication;
let porta: PortaGestaoMemoria;
let trilha: RegistradorTrilhaMemoria;
let qu: Sessao;
let med: Sessao;
let arq: Sessao;
let ou: Sessao;

async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, r.body).toBe(201);
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
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    payload: payload as object,
  });
const json = <T = Record<string, unknown>>(r: { body: string }) => JSON.parse(r.body) as T;
const codigo = (r: { body: string }) => json<{ codigo?: string }>(r).codigo;
const B = '/qualidade/revisao-prontuarios';

/** 30 altas sintéticas de setembro em duas clínicas; o médico 501 tem o login SINT.MEDICO. */
const ALTAS = Array.from({ length: 30 }, (_, i) => ({
  reg: 9_100_000 + i,
  paciente: 9_200_000 + i,
  alta: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  clinica: i % 2 ? 'Cirurgia geral' : 'Clínica médica',
  medicoRegistro: 501,
  medicoNome: 'MEDICO SINTETICO',
}));

beforeAll(async () => {
  trilha = new RegistradorTrilhaMemoria();
  porta = new PortaGestaoMemoria({ agora });
  porta.altasSint.set('2026-09', ALTAS);
  porta.loginsSint.set(501, 'SINT.MEDICO');
  app = await criarAppQualidade(env, {
    trilha,
    gestao: porta,
    ccih: new PortaCcihMemoria({ agora }),
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  qu = await entrar('SINT.QUALIDADE');
  med = await entrar('SINT.MEDICO');
  arq = await entrar('SINT.ARQUIVO');
  ou = await entrar('SINT.OUVIDORIA');
});
afterAll(async () => {
  await app.close();
});

const CHK = [
  { codigo: 'evolucao-diaria', titulo: 'Evolução médica diária, datada e assinada' },
  { codigo: 'sumario-alta', titulo: 'Sumário de alta com diagnóstico e orientações' },
];

describe('W0-04 (M5): comissão de revisão de prontuários', () => {
  let comissao = 0;
  let sorteio = 0;
  let semente = '';

  it('só a comissão do tipo revisão de prontuários; o checklist versionado (a seguinte exige motivo)', async () => {
    const ccih = await post(qu, '/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'ccih',
      nome: 'CCIH sintética (M5)',
      periodicidade: 'mensal',
      membros: [{ nome: 'Membro sintético', funcao: 'Presidente', login: null }],
      ativa: true,
    });
    expect(ccih.statusCode, ccih.body).toBe(201);
    const naoE = await post(qu, `${B}/checklists`, {
      comissao: json<{ id: number }>(ccih).id,
      itens: CHK,
      motivo: null,
      vigente: null,
    });
    expect([naoE.statusCode, codigo(naoE)]).toEqual([422, 'comissao-nao-e-de-prontuario']);
    const r = await post(qu, '/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'prontuario',
      nome: 'Comissão de revisão de prontuários (sintética)',
      periodicidade: 'mensal',
      membros: [{ nome: 'Médico revisor sintético', funcao: 'Presidente', login: null }],
      ativa: true,
    });
    comissao = json<{ id: number }>(r).id;
    const lista = json<{ itens: { id: number }[]; sugerido: unknown[] }>(await get(qu, `${B}/comissoes`));
    expect(lista.itens.map((c) => c.id)).toEqual([comissao]);
    expect(lista.sugerido.length).toBeGreaterThan(3);
    // Sem checklist, o sorteio recusa.
    const sem = await post(qu, `${B}/sorteios`, {
      comissao,
      competencia: '2026-09',
      quantidade: 5,
      semente: null,
    });
    expect([sem.statusCode, codigo(sem)]).toEqual([422, 'checklist-ausente']);
    const p1 = await post(qu, `${B}/checklists`, {
      comissao,
      itens: CHK.slice(0, 1),
      motivo: null,
      vigente: null,
    });
    expect(p1.statusCode, p1.body).toBe(201);
    const v1 = json<{ id: number; revisao: number }>(p1);
    expect(v1.revisao).toBe(1);
    const semMotivo = await post(qu, `${B}/checklists`, {
      comissao,
      itens: CHK,
      motivo: null,
      vigente: { id: v1.id, versao: 1 },
    });
    expect([semMotivo.statusCode, codigo(semMotivo)]).toEqual([422, 'motivo-obrigatorio']);
    const p2 = await post(qu, `${B}/checklists`, {
      comissao,
      itens: CHK,
      motivo: 'Inclui o sumário de alta no checklist.',
      vigente: { id: v1.id, versao: 1 },
    });
    expect(p2.statusCode, p2.body).toBe(201);
    const cs = json<{ itens: { revisao: number; situacao: string; itens: unknown[] }[] }>(
      await get(qu, `${B}/checklists?comissao=${comissao}`),
    ).itens;
    expect(cs.map((c) => [c.revisao, c.situacao, c.itens.length])).toEqual([
      [2, 'vigente', 2],
      [1, 'substituida', 1],
    ]);
  });

  it('sorteio reproduzível: semente registrada, a conferência refaz a mesma amostra; recusas da amostra', async () => {
    const altas = json<{ universo: number; sugerida: number }>(
      await get(qu, `${B}/altas?competencia=2026-09`),
    );
    expect(altas).toMatchObject({ universo: 30, sugerida: 10 });
    const aberta = await post(qu, `${B}/sorteios`, {
      comissao,
      competencia: '2026-10',
      quantidade: 5,
      semente: null,
    });
    expect([aberta.statusCode, codigo(aberta)]).toEqual([422, 'competencia-aberta']);
    const grande = await post(qu, `${B}/sorteios`, {
      comissao,
      competencia: '2026-09',
      quantidade: 31,
      semente: null,
    });
    expect([grande.statusCode, codigo(grande)]).toEqual([422, 'amostra-maior-que-universo']);
    const r = await post(qu, `${B}/sorteios`, {
      comissao,
      competencia: '2026-09',
      quantidade: 6,
      semente: 'SINT-2026-09',
    });
    expect(r.statusCode, r.body).toBe(201);
    const b = json<{ id: number; semente: string; quantidade: number; universo: number }>(r);
    expect(b).toMatchObject({ semente: 'SINT-2026-09', quantidade: 6, universo: 30 });
    sorteio = b.id;
    semente = b.semente;
    const conf = json<{ universoIgual: boolean; amostraIgual: boolean }>(
      await get(qu, `${B}/sorteios/${sorteio}/conferencia`),
    );
    expect(conf).toMatchObject({ universoIgual: true, amostraIgual: true });
    // A semente gerada pelo servidor também fica registrada.
    const outro = json<{ id: number; semente: string }>(
      await post(qu, `${B}/sorteios`, { comissao, competencia: '2026-09', quantidade: 3, semente: null }),
    );
    expect(outro.semente).toMatch(/^2026-09-[0-9A-Z]+$/);
    const lista = json<{ itens: { id: number; semente: string; resumoUniverso: string }[] }>(
      await get(qu, `${B}/sorteios?comissao=${comissao}`),
    ).itens;
    expect(lista.find((x) => x.id === sorteio)?.semente).toBe(semente);
    expect(lista[0]?.resumoUniverso).toMatch(/^[0-9a-f]{64}$/);
    // O sorteio sem revisão cancela com motivo e a senha; o cancelado fica visível.
    const semSenha = await post(qu, `${B}/sorteios/${outro.id}/cancelamento`, {
      versao: 1,
      justificativa: 'Sorteado em duplicidade.',
    });
    expect(semSenha.statusCode).toBe(401);
    const c = await post(qu, `${B}/sorteios/${outro.id}/cancelamento`, {
      versao: 1,
      justificativa: 'Sorteado em duplicidade.',
      senha: SENHA,
    });
    expect(c.statusCode, c.body).toBe(201);
    const canc = json<{ itens: { id: number; canceladoEm: string | null }[] }>(
      await get(qu, `${B}/sorteios?comissao=${comissao}`),
    ).itens.find((x) => x.id === outro.id);
    expect(canc?.canceladoEm).not.toBeNull();
  });

  it('revisão: não conforme vira pendência ao médico; o médico responde; aval (com senha) e o SAME lê', async () => {
    const d = json<{
      prontuarios: { id: number; reg: number; versao: number; situacao: string; clinica: string }[];
      checklist: { revisao: number };
    }>(await get(qu, `${B}/sorteios/${sorteio}`));
    expect(d.prontuarios).toHaveLength(6);
    expect(d.checklist.revisao).toBe(2);
    const [p1, p2] = d.prontuarios;
    const incompleta = await post(qu, `${B}/prontuarios/${p1!.id}/revisao`, {
      versao: 1,
      respostas: [{ item: 'evolucao-diaria', resultado: 'conforme', observacao: null }],
      observacao: null,
      justificativa: null,
    });
    expect([incompleta.statusCode, codigo(incompleta)]).toEqual([422, 'resposta-incompleta']);
    const r1 = await post(qu, `${B}/prontuarios/${p1!.id}/revisao`, {
      versao: 1,
      respostas: [
        { item: 'evolucao-diaria', resultado: 'conforme', observacao: null },
        { item: 'sumario-alta', resultado: 'naoConforme', observacao: 'Sem as orientações de alta.' },
      ],
      observacao: null,
      justificativa: null,
    });
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await post(qu, `${B}/prontuarios/${p2!.id}/revisao`, {
      versao: 1,
      respostas: CHK.map((i) => ({ item: i.codigo, resultado: 'conforme', observacao: null })),
      observacao: null,
      justificativa: null,
    });
    expect(r2.statusCode, r2.body).toBe(201);
    // O sorteio com revisão não cancela mais (quantos e quais).
    const naoCancela = await post(qu, `${B}/sorteios/${sorteio}/cancelamento`, {
      versao: 1,
      justificativa: 'Tentativa de cancelar com revisão.',
      senha: SENHA,
    });
    expect([naoCancela.statusCode, codigo(naoCancela)]).toEqual([409, 'sorteio-com-revisao']);
    expect(json<{ detail: string }>(naoCancela).detail).toContain('Prontuários já revisados do sorteio (2)');
    // Aval com pendência aberta: recusa com a lista.
    const cedo = await post(qu, `${B}/prontuarios/${p1!.id}/aval`, { versao: 2, senha: SENHA });
    expect([cedo.statusCode, codigo(cedo)]).toEqual([409, 'pendencia-aberta']);
    // O médico vê e responde a própria pendência; outro usuário não responde.
    const minhas = json<{
      itens: { id: number; versao: number; situacao: string; descricao: string; prazo: string }[];
    }>(await get(med, `${B}/minhas-pendencias`)).itens;
    expect(minhas).toHaveLength(1);
    expect(minhas[0]).toMatchObject({ situacao: 'aberta', prazo: '2026-11-11' });
    expect(minhas[0]!.descricao).toBe(
      'Item não conforme: Sumário de alta com diagnóstico e orientações. Sem as orientações de alta.',
    );
    const alheia = await post(ou, `${B}/pendencias/${minhas[0]!.id}/resposta`, {
      versao: 1,
      resposta: 'Resposta de quem não é o médico.',
    });
    expect([alheia.statusCode, codigo(alheia)]).toEqual([403, 'pendencia-nao-e-sua']);
    const resp = await post(med, `${B}/pendencias/${minhas[0]!.id}/resposta`, {
      versao: 1,
      resposta: 'Orientações de alta incluídas no sumário (sintético).',
    });
    expect(resp.statusCode, resp.body).toBe(201);
    // Sem a senha o aval não passa; com a senha, passa; o SAME lê o aval pela internação.
    const semSenha = await post(qu, `${B}/prontuarios/${p1!.id}/aval`, { versao: 2 });
    expect(semSenha.statusCode).toBe(401);
    const aval = await post(qu, `${B}/prontuarios/${p1!.id}/aval`, { versao: 2, senha: SENHA });
    expect(aval.statusCode, aval.body).toBe(201);
    const lido = json<{
      revisado: boolean;
      situacao: string;
      avalPor: string;
      texto: string;
      pendenciasAbertas: number;
    }>(await get(arq, `${B}/aval?reg=${p1!.reg}`));
    expect(lido).toMatchObject({
      revisado: true,
      situacao: 'naoConforme',
      avalPor: 'SINT.QUALIDADE',
      pendenciasAbertas: 0,
      texto: 'Revisão de prontuário: aval 27/10/2026 SINT.QUALIDADE',
    });
    expect((await get(med, `${B}/aval?reg=${p1!.reg}`)).statusCode).toBe(403);
    // Depois do aval, a revisão não muda.
    const depois = await post(qu, `${B}/prontuarios/${p1!.id}/revisao`, {
      versao: 3,
      respostas: CHK.map((i) => ({ item: i.codigo, resultado: 'conforme', observacao: null })),
      observacao: null,
      justificativa: 'Corrigindo depois do aval (não pode).',
    });
    expect([depois.statusCode, codigo(depois)]).toEqual([409, 'revisao-com-aval']);
  });

  it('correção da revisão antes do aval: exige justificativa, guarda a versão anterior e cancela a pendência', async () => {
    const d = json<{ prontuarios: { id: number; versao: number }[] }>(
      await get(qu, `${B}/sorteios/${sorteio}`),
    );
    const p3 = d.prontuarios[2]!;
    await post(qu, `${B}/prontuarios/${p3.id}/revisao`, {
      versao: 1,
      respostas: [
        { item: 'evolucao-diaria', resultado: 'naoConforme', observacao: null },
        { item: 'sumario-alta', resultado: 'conforme', observacao: null },
      ],
      observacao: null,
      justificativa: null,
    });
    const semJust = await post(qu, `${B}/prontuarios/${p3.id}/revisao`, {
      versao: 2,
      respostas: CHK.map((i) => ({ item: i.codigo, resultado: 'conforme', observacao: null })),
      observacao: null,
      justificativa: null,
    });
    expect([semJust.statusCode, codigo(semJust)]).toEqual([422, 'justificativa-obrigatoria']);
    const ok = await post(qu, `${B}/prontuarios/${p3.id}/revisao`, {
      versao: 2,
      respostas: CHK.map((i) => ({ item: i.codigo, resultado: 'conforme', observacao: null })),
      observacao: null,
      justificativa: 'A evolução estava na folha anexa.',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const v = json<{
      itens: { versao: number; acao: string; motivo: string; dados: { situacao?: string } }[];
    }>(await get(qu, `${B}/versoes/revisao-prontuario/${p3.id}`)).itens;
    expect(v[0]).toMatchObject({ versao: 2, acao: 'correcao', motivo: 'A evolução estava na folha anexa.' });
    const pend = json<{
      prontuarios: { id: number; pendencias: { situacao: string; motivoCancelamento: string }[] }[];
    }>(await get(qu, `${B}/sorteios/${sorteio}`)).prontuarios.find((p) => p.id === p3.id)!.pendencias;
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ situacao: 'cancelada' });
    expect(pend[0]!.motivoCancelamento).toContain('A evolução estava na folha anexa.');
  });

  it('percentual conforme por clínica com as parcelas; sem permissão, 403; a trilha sem respostas', async () => {
    const r = await get(qu, `${B}/indicador?comissao=${comissao}&competencia=2026-09`);
    expect(r.statusCode, r.body).toBe(200);
    const ind = json<{
      total: { revisados: number; conformes: number; conta: string };
      porClinica: { clinica: string; revisados: number; conformes: number; conta: string }[];
      pendenciasAbertas: number;
    }>(r);
    expect(ind.total).toMatchObject({ revisados: 3, conformes: 2, conta: '2 ÷ 3 × 100 = 66,67%' });
    expect(ind.porClinica.reduce((s, c) => s + c.revisados, 0)).toBe(3);
    expect(ind.pendenciasAbertas).toBe(0);
    expect((await get(ou, `${B}/indicador?comissao=${comissao}&competencia=2026-09`)).statusCode).toBe(403);
    const linhas = JSON.stringify(trilha.eventos);
    expect(linhas).toContain('qualidade.revisaoProntuario.sorteada');
    expect(linhas).toContain('qualidade.revisaoProntuario.aval');
    expect(linhas).not.toContain('Sem as orientações de alta');
  });
});
