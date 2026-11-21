// Fila do médico na página inicial (ficha do M27, seção 4 e regras 1 a 4; cap-03 §3.2; cap-08 §8.4): os pacientes com
// vínculo assistencial do médico da sessão — o painel "Meus pacientes" do M23 pelo recorte "meus" (o atendimento é dele,
// ele registrou no episódio ou aceitou parecer dele, pelos CBOs do cadastro de profissionais; sem ocupação no cadastro,
// nenhum vínculo e a fila vazia) — com o leito, os dias, a previsão de alta e as pendências:
//   - resultado novo e crítico não visto até a visualização ou a ciência, inclusive os liberados no outro sistema
//     (regra 4; o crítico pela faixa do elemento e pelos limites padrão, como no M23);
//   - internado sem evolução médica nas últimas 24 h, contando os dois sistemas e sem as suspensas (regra 3);
//   - prescrição que vence nas próximas 6 horas sem a do período seguinte (M24);
//   - pareceres pendentes e atrasados (M23) e documentos aguardando assinatura (M23).
// A ordem é a da prioridade e do prazo (regra 1). Teto de 100 pacientes. Só leitura: as ações são as telas de origem.
import {
  type LinhaWorklistMedico,
  type PendenciaMedico,
  TETO_WORKLIST_MEDICO,
  type WorklistMedico,
} from '@sgh/contratos';
import {
  contarResultados,
  ordenarWorklistMedico,
  parecerAtrasado,
  prazoMaisProximo,
  prioridadeDasPendencias,
  type ResultadoDoPaciente,
  semEvolucaoMedica24h,
  situacaoDasAlergiasDoResumo,
} from '@sgh/dominio-pep';
import type { ContextoGravacaoPep, ResultadoLido } from '../tipos-pep.js';
import type { ContextoDocs } from '../documentos-porta.js';
import { idadeTexto, inicioJanelaCritico, type ServicoDocumentos } from '../documentos-servico.js';
import type { PortaPrescricao } from '../prescricao-porta.js';
import type { PortaWorklist } from '../worklist-porta.js';

/** Janela da prescrição a renovar: as que vencem nas próximas 6 horas sem a do período seguinte. */
export const HORAS_PRESCRICAO_A_RENOVAR = 6;
const HORA = 3_600_000;

const local = (d: Date) => d.toISOString().slice(0, 19);

export class ServicoWorklistMedico {
  constructor(
    private readonly documentos: ServicoDocumentos,
    private readonly prescricao: PortaPrescricao | null,
    private readonly worklist: PortaWorklist,
  ) {}

  /** Prescrição a renovar: pelos atendimentos da fila (banco próprio) ou pela leitura do M24 filtrada (memória). */
  private async aRenovar(
    c: ContextoDocs,
    atendimentos: readonly number[],
    agora: string,
    ate: string,
  ): Promise<readonly { atendimento: number; fim: string | null }[]> {
    if (atendimentos.length === 0) return [];
    try {
      if (this.worklist.aRenovar) return await this.worklist.aRenovar(c, atendimentos, agora, ate);
      if (!this.prescricao) return [];
      const doTurno = await this.prescricao.vencemAte(c, agora, ate, null);
      return doTurno.filter((p) => atendimentos.includes(p.atendimento));
    } catch {
      return [];
    }
  }

  async fila(c: ContextoDocs, login: string): Promise<WorklistMedico> {
    const docs = this.documentos.porta;
    const agoraLocal = await docs.agora(c);
    const prof = await docs.profissional(c, login);
    // Regra 2: sem ocupação no cadastro de profissionais, nenhum vínculo — nada aparece.
    return this.filaDoVinculo(c, { cbos: prof?.cbos ?? [], login }, agoraLocal);
  }

