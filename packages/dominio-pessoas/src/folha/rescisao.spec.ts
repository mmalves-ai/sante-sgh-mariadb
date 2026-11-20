// Rescisão (M53-F4; CLT arts. 146, 477 a 487, Lei 12.506/2011, Lei 4.090/1962, Lei 8.036/1990 art. 18): modalidades,
// aviso e projeção, saldo de salário, férias vencidas, em dobro e proporcionais, 13º proporcional, art. 479, multa do
// FGTS, recusas, pendências e avisos. Números de 2026 só para a conta à mão; colaboradores sintéticos.
import { describe, expect, it } from 'vitest';
import { conferirCalculo, totalizarCalculo } from './calculo.js';
import { maisCompetencias } from './medias.js';
import { PARAM_2026, rubricasDeTeste, SALARIO, TABELA_2026, VINC } from './fixtures-folha.spec.js';
import {
  anosCompletos,
  avosDeFerias,
  calcularRescisao,
  conferirRescisao,
  diasDeAviso,
  diasDoSaldo,
  diasIndenizados,
  type EntradaCalculoRescisao,
  modalidadeSugerida,
} from './rescisao.js';
import { somarMeses } from '../sesmt/aso.js';

const entrada = (extra: Partial<EntradaCalculoRescisao> = {}): EntradaCalculoRescisao => ({
  empresa: 1,
  vinculo: VINC(1, { desligamento: '2026-10-20' }),
  modalidade: 'sem-justa-causa',
  aviso: 'indenizado',
  termo: null,
  pagamento: null,
  saldoFgts: 1_000_000,
  fgtsDepositado: 0,
  salarios: [SALARIO(1)],
  historico: [],
  afastamentos: [],
  diasAfastamento: [{ inicio: '2020-01-01', dias: 15 }],
  ponto: { eventos: {}, horas: {} },
  sobreaviso: 0,
  ferias: [],
  feriasNoMes: null,
  adiantamentoDecimo: 0,
  decimoPago: false,
  naFolhaMensal: false,
  tabelasLegais: [TABELA_2026],
  parametros: [PARAM_2026],
  rubricas: rubricasDeTeste(),
  ...extra,
});

const valor = (r: ReturnType<typeof calcularRescisao>, papel: string) =>
  r.recibo?.linhas.find((l) => l.papel === papel)?.valor ?? 0;
const linha = (r: ReturnType<typeof calcularRescisao>, papel: string) =>
  r.recibo?.linhas.find((l) => l.papel === papel);

