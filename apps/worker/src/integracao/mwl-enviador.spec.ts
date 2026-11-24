// M47 (etapa 3), regras 8 e 9: o envio do item da lista de trabalho DICOM ao destino em loopback (o simulador de
// modalidade atrás de um HTTP local): o JSON do DICOM com o número de acesso, a chave de idempotência que não muda no
// reenvio (o simulador atualiza, não duplica), o destino fora do loopback recusado fora de produção e a falha do destino
// como erro de entrega (a retentativa e a fila de mortos são as do M34). Leituras da porta própria dubladas; dados
// sintéticos.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SimuladorModalidade } from '@sgh/dominio-sadt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const estado = {
  suspenso: false,
  fuso: 'America/Sao_Paulo',
  // O destino da lista de trabalho por estabelecimento (parâmetro pacs.parceiroWorklist, parceiro ativo com o evento).
  destino: { pc: 'pacs', pd: 'pacs-d' } as Record<string, string | null>,
};

vi.mock('./destino-worklist.js', async (original) => ({
  ...(await original<typeof import('./destino-worklist.js')>()),
  destinoDaWorklistNoEstabelecimento: async (_l: unknown, h: string) => estado.destino[h] ?? null,
}));

vi.mock('./porta-propria.js', async (original) => ({
  ...(await original<typeof import('./porta-propria.js')>()),
  itemListaTrabalho: async (_l: unknown, _h: string, id: number) =>
    id === 501 ? { accession: 'PC000000007', modalidade: 'CT' } : null,
  examePedido: async (_l: unknown, _h: string, id: number) =>
    id === 501
      ? {
          id: 501,
          cancelado: estado.suspenso,
          urgente: false,
          paciente: {
            id: 900001,
            prontuario: 1001,
            nome: 'Paciente Sintético Um',
            nascimento: '1980-01-02',
            sexo: 'M',
          },
          atendimento: 25,
          exame: { codigo: 'TC', nome: 'TOMOGRAFIA SINTÉTICA' },
          apoio: null,
          modalidade: 'CT',
          solicitadoEm: new Date('2026-10-25T12:00:00Z'),
          agendadoPara: new Date('2026-10-25T12:30:00Z'),
          solicitante: 'Médico Sintético',
          fuso: estado.fuso,
        }
      : null,
}));

const { criarEnviador } = await import('./enviadores.js');
const { ErroEntrega } = await import('./entrega.js');

const sim = new SimuladorModalidade();
const recebidos: { chave: string | undefined; tipo: string | undefined }[] = [];
let servidor: Server;
let base = '';
let falhar = false;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d: Buffer) => (corpo += d.toString('utf8')));
    req.on('end', () => {
      if (falhar) {
        res.writeHead(503).end();
        return;
      }
      recebidos.push({
        chave: req.headers['idempotency-key'] as string | undefined,
        tipo: req.headers['content-type'],
      });
      const r = sim.receber(JSON.parse(corpo) as Record<string, unknown>);
      res.writeHead(201, { 'x-recibo': `${r.situacao}-${r.accession}` }).end();
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/mwl`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const parceiro = { codigo: 'pacs', tipo: 'api', canal: null } as never;
const envio = (idFato: string | null) =>
  ({
    id: '1',
    tipoEvento: 'imagem.mwl',
    chaveEvento: 'h'.repeat(64),
    objeto: idFato,
    chaveOrdem: 'exame:501',
  }) as never;
const enviador = (destino: string | null, ambiente = 'dev') =>
  criarEnviador({
    ambiente,
    produto: 'SGH',
    hostMllp: '127.0.0.1',
    simuladorRnds: null,
    destinoApi: () => destino,
    ler: (_h, fn) => fn({} as never),
    agora: () => new Date('2026-10-25T12:00:00Z'),
  });

describe('envio do item da lista de trabalho DICOM (M47.3)', () => {
  it('o JSON do DICOM chega ao simulador; o reenvio leva a mesma chave e o simulador atualiza o item', async () => {
    const a = await enviador(base)(parceiro, envio('501'), 'pc');
    expect(a.recibo).toBe('criado-PC000000007');
    const item = JSON.parse(a.conteudo) as Record<string, { Value?: unknown[] }>;
    expect(item['00080050']?.Value).toEqual(['PC000000007']);
    expect(item['00100020']?.Value).toEqual(['1001']);
    const b = await enviador(base)(parceiro, envio('501'), 'pc');
    expect(b.recibo).toBe('atualizado-PC000000007');
    expect(sim.itens()).toHaveLength(1);
    expect(recebidos).toEqual([
      { chave: 'pc-PC000000007', tipo: 'application/dicom+json' },
      { chave: 'pc-PC000000007', tipo: 'application/dicom+json' },
    ]);
  });

  it('a hora agendada sai no fuso do estabelecimento (Manaus: UTC-4)', async () => {
    const horas = async () => {
      const r = await enviador(base)(parceiro, envio('501'), 'pc');
      return JSON.stringify(JSON.parse(r.conteudo));
    };
    const sp = await horas();
    estado.fuso = 'America/Manaus';
    const manaus = await horas();
    estado.fuso = 'America/Sao_Paulo';
    expect(sp).toContain('"0930');
    expect(manaus).toContain('"0830');
    expect(manaus).not.toContain('"0930');
  });

  it('sem o item, sem o exame ou com destino fora do loopback fora de produção: erro de entrega (nada enviado)', async () => {
    await expect(enviador(base)(parceiro, envio('999'), 'pc')).rejects.toBeInstanceOf(ErroEntrega);
    await expect(enviador(base)(parceiro, envio(null), 'pc')).rejects.toThrow('sem o exame');
    await expect(enviador('https://pacs.hospital.com.br/mwl')(parceiro, envio('501'), 'pc')).rejects.toThrow(
      'fora do loopback',
    );
    await expect(enviador(null)(parceiro, envio('501'), 'pc')).rejects.toThrow('sem destino');
  });

  it('o destino que falha devolve o código (a retentativa e a fila de mortos seguem as do M34)', async () => {
    falhar = true;
    await expect(enviador(base)(parceiro, envio('501'), 'pc')).rejects.toThrow('HTTP 503');
    falhar = false;
  });

  it('o parceiro que não é o destino do estabelecimento da mensagem não recebe nada (o PACS de outro hospital)', async () => {
    const antes = recebidos.length;
    // A mensagem do hospital pd tem destino pacs-d: o parceiro pacs não recebe o paciente dele.
    await expect(enviador(base)(parceiro, envio('501'), 'pd')).rejects.toThrow('não é o destino');
    // Sem destino no estabelecimento (parâmetro vazio ou parceiro desativado): nada sai.
    estado.destino['pc'] = null;
    await expect(enviador(base)(parceiro, envio('501'), 'pc')).rejects.toThrow('não é o destino');
    estado.destino['pc'] = 'pacs';
    expect(recebidos).toHaveLength(antes);
  });

  it('cancelado o exame: erro de entrega com o motivo, nada chega ao PACS (sem chave de liberação: só o destino e o exame decidem)', async () => {
    const antes = recebidos.length;
    estado.suspenso = true;
    await expect(enviador(base)(parceiro, envio('501'), 'pc')).rejects.toThrow('exame cancelado');
    estado.suspenso = false;
    expect(recebidos).toHaveLength(antes);
  });
});