  /**
   * A fila pelas ocupações do profissional (ids) e pelo login de quem tem o vínculo assistencial. W0-10 (M4): o portal do
   * médico externo usa a mesma fila pelos registros do profissional ligado à conta (o login do portal não existe no
   * cadastro de usuários: o parecer aceito por login não casa, só o atendimento e o registro no episódio).
   */
  async filaDoVinculo(
    c: ContextoDocs,
    vinculo: { readonly cbos: readonly number[]; readonly login: string },
    agoraLido?: string,
  ): Promise<WorklistMedico> {
    const docs = this.documentos.porta;
    const login = vinculo.login;
    const agoraLocal = agoraLido ?? (await docs.agora(c));
    const agora = new Date(`${agoraLocal.slice(0, 19)}Z`);
    const vazia = (semVinculo: boolean): WorklistMedico => ({
      pacientes: [],
      total: 0,
      teto: TETO_WORKLIST_MEDICO,
      limitado: false,
      semVinculo,
      geradaEm: agoraLocal,
    });
    if (vinculo.cbos.length === 0) return vazia(true);
    const painel = await docs.painel(c, {
      unidade: null,
      busca: null,
      meus: { cbos: vinculo.cbos, login, hospital: c.hospital },
    });
    const linhas = painel.linhas.slice(0, TETO_WORKLIST_MEDICO);
    if (linhas.length === 0) return vazia(false);
    const desde = linhas.reduce(
      (m, l) => {
        const d = inicioJanelaCritico(l.entrada, agora);
        return d < m ? d : m;
      },
      inicioJanelaCritico(null, agora),
    );
    const desdeData = new Date(`${desde}T00:00:00Z`);
    const [pendentes, comp, extra, aVencer] = await Promise.all([
      docs.pendencias(c, login).catch(() => []),
      docs.completudePainel(
        c,
        linhas.map((l) => l.paciente),
        linhas.map((l) => l.atendimento),
        desdeData,
      ),
      this.worklist.leituras(c, {
        login,
        pacientes: linhas.map((l) => l.paciente),
        internacoes: linhas.filter((l) => l.tipo === 'internacao').map((l) => l.registro),
        desde: desdeData,
      }),
      this.aRenovar(
        c,
        linhas.filter((l) => l.tipo === 'internacao').map((l) => l.atendimento),
        local(agora),
        local(new Date(agora.getTime() + HORAS_PRESCRICAO_A_RENOVAR * HORA)),
      ),
    ]);
    const comCiencia = new Set(comp.ciencias.map((x) => x.exame));
    const valoresPorExame = new Map<number, typeof comp.valores>();
    for (const v of comp.valores) valoresPorExame.set(v.exame, [...(valoresPorExame.get(v.exame) ?? []), v]);
    const criticos = new Set(
      [...valoresPorExame]
        .filter(([, vs]) => this.documentos.criticoDoResultado({ valores: vs }))
        .map(([x]) => x),
    );
    const evolucao = new Map(comp.evolucoesMedicas.map((x) => [x.atendimento, x.em]));
    // Alergias pela mesma regra do painel (M23): a lista, o "nega alergias" quando não é anterior à última alergia
    // informada, senão "não avaliadas" (achado da revisão do M27: a fila nunca mostrava o "nega").
    const ultimaAlergia = new Map(comp.alergiasInformadas.map((x) => [x.paciente, x.em]));
    const ultimaNega = new Map(comp.negas.map((x) => [x.paciente, x.em]));
    const previsao = new Map(extra.previsoesAlta.map((x) => [x.internacao, x.previsao]));
    const resultadosDe = (paciente: number): ResultadoDoPaciente[] =>
      extra.resultados
        .filter((r) => r.paciente === paciente)
        .map((r) => ({
          exame: r.exame,
          liberadoEm: r.liberadoEm,
          critico: criticos.has(r.exame),
          // Um só sistema: o resultado é visto quando o médico o abre ou dá a ciência.
          visualizadoNoOutroSistema: false,
          vistoPeloMedico: r.vistoPeloMedico,
          ciencia: comCiencia.has(r.exame),
        }));
    const pacientes: LinhaWorklistMedico[] = linhas.map((l) => {
      const base = `/pep/paciente/${l.paciente}`;
      const ps: PendenciaMedico[] = [];
      const { novos, criticos: crit } = contarResultados(resultadosDe(l.paciente));
      if (crit > 0)
        ps.push({
          tipo: 'critico-nao-visto',
          quantidade: crit,
          prazo: null,
          texto: `${crit} resultado(s) crítico(s) não visto(s).`,
          link: `${base}/resultados`,
        });
      const em = evolucao.get(l.atendimento);
      if (
        semEvolucaoMedica24h({
          internado: l.tipo === 'internacao',
          evolucoes: em ? [{ em, cbo: '225', suspensa: false }] : [],
          entrada: l.entrada,
          agora,
        })
      )
        ps.push({
          tipo: 'sem-evolucao-24h',
          quantidade: 1,
          prazo: null,
          texto: 'Internado sem evolução médica nas últimas 24 horas.',
          link: `/pep/${l.paciente}/registro`,
        });
      const presc = aVencer.filter((p) => p.atendimento === l.atendimento);
      if (presc.length > 0)
        ps.push({
          tipo: 'prescricao-a-renovar',
          quantidade: presc.length,
          prazo:
            presc
              .map((p) => p.fim)
              .filter((x): x is string => !!x)
              .sort()[0]
              ?.slice(0, 16) ?? null,
          texto: 'Prescrição vence em breve sem a do período seguinte.',
          link: `${base}/prescricao`,
        });
      const pareceres = comp.pareceres.filter((p) => p.paciente === l.paciente);
      const atrasados = pareceres.filter((p) =>
        parecerAtrasado(p.situacao, p.prazo ? new Date(p.prazo) : null, agora),
      );
      if (atrasados.length > 0)
        ps.push({
          tipo: 'parecer-atrasado',
          quantidade: atrasados.length,
          prazo:
            atrasados
              .map((p) => p.prazo)
              .filter((x): x is string => !!x)
              .sort()[0]
              ?.slice(0, 16) ?? null,
          texto: `${atrasados.length} parecer(es) fora do prazo.`,
          link: '/pep/interconsultas',
        });
      if (pareceres.length > atrasados.length)
        ps.push({
          tipo: 'parecer-pendente',
          quantidade: pareceres.length - atrasados.length,
          prazo: null,
          texto: `${pareceres.length - atrasados.length} parecer(es) em aberto.`,
          link: '/pep/interconsultas',
        });
      if (novos > 0)
        ps.push({
          tipo: 'resultado-novo',
          quantidade: novos,
          prazo: null,
          texto: `${novos} resultado(s) novo(s).`,
          link: `${base}/resultados`,
        });
      const assinar = pendentes.filter((d) => d.paciente === l.paciente).length;
      if (assinar > 0)
        ps.push({
          tipo: 'assinatura-pendente',
          quantidade: assinar,
          prazo: null,
          texto: `${assinar} documento(s) aguardando assinatura.`,
          link: '/inicio/assinaturas',
        });
      const entrada = l.entrada ? new Date(`${l.entrada.slice(0, 19)}Z`) : null;
      return {
        paciente: l.paciente,
        nome: l.nomeSocial ?? l.nome,
        idade: idadeTexto(l.nascimento, agora),
        sexo: l.sexo,
        prontuario: String(l.prontuario),
        atendimento: l.atendimento,
        registro: l.registro,
        tipo: l.tipo,
        unidade: l.unidade,
        leito: l.leito,
        dias: entrada ? Math.max(0, Math.floor((agora.getTime() - entrada.getTime()) / (24 * HORA))) : null,
        previsaoAlta: l.tipo === 'internacao' ? (previsao.get(l.registro) ?? null) : null,
        alergias: situacaoDasAlergiasDoResumo(
          l.alergiasAtivas,
          ultimaAlergia.get(l.paciente),
          ultimaNega.get(l.paciente),
        ),
        pendencias: ps,
        prioridade: prioridadeDasPendencias(ps),
        prazo: prazoMaisProximo(ps),
      };
    });
    return {
      pacientes: ordenarWorklistMedico(pacientes),
      total: pacientes.length,
      teto: TETO_WORKLIST_MEDICO,
      limitado: painel.limitado || painel.linhas.length > TETO_WORKLIST_MEDICO,
      semVinculo: false,
      geradaEm: agoraLocal,
    };
  }

  /** W0-10 (M4): os resultados liberados do paciente com a marca de crítico (a mesma regra da fila). */
  async resultadosDoPaciente(
    c: ContextoDocs,
    paciente: number,
  ): Promise<(ResultadoLido & { readonly critico: boolean })[]> {
    const rs = await this.documentos.porta.resultados(c, paciente);
    return rs.map((r) => ({ ...r, critico: this.documentos.criticoDoResultado({ valores: r.valores }) }));
  }

  /**
   * W0-10 (M5): a ciência do valor crítico dada fora da tela do prontuário (o médico externo no portal): a mesma ciência
   * do M23 (registro novo com a conduta, que a vigia do M26 lê para parar o escalonamento).
   */
  darCiencia(c: ContextoGravacaoPep, paciente: number, exame: number, conduta: string): Promise<number> {
    return this.documentos.darCiencia(c, paciente, exame, conduta, null);
  }
}
