// W0-08, parte 10 (mercado M4): os modelos prontos de plano da infraestrutura, a montagem do relatório do PMOC (só as
// execuções do período, conta com as parcelas) e a assinatura do responsável técnico (nome, registro e ART impressos).
import {
  CODIGOS_MODELO_PLANO,
  MODELOS_PLANO_INFRA,
  esquemaInstalarModeloPlano,
  responsavelPmocDe,
} from '@sgh/contratos';
import type { ExecucaoLida, PlanoManutencaoLido } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { htmlPmoc } from './documentos.js';
import { conferirInstalacaoModelo, conferirPeriodoPmoc, montarPmoc, type EquipamentoDoPmoc } from './pmoc.js';

const plano = (
  x: Partial<PlanoManutencaoLido> & { id: number; equipamento: number },
): PlanoManutencaoLido => ({
  versao: 1,
  atividade: 'preventiva',
  periodicidade: { quantidade: 1, unidade: 'meses' },
  dataBase: '2026-09-01',
  antecedenciaDias: null,
  procedimento: null,
  executor: 'interno',
  cobertura: null,
  ativo: true,
  modelo: { codigo: 'pmocAr', versao: 1 },
  ultimaExecucao: null,
  ultimoResultado: null,
  ...x,
});
const exec = (id: number, planoId: number, data: string, x: Partial<ExecucaoLida> = {}): ExecucaoLida => ({
  id,
  plano: planoId,
  data,
  resultado: 'aprovado',
  laudo: null,
  certificadoPadrao: null,
  observacao: null,
  osCorretiva: null,
  por: 'TECNICO.AR',
  em: `${data}T10:00`,
  ...x,
});
const equip = (id: number, codigo: string): EquipamentoDoPmoc => ({
  id,
  codigo,
  nome: `Condicionador ${codigo}`,
  local: 'UTI adulto · sala 2',
  fabricante: 'Fabricante Sintético',
  modelo: 'SPLIT-36',
  numeroSerie: `SN-${id}`,
});
const RT = { nome: 'Eng. Responsável Sintético', registro: 'CREA-SP 0000000000', art: '0000000001' };

describe('modelos prontos de plano (W0-08, M4)', () => {
  it('os quatro modelos têm roteiro dentro do limite do plano, norma brasileira e versão', () => {
    expect(CODIGOS_MODELO_PLANO).toEqual(['pmocAr', 'reservatorioAgua', 'geradorEnergia', 'gasesMedicinais']);
    for (const c of CODIGOS_MODELO_PLANO) {
      const m = MODELOS_PLANO_INFRA[c];
      expect(m.procedimento.length).toBeLessThanOrEqual(2000);
      expect(m.versao).toBeGreaterThanOrEqual(1);
      expect(m.norma).toMatch(/Lei|Portaria|RDC|NBR/);
    }
    expect(MODELOS_PLANO_INFRA.pmocAr.pmoc).toBe(true);
    expect(MODELOS_PLANO_INFRA.reservatorioAgua.periodicidade).toEqual({ quantidade: 6, unidade: 'meses' });
  });

  it('a instalação exige o contrato quando o executor é contrato', () => {
    expect(
      esquemaInstalarModeloPlano.safeParse({
        equipamento: 1,
        modelo: 'pmocAr',
        dataBase: '2026-10-01',
        executor: 'contrato',
      }).success,
    ).toBe(false);
    expect(
      esquemaInstalarModeloPlano.safeParse({ equipamento: 1, modelo: 'outro', dataBase: '2026-10-01' })
        .success,
    ).toBe(false);
  });

  it('o mesmo modelo ativo no equipamento recusa; desativado ou outro modelo, não', () => {
    expect(conferirInstalacaoModelo([plano({ id: 5, equipamento: 1 })], 'pmocAr')).toMatchObject({
      ok: false,
      recusa: 'modelo-instalado',
    });
    expect(conferirInstalacaoModelo([plano({ id: 5, equipamento: 1, ativo: false })], 'pmocAr').ok).toBe(
      true,
    );
    expect(conferirInstalacaoModelo([plano({ id: 5, equipamento: 1 })], 'geradorEnergia').ok).toBe(true);
    expect(conferirInstalacaoModelo([plano({ id: 5, equipamento: 1, modelo: null })], 'pmocAr').ok).toBe(
      true,
    );
  });

  it('o responsável técnico vem do parâmetro "nome; registro; ART"; sem registro, null', () => {
    expect(responsavelPmocDe('Eng. Fulano; CREA-SP 123; ART 9')).toEqual({
      nome: 'Eng. Fulano',
      registro: 'CREA-SP 123',
      art: 'ART 9',
    });
    expect(responsavelPmocDe('Eng. Fulano; CFT 55')).toEqual({
      nome: 'Eng. Fulano',
      registro: 'CFT 55',
      art: null,
    });
    expect(responsavelPmocDe('Eng. Fulano')).toBeNull();
    expect(responsavelPmocDe('')).toBeNull();
    expect(responsavelPmocDe(null)).toBeNull();
  });

  it('o período do relatório: ordem e até 12 meses', () => {
    expect(conferirPeriodoPmoc('2026-01-01', '2026-12-31').ok).toBe(true);
    expect(conferirPeriodoPmoc('2026-10-31', '2026-10-01')).toMatchObject({
      ok: false,
      recusa: 'periodo-invalido',
    });
    expect(conferirPeriodoPmoc('2025-01-01', '2026-10-01')).toMatchObject({
      ok: false,
      recusa: 'periodo-invalido',
    });
  });
});

