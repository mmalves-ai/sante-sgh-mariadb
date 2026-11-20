// Regras e itens sintéticos para os testes do motor (nenhum dado real: códigos inventados).
import type { ItemProducao, RegraRepasse } from './regra.js';

export function regra(p: Partial<RegraRepasse> & { id: number }): RegraRepasse {
  return {
    vigencia: '2026-01-01',
    beneficiario: 'M',
    profissional: null,
    prestador: null,
    convenio: 301,
    procedimentoInicial: null,
    procedimentoFinal: null,
    especialidade: null,
    ato: null,
    local: null,
    unidade: null,
    centroCusto: null,
    cooperativa: null,
    tipoLancamento: null,
    tipoConta: 'A',
    horaInicial: '0000',
    horaFinal: '2359',
    percentual: 50,
    valorFixo: 0,
    percentualFeriado: 0,
    percentualFimDeSemana: 0,
    base: null,
    evento: 1,
    ...p,
  };
}

export function item(p: Partial<ItemProducao> = {}): ItemProducao {
  return {
    id: 1,
    data: '2026-10-07',
    hora: '1030',
    convenio: 301,
    procedimento: 10101012,
    especialidade: 5,
    ato: 1,
    local: 2,
    unidade: 1,
    centroCusto: 10,
    cooperativa: null,
    tipoLancamento: 2,
    tipoConta: 'I',
    executante: 77,
    cobrado: 200,
    pago: 150,
    recursoDeferido: 30,
    conciliado: true,
    ...p,
  };
}
