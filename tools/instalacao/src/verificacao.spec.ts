// M60.3: a coleta de `implantacao:verificar` com um cliente HTTP simulado (nada sai da máquina): as rotas chamadas, o
// segredo só no cabeçalho das sondas, o contrato de cada resposta e o pedido montado a partir do servidor.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CABECALHOS_SEGURANCA,
  ITENS_CONFERENCIA_INSTALACAO,
  ITENS_FUMACA_SERVIDOR,
  ROTA_SONDA_FUMACA,
  ROTA_SONDA_INSTALACAO,
  SONDAS_IMPLANTACAO,
} from '@sgh/contratos';
import { itensDaVerificacao, piorSituacao } from '@sgh/dominio-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClienteHttp,
  clienteHttpNode,
  codigoDeErro,
  coletar,
  lerArgumentos,
  lerArquivoEnv,
  montarPedido,
  type PedidoVerificacao,
  ROTA_SONDAS_M38,
  UNIDADES_SERVIDOR,
} from './verificacao.ts';

const TOKEN = 't'.repeat(40);
const T = Date.UTC(2026, 9, 27, 15, 0, 0);
const cab = Object.fromEntries(
  CABECALHOS_SEGURANCA.map((n) => [
    n,
    n === 'strict-transport-security'
      ? 'max-age=31536000'
      : n === 'x-content-type-options'
        ? 'nosniff'
        : n === 'x-frame-options'
          ? 'DENY'
          : 'x',
  ]),
);

const corpos: Record<string, unknown> = {
  '/api/versao': {
    produto: 'P',
    versao: '1.0.0',
    commit: 'abcdef1',
    construidoEm: new Date(T).toISOString(),
    identificacao: '1.0.0+abcdef1',
  },
  '/api/saude': { status: 'ok', em: new Date(T).toISOString() },
  [ROTA_SONDAS_M38]: {
    hospital: 'pc',
    versao: '1.0.0+abcdef1',
    pronta: true,
    sondas: SONDAS_IMPLANTACAO.map((sonda) => ({ sonda, ok: true, detalhe: 'ok', ms: 2 })),
  },
  [ROTA_SONDA_INSTALACAO]: {
    hospital: 'pc',
    em: new Date(T).toISOString(),
    ambiente: 'producao',
    versao: { identificacao: '1.0.0+abcdef1', versao: '1.0.0' },
    conexao: {
      versaoMotor: '3.0.14',
      charsetBanco: 'NONE',
      charsetConexao: 'NONE',
      charsetParametro: 'CP1252',
      autenticacao: 'Srp256',
      canalCifrado: true,
      canalComprimido: false,
      protocolo: 'TCPv4',
      conta: 'SGH_APP',
      papel: 'SGH_APLICACAO',
    },
    scripts: {
      registroLido: true,
      noPacote: 1,
      ultimoNoPacote: '0001',
      aplicados: 1,
      ultimoAplicado: '0001',
      pendentes: [],
      pendentesTotal: 0,
      divergentes: [],
      desconhecidos: [],
    },
    itens: ITENS_CONFERENCIA_INSTALACAO.map((codigo) => ({
      codigo,
      titulo: codigo,
      situacao: 'ok',
      detalhe: 'ok',
    })),
    situacao: 'ok',
  },
  [ROTA_SONDA_FUMACA]: {
    hospital: 'pc',
    em: new Date(T).toISOString(),
    ambiente: 'producao',
    relogio: {
      servidorEm: new Date(T).toISOString(),
      fuso: 'UTC',
      bancoLocal: null,
      fusoBancoMin: -180,
      derivaMs: 3,
    },
    horaConfiavel: {
      servidorNtp: 'a.st1.ntp.br',
      referencia: 'ntp',
      ntpEm: '2026-10-27T12:00:00.000Z',
      desvioServidorMs: 5,
      desvioBancoMs: 15,
      limiarMs: 1000,
      fusoInstituicao: 'America/Sao_Paulo',
      exibidoNoFuso: '27/10/2026 09:00:00',
    },
    valkey: { configurado: true, responde: true, latenciaMs: 1 },
    filas: [],
    impressao: {
      estado: 'homologado',
      resumo: null,
      resumoHomologado: null,
      verificadaEm: null,
      tabelasBloqueadas: 0,
      bloqueiaTudo: false,
    },
    chaves: { lidas: true, ligadas: [], esperadas: [], inesperadas: [] },
    itens: ITENS_FUMACA_SERVIDOR.map((codigo) => ({ codigo, titulo: codigo, situacao: 'ok', detalhe: 'ok' })),
    situacao: 'ok',
  },
};

