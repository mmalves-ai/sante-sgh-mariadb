// M53.6 (achado do corretor): o transmissor real do eSocial com dados e certificados SINTÉTICOS (a ICP sintética do
// motor de documentos; nada vale fora de dev/ci): a leitura do XML, a forma canônica, a assinatura XMLDSig conferida
// de forma independente, o certificado como pré-requisito, a trava de ambiente, o envelope SOAP e as respostas, e o
// TLS mútuo de verdade contra um servidor HTTPS local (o simulador). Nada sai da máquina.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { type TLSSocket } from 'node:tls';
import { criarRaizSintetica, emitirSintetico, type EntidadeSintetica } from '@sgh/dominio-documento';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerCertificadoEsocial, type CertificadoEsocial } from './certificado-esocial.js';
import {
  ACAO_CONSULTA,
  ACAO_ENVIO,
  envelopeConsultaLote,
  envelopeEnvioLote,
  lerRespostaConsulta,
  lerRespostaEnvio,
  URL_ENVIO_PRODUCAO,
} from './soap-esocial.js';
import { SimuladorEsocial } from './simulador-esocial.spec-util.js';
import {
  ErroTransmissorEsocial,
  transmissorEsocialDoAmbiente,
  TransmissorEsocialSoap,
  transporteHttps,
} from './transmissor-esocial.js';
import { ErroXml, lerXml } from './xml-leitura.js';
import { assinarEventoEsocial, canonizar, conferirAssinaturaEvento } from './xmldsig.js';

const agora = new Date('2026-10-28T10:00:00Z');
const CNPJ = '11222333000181';
const raiz = criarRaizSintetica(agora);
const pem = (der: Uint8Array) =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;
const chavePem = (e: EntidadeSintetica, senha?: string) =>
  e.chave
    .export(
      senha
        ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: senha }
        : { type: 'pkcs8', format: 'pem' },
    )
    .toString();
const titular = emitirSintetico(raiz, { cpf: null, nome: `EMPRESA SINTETICA LTDA:${CNPJ}` }, agora);

function certificado(e: EntidadeSintetica = titular): CertificadoEsocial {
  const l = lerCertificadoEsocial({ certificadoPem: pem(e.certificado), chavePem: chavePem(e) }, agora);
  if (!l.ok) throw new Error(l.motivo);
  return l.certificado;
}

const NS = 'http://www.esocial.gov.br/schema/evt/evtInfoEmpregador/v_S_01_03_00';
const ID = 'ID1112223330000002026102810000000001';
const EVENTO =
  `<?xml version="1.0" encoding="UTF-8"?><eSocial xmlns="${NS}"><evtInfoEmpregador Id="${ID}">` +
  `<ideEvento><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>SGH &amp; teste &lt;1&gt;</verProc></ideEvento>` +
  `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>11222333</nrInsc></ideEmpregador></evtInfoEmpregador></eSocial>`;

