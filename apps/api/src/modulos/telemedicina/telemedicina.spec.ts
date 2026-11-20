// M50, etapa 4 (telemedicina) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta
// a banco): a teleconsulta de hoje da paciente sintética 1003 — a sala de espera no portal com o termo e o local, a
// recusa antes do médico, a lista e o detalhe do médico com o alerta do crônico, o início que exige a ciência do
// alerta e abre o atendimento pela receita do M20 (cenário teleconsulta) com a sala do provedor simulado, a entrada do
// paciente na sala, o encerramento; a marcação de teleconsulta pelo portal numa agenda que a oferece (e o cancelamento
// que a cancela); a teleinterconsulta pedida, respondida só pelo convidado e cancelada só por quem pediu; a marca da
// telemedicina na receita; as permissões e a chave. Pacientes e e-mails SINTÉTICOS.
import { codigoTotp } from '@sgh/dominio-acesso';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MARCA_TELEMEDICINA, VERSAO_DECLARACAO_MEDICO, VERSAO_TERMO_TELECONSULTA } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PORTA_ATENDIMENTO, type PortaAtendimentoMemoria } from '../atendimento/public-api.js';
import { SERVICO_DOCUMENTOS, type ServicoDocumentos } from '../pep/public-api.js';
import { PortaRegistroMemoria } from '../pep/registro-porta-memoria.js';
import { MARCACAO_SEMENTE_TELE, PortaTelemedicinaMemoria } from './porta-memoria.js';
import { ProvedorSimulado } from './provedor.js';
import type { ServicoTelemedicina } from './servico.js';
import { SERVICO_TELEMEDICINA } from './telemedicina.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let atd: PortaAtendimentoMemoria | null = null;
const tele = new PortaTelemedicinaMemoria(undefined, {
  semente: true,
  aoSemear: (h, m) => atd?.incluirMarcacaoSintetica(h, m),
});
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: new PortaRegistroMemoria(trilha),
    telemedicina: tele,
    provedorTeleconsulta: new ProvedorSimulado(),
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  atd = app.get(PORTA_ATENDIMENTO) as PortaAtendimentoMemoria;
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
const interno = (s: Sessao, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m504-${++chave}-${Date.now()}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

function cookiesDe(set: string[] | string | undefined, base = ''): Sessao {
  const lista = Array.isArray(set) ? set : set ? [set] : [];
  const mapa = new Map<string, string>();
  for (const c of base.split('; ').filter(Boolean)) mapa.set(c.split('=')[0]!, c);
  for (const c of lista) {
    const par = c.split(';')[0]!;
    const [k, v] = [par.split('=')[0]!, par.slice(par.indexOf('=') + 1)];
    if (v === '') mapa.delete(k);
    else mapa.set(k, par);
  }
  return {
    cookie: [...mapa.values()].join('; '),
    csrf: (mapa.get('sgh_pac_csrf') ?? '').slice('sgh_pac_csrf='.length),
  };
}
const p = (s: Sessao, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/paciente${url}`,
    headers: { cookie: s.cookie, 'x-csrf-paciente': s.csrf, 'idempotency-key': `pac-m504-${++chave}` },
    remoteAddress: '10.50.4.1',
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

async function primeiroAcesso(paciente: number, nascimento: string, email: string): Promise<Sessao> {
  const r = await entrar('SINT.RECEPCAO');
  const conv = await interno(r, 'POST', `/portal-paciente/pacientes/${paciente}/convite`, {
    origem: 'recepcao',
  });
  expect(conv.statusCode).toBe(201);
  const codigo = conv.json().codigo as string;
  const a = await app.inject({
    method: 'POST',
    url: '/api/paciente/aa/convite',
    payload: { codigo, nascimento },
    remoteAddress: '10.50.4.9',
  });
  expect(a.statusCode).toBe(204);
  let s = cookiesDe(a.headers['set-cookie'] as string[]);
  const ini = await p(s, 'POST', '/ativacao', {
    codigo,
    nascimento,
    email,
    senha: 'frase-sintetica-longa',
    confirmacao: 'frase-sintetica-longa',
    termoUso: '2026.1',
    politicaPrivacidade: '2026.1',
  });
  expect(ini.statusCode).toBe(200);
  const segredo = new URL(ini.json().otpauth as string).searchParams.get('secret') ?? '';
  const fim = await p(s, 'POST', '/ativacao/segundo-fator', { codigo: codigoTotp(segredo, Date.now()) });
  expect(fim.statusCode).toBe(200);
  s = cookiesDe(fim.headers['set-cookie'] as string[], s.cookie);
  return s;
}

const LOCAL = { uf: 'RJ', municipio: 'petropolis', tipo: 'residencia' };
/** A sessão do portal da paciente 1003 (a dona da teleconsulta da semente). */
let portal1003: Sessao | null = null;

describe('teleconsulta: sala de espera, início pelo médico, sala e encerramento', () => {
  let pac: Sessao;
  let medico: Sessao;
  let id = 0;

  beforeAll(async () => {
    pac = await primeiroAcesso(1003, '1990-07-01', 'cinthya-m504@portal.test');
    portal1003 = pac;
    medico = await entrar('SINT.MEDICO');
  });

  it('o portal lista a teleconsulta de hoje com o termo vigente; a sala de espera pede o termo e o local', async () => {
    const l = await p(pac, 'GET', '/teleconsultas');
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ ligada: true, termo: { versao: VERSAO_TERMO_TELECONSULTA } });
    const t = l.json().itens[0];
    expect(t).toMatchObject({ situacao: 'agendada', podeEntrar: true, termo: null, sala: null });
    id = t.id as number;
    // Sem CSRF, recusa; sem o termo vigente, recusa.
    const semCsrf = await app.inject({
      method: 'POST',
      url: `/api/paciente/teleconsultas/${id}/espera`,
      headers: { cookie: pac.cookie },
      payload: { termo: VERSAO_TERMO_TELECONSULTA, aceito: true, local: LOCAL },
    });
    expect(semCsrf.statusCode).toBe(403);
    expect(
      (
        await p(pac, 'POST', `/teleconsultas/${id}/espera`, {
          termo: 'TELE-2025',
          aceito: true,
          local: LOCAL,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await p(pac, 'POST', `/teleconsultas/${id}/espera`, {
          termo: VERSAO_TERMO_TELECONSULTA,
          aceito: true,
          local: { ...LOCAL, uf: 'XX' },
        })
      ).statusCode,
    ).toBe(400);
    // Antes do médico, a sala não abre.
    expect((await p(pac, 'POST', `/teleconsultas/${id}/entrada`)).json().codigo).toBe('sala-fechada');
    const e = await p(pac, 'POST', `/teleconsultas/${id}/espera`, {
      termo: VERSAO_TERMO_TELECONSULTA,
      aceito: true,
      local: LOCAL,
    });
    expect(e.statusCode).toBe(200);
    expect(e.json()).toMatchObject({
      situacao: 'aguardando',
      termo: { versao: VERSAO_TERMO_TELECONSULTA },
      local: { uf: 'RJ', municipio: 'PETROPOLIS', tipo: 'residencia' },
    });
    // A trilha leva só a versão do termo (o local não vai).
    const linha = tele.trilhas.at(-1);
    expect(linha).toMatchObject({
      evento: 'atendimento.teleconsulta.salaEspera',
      chaveNaturalAlvo: `termo=${VERSAO_TERMO_TELECONSULTA}`,
      idPaciente: 1003,
    });
    expect(JSON.stringify(linha)).not.toMatch(/PETROPOLIS/);
    // A teleconsulta de outra pessoa (ou inexistente) não aparece.
    expect((await p(pac, 'GET', '/teleconsultas/999999')).statusCode).toBe(404);
  });

  it('o médico vê o paciente na espera, o alerta do crônico e o que a marcação traz; a recepção não entra', async () => {
    const rec = await entrar('SINT.RECEPCAO');
    expect((await interno(rec, 'GET', '/telemedicina')).statusCode).toBe(403);
    const l = await interno(medico, 'GET', '/telemedicina');
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({
      ligada: true,
      podeRealizar: true,
      profissional: { vinculo: 7101 },
    });
    expect(l.json().teleconsultas[0]).toMatchObject({ id, pacienteNaEspera: true, paciente: { id: 1003 } });
    const d = await interno(medico, 'GET', `/telemedicina/${id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({
      situacao: 'aguardando',
      marcacao: MARCACAO_SEMENTE_TELE,
      alerta: { cronico: true, alerta: true, diasSemPresencial: 200 },
      abertura: { convenio: 306, especialidade: 15, unidade: 1, centroCusto: 300600 },
      acoes: { iniciar: { pode: true } },
    });
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'atendimento.teleconsulta.lida' });
    const a = await interno(medico, 'GET', '/telemedicina/apoio');
    expect(a.json().medicos.map((m: { vinculo: number }) => m.vinculo)).toEqual([7101, 7102]);
  });

  it('iniciar exige a declaração e a ciência do alerta; abre a sala simulada e o atendimento (receita do M20)', async () => {
    const versao = (await interno(medico, 'GET', `/telemedicina/${id}`)).json().versao as number;
    const base = {
      declaracao: VERSAO_DECLARACAO_MEDICO,
      cidPrincipal: 2,
      procedimento: 10101012,
      especialidade: 15,
      unidade: 1,
      centroCusto: 300600,
      versao,
    };
    expect(
      (await interno(medico, 'POST', `/telemedicina/${id}/inicio`, { ...base, declaracao: 'x' })).statusCode,
    ).toBe(400);
    const semCiencia = await interno(medico, 'POST', `/telemedicina/${id}/inicio`, base);
    expect(semCiencia.statusCode).toBe(409);
    expect(semCiencia.json().codigo).toBe('alerta-cronico');
    const ok = await interno(medico, 'POST', `/telemedicina/${id}/inicio`, { ...base, cienteAlerta: true });
    expect(ok.statusCode).toBe(200);
    const t = ok.json().teleconsulta;
    expect(t).toMatchObject({
      situacao: 'em-andamento',
      medico: 'SINT.MEDICO',
      sala: { provedor: 'simulado' },
      acoes: { iniciar: { pode: false }, encerrar: { pode: true } },
    });
    expect(t.atendimento).toBeGreaterThan(0);
    expect(t.sala.endereco).toMatch(/^simulado:SIM-SALA-[0-9A-F]{16}:medico$/);
    // A trilha: a sala aberta (a declaração), a abertura pelo executor e TELECONSULTA_INICIADA (o REG).
    const ev = trilha.eventos.map((x) => x.evento);
    expect(ev).toContain('atendimento.teleconsulta.salaAberta');
    expect(ev).toContain('atendimento.atendimento.aberto');
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'atendimento.teleconsulta.iniciada' });
    // A linha da SGH_TRILHA (na transação SGH_) leva só o REG.
    expect(tele.trilhas.at(-1)).toMatchObject({
      evento: 'atendimento.teleconsulta.iniciada',
      chaveNaturalAlvo: `reg=${t.atendimento}`,
      idPaciente: 1003,
    });
    // A ficha da consulta (a marcação ligada; sem senha).
    const ficha = await interno(medico, 'GET', `/atendimento/${t.atendimento}`);
    expect(ficha.json()).toMatchObject({ tipo: 'consulta', senha: null, paciente: { id: 1003 } });
    // De novo: já iniciada.
    const outra = await interno(medico, 'POST', `/telemedicina/${id}/inicio`, {
      ...base,
      versao: t.versao,
      cienteAlerta: true,
    });
    expect(outra.statusCode).toBe(409);
  });

  it('o paciente vê a sala e entra (a primeira entrada vai à trilha); o médico encerra', async () => {
    const d = await p(pac, 'GET', `/teleconsultas/${id}`);
    expect(d.json()).toMatchObject({ situacao: 'em-andamento', sala: { provedor: 'simulado' } });
    expect(d.json().sala.endereco).toMatch(/:paciente$/);
    const antes = tele.trilhas.length;
    expect((await p(pac, 'POST', `/teleconsultas/${id}/entrada`)).statusCode).toBe(200);
    expect(tele.trilhas.at(-1)).toMatchObject({ evento: 'atendimento.teleconsulta.pacienteEntrou' });
    await p(pac, 'POST', `/teleconsultas/${id}/entrada`);
    expect(tele.trilhas.length).toBe(antes + 1);
    const versao = (await interno(medico, 'GET', `/telemedicina/${id}`)).json().versao as number;
    const fim = await interno(medico, 'POST', `/telemedicina/${id}/encerramento`, {
      motivo: 'concluida',
      versao,
    });
    expect(fim.statusCode).toBe(200);
    expect(fim.json().teleconsulta).toMatchObject({ situacao: 'encerrada', motivoEncerramento: 'concluida' });
    expect(tele.trilhas.at(-1)).toMatchObject({
      evento: 'atendimento.teleconsulta.encerrada',
      chaveNaturalAlvo: 'motivo=concluida',
    });
    const de_novo = await interno(medico, 'POST', `/telemedicina/${id}/encerramento`, {
      motivo: 'concluida',
      versao: fim.json().teleconsulta.versao,
    });
    expect(de_novo.statusCode).toBe(409);
    expect((await p(pac, 'GET', `/teleconsultas/${id}`)).json()).toMatchObject({
      situacao: 'encerrada',
      sala: null,
    });
  });

  it('a teleconsulta pelo portal: só na agenda que oferece; a lista mostra a modalidade; o cancelamento a cancela', async () => {
    const o = await p(pac, 'GET', '/agenda/opcoes?tipo=consulta');
    expect(o.json().agendas[0]).toMatchObject({ agenda: 902, teleconsulta: true });
    const h = await p(pac, 'GET', '/agenda/horarios?tipo=consulta&convenio=10&modalidade=teleconsulta');
    expect(h.statusCode).toBe(200);
    const x = h.json().itens.at(-1) as { agenda: number; data: string; hora: string };
    const exame = await p(pac, 'POST', '/agenda/marcacoes', {
      tipo: 'exame',
      agenda: 902,
      data: x.data,
      hora: x.hora,
      convenio: 10,
      modalidade: 'teleconsulta',
    });
    expect(exame.statusCode).toBe(400);
    const m = await p(pac, 'POST', '/agenda/marcacoes', {
      tipo: 'consulta',
      agenda: 902,
      data: x.data,
      hora: x.hora,
      convenio: 10,
      modalidade: 'teleconsulta',
    });
    expect(m.statusCode).toBe(200);
    expect(m.json().mensagem).toMatch(/Teleconsulta marcada/);
    const marcacao = Number(m.json().agendamento.id);
    expect(m.json().agendamento.teleconsulta).toMatchObject({ situacao: 'agendada' });
    expect(tele.trilhas.at(-1)).toMatchObject({
      evento: 'atendimento.teleconsulta.agendada',
      chaveNaturalAlvo: `marcacao=${marcacao}`,
    });
    const lista = (await p(pac, 'GET', '/teleconsultas')).json().itens as { situacao: string }[];
    expect(lista.some((t) => t.situacao === 'agendada')).toBe(true);
    const c = await p(pac, 'POST', `/agenda/marcacoes/consulta/${marcacao}/cancelamento`, {
      motivo: 'PAC-DESISTIU',
    });
    expect(c.statusCode).toBe(200);
    expect(
      c.json().itens.find((a: { id: string }) => a.id === String(marcacao))?.teleconsulta ?? null,
    ).toBeNull();
    expect(tele.trilhas.at(-1)).toMatchObject({ evento: 'atendimento.teleconsulta.cancelada' });
  });
});