const pedido: PedidoVerificacao = {
  endereco: 'https://sante.exemplo.test',
  hospital: 'pc',
  token: TOKEN,
  versaoEsperada: '1.0.0+abcdef1',
  ca: null,
  conferirHttp: true,
};

function simulado(
  ajuste: (caminho: string) => Partial<Awaited<ReturnType<ClienteHttp>>> | null = () => null,
) {
  const chamadas: { url: string; token: string | undefined }[] = [];
  const http: ClienteHttp = (url, o) => {
    const u = new URL(url);
    chamadas.push({ url, token: o?.cabecalhos?.['x-sonda-token'] });
    if (u.protocol === 'http:')
      return Promise.resolve({
        status: 301,
        cabecalhos: { location: `https://${u.host}/` },
        erro: null,
        ms: 1,
        corpo: '',
      });
    const corpo = corpos[u.pathname];
    const base = {
      status: 200,
      cabecalhos: cab,
      erro: null,
      ms: 5,
      corpo: corpo === undefined ? '<html></html>' : JSON.stringify(corpo),
    };
    return Promise.resolve({ ...base, ...(ajuste(u.pathname) ?? {}) });
  };
  return { http, chamadas };
}

const todasAtivas = (nomes: readonly string[]) =>
  Promise.resolve(nomes.map((nome) => ({ nome, estado: 'active' })));

describe('M60.3: coleta da verificação pós-implantação', () => {
  it('a instalação correta: as rotas chamadas, o segredo só nas sondas, e os 14 itens ok', async () => {
    const { http, chamadas } = simulado();
    const c = await coletar(pedido, http, todasAtivas, () => T);
    const itens = itensDaVerificacao(c);
    expect(itens.filter((i) => i.situacao !== 'ok')).toEqual([]);
    expect(piorSituacao(itens)).toBe('ok');
    const comToken = chamadas.filter((x) => x.token === TOKEN).map((x) => new URL(x.url).pathname);
    expect(comToken.sort()).toEqual([ROTA_SONDAS_M38, ROTA_SONDA_FUMACA, ROTA_SONDA_INSTALACAO].sort());
    expect(chamadas.filter((x) => x.token === undefined).map((x) => x.url)).toEqual(
      expect.arrayContaining([
        'https://sante.exemplo.test/',
        'http://sante.exemplo.test/',
        'https://sante.exemplo.test/api/saude',
      ]),
    );
    // O segredo nunca vai na URL.
    expect(chamadas.some((x) => x.url.includes(TOKEN))).toBe(false);
    expect(chamadas.every((x) => x.url.includes('hospital=pc') || !x.url.includes('/sonda'))).toBe(true);
  });

  it('sonda recusada (404) e resposta fora do contrato viram falha com o motivo curto', async () => {
    const { http } = simulado((p) =>
      p === ROTA_SONDA_FUMACA
        ? { status: 404, corpo: '{}' }
        : p === ROTA_SONDA_INSTALACAO
          ? { corpo: '{"x":1}' }
          : null,
    );
    const itens = itensDaVerificacao(await coletar(pedido, http, todasAtivas, () => T));
    const por = Object.fromEntries(itens.map((i) => [i.codigo, i]));
    expect(por['valkey']?.situacao).toBe('falha');
    expect(por['valkey']?.detalhe).toContain('HTTP 404');
    expect(por['scripts-sgh']?.detalhe).toContain('fora do contrato');
    expect(por['login-sonda']?.situacao).toBe('ok');
  });

  it('sem --sem-http o HTTP é conferido; com ele, não; serviços fora do servidor ficam em alerta', async () => {
    const { http, chamadas } = simulado();
    const c = await coletar(
      { ...pedido, conferirHttp: false },
      http,
      () => Promise.resolve(null),
      () => T,
    );
    expect(chamadas.some((x) => x.url.startsWith('http:'))).toBe(false);
    expect(itensDaVerificacao(c).find((i) => i.codigo === 'servicos')?.situacao).toBe('alerta');
    expect(UNIDADES_SERVIDOR()).toEqual(['sante-sgh-api', 'sante-sgh-worker', 'nginx', 'valkey-server']);
  });
});

