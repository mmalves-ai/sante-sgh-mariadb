// M20 (atendimento ambulatorial e pronto atendimento) pela HTTP, com a sessão real sobre a fonte sintética e as portas
// EM MEMÓRIA (nada conecta a banco): permissões pelas opções do legado, liberação (POL-3), abertura (consulta e PA),
// ficha auditada, segurado com o carimbo, procedimento extra com a conta conferida antes, fila do consultório (chamar e
// atender), desfecho com o ato médico só do médico, quadro e observação do PA, impressos (ZPL na fila da estação),
// exclusão pelo supervisor com a senha de novo, herança e indicadores. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { contextoDeTeste, moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloAtendimento } from './modulo.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { PortaRecepcaoMemoria } from '../recepcao/porta-memoria.js';
import { ApoiosAtendimento } from './atendimento.controller.js';
import { AvisosAtendimento } from './avisos.js';
import { portaAtendimentoIndisponivel } from './porta.js';
import { PortaAtendimentoMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro,atendimento',
};
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const recepcao = new PortaRecepcaoMemoria({ estado: () => 'verde' });
const atendimento = new PortaAtendimentoMemoria(
  { estado: () => 'verde' },
  { lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), recepcao },
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        atendimento: (ctx) => moduloAtendimento(ctx, { porta: atendimento }),
      },
    ),
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
  'idempotency-key': `teste-m20-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const CONSULTA = {
  tipo: 'consulta',
  paciente: 1001,
  convenio: 306,
  profissional: 7101,
  especialidade: 15,
  unidade: 1,
  centroCusto: 300600,
  procedimento: 10101012,
  carater: 'eletivo',
  cidPrincipal: 1,
  matricula: '900000000777',
};

describe('permissões, liberação e apoio', () => {
  it('sem as opções dos atendimentos, 403; com elas, o dia, a gravação e o vocabulário de produto', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/atendimento/dia')).statusCode).toBe(403);
    const s = await entrar('SINT.ATENDIMENTO');
    const d = await get(s, '/atendimento/dia');
    expect(d.statusCode).toBe(200);
    expect(d.json().itens.length).toBeGreaterThanOrEqual(2);
    expect(d.json().requisicoes).toBe(1);
    expect(
      (await get(s, '/atendimento/dia?requisicoes=sim'))
        .json()
        .itens.some((x: { requisicao: boolean }) => x.requisicao),
    ).toBe(true);
    const g = (await get(s, '/atendimento/gravacao')).json();
    expect(g.ambulatorio.ligada).toBe(true);
    expect(g.operacoes['atendimento.abrirAtendimento'].pode).toBe(true);
    expect(g.operacoes['atendimento.cancelarAtendimento'].pode).toBe(false);
    const a = (await get(s, '/atendimento/apoio')).json();
    expect(a.convenios.find((c: { codigo: number }) => c.codigo === 99).aceita).toBe(false);
    expect(a.heranca.map((x: { campo: string }) => x.campo)).toContain('convenio');
    // Os textos vistos pela pessoa (os valores; o nome do campo `tipoLegado` não aparece na tela).
    expect(JSON.stringify([d.json(), a, g]).replace(/"tipoLegado"/g, '')).not.toMatch(
      /SPDATA|legado|sistema atual/i,
    );
    expect((await get(s, '/atendimento/busca/cid?termo=febre')).json()[0].codigo).toBe('R509');
    expect((await get(s, '/atendimento/busca/procedimentos?termo=consulta')).statusCode).toBe(400);
    expect((await get(s, '/atendimento/busca/procedimentos?convenio=306&termo=glic')).json()).toHaveLength(1);
    expect((await get(s, '/atendimento/busca/solicitantes?termo=solic')).json()).toHaveLength(2);
  });
});

describe('abertura, ficha, segurado e procedimento extra', () => {
  it('abre a consulta, lê a ficha (auditado), altera o segurado pelo carimbo e lança o extra com a conta aberta', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const r = await post(s, '/atendimento', CONSULTA);
    expect(r.statusCode).toBe(201);
    const reg = r.json().resultado.reg as number;
    const d = await get(s, `/atendimento/${reg}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().conta.situacao).toBe('aberta');
    expect(
      trilha.eventos.some((l) => l.evento === 'atendimento.atendimento.lido' && l.idAlvo === String(reg)),
    ).toBe(true);
    const versao = d.json().versao as string;
    expect(
      (await post(s, `/atendimento/${reg}/segurado`, { versao, matricula: '900000000888' })).statusCode,
    ).toBe(200);
    const colisao = await post(s, `/atendimento/${reg}/segurado`, {
      versao: '2020-01-01 00:00:00.0000',
      guia: 'X',
    });
    expect(colisao.statusCode).toBe(409);
    const extra = await post(s, `/atendimento/${reg}/procedimentos`, {
      procedimento: 20101104,
      quantidade: 2,
    });
    expect(extra.statusCode).toBe(201);
    expect((await get(s, `/atendimento/${reg}`)).json().extras[0]).toMatchObject({
      procedimento: 20101104,
      valor: 90,
    });
    expect((await post(s, '/atendimento', { ...CONSULTA, convenio: 99 })).json().codigo).toBe(
      'convenio-inativo',
    );
    expect((await post(s, '/atendimento', { ...CONSULTA, paciente: 1006 })).statusCode).toBe(409);
    expect((await post(s, '/atendimento', { ...CONSULTA, cidPrincipal: undefined })).statusCode).toBe(400);
    expect((await get(s, '/atendimento/999')).statusCode).toBe(404);
  });

  it('a conta fechada recusa o extra antes, com o aviso', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const dia = (await get(s, '/atendimento/dia')).json();
    const fechada = dia.itens.find((x: { paciente: { id: number } }) => x.paciente.id === 1004);
    const r = await post(s, `/atendimento/${fechada.reg}/procedimentos`, {
      procedimento: 20101104,
      quantidade: 1,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('conta-fechada');
  });
});