describe('teleinterconsulta', () => {
  let medico: Sessao;
  let cardio: Sessao;

  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
    cardio = await entrar('SINT.CARDIO.TELE');
  });

  it('pedida no atendimento aberto; responde só o convidado; cancela só quem pediu', async () => {
    const abertos = await interno(medico, 'GET', '/telemedicina/atendimentos');
    expect(abertos.statusCode).toBe(200);
    const reg = (abertos.json() as { reg: number }[])[0]!.reg;
    const semConsentimento = await interno(medico, 'POST', '/telemedicina/interconsultas', {
      atendimento: reg,
      convidado: 7102,
      motivo: 'Opinião sobre a arritmia SINTETICO',
      consentimento: false,
    });
    expect(semConsentimento.statusCode).toBe(400);
    const euMesmo = await interno(medico, 'POST', '/telemedicina/interconsultas', {
      atendimento: reg,
      convidado: 7101,
      motivo: 'Opinião sobre a arritmia SINTETICO',
      consentimento: true,
    });
    expect(euMesmo.json().codigo).toBe('nao-pode-solicitar');
    const s = await interno(medico, 'POST', '/telemedicina/interconsultas', {
      atendimento: reg,
      convidado: 7102,
      motivo: 'Opinião sobre a arritmia SINTETICO',
      consentimento: true,
    });
    expect(s.statusCode).toBe(201);
    const t = s.json().teleconsulta;
    expect(t).toMatchObject({
      modalidade: 'teleinterconsulta',
      situacao: 'solicitada',
      interconsulta: { convidado: { vinculo: 7102 }, minha: true, paraMim: false },
      acoes: { responder: { pode: false }, cancelar: { pode: true } },
    });
    expect(tele.trilhas.at(-1)).toMatchObject({
      evento: 'atendimento.teleinterconsulta.solicitada',
      chaveNaturalAlvo: 'convidado=7102',
    });
    // Quem pediu não responde; o convidado vê na lista, abre a sala e responde.
    expect(
      (
        await interno(medico, 'POST', `/telemedicina/interconsultas/${t.id}/parecer`, {
          parecer: 'Parecer de quem pediu SINTETICO',
          versao: t.versao,
        })
      ).json().codigo,
    ).toBe('nao-pode-responder');
    const lista = (await interno(cardio, 'GET', '/telemedicina')).json();
    expect(lista.interconsultas.map((x: { id: number }) => x.id)).toContain(t.id);
    const sala = await interno(cardio, 'POST', `/telemedicina/interconsultas/${t.id}/sala`, {
      versao: t.versao,
    });
    expect(sala.statusCode).toBe(200);
    expect(sala.json().teleconsulta.sala.endereco).toMatch(/:convidado$/);
    const r = await interno(cardio, 'POST', `/telemedicina/interconsultas/${t.id}/parecer`, {
      parecer: 'Sem contraindicação ao ajuste SINTETICO',
      versao: sala.json().teleconsulta.versao,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().teleconsulta).toMatchObject({
      situacao: 'respondida',
      interconsulta: { parecer: 'Sem contraindicação ao ajuste SINTETICO', paraMim: true },
    });
    expect(tele.trilhas.at(-1)).toMatchObject({ evento: 'atendimento.teleinterconsulta.respondida' });
    expect(JSON.stringify(tele.trilhas)).not.toMatch(/contraindica|arritmia/);
    // Uma segunda, cancelada por quem pediu (o convidado não cancela).
    const s2 = (
      await interno(medico, 'POST', '/telemedicina/interconsultas', {
        atendimento: reg,
        convidado: 7102,
        motivo: 'Segunda opinião SINTETICO',
        consentimento: true,
      })
    ).json().teleconsulta;
    expect(
      (
        await interno(cardio, 'POST', `/telemedicina/interconsultas/${s2.id}/cancelamento`, {
          motivo: 'Não sou eu',
          versao: s2.versao,
        })
      ).json().codigo,
    ).toBe('nao-pode-cancelar');
    const c = await interno(medico, 'POST', `/telemedicina/interconsultas/${s2.id}/cancelamento`, {
      motivo: 'Paciente melhorou',
      versao: s2.versao,
    });
    expect(c.json().teleconsulta).toMatchObject({ situacao: 'cancelada' });
  });
});

