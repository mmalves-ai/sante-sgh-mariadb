// M26 (SADT, laudos e portal de resultados) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA
// (nada conecta a banco), com o módulo registrado (API_MODULOS=sadt): permissões pelas opções do perfil, liberação (POL-3), pedidos do prontuário a receber,
// lançamento no setor com o alerta de repetição, coleta com a pulseira e o código único da amostra, rastreio com a
// rejeição, digitação com a referência, liberação pelo responsável habilitado (o crítico pede a confirmação e o aviso
// sai na gravação), retificação com o motivo e as versões, laudo de imagem privativo de médico, parâmetros sem segredo,
// orçamento convertido e o portal (protocolo do paciente com limite de tentativas; médico externo com o segundo fator e
// só os pedidos dele). Dados sintéticos.
import { REGISTRO_MODULOS } from '../registro.js';
import { codigoTotp } from '@sgh/dominio-acesso';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { moduloSadt } from './modulo.js';
import { PortaSadtMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'sadt,acesso,config' };
const trilha = new RegistradorTrilhaMemoria();
const documentos = new PortaDocumentosMemoria(trilha, null);
const sadt = new PortaSadtMemoria({ estado: () => 'verde' }, documentos);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      sadt: async () => ({ modulo: (ctx) => moduloSadt(ctx, { porta: sadt, estabelecimentos: ['aa'] }) }),
      // A central de avisos (o sino do médico) é a comunicação do módulo acesso.
      acesso: REGISTRO_MODULOS['acesso']!,
      config: REGISTRO_MODULOS['config']!,
    },
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
  'idempotency-key': `teste-m26-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

interface ExameLista {
  id: number;
  chave: Record<string, unknown>;
  versao: string | null;
  exame: { codigo: string };
  estado: string;
  paciente: { id: number };
}
const exames = async (s: Sessao, q: string): Promise<ExameLista[]> =>
  (await get(s, `/sadt/exames?${q}`)).json().itens;

describe('permissões, gravação e textos de produto', () => {
  it('sem as opções do diagnóstico, 403; com elas, a gravação ligada e nenhum nome de sistema antigo', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/sadt/exames')).statusCode).toBe(403);
    const s = await entrar('SINT.BIOMEDICO');
    const g = (await get(s, '/sadt/gravacao')).json();
    expect(g.setores.laboratorio.ligada).toBe(true);
    expect(g.habilitacao.liberarLaboratorio).toBe(true);
    expect(g.habilitacao.laudarImagem).toBe(false);
    expect(g.operacoes['laboratorio:sadt.liberarExame'].ligada).toBe(true);
    // A emissão do laudo grava no banco próprio (código, via, hash e exames): ligada como as demais do setor.
    expect(g.operacoes['laboratorio:sadt.emitirLaudo'].ligada).toBe(true);
    const lista = await get(s, '/sadt/exames?setor=laboratorio');
    expect(lista.statusCode).toBe(200);
    expect(JSON.stringify([g, lista.json()])).not.toMatch(/SPDATA|legado|sistema atual/i);
  });
});

describe('fluxo do laboratório', () => {
  it('coleta com a pulseira, rastreio, recebimento, digitação, liberação com crítico, retificação e o aviso', async () => {
    const s = await entrar('SINT.BIOMEDICO');
    // O pedido do prontuário (internado): a coleta sem a pulseira é recusada; com a pulseira do paciente, a amostra.
    const pedido = (await exames(s, 'setor=laboratorio&situacao=aReceber')).find(
      (x) => x.exame.codigo === 'HMG',
    )!;
    expect(pedido.estado).toBe('solicitado');
    const coleta = (await get(s, '/sadt/coleta')).json();
    expect(coleta.grupos.some((g: { exigePulseira: boolean }) => g.exigePulseira)).toBe(true);
    // Por unidade e janela de coleta: a unidade sem pedido não traz grupo; a janela do dia inteiro traz todos.
    expect((await get(s, '/sadt/coleta?unidade=999999')).json().grupos).toHaveLength(0);
    const dia = (await get(s, '/sadt/coleta?de=00:00&ate=23:59')).json();
    expect(dia.grupos).toHaveLength(coleta.grupos.length);
    expect(dia).toMatchObject({ deHora: '00:00', ateHora: '23:59' });
    for (const u of coleta.unidades as { codigo: number }[])
      expect((await get(s, `/sadt/coleta?unidade=${u.codigo}`)).json().grupos.length).toBeGreaterThan(0);
    const semPulseira = await post(s, '/sadt/coleta', {
      exames: [pedido.id],
      identificadoresConferidos: true,
    });
    expect(semPulseira.json().codigo).toBe('coleta-nao-conferida');
    const outraPulseira = await post(s, '/sadt/coleta', {
      exames: [pedido.id],
      pulseira: 'P1003|A31338',
      identificadoresConferidos: true,
    });
    expect(outraPulseira.json().codigo).toBe('pulseira-divergente');
    const c = await post(s, '/sadt/coleta', {
      exames: [pedido.id],
      pulseira: 'P1001|A31337',
      identificadoresConferidos: true,
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().codigo).toMatch(/^[0-9A-HJ-NP-Z]{10}$/);
    const amostra = (await get(s, `/sadt/amostras/codigo/${c.json().codigo}`)).json();
    expect(amostra.estado).toBe('coletada');
    expect(
      (await post(s, `/sadt/amostras/${amostra.id}/estado`, { estado: 'emAnalise' })).json().codigo,
    ).toBe('amostra-transicao');
    expect((await post(s, `/sadt/amostras/${amostra.id}/estado`, { estado: 'recebida' })).json().estado).toBe(
      'recebida',
    );
    // Recebimento do pedido no setor (executante e prestador do setor).
    const apoio = (await get(s, '/sadt/apoio?setor=laboratorio')).json();
    const prestador = apoio.prestadores[0].id;
    const executante = apoio.executantes[0].id;
    const lido = (await exames(s, 'setor=laboratorio&situacao=aReceber')).find((x) => x.id === pedido.id)!;
    const r = await post(s, '/sadt/exames/receber', {
      exames: [{ id: lido.id, chave: lido.chave, versao: lido.versao }],
      executante,
      prestador,
      local: 41,
    });
    expect(r.statusCode).toBe(200);
    // Lançamento no setor para o externo (a requisição aberta): o potássio crítico.
    const l = await post(s, '/sadt/exames/lancar', {
      atendimento: 10031,
      ato: 15,
      itens: [{ exame: 502, urgente: true }],
      executante,
      prestador,
      local: 41,
      confirmarAlertas: false,
    });
    expect(l.statusCode).toBe(200);
    const k = l.json().ids.primeiro as number;
    // Repetição no intervalo mínimo: pede a confirmação.
    const rep = await post(s, '/sadt/exames/lancar', {
      atendimento: 10031,
      ato: 15,
      itens: [{ exame: 502, urgente: false }],
      executante,
      prestador,
      local: 41,
      confirmarAlertas: false,
    });
    expect(rep.json().codigo).toBe('restricao-do-exame');
    // Digitação com a referência do dia e a faixa crítica.
    const dig = (await get(s, `/sadt/resultados/${k}/digitacao`)).json();
    expect(dig.elementos[0].referencia.minimo).toBe(3.5);
    expect(dig.elementos[0].critico.acimaDe).toBe(6.5);
    const d = await post(s, `/sadt/resultados/${k}`, {
      versao: dig.exame.versao,
      elementos: [{ elemento: 0, numerico: 7.2, alfa: null, absoluta: null }],
    });
    expect(d.statusCode).toBe(200);
    // Liberação: o crítico pede a confirmação; o médico sem habilitação de laboratório não libera.
    const conf = (await get(s, `/sadt/resultados/${k}/conferencia`)).json();
    expect(conf.critico).toBe(true);
    expect(
      (await post(s, `/sadt/resultados/${k}/liberar`, { versao: conf.exame.versao })).json().codigo,
    ).toBe('confirmar-critico');
    const medico = await entrar('SINT.LAUDADOR');
    expect((await post(medico, `/sadt/resultados/${k}/liberar`, { confirmarCritico: true })).statusCode).toBe(
      403,
    );
    const lib = await post(s, `/sadt/resultados/${k}/liberar`, {
      versao: conf.exame.versao,
      confirmarCritico: true,
    });
    expect(lib.statusCode).toBe(200);
    expect(lib.json().avisos).toHaveLength(1);
    // M27 (revisão): o aviso do crítico vai também à central de avisos do médico do atendimento, depois do COMMIT.
    const sino = await entrar('SINT.MEDICO');
    const central = await get(sino, '/acesso/avisos');
    expect(central.statusCode, central.body).toBe(200);
    const doCritico = central.json().avisos.filter((a: { tipo: string }) => a.tipo === 'resultado-critico');
    expect(doCritico).toHaveLength(1);
    expect(doCritico[0]).toMatchObject({ modulo: 'sadt', gravidade: 'atencao', estado: 'novo' });
    expect(doCritico[0].link).toMatch(/^\/pep\/paciente\/\d+\/resultados$/);
    // O aviso no painel do valor crítico e a comunicação registrada.
    const painel = (await get(s, '/sadt/criticos')).json();
    const aviso = painel.avisos.find((a: { exame: number }) => a.exame === k);
    expect(aviso.situacao).toBe('aguardandoCiencia');
    expect(aviso.origem).toBe('novo');
    expect(
      (
        await post(s, `/sadt/criticos/${aviso.id}/comunicar`, {
          canal: 'telefone',
          destinatario: 'Enfermeira do plantão',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(s, `/sadt/criticos/${aviso.id}/comunicar`, { canal: 'telefone', destinatario: 'De novo' })
      ).json().codigo,
    ).toBe('aviso-comunicado');
    // Resultado liberado não muda pela digitação; a retificação pede o motivo e guarda a versão anterior.
    expect(
      (
        await post(s, `/sadt/resultados/${k}`, {
          elementos: [{ elemento: 0, numerico: 5, alfa: null, absoluta: null }],
        })
      ).json().codigo,
    ).toBe('estado-digitar');
    expect(
      (await post(s, `/sadt/resultados/${k}/retificar`, { motivo: 'x', elementos: [] })).statusCode,
    ).toBe(400);
    // Sem o carimbo lido, a retificação não pula a conferência otimista: 409.
    const semVersao = await post(s, `/sadt/resultados/${k}/retificar`, {
      motivo: 'Erro de digitação do valor',
      elementos: [{ elemento: 0, numerico: 6.8, alfa: null, absoluta: null }],
    });
    expect(semVersao.json().codigo).toBe('conflito-versao');
    const ret = await post(s, `/sadt/resultados/${k}/retificar`, {
      versao: (await get(s, `/sadt/resultados/${k}/conferencia`)).json().exame.versao,
      motivo: 'Erro de digitação do valor',
      elementos: [{ elemento: 0, numerico: 6.8, alfa: null, absoluta: null }],
    });
    expect(ret.statusCode).toBe(200);
    expect(
      (await get(s, `/sadt/resultados/${k}/conferencia`))
        .json()
        .versoes.map((v: { motivo: string | null }) => v.motivo),
    ).toEqual([null, 'Erro de digitação do valor']);
    // TAT (regra 12): a coleta do rastreio entra na média do pedido à coleta, com a parcela impressa.
    const ind = (await get(s, '/sadt/indicadores?setor=laboratorio')).json();
    const lab = ind.linhas.filter((l: { setor: string }) => l.setor === 'laboratorio');
    expect(lab.reduce((n: number, l: { comColeta: number }) => n + l.comColeta, 0)).toBeGreaterThanOrEqual(1);
    for (const l of lab) expect(l.comColetaLiberacao).toBeLessThanOrEqual(l.comColeta);
  });
});

describe('laudo de imagem, parâmetros, orçamento e autocadastro', () => {
  it('o laudo é privativo de médico; o médico lauda e assina; os parâmetros não devolvem segredo', async () => {
    const bio = await entrar('SINT.BIOMEDICO');
    const rx = (await exames(bio, 'setor=imagem&situacao=aDigitar'))[0]!;
    // A biomédica não tem a permissão do laudo de imagem.
    expect(
      (
        await post(bio, `/sadt/resultados/${rx.id}`, {
          laudo: { texto: 'Sem alterações.', html: '<p>x</p>' },
        })
      ).statusCode,
    ).toBe(403);
    const med = await entrar('SINT.LAUDADOR');
    const f = (await get(med, `/sadt/resultados/${rx.id}/digitacao`)).json();
    expect(f.modelos.length).toBeGreaterThan(0);
    const g = await post(med, `/sadt/resultados/${rx.id}`, {
      versao: f.exame.versao,
      laudo: { texto: f.modelos[0].texto, html: '<p>x</p>' },
    });
    expect(g.statusCode).toBe(200);
    const assinado = (await get(med, `/sadt/resultados/${rx.id}/digitacao`)).json();
    expect(
      (await post(med, `/sadt/resultados/${rx.id}/liberar`, { versao: assinado.exame.versao })).statusCode,
    ).toBe(200);
    const p = (await get(bio, '/sadt/parametros?setor=laboratorio')).json();
    expect(p.ocultos).toContain('senha guardada');
    expect(JSON.stringify(p)).not.toMatch(/SENHAGERENCIAL|SENHAALTRES|TOKEN/);
  });

  it('orçamento com o total e as parcelas; convertido, lança os mesmos exames no atendimento', async () => {
    const s = await entrar('SINT.RECEPCAO.SADT');
    const lista = (await get(s, '/sadt/orcamentos')).json();
    const o = lista.itens[0];
    expect(o.total).toBe(72);
    // A lista traz nomes e exames de pacientes: deixa a trilha de leitura.
    expect(trilha.eventos.at(-1)?.tabelaAlvo).toBe('orcamento_particular');
    const novo = await post(s, '/sadt/orcamentos', {
      nome: 'Paciente particular dois',
      convenio: 1,
      ato: 15,
      itens: [{ exame: 'NA', valor: 18.5 }],
    });
    expect(novo.statusCode).toBe(200);
    expect(
      (await post(s, '/sadt/orcamentos', { nome: 'X', convenio: 1, ato: 15, itens: [] })).statusCode,
    ).toBe(400);
  });
});

describe('portal de resultados', () => {
  it('paciente: protocolo e nascimento, limite de tentativas, só os liberados dele e a visualização gravada', async () => {
    const r = await entrar('SINT.RECEPCAO.SADT');
    const p = await post(r, '/sadt/requisicoes/31338/protocolo');
    expect(p.statusCode).toBe(200);
    const protocolo = p.json().protocolo as string;
    const errado = await app.inject({
      method: 'POST',
      url: '/api/portal/aa/paciente',
      payload: { protocolo, nascimento: '2000-01-01' },
    });
    expect(errado.json()).toMatchObject({ status: 401 });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/portal/aa/paciente',
      payload: { protocolo, nascimento: '1990-07-01' },
    });
    expect(ok.statusCode).toBe(200);
    const set = ok.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_portal_csrf='))
        ?.split(';')[0]
        ?.slice(16) ?? '';
    const laudos = await app.inject({ method: 'GET', url: '/api/portal/laudos', headers: { cookie } });
    expect(laudos.statusCode).toBe(200);
    const lista = laudos.json().laudos as {
      liberacao: number;
      visualizado: boolean;
      paciente: string | null;
    }[];
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((l) => l.paciente === null)).toBe(true);
    // Sem o CSRF do portal, a abertura (que grava a visualização) é recusada.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/portal/laudos/${lista[0]!.liberacao}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    const aberto = await app.inject({
      method: 'POST',
      url: `/api/portal/laudos/${lista[0]!.liberacao}`,
      headers: { cookie, 'x-csrf-portal': csrf },
      payload: {},
    });
    expect(aberto.statusCode).toBe(200);
    expect(aberto.json().laudo.visualizado).toBe(true);
    // A sessão do portal não vale nas telas internas.
    expect([401, 403]).toContain(
      (await app.inject({ method: 'GET', url: '/api/sadt/exames', headers: { cookie } })).statusCode,
    );
    // Limite de tentativas: 5 erradas bloqueiam o protocolo por alguns minutos.
    let ultimo = 0;
    for (let i = 0; i < 6; i++)
      ultimo = (
        await app.inject({
          method: 'POST',
          url: '/api/portal/aa/paciente',
          payload: { protocolo, nascimento: '2001-01-01' },
        })
      ).statusCode;
    expect(ultimo).toBe(429);
  });

  it('médico externo: autocadastro pendente, aprovação interna, entrada com o segundo fator e só os pedidos dele', async () => {
    // Outra origem (o limite de taxa é por origem: o teste do paciente esgotou o da origem padrão).
    const remoteAddress = '10.26.0.2';
    const cad = await app.inject({
      remoteAddress,
      method: 'POST',
      url: '/api/portal/aa/autocadastro',
      payload: {
        nome: 'Medica solicitante externa',
        conselho: 'CRM',
        uf: 'SP',
        numero: '12345',
        cpf: '12345678909',
        email: 'medica@exemplo.invalid',
        senha: 'senha-longa-sintetica',
        aceiteTermo: true,
      },
    });
    expect(cad.statusCode).toBe(200);
    const segredo = new URL(cad.json().otpauth).searchParams.get('secret')!;
    const entrarMedico = () =>
      app.inject({
        remoteAddress,
        method: 'POST',
        url: '/api/portal/aa/medico',
        payload: {
          conselho: 'CRM',
          uf: 'SP',
          numero: '12345',
          senha: 'senha-longa-sintetica',
          codigo: codigoTotp(segredo, Date.now()),
        },
      });
    // Com a senha certa, a situação aparece ("em análise"); com a senha errada, a mesma resposta de quem não tem
    // cadastro (conselho, UF e número são públicos: a resposta não revela que o médico pediu acesso).
    const pend = await entrarMedico();
    expect(pend.statusCode).toBe(401);
    expect(pend.json().title).toBe('Cadastro em análise');
    const errada = await app.inject({
      remoteAddress,
      method: 'POST',
      url: '/api/portal/aa/medico',
      payload: {
        conselho: 'CRM',
        uf: 'SP',
        numero: '12345',
        senha: 'outra-senha-sintetica',
        codigo: '000000',
      },
    });
    expect(errada.statusCode).toBe(401);
    expect(errada.json().title).toBe('Dados de acesso inválidos');
    const r = await entrar('SINT.RECEPCAO.SADT');
    const pendente = (await get(r, '/sadt/solicitantes/autocadastro'))
      .json()
      .find((a: { numero: string }) => a.numero === '12345');
    expect(pendente.situacao).toBe('pendente');
    expect(pendente.candidatos[0].id).toBe(6601);
    // A aprovação ligada a outro solicitante (outro número de conselho) é recusada no servidor.
    const outro = await post(r, `/sadt/solicitantes/autocadastro/${pendente.id}`, {
      decisao: 'aprovar',
      solicitante: 6602,
    });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('solicitante-divergente');
    expect(
      (
        await post(r, `/sadt/solicitantes/autocadastro/${pendente.id}`, {
          decisao: 'aprovar',
          solicitante: 6601,
        })
      ).statusCode,
    ).toBe(200);
    const ok = await entrarMedico();
    expect(ok.statusCode).toBe(200);
    const cookie = (ok.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const laudos = (
      await app.inject({ method: 'GET', url: '/api/portal/laudos', headers: { cookie } })
    ).json().laudos as {
      paciente: string | null;
    }[];
    expect(laudos.length).toBeGreaterThan(0);
    expect(laudos.every((l) => (l.paciente ?? '').includes('CINTHYA'))).toBe(true);
  });
});
