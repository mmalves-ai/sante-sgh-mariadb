// Regra 2 (ficha do M34): todo relatório de SQL livre recebe destino, dono e artefato; os de folha, eSocial e REINF
// vão para o M53. Nomes sintéticos no formato dos do editor (o critério de aceite com os 252 reais é o
// `pnpm relatorios:triagem` na cópia, que só imprime contagens).
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  nomeDaTriagem,
  proporTriagem,
  REGRAS_TRIAGEM,
  type RelatorioOrigem,
  resumirTriagem,
} from './triagem.js';

const r = (nome: string, modulo = -1, tipo = 2): RelatorioOrigem => ({ id: 1, nome, modulo, tipo });

describe('triagem dos relatórios de SQL livre (regra 2)', () => {
  it('nome comparável', () => {
    expect(nomeDaTriagem('  Contas ñ emitidas -  Conv. particular ')).toBe(
      'CONTAS N EMITIDAS - CONV. PARTICULAR',
    );
  });

  it('folha, eSocial e REINF vão para o M53 (DP-10)', () => {
    for (const n of [
      'FP | eSocial - Validação de CEP',
      'S-1200 - Consulta de dados enviados - S-1.1',
      'R-4010 - Consulta de dados enviados - 3',
      'Relatório base de cálculo INSS SGH x INSS eSocial',
      'Carga inicial (S-2200)',
    ])
      expect(proporTriagem(r(n)).marco, n).toBe('M53');
    expect(proporTriagem(r('Qualquer', 22)).marco).toBe('M53');
  });

  it('os do catálogo do marco', () => {
    expect(proporTriagem(r('FC | Relatório de Glosas de Contas Pagas', 4)).artefato).toBe(
      'glosasPorConvenio',
    );
    expect(proporTriagem(r('FC | CONTAS NÃO EMITIDAS E NÃO FECHADAS - INTERNAS', 4)).artefato).toBe(
      'contasNaoFechadas',
    );
    expect(proporTriagem(r('CF | Contas ñ emitidas - Conv.  Part. ', 14)).artefato).toBe('contasNaoFechadas');
    expect(proporTriagem(r('FC | Faturamento Mensal Anual - Valor', 4)).artefato).toBe(
      'faturamentoPorConvenio',
    );
    expect(proporTriagem(r('BC | Mapa Cirúrgico Diário', 0)).artefato).toBe('mapaCirurgicoDia');
    expect(proporTriagem(r('GER - CIRURGIAS POR PERÍODO')).artefato).toBe('cirurgiasPorPeriodo');
    expect(proporTriagem(r('RI | Censo Diário de Pacientes Internados', 7)).artefato).toBe(
      'internadosNaData',
    );
    expect(proporTriagem(r('SADT | Relatório de Serviços de Imagem', 9)).artefato).toBe('examesPorSetor');
    // Todo artefato de catálogo é um relatório que existe.
    const codigos = new Set(RELATORIOS_CATALOGO.map((x) => x.codigo));
    for (const x of REGRAS_TRIAGEM.filter((y) => y.proposta.destino === 'catalogo'))
      expect(codigos.has(x.proposta.artefato), x.regra).toBe(true);
  });

  it('telas, painéis, indicadores, descarte e o padrão do módulo', () => {
    expect(proporTriagem(r('RI | Relatório de Leitos de Internação', 7)).destino).toBe('painel');
    expect(proporTriagem(r('RI | Censo Hospitalar', 7)).destino).toBe('indicador');
    expect(proporTriagem(r('RI | Pulseira - Paciente Interno', 7, 3)).marco).toBe('M20');
    expect(proporTriagem(r('Relatório Modelo (Paisagem)')).destino).toBe('descartado');
    expect(proporTriagem(r('FLUXO DE CAIXA - Pagamento teste 4')).destino).toBe('descartado');
    expect(proporTriagem(r('CF | Saldo Bancário', 14)).marco).toBe('M32');
    expect(proporTriagem(r('FC | Rel. Repasse Serviços Profissionais', 4)).marco).toBe('M33');
    expect(proporTriagem(r('GE | Relatório de Perdas e Danos')).marco).toBe('M28');
    expect(proporTriagem(r('Algo sem regra', 9)).regra).toBe('modulo-9');
    expect(proporTriagem(r('Algo sem regra', 99)).regra).toBe('sem-regra');
  });

  it('o resumo do critério de aceite: total, sem destino e sem dono', () => {
    const p = ['FC | Glosas', 'S-1200 x', 'Algo', 'Outro'].map((n, i) =>
      proporTriagem({ id: i, nome: n, modulo: i === 2 ? 9 : 4, tipo: 2 }),
    );
    const s = resumirTriagem(p);
    expect(s.total).toBe(4);
    expect(s.semDestino).toBe(0);
    expect(s.semDono).toBe(0);
    expect(s.porMarco['M53']).toBe(1);
    expect(resumirTriagem([{ destino: 'tela', marco: null, papelDono: ' ', regra: 'x' }]).semDono).toBe(1);
  });
});
