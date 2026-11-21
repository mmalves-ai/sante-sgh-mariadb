// O montador do lote (M31; regras 1, 3 e 4): o XML válido é guardado (chave única por lote e hash, SHA-256 do arquivo);
// o inválido não é guardado e vem explicado; a sobrescrita da chave é recusada (guarda imutável).
import { describe, expect, it } from 'vitest';
import type { DadosLoteTiss } from '@sgh/contratos';
import { chaveXmlLote, criarMontadorLote, guardaXmlMemoria, sha256Hex } from './montador.js';

const dados = (cnes = '9999999', registroAns = '999999'): DadosLoteTiss => ({
  hospital: 'pc',
  lote: 77,
  convenio: 301,
  numeroLote: '000000000123',
  sequencial: '000000000123',
  prestador: { registroAns, codigoPrestador: 'PRESTTESTE01', cnes, nome: 'HOSPITAL FICTÍCIO' },
  agora: new Date('2026-10-23T12:00:00Z'),
  contas: [
    {
      conta: 1,
      tipoGuia: 2,
      numeroGuia: 'SINT-1',
      carteira: 'SINTETICO0001',
      atendimentoRN: false,
      inicio: { data: '2026-10-01', hora: '08:00:00' },
      fim: { data: '2026-10-01', hora: '09:00:00' },
      caraterAtendimento: '1',
      tipoConsulta: '1',
      tipoAtendimento: '23',
      senha: '',
      guiaSolicitacao: '',
      dataAutorizacao: '',
      tipoFaturamento: '4',
      tipoInternacao: '1',
      regimeInternacao: '1',
      motivoEncerramento: '12',
      profissional: { conselho: '06', numeroConselho: '0', uf: '33', cbos: '225125' },
      profissionalNome: 'PROFISSIONAL',
      profissionalCodigo: '',
      itens: [
        {
          sequencial: 1,
          tipo: 3,
          natureza: 'procedimento',
          data: '2026-10-01',
          codigo: '40301630',
          codigoTabela: '22',
          descricao: 'EXAME SINTÉTICO',
          quantidade: 1,
          valorUnitario: 10,
        },
      ],
    },
  ],
});

describe('montador do lote', () => {
  it('válido: guardado com a chave do lote e o SHA-256 do arquivo', async () => {
    const g = guardaXmlMemoria();
    const m = await criarMontadorLote(g)(dados());
    expect(m.valido).toBe(true);
    expect(m.hashArquivo).toMatch(/^[0-9a-f]{64}$/);
    expect(m.chaveObjeto).toBe(
      chaveXmlLote({ hospital: 'pc', convenio: 301, numeroLote: '000000000123' }, m.hashArquivo),
    );
    expect(g.objetos.size).toBe(1);
    expect(await sha256Hex(g.objetos.get(m.chaveObjeto)!)).toBe(m.hashArquivo);
    expect(m.valor).toBe(10);
  });
  it('inválido no XSD: não guardado, com a explicação', async () => {
    const g = guardaXmlMemoria();
    const m = await criarMontadorLote(g)(dados('12345678'));
    expect(m.valido).toBe(false);
    expect(m.explicacao.join(' ')).toMatch(/CNES/);
    expect(g.objetos.size).toBe(0);
  });
  it('cadastro incompleto: não monta', async () => {
    const m = await criarMontadorLote(guardaXmlMemoria())(dados('9999999', ''));
    expect(m.valido).toBe(false);
    expect(m.erros[0]).toMatch(/registro ANS/);
  });
  it('a sobrescrita da chave guardada é recusada (imutável)', async () => {
    const g = guardaXmlMemoria();
    await g('k', new Uint8Array([1]));
    await expect(g('k', new Uint8Array([2]))).rejects.toThrow(/imutável/);
  });
});