describe('W1-05: correção da ficha, estorno e correção do extra, exclusão com dependentes', () => {
  const JUST = 'Corrigido na conferência da recepção';
  it('corrige a ficha aberta pelo carimbo com o total da conta antes e depois; colisão e nada a alterar', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1001 })).json().resultado
      .reg as number;
    const versao = (await get(s, `/atendimento/${reg}`)).json().versao as string;
    expect((await post(s, `/atendimento/${reg}/alterar`, { versao, convenio: 320 })).statusCode).toBe(400);
    const r = await post(s, `/atendimento/${reg}/alterar`, {
      versao,
      convenio: 320,
      procedimento: 10101039,
      justificativa: JUST,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultado).toMatchObject({ convenio: 320, totalAntes: 120, totalDepois: 150 });
    const d = (await get(s, `/atendimento/${reg}`)).json();
    expect(d.procedimento).toMatchObject({ codigo: 10101039, valor: 150 });
    const colisao = await post(s, `/atendimento/${reg}/alterar`, {
      versao: '2020-01-01 00:00:00.0000',
      carater: 'urgencia',
      justificativa: JUST,
    });
    expect(colisao.statusCode).toBe(409);
    const nada = await post(s, `/atendimento/${reg}/alterar`, {
      versao: d.versao,
      convenio: 320,
      justificativa: JUST,
    });
    expect(nada.json().codigo).toBe('nada-a-alterar');
  });

  it('revisão: a ficha mostra o CID, o solicitante e a observação gravados e a correção os retira com null', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1001 })).json().resultado
      .reg as number;
    const v0 = (await get(s, `/atendimento/${reg}`)).json().versao as string;
    const pos = await post(s, `/atendimento/${reg}/alterar`, {
      versao: v0,
      cidPrincipal: 1,
      cidSecundario: 2,
      solicitante: 501,
      observacao: 'anotada na recepção',
      justificativa: JUST,
    });
    expect(pos.statusCode).toBe(200);
    const d = (await get(s, `/atendimento/${reg}`)).json();
    expect(d).toMatchObject({
      cidPrincipal: { id: 1, codigo: 'R509' },
      cidSecundario: { id: 2, codigo: 'I10' },
      solicitante: { id: 501, registro: '52100' },
      observacaoFicha: 'anotada na recepção',
    });
    const tira = await post(s, `/atendimento/${reg}/alterar`, {
      versao: d.versao,
      cidSecundario: null,
      solicitante: null,
      observacao: null,
      justificativa: JUST,
    });
    expect(tira.statusCode).toBe(200);
    expect((await get(s, `/atendimento/${reg}`)).json()).toMatchObject({
      cidPrincipal: { id: 1 },
      cidSecundario: null,
      solicitante: null,
      observacaoFicha: null,
    });
  });

  it('a conta fechada recusa a troca do convênio e o estorno com o encaminhamento ao faturamento', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const fechada = (await get(s, '/atendimento/dia'))
      .json()
      .itens.find((x: { paciente: { id: number } }) => x.paciente.id === 1004);
    const versao = (await get(s, `/atendimento/${fechada.reg}`)).json().versao as string;
    const r = await post(s, `/atendimento/${fechada.reg}/alterar`, {
      versao,
      convenio: 320,
      justificativa: JUST,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('conta-fechada');
    expect(r.json().detail).toMatch(/faturamento/);
  });

  it('corrige a quantidade do extra, estorna com a senha e a ficha sem atos sai', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1001 })).json().resultado
      .reg as number;
    expect(
      (await post(s, `/atendimento/${reg}/procedimentos`, { procedimento: 20101104, quantidade: 2 }))
        .statusCode,
    ).toBe(201);
    const c = await post(s, `/atendimento/${reg}/procedimentos/1/corrigir`, {
      quantidade: 3,
      justificativa: JUST,
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().resultado).toMatchObject({
      quantidadeAntes: 2,
      quantidade: 3,
      valorAntes: 90,
      valor: 135,
    });
    const sup = await entrar('SINT.SUPERVISOR.ATD');
    expect((await get(sup, `/atendimento/${reg}/cancelamento`)).json().pode).toBe(false);
    expect(
      (await post(s, `/atendimento/${reg}/procedimentos/1/estornar`, { justificativa: JUST })).statusCode,
    ).toBe(401);
    const e = await post(s, `/atendimento/${reg}/procedimentos/1/estornar`, {
      justificativa: JUST,
      senha: SENHA,
    });
    expect(e.statusCode).toBe(200);
    expect((await get(s, `/atendimento/${reg}`)).json().extras).toEqual([]);
    expect(
      (
        await post(s, `/atendimento/${reg}/procedimentos/1/estornar`, { justificativa: JUST, senha: SENHA })
      ).json().codigo,
    ).toBe('procedimento-inexistente');
    expect((await get(sup, `/atendimento/${reg}/cancelamento`)).json().pode).toBe(true);
    const corpo = { motivo: 2, justificativa: 'Aberto por engano no cadastro errado', senha: SENHA };
    expect((await post(sup, `/atendimento/${reg}/cancelar`, corpo)).statusCode).toBe(200);
  });

  it('a ficha com ato clínico: a prévia lista quantos e quais e oferece a anulação; a exclusão recusa (409)', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1001 })).json().resultado
      .reg as number;
    atendimento.registrarAto(reg, 'Evolução', 'evolução 1');
    const sup = await entrar('SINT.SUPERVISOR.ATD');
    const p = (await get(sup, `/atendimento/${reg}/cancelamento`)).json();
    expect(p).toMatchObject({
      pode: false,
      saida: 'anular',
      dependentes: [{ rotulo: 'Evolução', quantidade: 1 }],
    });
    const corpo = { motivo: 2, justificativa: 'Aberto por engano no cadastro errado', senha: SENHA };
    const r = await post(sup, `/atendimento/${reg}/cancelar`, corpo);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ podeInativar: true, total: 1, dependentes: [{ rotulo: 'Evolução' }] });
  });
});