describe('datas, aviso e sugestão da modalidade', () => {
  it('anos completos, meses somados e avos de férias (fração de 15 dias)', () => {
    expect(anosCompletos('2024-01-10', '2026-01-08')).toBe(1);
    expect(anosCompletos('2024-01-10', '2026-01-09')).toBe(2);
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-11-10', 3)).toBe('2027-02-10');
    expect(avosDeFerias('2026-01-10', '2026-10-20')).toBe(9);
    expect(avosDeFerias('2026-01-10', '2026-10-23')).toBe(9);
    expect(avosDeFerias('2026-01-10', '2026-10-24')).toBe(10);
    expect(avosDeFerias('2026-01-10', '2026-01-23')).toBe(0);
    expect(avosDeFerias('2026-01-10', '2026-01-24')).toBe(1);
    expect(avosDeFerias('2026-01-10', '2027-01-09')).toBe(12);
  });

  it('aviso de 30 + 3 por ano até 90 só do empregador; 30 no pedido; metade no acordo; trabalhado indeniza o que passa de 30', () => {
    expect(diasDeAviso('sem-justa-causa', '2024-01-10', '2026-10-20')).toEqual({ devidos: 36, anos: 2 });
    expect(diasDeAviso('sem-justa-causa', '1990-01-01', '2026-10-20').devidos).toBe(90);
    expect(diasDeAviso('pedido-demissao', '1990-01-01', '2026-10-20').devidos).toBe(30);
    expect(diasDeAviso('justa-causa', '1990-01-01', '2026-10-20').devidos).toBe(0);
    expect(diasIndenizados('sem-justa-causa', 'indenizado', 36)).toBe(36);
    expect(diasIndenizados('sem-justa-causa', 'trabalhado', 36)).toBe(6);
    expect(diasIndenizados('acordo', 'indenizado', 37)).toBe(18);
    expect(diasIndenizados('pedido-demissao', 'nao-cumprido', 30)).toBe(0);
  });

  it('a modalidade sugerida pelo saque do FGTS e pela causa (D-MODALIDADE-535)', () => {
    expect(modalidadeSugerida({ saque: '01', causa: 3 })).toBe('sem-justa-causa');
    expect(modalidadeSugerida({ saque: '04', causa: 3 })).toBe('termino-contrato');
    expect(modalidadeSugerida({ saque: '23', causa: 3 })).toBe('falecimento');
    expect(modalidadeSugerida({ saque: '00', causa: 1 })).toBe('justa-causa');
    expect(modalidadeSugerida({ saque: '00', causa: 5 })).toBe('pedido-demissao');
    expect(modalidadeSugerida({ saque: '05', causa: 3 })).toBeNull();
  });

  it('saldo de salário: o último dia do mês vale 30; admissão no mês, afastamento e férias saem (D-SALDO-535)', () => {
    expect(diasDoSaldo({ admissao: '2024-01-10', desligamento: '2026-10-31' }, [], 15, 0).dias).toBe(30);
    expect(diasDoSaldo({ admissao: '2024-01-10', desligamento: '2026-02-28' }, [], 15, 0).dias).toBe(30);
    expect(diasDoSaldo({ admissao: '2026-10-05', desligamento: '2026-10-20' }, [], 15, 0).dias).toBe(16);
    const afast = [{ vinculo: 1, inicio: '2026-09-25', fim: null, situacao: 'ativo' }];
    expect(diasDoSaldo({ admissao: '2024-01-10', desligamento: '2026-10-20' }, afast, 15, 0).dias).toBe(9);
    expect(diasDoSaldo({ admissao: '2024-01-10', desligamento: '2026-10-20' }, [], 15, 5).dias).toBe(15);
  });

  it('recusas: sem desligamento, outro vínculo, aviso da modalidade, termo e pagamento', () => {
    const v = VINC(1, { desligamento: '2026-10-20' });
    const base = {
      vinculo: v,
      modalidade: 'sem-justa-causa',
      aviso: 'indenizado',
      termo: null,
      pagamento: null,
    } as const;
    expect(conferirRescisao({ ...base, vinculo: VINC(1) })).toEqual(['vinculo-ativo']);
    expect(
      conferirRescisao({ ...base, vinculo: VINC(1, { tipo: 'pj', desligamento: '2026-10-20' }) }),
    ).toEqual(['vinculo-sem-rescisao']);
    expect(conferirRescisao({ ...base, aviso: 'nenhum' })).toEqual(['aviso-invalido']);
    expect(conferirRescisao({ ...base, modalidade: 'antecipada-empregador', aviso: 'nenhum' })).toEqual([
      'termo-obrigatorio',
    ]);
    expect(
      conferirRescisao({ ...base, modalidade: 'termino-contrato', aviso: 'nenhum', termo: '2026-10-20' }),
    ).toEqual(['termo-invalido']);
    expect(conferirRescisao({ ...base, pagamento: '2026-10-19' })).toEqual(['pagamento-antes']);
    expect(conferirRescisao(base)).toEqual([]);
    expect(calcularRescisao(entrada({ vinculo: VINC(1) })).recusas).toEqual(['vinculo-ativo']);
  });
});

