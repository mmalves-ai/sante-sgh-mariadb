// Acesso ao dado do paciente no PEP, comum ao prontuário ao vivo (M15) e aos registros clínicos (M22):
//   - vínculo assistencial (regra 11 do M15; cap-08 §8.4): com o parâmetro do estabelecimento que restringe o
//     acesso a paciente fora do atendimento, a decisão do M06 (vínculo, ou quebra de vidro vigente); sem vínculo,
//     403 `sem-vinculo` (com a oferta da quebra de vidro quando o perfil pode pedi-la) e a tentativa na trilha;
//   - a primeira leitura de cada paciente na sessão vai à trilha dupla como a Consulta do RES (uma vez; sem
//     trilha, sem dado);
//   - toda leitura conta para os alertas ao Auditor (regra 12), qualquer que seja a rota.
// Sem dado clínico nem nome em nada disto: só o ID do paciente, a parte e o motivo.
import {
  chaveLeitura,
  definicaoParametro,
  EVENTOS_AUDITAVEIS,
  type MotivoAcessoProntuario,
  type ParteProntuario,
  PERMISSOES_ACESSO,
  type ValorParametro,
} from '@sgh/contratos';
import { decidir, exigeVinculo, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { resolverParametro, type SujeitoParametro, valorTipado } from '@sgh/dominio-config';
import { avaliarLeitura, horaLocal, LIMITES_PADRAO, type LimitesLeitura } from '@sgh/dominio-pep';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { logger } from '../../logger.js';
import { ErroProblema } from '../../problema.filter.js';
import type { AlertaAuditor } from '../acesso/alerta.js';
import type { RegistroEmergencia } from '../acesso/emergencia.controller.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

export interface DependenciasAcessoPaciente {
  readonly estado: EstadoProntuario;
  readonly trilha: RegistradorTrilha;
  readonly alerta: AlertaAuditor | null;
  readonly configuracao: FonteConfiguracao | null;
  readonly vinculo: VinculoAssistencialPort;
  readonly emergencia: RegistroEmergencia | null;
}

/** Recurso na trilha: o prontuário ao vivo (M15) ou os registros clínicos (M22). */
export type RecursoPep = 'pep.prontuario' | 'pep.evolucao' | 'pep.prescricao';

const MENSAGEM_SEM_VINCULO: Readonly<Record<RecursoPep, string>> = {
  'pep.prontuario': 'Neste estabelecimento, o prontuário só abre para quem atende o paciente.',
  'pep.evolucao': 'Neste estabelecimento, só quem atende o paciente lê ou registra no prontuário dele.',
  'pep.prescricao': 'Neste estabelecimento, só quem atende o paciente lê ou prescreve para ele.',
};

export function chaveSessaoPep(s: SessaoCadastro) {
  return {
    rede: s.rede,
    hospital: s.hospital,
    login: s.login,
    fimDaSessao: s.req.sgh?.sessao.expiraEm ?? null,
  };
}

export class AcessoPacientePep {
  constructor(private readonly d: DependenciasAcessoPaciente) {}

  /**
   * Com a restrição do estabelecimento ligada, a mesma decisão do M06 (vínculo assistencial, ou quebra de vidro
   * vigente). Sem vínculo: 403 `sem-vinculo`, com a quebra de vidro quando o perfil pode pedi-la; a tentativa vai
   * à trilha. Sem a porta de vínculo real, ninguém tem vínculo (falha fechada).
   */
  async exigirVinculo(
    s: SessaoCadastro,
    paciente: number,
    permissao: string,
    recurso: RecursoPep,
  ): Promise<void> {
    const a = s.req.sgh;
    if (!a || a.sessao.restricaoVinculo !== true) return;
    const [forma, vigente] = await Promise.all([
      this.d.vinculo.vinculo(s.login, { idPaciente: paciente }),
      this.d.emergencia ? this.d.emergencia.vigente(s.hospital, s.login, paciente) : Promise.resolve(null),
    ]);
    const decisao = decidir({
      autenticado: true,
      ability: a.ability,
      permissao,
      exigeVinculo: exigeVinculo(false, true),
      temVinculo: forma !== null,
      emergenciaVigente: vigente !== null,
      podeQuebrarVidro: a.sessao.permissoes.includes(PERMISSOES_ACESSO.emergenciaSolicitar),
    });
    if (decisao.desfecho === 'permite') return;
    await this.d.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'sem-vinculo').slice(0, 64),
        recurso,
        resultado: 'falha',
        paciente,
        tabelaAlvo: 'RICADPAC',
        idAlvo: String(paciente),
        chaveNaturalAlvo: `sem-vinculo:${decisao.desfecho}`,
      })
      .catch(() => undefined);
    throw new ErroProblema(
      'sem-vinculo',
      403,
      'Sem vínculo assistencial com o paciente',
      MENSAGEM_SEM_VINCULO[recurso],
      { quebraDeVidro: decisao.desfecho === 'quebra-de-vidro' },
    );
  }

  /**
   * Para as listas gerais (D-VINC-24, M45.5): com a restrição do estabelecimento ligada, só os pacientes com vínculo
   * assistencial do login (ou quebra de vidro vigente); sem ela, todos.
   */
  async pacientesComVinculo(s: SessaoCadastro, pacientes: readonly number[]): Promise<Set<number>> {
    const unicos = [...new Set(pacientes.filter((p) => p > 0))];
    if (s.req.sgh?.sessao.restricaoVinculo !== true) return new Set(unicos);
    const ok = new Set<number>();
    for (const p of unicos) {
      const [forma, vigente] = await Promise.all([
        this.d.vinculo.vinculo(s.login, { idPaciente: p }),
        this.d.emergencia ? this.d.emergencia.vigente(s.hospital, s.login, p) : Promise.resolve(null),
      ]);
      if (forma !== null || vigente !== null) ok.add(p);
    }
    return ok;
  }

  /**
   * Leitura de dado do paciente (o vínculo já conferido): a primeira do paciente na sessão vai à trilha dupla
   * como a Consulta do RES (uma vez; sem trilha, 503 e nada mostrado) e toda leitura conta para os alertas.
   */
  async registrarLeitura(
    s: SessaoCadastro,
    paciente: number,
    parte: ParteProntuario,
    motivo: MotivoAcessoProntuario,
    recurso: RecursoPep,
  ): Promise<void> {
    const abertura = this.d.estado.primeiraLeitura(chaveSessaoPep(s), paciente);
    if (abertura.primeira)
      try {
        await this.d.trilha.registrar({
          evento: EVENTOS_AUDITAVEIS.consultaRes.codigo,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, 'consulta-res').slice(0, 64),
          recurso,
          resultado: 'sucesso',
          paciente,
          tabelaAlvo: 'RICADPAC',
          idAlvo: String(paciente),
          chaveNaturalAlvo: chaveLeitura(parte, motivo, 'abertura'),
        });
      } catch {
        abertura.desfazer();
        throw new ErroProblema(
          'trilha-indisponivel',
          503,
          'Trilha de auditoria indisponível',
          'A consulta não foi registrada; nada foi mostrado. Tente de novo em instantes.',
        );
      }
    await this.avaliarAlertas(s, paciente, recurso);
  }

  /** Limites dos alertas pelos parâmetros do sistema novo (estabelecimento ou rede); falha → o padrão. */
  async limites(s: SessaoCadastro): Promise<LimitesLeitura> {
    let valores: ValorParametro[] = [];
    try {
      valores = this.d.configuracao ? await this.d.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const sujeito: SujeitoParametro = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: null,
      perfis: [],
      usuario: s.login,
    };
    const ler = (chave: string, padrao: number) => {
      const def = definicaoParametro(chave);
      if (!def) return padrao;
      const v = valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor);
      return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
    };
    return {
      janelaMinutos: ler('pep.alertaJanelaMinutos', LIMITES_PADRAO.janelaMinutos),
      maxPacientes: ler('pep.alertaMaxPacientes', LIMITES_PADRAO.maxPacientes),
      inicioHabitual: ler('pep.horarioHabitualInicio', LIMITES_PADRAO.inicioHabitual),
      fimHabitual: ler('pep.horarioHabitualFim', LIMITES_PADRAO.fimHabitual),
    };
  }

  /** Regra 12: alerta ao Auditor (trilha própria e fila de e-mail), sem dado clínico nem nome. */
  async avaliarAlertas(s: SessaoCadastro, paciente: number, recurso: RecursoPep): Promise<void> {
    const { recentes, nova } = this.d.estado.abrir(s.hospital, s.login, paciente);
    const alertas = avaliarLeitura(recentes, nova, horaLocal(nova.em), await this.limites(s));
    for (const a of alertas) {
      await this.d.trilha
        .registrar({
          evento: EVENTOS_AUDITAVEIS.leituraAlertada.codigo,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, 'alerta-leitura').slice(0, 64),
          recurso,
          resultado: 'sucesso',
          paciente,
          tabelaAlvo: 'RICADPAC',
          chaveNaturalAlvo: `alerta:${a.tipo};crit:${a.criticidade}`,
        })
        .catch(() => undefined);
      await this.d.alerta
        ?.leituraProntuario?.({
          rede: s.rede,
          hospital: s.hospital,
          idUsuario: s.req.sgh?.sessao.usuario.id ?? s.login,
          tipo: a.tipo,
          criticidade: a.criticidade,
          em: new Date(nova.em).toISOString(),
        })
        .catch((e: unknown) =>
          logger.warn(
            { estabelecimento: s.hospital, erro: e instanceof Error ? e.name : 'erro' },
            'alerta de leitura não enfileirado',
          ),
        );
    }
  }
}
