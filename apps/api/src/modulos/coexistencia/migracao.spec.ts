// M37 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o comitê vê
// os setores (DP-4: o segundo estabelecimento aguarda o primeiro), passa o setor pelas situações, publica a trilha,
// registra a conclusão da turma (ninguém a si mesmo), aplica o lote do setor (quem não concluiu fica de fora) e o
// recolhe; a lista por pessoa só com a permissão (e a leitura vai à trilha); a condução opcional ida e volta pela
// operação do protocolo (gestor de acessos, com a autorização); abrir chamado (todos) e triar (S1 exige comandante).
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { TURMA_SINTETICA } from './porta-memoria.js';
import { MedidorTarefas, percentil } from './aplicacao/medidor-tarefas.js';
import { eventosAlertaChamado } from './porta-legado.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_TREINAMENTO: resolve(import.meta.dirname, '../../../../../docs/prontidao/treinamento'),
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
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
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
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
  'idempotency-key': `teste-m37-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
const M = '/api/administracao/coexistencia/migracao';
const J = 'Justificativa sintética do comitê';

describe('migração gradual: setores, treinamento e lote', { timeout: 30_000 }, () => {
  it('o painel mostra o catálogo dos setores; o segundo estabelecimento aguarda o primeiro (DP-4)', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, `${M}/setores`);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.setores.length).toBeGreaterThan(10);
    expect(p.setores.find((x: { codigo: string }) => x.codigo === 'agendamento')).toMatchObject({
      situacao: 'legado',
      gravado: false,
    });
    expect(p.aguardandoPrimeiro).toBe(false);
    // O segundo estabelecimento (bb) aguarda o primeiro de ESTABELECIMENTOS (aa).
    const bb = (await get(await entrar('SINT.ADMIN', 'bb'), `${M}/setores`)).json();
    expect(bb.aguardandoPrimeiro).toBe(true);
    expect(bb.motivoAguardando).toContain('Aguardando');
    expect(p.publico.total).toBeGreaterThan(0);
  });

  it('o setor avança um passo por vez; a justificativa é obrigatória', async () => {
    const s = await entrar('SINT.ADMIN');
    expect(
      (await post(s, `${M}/setores/agendamento`, { situacao: 'liberado', justificativa: J })).statusCode,
    ).toBe(409);
    expect((await post(s, `${M}/setores/agendamento`, { situacao: 'homologacao' })).statusCode).toBe(400);
    expect(
      (await post(s, `${M}/setores/nao-existe`, { situacao: 'homologacao', justificativa: J })).statusCode,
    ).toBe(404);
    for (const situacao of ['homologacao', 'treinamento'])
      expect((await post(s, `${M}/setores/agendamento`, { situacao, justificativa: J })).statusCode).toBe(
        200,
      );
    const st = (await get(s, `${M}/setores`))
      .json()
      .setores.find((x: { codigo: string }) => x.codigo === 'agendamento');
    expect(st).toMatchObject({ situacao: 'treinamento', gravado: true });
    expect(st.datas.treinamento).not.toBeNull();
    expect(trilha.eventos.some((e) => e.evento === 'coexistencia.setor.alterado')).toBe(true);
  });

  it('trilha publicada (versão nova desatualiza a anterior); conclusão da turma, ninguém a si mesmo', async () => {
    const s = await entrar('SINT.ADMIN');
    const semTrilha = await post(s, `${M}/treinamento/conclusoes`, {
      logins: ['SINT.TURMA01'],
      papel: 'recepcao',
      onda: 1,
      turma: 'T1',
      concluidoEm: '2026-11-04',
      resultado: 'aprovado',
    });
    expect(semTrilha.statusCode).toBe(409);
    const ex = { exercicio: 'Marcar e remarcar a consulta do paciente sintético da turma.' };
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/1`, ex)).json()).toEqual({ versao: 1 });
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/1`, ex)).json()).toEqual({ versao: 2 });
    expect((await post(s, `${M}/treinamento/trilhas/ninguem/1`, ex)).statusCode).toBe(404);
    expect((await post(s, `${M}/treinamento/trilhas/recepcao/5`, ex)).statusCode).toBe(409);
    // M43, regra 6: turno fora da lista é recusado; a turma da noite conta no agregado por turno.
    const turnoInvalido = await post(s, `${M}/treinamento/conclusoes`, {
      logins: [...TURMA_SINTETICA.slice(0, 10)],
      papel: 'recepcao',
      onda: 1,
      turma: 'T1',
      turno: 'madrugada',
      concluidoEm: '2026-11-04',
      resultado: 'aprovado',
    });
    expect(turnoInvalido.statusCode).toBe(400);
    const ok = await post(s, `${M}/treinamento/conclusoes`, {
      logins: [...TURMA_SINTETICA.slice(0, 10), 'NINGUEM.AQUI'],
      papel: 'recepcao',
      onda: 1,
      turma: 'T1',
      turno: 'noite',
      concluidoEm: '2026-11-04',
      resultado: 'aprovado',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ registradas: 10, naoEncontrados: ['NINGUEM.AQUI'] });
    const asi = await post(s, `${M}/treinamento/conclusoes`, {
      logins: ['SINT.ADMIN'],
      papel: 'recepcao',
      onda: 1,
      turma: 'T1',
      concluidoEm: '2026-11-04',
      resultado: 'aprovado',
    });
    expect(asi.statusCode).toBe(409);
    const t = (await get(s, `${M}/treinamento`)).json();
    const rec = t.trilhas.find(
      (x: { papel: string; onda: number }) => x.papel === 'recepcao' && x.onda === 1,
    );
    expect(rec).toMatchObject({ versao: 2, publicada: true, situacao: 'vigente', concluidas: 10 });
    expect(t.porTurno).toEqual([
      { turno: 'manha', pessoas: 0 },
      { turno: 'tarde', pessoas: 0 },
      { turno: 'noite', pessoas: 10 },
      { turno: 'fim-de-semana', pessoas: 0 },
      { turno: 'nao-informado', pessoas: 0 },
    ]);
    expect(t.conclusoes[0]).toMatchObject({ turno: 'noite' });
    expect(t.ambienteTreino.metodoRegistrado).toBe(false);
  });

  it('lote do setor: recusado antes de liberado; liberado, entra quem concluiu e fica de fora quem não; recolhe inteiro', async () => {
    const s = await entrar('SINT.ADMIN');
    const pedido = {
      setor: 'agendamento',
      alvo: { tipo: 'setor', valores: [] },
      justificativa: J,
      senha: SENHA,
    };
    expect((await post(s, `${M}/lotes`, { ...pedido, senha: undefined })).statusCode).toBe(401);
    const antes = await post(s, `${M}/lotes`, pedido);
    expect(antes.statusCode).toBe(409);
    const lib = await post(s, `${M}/setores/agendamento`, { situacao: 'liberado', justificativa: J });
    expect(lib.statusCode, lib.body).toBe(200);
    const r = await post(s, `${M}/lotes`, pedido);
    expect(r.statusCode, r.body).toBe(200);
    const lote = r.json();
    expect(lote.incluidos).toEqual(TURMA_SINTETICA.slice(0, 10));
    expect(lote.fora.map((f: { login: string }) => f.login)).toEqual(
      expect.arrayContaining(TURMA_SINTETICA.slice(10)),
    );
    expect(lote.chaves).toEqual([expect.objectContaining({ chave: 'agenda.consulta', alteradas: 10 })]);
    const painel = (await get(s, `${M}/setores`)).json();
    expect(painel.setores.find((x: { codigo: string }) => x.codigo === 'agendamento').comAcesso).toBe(10);
    expect(painel.lotes[0]).toMatchObject({ id: lote.lote, situacao: 'aplicado', incluidos: 10 });
    const rec = await post(s, `${M}/lotes/${lote.lote}/recolher`, { justificativa: J, senha: SENHA });
    expect(rec.statusCode).toBe(200);
    expect(rec.json()).toEqual({ recolhido: true, alteradas: 10, devolvidas: 0 });
    // A trilha do lote (operação crítica) leva a estação e a correlação da requisição, não valores inventados.
    for (const ev of ['coexistencia.lote.aplicado', 'coexistencia.lote.recolhido']) {
      const e = trilha.eventos.filter((x) => x.evento === ev).at(-1);
      expect(e?.estacao).toMatch(/^SGH-WEB:/);
      expect(e?.correlacao).toMatch(/^coex-(lote|recolher)$/);
    }
    expect(
      (await post(s, `${M}/lotes/${lote.lote}/recolher`, { justificativa: J, senha: SENHA })).statusCode,
    ).toBe(409);
    expect(
      (await get(s, `${M}/setores`))
        .json()
        .setores.find((x: { codigo: string }) => x.codigo === 'agendamento').comAcesso,
    ).toBe(0);
  });

  it('por pessoa só com a permissão; a leitura vai à trilha; dias sem o outro sistema', async () => {
    const r = await get(await entrar('SINT.RECEPCAO'), `${M}/pessoas`);
    expect(r.statusCode).toBe(403);
    const s = await entrar('SINT.ADMIN');
    const l = await get(s, `${M}/pessoas?setor=agendamento&termo=TURMA`);
    expect(l.statusCode).toBe(200);
    expect(l.json().total).toBe(12);
    const p = l.json().itens.find((x: { login: string }) => x.login === 'SINT.TURMA03');
    expect(p).toMatchObject({
      papel: 'recepcao',
      trilhaConcluida: true,
      diasSemOutro: 2,
      ultimoUsoNovo: null,
    });
    const consulta = trilha.eventos.filter((e) => e.evento === 'coexistencia.pessoas.consultadas').at(-1);
    expect(consulta?.estacao).toMatch(/^SGH-WEB:/);
    // O último uso no novo vem da trilha: quem já trabalha no novo mostra o dia.
    const adm = (await get(s, `${M}/pessoas?termo=SINT.ADMIN`)).json();
    const eu = adm.itens.find((x: { login: string }) => x.login === 'SINT.ADMIN');
    expect(eu?.ultimoUsoNovo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('indicadores: parcela impressa, tarefas-chave, carga e chamados por severidade', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = (await get(s, `${M}/indicadores?dias=7`)).json();
    expect(r.dias).toHaveLength(7);
    expect(
      r.parcela.find((x: { operacao: string }) => x.operacao === 'agenda.agendarConsulta').parcela,
    ).toEqual({
      novo: 61,
      legado: 39,
      total: 100,
      percentual: 61,
    });
    expect(r.tempo.map((t: { tarefa: string }) => t.tarefa)).toEqual(
      expect.arrayContaining(['abrir-prontuario', 'prescrever', 'chamar-senha', 'dispensar']),
    );
    expect(r.chamados.map((c: { severidade: string }) => c.severidade)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(r.carga.conexoesPorSistema.length).toBeGreaterThan(0);
  });
});

describe('condução opcional e chamados', { timeout: 30_000 }, () => {
  it('condução: só com a condução ligada e a autorização; o gestor retira e devolve pela operação do protocolo', async () => {
    const admin = await entrar('SINT.ADMIN');
    expect(
      (
        await post(admin, `${M}/setores/agendamento`, {
          situacao: 'liberado',
          justificativa: J,
          conducao: true,
          composicao: [{ tipo: 'grupo', valor: 'AGENDA' }],
        })
      ).statusCode,
    ).toBe(200);
    const g = await entrar('SINT.GESTOR');
    const p = (await get(g, `${M}/conducao/agendamento`)).json();
    expect(p.conducaoLigada).toBe(true);
    const par = p.pares.find(
      (x: { grupo: string; situacao: string }) => x.grupo === 'AGENDA' && x.situacao === 'proposta',
    );
    expect(par).toBeDefined();
    expect(par.exigeDecisao).toBe(false);
    const sem = await post(g, `${M}/conducao/agendamento/retirar`, {
      pares: [{ grupo: 'AGENDA', opcao: par.opcao }],
      senha: SENHA,
    });
    expect(sem.statusCode).toBe(400);
    const fora = await post(g, `${M}/conducao/agendamento/retirar`, {
      pares: [{ grupo: 'AGENDA', opcao: 1 }],
      autorizacao: 'ESTADO.md › Autorizações (sintética)',
      senha: SENHA,
    });
    expect(fora.statusCode).toBe(409);
    const ok = await post(g, `${M}/conducao/agendamento/retirar`, {
      pares: [{ grupo: 'AGENDA', opcao: par.opcao }],
      autorizacao: 'ESTADO.md › Autorizações (sintética)',
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ feitas: 1, grupos: ['AGENDA'] });
    const depois = (await get(g, `${M}/conducao/agendamento`)).json();
    expect(depois.retiradas).toBe(1);
    expect(
      depois.pares.find((x: { opcao: number; situacao: string }) => x.opcao === par.opcao).situacao,
    ).toBe('retirada');
    const dev = await post(g, `${M}/conducao/agendamento/devolver`, { senha: SENHA });
    expect(dev.statusCode).toBe(200);
    expect(dev.json().feitas).toBe(1);
    const final = (await get(g, `${M}/conducao/agendamento`)).json();
    expect(final.retiradas).toBe(0);
    expect(final.pares.find((x: { opcao: number }) => x.opcao === par.opcao).situacao).toBe('proposta');
    expect((await post(g, `${M}/conducao/agendamento/devolver`, { senha: SENHA })).statusCode).toBe(409);
    // A recepção não tem a permissão de retirar opções.
    expect(
      (await post(await entrar('SINT.RECEPCAO'), `${M}/conducao/agendamento/retirar`, {})).statusCode,
    ).toBe(403);
  });

  it('lote de setor com a condução ligada: retira as opções com o id do lote e o recolhimento as devolve (unidade)', async () => {
    const admin = await entrar('SINT.ADMIN');
    const pedido = {
      setor: 'agendamento',
      alvo: { tipo: 'setor', valores: [] },
      justificativa: J,
      senha: SENHA,
    };
    // O setor passa a ter também o grupo da turma (que concluiu a trilha): o lote tem gente para liberar.
    const comp = await post(admin, `${M}/setores/agendamento`, {
      situacao: 'liberado',
      justificativa: J,
      conducao: true,
      composicao: [
        { tipo: 'grupo', valor: 'AGENDA' },
        { tipo: 'grupo', valor: 'ATENDIMENTO' },
      ],
    });
    expect(comp.statusCode, comp.body).toBe(200);
    // Com a condução ligada, o lote retira opções dos grupos: quem não é gestor de acessos é recusado (403) e o
    // gestor sem a autorização do dono para o setor também (400); nada é gravado antes.
    const lotesAntes = (await get(admin, `${M}/setores`)).json().lotes.length;
    const comAut = { ...pedido, referenciaAutorizacao: 'ESTADO.md › Autorizações (sintética)' };
    expect((await post(admin, `${M}/lotes`, comAut)).statusCode).toBe(403);
    const g = await entrar('SINT.GESTOR');
    const semAut = await post(g, `${M}/lotes`, pedido);
    expect(semAut.statusCode, semAut.body).toBe(400);
    expect((await get(admin, `${M}/setores`)).json().lotes.length).toBe(lotesAntes);
    const r = await post(g, `${M}/lotes`, comAut);
    expect(r.statusCode, r.body).toBe(200);
    const lote = r.json();
    expect(lote.conducao.feitas).toBeGreaterThan(0);
    expect(lote.conducao.grupos).toContain('AGENDA');
    const durante = (await get(g, `${M}/conducao/agendamento`)).json();
    expect(durante.retiradas).toBe(lote.conducao.feitas);
    const painel = (await get(admin, `${M}/setores`)).json();
    expect(painel.lotes[0]).toMatchObject({ id: lote.lote, conducao: true, situacao: 'aplicado' });
    // Recolher o lote com condução devolve as opções: também só o gestor de acessos.
    expect(
      (await post(admin, `${M}/lotes/${lote.lote}/recolher`, { justificativa: J, senha: SENHA })).statusCode,
    ).toBe(403);
    const rec = await post(g, `${M}/lotes/${lote.lote}/recolher`, { justificativa: J, senha: SENHA });
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json()).toMatchObject({ recolhido: true, devolvidas: lote.conducao.feitas });
    const depois = (await get(g, `${M}/conducao/agendamento`)).json();
    expect(depois.retiradas).toBe(0);
    expect(trilha.eventos.some((e) => e.chaveNaturalAlvo?.startsWith(`lote:${lote.lote}:retirar:`))).toBe(
      true,
    );
  });

  it('chamado: todos abrem; a primeira pergunta é o sistema; S1 exige comandante; prazos "a aprovar"', async () => {
    const r = await entrar('SINT.RECEPCAO');
    expect(
      (await post(r, '/api/chamados', { severidade: 'S2', descricao: 'Tela lenta ao marcar' })).statusCode,
    ).toBe(400);
    const a = await post(r, '/api/chamados', {
      sistema: 'novo',
      severidade: 'S1',
      tela: '/agenda',
      descricao: 'A marcação parou na tela da agenda',
      dadoPessoal: true,
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().aviso).toContain('CPF');
    expect((await get(r, `${M}/chamados`)).statusCode).toBe(403);
    const s = await entrar('SINT.ADMIN');
    const l = (await get(s, `${M}/chamados`)).json();
    const c = l.itens.find((x: { id: string }) => x.id === a.json().id);
    expect(c).toMatchObject({
      severidade: 'S1',
      situacao: 'aberto',
      encarregadoAvisado: true,
      dadoPessoal: true,
    });
    expect(c.proximaAtualizacao).not.toBeNull();
    expect(l.prazos[0]).toMatchObject({ severidade: 'S1', respostaMin: 15, aprovado: false });
    const semCmd = await post(s, `${M}/chamados/${c.id}/triar`, {
      severidade: 'S1',
      situacao: 'em-atendimento',
      nivel: 'N2',
    });
    expect(semCmd.statusCode).toBe(409);
    const t = await post(s, `${M}/chamados/${c.id}/triar`, {
      severidade: 'S1',
      situacao: 'contornado',
      nivel: 'N2',
      comandante: 'SINT.GESTOR',
      contorno: 'Seguir a marcação no outro sistema até a correção',
    });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ situacao: 'contornado', comandante: 'SINT.GESTOR', vencido: false });
    const fim = await post(s, `${M}/chamados/${c.id}/triar`, {
      severidade: 'S3',
      situacao: 'resolvido',
      nivel: 'N3',
      comandante: 'SINT.GESTOR',
    });
    expect(fim.statusCode).toBe(200);
    expect(
      (await post(s, `${M}/chamados/${c.id}/triar`, { severidade: 'S3', situacao: 'aberto', nivel: 'N1' }))
        .statusCode,
    ).toBe(409);
    expect((await post(s, `${M}/chamados/xyz/triar`, {})).statusCode).toBe(404);
    expect(trilha.eventos.some((e) => e.evento === 'config.chamado.aberto')).toBe(true);
  });
});

describe('medidor das tarefas-chave', () => {
  const PC = { rede: 'r', hospital: 'pc' };
  const HS = { rede: 'r', hospital: 'hs' };
  it('só as rotas das tarefas, só sucesso; p50 e p95 do dia; o dia vira e recomeça', () => {
    let dia = '2026-11-04';
    const m = new MedidorTarefas(() => dia);
    for (let i = 1; i <= 100; i++) m.registrar(PC, '/api/pep/prontuario/:paciente', 'GET', 200, i);
    m.registrar(PC, '/api/pep/prontuario/:paciente', 'GET', 500, 9999);
    m.registrar(PC, '/api/outra', 'GET', 200, 1);
    const x = m.doDia(PC).find((t) => t.tarefa === 'abrir-prontuario')!;
    expect(x).toMatchObject({ amostras: 100, p50Ms: 50, p95Ms: 95 });
    expect(m.doDia(PC).find((t) => t.tarefa === 'dispensar')).toMatchObject({ amostras: 0, p50Ms: null });
    dia = '2026-11-05';
    // O dia virou sem requisição nova: as amostras de ontem não aparecem como de hoje.
    expect(m.doDia(PC).find((t) => t.tarefa === 'abrir-prontuario')).toMatchObject({
      dia: '2026-11-05',
      amostras: 0,
    });
    m.registrar(PC, '/api/farmacia/dispensar', 'POST', 201, 30);
    expect(m.doDia(PC).find((t) => t.tarefa === 'abrir-prontuario')?.amostras).toBe(0);
    expect(percentil([], 50)).toBeNull();
  });

  it('cada estabelecimento vê só as próprias amostras; sem estabelecimento ativo, a amostra não entra', () => {
    const m = new MedidorTarefas(() => '2026-11-04');
    for (let i = 1; i <= 10; i++) m.registrar(PC, '/api/farmacia/dispensar', 'POST', 201, i);
    for (let i = 1; i <= 4; i++) m.registrar(HS, '/api/farmacia/dispensar', 'POST', 201, 1000 + i);
    m.registrar(null, '/api/farmacia/dispensar', 'POST', 201, 99_999);
    expect(m.doDia(PC).find((t) => t.tarefa === 'dispensar')).toMatchObject({ amostras: 10, p95Ms: 10 });
    expect(m.doDia(HS).find((t) => t.tarefa === 'dispensar')).toMatchObject({ amostras: 4, p50Ms: 1002 });
    expect(m.doDia({ rede: 'r', hospital: 'xx' }).every((t) => t.amostras === 0)).toBe(true);
  });
});

describe('aviso do chamado pela outbox (D-AVISO-37)', () => {
  const c = { rede: 'r', hospital: 'pc' } as Parameters<typeof eventosAlertaChamado>[0];
  it('S1 com dado pessoal: dois eventos com chaves distintas (encarregado e plantão)', () => {
    const ev = eventosAlertaChamado(c, '7', 'S1', { encarregado: true, s1: true });
    expect(ev.map((x) => x.carga.motivo)).toEqual(['dado-pessoal', 's1']);
    expect(new Set(ev.map((x) => x.chave)).size).toBe(2);
    expect(ev.map((x) => x.chave)).toEqual(['chamado:pc:7:dado-pessoal', 'chamado:pc:7:s1']);
  });
  it('só um motivo: um evento; nenhum: nenhum', () => {
    expect(eventosAlertaChamado(c, '8', 'S1', { encarregado: false, s1: true })).toHaveLength(1);
    expect(eventosAlertaChamado(c, '9', 'S3', { encarregado: true, s1: false })[0]?.carga.motivo).toBe(
      'dado-pessoal',
    );
    expect(eventosAlertaChamado(c, '9', 'S3', { encarregado: false, s1: false })).toEqual([]);
  });
});

describe('chamados com filtros e a fila de S2 do setor; guias da trilha', { timeout: 30_000 }, () => {
  it('texto fora do CP1252 na tela é recusado na entrada (400), não no banco', async () => {
    const r = await entrar('SINT.RECEPCAO');
    const x = await post(r, '/api/chamados', {
      sistema: 'novo',
      severidade: 'S3',
      tela: '/agenda \u{1F600}',
      descricao: 'A tela da agenda demorou para abrir',
    });
    expect(x.statusCode).toBe(400);
  });

  it('filtros por severidade e setor, total e página; S2 aberto no setor reprova o critério da fila caindo', async () => {
    const r = await entrar('SINT.RECEPCAO');
    for (let i = 0; i < 3; i++)
      expect(
        (
          await post(r, '/api/chamados', {
            sistema: 'novo',
            severidade: 'S2',
            setor: 'sadt',
            descricao: `Exame sintético sem retorno ${i}`,
          })
        ).statusCode,
      ).toBe(201);
    const s = await entrar('SINT.ADMIN');
    const l = (await get(s, `${M}/chamados?severidade=S2&setor=sadt`)).json();
    expect(l.total).toBe(3);
    expect(l).toMatchObject({ pagina: 1, tamanho: 50 });
    expect(l.itens.every((x: { severidade: string }) => x.severidade === 'S2')).toBe(true);
    expect((await get(s, `${M}/chamados?severidade=S9`)).statusCode).toBe(400);
    expect((await get(s, `${M}/chamados?severidade=S2&setor=sadt&pagina=2`)).json().itens).toEqual([]);
    const sadt = (await get(s, `${M}/setores`))
      .json()
      .setores.find((x: { codigo: string }) => x.codigo === 'sadt');
    const crit = sadt.migrado.criterios.find((c: { criterio: string }) => c.criterio === 's2-caindo');
    expect(crit.atendido).toBe(false);
    expect(crit.detalhe).toContain('S2 abertos por dia');
    expect(sadt.migrado.criterios.find((c: { criterio: string }) => c.criterio === 'metas').detalhe).toBe(
      'metas de serviço sem medida',
    );
  });

  it('a tela de treinamento abre o guia e o roteiro de vídeo pela API; caminho fora do catálogo é 404', async () => {
    const s = await entrar('SINT.ADMIN');
    const t = (await get(s, `${M}/treinamento`)).json();
    const tarefa = t.trilhas
      .flatMap((x: { tarefas: { id: string; guia: string; video: string }[] }) => x.tarefas)
      .find((x: { id: string }) => x.id === 'abrir-atendimento');
    expect(tarefa.guia).toBe(`${M}/treinamento/guias/recepcao/abrir-atendimento/guia`);
    const g = await get(s, tarefa.guia);
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ papel: 'recepcao', tarefa: 'abrir-atendimento', tipo: 'guia' });
    expect(g.json().texto.length).toBeGreaterThan(20);
    expect((await get(s, tarefa.video)).statusCode).toBe(200);
    expect((await get(s, `${M}/treinamento/guias/recepcao/..%2F..%2Fetc/guia`)).statusCode).toBe(404);
    expect((await get(s, `${M}/treinamento/guias/recepcao/abrir-atendimento/pdf`)).statusCode).toBe(404);
  });
});
