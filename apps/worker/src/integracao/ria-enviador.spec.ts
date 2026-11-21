// W0-03 (M6): o RIA da vacina à RNDS pelo conector. Em dev, o destino é o simulador local (um HTTP em loopback que
// responde como a RNDS): a aplicação, a substituição (a versão retificada, com o relatesTo) e o cancelamento (a versão
// de antes do estorno, entered-in-error); a recusa da RNDS vira o motivo do monitor de recusas; o simulador fora do
// loopback, a vacina inexistente e a homologação sem credencial não enviam nada; com a credencial, a homologação vai
// pelo cliente com o certificado (dublado) e NUNCA por fetch. Nenhuma chamada sai para a RNDS. Dados sintéticos.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const versao = (lote: string) => ({
  id: 7,
  imunobiologico: '33',
  nome: 'Vacina sintetica',
  lote,
  fabricante: null,
  dose: 'D1',
  via: 'IM',
  local: 'DD',
  aplicadaEm: '2031-01-06T09:00',
  vacinador: '41',
});

vi.mock('./porta-propria.js', async (original) => ({
  ...(await original<typeof import('./porta-propria.js')>()),
  // A aplicação (versão 0) e a retificação do lote (versão 1); o estorno não cria versão nova do conteúdo.
  vacinaParaRia: async (_l: unknown, _h: string, id: number) =>
    id === 7 ? { paciente: 5, versoes: [versao('LOTE-1'), versao('LOTE-2')] } : null,
}));

const { criarEnviador } = await import('./enviadores.js');
const { ErroEntrega } = await import('./entrega.js');

const recebidos: {
  url: string;
  tipo: string | undefined;
  chave: string | undefined;
  corpo: Record<string, unknown>;
}[] = [];
let servidor: Server;
let base = '';
let recusar = false;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d: Buffer) => (corpo += d.toString('utf8')));
    req.on('end', () => {
      if (recusar) {
        res.writeHead(422, { 'content-type': 'application/fhir+json' }).end(
          JSON.stringify({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'business-rule', diagnostics: 'Lote 12345678 inexistente' }],
          }),
        );
        return;
      }
      recebidos.push({
        url: req.url ?? '',
        tipo: req.headers['content-type'],
        chave: req.headers['idempotency-key'] as string | undefined,
        corpo: JSON.parse(corpo) as Record<string, unknown>,
      });
      res.writeHead(201, { location: `${base}/api/fhir/r4/Bundle/rnds-${recebidos.length}` }).end();
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const fhir = { codigo: 'rnds', tipo: 'fhir', canal: null } as never;
const envio = (tipoEvento: string, idFato: string | null) =>
  ({ id: '1', tipoEvento, chaveEvento: 'h'.repeat(64), objeto: idFato, chaveOrdem: 'paciente:5' }) as never;
const enviador = (o: {
  ambiente?: string;
  simulador?: string | null;
  rnds?: Parameters<typeof criarEnviador>[0]['rnds'];
}) =>
  criarEnviador({
    ambiente: o.ambiente ?? 'dev',
    produto: 'SGH',
    hostMllp: '127.0.0.1',
    simuladorRnds: o.simulador === undefined ? base : o.simulador,
    destinoApi: () => null,
    ler: (_h, fn) => fn({} as never),
    agora: () => new Date('2031-01-06T12:00:00Z'),
    ...(o.rnds ? { rnds: o.rnds } : {}),
  });
const recursos = (b: Record<string, unknown>) =>
  (b['entry'] as { resource: Record<string, unknown> }[]).map((x) => x.resource);