describe('a marca da telemedicina nos documentos (regra 7)', () => {
  it('a receita do atendimento de teleconsulta sai com a marca; a de outro atendimento, sem', async () => {
    // Um atendimento de teleconsulta da paciente sintética 1001 (o cabeçalho do PEP em memória, 10011).
    const c = { rede: '', hospital: 'aa' };
    const { id } = await tele.gravar(c, null, (g) =>
      g.agendar({
        marcacao: 880_999,
        agenda: 902,
        nomeAgenda: 'CARDIOLOGIA',
        crmAgenda: 52001,
        data: '2026-11-10',
        hora: '1000',
        paciente: 1001,
        conta: null,
        por: 'T',
      }),
    );
    await tele.gravar(c, null, async (g) => {
      const v = await g.entrarSalaEspera(id, 1, { termo: VERSAO_TERMO_TELECONSULTA, local: LOCAL, por: 'T' });
      await g.abrirSala(id, v.versao, {
        provedor: 'simulado',
        sala: 'SIM',
        declaracao: VERSAO_DECLARACAO_MEDICO,
        medico: 'SINT.MEDICO',
        vinculo: 7101,
        cienteAlerta: false,
      });
      await g.vincularAtendimento({
        id,
        marcacao: 880_999,
        cabecalho: '10011',
        reg: 99,
        usuario: 'T',
        profissional: 7101,
      });
    });
    const medico = await entrar('SINT.MEDICO');
    const rec = await interno(medico, 'POST', '/pep/paciente/1001/receitas', {
      atendimento: 10011,
      tipo: 'simples',
      itens: [{ medicamento: 'DIPIRONA SINTETICO', posologia: '1 comprimido se dor', quantidade: '10' }],
    });
    expect(rec.statusCode).toBe(201);
    const lista = (await interno(medico, 'GET', '/pep/paciente/1001/receitas')).json();
    const doc = (
      await interno(medico, 'GET', `/pep/paciente/1001/documentos/receita/${lista.documentos[0].id}`)
    ).json();
    expect(doc.paragrafos.join(' ')).toContain(MARCA_TELEMEDICINA);
    const outra = await interno(medico, 'POST', '/pep/paciente/1003/receitas', {
      atendimento: 10031,
      tipo: 'simples',
      itens: [{ medicamento: 'DIPIRONA SINTETICO', posologia: '1 comprimido se dor', quantidade: '10' }],
    });
    expect(outra.statusCode).toBe(201);
    const l2 = (await interno(medico, 'GET', '/pep/paciente/1003/receitas')).json();
    const d2 = (
      await interno(medico, 'GET', `/pep/paciente/1003/documentos/receita/${l2.documentos[0].id}`)
    ).json();
    expect(d2.paragrafos.join(' ')).not.toContain(MARCA_TELEMEDICINA);
    // O atestado e o pedido de exame do atendimento de teleconsulta também levam a marca (no texto e no documento).
    const docs = app.get(SERVICO_DOCUMENTOS) as ServicoDocumentos;
    const atestado = vi.spyOn(docs, 'montarAtestado');
    const pedido = vi.spyOn(docs, 'montarPedido');
    try {
      const modelos = (await interno(medico, 'GET', '/pep/paciente/1001/atestados')).json().modelos;
      const modelo = modelos.find((m: { tipo: string }) => m.tipo === 'atestado').codigo;
      const at = await interno(medico, 'POST', '/pep/paciente/1001/atestados', {
        atendimento: 10011,
        tipo: 'atestado',
        modelo,
        texto: 'Atesto para os devidos fins SINTETICO',
        diasAfastamento: 1,
      });
      expect(at.statusCode).toBe(201);
      expect(JSON.stringify(await atestado.mock.results.at(-1)?.value)).toContain(MARCA_TELEMEDICINA);
      const ped = await interno(medico, 'POST', '/pep/paciente/1001/exames', {
        atendimento: 10011,
        itens: [{ exame: 504, indicacao: 'Controle SINTETICO' }],
        confirmarAvisos: true,
      });
      expect(ped.json().gravado).toBe(true);
      const montado = (await pedido.mock.results.at(-1)?.value) as { entrada: { documento: string } };
      expect(montado.entrada.documento).toContain(MARCA_TELEMEDICINA);
      expect(montado.entrada.documento).toContain('Controle SINTETICO');
      // O de outro atendimento, sem a marca.
      await interno(medico, 'POST', '/pep/paciente/1003/exames', {
        atendimento: 10031,
        itens: [{ exame: 505 }],
        confirmarAvisos: true,
      });
      const outroPedido = (await pedido.mock.results.at(-1)?.value) as { entrada: { documento: string } };
      expect(outroPedido.entrada.documento).not.toContain(MARCA_TELEMEDICINA);
      // A leitura da teleconsulta que falha não emite o documento sem a marca (503, nada gravado).
      const s = app.get(SERVICO_TELEMEDICINA) as ServicoTelemedicina;
      const falha = vi.spyOn(s, 'atendimentoEmTeleconsulta').mockRejectedValue(new Error('banco fora'));
      try {
        const r = await interno(medico, 'POST', '/pep/paciente/1001/receitas', {
          atendimento: 10011,
          tipo: 'simples',
          itens: [{ medicamento: 'DIPIRONA SINTETICO', posologia: '1 comprimido se dor', quantidade: '10' }],
        });
        expect([r.statusCode, r.json().codigo]).toEqual([503, 'marca-telemedicina-indisponivel']);
      } finally {
        falha.mockRestore();
      }
    } finally {
      atestado.mockRestore();
      pedido.mockRestore();
    }
    // A teleconsulta da paciente 1001 não aparece no portal da 1003 (o titular da sessão).
    expect((await p(portal1003!, 'GET', `/teleconsultas/${id}`)).statusCode).toBe(404);
    expect(
      (
        await p(portal1003!, 'POST', `/teleconsultas/${id}/espera`, {
          termo: VERSAO_TERMO_TELECONSULTA,
          aceito: true,
          local: LOCAL,
        })
      ).statusCode,
    ).toBe(404);
  });
});