describe('M60.3: pedido da verificação', () => {
  const fontes = (extra: Partial<Parameters<typeof montarPedido>[0]> = {}) => ({
    opcoes: {},
    bandeiras: new Set<string>(),
    ambiente: { SONDA_TOKEN: TOKEN, ESTABELECIMENTOS: 'pc,hs' },
    instalacao: { SITE_DOMINIO: 'sante.exemplo.test', SITE_CERT: '/etc/sante-sgh/tls/cert.pem' },
    identificacaoDoManifesto: '1.0.0+abcdef1',
    lerCa: () => Buffer.from('CA'),
    ...extra,
  });

  it('no servidor: domínio, certificado, primeiro estabelecimento e versão do manifesto', () => {
    const p = montarPedido(fontes());
    expect(p).toMatchObject({
      endereco: 'https://sante.exemplo.test',
      hospital: 'pc',
      versaoEsperada: '1.0.0+abcdef1',
      conferirHttp: true,
    });
    expect(p.ca?.toString()).toBe('CA');
  });

  it('as opções prevalecem; --sem-ca dispensa o certificado; --sem-http', () => {
    const p = montarPedido(
      fontes({
        opcoes: { endereco: 'https://outro.exemplo.test:8443/', hospital: 'hs', versao: '2.0.0+x' },
        bandeiras: new Set(['sem-ca', 'sem-http']),
      }),
    );
    expect(p).toMatchObject({
      endereco: 'https://outro.exemplo.test:8443',
      hospital: 'hs',
      versaoEsperada: '2.0.0+x',
      ca: null,
      conferirHttp: false,
    });
  });

  it('recusas: sem endereço HTTPS, sem segredo, sem estabelecimento, --ca ilegível', () => {
    expect(() => montarPedido(fontes({ instalacao: {} }))).toThrow(/endereco/);
    expect(() => montarPedido(fontes({ opcoes: { endereco: 'http://x.test' } }))).toThrow(/endereco/);
    expect(() =>
      montarPedido(fontes({ ambiente: { SONDA_TOKEN: 'curto', ESTABELECIMENTOS: 'pc' } })),
    ).toThrow(/SONDA_TOKEN/);
    expect(() => montarPedido(fontes({ ambiente: { SONDA_TOKEN: TOKEN } }))).toThrow(/hospital/);
    const ilegivel = () => {
      throw new Error('ENOENT');
    };
    expect(() => montarPedido(fontes({ opcoes: { ca: '/nao/existe' }, lerCa: ilegivel }))).toThrow(/--ca/);
    // O certificado do estado da instalação ausente só deixa de ser usado (o do sistema vale).
    expect(montarPedido(fontes({ lerCa: ilegivel })).ca).toBeNull();
  });

  it('argumentos e arquivo de ambiente', () => {
    const a = lerArgumentos(['--', '--hospital=pc', '--json']);
    expect(a.opcoes).toEqual({ hospital: 'pc' });
    expect([...a.bandeiras]).toEqual(['json']);
    expect(() => lerArgumentos(['hospital'])).toThrow(/não reconhecido/);
    expect(lerArquivoEnv('/x', () => 'A=1\n# c\nB="dois"\n')).toEqual({ A: '1', B: 'dois' });
    expect(
      lerArquivoEnv('/x', () => {
        throw new Error('EACCES');
      }),
    ).toEqual({});
  });
});

describe('M60.3: cliente HTTP (servidor local efêmero)', () => {
  let srv: Server;
  let base = '';
  beforeAll(async () => {
    srv = createServer((req, res) => {
      if (req.url === '/lento') return void setTimeout(() => res.end('x'), 2_000);
      res.setHeader('X-Teste', req.headers['x-sonda-token'] ? 'com' : 'sem');
      res.statusCode = req.url === '/r' ? 301 : 200;
      if (req.url === '/r') res.setHeader('Location', 'https://destino.test/');
      res.end('{"ok":true}');
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => srv.close(() => ok())));

  it('GET sem seguir redirecionamento, cabeçalhos em minúsculas, corpo e prazo', async () => {
    const r = await clienteHttpNode(`${base}/r`);
    expect(r).toMatchObject({ status: 301, erro: null });
    expect(r.cabecalhos['location']).toBe('https://destino.test/');
    const s = await clienteHttpNode(`${base}/`, { cabecalhos: { 'x-sonda-token': TOKEN } });
    expect(s.cabecalhos['x-teste']).toBe('com');
    expect(s.corpo).toBe('{"ok":true}');
    const lento = await clienteHttpNode(`${base}/lento`, { prazoMs: 200 });
    expect(lento).toMatchObject({ status: null, erro: 'TEMPO_ESGOTADO' });
    const fora = await clienteHttpNode('http://127.0.0.1:1/');
    expect(fora.erro).toBe('ECONNREFUSED');
    expect(codigoDeErro(new Error('qualquer coisa com host.test'))).toBe('ERRO');
  });
});
