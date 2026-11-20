// Teste de contrato com o simulador da folha externa (M53.1; ficha do M53, seção 10; D-SIM-531): o lote montado pela
// regra real da exportação (montarLoteFolha) passa pelo simulador, o retorno segue o leiaute e a conferência real
// (conferirRetorno) não acha divergência; cada variação com defeito é pega com o código certo, e o plano de títulos sai
// com as parcelas impressas. CPF só da lista sintética; nenhum dado de pessoa real.
import { esquemaLoteRetornoFolha } from '@sgh/contratos';
import {
  conferirRetorno,
  type EntradaLoteFolha,
  montarLoteFolha,
  planoDeTitulos,
  podeLancarTitulos,
  type VinculoParaFolha,
} from '@sgh/dominio-pessoas';
import { describe, expect, it } from 'vitest';
import { CPFS_AFD_SINTETICOS } from '../m52/afd-sintetico.js';
import { SALARIO_BASE_SINTETICO, simularFolhaExterna } from './folha-externa.js';

const vinc = (id: number, cpf: string): VinculoParaFolha => ({
  id,
  cpf,
  matricula: `S${id}`,
  tipo: 'clt',
  admissao: '2020-01-01',
  desligamento: null,
  centroCusto: 10 + id,
  unidade: 5,
  cbo: '223505',
  conselho: null,
});
const entrada: EntradaLoteFolha = {
  lote: 41,
  empresa: 1,
  estabelecimento: 'pc',
  competencia: '2026-12',
  geradoEm: '2027-01-05T10:00:00-03:00',
  hoje: '2027-01-05',
  vinculos: [vinc(1, CPFS_AFD_SINTETICOS[0]), vinc(2, CPFS_AFD_SINTETICOS[1])],
  afastamentos: [],
  fechamentos: new Map([
    [1, { '1': 9_600 }],
    [2, { '1': 8_800, '5': 60 }],
  ]),
  // A classificação do mesmo fechamento por tipo de hora (POTPHORA), que o lote leva informativa (regra 5).
  horas: new Map([
    [1, { '1': 9_600 }],
    [2, { '1': 8_800, '5': 60 }],
  ]),
  plantoes: [
    {
      vinculo: 2,
      plantao: 9,
      modalidade: 'presencial',
      inicio: '2026-12-10T07:00',
      fim: '2026-12-10T19:00',
      minutos: 720,
    },
  ],
  eventosDisponiveis: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  competenciaLancada: false,
};
const lote = () => {
  const r = montarLoteFolha(entrada);
  expect(r.pendencias).toEqual([]);
  return r.lote!;
};

describe('contrato com o simulador da folha externa', () => {
  it('o retorno do lote real segue o leiaute, ecoa os totais e confere sem divergência', () => {
    const l = lote();
    expect(l.horasPonto).toEqual([
      { vinculo: 1, tipoHora: 1, minutos: 9_600 },
      { vinculo: 2, tipoHora: 1, minutos: 8_800 },
      { vinculo: 2, tipoHora: 5, minutos: 60 },
    ]);
    const r = simularFolhaExterna(JSON.parse(JSON.stringify(l)));
    expect(esquemaLoteRetornoFolha.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({
      loteExportado: 41,
      empresa: 1,
      competencia: '2026-12',
      vencimentoLiquido: '2027-01-05',
    });
    expect(r.recebido).toEqual(l.totais);
    expect(r.colaboradores.map((c) => c.vinculo)).toEqual(l.colaboradores.map((c) => c.vinculo));
    expect(JSON.stringify(r)).not.toContain(CPFS_AFD_SINTETICOS[0]);
    const d = conferirRetorno(r, l);
    expect(d).toEqual([]);
    expect(podeLancarTitulos(d)).toBe(true);
    // Vínculo 1: 160 h de ponto a R$ 25,00 = R$ 4.000,00 além do salário-base.
    const c1 = r.colaboradores.find((c) => c.vinculo === 1)!;
    expect(c1.rubricas.filter((x) => x.natureza === 'provento').map((x) => x.valor)).toEqual([
      SALARIO_BASE_SINTETICO,
      400_000,
    ]);
    const plano = planoDeTitulos(r);
    expect(plano.total).toBe(r.totais.liquido + r.totais.encargos);
    expect(plano.conta).toMatch(/^líquido R\$ .+ \+ INSS R\$ .+ \+ FGTS R\$ .+ = R\$ /);
  });

  it('as variações com defeito são pegas pela conferência', () => {
    const l = lote();
    const cod = (v: Parameters<typeof simularFolhaExterna>[1]) =>
      conferirRetorno(simularFolhaExterna(l, v), l).map((d) => [d.codigo, d.vinculo]);
    expect(cod({ alterarLiquido: { vinculo: 2, centavos: -1_000 } })).toEqual([['liquido-colaborador', 2]]);
    expect(cod({ ecoDiferente: true }).map(([c]) => c)).toEqual(['eco-diferente']);
    expect(cod({ vinculoExtra: 99 })).toEqual([['vinculo-nao-exportado', 99]]);
  });

  it('recusa o lote fora do leiaute', () => {
    expect(() => simularFolhaExterna({ ...lote(), leiaute: '2.0' })).toThrow();
  });
});