describe('consultório, desfecho e ato médico', () => {
  it('a fila do local, chamar e atender; a recepção não registra a alta; a evasão sim', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const sem = (await get(s, '/atendimento/fila')).json();
    expect(sem.local).toBeNull();
    expect(sem.locais.length).toBeGreaterThan(1);
    const f = (await get(s, '/atendimento/fila?local=3')).json();
    const item = f.itens.find((x: { prontuario: number }) => x.prontuario === 901004);
    expect(item.situacao).toBe('aguardando');
    expect(
      (await post(s, `/atendimento/${item.reg}/consultorio`, { local: 3, evento: 'chamar' })).statusCode,
    ).toBe(200);
    const depois = (await get(s, '/atendimento/fila?local=3')).json();
    expect(depois.itens.find((x: { reg: number }) => x.reg === item.reg).situacao).toBe('chamado');
    expect(
      (await post(s, `/atendimento/${item.reg}/consultorio`, { local: 3, evento: 'atender' })).statusCode,
    ).toBe(200);
    const alta = await post(s, `/atendimento/${item.reg}/encerrar`, { desfecho: 'alta' });
    expect(alta.statusCode).toBe(403);
    expect(alta.json().codigo).toBe('ato-medico');
    expect((await post(s, `/atendimento/${item.reg}/encerrar`, { desfecho: 'evasao' })).statusCode).toBe(200);
    expect(
      (await post(s, `/atendimento/${item.reg}/encerrar`, { desfecho: 'administrativo' })).json().codigo,
    ).toBe('atendimento-encerrado');
  });
});