describe('sem justa causa com aviso indenizado (conta à mão)', () => {
  const r = calcularRescisao(entrada());

  it('apuração: 36 dias de aviso (2 anos), projeção, 20 dias de saldo, avos do 13º e pagamento em 10 dias', () => {
    expect(r.recusas).toEqual([]);
    expect(r.pendencias).toEqual([]);
    expect(r.apuracao).toMatchObject({
      competencia: '2026-10',
      diasAviso: 36,
      diasIndenizados: 36,
      anosCompletos: 2,
      projecao: '2026-11-25',
      diasSaldo: 20,
      avosDecimo: 10,
      avosDecimoAviso: 1,
      percentualMulta: 4000,
      pagamento: '2026-10-30',
      saldoFgtsInformado: true,
    });
  });

  it('verbas: saldo, aviso, férias vencidas (uma em dobro), proporcionais, da projeção e o terço; 13º proporcional e do aviso', () => {
    expect(valor(r, 'salario')).toBe(200_000);
    expect(linha(r, 'salario')?.memoria).toMatch(/^saldo de salário/);
    expect(valor(r, 'avisoIndenizado')).toBe(360_000);
    expect(valor(r, 'feriasVencidas')).toBe(600_000);
    expect(linha(r, 'feriasVencidas')?.quantidade).toBe(60);
    expect(valor(r, 'feriasVencidasDobra')).toBe(300_000);
    expect(valor(r, 'feriasProporcionais')).toBe(225_000);
    expect(linha(r, 'feriasProporcionais')?.quantidade).toBe(9);
    expect(valor(r, 'feriasAviso')).toBe(50_000);
    expect(valor(r, 'feriasRescisaoTerco')).toBe(391_667);
    expect(valor(r, 'decimoProporcional')).toBe(250_000);
    expect(valor(r, 'decimoAviso')).toBe(25_000);
  });

  it('dois fechamentos: INSS do mês e do 13º em papéis próprios, FGTS somado numa linha, multa de 40% informativa', () => {
    expect(valor(r, 'inss')).toBeGreaterThan(0);
    expect(valor(r, 'inssDecimo')).toBeGreaterThan(0);
    // FGTS: (200.000 + 360.000) × 8% + 275.000 × 8% = 44.800 + 22.000.
    expect(valor(r, 'fgts')).toBe(66_800);
    expect(linha(r, 'fgts')?.memoria).toContain('13º:');
    expect(valor(r, 'baseFgts')).toBe(835_000);
    expect(r.recibo?.linhas.filter((l) => l.papel === 'fgts')).toHaveLength(1);
    // (1.000.000 do extrato + 66.800) × 40%.
    expect(valor(r, 'multaFgts')).toBe(426_720);
    expect(linha(r, 'multaFgts')?.tipo).toBe('informativa');
    expect(r.apuracao?.multaFgts).toBe(426_720);
    // As parcelas da base vão à tela: o saldo do extrato e o FGTS desta rescisão (D-MULTA-535).
    expect(r.apuracao?.saldoFgts).toBe(1_000_000);
    expect(r.apuracao?.fgtsRescisao).toBe(66_800);
    expect(r.apuracao?.percentualMulta).toBe(4000);
  });

  it('a prova da soma fecha e o resumo é a soma das linhas', () => {
    const rec = r.recibo!;
    const soma = (t: string) => rec.linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0);
    expect(rec.resumo.proventos).toBe(soma('provento'));
    expect(rec.resumo.descontos).toBe(soma('desconto'));
    expect(rec.resumo.inss).toBe(valor(r, 'inss') + valor(r, 'inssDecimo'));
    expect(rec.resumo.diasPagos).toBe(20);
    expect(conferirCalculo([rec], totalizarCalculo([rec])).ok).toBe(true);
    expect(new Set(rec.linhas.map((l) => l.papel)).size).toBe(rec.linhas.length);
  });
});

describe('outras modalidades', () => {
  it('pedido de demissão sem cumprir o aviso: desconto de 30 dias; sem aviso indenizado nem multa', () => {
    const r = calcularRescisao(entrada({ modalidade: 'pedido-demissao', aviso: 'nao-cumprido' }));
    expect(valor(r, 'avisoDescontado')).toBe(300_000);
    expect(valor(r, 'avisoIndenizado')).toBe(0);
    expect(linha(r, 'multaFgts')).toBeUndefined();
    expect(valor(r, 'feriasProporcionais')).toBe(225_000);
    expect(valor(r, 'feriasAviso')).toBe(0);
    expect(r.apuracao?.projecao).toBe('2026-10-20');
  });

  it('o desconto do aviso não passa do que há a receber (art. 477 §5)', () => {
    const r = calcularRescisao(
      entrada({
        vinculo: VINC(1, { admissao: '2026-10-01', desligamento: '2026-10-05' }),
        salarios: [SALARIO(1, 300_000, { inicio: '2026-10-01' })],
        modalidade: 'pedido-demissao',
        aviso: 'nao-cumprido',
      }),
    );
    expect(valor(r, 'salario')).toBe(50_000);
    expect(valor(r, 'avisoDescontado')).toBe(50_000);
    expect(linha(r, 'avisoDescontado')?.memoria).toContain('limitado');
  });

  it('justa causa: só saldo e vencidas; sem 13º nem proporcionais; o adiantamento do 13º é descontado', () => {
    const r = calcularRescisao(
      entrada({ modalidade: 'justa-causa', aviso: 'nenhum', adiantamentoDecimo: 120_000 }),
    );
    expect(valor(r, 'feriasVencidas')).toBe(600_000);
    expect(valor(r, 'feriasProporcionais')).toBe(0);
    expect(valor(r, 'decimoProporcional')).toBe(0);
    expect(valor(r, 'decimoDesconto')).toBe(120_000);
    expect(valor(r, 'inssDecimo')).toBe(0);
    expect(linha(r, 'multaFgts')).toBeUndefined();
  });

  it('acordo: metade do aviso indenizado e multa de 20%', () => {
    const r = calcularRescisao(entrada({ modalidade: 'acordo' }));
    expect(r.apuracao?.diasIndenizados).toBe(18);
    expect(valor(r, 'avisoIndenizado')).toBe(180_000);
    expect(r.apuracao?.percentualMulta).toBe(2000);
  });

  it('culpa recíproca: metade do aviso, do 13º e das férias proporcionais', () => {
    const r = calcularRescisao(entrada({ modalidade: 'culpa-reciproca' }));
    expect(valor(r, 'avisoIndenizado')).toBe(180_000);
    expect(valor(r, 'decimoProporcional')).toBe(125_000);
    expect(valor(r, 'feriasProporcionais')).toBe(112_500);
    expect(valor(r, 'feriasVencidas')).toBe(600_000);
  });

  it('antecipação pelo empregador: metade dos dias até o termo (art. 479) e multa de 40%, sem aviso', () => {
    const r = calcularRescisao(
      entrada({ modalidade: 'antecipada-empregador', aviso: 'nenhum', termo: '2026-11-19' }),
    );
    expect(valor(r, 'indenizacao479')).toBe(150_000);
    expect(linha(r, 'indenizacao479')?.quantidade).toBe(30);
    expect(valor(r, 'avisoIndenizado')).toBe(0);
    expect(r.apuracao?.percentualMulta).toBe(4000);
  });

  it('aviso trabalhado: só os dias da Lei 12.506/2011 além dos 30 saem indenizados', () => {
    const r = calcularRescisao(entrada({ aviso: 'trabalhado' }));
    expect(r.apuracao?.diasIndenizados).toBe(6);
    expect(valor(r, 'avisoIndenizado')).toBe(60_000);
    expect(r.apuracao?.projecao).toBe('2026-10-26');
  });
});

