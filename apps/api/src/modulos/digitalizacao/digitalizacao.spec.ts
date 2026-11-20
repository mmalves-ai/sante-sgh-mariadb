// M50, etapa 6 (digitalização certificada) — duas partes, sem banco:
//   1. pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (relógio fixo): a captura com o
//      resumo recalculado no servidor (o arquivo corrompido, o repetido, a resolução baixa, as páginas divergentes, a
//      internação de outro prontuário e o lote inexistente recusados), o arquivo devolvido conferido pelo resumo, a fila
//      com as contagens, a conferência por outra pessoa (fiel e recusado com o motivo) e as permissões de cada perfil;
//   2. a assinatura de quem conferiu pelo serviço do M49 (simulador do provedor, da ACT e da LCR): o lote numa
//      autorização em nuvem, o A3 pelo agente local, quem não conferiu e o arquivo que mudou recusados, o CPF de outra
//      pessoa no provedor recusado sem assinar e a evidência da falha. Arquivos, certificados e CPF SINTÉTICOS.
import { createHash } from 'node:crypto';
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import { assinarHashRsa, CPF_SINTETICO_OUTRO, CPF_SINTETICO_SESSAO } from '@sgh/dominio-documento';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { type ConfigServicoAssinatura, ServicoAssinaturaIcp } from '../assinatura/aplicacao/servico.js';
import { configAssinaturaDoAmbiente } from '../assinatura/infra/ambiente.js';
import { ROTA_NAVEGADOR_SIMULADOR, type SimuladorIcp } from '../assinatura/infra/simulador.js';
import { PortaAssinaturaMemoria } from '../assinatura/porta-memoria.js';
import { ArmazemDigitalizacaoMemoria } from './armazem.js';
import { ServicoAssinaturaDigitalizacao } from './assinatura.js';
import { naoComo, semAcoesPessoais } from './digitalizacao.controller.js';
import { PortaDigitalizacaoMemoria } from './porta-memoria.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pdf = (paginas: number, marca: string) =>
  Buffer.from(
    `%PDF-1.7\n% ${marca}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ${paginas} >> endobj\n` +
      Array.from(
        { length: paginas },
        (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`,
      ).join('') +
      '%%EOF',
    'latin1',
  );
const PACIENTES: Record<number, { id: number; prontuario: number; nome: string; nomeSocial: string | null }> =
  {
    501: { id: 1001, prontuario: 501, nome: 'PACIENTE SINTETICO 1001', nomeSocial: null },
    503: { id: 1003, prontuario: 503, nome: 'PACIENTE SINTETICO 1003', nomeSocial: 'NOME SOCIAL SINTETICO' },
  };
const lerPaciente = async (_c: unknown, pront: number) => PACIENTES[pront] ?? null;
const relogio = () => new Date('2026-10-25T13:00:00Z');

describe('digitalização certificada pela HTTP (M50, etapa 6)', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  const trilha = new RegistradorTrilhaMemoria();
  const digitalizacao = new PortaDigitalizacaoMemoria(lerPaciente, relogio);
  const armazemDigitalizacao = new ArmazemDigitalizacaoMemoria();
  let app: NestFastifyApplication;
  let chave = 0;

  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      digitalizacao,
      armazemDigitalizacao,
      vigia: null,
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
  const h = (s: Sessao) => ({
    cookie: s.cookie,
    'x-csrf': s.csrf,
    'idempotency-key': `teste-m50-6d-${++chave}-${Date.now()}`,
  });
  const get = (s: Sessao, url: string) =>
    app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
  const post = (s: Sessao, url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
  const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

  const captura = (b: Buffer, o: Record<string, unknown> = {}) => ({
    prontuario: 501,
    internacao: null,
    tipoDocumento: 'evolucao',
    descricao: 'EVOLUCAO DE ENFERMAGEM SINTETICA',
    dataDocumento: '2019-04-02',
    paginas: 2,
    resolucaoDpi: 300,
    cor: 'cinza',
    lote: null,
    conteudo: b.toString('base64'),
    hashConteudo: sha(b),
    ...o,
  });

  let capt: Sessao;
  let conf: Sessao;
  let social: Sessao;
  beforeAll(async () => {
    capt = await entrar('SINT.SAME.CAPTURA');
    conf = await entrar('SINT.SAME.CONFERE');
    social = await entrar('SINT.SOCIAL');
  });

  it('a gravação: quem captura não confere; quem confere não captura; sem a opção, nada', async () => {
    expect((await get(capt, '/digitalizacao/gravacao')).json()).toMatchObject({
      ligada: true,
      login: 'SINT.SAME.CAPTURA',
      operacoes: { capturar: { pode: true }, conferir: { pode: false } },
    });
    expect((await get(conf, '/digitalizacao/gravacao')).json()).toMatchObject({
      operacoes: { capturar: { pode: false }, conferir: { pode: true }, assinar: { pode: true } },
    });
    expect((await get(social, '/digitalizacao/fila')).statusCode).toBe(403);
    expect((await post(conf, '/digitalizacao', captura(pdf(2, 'x')))).statusCode).toBe(403);
  });

  it('o prontuário para indexar: o paciente (nome social primeiro) e as internações', async () => {
    const r = await get(capt, '/digitalizacao/pacientes/503');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ prontuario: 503, paciente: 1003, nome: 'NOME SOCIAL SINTETICO' });
    expect(r.json().internacoes[0]).toMatchObject({ reg: 500_503 });
    expect((await get(capt, '/digitalizacao/pacientes/999')).statusCode).toBe(404);
  });

  let doc = 0;
  let lote = 0;
  it('a captura: o resumo recalculado; o arquivo guardado; as recusas', async () => {
    const b = pdf(2, 'primeiro');
    const r = await post(capt, '/digitalizacao', captura(b));
    expect(r.statusCode, r.body).toBe(201);
    doc = r.json().id;
    lote = r.json().lote;
    expect(r.json()).toMatchObject({ situacao: 'capturado' });
    expect(eventos(E.documentoDigitalizado.codigo)).toBe(1);
    // A chave é o resumo; a retenção da guarda legal só depois do COMMIT.
    const gravados = armazemDigitalizacao.gravacoes;
    expect(armazemDigitalizacao.fixadas.has(`aa/same/digitalizacao/${sha(b)}.pdf`)).toBe(true);
    const repetido = await post(capt, '/digitalizacao', captura(b));
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json()).toMatchObject({ codigo: 'ja-digitalizado' });
    // O arquivo repetido é recusado antes do armazenamento: nenhum objeto novo.
    expect(armazemDigitalizacao.gravacoes).toBe(gravados);
    const corrompido = await post(capt, '/digitalizacao', {
      ...captura(pdf(2, 'z')),
      hashConteudo: 'a'.repeat(64),
    });
    expect(corrompido.statusCode).toBe(400);
    expect(corrompido.json()).toMatchObject({ codigo: 'hash-divergente' });
    const baixa = await post(capt, '/digitalizacao', captura(pdf(2, 'baixa'), { resolucaoDpi: 200 }));
    expect(baixa.json()).toMatchObject({ codigo: 'resolucao-baixa' });
    const paginas = await post(capt, '/digitalizacao', captura(pdf(3, 'paginas')));
    expect(paginas.json()).toMatchObject({ codigo: 'paginas-divergentes' });
    const futuro = await post(
      capt,
      '/digitalizacao',
      captura(pdf(2, 'futuro'), { dataDocumento: '2026-10-26' }),
    );
    expect(futuro.json()).toMatchObject({ codigo: 'data-futura' });
    const outra = await post(capt, '/digitalizacao', captura(pdf(2, 'outra'), { internacao: 500_503 }));
    expect(outra.json()).toMatchObject({ codigo: 'internacao-de-outro-prontuario' });
    const semLote = await post(capt, '/digitalizacao', captura(pdf(2, 'lote'), { lote: 777 }));
    expect(semLote.statusCode).toBe(404);
    const imagem = Buffer.from('\x89PNG\r\n\x1a\nsintetico', 'latin1');
    expect((await post(capt, '/digitalizacao', captura(imagem))).json()).toMatchObject({
      codigo: 'nao-e-pdf',
    });
    // O segundo documento no mesmo lote, da internação do prontuário.
    const segundo = await post(
      capt,
      '/digitalizacao',
      captura(pdf(1, 'segundo'), { lote, internacao: 500_501, paginas: 1 }),
    );
    expect(segundo.statusCode, segundo.body).toBe(201);
    expect(segundo.json().lote).toBe(lote);
  });

  it('o arquivo devolvido é o guardado (o resumo no cabeçalho); a fila com as contagens e o nome', async () => {
    const a = await get(conf, `/digitalizacao/${doc}/arquivo`);
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('application/pdf');
    expect(sha(a.rawPayload)).toBe(a.headers['x-sgh-sha256']);
    expect((await get(conf, '/digitalizacao/99999/arquivo')).statusCode).toBe(404);
    const f = (await get(conf, '/digitalizacao/fila?situacao=capturado')).json();
    expect(f.contagens).toEqual({ capturado: 2, conferido: 0, recusado: 0, assinado: 0 });
    expect(f.itens[0]).toMatchObject({
      nome: 'PACIENTE SINTETICO 1001',
      destinacao: 'guardar',
      guardaAte: '2046-10-25',
    });
    expect((await get(conf, '/digitalizacao/prontuarios/501')).json().itens).toHaveLength(2);
    expect(eventos(E.digitalizacaoLida.codigo)).toBeGreaterThan(0);
  });

  it('a conferência: fiel; recusado com o motivo; a segunda vez recusada; sem motivo, 400', async () => {
    const f = (await get(conf, '/digitalizacao/fila?situacao=capturado')).json();
    const [segundo, primeiro] = f.itens as { id: number; versao: number }[];
    const fiel = await post(conf, `/digitalizacao/${primeiro!.id}/conferencia`, {
      id: primeiro!.id,
      resultado: 'fiel',
      versao: primeiro!.versao,
    });
    expect(fiel.statusCode, fiel.body).toBe(200);
    expect(fiel.json()).toMatchObject({ situacao: 'conferido' });
    const de_novo = await post(conf, `/digitalizacao/${primeiro!.id}/conferencia`, {
      id: primeiro!.id,
      resultado: 'fiel',
      versao: 2,
    });
    expect(de_novo.json()).toMatchObject({ codigo: 'ja-conferido' });
    expect(
      (
        await post(conf, `/digitalizacao/${segundo!.id}/conferencia`, {
          id: segundo!.id,
          resultado: 'recusar',
          versao: 1,
        })
      ).statusCode,
    ).toBe(400);
    const recusa = await post(conf, `/digitalizacao/${segundo!.id}/conferencia`, {
      id: segundo!.id,
      resultado: 'recusar',
      motivo: 'FOLHA FALTANDO',
      versao: 1,
    });
    expect(recusa.json()).toMatchObject({ situacao: 'recusado' });
    expect(eventos(E.digitalizacaoConferida.codigo)).toBe(2);
    expect((await get(conf, '/digitalizacao/fila')).json().contagens).toMatchObject({
      conferido: 1,
      recusado: 1,
    });
    expect(
      (
        await post(conf, `/digitalizacao/${segundo!.id}/conferencia`, {
          id: primeiro!.id,
          resultado: 'fiel',
          versao: 1,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a assinatura pela HTTP: o documento recusado não vai ao pedido; o certificado de outro é recusado', async () => {
    const f = (await get(conf, '/digitalizacao/fila')).json();
    const recusado = f.itens.find((x: { situacao: string }) => x.situacao === 'recusado');
    const r = await post(conf, '/digitalizacao/assinatura', { ids: [recusado.id], certificado: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'nao-conferido' });
    const conferido = f.itens.find((x: { situacao: string }) => x.situacao === 'conferido');
    const semCert = await post(conf, '/digitalizacao/assinatura', { ids: [conferido.id], certificado: 4242 });
    expect(semCert.statusCode).toBe(404);
    expect(
      (await post(capt, '/digitalizacao/assinatura', { ids: [conferido.id], certificado: 1 })).statusCode,
    ).toBe(403);
  });

  it('a recusa que só aparece na transação não deixa cópia presa: retenção curta e o mesmo objeto na nova tentativa', async () => {
    const disputa = pdf(2, 'disputa');
    const recusaTx = armazemDigitalizacao.gravacoes;
    const original = digitalizacao.gravarSgh.bind(digitalizacao);
    digitalizacao.gravarSgh = (async () => {
      throw new ErroProblema('recusa-de-negocio', 409, 'Digitalização recusada', 'lote', {
        codigo: 'lote-em-uso',
      });
    }) as never;
    try {
      expect((await post(capt, '/digitalizacao', captura(disputa))).statusCode).toBe(409);
    } finally {
      digitalizacao.gravarSgh = original;
    }
    expect(armazemDigitalizacao.gravacoes).toBe(recusaTx + 1);
    expect(armazemDigitalizacao.fixadas.has(`aa/same/digitalizacao/${sha(disputa)}.pdf`)).toBe(false);
    expect((await post(capt, '/digitalizacao', captura(disputa))).statusCode).toBe(201);
    expect(armazemDigitalizacao.gravacoes).toBe(recusaTx + 1);
    expect(armazemDigitalizacao.fixadas.has(`aa/same/digitalizacao/${sha(disputa)}.pdf`)).toBe(true);
  });
});

// ── A assinatura de quem conferiu pelo serviço do M49 (simulador) ─────────────────────────────────────────────────

function sessao(login: string): SessaoCadastro {
  return {
    req: { headers: {}, ip: '127.0.0.1' } as unknown as RequisicaoAutorizada,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login,
    porta: { rede: 'rede-sintetica', hospital: 'pc' },
    pode: () => true,
  };
}

describe('assinatura ICP-Brasil do documento digitalizado (M49 com o simulador)', () => {
  const CONFERE = sessao('SAME.CONFERE');
  const CAPTURA = sessao('SAME.CAPTURA');
  let portaIcp: PortaAssinaturaMemoria;
  let cfg: ConfigServicoAssinatura;
  let sim: SimuladorIcp;
  let icp: ServicoAssinaturaIcp;
  let porta: PortaDigitalizacaoMemoria;
  let armazem: ArmazemDigitalizacaoMemoria;
  let servico: ServicoAssinaturaDigitalizacao;

  beforeEach(async () => {
    portaIcp = new PortaAssinaturaMemoria();
    cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
    sim = cfg.simulador!;
    icp = new ServicoAssinaturaIcp(portaIcp, new RegistradorTrilhaMemoria(), cfg);
    porta = new PortaDigitalizacaoMemoria(lerPaciente, relogio);
    armazem = new ArmazemDigitalizacaoMemoria();
    servico = new ServicoAssinaturaDigitalizacao(icp, portaIcp, porta, armazem);
  });

  async function conferidos(n: number): Promise<number[]> {
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const b = pdf(1, `assinar-${k}`);
      const chave = await armazem.guardar('pc', b, sha(b));
      const r = await porta.gravarSgh(
        CAPTURA.porta,
        () => ({}) as never,
        (g) =>
          g.capturar({
            lote: null,
            prontuario: 501,
            internacao: null,
            paciente: 1001,
            tipoDocumento: 'evolucao',
            descricao: 'EVOLUCAO SINTETICA',
            dataDocumento: '2019-04-02',
            paginas: 1,
            resolucaoDpi: 300,
            cor: 'cinza',
            arquivoChave: chave,
            hash: sha(b),
            tamanho: b.length,
            guardaAte: '2046-10-25',
            usuario: CAPTURA.login,
          }),
      );
      await porta.gravarSgh(
        CONFERE.porta,
        () => ({}) as never,
        (g) =>
          g.conferir({ id: r.id, situacao: 'conferido', motivo: null, versao: 1, usuario: CONFERE.login }),
      );
      ids.push(r.id);
    }
    return ids;
  }

  function autorizar(endereco: string, cpf: string) {
    expect(endereco.startsWith(`${ROTA_NAVEGADOR_SIMULADOR}/oauth/authorize?`)).toBe(true);
    const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
    const volta = new URL(sim.autorizar(q, cpf), 'http://x').searchParams;
    return { state: volta.get('state')!, code: volta.get('code'), erro: volta.get('error') };
  }

  async function vincularNuvem(): Promise<number> {
    const a = await icp.iniciarVinculoNuvem(CONFERE, 'simulador');
    const r = await icp.retornoPsc(CONFERE, autorizar(a.endereco, CPF_SINTETICO_SESSAO));
    expect(r.ok).toBe(true);
    return r.certificado!;
  }

  it('o lote numa autorização em nuvem: validadas com o carimbo do tempo; os documentos assinados', async () => {
    const ids = await conferidos(3);
    const cert = await vincularNuvem();
    const p = await servico.iniciar(CONFERE, ids, cert);
    if (p.tipo !== 'nuvem') throw new Error('nuvem');
    const r = await icp.retornoPsc(CONFERE, autorizar(p.endereco, CPF_SINTETICO_SESSAO));
    expect(r).toMatchObject({ finalidade: 'digitalizacao', ok: true, lote: { assinados: 3, recusados: 0 } });
    for (const d of await porta.porIds(CONFERE.porta, ids)) {
      expect(d).toMatchObject({ situacao: 'assinado', assinadoPor: CONFERE.login });
      expect(d.assinatura).not.toBeNull();
      expect(d.carimboEm).not.toBeNull();
    }
    expect(porta.assinaturas.map((a) => [a.origem, a.estado, a.resultado])).toEqual([
      ['digitalizacao', 'assinada', 'valida'],
      ['digitalizacao', 'assinada', 'valida'],
      ['digitalizacao', 'assinada', 'valida'],
    ]);
    // O assinado não vai a outro pedido.
    await expect(servico.iniciar(CONFERE, [ids[0]!], cert)).rejects.toMatchObject({
      extras: { codigo: 'ja-assinado' },
    });
  });

  it('o A3 pelo agente local: o desafio com os resumos dos arquivos; assinado e validado', async () => {
    const [id] = await conferidos(1);
    const t = sim.titular(CPF_SINTETICO_SESSAO);
    const c = await icp.vincularArquivo(CONFERE, {
      midia: 'a3',
      provedor: null,
      certificado: Buffer.from(t.certificado).toString('base64'),
    });
    const p = await servico.iniciar(CONFERE, [id!], c.id);
    if (p.tipo !== 'agente-local') throw new Error('agente');
    const [d] = await porta.porIds(CONFERE.porta, [id!]);
    expect(p.hashes).toEqual([d!.hash]);
    const r = await icp.respostaAgente(CONFERE, {
      desafio: p.desafio,
      certificado: Buffer.from(t.certificado).toString('base64'),
      assinaturas: p.hashes.map((h) => ({
        hash: h,
        assinatura: Buffer.from(assinarHashRsa(t.chave, Buffer.from(h, 'hex'))).toString('base64'),
      })),
    });
    expect(r).toMatchObject({ finalidade: 'digitalizacao', ok: true, lote: { assinados: 1 } });
    expect((await porta.documento(CONFERE.porta, id!))?.situacao).toBe('assinado');
  });

  it('a sessão "como": a conferência e a assinatura são pessoais (403 sessao-como); a gravação as mostra desligadas', async () => {
    const [id] = await conferidos(1);
    const cert = await vincularNuvem();
    const como: SessaoCadastro = {
      ...CONFERE,
      req: { ...CONFERE.req, sghComo: { alvoLogin: 'SAME.CONFERE', alvoNome: 'Alvo sintético' } } as never,
    };
    const pedidos = (portaIcp as unknown as { pedidos: unknown[] }).pedidos;
    const antes = pedidos.length;
    const recusada = await servico.iniciar(como, [id!], cert).catch((x: unknown) => x);
    expect(recusada).toBeInstanceOf(ErroProblema);
    expect((recusada as ErroProblema).getStatus()).toBe(403);
    expect(recusada).toMatchObject({ extras: { motivo: 'sessao-como' } });
    expect(pedidos).toHaveLength(antes);
    const naoPessoal = (() => {
      try {
        naoComo(como.req);
        return null;
      } catch (x) {
        return x as ErroProblema;
      }
    })();
    expect(naoPessoal?.getStatus()).toBe(403);
    expect(naoPessoal?.extras).toMatchObject({ codigo: 'sessao-como' });
    expect(() => naoComo(CONFERE.req)).not.toThrow();
    const operacoes: Record<string, { pode: boolean; motivo: string | null }> = {
      capturar: { pode: true, motivo: null },
      conferir: { pode: true, motivo: null },
      assinar: { pode: true, motivo: null },
    };
    semAcoesPessoais(operacoes);
    expect(operacoes['capturar']).toEqual({ pode: true, motivo: null });
    expect(operacoes['conferir']?.pode).toBe(false);
    expect(operacoes['assinar']?.motivo).toMatch(/sua própria conta/);
    expect((await porta.documento(CONFERE.porta, id!))?.situacao).toBe('conferido');
  });

  it('quem não conferiu não pede; o arquivo que mudou não é assinado; o CPF de outro no provedor não assina', async () => {
    const [id] = await conferidos(1);
    const cert = await vincularNuvem();
    const outro = sessao('OUTRO.SAME');
    await expect(servico.iniciar(outro, [id!], cert)).rejects.toBeInstanceOf(ErroProblema);
    await expect(servico.iniciar(outro, [id!], cert)).rejects.toMatchObject({
      extras: { codigo: 'assinante-nao-conferiu' },
    });
    await expect(servico.iniciar(CONFERE, [9999], cert)).rejects.toMatchObject({ extras: {} });
    const p = await servico.iniciar(CONFERE, [id!], cert);
    if (p.tipo !== 'nuvem') throw new Error('nuvem');
    const r = await icp.retornoPsc(CONFERE, autorizar(p.endereco, CPF_SINTETICO_OUTRO));
    expect(r.ok).toBe(false);
    expect((await porta.documento(CONFERE.porta, id!))?.situacao).toBe('conferido');
    // O arquivo trocado no armazenamento (o resumo não confere): recusado antes do pedido.
    const [d] = await porta.porIds(CONFERE.porta, [id!]);
    (armazem as unknown as { arquivos: Map<string, Uint8Array> }).arquivos.set(
      `pc/${d!.arquivoChave}`,
      pdf(1, 'trocado'),
    );
    await expect(servico.iniciar(CONFERE, [id!], cert)).rejects.toMatchObject({
      extras: { codigo: 'arquivo-divergente' },
    });
  });

  it('a ACT fora do ar: a evidência da falha e o documento continua conferido, para assinar de novo', async () => {
    const [id] = await conferidos(1);
    const cert = await vincularNuvem();
    sim.foraDoAr.act = true;
    const p = await servico.iniciar(CONFERE, [id!], cert);
    if (p.tipo !== 'nuvem') throw new Error('nuvem');
    const r = await icp.retornoPsc(CONFERE, autorizar(p.endereco, CPF_SINTETICO_SESSAO));
    expect(r).toMatchObject({ finalidade: 'digitalizacao', ok: false, lote: { assinados: 0, recusados: 1 } });
    expect(porta.assinaturas.at(-1)).toMatchObject({
      origem: 'digitalizacao',
      estado: 'falha',
      resultado: 'indeterminada',
    });
    expect((await porta.documento(CONFERE.porta, id!))?.situacao).toBe('conferido');
    sim.foraDoAr.act = false;
    const p2 = await servico.iniciar(CONFERE, [id!], cert);
    if (p2.tipo !== 'nuvem') throw new Error('nuvem');
    expect((await icp.retornoPsc(CONFERE, autorizar(p2.endereco, CPF_SINTETICO_SESSAO))).ok).toBe(true);
  });
});