/** Hoje e a meia hora corrente em São Paulo (a sala de espera abre 30 minutos antes). */
function agoraSp(): { hoje: string; hora: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return {
    hoje: `${v('year')}-${v('month')}-${v('day')}`,
    hora: `${v('hour')}${Number(v('minute')) >= 30 ? '30' : '00'}`,
  };
}

describe('correção da revisão (M50.4): o médico da sala, as rotas de fora, a marcação que sumiu', () => {
  const c = { rede: '', hospital: 'aa' };
  let medico: Sessao;
  let cardio: Sessao;

  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
    cardio = await entrar('SINT.CARDIO.TELE');
  });

  it('com a sala aberta por um médico, outro não vê a sala, não inicia e não encerra (403 outro-medico)', async () => {
    const { hoje, hora } = agoraSp();
    const { id } = await tele.gravar(c, null, (g) =>
      g.agendar({
        marcacao: 880_997,
        agenda: 902,
        nomeAgenda: 'CARDIOLOGIA',
        crmAgenda: 52001,
        data: hoje,
        hora,
        paciente: 1003,
        conta: null,
        por: 'T',
      }),
    );
    await tele.gravar(c, null, async (g) => {
      const v = await g.entrarSalaEspera(id, 1, { termo: VERSAO_TERMO_TELECONSULTA, local: LOCAL, por: 'T' });
      await g.abrirSala(id, v.versao, {
        provedor: 'simulado',
        sala: 'SIM-OUTRO',
        declaracao: VERSAO_DECLARACAO_MEDICO,
        medico: 'SINT.MEDICO',
        vinculo: 7101,
        cienteAlerta: true,
      });
    });
    const meu = (await interno(medico, 'GET', `/telemedicina/${id}`)).json();
    expect(meu.sala?.endereco).toMatch(/:medico$/);
    const doOutro = (await interno(cardio, 'GET', `/telemedicina/${id}`)).json();
    expect(doOutro).toMatchObject({
      situacao: 'sala-aberta',
      sala: null,
      acoes: { iniciar: { pode: false }, encerrar: { pode: false } },
    });
    const base = {
      declaracao: VERSAO_DECLARACAO_MEDICO,
      cidPrincipal: 2,
      procedimento: 10101012,
      especialidade: 15,
      unidade: 1,
      centroCusto: 300600,
      versao: doOutro.versao,
      cienteAlerta: true,
    };
    const ini = await interno(cardio, 'POST', `/telemedicina/${id}/inicio`, base);
    expect([ini.statusCode, ini.json().codigo]).toEqual([403, 'outro-medico']);
    const enc = await interno(cardio, 'POST', `/telemedicina/${id}/encerramento`, {
      motivo: 'paciente-ausente',
      versao: doOutro.versao,
    });
    expect([enc.statusCode, enc.json().codigo]).toEqual([403, 'outro-medico']);
    expect((await tele.porId(c, id))?.situacao).toBe('sala-aberta');
    // O médico da sala encerra.
    const meuFim = await interno(medico, 'POST', `/telemedicina/${id}/encerramento`, {
      motivo: 'paciente-ausente',
      versao: doOutro.versao,
    });
    expect(meuFim.statusCode).toBe(200);
  });

  it('a abertura do atendimento e a marcação da central recusam o campo teleconsulta (400)', async () => {
    // A recepção (só a opção de abrir atendimento) não liga a ficha à teleconsulta pela rota do atendimento.
    const recepcao = await entrar('SINT.ATENDIMENTO');
    const a = await interno(recepcao, 'POST', '/atendimento', {
      tipo: 'consulta',
      paciente: 1003,
      convenio: 306,
      profissional: 7102,
      especialidade: 15,
      unidade: 1,
      centroCusto: 300600,
      procedimento: 10101012,
      carater: 'eletivo',
      retorno: false,
      cidPrincipal: 2,
      marcacao: 880_997,
      tipoGuia: 'H',
      teleconsulta: { id: 1 },
    });
    expect([a.statusCode, a.json().codigo]).toEqual([400, 'teleconsulta-pela-telemedicina']);
    const central = await entrar('SINT.AGENDA');
    const m = await interno(central, 'POST', '/agenda/consultas/marcacoes', {
      agenda: 902,
      data: '2026-12-01',
      hora: '0900',
      paciente: 1003,
      convenio: 10,
      retorno: false,
      canal: 'portal',
      teleconsulta: { conta: 1 },
    });
    expect([m.statusCode, m.json().codigo]).toEqual([400, 'teleconsulta-pelo-portal']);
  });

  it('a marcação cancelada ou mudada fora do portal e da central: a teleconsulta sai como cancelada', async () => {
    const { hoje } = agoraSp();
    const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const { id } = await tele.gravar(c, null, (g) =>
      g.agendar({
        marcacao: 880_996,
        agenda: 902,
        nomeAgenda: 'CARDIOLOGIA',
        crmAgenda: 52001,
        data: amanha,
        hora: '1000',
        paciente: 1003,
        conta: null,
        por: 'T',
      }),
    );
    const antes = (await p(portal1003!, 'GET', '/teleconsultas')).json().itens as {
      id: number;
      situacao: string;
    }[];
    expect(antes.find((x) => x.id === id)?.situacao).toBe('agendada');
    tele.apagarMarcacao('aa', 880_996);
    const depois = (await p(portal1003!, 'GET', '/teleconsultas')).json().itens as {
      id: number;
      situacao: string;
      podeEntrar: boolean;
    }[];
    expect(depois.find((x) => x.id === id)).toMatchObject({ situacao: 'cancelada', podeEntrar: false });
    expect((await p(portal1003!, 'GET', `/teleconsultas/${id}`)).json().situacao).toBe('cancelada');
    const doMedico = (await interno(medico, 'GET', `/telemedicina?data=${amanha}`)).json();
    expect(doMedico.teleconsultas.find((x: { id: number }) => x.id === id)).toMatchObject({
      situacao: 'cancelada',
      pacienteNaEspera: false,
    });
    expect((await interno(medico, 'GET', `/telemedicina/${id}`)).json()).toMatchObject({
      situacao: 'cancelada',
      acoes: { iniciar: { pode: false } },
    });
  });
});

