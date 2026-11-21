// M15, regras da revisão (dados SINTÉTICOS, portas em memória; nada conecta a banco):
//   - a chave de liberação `pep.prontuario.consulta` (ficha, seção 12): desligada (recolher), 403
//     `recurso-desligado` com o motivo em todas as rotas do prontuário; ligada, abre;
//   - alertas ao Auditor contados em qualquer rota de leitura (quem vai direto ao registro também conta);
//   - o alerta aparece no registro de acesso (e no filtro "só alertas");
//   - o relatório agregado das exceções (regra 9): só contagens, "<5" abaixo de 5, nenhum paciente;
//   - o texto formatado ilegível vira aviso (regra 9);
//   - CPF das respostas (pergunta do tipo CPF) e dos campos do formulário mascarado sem a permissão de ver
//     documentos (D-DOC-1);
//   - a restrição por vínculo do parâmetro do estabelecimento (regra 11): sem vínculo, 403 `sem-vinculo`
//     (quebra de vidro quando o perfil pode pedi-la); com vínculo ou emergência vigente, abre.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type CampoFormulario, contagemAgregada, type ItemResposta, tipoDoProblema } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { ocultarDocumentosDasRespostas, ocultarDocumentosDosCampos, TETO_RTF } from '@sgh/dominio-pep';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { chavesIniciaisSinteticas, fonteConfiguracaoMemoria } from '../config/public-api.js';
import type { PortaProntuario } from './porta.js';
import { PortaProntuarioMemoria } from './porta-memoria.js';
import { ProntuarioController } from './prontuario.controller.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { ServicoProntuario } from './servico.js';
import { criarAppPep } from './teste.spec-util.js';
import type { RegistroProntuarioLido } from './tipos-pep.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let idem = 0;