describe('pronto atendimento: quadro, etapa, observação e desfecho do médico', () => {
  it('o quadro por etapa, a etapa registrada, o leito alocado e liberado, a alta pelo médico com conselho', async () => {
    const s = await entrar('SINT.MEDICO.PA');
    const q = (await get(s, '/pa/quadro')).json();
    const obs = q.colunas.find((c: { codigo: string }) => c.codigo === 'observacao');
    expect(obs.cartoes[0].paciente).toMatch(/MARIA APARECIDA/);
    expect(q.alvoPortaMedico).toBe(60);
    const recepcaoPa = await entrar('SINT.ATENDIMENTO');
    const aberto = await post(recepcaoPa, '/atendimento', {
      ...CONSULTA,
      tipo: 'pa',
      paciente: 1003,
      carater: 'urgencia',
      procedimento: 10101039,
      unidade: 3,
      centroCusto: 300400,
    });
    expect(aberto.statusCode).toBe(201);
    const reg = aberto.json().resultado.reg as number;
    expect((await post(s, `/pa/${reg}/etapa`, { etapa: 'exames' })).statusCode).toBe(201);
    const q2 = (await get(s, '/pa/quadro')).json();
    expect(
      q2.colunas
        .find((c: { codigo: string }) => c.codigo === 'exames')
        .cartoes.map((x: { reg: number }) => x.reg),
    ).toContain(reg);
    const o = (await get(s, '/pa/observacao')).json();
    const livre = o.leitos.find((l: { ocupacao: unknown }) => l.ocupacao === null);
    expect((await post(s, `/pa/${reg}/observacao`, { leito: 1 })).json().codigo).toBe('leito-ocupado');
    expect((await post(s, `/pa/${reg}/observacao`, { leito: livre.id })).statusCode).toBe(201);
    expect((await post(s, `/pa/${reg}/observacao/liberar`, {})).statusCode).toBe(200);
    expect((await post(s, `/pa/${reg}/desfecho`, { desfecho: 'alta' })).statusCode).toBe(200);
    expect(
      (await get(s, '/pa/quadro'))
        .json()
        .colunas.flatMap((c: { cartoes: { reg: number }[] }) => c.cartoes)
        .some((x: { reg: number }) => x.reg === reg),
    ).toBe(false);
    expect((await post(s, `/pa/${reg}/etapa`, { etapa: 'exames' })).statusCode).toBe(404);
  });
});