describe('leitura de XML do transmissor', () => {
  it('lê prefixos, entidades, CDATA, vazios e comentários; recusa DOCTYPE e marca trocada', () => {
    const r = lerXml(
      '<?xml version="1.0"?><!-- c --><s:A xmlns:s="urn:a" x=\'1\'><B>&lt;&#65;&#x42;&amp;</B><C/><D><![CDATA[<x>]]></D></s:A>',
    );
    expect(r.nome).toBe('s:A');
    expect(r.atributos).toEqual([
      ['xmlns:s', 'urn:a'],
      ['x', '1'],
    ]);
    expect(r.filhos.map((f) => [f.nome, f.texto])).toEqual([
      ['B', '<AB&'],
      ['C', ''],
      ['D', '<x>'],
    ]);
    expect(() => lerXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>')).toThrow(ErroXml);
    expect(() => lerXml('<a><b></a></b>')).toThrow(ErroXml);
    expect(() => lerXml('<a>')).toThrow(ErroXml);
  });
});

describe('forma canônica C14N 1.0', () => {
  it('atributos em ordem, declarações primeiro, redundantes fora, vazio aberto e fechado, escapes da especificação', () => {
    const doc = lerXml(
      '<r b="2" xmlns="urn:x" a="1&#xA;&quot;&gt;"><f xmlns="urn:x" xmlns:p="urn:p" p:z="1" c="3"/><g>a&gt;b&#xD;</g></r>',
    );
    expect(canonizar(doc)).toBe(
      '<r xmlns="urn:x" a="1&#xA;&quot;>" b="2"><f xmlns:p="urn:p" c="3" p:z="1"></f><g>a&gt;b&#xD;</g></r>',
    );
  });

  it('no ápice de um subconjunto, as declarações herdadas saem', () => {
    const si = lerXml('<SignedInfo><X/></SignedInfo>');
    expect(canonizar(si, new Map([['', 'http://www.w3.org/2000/09/xmldsig#']]))).toBe(
      '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X></X></SignedInfo>',
    );
  });
});

describe('assinatura XMLDSig do evento', () => {
  it('assina, confere e o resumo é o SHA-256 do evento canônico (conta independente)', () => {
    const assinado = assinarEventoEsocial(EVENTO, certificado());
    expect(assinado.startsWith('<?xml')).toBe(false);
    expect(assinado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>');
    expect(assinado).toContain('<Reference URI="">');
    expect(assinado.indexOf('</evtInfoEmpregador><Signature')).toBeGreaterThan(0);
    // O gerador do Sante SGH já produz a forma canônica (fora o `>` em atributo, que ele não usa).
    const esperado = createHash('sha256')
      .update(EVENTO.replace(/^<\?xml[^>]*\?>/, ''), 'utf8')
      .digest('base64');
    expect(assinado).toContain(`<DigestValue>${esperado}</DigestValue>`);
    const c = conferirAssinaturaEvento(assinado);
    expect(c.ok).toBe(true);
    expect(c.ok && c.certificado.subject).toContain(CNPJ);
  });

  it('adulterado no conteúdo ou na assinatura: não confere; já assinado: recusado', () => {
    const assinado = assinarEventoEsocial(EVENTO, certificado());
    expect(conferirAssinaturaEvento(assinado.replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>'))).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/resumo/),
    });
    const sv = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(assinado)![1]!;
    const trocado = (sv[0] === 'A' ? 'B' : 'A') + sv.slice(1);
    expect(conferirAssinaturaEvento(assinado.replace(sv, trocado))).toMatchObject({ ok: false });
    expect(conferirAssinaturaEvento(EVENTO)).toMatchObject({ ok: false });
    expect(() => assinarEventoEsocial(assinado, certificado())).toThrow(/assinado/);
  });
});

describe('certificado do transmissor (pré-requisito da chave pessoas.esocial)', () => {
  it('e-CNPJ válido: CNPJ do titular; chave cifrada com a senha certa', () => {
    expect(certificado().cnpj).toBe(CNPJ);
    const l = lerCertificadoEsocial(
      {
        certificadoPem: pem(titular.certificado),
        chavePem: chavePem(titular, 'senha-sintetica'),
        senha: 'senha-sintetica',
      },
      agora,
    );
    expect(l.ok).toBe(true);
  });

  it('recusa senha errada, chave de outro certificado, vencido, futuro, sem CNPJ e ilegível', () => {
    const cod = (x: Parameters<typeof lerCertificadoEsocial>[0], quando = agora) => {
      const l = lerCertificadoEsocial(x, quando);
      return l.ok ? 'ok' : l.codigo;
    };
    const certPem = pem(titular.certificado);
    expect(cod({ certificadoPem: certPem, chavePem: chavePem(titular, 'certa'), senha: 'errada' })).toBe(
      'chave-ilegivel',
    );
    const outro = emitirSintetico(raiz, { cpf: null, nome: `OUTRA SINTETICA:${CNPJ}` }, agora);
    expect(cod({ certificadoPem: certPem, chavePem: chavePem(outro) })).toBe('chave-de-outro-certificado');
    expect(cod({ certificadoPem: certPem, chavePem: chavePem(titular) }, new Date('2028-01-01'))).toBe(
      'certificado-vencido',
    );
    expect(cod({ certificadoPem: certPem, chavePem: chavePem(titular) }, new Date('2020-01-01'))).toBe(
      'certificado-futuro',
    );
    const pf = emitirSintetico(raiz, { cpf: null, nome: 'PESSOA SINTETICA' }, agora);
    expect(cod({ certificadoPem: pem(pf.certificado), chavePem: chavePem(pf) })).toBe('certificado-sem-cnpj');
    expect(cod({ certificadoPem: 'lixo', chavePem: 'lixo' })).toBe('certificado-ilegivel');
  });
});

describe('trava de ambiente e disponibilidade (POL-3, regra 3)', () => {
  const arquivos: Record<string, string> = {
    '/cofre/esocial-cert.pem': pem(titular.certificado),
    '/cofre/esocial-chave.pem': chavePem(titular),
  };
  const ler = (c: string) => {
    const v = arquivos[c];
    if (v === undefined) throw new Error('ENOENT');
    return v;
  };
  const completo = {
    AMBIENTE: 'producao',
    ESOCIAL_MODO: 'producao',
    ESOCIAL_CERTIFICADO_ARQUIVO: '/cofre/esocial-cert.pem',
    ESOCIAL_CHAVE_ARQUIVO: '/cofre/esocial-chave.pem',
  };

  it('desligado fora de produção, sem o modo, sem o certificado ou com o certificado ilegível; ligado com tudo', () => {
    expect(transmissorEsocialDoAmbiente({ ...completo, AMBIENTE: 'homolog' }, agora, ler)).toMatchObject({
      transmissor: null,
      motivo: expect.stringMatching(/coletor/),
    });
    expect(
      transmissorEsocialDoAmbiente({ ...completo, ESOCIAL_MODO: 'coletor' }, agora, ler).transmissor,
    ).toBeNull();
    expect(
      transmissorEsocialDoAmbiente({ ...completo, ESOCIAL_CHAVE_ARQUIVO: '' }, agora, ler).motivo,
    ).toMatch(/não está instalado/);
    expect(
      transmissorEsocialDoAmbiente({ ...completo, ESOCIAL_CHAVE_ARQUIVO: '/cofre/x.pem' }, agora, ler).motivo,
    ).toMatch(/não pôde ser lido/);
    expect(transmissorEsocialDoAmbiente(completo, new Date('2028-01-01'), ler).motivo).toMatch(/venceu/);
    const d = transmissorEsocialDoAmbiente(completo, agora, ler);
    expect(d.motivo).toBeNull();
    expect(d.transmissor?.cnpjTransmissor).toBe(CNPJ);
  });

  it('fora de produção o transmissor só fala com o loopback', () => {
    expect(
      () =>
        new TransmissorEsocialSoap(certificado(), {
          ambiente: 'ci',
          urlEnvio: URL_ENVIO_PRODUCAO,
          urlConsulta: 'http://127.0.0.1:1/c',
        }),
    ).toThrow(ErroTransmissorEsocial);
    expect(
      new TransmissorEsocialSoap(certificado(), {
        ambiente: 'ci',
        urlEnvio: 'http://127.0.0.1:1/e',
        urlConsulta: 'http://localhost:1/c',
      }).cnpjTransmissor,
    ).toBe(CNPJ);
  });
});

describe('mensagens SOAP', () => {
  it('envelope do envio e da consulta; recusa empregador ou transmissor inválido e lote vazio', () => {
    const e = envelopeEnvioLote({
      grupo: 1,
      empregador: '11222333',
      transmissor: CNPJ,
      eventos: [{ id: ID, xml: EVENTO }],
    });
    expect(e).toContain('<envioLoteEventos grupo="1">');
    expect(e).toContain(`<evento Id="${ID}"><eSocial xmlns="${NS}">`);
    expect(e).not.toMatch(/<evento[^>]*><\?xml/);
    expect(lerXml(e).nome).toBe('soapenv:Envelope');
    expect(envelopeConsultaLote('1.2.3')).toContain('<protocoloEnvio>1.2.3</protocoloEnvio>');
    expect(() => envelopeEnvioLote({ grupo: 1, empregador: '1', transmissor: CNPJ, eventos: [] })).toThrow();
    expect(() =>
      envelopeEnvioLote({ grupo: 1, empregador: '11222333', transmissor: CNPJ, eventos: [] }),
    ).toThrow(/1 a 50/);
  });

  it('respostas: protocolo, retorno por evento com recibo e ocorrência; Fault vira erro', async () => {
    const sim = new SimuladorEsocial();
    sim.validarXsd = false;
    const assinado = assinarEventoEsocial(EVENTO, certificado());
    const env = envelopeEnvioLote({
      grupo: 1,
      empregador: '11222333',
      transmissor: CNPJ,
      eventos: [{ id: ID, xml: assinado }],
    });
    const r = lerRespostaEnvio(await sim.responder(ACAO_ENVIO, env));
    expect(r.codigo).toBe(201);
    expect(r.protocolo).toMatch(/^1\.2\./);
    expect(sim.recebidos[0]).toMatchObject({ grupo: '1', empregador: '11222333', transmissor: CNPJ });
    sim.rejeitar.set(ID, { codigo: '1234', descricao: 'Regra sintética' });
    sim.consultasEmProcessamento = 1;
    expect(
      lerRespostaConsulta(await sim.responder(ACAO_CONSULTA, envelopeConsultaLote(r.protocolo!))).codigo,
    ).toBe(101);
    const c = lerRespostaConsulta(await sim.responder(ACAO_CONSULTA, envelopeConsultaLote(r.protocolo!)));
    expect(c.codigo).toBe(201);
    expect(c.eventos[0]).toMatchObject({
      id: ID,
      codigo: 401,
      recibo: null,
      ocorrencias: [{ codigo: '1234', descricao: 'Regra sintética' }],
    });
    expect(lerRespostaConsulta(await sim.responder(ACAO_CONSULTA, envelopeConsultaLote('9.9'))).codigo).toBe(
      501,
    );
    expect(lerXml(await sim.responder('x/Outra', '<a/>')).nome).toBe('s:Envelope');
    expect(() =>
      lerRespostaEnvio(
        `<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>Certificado não autorizado</faultstring></s:Fault></s:Body></s:Envelope>`,
      ),
    ).toThrow(/Certificado não autorizado/);
    expect(() => lerRespostaConsulta('<a/>')).toThrow(/retorno esperado/);
  });

  it('respostas de erro do transporte: HTTP 503 e Fault 500', async () => {
    const t = (status: number, corpo: string) =>
      new TransmissorEsocialSoap(certificado(), {
        ambiente: 'ci',
        urlEnvio: 'http://127.0.0.1:1/e',
        urlConsulta: 'http://127.0.0.1:1/c',
        transporte: async () => ({ status, corpo }),
      });
    await expect(t(503, 'fora').consultarLote('1')).rejects.toMatchObject({ codigo: 'servico-indisponivel' });
    await expect(
      t(
        500,
        '<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>Erro</faultstring></s:Fault></s:Body></s:Envelope>',
      ).consultarLote('1'),
    ).rejects.toMatchObject({ codigo: 'resposta-invalida' });
  });
});

describe('TLS mútuo contra o simulador HTTPS local', () => {
  const sim = new SimuladorEsocial();
  sim.validarXsd = false;
  const servidorCert = emitirSintetico(raiz, { cpf: null, nome: 'localhost' }, agora);
  let servidor: Server;
  let porta = 0;
  const clientes: string[] = [];
  beforeAll(async () => {
    servidor = createServer(
      {
        key: chavePem(servidorCert),
        cert: pem(servidorCert.certificado),
        ca: pem(raiz.certificado),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        clientes.push(String((req.socket as TLSSocket).getPeerCertificate().subject?.CN ?? ''));
        const partes: Buffer[] = [];
        req.on('data', (b: Buffer) => partes.push(b));
        req.on('end', async () => {
          const acao = String(req.headers['soapaction'] ?? '').replace(/"/g, '');
          const corpo = await sim.responder(acao, Buffer.concat(partes).toString('utf8'));
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end(corpo);
        });
      },
    );
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
    porta = (servidor.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

  it('envia o lote assinado e consulta o retorno pelo HTTPS com o certificado do transmissor', async () => {
    const cert = certificado();
    const t = new TransmissorEsocialSoap(cert, {
      ambiente: 'ci',
      urlEnvio: `https://localhost:${porta}/envio`,
      urlConsulta: `https://localhost:${porta}/consulta`,
      transporte: transporteHttps(cert, { ca: pem(raiz.certificado) }),
    });
    const r = await t.enviarLote({ grupo: 1, empregador: '11222333', eventos: [{ id: ID, xml: EVENTO }] });
    expect(r.codigo).toBe(201);
    expect(clientes[0]).toBe(`EMPRESA SINTETICA LTDA:${CNPJ}`);
    expect(sim.problemas).toEqual([]);
    const c = await t.consultarLote(r.protocolo!);
    expect(c.codigo).toBe(201);
    expect(c.eventos[0]).toMatchObject({ id: ID, codigo: 201, recibo: '1.1.0000000000000000001' });
  });

  it('sem o certificado do cliente o servidor recusa (TLS mútuo de fato)', async () => {
    const semCliente = transporteHttps(
      { ...certificado(), certificadoPem: '', chavePem: '' } as CertificadoEsocial,
      {
        ca: pem(raiz.certificado),
      },
    );
    await expect(semCliente(`https://localhost:${porta}/envio`, ACAO_ENVIO, '<a/>')).rejects.toBeInstanceOf(
      ErroTransmissorEsocial,
    );
  });
});