describe('relatório do PMOC (W0-08, M4)', () => {
  const dados = () =>
    montarPmoc({
      de: '2026-10-01',
      ate: '2026-10-31',
      hoje: '2026-11-18',
      antecedenciaPadrao: 15,
      responsavel: RT,
      planos: [
        plano({ id: 10, equipamento: 2, ultimaExecucao: '2026-10-20', ultimoResultado: 'aprovado' }),
        plano({ id: 11, equipamento: 1, ultimaExecucao: '2026-10-05', ultimoResultado: 'reprovado' }),
        // Gerador (outro modelo) e plano à mão: fora do PMOC.
        plano({ id: 12, equipamento: 1, modelo: { codigo: 'geradorEnergia', versao: 1 } }),
        plano({ id: 13, equipamento: 1, modelo: null }),
        // Desativado sem execução no período: fora; desativado com execução no período: dentro.
        plano({ id: 14, equipamento: 3, ativo: false }),
        plano({ id: 15, equipamento: 4, ativo: false }),
      ],
      equipamentos: new Map([
        [1, equip(1, 'AR-01')],
        [2, equip(2, 'AR-02')],
        [3, equip(3, 'AR-03')],
        [4, equip(4, 'AR-04')],
      ]),
      execucoes: new Map([
        [10, [exec(3, 10, '2026-10-20'), exec(1, 10, '2026-09-20')]],
        [
          11,
          [
            exec(2, 11, '2026-10-05', {
              resultado: 'reprovado',
              observacao: 'Compressor sem partida',
              laudo: 77,
            }),
          ],
        ],
        [12, [exec(4, 12, '2026-10-10')]],
        [15, [exec(5, 15, '2026-10-02')]],
      ]),
      emissao: {
        estabelecimento: 'pc',
        emitidoEm: '2026-11-18T10:00:00.000Z',
        emitidoPor: 'SINT.MANUTENCAO',
      },
    });

  it('só os planos do PMOC, na ordem do código, com as execuções do período', () => {
    const p = dados();
    expect(p.itens.map((i) => i.equipamento.codigo)).toEqual(['AR-01', 'AR-02', 'AR-04']);
    expect(p.itens.map((i) => i.execucoes.map((e) => e.data))).toEqual([
      ['2026-10-05'],
      ['2026-10-20'],
      ['2026-10-02'],
    ]);
    // A situação de hoje: AR-01 executado em 05/10 com periodicidade mensal venceu em 05/11.
    expect(p.itens[0]).toMatchObject({ situacao: 'vencida', proxima: '2026-11-05' });
    expect(p.itens[2]).toMatchObject({ ativo: false, situacao: null, proxima: null });
    expect(p.responsavel).toEqual(RT);
  });

  it('o documento imprime o responsável técnico na assinatura, as execuções e a conta com as parcelas', () => {
    const h = htmlPmoc(dados());
    expect(h).toContain('Relatório do PMOC');
    expect(h).toContain('Lei 13.589/2018');
    expect(h).toContain(
      '<div>Eng. Responsável Sintético<br>CREA-SP 0000000000<br>ART 0000000001<br>Responsável técnico do PMOC</div>',
    );
    expect(h).toContain('Conta: 1 + 1 + 1 = 3 execuções no período (1 reprovadas).');
    expect(h).toContain('Conta: 3 equipamentos no PMOC.');
    expect(h).toContain('Compressor sem partida');
    expect(h).toContain('Documento 77');
    expect(h).toContain('Plano desativado');
    expect(h).not.toContain('20/09/2026');
    // Autocontido: nada externo.
    expect(h).not.toMatch(/<script|https?:\/\//);
  });

  it('sem execução no período, a conta sai zerada', () => {
    const p = dados();
    const h = htmlPmoc({ ...p, itens: p.itens.map((i) => ({ ...i, execucoes: [] })) });
    expect(h).toContain('Nenhuma execução no período.');
    expect(h).toContain('Conta: 0 + 0 + 0 = 0 execuções no período (0 reprovadas).');
  });
});
