import {
  CABECALHOS_SEGURANCA,
  type ConferenciaInstalacao,
  type FumacaServidor,
  ITENS_CONFERENCIA_INSTALACAO,
  ITENS_FUMACA_SERVIDOR,
  ITENS_VERIFICACAO_IMPLANTACAO,
  type SondasImplantacao,
  SONDAS_IMPLANTACAO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { piorSituacao } from './fumaca.js';
import {
  type ColetaVerificacao,
  itensDaVerificacao,
  maxAgeHsts,
  relatorioEmMarkdown,
  SE_FALHAR,
} from './verificacao.js';

const T = Date.UTC(2026, 9, 27, 15, 0, 0);
const cab = Object.fromEntries(
  CABECALHOS_SEGURANCA.map((n) => [
    n,
    n === 'strict-transport-security'
      ? 'max-age=31536000; includeSubDomains'
      : n === 'x-content-type-options'
        ? 'nosniff'
        : n === 'x-frame-options'
          ? 'DENY'
          : n === 'content-security-policy'
            ? "default-src 'self'; frame-ancestors 'none'"
            : 'x',
  ]),
);

const sondas = (): SondasImplantacao => ({
  hospital: 'pc',
  versao: '1.0.0+abc',
  pronta: true,
  sondas: SONDAS_IMPLANTACAO.map((sonda) => ({ sonda, ok: true, detalhe: 'ok', ms: 3 })),
});

const conferencia = (): ConferenciaInstalacao => ({
  hospital: 'pc',
  em: new Date(T).toISOString(),
  ambiente: 'producao',
  versao: { identificacao: '1.0.0+abc', versao: '1.0.0' },
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
    noPacote: 2,
    ultimoNoPacote: '0600',
    aplicados: 2,
    ultimoAplicado: '0600',
    pendentes: [],
    pendentesTotal: 0,
    divergentes: [],
    desconhecidos: [],
  },
  itens: ITENS_CONFERENCIA_INSTALACAO.map((codigo) => ({
    codigo,
    titulo: codigo,
    situacao: 'ok',
    detalhe: `${codigo} ok.`,
  })),
  situacao: 'ok',
});

const fumaca = (): FumacaServidor => ({
  hospital: 'pc',
  em: new Date(T).toISOString(),
  ambiente: 'producao',
  relogio: {
    servidorEm: new Date(T).toISOString(),
    fuso: 'UTC',
    bancoLocal: null,
    fusoBancoMin: -180,
    derivaMs: 10,
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
  },
  chaves: { lidas: true, ligadas: [], esperadas: [], inesperadas: [] },
  itens: ITENS_FUMACA_SERVIDOR.map((codigo) => ({
    codigo,
    titulo: codigo,
    situacao: 'ok',
    detalhe: `${codigo} ok.`,
  })),
  situacao: 'ok',
});

const resposta = (status: number, cabecalhos: Record<string, string> = {}) => ({
  status,
  cabecalhos,
  erro: null,
  ms: 12,
});

const coleta = (): ColetaVerificacao => ({
  unidades: [
    { nome: 'sante-sgh-api', estado: 'active' },
    { nome: 'sante-sgh-worker', estado: 'active' },
    { nome: 'nginx', estado: 'active' },
    { nome: 'valkey-server', estado: 'active' },
  ],
  pagina: resposta(200, cab),
  http: resposta(301, { location: 'https://sante.exemplo.test/' }),
  saude: resposta(200),
  identificacao: '1.0.0+abc',
  versaoEsperada: '1.0.0+abc',
  sondas: sondas(),
  sondasErro: null,
  conferencia: conferencia(),
  conferenciaErro: null,
  fumaca: fumaca(),
  fumacaErro: null,
  relogioLocalMs: T + 200,
});

const sit = (c: ColetaVerificacao) =>
  Object.fromEntries(itensDaVerificacao(c).map((i) => [i.codigo, i.situacao]));

