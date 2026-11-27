// Transporte da interface com os equipamentos (C3-004), sem banco: equipamento simulado no loopback. ASTM E1381 por TCP
// ida e volta (ENQ, quadros com soma, ACK, NAK com retransmissão, EOT), HL7 por MLLP (ORM^O01 e ACK; ORU^R01 recebido),
// pasta de arquivos (gravar o pedido e ler o retorno), porta serial sem transporte e o simulador determinístico.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASTM_CONTROLE, montarAstmPedido, quadrosAstm } from '@sgh/dominio-sadt';
import { afterEach, describe, expect, it } from 'vitest';
import {
  enviarAstmTcp,
  ErroEquipamento,
  lerPastaRetorno,
  ouvinteEquipamento,
  type PedidoNaFila,
  portaDoOuvinte,
  transporteReal,
  transporteSimulado,
  valorSimulado,
} from './entrega-equipamento.js';

const servidores: Server[] = [];
afterEach(() => {
  for (const s of servidores.splice(0)) s.close();
});
const ouvir = (s: Server) =>
  new Promise<number>((ok) => {
    servidores.push(s);
    s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port));
  });

const pedido = (protocolo: string, extra: Partial<PedidoNaFila['interface']> = {}): PedidoNaFila => ({
  id: 41,
  estabelecimento: 1,
  interface: { id: 9, protocolo, host: '127.0.0.1', porta: null, caminhoEnvio: null, ...extra },
  amostra: 'AM001',
  urgente: false,
  testes: ['GLI', 'URE'],
  astm: null,
});