describe('liberação (POL-3)', () => {
  it('com a chave telemedicina desligada: o portal não oferece, o médico fica em consulta, a marcação recusa', async () => {
    const s = app.get(SERVICO_TELEMEDICINA) as ServicoTelemedicina;
    const a = vi.spyOn(s, 'ligada').mockResolvedValue(false);
    const b = vi.spyOn(s.apoio, 'liberacao').mockResolvedValue({ ligada: false, motivo: 'Desligada.' });
    const antes = tele.trilhas.length;
    try {
      const l = (await p(portal1003!, 'GET', '/teleconsultas')).json();
      expect(l.ligada).toBe(false);
      expect(l.itens.every((x: { podeEntrar: boolean }) => !x.podeEntrar)).toBe(true);
      const medico = await entrar('SINT.MEDICO');
      const m = (await interno(medico, 'GET', '/telemedicina')).json();
      expect(m).toMatchObject({ ligada: false, motivo: 'Desligada.' });
      const h = await p(
        portal1003!,
        'GET',
        '/agenda/horarios?tipo=consulta&convenio=10&modalidade=teleconsulta',
      );
      expect([h.statusCode, h.json().codigo]).toEqual([403, 'recurso-desligado']);
      const r = await interno(medico, 'POST', '/telemedicina/interconsultas', {
        atendimento: 1,
        convidado: 7102,
        motivo: 'Opinião SINTETICO desligada',
        consentimento: true,
      });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
      expect(tele.trilhas.length).toBe(antes);
    } finally {
      a.mockRestore();
      b.mockRestore();
    }
  });
});