describe('M60.3: verificação pós-implantação (regras)', () => {
  it('a instalação correta: os 14 itens ok, na ordem do contrato, cada um com o que fazer', () => {
    const itens = itensDaVerificacao(coleta());
    expect(itens.map((i) => i.codigo)).toEqual([...ITENS_VERIFICACAO_IMPLANTACAO]);
    expect(itens.filter((i) => i.situacao !== 'ok')).toEqual([]);
    for (const i of itens) expect(i.seFalhar).toBe(SE_FALHAR[i.codigo]);
  });

  it('serviços: parado é falha; fora do servidor, alerta', () => {
    const c = coleta();
    expect(sit({ ...c, unidades: [{ nome: 'sante-sgh-worker', estado: 'failed' }] }).servicos).toBe('falha');
    expect(sit({ ...c, unidades: null }).servicos).toBe('alerta');
    expect(sit({ ...c, unidades: [{ nome: 'nginx', estado: null }] }).servicos).toBe('alerta');
  });

  it('HTTPS: erro de TLS e status ruim falham; HTTP sem redirecionar é alerta', () => {
    const c = coleta();
    const tls = { ...c, pagina: { status: null, cabecalhos: {}, erro: 'certificado', ms: 0 } };
    expect(sit(tls).https).toBe('falha');
    expect(sit(tls).cabecalhos).toBe('falha');
    expect(sit({ ...c, pagina: resposta(502, cab) }).https).toBe('falha');
    expect(sit({ ...c, http: resposta(200) }).https).toBe('alerta');
    expect(sit({ ...c, http: null }).https).toBe('ok');
  });

  it('cabeçalhos: faltando é falha; HSTS curto, versão do servidor e X-Powered-By são alerta', () => {
    const c = coleta();
    const sem = { ...cab };
    delete sem['content-security-policy'];
    expect(sit({ ...c, pagina: resposta(200, sem) }).cabecalhos).toBe('falha');
    expect(
      sit({ ...c, pagina: resposta(200, { ...cab, 'strict-transport-security': 'max-age=60' }) }).cabecalhos,
    ).toBe('alerta');
    expect(sit({ ...c, pagina: resposta(200, { ...cab, server: 'nginx/1.24.0' }) }).cabecalhos).toBe(
      'alerta',
    );
    expect(sit({ ...c, pagina: resposta(200, { ...cab, 'x-powered-by': 'x' }) }).cabecalhos).toBe('alerta');
    expect(maxAgeHsts('max-age="31536000"')).toBe(31_536_000);
    expect(maxAgeHsts(undefined)).toBeNull();
  });

  it('versão: diferente da esperada é falha; sem esperada, alerta', () => {
    const c = coleta();
    expect(sit({ ...c, identificacao: '0.9.0+old' }).versao).toBe('falha');
    expect(sit({ ...c, versaoEsperada: null }).versao).toBe('alerta');
    expect(sit({ ...c, identificacao: null }).versao).toBe('falha');
  });

  it('sondas do M38: login e consultas ao vivo; sem a resposta, falha com o motivo', () => {
    const c = coleta();
    const s = sondas();
    const ruim = {
      ...s,
      pronta: false,
      sondas: s.sondas.map((x) =>
        x.sonda === 'painel-leitos' ? { ...x, ok: false, detalhe: 'leitura-falhou' } : x,
      ),
    };
    const itens = itensDaVerificacao({ ...c, sondas: ruim });
    expect(itens.find((i) => i.codigo === 'consultas-ao-vivo')).toMatchObject({ situacao: 'falha' });
    expect(itens.find((i) => i.codigo === 'consultas-ao-vivo')?.detalhe).toContain(
      'painel-leitos: leitura-falhou',
    );
    expect(
      sit({ ...c, sondas: { ...s, sondas: s.sondas.filter((x) => x.sonda !== 'login-sonda') } })[
        'login-sonda'
      ],
    ).toBe('falha');
    const nada = itensDaVerificacao({ ...c, sondas: null, sondasErro: '404' });
    expect(nada.find((i) => i.codigo === 'login-sonda')?.detalhe).toContain('404');
    // M60.3: o endereço das estações fora de qualquer rede reprova o login, mesmo com a sonda em ordem.
    const semRede = itensDaVerificacao({ ...c, rede: { status: 404, cabecalhos: {}, erro: null, ms: 3 } });
    expect(semRede.find((i) => i.codigo === 'login-sonda')).toMatchObject({ situacao: 'falha' });
    expect(semRede.find((i) => i.codigo === 'login-sonda')?.detalhe).toContain('REDE_ENDERECOS');
    expect(
      itensDaVerificacao({ ...c, rede: { status: 200, cabecalhos: {}, erro: null, ms: 3 } }).find(
        (i) => i.codigo === 'login-sonda',
      )?.situacao,
    ).toBe(sit(c)['login-sonda']);
  });

  it('conexão e scripts vêm da conferência; a pior situação da conexão prevalece', () => {
    const c = coleta();
    const f = conferencia();
    const canal = {
      ...f,
      itens: f.itens.map((i) =>
        i.codigo === 'canal-cifrado' ? { ...i, situacao: 'falha' as const, detalhe: 'Canal aberto.' } : i,
      ),
    };
    const itens = itensDaVerificacao({ ...c, conferencia: canal });
    expect(itens.find((i) => i.codigo === 'conexao-banco')).toMatchObject({ situacao: 'falha' });
    expect(itens.find((i) => i.codigo === 'conexao-banco')?.detalhe).toContain('Canal aberto.');
    expect(itens.find((i) => i.codigo === 'conexao-banco')?.detalhe).toContain('Firebird 3.0.14');
    expect(sit({ ...c, conferencia: null, conferenciaErro: 'tempo' })['scripts-sgh']).toBe('falha');
  });

  it('itens da fumaça: a pior das fontes; sem a fumaça, falha', () => {
    const c = coleta();
    const f = fumaca();
    const filas = {
      ...f,
      itens: f.itens.map((i) => (i.codigo === 'filas' ? { ...i, situacao: 'alerta' as const } : i)),
    };
    expect(sit({ ...c, fumaca: filas })['worker-filas']).toBe('alerta');
    const s = sit({ ...c, fumaca: null, fumacaErro: '404' });
    for (const k of ['impressao-digital', 'chaves', 'worker-filas', 'valkey', 'fuso-relogio'])
      expect(s[k]).toBe('falha');
  });

  it('relógio desta máquina mais de 5 s longe do servidor: alerta', () => {
    expect(sit({ ...coleta(), relogioLocalMs: T + 9_000 })['fuso-relogio']).toBe('alerta');
  });

  it('relatório em Markdown: resultado, tabela e o que fazer só dos itens ruins', () => {
    const c = coleta();
    const itens = itensDaVerificacao({ ...c, identificacao: '0.9.0+old' });
    const md = relatorioEmMarkdown({
      hospital: 'pc',
      endereco: 'https://sante.exemplo.test',
      em: new Date(T).toISOString(),
      duracaoMs: 2_500,
      versaoEsperada: '1.0.0+abc',
      itens,
      situacao: piorSituacao(itens),
    });
    expect(md).toContain('**Resultado: FALHA** (13 de 14 itens OK)');
    expect(md).toContain('| 5 | Versão instalada | FALHA |');
    expect(md).toContain('## O que fazer');
    expect(md).toContain(SE_FALHAR.versao);
    expect(md).not.toContain(SE_FALHAR.https);
    expect(md).toContain('2,5 s');
  });
});
