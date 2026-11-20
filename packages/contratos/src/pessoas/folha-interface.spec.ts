// Contrato de interface com a folha externa (M53-F0; regras 4 a 6). Dados sintéticos: o CPF é gerado no teste a partir
// de uma base fictícia (nenhum documento real no arquivo).
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_EVENTO_PONTO_FOLHA,
  CODIGOS_TIPO_HORA,
  esquemaColaboradorExportado,
  esquemaColaboradorRetorno,
  esquemaGerarExportacaoFolha,
  esquemaLoteExportacaoFolha,
  esquemaLoteRetornoFolha,
  esquemaResumoLoteFolha,
  ROTULOS_EVENTO_PONTO_CONHECIDOS,
  ROTULOS_TIPO_HORA_CONHECIDOS,
  SITUACOES_LOTE_FOLHA,
  TETO_LINHAS_LOTE_FOLHA,
  VERSAO_LEIAUTE_FOLHA_INTERFACE,
  type LoteExportacaoFolha,
  type LoteRetornoFolha,
} from './folha-interface.js';
import { esquemaAlterarAfastamento, esquemaRegistrarAfastamento } from './folha-api.js';

/** CPF sintético: base de 9 dígitos fictícia + os dois verificadores calculados. */
function cpfSintetico(base9: string): string {
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(`${base9}${d1}`)}`;
}

const colaborador = (vinculo: number) => ({
  vinculo,
  cpf: cpfSintetico(String(100_000_000 + vinculo)),
  matriculaExterna: null,
  tipoVinculo: 'clt' as const,
  admissao: '2025-02-01',
  desligamento: null,
  centroCusto: 12,
  setor: 3,
  cbo: '223505',
  conselho: { sigla: 'COREN', numero: 'TESTE-1', uf: 'MG', validade: null },
});

function loteExportado(): LoteExportacaoFolha {
  return {
    leiaute: VERSAO_LEIAUTE_FOLHA_INTERFACE,
    lote: 1,
    empresa: 1,
    estabelecimento: 'pc',
    competencia: '2026-09',
    periodo: { inicio: '2026-09-01', fim: '2026-09-30' },
    geradoEm: '2026-10-05T12:00:00Z',
    colaboradores: [colaborador(1), colaborador(2)],
    afastamentos: [{ vinculo: 2, motivo: 1, inicio: '2026-09-10', fim: '2026-09-14' }],
    eventosPonto: [
      { vinculo: 1, evento: 1, minutos: 10_560 },
      { vinculo: 1, evento: 5, minutos: 420 },
    ],
    horasPonto: [
      { vinculo: 1, tipoHora: 1, minutos: 10_560 },
      { vinculo: 1, tipoHora: 5, minutos: 420 },
    ],
    plantoes: [
      {
        vinculo: 1,
        plantao: 77,
        modalidade: 'presencial',
        inicio: '2026-09-06T19:00:00-03:00',
        fim: '2026-09-07T07:00:00-03:00',
        minutos: 720,
        centroCusto: 12,
      },
    ],
    totais: {
      colaboradores: 2,
      afastamentos: 1,
      eventosPonto: 2,
      minutosPonto: 10_980,
      plantoes: 1,
      minutosPlantao: 720,
    },
  };
}

function loteRetorno(): LoteRetornoFolha {
  return {
    leiaute: VERSAO_LEIAUTE_FOLHA_INTERFACE,
    loteExportado: 1,
    empresa: 1,
    competencia: '2026-09',
    recebido: loteExportado().totais,
    colaboradores: [
      {
        vinculo: 1,
        matriculaExterna: 'M-1',
        rubricas: [
          { codigo: '001', natureza: 'provento', valor: 400_000 },
          { codigo: '901', natureza: 'desconto', valor: 50_000 },
        ],
        liquido: 350_000,
      },
    ],
    encargos: [{ tipo: 'fgts', valor: 32_000, vencimento: '2026-10-20', centroCusto: null }],
    vencimentoLiquido: '2026-10-05',
    totais: { colaboradores: 1, proventos: 400_000, descontos: 50_000, liquido: 350_000, encargos: 32_000 },
  };
}

describe('lote exportado à folha externa', () => {
  it('aceita o lote completo da competência', () => {
    expect(esquemaLoteExportacaoFolha.parse(loteExportado()).totais.colaboradores).toBe(2);
  });

  it('regra 4: o colaborador exportado não leva salário nem rubrica (o dono é o sistema de folha)', () => {
    expect(esquemaColaboradorExportado.safeParse({ ...colaborador(1), salario: 1 }).success).toBe(false);
    expect(esquemaColaboradorExportado.safeParse({ ...colaborador(1), rubricas: [] }).success).toBe(false);
  });

  it('recusa CPF com verificador errado, com pontuação ou repetido', () => {
    const bom = colaborador(1).cpf;
    const errado = `${bom.slice(0, 10)}${(Number(bom[10]) + 1) % 10}`;
    for (const cpf of [errado, `${bom.slice(0, 3)}.${bom.slice(3)}`, '1'.repeat(11)])
      expect(esquemaColaboradorExportado.safeParse({ ...colaborador(1), cpf }).success).toBe(false);
  });

  it('regra 5: evento de ponto só pelos 13 tipos de integração', () => {
    const l = loteExportado();
    expect(CODIGOS_EVENTO_PONTO_FOLHA).toHaveLength(13);
    expect(CODIGOS_TIPO_HORA).toHaveLength(9);
    expect(
      esquemaLoteExportacaoFolha.safeParse({ ...l, eventosPonto: [{ vinculo: 1, evento: 14, minutos: 1 }] })
        .success,
    ).toBe(false);
    expect(
      esquemaLoteExportacaoFolha.safeParse({ ...l, eventosPonto: [{ vinculo: 1, evento: 13, minutos: 1 }] })
        .success,
    ).toBe(true);
  });

  it('regra 5: os minutos por tipo de hora (POTPHORA) só pelos 9 tipos; o lote sem o bloco é recusado', () => {
    const l = loteExportado();
    const com = (horasPonto: unknown) => esquemaLoteExportacaoFolha.safeParse({ ...l, horasPonto }).success;
    expect(com([{ vinculo: 1, tipoHora: 9, minutos: 1 }])).toBe(true);
    expect(com([{ vinculo: 1, tipoHora: 10, minutos: 1 }])).toBe(false);
    expect(com([{ vinculo: 1, tipoHora: 1, minutos: -1 }])).toBe(false);
    expect(com([{ vinculo: 1, tipoHora: 1, minutos: 1, evento: 1 }])).toBe(false);
    const semBloco: Partial<LoteExportacaoFolha> = { ...l };
    delete semBloco.horasPonto;
    expect(esquemaLoteExportacaoFolha.safeParse(semBloco).success).toBe(false);
  });

  it('recusa leiaute de outra versão, competência malformada e lote acima do teto', () => {
    const l = loteExportado();
    expect(esquemaLoteExportacaoFolha.safeParse({ ...l, leiaute: '0.9' }).success).toBe(false);
    expect(esquemaLoteExportacaoFolha.safeParse({ ...l, competencia: '2026-13' }).success).toBe(false);
    const muitos = Array.from({ length: TETO_LINHAS_LOTE_FOLHA + 1 }, () => ({
      vinculo: 1,
      evento: 1,
      minutos: 1,
    }));
    expect(esquemaLoteExportacaoFolha.safeParse({ ...l, eventosPonto: muitos }).success).toBe(false);
  });

  it('rótulos conhecidos cobrem só códigos válidos', () => {
    for (const c of Object.keys(ROTULOS_EVENTO_PONTO_CONHECIDOS))
      expect(CODIGOS_EVENTO_PONTO_FOLHA as readonly number[]).toContain(Number(c));
    for (const c of Object.keys(ROTULOS_TIPO_HORA_CONHECIDOS))
      expect(CODIGOS_TIPO_HORA as readonly number[]).toContain(Number(c));
  });
});

describe('lote de retorno da folha externa', () => {
  it('aceita o retorno com eco dos totais, rubricas, encargos e vencimento', () => {
    expect(esquemaLoteRetornoFolha.parse(loteRetorno()).totais.liquido).toBe(350_000);
  });

  it('regra 4: o retorno não traz dado assistencial (conselho) nem CPF', () => {
    const c = loteRetorno().colaboradores[0]!;
    expect(esquemaColaboradorRetorno.safeParse({ ...c, conselho: null }).success).toBe(false);
    expect(esquemaColaboradorRetorno.safeParse({ ...c, cpf: colaborador(1).cpf }).success).toBe(false);
  });

  it('valores em centavos inteiros e não negativos', () => {
    const r = loteRetorno();
    expect(
      esquemaLoteRetornoFolha.safeParse({ ...r, totais: { ...r.totais, liquido: 3500.5 } }).success,
    ).toBe(false);
    expect(
      esquemaLoteRetornoFolha.safeParse({
        ...r,
        encargos: [{ tipo: 'inss', valor: -1, vencimento: '2026-10-20', centroCusto: null }],
      }).success,
    ).toBe(false);
  });

  it('o retorno exige o eco dos totais recebidos (conferência nos dois sentidos)', () => {
    const sem: Partial<LoteRetornoFolha> = loteRetorno();
    delete sem.recebido;
    expect(esquemaLoteRetornoFolha.safeParse(sem).success).toBe(false);
  });
});

describe('entradas e respostas da tela', () => {
  it('gerar exportação: empresa e competência, nada mais', () => {
    expect(esquemaGerarExportacaoFolha.safeParse({ empresa: 1, competencia: '2026-09' }).success).toBe(true);
    expect(
      esquemaGerarExportacaoFolha.safeParse({ empresa: 1, competencia: '2026-09', lote: 3 }).success,
    ).toBe(false);
  });

  it('o resumo do lote não carrega CPF nem nome', () => {
    const resumo = {
      id: 1,
      sentido: 'exportado' as const,
      empresa: 1,
      competencia: '2026-09',
      situacao: 'gerado' as const,
      geradoEm: '2026-10-05T12:00:00Z',
      geradoPor: 'usuario.teste',
      colaboradores: 2,
      soma: 11_700,
      divergencias: [],
      resumo: 'a'.repeat(64),
    };
    expect(esquemaResumoLoteFolha.parse(resumo).situacao).toBe('gerado');
    expect(esquemaResumoLoteFolha.safeParse({ ...resumo, cpf: colaborador(1).cpf }).success).toBe(false);
    expect(SITUACOES_LOTE_FOLHA).toContain('divergente');
  });
});

describe('afastamento: texto livre em CP1252', () => {
  it('a observação e o motivo do cancelamento recusam o caractere fora do CP1252 com mensagem; o comum passa', () => {
    const base = { vinculo: 1, motivo: 1, inicio: '2026-09-01', fim: null };
    expect(
      esquemaRegistrarAfastamento.parse({ ...base, observacao: '  Licença médica — atestado  ' }).observacao,
    ).toBe('Licença médica — atestado');
    for (const ruim of ['ida → volta', 'nota ≥ 7', 'ok ✓', 'feito 😀']) {
      const r = esquemaRegistrarAfastamento.safeParse({ ...base, observacao: ruim });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(['observacao']);
      expect(r.error?.issues[0]?.message).toBeTruthy();
    }
    expect(esquemaRegistrarAfastamento.parse(base).observacao).toBeNull();
    const cancelar = { versao: 0, acao: 'cancelar' as const, fim: null };
    expect(esquemaAlterarAfastamento.safeParse({ ...cancelar, motivo: 'lançado → errado' }).success).toBe(
      false,
    );
    expect(esquemaAlterarAfastamento.parse({ ...cancelar, motivo: 'Lançado em duplicidade' }).motivo).toBe(
      'Lançado em duplicidade',
    );
  });
});