describe('impressos, exclusão, herança, não identificado e indicadores', () => {
  it('a pulseira em ZPL na fila da estação; o que falta para cada impresso', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const r = await post(s, '/atendimento', { ...CONSULTA, paciente: 1005 });
    const reg = r.json().resultado.reg as number;
    const lista = (await get(s, `/atendimento/${reg}/impressos`)).json();
    expect(lista.impressos.map((i: { impresso: string; pode: boolean }) => [i.impresso, i.pode])).toEqual([
      ['ficha', true],
      ['etiqueta', true],
      ['pulseira', true],
    ]);
    const p = await post(s, `/atendimento/${reg}/impressos`, {
      impresso: 'pulseira',
      formato: 'zpl',
      copias: 2,
    });
    expect(p.statusCode).toBe(201);
    expect(p.json().conteudo).toMatch(/^\^XA[\s\S]*\^PQ2/);
    expect(p.json().fila.novo).toBe(true);
    expect(
      (await post(s, `/atendimento/${reg}/impressos`, { impresso: 'pulseira', formato: 'pdf' })).statusCode,
    ).toBe(400);
    expect(
      (await post(s, `/atendimento/${reg}/impressos`, { impresso: 'pulseira', formato: 'zpl', copias: 9 }))
        .statusCode,
    ).toBe(400);
  });

  it('a exclusão: a recepção não exclui; o supervisor vê a prévia e confirma a senha', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const r = await post(s, '/atendimento', { ...CONSULTA, paciente: 1007 });
    const reg = r.json().resultado.reg as number;
    const corpo = { motivo: 2, justificativa: 'Aberto por engano no cadastro errado' };
    expect((await post(s, `/atendimento/${reg}/cancelar`, corpo)).statusCode).toBe(403);
    const sup = await entrar('SINT.SUPERVISOR.ATD');
    const p = (await get(sup, `/atendimento/${reg}/cancelamento`)).json();
    expect(p).toMatchObject({ pode: true, liberada: true, conta: { situacao: 'aberta' } });
    expect((await post(sup, `/atendimento/${reg}/cancelar`, corpo)).statusCode).toBe(401);
    expect((await post(sup, `/atendimento/${reg}/cancelar`, { ...corpo, senha: SENHA })).statusCode).toBe(
      200,
    );
    expect((await get(sup, `/atendimento/${reg}/cancelamento`)).statusCode).toBe(404);
  });

  it('a herança configurada e alterada pela versão; a marca do não identificado; os indicadores com as parcelas', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const cfg = (await get(s, '/atendimento/heranca')).json();
    expect(cfg.campos.find((c: { campo: string }) => c.campo === 'unidade').herda).toBe(false);
    const ok = await post(s, '/atendimento/heranca', { marcas: { unidade: true }, versao: cfg.versao });
    expect(ok.statusCode).toBe(200);
    expect(
      (await post(s, '/atendimento/heranca', { marcas: { unidade: false }, versao: cfg.versao })).statusCode,
    ).toBe(409);
    const hist = (await get(s, '/atendimento/pacientes/1001/historico')).json();
    expect(hist.anterior.valores.convenio).toBe(306);
    // O servidor aplica a herança: o convênio marcado vem em herdados; a guia nunca é herdada.
    expect(hist.anterior.herdados.convenio).toBe(306);
    expect(hist.anterior.herdados).not.toHaveProperty('guia');
    expect(Array.isArray(hist.anterior.avisos)).toBe(true);
    expect(
      (
        await post(s, '/atendimento/pacientes/1002/nao-identificado', {
          caracteristicas: 'Homem adulto, camisa azul',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(s, '/atendimento/pacientes/1002/nao-identificado', {
          caracteristicas: 'Homem adulto, camisa azul',
        })
      ).json().codigo,
    ).toBe('ja-marcado');
    expect((await get(s, '/atendimento/nao-identificados')).json()).toHaveLength(1);
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const i = (await get(s, `/atendimento/indicadores?inicio=${ontem}&fim=${hoje}`)).json();
    expect(i.atendimentos).toBeGreaterThan(0);
    expect(i.porCarater).toHaveLength(3);
    expect((await get(s, '/atendimento/indicadores?inicio=2026-10-10&fim=2026-10-01')).statusCode).toBe(400);
  });
});

