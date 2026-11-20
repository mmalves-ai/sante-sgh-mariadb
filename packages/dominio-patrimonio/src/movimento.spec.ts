// Regra 13 do M54 (ficha, seção 8): transferência exige o aceite de quem recebe; inventário registra divergência sem
// corrigir sozinho (o inventário em inventario.spec.ts). Dados sintéticos.
import { esquemaRegistrarMovimento, type RegistrarMovimento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type BemParaMovimento,
  efeitoDoMovimento,
  type MovimentoParaDecisao,
  problemasDaDecisao,
  problemasDoCancelamento,
  problemasDoMovimento,
} from './movimento.js';

const bem = (extra: Partial<BemParaMovimento> = {}): BemParaMovimento => ({
  id: 1,
  situacao: 'ativo',
  centro: 10,
  dataAquisicao: '2026-01-10',
  versao: 3,
  ultimaCompetencia: '2026-08',
  movimentoPendente: null,
  ...extra,
});
const C = { hoje: '2026-10-29', centrosAtivos: new Set([10, 20]) };
const mov = (x: Record<string, unknown>): RegistrarMovimento =>
  esquemaRegistrarMovimento.parse({ bem: 1, versao: 3, data: '2026-10-20', motivo: 'Reorganização', ...x });
const codigos = (b: BemParaMovimento, x: RegistrarMovimento) =>
  problemasDoMovimento(b, x, C).map((p) => p.codigo);

describe('regra 13: transferência com aceite', () => {
  const t = mov({ tipo: 'transferencia', destino: 20 });
  it('o pedido fica pendente e o bem não muda até o aceite', () => {
    expect(codigos(bem(), t)).toEqual([]);
    expect(efeitoDoMovimento(bem(), t)).toEqual({ situacaoMovimento: 'pendente', bem: null });
  });
  it('mesmo setor, destino inativo, bem emprestado, com pedido pendente, versão velha', () => {
    expect(codigos(bem(), mov({ tipo: 'transferencia', destino: 10 }))).toEqual(['mesmo-centro']);
    expect(codigos(bem(), mov({ tipo: 'transferencia', destino: 99 }))).toEqual(['destino']);
    expect(codigos(bem({ situacao: 'emprestado' }), t)).toEqual(['emprestado']);
    expect(codigos(bem({ movimentoPendente: { id: 7 } }), t)).toEqual(['pendente']);
    expect(codigos(bem({ versao: 4 }), t)).toEqual(['desatualizado']);
  });
  it('quem pediu não decide; outra pessoa aceita com o bem ainda no setor de origem', () => {
    const m: MovimentoParaDecisao = {
      tipo: 'transferencia',
      situacao: 'pendente',
      versao: 0,
      solicitadoPor: 'SINT.PATRIMONIO',
      origem: 10,
    };
    expect(problemasDaDecisao(m, bem(), 'SINT.SETOR', 0)).toEqual([]);
    expect(problemasDaDecisao(m, bem(), 'sint.patrimonio', 0).map((p) => p.codigo)).toEqual([
      'mesmo-usuario',
    ]);
    expect(problemasDaDecisao(m, bem({ centro: 20 }), 'SINT.SETOR', 0).map((p) => p.codigo)).toEqual([
      'bem-mudou',
    ]);
    expect(
      problemasDaDecisao({ ...m, tipo: 'baixa', situacao: 'concluido' }, bem(), 'SINT.SETOR', 1).map(
        (p) => p.codigo,
      ),
    ).toEqual(['tipo', 'decidido', 'desatualizado']);
  });
  it('regra 13 (D-ACEITE-546): só quem responde pelo setor de destino aceita; sem centro cadastrado, sem restrição', () => {
    const m: MovimentoParaDecisao = {
      tipo: 'transferencia',
      situacao: 'pendente',
      versao: 0,
      solicitadoPor: 'SINT.PATRIMONIO',
      origem: 10,
      destino: 20,
    };
    expect(problemasDaDecisao(m, bem(), 'SINT.SETOR', 0, new Set([20, 30]))).toEqual([]);
    expect(problemasDaDecisao(m, bem(), 'SINT.OUTRO', 0, new Set([30])).map((p) => p.codigo)).toEqual([
      'outro-setor',
    ]);
    expect(problemasDaDecisao(m, bem(), 'SINT.OUTRO', 0, new Set([10])).map((p) => p.codigo)).toEqual([
      'outro-setor',
    ]);
    expect(problemasDaDecisao(m, bem(), 'SINT.SETOR', 0, null)).toEqual([]);
    expect(
      problemasDaDecisao({ ...m, destino: null }, bem(), 'SINT.SETOR', 0, new Set([20])).map((p) => p.codigo),
    ).toEqual(['outro-setor']);
  });
  it('só quem pediu cancela, e só o pendente', () => {
    const m: MovimentoParaDecisao = {
      tipo: 'transferencia',
      situacao: 'pendente',
      versao: 0,
      solicitadoPor: 'SINT.PATRIMONIO',
      origem: 10,
    };
    expect(problemasDoCancelamento(m, 'SINT.PATRIMONIO', 0)).toEqual([]);
    expect(
      problemasDoCancelamento({ ...m, situacao: 'aceito' }, 'SINT.SETOR', 1).map((p) => p.codigo),
    ).toEqual(['decidido', 'desatualizado', 'outro-usuario']);
  });
});

