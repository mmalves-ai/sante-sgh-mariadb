// 03-PEP L131: cópia do prontuário no balcão (pedido, autorização, produção e entrega). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  copiaAtrasada,
  type EntregaCopia,
  type PedidoCopiaBalcao,
  prazoDaCopia,
  transicaoCopia,
  validarEntregaCopia,
  validarPedidoCopiaBalcao,
} from './copia-balcao.js';
import { cpfValido } from '../assinatura/certificado.js';

const CPF = '52998224725'; // CPF sintético de exemplo (dígitos verificadores válidos)
const pedido = (p: Partial<PedidoCopiaBalcao> = {}): PedidoCopiaBalcao => ({
  solicitanteTipo: 'paciente',
  solicitanteNome: 'Paciente Sintético',
  solicitanteCpf: null,
  solicitanteParentesco: null,
  motivo: 'Segunda opinião médica',
  periodoInicio: '2030-01-01',
  periodoFim: '2030-02-01',
  prazoDias: 15,
  formato: 'impresso',
  temProcuracao: false,
  hoje: '2030-03-01',
  ...p,
});
const entrega = (e: Partial<EntregaCopia> = {}): EntregaCopia => ({
  situacao: 'pronta',
  solicitanteTipo: 'paciente',
  forma: 'presencial',
  recebedorNome: 'Paciente Sintético',
  vinculo: 'proprio_paciente',
  temTipoDocumento: true,
  numeroDocumento: '1234567',
  temProcuracao: false,
  quantidadeFolhas: 12,
  endereco: null,
  ...e,
});
const campos = (f: { campo: string }[]) => f.map((x) => x.campo);

describe('pedido da cópia no balcão', () => {
  it('o paciente pede sem CPF; prazo e período válidos', () => {
    expect(validarPedidoCopiaBalcao(pedido())).toEqual([]);
    expect(prazoDaCopia('2030-03-01', 15)).toBe('2030-03-16');
  });
  it('o CPF confere pelos dígitos', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
  });
  it('terceiro precisa de CPF, parentesco e, se procurador, da procuração', () => {
    expect(campos(validarPedidoCopiaBalcao(pedido({ solicitanteTipo: 'familiar' })))).toEqual([
      'solicitanteCpf',
      'solicitanteParentesco',
    ]);
    expect(
      campos(validarPedidoCopiaBalcao(pedido({ solicitanteTipo: 'procurador', solicitanteCpf: CPF }))),
    ).toEqual(['procuracao']);
    expect(
      validarPedidoCopiaBalcao(
        pedido({ solicitanteTipo: 'procurador', solicitanteCpf: CPF, temProcuracao: true }),
      ),
    ).toEqual([]);
    expect(validarPedidoCopiaBalcao(pedido({ solicitanteTipo: 'autoridade_judicial' }))).toEqual([]);
  });
  it('recusa período invertido ou futuro, motivo curto e prazo acima de 15 dias', () => {
    expect(
      campos(
        validarPedidoCopiaBalcao(
          pedido({ periodoInicio: '2030-02-10', periodoFim: '2030-02-01', motivo: 'x', prazoDias: 16 }),
        ),
      ),
    ).toEqual(['motivo', 'periodoFim', 'prazoDias']);
    expect(campos(validarPedidoCopiaBalcao(pedido({ periodoFim: '2030-04-01' })))).toEqual(['periodoFim']);
  });
  it('atraso só do pedido em aberto', () => {
    expect(copiaAtrasada('autorizada', '2030-03-01', '2030-03-02')).toBe(true);
    expect(copiaAtrasada('entregue', '2030-03-01', '2030-03-02')).toBe(false);
    expect(copiaAtrasada('pronta', '2030-03-02', '2030-03-02')).toBe(false);
  });
});

describe('transição da cópia', () => {
  const a = (acao: Parameters<typeof transicaoCopia>[1]['acao'], extra = {}) => ({
    acao,
    solicitanteTipo: 'paciente' as const,
    temAutorizacao: false,
    motivo: null,
    ...extra,
  });
  it('paciente: solicitada → análise → autorizada → produção → pronta', () => {
    expect(transicaoCopia('solicitada', a('analisar'))).toEqual({ situacao: 'em_analise' });
    expect(transicaoCopia('em_analise', a('autorizar'))).toEqual({ situacao: 'autorizada' });
    expect(transicaoCopia('autorizada', a('produzir'))).toEqual({ situacao: 'em_producao' });
    expect(transicaoCopia('em_producao', a('pronta'))).toEqual({ situacao: 'pronta' });
  });
  it('terceiro só é autorizado com a autorização digitalizada', () => {
    expect(transicaoCopia('solicitada', a('autorizar', { solicitanteTipo: 'familiar' }))).toMatchObject({
      recusa: { campo: 'autorizacao' },
    });
    expect(
      transicaoCopia('solicitada', a('autorizar', { solicitanteTipo: 'familiar', temAutorizacao: true })),
    ).toEqual({ situacao: 'autorizada' });
  });
  it('negar e cancelar pedem motivo; encerrado não muda; pronta não se nega', () => {
    expect(transicaoCopia('em_analise', a('negar'))).toMatchObject({ recusa: { campo: 'motivo' } });
    expect(transicaoCopia('em_analise', a('negar', { motivo: 'Sem legitimidade' }))).toEqual({
      situacao: 'negada',
    });
    expect(transicaoCopia('pronta', a('negar', { motivo: 'Sem legitimidade' }))).toMatchObject({
      recusa: { campo: 'situacao' },
    });
    expect(transicaoCopia('pronta', a('cancelar', { motivo: 'Desistência do paciente' }))).toEqual({
      situacao: 'cancelada',
    });
    expect(transicaoCopia('entregue', a('cancelar', { motivo: 'Desistência' }))).toMatchObject({
      recusa: { campo: 'situacao' },
    });
    expect(transicaoCopia('solicitada', a('pronta'))).toMatchObject({ recusa: { campo: 'situacao' } });
  });
});

describe('entrega da cópia no balcão', () => {
  it('o próprio paciente recebe com documento e folhas', () => {
    expect(validarEntregaCopia(entrega())).toEqual([]);
  });
  it('só cópia pronta, com identidade conferida e folhas', () => {
    expect(
      campos(
        validarEntregaCopia(
          entrega({ situacao: 'autorizada', numeroDocumento: '12', quantidadeFolhas: 0, recebedorNome: 'x' }),
        ),
      ),
    ).toEqual(['situacao', 'recebedorNome', 'numeroDocumento', 'quantidadeFolhas']);
  });
  it('quem não tem vínculo só recebe como procurador, com procuração', () => {
    expect(campos(validarEntregaCopia(entrega({ vinculo: 'irmao' })))).toEqual(['vinculo']);
    expect(campos(validarEntregaCopia(entrega({ vinculo: 'procurador' })))).toEqual(['procuracao']);
    expect(validarEntregaCopia(entrega({ vinculo: 'procurador', temProcuracao: true }))).toEqual([]);
    expect(validarEntregaCopia(entrega({ solicitanteTipo: 'familiar', vinculo: 'filho' }))).toEqual([]);
  });
  it('pelo correio leva o endereço', () => {
    expect(campos(validarEntregaCopia(entrega({ forma: 'correio' })))).toEqual(['endereco']);
    expect(
      validarEntregaCopia(entrega({ forma: 'correio', endereco: 'Rua Sintética, 100, Centro' })),
    ).toEqual([]);
  });
});