describe('W0-03 M6: o RIA ao simulador da RNDS (dev)', () => {
  it('aplicação, substituição e cancelamento chegam ao simulador local com a versão certa', async () => {
    // Mesmo com a homologação autorizada e a credencial, no dev o destino é o simulador.
    const e = enviador({ rnds: { homologacaoAutorizada: true, credencial: true } });
    const a = await e(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc');
    expect(a.recibo).toBe('rnds-1');
    expect(a.resposta).toBe('HTTP 201 (simulador)');
    const s = await e(fhir, envio('fato.vacina.substituida', '7.1'), 'pc');
    const c = await e(fhir, envio('fato.vacina.cancelada', '7.2'), 'pc');
    expect(s.recibo).toBe('rnds-2');
    expect(c.recibo).toBe('rnds-3');
    expect(recebidos.map((r) => [r.url, r.tipo, r.chave])).toEqual([
      ['/api/fhir/r4/Bundle', 'application/fhir+json', 'pc-ria-7-v0'],
      ['/api/fhir/r4/Bundle', 'application/fhir+json', 'pc-ria-7-v1'],
      ['/api/fhir/r4/Bundle', 'application/fhir+json', 'pc-ria-7-v2'],
    ]);
    const [ca, ia] = recursos(recebidos[0]!.corpo);
    expect(ca).not.toHaveProperty('relatesTo');
    expect(ia).toMatchObject({ status: 'completed', lotNumber: 'LOTE-1' });
    const [cs, is] = recursos(recebidos[1]!.corpo);
    expect(cs?.['relatesTo']).toEqual([
      { code: 'replaces', targetIdentifier: { system: 'urn:sgh:ria', value: 'ria-pc-7-v0' } },
    ]);
    expect(is).toMatchObject({ status: 'completed', lotNumber: 'LOTE-2' });
    const [cc, ic] = recursos(recebidos[2]!.corpo);
    expect(cc).toMatchObject({ status: 'entered-in-error' });
    // O cancelamento leva a versão que valia antes do estorno (a retificada).
    expect(ic).toMatchObject({ status: 'entered-in-error', lotNumber: 'LOTE-2' });
  });

  it('a recusa da RNDS vira o motivo do envio (dígitos longos mascarados); o conteúdo vai junto para o resumo', async () => {
    recusar = true;
    const r = enviador({})(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc');
    await expect(r).rejects.toBeInstanceOf(ErroEntrega);
    await expect(enviador({})(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc')).rejects.toThrow(
      'recusado pela RNDS (HTTP 422): business-rule: Lote *** inexistente',
    );
    recusar = false;
  });

  it('nada sai: vacina inexistente, evento sem a vacina, simulador fora do loopback ou ausente', async () => {
    const antes = recebidos.length;
    const espiao = vi.spyOn(globalThis, 'fetch');
    await expect(enviador({})(fhir, envio('fato.vacina.aplicada', '99.0'), 'pc')).rejects.toThrow(
      'não encontrada',
    );
    await expect(enviador({})(fhir, envio('fato.vacina.aplicada', null), 'pc')).rejects.toThrow(
      'sem a vacina',
    );
    await expect(
      enviador({ simulador: 'https://rnds.exemplo.gov.br' })(
        fhir,
        envio('fato.vacina.aplicada', '7.0'),
        'pc',
      ),
    ).rejects.toThrow('endereço local');
    await expect(
      enviador({ simulador: null })(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc'),
    ).rejects.toThrow('Simulador da RNDS não configurado');
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
    expect(recebidos).toHaveLength(antes);
  });
});

describe('W0-03 M6: homologação e produção atrás do parâmetro de credencial', () => {
  it('sem a credencial, nada sai (o motivo fica no monitor de recusas)', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    await expect(
      enviador({
        ambiente: 'homolog',
        simulador: null,
        rnds: { homologacaoAutorizada: true, credencial: false },
      })(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc'),
    ).rejects.toThrow('credencial da RNDS ausente (homologação)');
    await expect(
      enviador({ ambiente: 'producao', simulador: null })(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc'),
    ).rejects.toThrow('credencial da RNDS ausente (produção)');
    // Com a credencial mas sem o cliente do certificado: nada sai.
    await expect(
      enviador({
        ambiente: 'homolog',
        simulador: null,
        rnds: { homologacaoAutorizada: true, credencial: true },
      })(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc'),
    ).rejects.toThrow('cliente com o certificado');
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
  });

  it('com a credencial, a homologação vai pelo cliente com o certificado (dublado), nunca por fetch', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    const pedidos: { url: string; autenticacao: string }[] = [];
    const r = await enviador({
      ambiente: 'homolog',
      simulador: null,
      rnds: {
        homologacaoAutorizada: true,
        credencial: true,
        enviarComCertificado: async (d) => {
          pedidos.push(d);
          return { status: 201, corpo: JSON.stringify({ id: 'hmg-1' }), location: null };
        },
      },
    })(fhir, envio('fato.vacina.aplicada', '7.0'), 'pc');
    expect(r).toMatchObject({ recibo: 'hmg-1', resposta: 'HTTP 201 (homologacao)' });
    expect(pedidos).toEqual([
      {
        url: 'https://ehr-services.hmg.saude.gov.br/api/fhir/r4/Bundle',
        autenticacao: 'https://ehr-auth-hmg.saude.gov.br/api/token',
      },
    ]);
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
  });
});

describe('W0-03 M6: o objeto do evento no envio', () => {
  it('a vacina com a versão (0 na aplicação); o exame como antes; sem objeto, nulo', async () => {
    const { fatoDoEvento } = await import('./consumidor-idempotente.js');
    expect(fatoDoEvento({ vacina: 7, paciente: 5 })).toEqual({ entidade: 'vacina_aplicada', objeto: '7.0' });
    expect(fatoDoEvento({ vacina: 7, versao: 2 })).toEqual({ entidade: 'vacina_aplicada', objeto: '7.2' });
    expect(fatoDoEvento({ exame: 501 })).toEqual({ entidade: 'exame_item', objeto: '501' });
    expect(fatoDoEvento({ paciente: 5 })).toEqual({ entidade: null, objeto: null });
  });
});
