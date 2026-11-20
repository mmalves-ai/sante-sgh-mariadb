// Partes puras da trava de saídas: leitura de host de valor e loopback (IPv6, colchetes, valor sem esquema).
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_COPIA,
  URL_ILEGIVEL,
  containerDaCopia,
  ehChaveDoSistema,
  verificarConfiguracao,
  ehDestinoLocal,
  ehLoopback,
  hostsDoValor,
} from './trava-saidas.js';

describe('ehLoopback', () => {
  it('aceita 127.0.0.0/8, localhost e ::1 (com ou sem colchetes)', () => {
    for (const h of ['127.0.0.1', '127.0.0.55', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(ehLoopback(h), h).toBe(true);
    }
  });
  it('recusa o resto', () => {
    for (const h of [
      '0.0.0.0',
      '10.0.0.5',
      '128.0.0.1',
      '::',
      '[::ffff:10.0.0.1]',
      'localhost.exemplo',
      '',
    ]) {
      expect(ehLoopback(h), h).toBe(false);
    }
  });
});

describe('hostsDoValor', () => {
  it('lê o host de URL com esquema em qualquer chave, sem credencial', () => {
    expect(hostsDoValor('https://u:s@api.exemplo.com:8443/x', 'QUALQUER')).toEqual(['api.exemplo.com']);
    expect(hostsDoValor('http://[::1]:3399', 'X')).toEqual(['[::1]']);
    expect(hostsDoValor('a=https://um.exemplo,b=http://127.0.0.1', 'LISTA')).toEqual([
      'um.exemplo',
      '127.0.0.1',
    ]);
  });
  it('URL ilegível vira marcador, nunca o valor cru', () => {
    expect(hostsDoValor('https://u:segredo@[x/y', 'X_URL')).toEqual([URL_ILEGIVEL]);
  });
  it('valor sem esquema conta em chave de endereço', () => {
    expect(hostsDoValor('ws.operadora.com.br/tiss', 'TISS_URL')).toEqual(['ws.operadora.com.br']);
    expect(hostsDoValor('10.0.0.5', 'TISS_ENDPOINT')).toEqual(['10.0.0.5']);
    expect(hostsDoValor('host-interno:8080', 'ALGO_HOST')).toEqual(['host-interno']);
    expect(hostsDoValor('u:s@ftp.exemplo.com/x', 'FTP_SERVIDOR')).toEqual(['ftp.exemplo.com']);
    expect(hostsDoValor('[::1]:25', 'SMTP_HOST')).toEqual(['[::1]']);
    expect(hostsDoValor('api.halai.com.br', 'HALAI_BASE')).toEqual(['api.halai.com.br']);
  });
  it('em chave só de família, valor sem cara de host não conta; fora de chave de endereço, nada', () => {
    expect(hostsDoValor('anexos', 'S3_BUCKET')).toEqual([]);
    expect(hostsDoValor('1.2.3', 'HALAI_VERSAO')).toEqual([]);
    expect(hostsDoValor('api.exemplo.com', 'NOME_QUALQUER')).toEqual([]);
  });
});

describe('container da cópia e destinos locais', () => {
  it('uma definição só: redesante-fb-<cod>', () => {
    expect(containerDaCopia('pc')).toBe('redesante-fb-pc');
    expect(CONTAINER_COPIA.exec('redesante-fb-pc')?.[1]).toBe('pc');
    expect(CONTAINER_COPIA.test('sgh-fb-pc')).toBe(false);
  });
  it('sante-firebird e containers alheios nunca são locais', () => {
    expect(ehDestinoLocal('sante-firebird')).toBe(false);
    expect(ehDestinoLocal('halaidb-55')).toBe(false);
    expect(ehDestinoLocal('sgh-mailpit')).toBe(true);
    expect(ehDestinoLocal(URL_ILEGIVEL)).toBe(false);
  });
  it('chaves do sistema e das ferramentas ficam fora; as do projeto, não', () => {
    expect(ehChaveDoSistema('npm_config_registry')).toBe(true);
    expect(ehChaveDoSistema('PATH')).toBe(true);
    expect(ehChaveDoSistema('TISS_URL')).toBe(false);
    expect(ehChaveDoSistema('API_EXTERNA')).toBe(false);
  });
  it('variáveis do runner de CI (GitHub Actions) ficam fora, e URL externa do projeto continua recusada', () => {
    const runner = {
      AMBIENTE: 'ci',
      CI: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_GRAPHQL_URL: 'https://api.github.com/graphql',
      ACTIONS_RUNTIME_URL: 'https://pipelines.actions.githubusercontent.com/x/',
      ACTIONS_RESULTS_URL: 'https://results-receiver.actions.githubusercontent.com/',
      RUNNER_TEMP: '/home/runner/work/_temp',
    };
    for (const chave of Object.keys(runner).filter((c) => /^(GITHUB|ACTIONS|RUNNER)_/.test(c))) {
      expect(ehChaveDoSistema(chave), chave).toBe(true);
    }
    expect(verificarConfiguracao(runner).ok).toBe(true);
    expect(verificarConfiguracao({ ...runner, TISS_URL: 'https://operadora.exemplo.com.br/ws' }).ok).toBe(
      false,
    );
  });
});

describe('variáveis do runner de CI que não são endereço', () => {
  it('número puro ou booleano em chave de endereço não é host; nome de container continua contando', () => {
    expect(hostsDoValor('1', 'SGX_AESM_ADDR')).toEqual([]);
    expect(hostsDoValor('true', 'ALGUM_HOST')).toEqual([]);
    expect(hostsDoValor('sante-firebird', 'FB_PC_HOST')).toEqual(['sante-firebird']);
    expect(hostsDoValor('smtp', 'SMTP_HOST')).toEqual(['smtp']);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', SGX_AESM_ADDR: '1' }).ok).toBe(true);
    expect(
      verificarConfiguracao({
        AMBIENTE: 'ci',
        SGX_AESM_ADDR: '1',
        ESTABELECIMENTOS: 'pc',
        FB_PC_HOST: 'sante-firebird',
      }).ok,
    ).toBe(false);
  });
});

describe('assinatura ICP-Brasil fora de produção (M49)', () => {
  it('só no simulador ou desligada; endereço do provedor, da ACT e da volta só em loopback', () => {
    expect(verificarConfiguracao({ AMBIENTE: 'ci' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', ASSINATURA_ICP_MODO: 'desligado' }).ok).toBe(true);
    // M44 (etapa 3): a regulação estadual só no simulador ou desligada; o endereço da central fora do loopback recusado.
    expect(verificarConfiguracao({ AMBIENTE: 'ci', REGULACAO_MODO: 'simulador' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', REGULACAO_MODO: 'producao' }).ok).toBe(false);
    // M47 (etapa 3): o PACS e as modalidades só no simulador ou desligados; o endereço real do PACS recusado.
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PACS_MODO: 'simulador' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PACS_MODO: 'desligado' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PACS_MODO: 'pacs' }).ok).toBe(false);
    expect(
      verificarConfiguracao({ AMBIENTE: 'ci', INTEGRACAO_DESTINO_PACS: 'https://pacs.hospital.com.br/mwl' })
        .ok,
    ).toBe(false);
    expect(
      verificarConfiguracao({ AMBIENTE: 'ci', INTEGRACAO_DESTINO_PACS: 'http://127.0.0.1:5447/mwl' }).ok,
    ).toBe(true);
    // M50 (etapa 2): o gateway de pagamento do portal só no simulador ou desligado.
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PORTAL_PAGAMENTO_MODO: 'simulador' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PORTAL_PAGAMENTO_MODO: 'desligado' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PORTAL_PAGAMENTO_MODO: 'gateway' }).ok).toBe(false);
    // M50 (etapa 4): o provedor de teleconsulta só no simulador ou desligado.
    expect(verificarConfiguracao({ AMBIENTE: 'ci', TELECONSULTA_PROVEDOR_MODO: 'simulador' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', TELECONSULTA_PROVEDOR_MODO: 'desligado' }).ok).toBe(true);
    const real = verificarConfiguracao({ AMBIENTE: 'ci', TELECONSULTA_PROVEDOR_MODO: 'provedor' });
    expect(real.ok).toBe(false);
    expect(real.itens.find((i) => !i.ok)?.regra).toBe('provedor de teleconsulta no simulador ou desligado');
    expect(verificarConfiguracao({ AMBIENTE: 'ci', REGULACAO_CENTRAL: 'central.saude.rj.gov.br' }).ok).toBe(
      false,
    );
    expect(verificarConfiguracao({ AMBIENTE: 'ci', REGULACAO_CENTRAL: '127.0.0.1:9099' }).ok).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', ASSINATURA_ICP_MODO: 'producao' }).ok).toBe(false);
    expect(
      verificarConfiguracao({ AMBIENTE: 'ci', ASSINATURA_ACT_URL: 'https://act.exemplo.com.br/tsa' }).ok,
    ).toBe(false);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', PSC_URI: 'https://psc.exemplo.com.br/v0' }).ok).toBe(
      false,
    );
    expect(
      verificarConfiguracao({ AMBIENTE: 'ci', ASSINATURA_AGENTE_LOCAL_URL: 'http://127.0.0.1:8765' }).ok,
    ).toBe(true);
    expect(verificarConfiguracao({ AMBIENTE: 'producao', ASSINATURA_ICP_MODO: 'producao' }).aplicavel).toBe(
      false,
    );
  });
});

describe('eSocial e folha externa fora de produção (M53, regra 3)', () => {
  it('recusa o endereço real do eSocial, em chave da família ou em qualquer chave com URL', () => {
    const real = verificarConfiguracao({
      AMBIENTE: 'homolog',
      ESOCIAL_URL: 'https://webservices.envio.esocial.gov.br',
    });
    expect(real.ok).toBe(false);
    const item = real.itens.find((i) => !i.ok)!;
    expect(item.regra).toBe('nenhum endpoint externo real');
    expect(item.detalhe).toContain('coletor local');
    expect(
      verificarConfiguracao({
        AMBIENTE: 'treino',
        TRANSMISSOR_URL: 'https://webservices.producaorestrita.esocial.gov.br/x',
      }).ok,
    ).toBe(false);
    expect(verificarConfiguracao({ AMBIENTE: 'ci', FOLHA_EXTERNA_HOST: 'folha.fornecedor.com.br' }).ok).toBe(
      false,
    );
    expect(verificarConfiguracao({ AMBIENTE: 'ci', ESOCIAL_URL: 'http://127.0.0.1:5490/coletor' }).ok).toBe(
      true,
    );
    expect(
      verificarConfiguracao({ AMBIENTE: 'producao', ESOCIAL_URL: 'https://webservices.envio.esocial.gov.br' })
        .ok,
    ).toBe(true);
  });

  it('o modo do transmissor e da folha externa: só coletor ou desligado', () => {
    expect(verificarConfiguracao({ AMBIENTE: 'ci', ESOCIAL_MODO: 'coletor' }).ok).toBe(true);
    expect(
      verificarConfiguracao({ AMBIENTE: 'ci', ESOCIAL_MODO: 'desligado', FOLHA_EXTERNA_MODO: 'coletor' }).ok,
    ).toBe(true);
    const r = verificarConfiguracao({ AMBIENTE: 'ci', ESOCIAL_MODO: 'producao' });
    expect(r.ok).toBe(false);
    expect(r.itens.find((i) => !i.ok)?.regra).toBe('eSocial e folha externa só no coletor ou desligados');
    expect(verificarConfiguracao({ AMBIENTE: 'ci', FOLHA_EXTERNA_MODO: 'real' }).ok).toBe(false);
  });
});