describe('férias registradas, 13º, médias, pendências e avisos', () => {
  it('férias com recibo contam como gozadas; as programadas sem recibo saem indenizadas, com aviso', () => {
    const r = calcularRescisao(
      entrada({
        ferias: [
          {
            id: 1,
            aquisitivoInicio: '2024-01-10',
            inicio: '2025-06-02',
            fim: '2025-07-01',
            dias: 30,
            abono: 0,
            adiantarDecimo: false,
            situacao: 'calculada',
          },
          {
            id: 2,
            aquisitivoInicio: '2025-01-10',
            inicio: '2026-11-02',
            fim: '2026-11-21',
            dias: 20,
            abono: 0,
            adiantarDecimo: false,
            situacao: 'programada',
          },
        ],
      }),
    );
    expect(valor(r, 'feriasVencidas')).toBe(300_000);
    expect(valor(r, 'feriasVencidasDobra')).toBe(0);
    expect(r.avisos.map((a) => a.codigo)).toContain('ferias-programadas');
  });

  it('o adiantamento do 13º sai do 13º e o FGTS não se repete; paga a parcela final do ano, o 13º não entra', () => {
    const r = calcularRescisao(entrada({ adiantamentoDecimo: 125_000 }));
    expect(valor(r, 'decimoDesconto')).toBe(125_000);
    // 13º 275.000 − 125.000 já depositado: base do FGTS do 13º 150.000.
    expect(valor(r, 'fgts')).toBe(44_800 + 12_000);
    const pago = calcularRescisao(
      entrada({ vinculo: VINC(1, { desligamento: '2026-12-28' }), decimoPago: true }),
    );
    expect(valor(pago, 'decimoProporcional')).toBe(0);
    expect(pago.avisos.map((a) => a.codigo)).toContain('decimo-ja-pago');
    // A projeção cruza o ano: o avo de janeiro de 2027 entra como 13º do aviso.
    expect(pago.apuracao?.projecao).toBe('2027-02-02');
    expect(valor(pago, 'decimoAviso')).toBe(25_000);
  });

  it('médias das variáveis das 12 competências anteriores no aviso e nas férias (D-MEDIAS-535)', () => {
    const historico = Array.from({ length: 12 }, (_, i) => ({
      competencia: maisCompetencias('2025-10', i),
      papel: 'horaExtra50' as const,
      quantidade: 600,
      valor: 0,
    }));
    const r = calcularRescisao(entrada({ historico }));
    // 10 h por mês × (3.000 ÷ 220 h) × 150% = 204,55 de média mensal.
    expect(linha(r, 'avisoIndenizado')?.memoria).toContain('média R$');
    expect(valor(r, 'avisoIndenizado')).toBeGreaterThan(360_000);
    expect(r.avisos.map((a) => a.codigo)).not.toContain('competencias-sem-calculo');
    expect(calcularRescisao(entrada()).avisos.map((a) => a.codigo)).toContain('competencias-sem-calculo');
  });

  it('pendências: sem salário não calcula; na folha mensal calcula a prévia e barra', () => {
    expect(calcularRescisao(entrada({ salarios: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-salario',
    ]);
    expect(calcularRescisao(entrada({ salarios: [] })).recibo).toBeNull();
    const r = calcularRescisao(entrada({ naFolhaMensal: true }));
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['na-folha-mensal']);
    expect(r.recibo).not.toBeNull();
    const semRub = calcularRescisao(
      entrada({
        parametros: [{ ...PARAM_2026, rubricas: { ...PARAM_2026.rubricas, avisoIndenizado: null } }],
      }),
    );
    expect(semRub.pendencias).toEqual([
      { codigo: 'papel-sem-rubrica', vinculos: [1], papel: 'avisoIndenizado' },
    ]);
  });

  it('avisos: ponto não fechado (sem variáveis do mês), saldo do FGTS estimado e pagamento fora do prazo', () => {
    const r = calcularRescisao(
      entrada({
        ponto: null,
        saldoFgts: null,
        fgtsDepositado: 500_000,
        pagamento: '2026-11-05',
      }),
    );
    const cs = r.avisos.map((a) => a.codigo);
    expect(cs).toEqual(
      expect.arrayContaining(['ponto-nao-fechado', 'saldo-fgts-estimado', 'pagamento-fora-do-prazo']),
    );
    expect(r.apuracao?.saldoFgts).toBe(500_000);
    expect(r.apuracao?.saldoFgtsInformado).toBe(false);
    expect(linha(r, 'multaFgts')?.memoria).toContain('depositados aqui');
    const comPonto = calcularRescisao(entrada({ ponto: { eventos: { '3': 480 }, horas: { '5': 120 } } }));
    expect(valor(comPonto, 'faltas')).toBeGreaterThan(0);
    expect(valor(comPonto, 'horaExtra50')).toBeGreaterThan(0);
  });

  it('o recibo de férias do mês: os dias de gozo saem do saldo e o INSS considera o já retido', () => {
    const r = calcularRescisao(entrada({ feriasNoMes: { dias: 10, baseInss: 400_000, inss: 40_000 } }));
    expect(valor(r, 'salario')).toBe(100_000);
    expect(linha(r, 'inss')?.memoria).toContain('recibo de férias');
  });

  it('sem tabela legal ou parâmetros não calcula; rubrica de outro tipo é inválida; tabela conferida', () => {
    expect(calcularRescisao(entrada({ tabelasLegais: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-tabela-legal',
    ]);
    expect(calcularRescisao(entrada({ parametros: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-parametros',
    ]);
    const torta = { ...TABELA_2026, inss: { ...TABELA_2026.inss, faixas: [] } };
    expect(calcularRescisao(entrada({ tabelasLegais: [torta] })).pendencias[0]?.codigo).toBe(
      'tabela-legal-divergente',
    );
    const inv = calcularRescisao(
      entrada({ parametros: [{ ...PARAM_2026, rubricas: { ...PARAM_2026.rubricas, feriasVencidas: 999 } }] }),
    );
    expect(inv.pendencias).toEqual([{ codigo: 'rubrica-invalida', vinculos: [1], papel: 'feriasVencidas' }]);
  });

  it('salário-família proporcional aos dias do saldo; falecimento e rescisão indireta', () => {
    const sf = calcularRescisao(
      entrada({ salarios: [SALARIO(1, 150_000, { dependentesSalarioFamilia: 2 })] }),
    );
    // 2 × 65,04 × 20/30.
    expect(valor(sf, 'salarioFamilia')).toBe(8_672);
    const fal = calcularRescisao(entrada({ modalidade: 'falecimento', aviso: 'nenhum' }));
    expect(valor(fal, 'decimoProporcional')).toBe(250_000);
    expect(valor(fal, 'avisoIndenizado')).toBe(0);
    expect(linha(fal, 'multaFgts')).toBeUndefined();
    const ind = calcularRescisao(entrada({ modalidade: 'rescisao-indireta' }));
    expect(valor(ind, 'avisoIndenizado')).toBe(360_000);
    expect(ind.apuracao?.percentualMulta).toBe(4000);
    expect(modalidadeSugerida({ saque: '02', causa: null })).toBe('culpa-reciproca');
    expect(modalidadeSugerida({ saque: null, causa: null })).toBeNull();
  });

  it('líquido negativo barra (o adiantamento do 13º maior que o termo)', () => {
    const r = calcularRescisao(
      entrada({ modalidade: 'justa-causa', aviso: 'nenhum', adiantamentoDecimo: 5_000_000 }),
    );
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['liquido-negativo']);
    expect(r.recibo?.resumo.liquido).toBe(0);
  });
});
