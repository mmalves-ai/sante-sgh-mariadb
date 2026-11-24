// As funcionalidades do financeiro (ficha do M32, seção 12): uma chave de liberação por setor (contas a pagar, contas a
// receber, tesouraria e fiscal), cada uma um apoio de gravação do M18 (POL-3: completa e DESLIGADA até a conferência; o
// administrador liga por estabelecimento, setor ou pessoa), com o mapa operação → permissão de agir que vale também no
// servidor.
import type { GravacaoFinanceiro } from '@sgh/contratos';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghFinanceiro, PortaFinanceiro } from './porta.js';

export const FUNCIONALIDADES_FINANCEIRO = {
  contasPagar: {
    chave: 'financeiro.contasPagar',
    nome: 'o contas a pagar (lançamento, aprovação, borderô e pagamento)',
    operacoes: {
      'financeiro.criarTituloPagar': 'financeiro.tituloPagar.criar',
      'financeiro.baixarTitulo': 'financeiro.tituloPagar.baixar',
    },
    extras: {
      aprovarTitulo: 'financeiro.tituloPagar.aprovar',
      prorrogarVencimento: 'financeiro.tituloPagar.prorrogar',
      editarAlcada: 'financeiro.parametro.editar',
      gerarRemessa: 'financeiro.remessa.gerar',
      concederAdiantamento: 'financeiro.adiantamento.conceder',
      aprovarAdiantamento: 'financeiro.adiantamento.aprovar',
      pagarAdiantamento: 'financeiro.adiantamento.pagar',
      compensarAdiantamento: 'financeiro.adiantamento.compensar',
      devolverAdiantamento: 'financeiro.adiantamento.devolver',
    },
  },
  contasReceber: {
    chave: 'financeiro.contasReceber',
    nome: 'o contas a receber (título da conta, baixa e glosa no título)',
    operacoes: { 'financeiro.criarTituloReceber': 'financeiro.tituloReceber.criar' },
    extras: {
      baixarManual: 'financeiro.tituloReceber.baixarManual',
      registrarGlosa: 'financeiro.tituloReceber.baixar',
    },
  },
  tesouraria: {
    chave: 'financeiro.tesouraria',
    nome: 'a tesouraria (movimento bancário, extrato e conciliação)',
    operacoes: {
      'financeiro.lancarMovimento': 'financeiro.movimento.criar',
      // F3.8 (07-FIN linha 85): fechar a competência é da tesouraria; reabrir, de quem edita o parâmetro do financeiro.
      'financeiro.fecharPeriodo': 'financeiro.movimento.criar',
      'financeiro.reabrirPeriodo': 'financeiro.parametro.editar',
      // F3.8 (07-FIN linhas 98 e 99): reclassificação gerencial e permissões do financeiro.
      'financeiro.reclassificarLancamento': 'financeiro.classificacao.editar',
      'financeiro.manterEscopoConta': 'financeiro.parametro.editar',
      'financeiro.manterTipoLancamento': 'financeiro.parametro.editar',
    },
    extras: {
      importarExtrato: 'financeiro.conciliacao.conciliar',
      conciliar: 'financeiro.conciliacao.conciliar',
      atribuirCredito: 'financeiro.conciliacao.conciliar',
    },
  },
  fiscal: {
    chave: 'financeiro.fiscal',
    nome: 'o fiscal (NFS-e, DMED, EFD-REINF e exportação contábil)',
    operacoes: {},
    extras: {
      emitirNfse: 'financeiro.nfse.emitir',
      gerarDmed: 'financeiro.dmed.gerar',
      gerarReinf: 'financeiro.reinf.gerar',
      exportarContabil: 'financeiro.exportacaoContabil.exportar',
    },
  },
  // M55 (etapa 3): o título ligado a contrato com fornecedor só com os contratos ligados (ficha, seção 12).
  contratos: {
    chave: 'contratos',
    nome: 'os contratos com fornecedores',
    operacoes: {},
    extras: {},
  },
} as const;

export type FuncionalidadeFinanceiro = keyof typeof FUNCIONALIDADES_FINANCEIRO;

export class ApoiosFinanceiro {
  readonly apoios: Readonly<Record<FuncionalidadeFinanceiro, ApoioGravacao<GravadorSghFinanceiro>>>;

  constructor(
    readonly porta: PortaFinanceiro,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    readonly cache: CacheConfig | null,
    readonly ambiente: string,
  ) {
    const a = (f: FuncionalidadeFinanceiro) =>
      new ApoioGravacao<GravadorSghFinanceiro>(
        {
          chave: FUNCIONALIDADES_FINANCEIRO[f].chave,
          nome: FUNCIONALIDADES_FINANCEIRO[f].nome,
          operacoes: FUNCIONALIDADES_FINANCEIRO[f].operacoes,
        },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoios = {
      contasPagar: a('contasPagar'),
      contasReceber: a('contasReceber'),
      tesouraria: a('tesouraria'),
      fiscal: a('fiscal'),
      contratos: a('contratos'),
    };
  }

  daOperacao(op: string): ApoioGravacao<GravadorSghFinanceiro> {
    for (const [f, d] of Object.entries(FUNCIONALIDADES_FINANCEIRO))
      if (op in d.operacoes) return this.apoios[f as FuncionalidadeFinanceiro];
    return this.apoios.contasPagar;
  }

  async gravacao(s: SessaoCadastro): Promise<GravacaoFinanceiro> {
    const funcionalidades: Record<string, { ligada: boolean; motivo: string | null }> = {};
    const operacoes: Record<string, { ligada: boolean; motivo: string | null }> = {};
    await Promise.all(
      (Object.keys(FUNCIONALIDADES_FINANCEIRO) as FuncionalidadeFinanceiro[]).map(async (f) => {
        const g = await this.apoios[f].gravacao(s, FUNCIONALIDADES_FINANCEIRO[f].extras);
        funcionalidades[f] = { ligada: g.ligada, motivo: g.motivo };
        for (const [op, v] of Object.entries(g.operacoes))
          operacoes[op] = { ligada: v.pode, motivo: v.motivo };
      }),
    );
    return {
      funcionalidades,
      operacoes,
      ambiente: this.ambiente,
      destinoExterno: this.ambiente === 'producao' ? 'real' : 'simulador',
    };
  }
}
