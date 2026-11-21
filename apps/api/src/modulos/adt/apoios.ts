// Apoios de gravação do M21 (uma chave de liberação por funcionalidade, POL-3): a internação (ADT), o mapa de leitos
// operacional (transferência, bloqueio e atributos), o supervisor da internação (cancelar a alta, excluir), a
// higienização e o SAME. Cada operação leva a permissão de agir (vale também no servidor).
import { definicaoParametro, type GravacaoInternacao } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { ApoioGravacao } from '../exames/public-api.js';
import { ApoioGravacaoIdempotente } from './apoio-idempotente.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import type { ContextoAdt, GravadorSghAdt, PortaAdt } from './porta.js';

export const CHAVE_ADT = 'internacao.adt';
export const CHAVE_MAPA = 'leitos.mapa';
export const CHAVE_SUPERVISOR = 'internacao.supervisor';
export const CHAVE_LIMPEZA = 'hotelaria.limpeza';
export const CHAVE_SAME = 'same.movimento';

export const OPERACOES_ADT: Readonly<Record<string, string>> = {
  'internacao.internar': 'internacao.internacao.criar',
  'internacao.preInternar': 'internacao.pre.criar',
  'internacao.corrigirPreInternacao': 'internacao.pre.criar',
  'internacao.trocarConvenio': 'internacao.troca.criar',
  'internacao.trocarClinica': 'internacao.troca.criar',
  'internacao.trocarEspecialidade': 'internacao.troca.criar',
  'internacao.trocarMedico': 'internacao.troca.criar',
  'internacao.registrarGuia': 'internacao.guia.editar',
  'internacao.darAlta': 'internacao.alta.registrar',
};
export const OPERACOES_MAPA: Readonly<Record<string, string>> = {
  'internacao.transferirLeito': 'leitos.transferencia.criar',
};
export const OPERACOES_SUPERVISOR: Readonly<Record<string, string>> = {
  'internacao.cancelarAlta': 'internacao.alta.cancelar',
  'internacao.excluirInternacao': 'internacao.internacao.excluir',
};
export const OPERACOES_LIMPEZA: Readonly<Record<string, string>> = {
  'hotelaria.solicitarLimpeza': 'hotelaria.limpeza.solicitar',
  'hotelaria.liberarLeito': 'hotelaria.limpeza.liberar',
};
export const OPERACOES_SAME: Readonly<Record<string, string>> = {
  'same.movimentarProntuario': 'same.movimento.criar',
  'same.excluirMovimento': 'same.movimento.excluir',
};

const EXTRAS_ADT = { altaMedica: 'internacao.altaMedica.registrar', impresso: 'internacao.impresso.emitir' };
const EXTRAS_MAPA = { bloqueio: 'leitos.bloqueio.criar', atributo: 'leitos.bloqueio.criar' };
const EXTRAS_LIMPEZA = { etapa: 'hotelaria.limpeza.executar', inspecao: 'hotelaria.limpeza.liberar' };

export const ctxAdt = (s: SessaoCadastro): ContextoAdt => s.porta;

const JANELA_OUTRO_SISTEMA = 'hotelaria.janelaOutroSistemaHoras';

/**
 * As horas da janela das limpezas pedidas pela alta ainda sem etapa registrada, pelo parâmetro do estabelecimento (ou da rede):
 * só esses níveis, por isso basta o contexto (rede e estabelecimento). Sem a configuração, o padrão do registro.
 */
export function janelaOutroSistema(
  configuracao: FonteConfiguracao | null,
): (c: ContextoAdt) => Promise<number> {
  return async (c) => {
    const def = definicaoParametro(JANELA_OUTRO_SISTEMA);
    if (!def) return 0;
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = configuracao ? await configuracao.valoresParametro(c.rede, c.hospital) : [];
    } catch {
      valores = [];
    }
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        {
          rede: c.rede,
          empresa: null,
          estabelecimento: c.hospital,
          unidade: null,
          perfis: [],
          usuario: '',
        },
        new Date(),
      ).valor,
    );
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
}

export class ApoiosAdt {
  readonly adt: ApoioGravacao<GravadorSghAdt>;
  readonly mapa: ApoioGravacao<GravadorSghAdt>;
  readonly supervisor: ApoioGravacao<GravadorSghAdt>;
  readonly limpeza: ApoioGravacao<GravadorSghAdt>;
  readonly same: ApoioGravacao<GravadorSghAdt>;

  constructor(
    readonly porta: PortaAdt,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const novo = (chave: string, nome: string, operacoes: Readonly<Record<string, string>>) =>
      new ApoioGravacaoIdempotente<GravadorSghAdt>({ chave, nome, operacoes }, porta, trilha, configuracao, cache);
    this.adt = novo(CHAVE_ADT, 'a internação (admissão, transferência e alta)', OPERACOES_ADT);
    this.mapa = novo(CHAVE_MAPA, 'o mapa de leitos operacional', OPERACOES_MAPA);
    this.supervisor = novo(
      CHAVE_SUPERVISOR,
      'o cancelamento de alta e a exclusão de internação',
      OPERACOES_SUPERVISOR,
    );
    this.limpeza = novo(CHAVE_LIMPEZA, 'a higienização', OPERACOES_LIMPEZA);
    this.same = novo(CHAVE_SAME, 'a movimentação do SAME', OPERACOES_SAME);
  }

  async gravacao(
    s: SessaoCadastro,
  ): Promise<
    GravacaoInternacao & { funcionalidades: Record<string, { ligada: boolean; motivo: string | null }> }
  > {
    const [a, m, sup, l, sa, prof] = await Promise.all([
      this.adt.gravacao(s, EXTRAS_ADT),
      this.mapa.gravacao(s, EXTRAS_MAPA),
      this.supervisor.gravacao(s),
      this.limpeza.gravacao(s, EXTRAS_LIMPEZA),
      this.same.gravacao(s),
      this.porta.profissional(ctxAdt(s), s.login).catch(() => null),
    ]);
    const temPermissao = s.pode('internacao.altaMedica.registrar');
    const medico = prof !== null && prof.conselhoAtivo;
    const altaMedica = !temPermissao
      ? { pode: false, motivo: 'Seu perfil não permite registrar a alta médica.' }
      : !medico
        ? {
            pode: false,
            motivo: 'A alta médica é ato médico: a sessão precisa do vínculo de médico com o conselho ativo.',
          }
        : !a.ligada
          ? { pode: false, motivo: a.motivo }
          : { pode: true, motivo: null };
    return {
      ligada: a.ligada,
      motivo: a.motivo,
      operacoes: { ...a.operacoes, ...m.operacoes, ...sup.operacoes, ...l.operacoes, ...sa.operacoes },
      altaMedica,
      funcionalidades: {
        [CHAVE_ADT]: { ligada: a.ligada, motivo: a.motivo },
        [CHAVE_MAPA]: { ligada: m.ligada, motivo: m.motivo },
        [CHAVE_SUPERVISOR]: { ligada: sup.ligada, motivo: sup.motivo },
        [CHAVE_LIMPEZA]: { ligada: l.ligada, motivo: l.motivo },
        [CHAVE_SAME]: { ligada: sa.ligada, motivo: sa.motivo },
      },
    };
  }
}
