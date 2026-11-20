// Serviço da etapa 4 do M45 (ficha, seções 4, 7 e 8; regras 7, 8, 17 e 18): monta o que as telas leem (o processo do
// paciente com a terminologia em uso, os domínios, as etapas e os horários do turno; a prescrição de enfermagem da
// unidade no turno; a receita do enfermeiro; as vacinas) a partir das portas, sem SQL. A categoria da sessão
// (enfermeiro ou técnico) vem dos vínculos de enfermagem do login (CBO 2235 e 3222, ativos).
import {
  type ChecagemCuidadoLida,
  type CuidadosDoTurno,
  type DominiosSae,
  type EstadoCuidado,
  type GravacaoSae,
  type HorarioCuidado,
  type ProcessoSaeLido,
  TERMINOLOGIA_SAE_SINTETICA,
  type TerminologiaSae,
  type TermoSae,
} from '@sgh/contratos';
import { regraDaUnidade } from '@sgh/dominio-pep';
import {
  categoriaPorCbo,
  checagemVigente,
  dominiosDaSae,
  estadoDoCuidado,
  fimDaAtividade,
  previstosDaAtividade,
  terminologiaDasLinhas,
  turnoDoInstante,
} from '@sgh/dominio-enfermagem';
import { type AtividadeVigenteLida, type InternadoLido, montarProcessoSae } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoEnfermagem, PortaEnfermagem } from './porta.js';
import type { ContextoSae, PortaSae } from './sae-porta.js';

export const TETO_HORARIOS_TURNO = 500;

export interface VinculoDaSessao {
  readonly categoria: 'enfermeiro' | 'tecnico' | 'outro';
  /** O vínculo (TBCBOPRO) da categoria; nulo sem vínculo de enfermagem. */
  readonly vinculo: number | null;
}

export class ServicoSae {
  constructor(
    readonly porta: PortaSae,
    readonly enfermagem: PortaEnfermagem,
  ) {}

  /** O vínculo de enfermagem do login: o de enfermeiro primeiro, senão o de técnico. */
  async vinculo(c: ContextoEnfermagem, login: string): Promise<VinculoDaSessao> {
    const vs = await this.enfermagem.vinculos(c, login).catch(() => []);
    const enf = vs.find((v) => categoriaPorCbo(v.codigo) === 'enfermeiro');
    const tec = vs.find((v) => categoriaPorCbo(v.codigo) === 'tecnico');
    const v = enf ?? tec ?? null;
    return { categoria: v ? categoriaPorCbo(v.codigo) : 'outro', vinculo: v ? v.cbo : null };
  }

  async terminologia(c: ContextoSae): Promise<TerminologiaSae> {
    return terminologiaDasLinhas(await this.porta.terminologia(c), TERMINOLOGIA_SAE_SINTETICA);
  }

  async dominios(c: ContextoSae): Promise<DominiosSae> {
    const d = await this.porta.dominios(c);
    return dominiosDaSae(d.escala, d.metas);
  }