describe('empréstimo, comodato, devolução e baixa', () => {
  it('empréstimo e comodato tiram o bem de uso; a devolução volta', () => {
    const e = mov({
      tipo: 'emprestimo',
      terceiro: 'Hospital parceiro sintético',
      retornoPrevisto: '2026-11-30',
    });
    expect(codigos(bem(), e)).toEqual([]);
    expect(efeitoDoMovimento(bem(), e)).toEqual({
      situacaoMovimento: 'concluido',
      bem: { situacao: 'emprestado', centro: 10, baixadoEm: null },
    });
    expect(codigos(bem({ situacao: 'emprestado' }), e)).toEqual(['emprestado']);
    expect(codigos(bem(), mov({ tipo: 'emprestimo', terceiro: 'X', retornoPrevisto: '2026-10-01' }))).toEqual(
      ['retorno'],
    );
    const c = mov({ tipo: 'comodato', terceiro: 'Clínica sintética', termoNumero: 'CT-9' });
    expect(efeitoDoMovimento(bem(), c).bem?.situacao).toBe('emprestado');
    expect(esquemaRegistrarMovimento.safeParse({ ...c, termoNumero: '' }).success).toBe(false);
    const d = mov({ tipo: 'devolucao' });
    expect(codigos(bem(), d)).toEqual(['nao-emprestado']);
    expect(codigos(bem({ situacao: 'emprestado' }), d)).toEqual([]);
    expect(efeitoDoMovimento(bem(), d).bem?.situacao).toBe('ativo');
  });

  it('a baixa é definitiva, exige o termo e não cai em competência já depreciada', () => {
    const b = mov({ tipo: 'baixa', termoNumero: 'TB-1', valorVendaCent: 50_00 });
    expect(codigos(bem(), b)).toEqual([]);
    expect(efeitoDoMovimento(bem(), b)).toEqual({
      situacaoMovimento: 'concluido',
      bem: { situacao: 'baixado', centro: 10, baixadoEm: '2026-10-20' },
    });
    expect(codigos(bem({ ultimaCompetencia: '2026-10' }), b)).toEqual(['baixa-depreciada']);
    expect(codigos(bem({ situacao: 'emprestado' }), b)).toEqual(['emprestado']);
    expect(codigos(bem({ situacao: 'baixado' }), mov({ tipo: 'devolucao' }))).toEqual([
      'baixado',
      'nao-emprestado',
    ]);
    expect(esquemaRegistrarMovimento.safeParse({ ...b, termoNumero: '' }).success).toBe(false);
  });

  it('datas: nem futura, nem antes da aquisição', () => {
    expect(codigos(bem(), mov({ tipo: 'devolucao', data: '2026-11-01' }))).toEqual([
      'data-futura',
      'nao-emprestado',
    ]);
    expect(codigos(bem(), mov({ tipo: 'devolucao', data: '2026-01-01' }))).toEqual([
      'data-anterior',
      'nao-emprestado',
    ]);
  });
});
