// M23 pela HTTP, com a sessão real sobre a fonte sintética e as portas do cadastro, do registro e do prontuário de
// uso diário EM MEMÓRIA (nada conecta a banco; pacientes, exames e resultados SINTÉTICOS): painel; cabeçalho com
// alertas; alergia ligada ao registro clínico (e a recusa sem registro), colisão da lista; pedido de exames com
// avisos confirmáveis e o inativo que bloqueia; ciência de crítico; receita de controle especial; atestado com
// CID (recusa sem autorização) e correção; suspensão; sumário de alta (pendências, rascunho, finalização);
// sigilo da psicologia na linha do tempo; parecer pedido, aceito e respondido; assinatura em lote com hash
// conferido; matriz ação × categoria (enfermagem não emite atestado médico); permissões (recepção 403).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RespostaRegistro } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
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
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste.m23.${Date.now()}.${chave++}` },
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
const agora = () => new Date(Date.now() - 3 * 3_600_000 - 2 * 60_000).toISOString().slice(0, 16);

/** Um registro clínico do M22 (EVAM) no atendimento aberto do paciente, pelo profissional da sessão. */
async function registrar(s: Sessao, paciente: number, extra: Record<string, unknown> = {}): Promise<number> {
  const f = (await get(s, `/api/pep/registro/${paciente}/formulario/61`)).json();
  const r = await post(s, `/api/pep/registro/${paciente}/finalizar`, {
    modelo: 61,
    atendimento: paciente * 10 + 1,
    impressao: f.impressao,
    dataHoraClinica: agora(),
    respostas: [texto(6101, 'Quadro estável SINTETICO')],
    ...extra,
  });
  expect(r.statusCode).toBe(201);
  return r.json().registro as number;
}

describe('prontuário de uso diário (M23)', () => {
  let medico: Sessao;
  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
  });

  it('painel "Meus pacientes" e cabeçalho fixo com a situação das alergias e os alertas', async () => {
    const p = await get(medico, '/api/pep/painel');
    expect(p.statusCode).toBe(200);
    expect(
      p
        .json()
        .pacientes.map((l: { paciente: number }) => l.paciente)
        .sort(),
    ).toEqual([1001, 1003]);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'pep.painel.lido' });
    const c = await get(medico, '/api/pep/paciente/1001/cabecalho');
    expect(c.statusCode).toBe(200);
    const cab = c.json();
    expect(cab.contexto.alergias).toEqual({ situacao: 'lista', itens: ['PENICILINA SINTETICO'] });
    expect(cab.atendimentoAtual).toBe(10011);
    expect(cab.categoria).toBe('medico');
    expect(cab.alertas.map((a: { tipo: string }) => a.tipo)).toContain('critico-sem-ciencia');
    // Regra 14: o painel mostra os mesmos alertas e a mesma situação das alergias do cabeçalho.
    const tipos = (x: { alertas: { tipo: string }[] }) => x.alertas.map((a) => a.tipo).sort();
    for (const pac of [1001, 1003]) {
      const linha = p.json().pacientes.find((l: { paciente: number }) => l.paciente === pac);
      const cabecalho = (await get(medico, `/api/pep/paciente/${pac}/cabecalho`)).json();
      expect(tipos(linha)).toEqual(tipos(cabecalho));
      expect(linha.alergias).toBe(cabecalho.contexto.alergias.situacao);
    }
  });

  it('alergia: exige o registro clínico do atendimento; registra; a lista mudada recusa (409)', async () => {
    const sem = (await get(medico, '/api/pep/paciente/1003/alergias')).json();
    expect(sem.criar.pode).toBe(false);
    const registro = await registrar(medico, 1003);
    const a = (await get(medico, '/api/pep/paciente/1003/alergias')).json();
    expect(a.criar.pode).toBe(true);
    expect(a.registros.map((r: { registro: number }) => r.registro)).toContain(registro);
    const r = await post(medico, '/api/pep/paciente/1003/alergias', {
      registro,
      agente: 1,
      principios: [1],
      reacao: 'Urticária',
      gravidade: 'leve',
      origem: 'relato-paciente',
      versao: '',
    });
    expect(r.statusCode).toBe(201);
    expect(trilha.eventos.some((e) => e.evento === 'pep.alergia.registrada')).toBe(true);
    const velha = await post(medico, '/api/pep/paciente/1003/alergias', { registro, agente: 3, versao: '' });
    expect(velha.statusCode).toBe(409);
    const depois = (await get(medico, '/api/pep/paciente/1003/alergias')).json();
    expect(depois.situacao).toBe('lista');
    const inativar = await post(medico, `/api/pep/paciente/1003/alergias/${depois.ativas[0].id}/inativar`, {
      motivo: 'Alergia descartada em teste',
      versao: String(depois.ativas[0].id),
    });
    expect(inativar.statusCode).toBe(200);
  });

  it('painel: internado há 30 h sem evolução médica tem o alerta; a evolução médica do atendimento o tira', async () => {
    const antes = (await get(medico, '/api/pep/painel')).json();
    const de = (x: typeof antes, pac: number) =>
      x.pacientes
        .find((l: { paciente: number }) => l.paciente === pac)
        .alertas.map((a: { tipo: string }) => a.tipo);
    expect(de(antes, 1001)).toContain('sem-evolucao-medica-24h');
    await registrar(medico, 1001);
    const depois = (await get(medico, '/api/pep/painel')).json();
    expect(de(depois, 1001)).not.toContain('sem-evolucao-medica-24h');
    // 1003 recebeu a evolução médica no teste da alergia.
    expect(de(depois, 1003)).not.toContain('sem-evolucao-medica-24h');
  });

  it('pedido de exames: avisos confirmáveis (sexo) e o inativo que bloqueia; o kit soma os exames', async () => {
    const pac = await post(medico, '/api/pep/paciente/1001/exames', {
      atendimento: 10011,
      itens: [{ exame: 504 }],
    });
    expect(pac.statusCode).toBe(201);
    expect(pac.json()).toMatchObject({ gravado: false });
    expect(pac.json().avisos.map((a: { tipo: string }) => a.tipo)).toContain('sexo');
    const ok = await post(medico, '/api/pep/paciente/1001/exames', {
      atendimento: 10011,
      itens: [{ exame: 504 }],
      confirmarAvisos: true,
    });
    expect(ok.json().gravado).toBe(true);
    const inativo = await post(medico, '/api/pep/paciente/1001/exames', {
      atendimento: 10011,
      itens: [{ exame: 506 }],
      confirmarAvisos: true,
    });
    expect(inativo.json()).toMatchObject({ gravado: false });
    const kit = await post(medico, '/api/pep/paciente/1003/exames', {
      atendimento: 10031,
      itens: [{ exame: 505, urgente: true }],
      kit: 71,
    });
    expect(kit.json().gravado).toBe(true);
    const pedidos = (await get(medico, '/api/pep/paciente/1003/exames')).json().pedidos;
    expect(pedidos).toHaveLength(4);
  });

  it('resultado crítico: ciência com a conduta; a repetida recusa', async () => {
    const r = (await get(medico, '/api/pep/paciente/1001/resultados')).json();
    expect(r.pendentesCiencia).toBe(1);
    const critico = r.resultados.find((x: { critico: boolean }) => x.critico);
    expect(critico.valores[0]).toMatchObject({ foraDaFaixa: 'acima', critico: true });
    expect(r.tendencias[0].pontos).toHaveLength(2);
    const c = await post(medico, `/api/pep/paciente/1001/resultados/${critico.exame}/ciencia`, {
      conduta: 'Repetido o exame e ajustada a reposição',
    });
    expect(c.statusCode).toBe(201);
    expect((await get(medico, '/api/pep/paciente/1001/resultados')).json().pendentesCiencia).toBe(0);
    const de_novo = await post(medico, `/api/pep/paciente/1001/resultados/${critico.exame}/ciencia`, {
      conduta: 'Outra conduta',
    });
    expect(de_novo.statusCode).toBe(409);
  });

  it('receita de controle especial e atestado com CID autorizado; CID sem autorização recusa; suspensão e correção', async () => {
    const rec = await post(medico, '/api/pep/paciente/1001/receitas', {
      atendimento: 10011,
      tipo: 'controle-especial',
      itens: [{ medicamento: 'CLONAZEPAM SINTETICO', posologia: '1 comprimido à noite', quantidade: '30' }],
    });
    expect(rec.statusCode).toBe(201);
    const lista = (await get(medico, '/api/pep/paciente/1001/receitas')).json();
    expect(lista.documentos[0]).toMatchObject({
      tipo: 'receita-controlada',
      doNovo: true,
      situacao: 'emitido',
    });
    const doc = (
      await get(medico, `/api/pep/paciente/1001/documentos/receita/${lista.documentos[0].id}`)
    ).json();
    expect(doc.paragrafos.join(' ')).toContain('CLONAZEPAM');
    expect(doc.prova.hash).toMatch(/^[0-9a-f]{64}$/);

    const modelos = (await get(medico, '/api/pep/paciente/1001/atestados')).json().modelos;
    const modelo = modelos.find((m: { tipo: string }) => m.tipo === 'atestado').codigo;
    const semAut = await post(medico, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 2,
      cid: 'J11',
    });
    expect(semAut.statusCode).toBe(400);
    const at = await post(medico, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 2,
      cid: 'J11',
      autorizacaoCid: 'paciente',
    });
    expect(at.statusCode).toBe(201);
    const origem = at.json().origem as number;
    const corrigirAntes = await post(medico, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 3,
      corrige: origem,
    });
    expect(corrigirAntes.statusCode).toBe(409);
    const susp = await post(medico, `/api/pep/paciente/1001/atestados/${origem}/suspender`, {
      justificativa: 'Dias de afastamento errados',
      senha: SENHA,
    });
    expect(susp.statusCode).toBe(200);
    const correcao = await post(medico, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 3,
      corrige: origem,
    });
    expect(correcao.statusCode).toBe(201);
    const docs = (await get(medico, '/api/pep/paciente/1001/atestados')).json().documentos;
    expect(docs.find((d: { id: number }) => d.id === origem).situacao).toBe('suspenso');
    expect(docs.find((d: { corrigeDe: number | null }) => d.corrigeDe === origem)).toBeTruthy();
  });

  it('sumário de alta: pendências recusam; rascunho em versão; finaliza uma vez', async () => {
    const alta = (await get(medico, '/api/pep/paciente/1003/alta')).json();
    expect(alta.atendimento.id).toBe(10031);
    const incompleto = await post(medico, '/api/pep/paciente/1003/alta/finalizar', {
      atendimento: 10031,
      sumario: { diagnosticos: [] },
      versao: 0,
    });
    expect(incompleto.statusCode).toBe(400);
    const sumario = {
      diagnosticos: [{ cid: 'I20', descricao: 'Angina' }],
      medicamentosAlta: ['AAS 100 mg'],
      plano: 'Retorno em 7 dias',
      condicaoAlta: 'Estável',
    };
    // Regra 13: o rascunho inicial vem montado do episódio (motivo, cirurgia e exames do atendimento).
    const montado = (await get(medico, '/api/pep/paciente/1003/alta')).json();
    expect(montado.sumario.motivoInternacao).toBe('I20 - Angina pectoris');
    expect(montado.sumario.procedimentos).toEqual(['Cirurgia (K40)']);
    expect(montado.sumario.evolucao).toBe('Exames do episódio: HEMOGRAMA SINTETICO.');
    const rasc = await post(medico, '/api/pep/paciente/1003/alta/rascunho', {
      atendimento: 10031,
      sumario,
      versao: 0,
    });
    expect(rasc.json()).toEqual({ versao: 1 });
    const velho = await post(medico, '/api/pep/paciente/1003/alta/finalizar', {
      atendimento: 10031,
      sumario,
      versao: 0,
    });
    expect(velho.statusCode).toBe(409);
    const fim = await post(medico, '/api/pep/paciente/1003/alta/finalizar', {
      atendimento: 10031,
      sumario,
      versao: 1,
    });
    expect(fim.statusCode).toBe(201);
    const deNovo = await post(medico, '/api/pep/paciente/1003/alta/finalizar', {
      atendimento: 10031,
      sumario,
      versao: 2,
    });
    expect(deNovo.statusCode).toBe(409);
    const depois = (await get(medico, '/api/pep/paciente/1003/alta')).json();
    expect(depois.finalizado).toBe(true);
    expect(depois.finalizar.pode).toBe(false);
  });

  it('matriz ação × categoria: a enfermagem não emite atestado médico nem receita; o sigilo da psicologia', async () => {
    const enf = await entrar('SINT.ENFERMEIRO');
    const a = (await get(enf, '/api/pep/paciente/1001/atestados')).json();
    expect(a.emitir.pode).toBe(true);
    const modelo = a.modelos.find((m: { tipo: string }) => m.tipo === 'atestado').codigo;
    const r = await post(enf, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 1,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('categoria-nao-permitida');
    expect((await get(enf, '/api/pep/paciente/1001/receitas')).json().emitir.pode).toBe(false);

    const psi = await entrar('SINT.PSICOLOGO');
    await registrar(psi, 1001);
    const doMedico = (await get(medico, '/api/pep/paciente/1001/linha-do-tempo?tipos=registro')).json();
    const sessao = doMedico.eventos.find((e: { categoria: string }) => e.categoria === 'psicologia');
    expect(sessao).toMatchObject({ sigilo: true, documento: null });
    const daPsicologia = (await get(psi, '/api/pep/paciente/1001/linha-do-tempo?tipos=registro')).json();
    expect(daPsicologia.eventos.find((e: { categoria: string }) => e.categoria === 'psicologia').sigilo).toBe(
      false,
    );
  });

  it('sigilo da psicologia fora da linha do tempo: registro aberto, abas, busca e visualização', async () => {
    const enf = await entrar('SINT.ENFERMEIRO');
    const psi = await entrar('SINT.PSICOLOGO');
    for (const s of [enf, psi]) {
      expect((await post(s, '/api/pep/prontuario/1001/motivo', { motivo: 'assistencia' })).statusCode).toBe(
        200,
      );
      expect((await post(s, '/api/pep/registro/1001/motivo', { motivo: 'assistencia' })).statusCode).toBe(
        200,
      );
    }
    // M15: a sessão de psicologia (900012) fica sem as abas e fora da busca para a enfermagem.
    const lista = (await get(enf, '/api/pep/prontuario/1001')).json();
    const sessao = lista.itens.find(
      (i: { profissional: { cbo: string } }) => i.profissional.cbo === '251510',
    );
    expect(sessao).toBeDefined();
    const aberto = (await get(enf, `/api/pep/prontuario/1001/registros/${sessao.id}`)).json();
    expect(aberto.abas.texto).toEqual({
      disponivel: false,
      motivo: expect.stringContaining('Houve atendimento'),
    });
    expect((await get(enf, `/api/pep/prontuario/1001/registros/${sessao.id}/texto`)).statusCode).toBe(403);
    const busca = (await get(enf, '/api/pep/prontuario/1001/busca?termo=toracica')).json();
    expect(busca.itens.map((i: { registro: number }) => i.registro)).not.toContain(sessao.id);
    const daPsicologia = (await get(psi, '/api/pep/prontuario/1001/busca?termo=toracica')).json();
    expect(daPsicologia.itens.map((i: { registro: number }) => i.registro)).toContain(sessao.id);
    expect((await get(psi, `/api/pep/prontuario/1001/registros/${sessao.id}/texto`)).statusCode).toBe(200);
    // M22: o registro da psicologia gravado no novo, pela visualização direta.
    const reg = await registrar(psi, 1001);
    const visto = (await get(enf, `/api/pep/registro/1001/registros/${reg}`)).json();
    expect(visto.respostas).toEqual([]);
    expect(visto.marcas[0]).toContain('Houve atendimento');
    const proprio = (await get(psi, `/api/pep/registro/1001/registros/${reg}`)).json();
    expect(proprio.respostas.length).toBeGreaterThan(0);
    // M23: a declaração emitida pela psicologia, pela rota direta do documento.
    const a = (await get(psi, '/api/pep/paciente/1001/atestados')).json();
    const modelo = a.modelos.find((m: { tipo: string }) => m.tipo === 'declaracao')?.codigo;
    const emitida = await post(psi, '/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'declaracao',
      modelo,
      texto: 'Declaro o comparecimento SINTETICO',
    });
    expect(emitida.statusCode).toBe(201);
    const id = emitida.json().origem as number;
    const doc = (await get(enf, `/api/pep/paciente/1001/documentos/atestado/${id}`)).json();
    expect(doc.paragrafos).toEqual([expect.stringContaining('Houve atendimento')]);
    expect(doc.pdf).toBe(false);
    const daAutora = (await get(psi, `/api/pep/paciente/1001/documentos/atestado/${id}`)).json();
    expect(daAutora.paragrafos.join(' ')).toContain('comparecimento');
  });

  it('parecer: o pedido entra na fila com o registro; aceitar e responder encerram', async () => {
    await registrar(medico, 1003, {
      parecer: { tipo: 'pedido', categoria: 'enfermagem', prioridade: 'urgente' },
    });
    const fila = (await get(medico, '/api/pep/interconsultas')).json();
    const p = fila.itens[0];
    expect(p).toMatchObject({ prioridade: 'urgente', situacao: 'solicitado', origem: 'novo' });
    const enf = await entrar('SINT.ENFERMEIRO');
    expect((await post(enf, `/api/pep/interconsultas/${p.id}/aceitar`, {})).statusCode).toBe(200);
    await registrar(enf, 1003, { parecer: { tipo: 'resposta', parecer: p.id } });
    const depois = (await get(medico, '/api/pep/interconsultas')).json();
    expect(depois.itens.find((x: { id: number }) => x.id === p.id).situacao).toBe('respondido');
  });

  it('parecer pelo registro: a resposta a parecer de outro paciente é 404 e não encerra; sem a permissão, 403', async () => {
    await registrar(medico, 1003, {
      parecer: { tipo: 'pedido', categoria: 'enfermagem', prioridade: 'rotina' },
    });
    const fila = (await get(medico, '/api/pep/interconsultas')).json();
    const p = fila.itens.filter((x: { paciente: number }) => x.paciente === 1003).at(-1);
    expect(p.situacao).toBe('solicitado');
    const enf = await entrar('SINT.ENFERMEIRO');
    const f = (await get(enf, '/api/pep/registro/1001/formulario/61')).json();
    const corpo = (parecer: unknown) => ({
      modelo: 61,
      atendimento: 10011,
      impressao: f.impressao,
      dataHoraClinica: agora(),
      respostas: [texto(6101, 'Resposta SINTETICO')],
      parecer,
    });
    const outro = await post(
      enf,
      '/api/pep/registro/1001/finalizar',
      corpo({ tipo: 'resposta', parecer: p.id }),
    );
    expect(outro.statusCode).toBe(404);
    const fisio = await entrar('SINT.FISIOTERAPEUTA');
    const f2 = (await get(fisio, '/api/pep/registro/1003/formulario/61')).json();
    const semPermissao = await post(fisio, '/api/pep/registro/1003/finalizar', {
      ...corpo({ tipo: 'resposta', parecer: p.id }),
      atendimento: 10031,
      impressao: f2.impressao,
    });
    expect(semPermissao.statusCode).toBe(403);
    const pedido = await post(fisio, '/api/pep/registro/1003/finalizar', {
      ...corpo({ tipo: 'pedido', categoria: 'medico', prioridade: 'rotina' }),
      atendimento: 10031,
      impressao: f2.impressao,
    });
    expect(pedido.statusCode).toBe(403);
    const depois = (await get(medico, '/api/pep/interconsultas')).json();
    expect(depois.itens.find((x: { id: number }) => x.id === p.id).situacao).toBe('solicitado');
  });

  it('preceptoria: o residente registra indicando o preceptor; o preceptor coassina no novo (campo de supervisão desligado)', async () => {
    const res = await entrar('SINT.RESIDENTE');
    const f = (await get(res, '/api/pep/registro/1001/formulario/61')).json();
    const base = {
      modelo: 61,
      atendimento: 10011,
      impressao: f.impressao,
      dataHoraClinica: agora(),
      respostas: [texto(6101, 'Evolução do residente SINTETICO')],
    };
    // O preceptor tem de ser outro médico com conselho; o próprio residente, não.
    expect(
      (await post(res, '/api/pep/registro/1001/finalizar', { ...base, preceptor: 'SINT.RESIDENTE' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post(res, '/api/pep/registro/1001/finalizar', { ...base, preceptor: 'SINT.ENFERMEIRO' }))
        .statusCode,
    ).toBe(422);
    const r = await post(res, '/api/pep/registro/1001/finalizar', { ...base, preceptor: 'SINT.MEDICO' });
    expect(r.statusCode).toBe(201);
    const registro = r.json().registro as number;
    const pend = (await get(medico, '/api/pep/assinaturas')).json();
    const c = pend.coassinaturas.find((x: { registro: number }) => x.registro === registro);
    expect(c).toMatchObject({ residente: 'SINT.RESIDENTE', paciente: 1001 });
    // Só o preceptor indicado coassina.
    const enf = await entrar('SINT.ENFERMEIRO');
    expect(
      (await post(enf, `/api/pep/supervisao/${c.id}/coassinar`, { decisao: 'coassinado' })).statusCode,
    ).toBe(403);
    const ok = await post(medico, `/api/pep/supervisao/${c.id}/coassinar`, { decisao: 'coassinado' });
    expect(ok.statusCode).toBe(200);
    // POL-3: o campo de supervisão do registro fica desligado com o motivo; a coassinatura vale no novo.
    expect(ok.json().campoSupervisao.pode).toBe(false);
    expect(ok.json().campoSupervisao.motivo).toMatch(/ainda não foi provada/);
    expect(trilha.eventos.some((e) => e.evento === 'pep.evolucao.coassinada')).toBe(true);
    expect(
      (await post(medico, `/api/pep/supervisao/${c.id}/coassinar`, { decisao: 'coassinado' })).statusCode,
    ).toBe(409);
    expect(
      (await post(medico, `/api/pep/supervisao/${c.id}/coassinar`, { decisao: 'recusado' })).statusCode,
    ).toBe(400);
    expect(
      (await get(medico, '/api/pep/assinaturas'))
        .json()
        .coassinaturas.some((x: { id: number }) => x.id === c.id),
    ).toBe(false);
  });

  it('assinatura em lote: a prévia mostra o hash; o hash diferente recusa só aquele documento', async () => {
    const pend = (await get(medico, '/api/pep/assinaturas')).json();
    expect(pend.total).toBeGreaterThan(1);
    const [a, b] = pend.itens;
    const previa = (await get(medico, `/api/pep/assinaturas/${a.documento}/previa`)).json();
    expect(previa.hash).toBe(a.hash);
    const r = await post(medico, '/api/pep/assinaturas', {
      documentos: [a.documento, b.documento],
      hashes: [a.hash, 'f'.repeat(64)],
      senha: SENHA,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().assinados).toEqual([a.documento]);
    expect(r.json().recusados.map((x: { documento: number }) => x.documento)).toEqual([b.documento]);
    expect(trilha.eventos.some((e) => e.evento === 'documento.documento.assinado')).toBe(true);
  });

  it('painel por vínculo: "meus" só com registro ou parecer aceito do profissional; "equipe" pela especialidade', async () => {
    const ids = (r: { json(): { pacientes: { paciente: number }[] } }) =>
      r
        .json()
        .pacientes.map((l) => l.paciente)
        .sort();
    expect(ids(await get(medico, '/api/pep/painel?vinculo=meus'))).toEqual([1001, 1003]);
    const fisio = await entrar('SINT.FISIOTERAPEUTA');
    expect(ids(await get(fisio, '/api/pep/painel?vinculo=meus'))).toEqual([]);
    expect(ids(await get(medico, '/api/pep/painel?vinculo=equipe'))).toEqual([1001, 1003]);
    expect(ids(await get(fisio, '/api/pep/painel?vinculo=equipe'))).toEqual([]);
    expect((await get(medico, '/api/pep/painel')).json().configurar).toBe(true);
    expect((await get(medico, '/api/pep/painel?favoritos=sim&ids=1003')).json().pacientes).toHaveLength(1);
    expect((await get(medico, '/api/pep/painel?vinculo=outro')).statusCode).toBe(400);
  });

  it('linha do tempo: os filtros de cirurgia e de termo de consentimento trazem os eventos', async () => {
    const c = (await get(medico, '/api/pep/paciente/1001/linha-do-tempo?tipos=cirurgia')).json();
    expect(c.eventos.map((e: { tipo: string }) => e.tipo)).toEqual(['cirurgia']);
    const tc = await post(medico, '/api/pep/paciente/1001/tcle', {
      atendimento: 10011,
      procedimento: 'Herniorrafia inguinal SINTETICO',
      texto: 'Fui informado dos riscos e benefícios do procedimento SINTETICO.',
    });
    expect(tc.statusCode).toBe(201);
    const t = (await get(medico, '/api/pep/paciente/1001/linha-do-tempo?tipos=tcle')).json();
    expect(t.eventos[0]).toMatchObject({ tipo: 'tcle', situacao: 'pendente' });
    expect(t.eventos[0].documento).toMatchObject({ tipo: 'tcle' });
  });

  it('permissões: a recepção não abre o painel nem o prontuário (403)', async () => {
    const rec = await entrar('SINT.RECEPCAO');
    expect((await get(rec, '/api/pep/painel')).statusCode).toBe(403);
    expect((await get(rec, '/api/pep/paciente/1001/receitas')).statusCode).toBe(403);
  });
});