describe('entrega aos equipamentos do laboratório (C3-004)', () => {
  it('ASTM E1381 por TCP: o receptor confere cada quadro e entrega a mensagem inteira no EOT', async () => {
    const recebidas: { chave: string; amostras: unknown }[] = [];
    const porta = await ouvir(ouvinteEquipamento('astm', async (r) => void recebidas.push(r)));
    const msg = ['H|\\^&', 'O|1|AM001||^^^GLI|R', 'R|1|^^^GLI|98|mg/dL', 'L|1|N'].join('\r') + '\r';
    const recibo = await enviarAstmTcp('127.0.0.1', porta, msg);
    expect(recibo).toBe('ASTM-4');
    await new Promise((r) => setTimeout(r, 50));
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]!.amostras).toEqual([
      { amostra: 'AM001', leituras: [{ codigo: 'GLI', valor: '98' }] },
    ]);
  });

  it('NAK repete o quadro; seis NAK desistem; NAK no ENQ é equipamento ocupado', async () => {
    const { ACK, NAK, ENQ } = ASTM_CONTROLE;
    let naks = 1;
    const quadros: string[] = [];
    const umNak = createServer((s) =>
      s.on('data', (d) => {
        const t = d.toString('latin1');
        if (t.startsWith('\x02')) quadros.push(t);
        s.write(t !== ENQ && t.startsWith('\x02') && naks-- > 0 ? NAK : ACK);
      }),
    );
    const msg = montarAstmPedido({ amostra: 'AM001', testes: ['GLI'], urgente: false });
    expect(await enviarAstmTcp('127.0.0.1', await ouvir(umNak), msg)).toBe('ASTM-4');
    expect(quadros[0]).toBe(quadros[1]);
    expect(quadros).toHaveLength(quadrosAstm(msg).length + 1);
    const sempreNak = createServer((s) =>
      s.on('data', (d) => s.write(d.toString('latin1') === ENQ ? ACK : NAK)),
    );
    await expect(enviarAstmTcp('127.0.0.1', await ouvir(sempreNak), msg)).rejects.toThrow('seis vezes');
    const ocupado = createServer((s) => s.on('data', () => s.write(NAK)));
    await expect(enviarAstmTcp('127.0.0.1', await ouvir(ocupado), msg)).rejects.toThrow('ocupado');
  });

  it('HL7 por MLLP: o pedido ORM^O01 sai e o ACK volta como recibo; o ORU^R01 recebido ganha ACK', async () => {
    const recebidas: { chave: string; amostras: unknown }[] = [];
    const porta = await ouvir(ouvinteEquipamento('hl7', async (r) => void recebidas.push(r)));
    const t = transporteReal('desenvolvimento', () => new Date('2026-11-27T10:00:00Z'));
    // o ouvinte do sistema também responde ACK: serve de equipamento simulado para a ida
    const e = await t(pedido('hl7', { porta }));
    expect(e.recibo).toBe('AA-SGH41');
    expect(recebidas[0]!.chave).toBe('HL7-SGH41');
    const oru = 'MSH|^~\\&|EQ|LAB|SGH|LAB|||ORU^R01|R5|P|2.5.1\rOBR|1|AM001\rOBX|1|NM|GLI||101\r';
    const s = connect({ host: '127.0.0.1', port: porta });
    s.write(Buffer.from(`\x0b${oru}\x1c\r`, 'latin1'));
    const ack = await new Promise<string>((ok) => s.once('data', (d) => ok(d.toString('latin1'))));
    s.destroy();
    expect(ack).toContain('MSA|AA|R5');
    expect(recebidas[1]).toEqual({
      chave: 'HL7-R5',
      amostras: [{ amostra: 'AM001', leituras: [{ codigo: 'GLI', valor: '101' }] }],
    });
  });

  it('pasta de arquivos: grava o pedido ASTM e lê o resultado do retorno; serial e outros falham com o motivo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sgh-equip-'));
    try {
      const envio = join(dir, 'envio');
      const e = await transporteReal('desenvolvimento')(pedido('arquivo', { caminhoEnvio: envio }));
      expect(e.recibo).toBe('ARQ-AM001-41.astm');
      expect(await readdir(envio)).toEqual(['AM001-41.astm']);
      expect(await readFile(join(envio, 'AM001-41.astm'), 'latin1')).toContain('O|1|AM001||^^^GLI\\^^^URE|R');
      const ret = join(dir, 'ret');
      await rm(ret, { recursive: true, force: true });
      await import('node:fs/promises').then((f) => f.mkdir(ret));
      await writeFile(join(ret, 'r1.txt'), 'H|\\^&\rO|1|AM001\rR|1|^^^URE|30\rL|1|N\r');
      expect(await lerPastaRetorno(ret)).toEqual([
        {
          arquivo: join(ret, 'r1.txt'),
          chave: 'ARQ-r1.txt',
          amostras: [{ amostra: 'AM001', leituras: [{ codigo: 'URE', valor: '30' }] }],
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await expect(transporteReal('desenvolvimento')(pedido('serial'))).rejects.toThrow('porta serial');
    await expect(transporteReal('desenvolvimento')(pedido('servico_web'))).rejects.toThrow(
      'definição do fornecedor',
    );
    await expect(
      transporteReal('desenvolvimento')(pedido('astm', { host: '10.0.0.5', porta: 5000 })),
    ).rejects.toThrow('loopback');
    expect(portaDoOuvinte('tcp:5100')).toBe(5100);
    expect(portaDoOuvinte('/pasta')).toBeNull();
  });

  it('simulador da central: determinístico, com resultado sintético no aceite; recusa e erro pela amostra', async () => {
    const a = await transporteSimulado(pedido('astm'));
    expect(a.recibo).toMatch(/^SIM-/);
    expect(await transporteSimulado(pedido('astm'))).toEqual(a);
    expect(a.resultado).toEqual([
      {
        amostra: 'AM001',
        leituras: [
          { codigo: 'GLI', valor: valorSimulado('AM001', 'GLI') },
          { codigo: 'URE', valor: valorSimulado('AM001', 'URE') },
        ],
      },
    ]);
    await expect(transporteSimulado({ ...pedido('astm'), amostra: 'AM2-RECUSA' })).rejects.toThrow(
      'SIM-RECUSA',
    );
    await expect(transporteSimulado({ ...pedido('astm'), amostra: 'AM3-ERRO' })).rejects.toBeInstanceOf(
      ErroEquipamento,
    );
  });
});