describe('correções da revisão: permissões de agir, autor do desfecho e trilha das leituras', () => {
  it('chamar e atender exigem a permissão de conduzir a fila (quem só consulta lê a fila, não grava)', async () => {
    const so = await entrar('SINT.GUICHE');
    expect((await get(so, '/atendimento/fila?local=3')).statusCode).toBe(200);
    const g = (await get(so, '/atendimento/gravacao')).json();
    expect(g.operacoes['atendimento.conduzirNoConsultorio'].pode).toBe(false);
    const f = (await get(so, '/atendimento/fila?local=3')).json();
    const reg = f.itens[0]?.reg ?? 900_101;
    expect(
      (await post(so, `/atendimento/${reg}/consultorio`, { local: 3, evento: 'chamar' })).statusCode,
    ).toBe(403);
    // O item da fila traz o cadastro do paciente (o prontuário abre por ele).
    expect(f.itens.every((x: { idPaciente: number | null }) => typeof x.idPaciente === 'number')).toBe(true);
  });

  it('o mapa da funcionalidade vale no servidor: na ficha de PA, o desfecho exige a permissão do PA', async () => {
    const apoios = new ApoiosAtendimento(atendimento, trilha, null, null);
    const s = { pode: (p: string) => p !== 'pa.desfecho.registrar' } as unknown as SessaoCadastro;
    await expect(
      apoios.pa.executar(s, 'atendimento.encerrarAtendimento', { atendimento: 1, desfecho: 'evasao' }, 'x'),
    ).rejects.toMatchObject({ status: 403 });
    const t = { pode: (p: string) => p !== 'pa.etapa.registrar' } as unknown as SessaoCadastro;
    await expect(
      apoios.pa.executar(t, 'atendimento.conduzirNoConsultorio', { atendimento: 1 }, 'x'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('o desfecho administrativo descarta o vínculo que vem da tela (D-ATO-20)', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1003 })).json().resultado
      .reg as number;
    const original = atendimento.executar.bind(atendimento);
    const entradas: unknown[] = [];
    atendimento.executar = async (c, op, e, ctx) => {
      entradas.push(e);
      return original(c, op, e, ctx);
    };
    try {
      const r = await post(s, `/atendimento/${reg}/encerrar`, { desfecho: 'evasao', profissional: 7101 });
      expect(r.statusCode).toBe(200);
    } finally {
      atendimento.executar = original;
    }
    expect(entradas[0]).not.toHaveProperty('profissional');
  });

  it('a lista dos não identificados vai à trilha; a identificação encerra a marca com o cadastro de destino', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const marcado = await post(s, '/atendimento/pacientes/1004/nao-identificado', {
      caracteristicas: 'Mulher idosa, blusa verde (sintético)',
      prontuario: 901004,
    });
    expect(marcado.statusCode).toBe(200);
    const antes = trilha.eventos.length;
    const lista = (await get(s, '/atendimento/nao-identificados')).json();
    expect(lista.some((x: { paciente: number }) => x.paciente === 1004)).toBe(true);
    expect(
      trilha.eventos.slice(antes).some((l) => l.evento === 'atendimento.paciente.naoIdentificadosLidos'),
    ).toBe(true);
    expect((await post(s, '/atendimento/pacientes/1004/identificar', { destino: 1004 })).statusCode).toBe(
      400,
    );
    const ok = await post(s, '/atendimento/pacientes/1004/identificar', { destino: 1001 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mensagem).toMatch(/duplicidades/);
    const depois = (await get(s, '/atendimento/nao-identificados')).json();
    expect(depois.find((x: { paciente: number }) => x.paciente === 1004).identificadoEm).not.toBeNull();
    expect((await post(s, '/atendimento/pacientes/1004/identificar', { destino: 1001 })).json().codigo).toBe(
      'nao-marcado',
    );
  });

  it('a abertura pelo agendamento: a leitura preenche, a ficha liga a marcação e a exclusão a devolve (D-EXC-AGE-20)', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    expect((await get(s, '/atendimento/marcacoes/1')).statusCode).toBe(404);
    const antes = trilha.eventos.length;
    const m = (await get(s, '/atendimento/marcacoes/880001')).json();
    expect(m).toMatchObject({ hoje: true, registro: 0, convenio: 306, crm: 0, especialidade: 15 });
    expect(m.paciente.id).toBe(1007);
    expect(trilha.eventos.slice(antes).some((l) => l.tabelaAlvo === 'marcacao_horario')).toBe(true);
    const abertura = {
      ...CONSULTA,
      paciente: 1007,
      convenio: m.convenio,
      especialidade: m.especialidade,
      unidade: m.unidade,
      centroCusto: m.centroCusto,
      procedimento: m.procedimento,
      marcacao: 880001,
    };
    expect((await post(s, '/atendimento', { ...abertura, paciente: 1003 })).json().codigo).toBe(
      'marcacao-de-outro-paciente',
    );
    const r = await post(s, '/atendimento', abertura);
    expect(r.statusCode).toBe(201);
    const reg = r.json().resultado.reg as number;
    expect((await get(s, '/atendimento/marcacoes/880001')).json().registro).toBe(reg);
    expect((await post(s, '/atendimento', abertura)).json().codigo).toBe('marcacao-ja-atendida');
    const sup = await entrar('SINT.SUPERVISOR.ATD');
    const p = (await get(sup, `/atendimento/${reg}/cancelamento`)).json();
    expect(p.pode).toBe(true);
    expect(p.marcacaoVolta).toMatch(/não atendida/);
    const corpo = { motivo: 2, justificativa: 'Aberto por engano no cadastro errado', senha: SENHA };
    expect((await post(sup, `/atendimento/${reg}/cancelar`, corpo)).statusCode).toBe(200);
    expect((await get(s, '/atendimento/marcacoes/880001')).json().registro).toBe(0);
  });

  it('a busca do dia por nome, número e local', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const nome = (await get(s, '/atendimento/dia?termo=aparecida')).json();
    expect(nome.itens.length).toBeGreaterThan(0);
    expect(nome.itens.every((x: { paciente: { nome: string } }) => /APARECIDA/.test(x.paciente.nome))).toBe(
      true,
    );
    const um = nome.itens[0].reg as number;
    expect(
      (await get(s, `/atendimento/dia?termo=${um}`)).json().itens.map((x: { reg: number }) => x.reg),
    ).toEqual([um]);
    const local = (await get(s, '/atendimento/dia?local=3')).json();
    expect(local.itens.some((x: { paciente: { id: number } }) => x.paciente.id === 1004)).toBe(true);
    expect(local.itens.some((x: { paciente: { id: number } }) => x.paciente.id === 1002)).toBe(false);
    expect((await get(s, '/atendimento/dia?local=abc')).statusCode).toBe(400);
  });

  it('o quadro põe à parte o PA liberado pela outra ponta; o leito sai no desfecho e a saída vale depois', async () => {
    const s = await entrar('SINT.MEDICO.PA');
    const q = (await get(s, '/pa/quadro')).json();
    expect(q.saidasSemDesfecho).toHaveLength(1);
    const saiu = q.saidasSemDesfecho[0];
    expect(saiu).toMatchObject({ sinal: 'liberado' });
    expect(
      q.colunas
        .flatMap((c: { cartoes: { reg: number }[] }) => c.cartoes)
        .some((x: { reg: number }) => x.reg === saiu.reg),
    ).toBe(false);
    expect((await post(s, `/pa/${saiu.reg}/etapa`, { etapa: 'exames' })).statusCode).toBe(404);
    // O leito do paciente em observação fica livre no desfecho; a saída depois responde "fora de observação".
    const recepcaoPa = await entrar('SINT.ATENDIMENTO');
    const reg = (
      await post(recepcaoPa, '/atendimento', {
        ...CONSULTA,
        tipo: 'pa',
        paciente: 1001,
        carater: 'urgencia',
        procedimento: 10101039,
        unidade: 3,
        centroCusto: 300400,
      })
    ).json().resultado.reg as number;
    const o = (await get(s, '/pa/observacao')).json();
    const livre = o.leitos.find((l: { ocupacao: unknown }) => l.ocupacao === null);
    expect((await post(s, `/pa/${reg}/observacao`, { leito: livre.id })).statusCode).toBe(201);
    expect((await post(s, `/pa/${reg}/desfecho`, { desfecho: 'alta' })).statusCode).toBe(200);
    const depois = (await get(s, '/pa/observacao')).json();
    expect(depois.leitos.find((l: { id: number }) => l.id === livre.id).ocupacao).toBeNull();
    expect((await post(s, `/pa/${reg}/observacao/liberar`, {})).json().codigo).toBe('fora-de-observacao');
  });

  it('a ficha configurada só sai se a configuração a manda imprimir para o atendimento', async () => {
    const s = await entrar('SINT.ATENDIMENTO');
    const reg = (await post(s, '/atendimento', { ...CONSULTA, paciente: 1005 })).json().resultado
      .reg as number;
    const r = await post(s, `/atendimento/${reg}/impressos`, {
      impresso: 'ficha',
      formato: 'pdf',
      modelo: 77,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('ficha-nao-configurada');
  });
});

