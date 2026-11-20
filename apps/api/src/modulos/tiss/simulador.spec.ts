// O simulador de operadora (M31; regra 13): o contrato da resposta (o mesmo do consumidor do worker em produção) com o
// XML do lote 04.03.00 válido e com o XML adulterado. Massa sintética.
import { describe, expect, it } from 'vitest';
import { latin1, mensagemLoteGuias } from '@sgh/dominio-faturamento';
import { simularOperadora } from './simulador.js';

const cab = {
  sequencialTransacao: '1',
  data: '2026-10-23',
  hora: '10:00:00',
  codigoPrestadorNaOperadora: 'PRESTSINT01',
  registroANS: '999999',
};
const guia = {
  tipo: 'consulta' as const,
  numeroGuiaPrestador: 'SINT-1',
  beneficiario: { numeroCarteira: 'SINTETICO0001', atendimentoRN: 'N' as const },
  cnes: '9999999',
  profissional: { conselho: '06', numeroConselho: '0', uf: '33', cbos: '225125' },
  dataAtendimento: '2026-10-20',
  tipoConsulta: '1' as const,
  procedimento: { codigoTabela: '22', codigo: '10101012' },
  valor: 100,
};

describe('simulador de operadora (contrato)', () => {
  it('lote válido: aceito, protocolo SIM com até 12 caracteres, recibo e situação 1 (recebido)', async () => {
    const m = mensagemLoteGuias(cab, '42', [guia]);
    expect(await simularOperadora(8100, m.bytes)).toEqual({
      aceito: true,
      protocolo: 'SIM000008100',
      recibo: 'RECIBO-SIMULADO-8100',
      situacao: 1,
      erros: [],
    });
  });
  it('XML adulterado: recusado com os erros (hash do epílogo)', async () => {
    const m = mensagemLoteGuias(cab, '42', [guia]);
    const r = await simularOperadora(8100, latin1(m.xml.replace('100.00', '900.00')));
    expect(r.aceito).toBe(false);
    expect(r.protocolo).toBeNull();
    expect(r.erros).toContain('hash do epílogo não confere');
  });
});
