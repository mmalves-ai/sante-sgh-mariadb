// Unidade do gravador próprio do cálculo da folha (família folha-executor): as traduções entre o banco e o contrato
// (tipo do processamento, competência, datas, modalidade e aviso da rescisão), o resumo por vínculo igual ao da porta de
// memória e as recusas sem gravar (empresa fora da sessão, férias e obrigações sem modelo).
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  competenciaNoBanco,
  gravadorFolhaExecutor,
  linhaDe,
  processoDe,
  resumirLinhas,
  tipoProcessoNoBanco,
} from './folha-executor-proprio.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe('traduções do processamento', () => {
  it('tipo e competência no formato do banco', () => {
    expect(tipoProcessoNoBanco('decimo1')).toBe('decimo_terceiro_1');
    expect(tipoProcessoNoBanco('decimo2')).toBe('decimo_terceiro_2');
    expect(tipoProcessoNoBanco('mensal')).toBe('mensal');
    expect(competenciaNoBanco('2098-07')).toBe('2098-07-01');
  });

  it('linha do banco vira o processamento do contrato (sem troca: situação sem autor)', () => {
    const p = processoDe({
      id: 7,
      estabelecimento_id: 3,
      competencia: new Date(2098, 10, 1),
      tipo: 'decimo_terceiro_1',
      numero: 2,
      situacao: 'calculada',
      pagamento_em: '2098-11-30',
      totais: '{"colaboradores":1}',
      quantidade_fora_da_folha: 4,
      tabela_legal_inicio: null,
      parametros_inicio: new Date(2098, 0, 1),
      resumo: 'abc',
      motivo: null,
      criado_em: new Date('2098-11-01T10:00:00Z'),
      alterado_em: null,
      versao: 1,
      calculado_por: 'fulano',
      situacao_por: 'outro',
    });
    expect(p).toMatchObject({
      competencia: '2098-11',
      tipo: 'decimo1',
      pagamento: '2098-11-30',
      totais: { colaboradores: 1 },
      foraDaFolha: 4,
      tabelaLegal: '',
      parametros: '2098-01-01',
      calculadoPor: 'fulano',
      calculadoEm: '2098-11-01T10:00:00.000Z',
      situacaoPor: null,
      situacaoEm: null,
    });
  });

  it('linha sem tipo gravado sai pelo papel; código da rubrica só quando numérico; resumo igual ao da memória', () => {
    const base = {
      vinculo_trabalho_id: 5,
      rubrica_id: 9,
      quantidade: '30.0000',
      unidade: 'dias',
      memoria_calculo: 'm',
      centro_custo_id: null,
      dias_pagos: 30,
    };
    const a = linhaDe({ ...base, papel: 'inss', tipo: null, codigo_rubrica: '101', valor: '270.00' });
    const b = linhaDe({ ...base, papel: 'baseInss', tipo: 'base', codigo_rubrica: 'X1', valor: '3000.00' });
    expect(a).toMatchObject({
      tipo: 'desconto',
      codigoRubrica: 101,
      quantidade: 30,
      valor: 270,
      centroCusto: 0,
    });
    expect(b.codigoRubrica).toBeNull();
    expect(resumirLinhas([a, b])).toEqual([
      {
        vinculo: 5,
        centroCusto: 0,
        diasPagos: 30,
        proventos: 0,
        descontos: 270,
        porPapel: expect.objectContaining({ inss: 270, baseInss: 3000, multaFgts: 0 }),
      },
    ]);
  });

  it('rescisão relida com trava pela leitura do cálculo: filtro da simulação, sublinhado para hífen, conferida = calculada', async () => {
    const sqls: string[] = [];
    const linha = {
      id: 1,
      vinculo_trabalho_id: 5,
      estabelecimento_id: 3,
      data_desligamento: '2098-08-10',
      tipo_rescisao_id: null,
      modalidade: 'sem_justa_causa',
      aviso_previo: 'nao_cumprido',
      dias_aviso: 33,
      dias_aviso_indenizados: 0,
      data_projetada_aviso: null,
      termo_contrato: null,
      saldo_fgts: '10.00',
      saldo_fgts_informado: 1,
      valor_multa_fgts: '4.00',
      pagamento_limite_em: '2098-08-20',
      situacao: 'conferida',
      processamento_folha_id: 8,
      motivo_situacao: null,
      criado_em: '2098-08-10 10:00:00',
      alterado_em: null,
      versao: 1,
      registrado_login: 'fulano',
    };
    const tx = {
      consultarParaAtualizar: async (sql: string) => {
        sqls.push(sql);
        return /FROM vinculo_trabalho/.test(sql)
          ? [{ id: 5, data_desligamento: '2098-08-10', tipo_rescisao_id: 7 }]
          : [linha];
      },
    } as unknown as TxOperacao;
    const t = await gravadorFolhaExecutor(tx, 3).rescisoesDoVinculoComTrava(5);
    expect(t).toMatchObject({ desligamento: '2098-08-10', tipoRescisao: 7 });
    expect(t.rescisoes[0]).toMatchObject({
      modalidade: 'sem-justa-causa',
      aviso: 'nao-cumprido',
      situacao: 'calculada',
      situacaoPor: null,
      projecao: '2098-08-10',
      saldoFgts: 10,
      saldoFgtsInformado: true,
      processo: 8,
      registradoPor: 'fulano',
    });
    expect(sqls[1]).toMatch(/situacao <> 'simulacao'/);
    expect(sqls[1]).toMatch(/processamento_folha_id IS NOT NULL/);
  });
});

describe('recusas do gravador sem tocar no banco', () => {
  const tx = new Proxy({} as TxOperacao, {
    get: () => () => Promise.reject(new Error('não devia ler nem gravar')),
  });
  const g = gravadorFolhaExecutor(tx, 3);
  const novo = {
    empresa: 4,
    competencia: '2098-07',
    numero: 1,
    totais: {} as never,
    foraDaFolha: 0,
    tabelaLegal: '',
    parametros: '',
    resumo: 'r',
    por: 'x',
  };

  it('empresa fora da sessão', async () => {
    expect(await codigo(g.incluirProcesso(novo))).toBe('empresa-fora-da-sessao');
    expect(await g.emVigorComTrava(4, '2098-07')).toEqual({ vigente: null, proximoNumero: 1 });
    expect(await g.processosCalculadosComTrava(4, '2098-01', '2098-12')).toEqual([]);
    expect(
      await codigo(g.incluirParametrosObrigacoes({ empresa: 4, inicio: '2098-01', dados: '{}', por: 'x' })),
    ).toBe('empresa-fora-da-sessao');
  });

  it('incluir férias, marcá-las calculadas e as obrigações: modelo-pendente', async () => {
    for (const p of [
      g.incluirFerias({} as never),
      g.situacaoFerias({ id: 1, versao: 1, de: 'programada', para: 'calculada', motivo: null, por: 'x' }),
      g.situacaoFerias({
        id: 1,
        versao: 1,
        de: 'programada',
        para: 'cancelada',
        processo: 9,
        motivo: 'm',
        por: 'x',
      }),
      g.obrigacoesEmVigorComTrava(3, 'sefip', '2098-07'),
      g.obrigacaoComTrava(1),
      g.incluirObrigacao({} as never),
      g.substituirObrigacao({} as never),
      g.registrarEntregaObrigacao({} as never),
      g.cancelarObrigacao({} as never),
    ])
      expect(await codigo(p)).toBe('modelo-pendente');
  });
});