describe('avisos de mudança da fila e do quadro', () => {
  it('o primeiro ouvinte liga o canal das senhas do vigia; o último desliga; a gravação avisa todos', () => {
    const ligados: string[] = [];
    let avisoDoVigia: (() => void) | null = null;
    const vigia = {
      // O vigia escuta pelo cliente e pelo estabelecimento (id); sem o mapa da API (memória), estabelecimento nulo.
      assinar: (alvo: { cliente: string; estabelecimento: number | null }, canal: string, o: () => void) => {
        const k = `${alvo.cliente}/${alvo.estabelecimento}:${canal}`;
        ligados.push(k);
        avisoDoVigia = o;
        return () => ligados.splice(ligados.indexOf(k), 1);
      },
    };
    const a = new AvisosAtendimento(vigia as never);
    const vistos: number[] = [];
    const um = a.assinar('pc', (v) => vistos.push(v));
    const dois = a.assinar('pc', (v) => vistos.push(v * 10));
    expect(ligados).toEqual(['/null:senhas']);
    a.avisar('pc');
    (avisoDoVigia as unknown as () => void)();
    expect(vistos).toEqual([1, 10, 2, 20]);
    um();
    expect(a.ouvintesDe('pc')).toBe(1);
    dois();
    expect(ligados).toEqual([]);
    expect(a.avisar('outro')).toBe(1);
  });

  it('o canal de eventos escreve "mudanca" a cada aviso e fecha com a requisição', () => {
    const a = new AvisosAtendimento(null);
    const escrito: string[] = [];
    let fechar: (() => void) | null = null;
    const res = {
      hijack: () => undefined,
      raw: {
        writeHead: () => undefined,
        write: (t: string) => escrito.push(t) > 0,
        end: () => undefined,
      },
    };
    const req = { raw: { on: (_e: 'close', fn: () => void) => (fechar = fn) } } as never;
    a.abrirCanal(req, res, 'pc', 'pa.quadro.ler', null, 60_000);
    a.avisar('pc');
    expect(escrito.at(-1)).toMatch(/^event: mudanca\ndata: \{"versao":1\}/);
    (fechar as unknown as () => void)();
    expect(a.ouvintesDe('pc')).toBe(0);
    a.fecharTodos();
  });
});

describe('falha fechada', () => {
  it('a porta indisponível responde 503 em toda leitura e nunca grava', async () => {
    const p = portaAtendimentoIndisponivel();
    const c = contextoDeTeste('h', 'r');
    await expect(p.relogio(c)).rejects.toMatchObject({ status: 503 });
    expect((await p.podeGravar(c, 'atendimento.abrirAtendimento')).pode).toBe(false);
  });
});
