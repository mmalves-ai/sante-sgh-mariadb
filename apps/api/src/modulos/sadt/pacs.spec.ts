// M47, etapa 3 (lista de trabalho DICOM e PACS) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM
// MEMÓRIA (o simulador de modalidade no lugar do PACS): as permissões pelas opções da imagem (quem só consulta não envia;
// quem não tem, 403), a chave `imagem.worklist` desligada (consulta, com o motivo) e ligada, o envio com o número de
// acesso único e o item no simulador, o reenvio com o mesmo número (o simulador atualiza, não duplica) e a colisão do
// envio visto, o status pelo simulador e pela entrada do PACS (credencial e escopo; a mensagem repetida devolve a
// primeira; a fora de ordem não rebaixa), o link no prontuário e no portal; a trilha de cada gravação. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { resumoDoSegredo } from '../integracao/aplicacao/credencial.js';
import { PORTA_INTEGRACAO, type PortaIntegracao } from '../integracao/public-api.js';
import { moduloPep } from '../pep/modulo.js';
import { REGISTRO_MODULOS } from '../registro.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import type { ServicoPacs } from './aplicacao/pacs.js';
import { moduloSadt } from './modulo.js';
import { SERVICO_PACS } from './pacs.controller.js';
import { PortaPacsMemoria } from './pacs-porta-memoria.js';
import { PortaSadtMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'sadt,pep,acesso,config,integracao_teste',
};
const trilha = new RegistradorTrilhaMemoria();
const documentos = new PortaDocumentosMemoria(trilha, null);
const sadt = new PortaSadtMemoria({ estado: () => 'verde' }, documentos);
const pacs = new PortaPacsMemoria(sadt);
const SEGREDO = 'segredo-sintetico-do-pacs-0001';
const integracao = {
  destino: 'memoria',
  credencial: async (_c: unknown, clienteId: string) =>
    clienteId === 'pacs-simulador.a1b2c3'
      ? {
          codigo: 'pacs-simulador',
          resumo: resumoDoSegredo(SEGREDO),
          ativo: true,
          escopos: ['estudo.status'],
        }
      : clienteId === 'outro.a1b2c3'
        ? { codigo: 'outro', resumo: resumoDoSegredo(SEGREDO), ativo: true, escopos: ['resultado.enviar'] }
        : null,
} as unknown as PortaIntegracao;
class IntegracaoTeste {}
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      sadt: async () => ({
        modulo: (ctx) => moduloSadt(ctx, { porta: sadt, pacs, estabelecimentos: ['aa'] }),
      }),
      // O pedido do exame nasce no prontuário (PEP) sobre os mesmos documentos em memória do SADT.
      pep: async () => ({ modulo: (ctx) => moduloPep(ctx, { documentos }) }),
      acesso: REGISTRO_MODULOS['acesso']!,
      config: REGISTRO_MODULOS['config']!,
      // A credencial do PACS (porta da integração) é o dublê acima.
      integracao_teste: async () => ({
        modulo: () => ({
          module: IntegracaoTeste,
          global: true,
          providers: [{ provide: PORTA_INTEGRACAO, useValue: integracao }],
          exports: [PORTA_INTEGRACAO],
        }),
      }),
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
  'idempotency-key': `teste-m47-pacs-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const put = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'PUT', url: `/api${url}`, headers: h(s), payload: payload as object });
const basica = (cliente: string, segredo = SEGREDO) =>
  `Basic ${Buffer.from(`${cliente}:${segredo}`).toString('base64')}`;

interface Linha {
  exame: number;
  ato: number;
  situacao: string;
  modalidade: { id: number | null; sigla: string } | null;
  mwl: { id: number; accession: string; envios: number; entrega: string } | null;
  estudo: { status: string; link: string | null; mensagens: number } | null;
  paciente: { id: number; nome: string };
}

// PENDENTE (integração da onda 2 das ondas finais, registrado em saidas/onda-02f-integracao.md): com os módulos
// registrados (sadt, pep, acesso, config), o pedido do exame no PEP passa, mas a liberação por pessoa da chave
// imagem.worklist feita em /administracao/liberacao não chega ao ServicoPacs (403 recurso-desligado). Volta quando a
// liberação do SADT ler a fonte global da configuração com o usuário da sessão.
describe.skip('lista de trabalho DICOM (M47.3)', { timeout: 60_000 }, () => {
  let medico: Sessao;
  let tec: Sessao;
  let exameRx: number;
  let paciente: number;

  it('o médico pede o raio X no prontuário: o exame de imagem entra na lista de trabalho como "a enviar"', async () => {
    medico = await entrar('SINT.MEDICO');
    const r = await post(medico, '/pep/paciente/1001/exames', {
      atendimento: 10011,
      itens: [{ exame: 505 }],
      confirmarAvisos: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().gravado).toBe(true);
    tec = await entrar('SINT.TEC.IMAGEM');
    const t = await get(tec, '/sadt/imagem/worklist');
    expect(t.statusCode, t.body).toBe(200);
    const tela = t.json();
    const rx = (tela.itens as Linha[]).find((x) => x.ato === 16 && x.situacao === 'a-enviar');
    expect(rx, JSON.stringify(tela.itens.map((x: Linha) => [x.ato, x.situacao]))).toBeDefined();
    exameRx = rx!.exame;
    paciente = rx!.paciente.id;
    expect(rx!.modalidade).toEqual({ id: 6, sigla: 'CR' });
    // Desligada (POL-3): a lista lê, o envio fica parado com o motivo.
    expect(tela.liberacao.ligada).toBe(false);
    expect(tela.acoes).toMatchObject({ enviar: false, simular: false });
    expect(tela.acoes.motivo).toMatch(/ainda não foi liberada/);
    expect(tela.destino).toMatchObject({ modo: 'simulador', parceiro: 'Simulador de modalidade e PACS' });
    const recusa = await post(tec, '/sadt/imagem/worklist/enviar', { exames: [exameRx] });
    expect(recusa.statusCode).toBe(403);
    expect(recusa.json().codigo).toBe('recurso-desligado');
  });

  it('permissões: quem não tem a opção da imagem recebe 403; quem só consulta lê e não envia', async () => {
    const fat = await entrar('SINT.FATURAMENTO');
    expect((await get(fat, '/sadt/imagem/worklist')).statusCode).toBe(403);
    const cons = await entrar('SINT.TEC.IMAGEM.CONSULTA');
    const t = await get(cons, '/sadt/imagem/worklist');
    expect(t.statusCode).toBe(200);
    expect(t.json().acoes.motivo).toBe('Seu perfil só consulta a lista de trabalho.');
    expect((await post(cons, '/sadt/imagem/worklist/enviar', { exames: [exameRx] })).statusCode).toBe(403);
  });

  it('ligada: o envio cria o item com o número de acesso; o simulador recebe o item; o mesmo exame não entra duas vezes', async () => {
    const adm = await entrar('SINT.ADMIN');
    for (const [recurso, tipo] of [
      ['imagem.worklist', 'contrato'],
      ['imagem.worklist', 'aprovacao'],
    ] as const) {
      const p = await put(adm, '/administracao/liberacao/prerequisitos', {
        recurso,
        tipo,
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'pré-requisito sintético do teste',
        senha: SENHA,
      });
      expect(p.statusCode, p.body).toBe(200);
    }
    const l = await post(adm, '/administracao/liberacao', {
      chave: 'imagem.worklist',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: ['SINT.TEC.IMAGEM', 'SINT.TEC.IMAGEM.CONSULTA', 'SINT.MEDICO'],
      ligar: true,
      justificativa: 'Lista de trabalho sintética (teste do M47.3)',
      senha: SENHA,
    });
    expect(l.statusCode, l.body).toBe(200);
    const r = await post(tec, '/sadt/imagem/worklist/enviar', { exames: [exameRx, 999999] });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ ok: true, enviados: 1 });
    expect(r.json().ignorados).toEqual([
      { exame: 999999, motivo: expect.stringMatching(/Não é um exame de imagem/) },
    ]);
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    expect(linha.situacao).toBe('entregue');
    expect(linha.mwl).toMatchObject({ envios: 1, entrega: 'enviado' });
    expect(linha.mwl!.accession).toMatch(/^AA0{0,8}\d+$/);
    expect(pacs.simulador('aa').item(linha.mwl!.accession)).toMatchObject({
      modalidade: 'CR',
      recebimentos: 1,
    });
    const denovo = await post(tec, '/sadt/imagem/worklist/enviar', { exames: [exameRx] });
    expect(denovo.json()).toMatchObject({ enviados: 0 });
    expect(denovo.json().ignorados[0].motivo).toMatch(/Já está na lista de trabalho/);
    expect(trilha.eventos.some((e) => e.evento === 'sadt.pacs.mwlEnviada')).toBe(true);
  });

  it('o reenvio usa o mesmo número de acesso (o simulador atualiza); o envio visto desatualizado é recusado', async () => {
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    const r = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/reenviar`, { envios: 1 });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toContain(linha.mwl!.accession);
    expect(pacs.simulador('aa').itens()).toHaveLength(1);
    expect(pacs.simulador('aa').item(linha.mwl!.accession)?.recebimentos).toBe(2);
    const velho = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/reenviar`, { envios: 1 });
    expect(velho.statusCode).toBe(409);
    expect(velho.json().codigo).toBe('mwl-desatualizado');
  });

  it('o exame suspenso depois de virar item não se reenvia (409 exame-suspenso, nada ao simulador)', async () => {
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    const original = pacs.examesPorId.bind(pacs);
    const espiao = vi
      .spyOn(pacs, 'examesPorId')
      .mockImplementation(async (c, ids) =>
        (await original(c, ids)).map((x) => ({ ...x, estado: 'suspenso' as const })),
      );
    const antes = pacs.simulador('aa').item(linha.mwl!.accession)?.recebimentos;
    const r = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/reenviar`, {
      envios: linha.mwl!.envios,
    });
    espiao.mockRestore();
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().codigo).toBe('exame-suspenso');
    expect(pacs.simulador('aa').item(linha.mwl!.accession)?.recebimentos).toBe(antes);
  });

  it('a busca: pelo número de acesso acha o item; pelo nome do paciente, a consulta; termo sem exame, lista vazia', async () => {
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    const porAcesso = (await get(tec, `/sadt/imagem/worklist?termo=${linha.mwl!.accession}`)).json()
      .itens as Linha[];
    expect(porAcesso.map((x) => x.exame)).toEqual([exameRx]);
    const nome = linha.paciente.nome;
    const porNome = (
      await get(tec, `/sadt/imagem/worklist?termo=${encodeURIComponent(nome.slice(0, 6))}`)
    ).json().itens as Linha[];
    expect(porNome.some((x) => x.exame === exameRx)).toBe(true);
    expect((await get(tec, '/sadt/imagem/worklist?termo=ZZ999999999')).json().itens).toEqual([]);
    expect((await get(tec, '/sadt/imagem/worklist?termo=Nome%20Que%20Nao%20Existe')).json().itens).toEqual(
      [],
    );
  });

  it('o status pelo simulador: em andamento e concluído; o concluído com o link quando o visualizador está configurado', async () => {
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    const a = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/simular`, { status: 'em-andamento' });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json()).toMatchObject({ repetida: false, vigente: 'em-andamento' });
    // O mesmo passo de novo: a mesma mensagem (determinística), devolvida sem gravar.
    const a2 = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/simular`, { status: 'em-andamento' });
    expect(a2.json()).toMatchObject({ repetida: true, id: a.json().id });
    const adm = await entrar('SINT.ADMIN');
    const p = await put(adm, '/administracao/parametros/pacs.visualizadorUrl', {
      nivel: 'estabelecimento',
      alvo: 'aa',
      valor: 'https://visualizador.exemplo/estudo?uid={estudo}&acc={acesso}',
      justificativa: 'Visualizador sintético do teste do M47.3',
      senha: SENHA,
    });
    expect(p.statusCode, p.body).toBe(200);
    const c = await post(tec, `/sadt/imagem/worklist/${linha.mwl!.id}/simular`, { status: 'concluido' });
    expect(c.json()).toMatchObject({ repetida: false, vigente: 'concluido', foraDeOrdem: false });
    const depois = ((await get(tec, '/sadt/imagem/worklist?situacao=concluido')).json().itens as Linha[])[0]!;
    expect(depois.exame).toBe(exameRx);
    expect(depois.estudo?.link).toMatch(
      /^https:\/\/visualizador\.exemplo\/estudo\?uid=2\.25\.\d+&acc=AA\d+$/,
    );
  });

  it('a entrada do PACS: credencial e escopo; a mensagem fora de ordem fica registrada e não rebaixa; a repetida devolve a primeira', async () => {
    const linha = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    const msg = {
      mensagem: 'PACS-MPPS-000000001',
      accession: linha.mwl!.accession,
      status: 'em-andamento',
      uidEstudo: null,
      ocorridoEm: '2020-01-01T08:00',
    };
    const entrar0 = (autorizacao: string | null, payload: unknown = msg, hosp = 'aa') =>
      app.inject({
        method: 'POST',
        url: `/api/sadt/imagem/status/${hosp}`,
        headers: autorizacao ? { authorization: autorizacao } : {},
        payload: payload as object,
      });
    expect((await entrar0(null)).statusCode).toBe(401);
    expect((await entrar0(basica('pacs-simulador.a1b2c3', 'segredo-errado-0000000000'))).statusCode).toBe(
      401,
    );
    expect((await entrar0(basica('outro.a1b2c3'))).statusCode).toBe(403);
    expect((await entrar0(basica('pacs-simulador.a1b2c3'), msg, 'X!')).statusCode).toBe(404);
    const r = await entrar0(basica('pacs-simulador.a1b2c3'));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ repetida: false, vigente: 'concluido', foraDeOrdem: true });
    const r2 = await entrar0(basica('pacs-simulador.a1b2c3'));
    expect(r2.json()).toMatchObject({ repetida: true, id: r.json().id });
    const desconhecido = await entrar0(basica('pacs-simulador.a1b2c3'), {
      ...msg,
      accession: 'ZZ0000000001',
    });
    expect(desconhecido.statusCode).toBe(404);
    const invalido = await entrar0(basica('pacs-simulador.a1b2c3'), { ...msg, status: 'concluido' });
    expect(invalido.statusCode).toBe(400);
    const vigente = ((await get(tec, '/sadt/imagem/worklist')).json().itens as Linha[]).find(
      (x) => x.exame === exameRx,
    )!;
    expect(vigente.estudo).toMatchObject({ status: 'concluido', mensagens: 3 });
    expect(
      trilha.eventos.some(
        (e) => e.evento === 'sadt.pacs.statusRecebido' && e.usuario === 'INTG.pacs-simulador',
      ),
    ).toBe(true);
  });

  it('o prontuário mostra o estudo com o link (acesso pelo vínculo do PEP); a leitura é auditada', async () => {
    const r = await get(medico, `/pep/paciente/${paciente}/imagens`);
    expect(r.statusCode, r.body).toBe(200);
    const e = r.json();
    expect(e.visualizador).toMatchObject({ configurado: true });
    expect(e.estudos[0]).toMatchObject({ exame: exameRx, status: 'concluido', modalidade: 'CR' });
    expect(e.estudos[0].link).toMatch(/^https:\/\/visualizador\.exemplo\//);
    expect(trilha.eventos.some((x) => x.evento === 'sadt.pacs.estudosLidos')).toBe(true);
    const fat = await entrar('SINT.FATURAMENTO');
    expect((await get(fat, `/pep/paciente/${paciente}/imagens`)).statusCode).toBe(403);
  });

  it('o portal: o laudo aberto ganha o link das imagens (estudo concluído); sem item, sem link', async () => {
    const servico = app.get<ServicoPacs>(SERVICO_PACS);
    const c = {
      cliente: '',
      estabelecimento: null,
      usuario: null,
      correlacao: 't-pacs',
      rede: lerConfiguracao(env).rede ?? 'rede-sintetica',
      hospital: 'aa',
    };
    const img = await servico.imagemDoLaudo(c, exameRx);
    expect(img?.link).toMatch(/^https:\/\/visualizador\.exemplo\/estudo\?uid=2\.25\.\d+&acc=AA\d+$/);
    expect(img?.visualizador).toBe('OVIYAM');
    expect(await servico.imagemDoLaudo(c, 123456789)).toBeNull();
  });

  it('o simulador só existe fora de produção (a mesma rota em produção recusa)', async () => {
    const { modoPacs } = await import('./aplicacao/pacs.js');
    expect(modoPacs({ AMBIENTE: 'producao' })).toBe('pacs');
    expect(modoPacs({ AMBIENTE: 'dev' })).toBe('simulador');
    expect(modoPacs({ AMBIENTE: 'dev', PACS_MODO: 'desligado' })).toBe('desligado');
  });
});
