// Regra 12 (contrato): a mensagem de referência do pedido ao laboratório de apoio (ORM^O01), a leitura do resultado
// (ORU^R01), o ACK e o MLLP. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  dataHl7,
  deMllp,
  desescapar,
  emMllp,
  escapar,
  lerAck,
  lerDataHl7,
  lerMensagem,
  lerResultadoApoio,
  montarAck,
  montarPedidoApoio,
  type PedidoApoio,
} from './mensagem.js';

const CAB = {
  aplicacaoOrigem: 'SGH',
  instituicaoOrigem: 'PC',
  aplicacaoDestino: 'APOIO',
  instituicaoDestino: 'LAB',
  dataHora: new Date('2026-10-22T09:30:00Z'),
  controle: 'SGH-pc-0000001',
  processamento: 'T' as const,
};

const PEDIDO: PedidoApoio = {
  cabecalho: CAB,
  paciente: {
    id: 1001,
    prontuario: 501,
    nome: 'Paciente Fictício Um',
    nascimento: new Date('1980-02-03T00:00:00Z'),
    sexo: 'F',
  },
  atendimento: { numero: 31337, classe: 'O' },
  pedido: 900001,
  exame: { codigo: '17ALF', nome: '17 ALFA HIDROXI | PROGESTERONA', material: 'SORO' },
  solicitadoEm: new Date('2026-10-22T09:00:00Z'),
  urgente: false,
};

describe('HL7 v2 (regra 12)', () => {
  it('escape dos separadores e volta', () => {
    const t = 'a|b^c~d&e\\f\r\ng';
    expect(escapar(t)).toBe('a\\F\\b\\S\\c\\R\\d\\T\\e\\E\\f g');
    expect(desescapar(escapar('a|b^c~d&e\\f'))).toBe('a|b^c~d&e\\f');
  });

  it('a mensagem de referência do pedido (ORM^O01) para o laboratório de apoio', () => {
    const m = montarPedidoApoio(PEDIDO);
    expect(m.split('\r').filter(Boolean)).toEqual([
      'MSH|^~\\&|SGH|PC|APOIO|LAB|20261022093000||ORM^O01^ORM_O01|SGH-pc-0000001|T|2.5',
      'PID|1||1001^^^^PI||Um^Paciente Fictício||19800203|F',
      'PV1|1|O|||||||||||||||||31337',
      'ORC|NW|900001|||||^^^^^R||20261022090000',
      'OBR|1|900001||17ALF^17 ALFA HIDROXI \\F\\ PROGESTERONA|R|20261022090000|||||||||SORO',
    ]);
    const lida = lerMensagem(m);
    expect(lida.tipo).toBe('ORM^O01^ORM_O01');
    expect(lida.controle).toBe('SGH-pc-0000001');
    expect(() => montarPedidoApoio({ ...PEDIDO, cabecalho: { ...CAB, controle: 'com espaço' } })).toThrow(
      /MSH-10/,
    );
  });

  it('lê o resultado (ORU^R01): pedido, exame, valores e observações', () => {
    const oru = [
      'MSH|^~\\&|APOIO|LAB|SGH|PC|20261022120000||ORU^R01^ORU_R01|LAB-778899|T|2.5',
      'PID|1||1001^^^^PI',
      'OBR|1|900001|PROT-55|17ALF^17 ALFA HIDROXI PROGESTERONA',
      'OBX|1|NM|17OHP^17-OH progesterona||1.25|ng/mL|0,20 a 1,30||||F',
      'OBX|2|ST|MET^Método||Quimioluminescência||||||F',
      'NTE|1||Amostra conferida \\T\\ processada',
    ].join('\r');
    const r = lerResultadoApoio(oru);
    expect(r).toEqual({
      controle: 'LAB-778899',
      pedido: 900001,
      exameLaboratorio: '17ALF',
      protocolo: 'PROT-55',
      valores: [
        {
          codigo: '17OHP',
          nome: '17-OH progesterona',
          tipo: 'NM',
          valor: '1.25',
          unidade: 'ng/mL',
          referencia: '0,20 a 1,30',
          situacao: 'F',
        },
        {
          codigo: 'MET',
          nome: 'Método',
          tipo: 'ST',
          valor: 'Quimioluminescência',
          unidade: '',
          referencia: '',
          situacao: 'F',
        },
      ],
      observacoes: ['Amostra conferida & processada'],
    });
    expect(() => lerResultadoApoio(oru.replace('ORU^R01^ORU_R01', 'ADT^A01'))).toThrow(/esperado ORU/);
    expect(() => lerResultadoApoio(oru.replace('LAB-778899', ''))).toThrow(/MSH-10/);
    expect(() => lerResultadoApoio('PID|1')).toThrow(/MSH/);
    expect(() =>
      lerResultadoApoio(
        oru
          .split('\r')
          .filter((l) => !l.startsWith('OBR'))
          .join('\r'),
      ),
    ).toThrow(/OBR/);
  });

  it('ACK com o MSA-2 igual ao MSH-10 da original', () => {
    const original = lerMensagem(montarPedidoApoio(PEDIDO));
    const ack = montarAck(original, 'AA', 'recebida', { ...CAB, controle: 'ACK-1' });
    expect(lerAck(ack)).toEqual({ codigo: 'AA', controle: 'SGH-pc-0000001', texto: 'recebida' });
    expect(() => lerAck('MSH|^~\\&|A')).toThrow(/MSA/);
  });

  it('MLLP: enquadra, separa várias mensagens e devolve o resto incompleto', () => {
    const a = emMllp('MSH|1');
    const b = emMllp('MSH|2');
    const meia = emMllp('MSH|3').slice(0, 4);
    const fluxo = new Uint8Array([...a, ...b, ...meia]);
    const r = deMllp(fluxo);
    expect(r.mensagens).toEqual(['MSH|1', 'MSH|2']);
    expect([...r.resto]).toEqual([...meia]);
    expect(deMllp(new Uint8Array([1, 2, 3])).mensagens).toEqual([]);
  });

  it('datas HL7 no relógio de parede', () => {
    expect(dataHl7(new Date('2026-01-02T03:04:05Z'))).toBe('20260102030405');
    expect(lerDataHl7('20260102030405')).toEqual(new Date('2026-01-02T03:04:05Z'));
    expect(lerDataHl7('20260102')).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(lerDataHl7('x')).toBeNull();
  });
});
