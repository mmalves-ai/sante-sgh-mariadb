// As funcionalidades do pós-fechamento (protocolo, recurso e retorno; conciliação; lote; competência; webservices),
// cada uma um apoio de gravação com o mapa operação → permissão de agir que vale também no servidor. Tudo ligado para
// todos (decisão de produto, F3.7): nenhuma chave de liberação; o acesso é só a permissão do cargo. A `chave` fica
// como o nome do recurso na trilha.
import type { GravacaoTiss } from '@sgh/contratos';
import { destinoEnvio } from '@sgh/dominio-faturamento';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghTiss, PortaTiss } from './porta.js';

export const FUNCIONALIDADES_TISS = {
  protocoloRecurso: {
    chave: 'faturamento.protocoloRecurso',
    nome: 'o protocolo, o recurso e o retorno do recurso',
    operacoes: {
      'faturamento.registrarProtocolo': 'faturamento.protocolo.registrar',
      'faturamento.registrarRecurso': 'faturamento.glosa.recorrer',
      'faturamento.registrarRetornoRecurso': 'faturamento.glosa.registrarDesfecho',
    },
    extras: {},
  },
  conciliacao: {
    chave: 'faturamento.conciliacao',
    nome: 'a conciliação (demonstrativo, baixa e decisão da glosa)',
    operacoes: { 'faturamento.registrarGlosa': 'faturamento.glosa.baixar' },
    extras: {
      importarDemonstrativo: 'faturamento.demonstrativo.importar',
      decidirGlosa: 'faturamento.glosa.decidir',
    },
  },
  lote: {
    chave: 'faturamento.lote',
    nome: 'a montagem e o envio do lote TISS',
    operacoes: { 'faturamento.gerarLote': 'faturamento.lote.gerar' },
    extras: { enviarLote: 'faturamento.lote.enviar' },
  },
  competencia: {
    chave: 'faturamento.competencia',
    nome: 'o fechamento de competência',
    operacoes: {
      'faturamento.fecharCompetencia': 'faturamento.competencia.fechar',
      'faturamento.reabrirCompetencia': 'faturamento.competencia.reabrir',
    },
    extras: {},
  },
  integracaoTiss: {
    chave: 'integracao.tiss',
    nome: 'os webservices TISS por operadora',
    operacoes: {},
    extras: { editarEndpoint: 'integracao.tiss.editar' },
  },
} as const;

export type FuncionalidadeTiss = keyof typeof FUNCIONALIDADES_TISS;

export class ApoiosTiss {
  readonly apoios: Readonly<Record<FuncionalidadeTiss, ApoioGravacao<GravadorSghTiss>>>;

  constructor(
    readonly porta: PortaTiss,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    readonly cache: CacheConfig | null,
    readonly ambiente: string,
  ) {
    const a = (f: FuncionalidadeTiss) =>
      new ApoioGravacao<GravadorSghTiss>(
        {
          chave: FUNCIONALIDADES_TISS[f].chave,
          nome: FUNCIONALIDADES_TISS[f].nome,
          operacoes: FUNCIONALIDADES_TISS[f].operacoes,
          semLiberacao: true,
        },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoios = {
      protocoloRecurso: a('protocoloRecurso'),
      conciliacao: a('conciliacao'),
      lote: a('lote'),
      competencia: a('competencia'),
      integracaoTiss: a('integracaoTiss'),
    };
  }

  daOperacao(op: string): ApoioGravacao<GravadorSghTiss> {
    for (const [f, d] of Object.entries(FUNCIONALIDADES_TISS))
      if (op in d.operacoes) return this.apoios[f as FuncionalidadeTiss];
    return this.apoios.lote;
  }

  async gravacao(s: SessaoCadastro): Promise<GravacaoTiss> {
    const funcionalidades: Record<string, { ligada: boolean; motivo: string | null }> = {};
    const operacoes: Record<string, { ligada: boolean; motivo: string | null }> = {};
    await Promise.all(
      (Object.keys(FUNCIONALIDADES_TISS) as FuncionalidadeTiss[]).map(async (f) => {
        const g = await this.apoios[f].gravacao(s, FUNCIONALIDADES_TISS[f].extras);
        funcionalidades[f] = { ligada: g.ligada, motivo: g.motivo };
        for (const [op, v] of Object.entries(g.operacoes))
          operacoes[op] = { ligada: v.pode, motivo: v.motivo };
      }),
    );
    return { funcionalidades, operacoes, ambiente: this.ambiente, destinoEnvio: destinoEnvio(this.ambiente) };
  }
}