  /** O internado do atendimento (404 sem ele: a SAE é do paciente internado). */
  async internado(c: ContextoSae, atendimento: number): Promise<InternadoLido> {
    const i = await this.enfermagem.internado(c, atendimento);
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Paciente não internado',
        'O paciente não está internado neste atendimento: abra-o pela unidade.',
      );
    return i;
  }

  /** O processo vigente montado, com as características e os fatores resolvidos pela terminologia em uso. */
  async processo(
    c: ContextoSae,
    atendimento: number,
    t: TerminologiaSae,
  ): Promise<{ atual: ProcessoSaeLido | null; versoes: Awaited<ReturnType<PortaSae['sae']>>['versoes'] }> {
    const s = await this.porta.sae(c, atendimento);
    if (!s.cabecalho) return { atual: null, versoes: s.versoes };
    const mesma = s.cabecalho.sistema === t.sistema && s.cabecalho.versaoTerminologia === t.versao;
    const resolver = (tipo: 'caracteristica' | 'fator', diag: string, codigo: string): TermoSae => {
      const d = mesma ? t.diagnosticos.find((x) => x.codigo === diag) : undefined;
      const lista = tipo === 'caracteristica' ? d?.caracteristicas : d?.fatores;
      return lista?.find((x) => x.codigo === codigo) ?? { codigo, descricao: codigo };
    };
    return { atual: montarProcessoSae(s.cabecalho, s.itens, resolver), versoes: s.versoes };
  }

  /** A grade de horários-padrão da unidade por vezes ao dia (HH:mm). */
  async grade(c: ContextoSae, unidade: string): Promise<Record<string, string[]>> {
    const { regras, porBloco } = await this.enfermagem.regrasHorario(c).catch(() => ({
      regras: [],
      porBloco: new Map<string, number>(),
    }));
    const regra = regraDaUnidade(regras, porBloco, unidade || null, 'I');
    const g = regras.find((r) => r.id === regra?.id)?.grade ?? new Map<number, readonly string[]>();
    const saida: Record<string, string[]> = {};
    for (const [n, hs] of g)
      saida[String(n)] = hs.map((h) => {
        const d = h.replace(/\D/g, '').padStart(4, '0');
        return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
      });
    return saida;
  }

  /**
   * Os horários das atividades vigentes no intervalo [de, ate): um por horário aprazado (com a checagem vigente e os
   * estornos), e no "se necessário" as checagens feitas no intervalo mais a linha aberta para checar agora.
   */
  async horarios(
    c: ContextoSae,
    internados: readonly InternadoLido[],
    o: { readonly de: string; readonly ate: string; readonly agora: string },
  ): Promise<{ horarios: HorarioCuidado[]; cortada: boolean }> {
    if (internados.length === 0) return { horarios: [], cortada: false };
    const por = new Map(internados.map((i) => [i.atendimento, i]));
    const atividades = await this.porta.atividadesVigentes(
      c,
      internados.map((i) => i.atendimento),
    );
    if (atividades.length === 0) return { horarios: [], cortada: false };
    const revisoes = new Map<number, string | null>();
    for (const a of atividades) if (!revisoes.has(a.sae)) revisoes.set(a.sae, null);
    const { itens: checagens, cortada } = await this.porta.checagens(c, {
      atividades: atividades.map((a) => a.id),
      de: o.de,
      ate: o.ate,
    });
    const saida: HorarioCuidado[] = [];
    const linha = (
      a: AtividadeVigenteLida,
      previsto: string,
      estado: EstadoCuidado,
      ch: ChecagemCuidadoLida | null,
      sn: boolean,
    ): HorarioCuidado => {
      const i = por.get(a.atendimento)!;
      return {
        atividade: a.id,
        atendimento: a.atendimento,
        paciente: i.paciente,
        nome: i.nome,
        leito: i.leito,
        descricao: a.descricao,
        previsto,
        estado,
        seNecessario: sn,
        checagem: ch,
        estornos: checagens.filter(
          (x) => x.atividade === a.id && x.previsto === previsto && x.estorno !== null,
        ).length,
      };
    };
    for (const a of atividades) {
      if (!por.has(a.atendimento)) continue;
      const fim = fimDaAtividade(a, revisoes.get(a.sae) ?? null);
      if (a.frequenciaDia === 0) {
        for (const ch of checagens.filter((x) => x.atividade === a.id && x.estorno === null))
          saida.push(linha(a, ch.previsto, ch.feita ? 'feita' : 'naoFeita', ch, true));
        // A linha aberta para checar agora (sem ela quando o ato deste minuto acabou de ser registrado).
        const agoraMin = o.agora.slice(0, 16);
        const jaNesteMinuto = checagens.some(
          (x) => x.atividade === a.id && x.estorno === null && x.previsto === agoraMin,
        );
        if ((fim === null || fim > agoraMin) && a.inicio.slice(0, 16) <= agoraMin && !jaNesteMinuto)
          saida.push(linha(a, agoraMin, 'pendente', null, true));
        continue;
      }
      for (const p of previstosDaAtividade(a, fim, o.de, o.ate)) {
        const ch = checagemVigente(checagens, a.id, p);
        saida.push(linha(a, p, estadoDoCuidado(p, o.agora, ch), ch, false));
      }
    }
    saida.sort(
      (x, y) =>
        x.previsto.localeCompare(y.previsto) || x.leito.localeCompare(y.leito) || x.atividade - y.atividade,
    );
    return {
      horarios: saida.slice(0, TETO_HORARIOS_TURNO),
      cortada: cortada || saida.length > TETO_HORARIOS_TURNO,
    };
  }

  /** A prescrição de enfermagem da unidade no turno (a linha do tempo dos cuidados). */
  async turno(
    c: ContextoSae,
    unidade: string,
    o: { readonly inicioTurnoDiurno: string; readonly gravacao: GravacaoSae },
  ): Promise<CuidadosDoTurno> {
    const agora = (await this.enfermagem.relogio(c)).slice(0, 16);
    const t = turnoDoInstante(agora, o.inicioTurnoDiurno);
    const internados = await this.enfermagem.internados(c, unidade);
    const { horarios, cortada } = await this.horarios(c, internados, { de: t.inicio, ate: t.fim, agora });
    const resumo: Record<EstadoCuidado | 'seNecessario', number> = {
      pendente: 0,
      atrasada: 0,
      feita: 0,
      naoFeita: 0,
      seNecessario: 0,
    };
    for (const h of horarios) {
      if (h.seNecessario && !h.checagem) resumo.seNecessario++;
      else resumo[h.estado]++;
    }
    return { unidade, turno: t, agora, horarios, resumo, gravacao: o.gravacao, cortada };
  }
}

/** Data AAAA-MM-DD → DD/MM/AAAA. */
export function dataBr(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
