// As funcionalidades da conta do paciente (contas, lançamento manual, fila tardia, auditoria, regras e pacotes,
// particular, pagamento eletrônico), cada uma um apoio de gravação com o mapa operação → permissão de agir que vale
// também no servidor. Tudo ligado para todos (decisão de produto, F3.7): nenhuma chave de liberação; o acesso é só a
// permissão do cargo. A `chave` fica como o nome do recurso na trilha.
import type { GravacaoFaturamento } from '@sgh/contratos';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghFaturamento, PortaFaturamento } from './porta.js';

const FUNCIONALIDADES = {
  contas: {
    chave: 'faturamento.contas',
    nome: 'as contas do paciente (conferir, fechar e reabrir)',
    operacoes: {
      'faturamento.fecharConta': 'faturamento.conta.fechar',
      'faturamento.reabrirConta': 'faturamento.conta.reabrir',
      'faturamento.conferirItem': 'faturamento.item.conferir',
    },
    extras: {
      registrarPendencia: 'faturamento.pendencia.editar',
      etapaConferencia: 'faturamento.item.conferir',
    },
  },
  lancamentoManual: {
    chave: 'faturamento.lancamentoManual',
    nome: 'o lançamento manual na conta',
    operacoes: { 'faturamento.lancarItem': 'faturamento.item.lancar' },
    extras: {},
  },
  lancamentoTardio: {
    chave: 'faturamento.lancamentoTardio',
    nome: 'a fila de lançamento após o fechamento',
    operacoes: {},
    extras: { decidirTardio: 'faturamento.lancamentoTardio.decidir' },
  },
  auditoria: {
    chave: 'faturamento.auditoria',
    nome: 'a auditoria de contas',
    operacoes: {},
    extras: {
      registrarVersao: 'faturamento.auditoria.ajustar',
      etapaAuditoria: 'faturamento.auditoria.ajustar',
    },
  },
  regras: {
    chave: 'faturamento.regras',
    nome: 'as regras de faturabilidade e os pacotes',
    operacoes: {},
    extras: { editarRegra: 'faturamento.regra.editar', editarPacote: 'faturamento.pacote.editar' },
  },
  particular: {
    chave: 'faturamento.particular',
    nome: 'o particular (orçamento, caixa e recibo)',
    operacoes: {},
    extras: {
      registrarOrcamento: 'faturamento.orcamento.criar',
      caixa: 'faturamento.recibo.emitir',
      receber: 'faturamento.recibo.emitir',
      emitirRecibo: 'faturamento.recibo.emitir',
    },
  },
  pagamentoEletronico: {
    chave: 'faturamento.pagamentoEletronico',
    nome: 'o pagamento por Pix e cartão',
    operacoes: {},
    extras: { pagarEletronico: 'faturamento.pagamento.registrar' },
  },
} as const;

export type FuncionalidadeFaturamento = keyof typeof FUNCIONALIDADES;

export class ApoiosFaturamento {
  readonly apoios: Readonly<Record<FuncionalidadeFaturamento, ApoioGravacao<GravadorSghFaturamento>>>;

  constructor(
    readonly porta: PortaFaturamento,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const a = (f: FuncionalidadeFaturamento) =>
      new ApoioGravacao<GravadorSghFaturamento>(
        {
          chave: FUNCIONALIDADES[f].chave,
          nome: FUNCIONALIDADES[f].nome,
          operacoes: FUNCIONALIDADES[f].operacoes,
          semLiberacao: true,
        },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoios = {
      contas: a('contas'),
      lancamentoManual: a('lancamentoManual'),
      lancamentoTardio: a('lancamentoTardio'),
      auditoria: a('auditoria'),
      regras: a('regras'),
      particular: a('particular'),
      pagamentoEletronico: a('pagamentoEletronico'),
    };
  }

  daOperacao(op: string): ApoioGravacao<GravadorSghFaturamento> {
    for (const [f, d] of Object.entries(FUNCIONALIDADES))
      if (op in d.operacoes) return this.apoios[f as FuncionalidadeFaturamento];
    return this.apoios.contas;
  }

  async gravacao(s: SessaoCadastro): Promise<GravacaoFaturamento> {
    const funcionalidades: GravacaoFaturamento['funcionalidades'] = {};
    const operacoes: GravacaoFaturamento['operacoes'] = {};
    await Promise.all(
      (Object.keys(FUNCIONALIDADES) as FuncionalidadeFaturamento[]).map(async (f) => {
        const g = await this.apoios[f].gravacao(s, FUNCIONALIDADES[f].extras);
        funcionalidades[f] = { ligada: g.ligada, motivo: g.motivo };
        for (const [op, v] of Object.entries(g.operacoes))
          operacoes[op] = { ligada: v.pode, motivo: v.motivo };
      }),
    );
    return { funcionalidades, operacoes };
  }
}