beforeAll(async () => {
  app = await criarAppPep(env, {
    trilha,
    comConfig: true,
    cadastro: new PortaCadastroMemoria(),
    prontuario: new PortaProntuarioMemoria(trilha),
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
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
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
const enviar = (s: Sessao, method: 'POST' | 'PUT', url: string, payload: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m15-${++idem}-${Date.now()}` },
    payload: payload as Record<string, unknown>,
  });
const motivo = (s: Sessao, paciente: number) =>
  enviar(s, 'POST', `/api/pep/prontuario/${paciente}/motivo`, { motivo: 'assistencia' });

describe('chave de liberação do prontuário ao vivo (ficha, seção 12)', () => {
  it('ligada na sessão sintética; recolher (desligar) fecha todas as rotas com o motivo; religar abre', async () => {
    const medico = await entrar('SINT.MEDICO');
    expect((await get(medico, '/api/pep/liberacao')).json()).toEqual({ ligada: true, motivo: null });
    expect((await motivo(medico, 1003)).statusCode).toBe(200);
    expect((await get(medico, '/api/pep/prontuario/1003')).statusCode).toBe(200);

    const admin = await entrar('SINT.ADMIN');
    const pedido = {
      chave: 'pep.prontuario.consulta',
      tipo: 'recurso',
      escopo: 'hospital',
      valores: ['*'],
      ligar: false,
      justificativa: 'recolher sintético de teste',
      senha: SENHA,
    };
    const painel = (await get(admin, '/api/administracao/liberacao')).json();
    expect(
      painel.funcionalidades.find((f: { chave: string }) => f.chave === 'pep.prontuario.consulta'),
    ).toMatchObject({ tipo: 'recurso', marco: 'M15', ligadaNoEstabelecimento: true });
    expect((await enviar(admin, 'POST', '/api/administracao/liberacao', pedido)).statusCode).toBe(200);

    const l = (await get(medico, '/api/pep/liberacao')).json();
    expect(l.ligada).toBe(false);
    expect(l.motivo).toMatch(/ainda não foi liberado/);
    expect(l.motivo).not.toMatch(/SPDATA|legado|sistema atual/i);
    for (const url of [
      '/api/pep/pacientes?termo=cinthya',
      '/api/pep/prontuario/1003/motivo',
      '/api/pep/prontuario/1003',
      '/api/pep/prontuario/1003/registros/900001',
      '/api/pep/prontuario/1003/registros/900001/texto',
      '/api/pep/prontuario/1003/busca?termo=toracica',
      '/api/pep/excecoes',
    ]) {
      const r = await get(medico, url);
      expect(r.statusCode, url).toBe(403);
      expect(tipoDoProblema(r.json()), url).toBe('recurso-desligado');
    }
    expect((await motivo(medico, 1003)).statusCode).toBe(403);

    expect(
      (await enviar(admin, 'POST', '/api/administracao/liberacao', { ...pedido, ligar: true })).statusCode,
    ).toBe(200);
    expect((await get(medico, '/api/pep/prontuario/1003')).statusCode).toBe(200);
  });
});

describe('alertas ao Auditor e registro de acesso', () => {
  it('quem vai direto ao registro também conta: 3 pacientes sem a lista disparam "muitos prontuários"', async () => {
    const admin = await entrar('SINT.ADMIN');
    const def = await enviar(admin, 'PUT', '/api/administracao/parametros/pep.alertaMaxPacientes', {
      nivel: 'estabelecimento',
      alvo: 'aa',
      valor: '2',
      justificativa: 'limite sintético de teste',
    });
    expect(def.statusCode).toBe(200);
    const enf = await entrar('SINT.MEDICO');
    const antes = trilha.eventos.length;
    for (const p of [1001, 1002, 1004]) {
      expect((await motivo(enf, p)).statusCode).toBe(200);
      // Direto ao registro (sem a lista): conta para o alerta, mesmo que o registro não seja deste paciente.
      await get(enf, `/api/pep/prontuario/${p}/registros/900011/respostas`);
    }
    const alertas = trilha.eventos
      .slice(antes)
      .filter(
        (e) =>
          e.evento === 'auditoria.leitura.alertada' && /muitos-prontuarios/.test(e.chaveNaturalAlvo ?? ''),
      );
    // O alerta sai uma vez, ao cruzar o limite, num paciente que só foi aberto pelo registro.
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ usuario: 'SINT.MEDICO' });
    expect([1001, 1002, 1004]).toContain(alertas[0]!.paciente);

    const auditor = await entrar('SINT.AUDITOR');
    const r = (
      await get(auditor, '/api/administracao/auditoria/acessos-prontuario?soAlertas=sim&usuario=SINT.MEDICO')
    ).json();
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.itens.every((a: { parte: string; alerta: unknown }) => a.parte === 'alerta' && a.alerta)).toBe(
      true,
    );
    expect(r.itens.map((a: { alerta: { tipo: string } }) => a.alerta.tipo)).toContain('muitos-prontuarios');
    const todos = (
      await get(auditor, '/api/administracao/auditoria/acessos-prontuario?usuario=SINT.MEDICO')
    ).json();
    expect(todos.itens.some((a: { alerta: unknown }) => a.alerta === null)).toBe(true);
    expect(todos.itens.some((a: { alerta: unknown }) => a.alerta !== null)).toBe(true);
  });
});

describe('exceções do prontuário (regra 9)', () => {
  it('só contagens por tipo, modelo e mês; "<5" abaixo de 5; na trilha sem paciente', async () => {
    const medico = await entrar('SINT.MEDICO');
    const r = await get(medico, '/api/pep/excecoes');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.estabelecimento).toBe('aa');
    expect(b.linhas).toEqual([
      {
        tipo: 'sem-conteudo',
        modelo: { id: 62, codigo: 'ENF091', nome: expect.any(String) },
        mes: '2022-08',
        registros: '<5',
      },
    ]);
    expect(b.totais).toEqual({ 'sem-conteudo': '<5', 'data-impossivel': 0 });
    expect(JSON.stringify(b)).not.toMatch(/1003|CINTHYA|paciente/i);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'pep.excecoes.consultadas' });
    expect(trilha.eventos.at(-1)?.paciente).toBeUndefined();
    expect([0, 1, 4, 5, 12].map(contagemAgregada)).toEqual([0, '<5', '<5', 5, 12]);
  });
});

// ── Serviço e regras sem HTTP ────────────────────────────────────────────────────────────────────

const REGISTRO: RegistroProntuarioLido = {
  id: 1,
  idHtPaciente: 1,
  idHtAtendimento: null,
  dataHora: '2024-01-01T10:00:00.000',
  lancadoEm: '2024-01-01T10:00:00.000',
  modelo: 61,
  modeloCodigo: 'EVAM',
  modeloNome: 'Evolução',
  registroProfissional: null,
  profissional: null,
  profissionalNome: null,
  cbo: null,
  suspensoEm: null,
  justificativaSuspensao: null,
  corrigeRegistro: null,
  justificativaRetroativo: null,
  supervisor: null,
};

describe('texto formatado ilegível (regra 9)', () => {
  it('vira aviso na aba, não "sem texto"', async () => {
    const porta = {
      destino: 'memoria',
      registro: async () => ({
        registro: REGISTRO,
        fontes: { temConteudo: true, temXml: false, temDocumento: false, situacoes: [], tiposDocumento: [] },
      }),
      conteudo: async () => ({ rtf: `{\\rtf1 ${'x'.repeat(TETO_RTF + 1)}}`, xml: null, bytes: 0 }),
    } as unknown as PortaProntuario;
    const s = new ServicoProntuario(porta, new PortaCadastroMemoria());
    const a = await s.aba({ cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 'teste', rede: 'r', hospital: 'aa' }, 1, 1, 'texto', { mostrarDocumentos: true });
    expect(a.aba).toBe('texto');
    if (a.aba !== 'texto') return;
    expect(a.conteudo.paragrafos).toEqual([]);
    expect(a.conteudo.aviso).toMatch(/ilegível|não pôde ser lido/i);
  });
});

describe('documentos pessoais no registro (D-DOC-1)', () => {
  const item = (tipo: string, titulo: string, valores: string[]): ItemResposta => ({
    ordem: '01',
    titulo,
    tipo,
    valores,
    grade: null,
    autopreenchido: false,
    aConfirmar: null,
    itens: [],
  });
  const campo = (titulo: string, texto: string): CampoFormulario => ({
    nome: 'cmp',
    classe: 'TfRespEdit',
    titulo,
    secao: false,
    valor: { tipo: 'texto', texto },
    topo: 0,
    esquerda: 0,
    colunas: 12,
    autopreenchido: false,
    naoMapeado: false,
  });
  it('a pergunta do tipo CPF e os campos de documento saem mascarados; o resto, inteiro', () => {
    const r = ocultarDocumentosDasRespostas([
      item('CPF', 'CPF do acompanhante', ['00000000191']),
      item('Texto', 'Observação', ['Paciente estável; responsável 000.000.001-91']),
      item('Número', 'PA sistólica', ['120']),
    ]);
    expect(r.map((x) => x.valores[0])).toEqual([
      '***.***.001-91',
      'Paciente estável; responsável ***.***.001-91',
      '120',
    ]);
    const c = ocultarDocumentosDosCampos([
      campo('CPF', '00000000191'),
      campo('Cartão Nacional de Saúde', '898000000000007'),
      campo('Queixa principal', 'Dor torácica'),
    ]);
    expect(c.map((x) => (x.valor.tipo === 'texto' ? x.valor.texto : ''))).toEqual([
      '***.***.001-91',
      '***********0007',
      'Dor torácica',
    ]);
  });

  it('pela API: o médico sem a permissão não vê o CPF inteiro nas respostas nem no formulário', async () => {
    const porta = new PortaProntuarioMemoria();
    const base = porta as unknown as {
      respostas: PortaProntuario['respostas'];
      conteudo: PortaProntuario['conteudo'];
    };
    const respostasOriginais = base.respostas.bind(porta);
    const conteudoOriginal = base.conteudo.bind(porta);
    const xmlCpf =
      '<evolucao id_evolucao="61"><componente><className>TfRespEdit</className><name>cpf</name><top>0</top><left>0</left><height>1</height><width>160</width><title>CPF</title><value>00000000191</value></componente></evolucao>';
    base.conteudo = async (c, id, partes) => {
      const x = await conteudoOriginal(c, id, partes);
      return x ? { ...x, xml: partes.xml ? xmlCpf : x.xml } : x;
    };
    base.respostas = respostasOriginais;
    const s = new ServicoProntuario(porta, new PortaCadastroMemoria());
    const c = { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 'teste', rede: 'r', hospital: 'aa' };
    const sem = await s.aba(c, 1003, 900_001, 'layout', { mostrarDocumentos: false });
    const com = await s.aba(c, 1003, 900_001, 'layout', { mostrarDocumentos: true });
    expect(JSON.stringify(sem)).not.toContain('00000000191');
    expect(JSON.stringify(sem)).toContain('***.***.001-91');
    expect(JSON.stringify(com)).toContain('00000000191');
  });
});

describe('restrição por vínculo do parâmetro do estabelecimento (regra 11)', () => {
  const montar = (restricao: boolean, permissoes: string[] = ['pep.prontuario.ler']) => {
    const t = new RegistradorTrilhaMemoria();
    const estado = new EstadoProntuario();
    const cadastro = new PortaCadastroMemoria();
    const servico = new ServicoProntuario(new PortaProntuarioMemoria(t), cadastro);
    const ctrl = new ProntuarioController(
      servico,
      estado,
      cadastro,
      t,
      null,
      fonteConfiguracaoMemoria(t, { chavesIniciais: chavesIniciaisSinteticas }),
      null,
      new VinculoSintetico([{ login: 'SINT.MEDICO', idPaciente: 1001, forma: 'equipe' }]),
      {
        abrir: () => Promise.reject(new Error('não usado')),
        vigente: async (_h, _l, p) => (p === 1004 ? { id: '1', fim: new Date(Date.now() + 60_000) } : null),
      },
    );
    const req = {
      headers: {},
      ip: '127.0.0.1',
      sgh: {
        real: true,
        permissao: 'pep.prontuario.ler',
        ability: criarAbility(regrasDeAcesso(permissoes, null)),
        sessao: {
          usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
          rede: 'rede-teste',
          estabelecimentos: [],
          estabelecimentoAtivo: 'aa',
          unidadeAtiva: null,
          permissoes,
          restricaoVinculo: restricao,
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
          expiraEm: '',
        },
      },
    } as unknown as RequisicaoAutorizada;
    return { ctrl, req, t };
  };
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as ErroProblema;
    }
    return null;
  };

  it('ligado: sem vínculo, 403 sem-vinculo (o motivo e a leitura); a tentativa vai à trilha', async () => {
    const { ctrl, req, t } = montar(true);
    const e = await erro(ctrl.informarMotivo('1003', { motivo: 'assistencia' }, req));
    expect(e).toBeInstanceOf(ErroProblema);
    expect(e).toMatchObject({ tipo: 'sem-vinculo', extras: { quebraDeVidro: false } });
    expect(t.eventos.at(-1)).toMatchObject({ evento: 'acesso.permissao.negada', paciente: 1003 });
    const lista = await erro(ctrl.lista('1003', {}, req));
    expect(lista).toMatchObject({ tipo: 'motivo-necessario' });
  });

  it('ligado: o perfil que pode pedir a quebra de vidro recebe a oferta', async () => {
    const { ctrl, req } = montar(true, ['pep.prontuario.ler', 'acesso.emergencia.solicitar']);
    const e = await erro(ctrl.informarMotivo('1003', { motivo: 'assistencia' }, req));
    expect(e).toMatchObject({ tipo: 'sem-vinculo', extras: { quebraDeVidro: true } });
  });

  it('ligado: com vínculo ou com a emergência vigente, abre', async () => {
    const { ctrl, req } = montar(true);
    await ctrl.informarMotivo('1001', { motivo: 'assistencia' }, req);
    expect((await ctrl.lista('1001', {}, req)).cabecalho.paciente).toBe(1001);
    await ctrl.informarMotivo('1004', { motivo: 'assistencia' }, req);
    expect((await ctrl.lista('1004', {}, req)).cabecalho.paciente).toBe(1004);
  });

  it('desligado (como no pc): abre sem vínculo', async () => {
    const { ctrl, req } = montar(false);
    await ctrl.informarMotivo('1003', { motivo: 'assistencia' }, req);
    expect((await ctrl.lista('1003', {}, req)).cabecalho.paciente).toBe(1003);
  });
});
