// Montagem das respostas da portaria (M50, etapa 5; regra 9): a busca do paciente (sem o paciente com sigilo de
// presença; o leito só com a visita permitida; o motivo do bloqueio nunca), a avaliação da visita com o que foi lido, o
// visitante e a visita como a portaria os vê (o documento mascarado) e os contatos do período. Sem SQL (a porta lê).
import {
  type ContatoVisita,
  type DominiosPortaria,
  type FundamentoAcompanhante,
  IDENTIFICACAO_BIOMETRICA,
  mascararDocumento,
  type PacientePortaria,
  type RegraVisitaLida,
  type TipoDocumentoVisitante,
  type VisitaLida,
  type VisitanteLido,
} from '@sgh/contratos';
import {
  avaliarVisita,
  type AvaliacaoVisita,
  bloqueiosVigentes,
  crachaVencido,
  nomeDeBusca,
  type RegraVisita,
  regraDaUnidade,
  temSigilo,
} from '@sgh/dominio-internacao';
import type {
  BloqueioLidoSgh,
  DominiosPortariaLidos,
  InternadoPortaria,
  RegraVisitaLidaSgh,
  VisitaLidaSgh,
  VisitanteLidoSgh,
} from '@sgh/legado';
import type { ContextoPortaria, PortaPortaria } from './porta.js';

export const TETO_BUSCA_PACIENTE = 20;

const paraAvaliar = (b: BloqueioLidoSgh) => ({
  motivo: b.motivo,
  abrangencia: b.abrangencia,
  visitante: b.visitante,
  limite: b.limite,
  incluiAcompanhante: b.incluiAcompanhante,
  inicio: b.inicio,
  fim: b.fim,
  revogado: b.revogado,
});

/** Os domínios como a tela os recebe (a biometria marcada e disponível só com a DP-45). */
export function dominiosParaTela(d: DominiosPortariaLidos, biometriaLigada: boolean): DominiosPortaria {
  return {
    tiposVisitante: d.tiposVisitante,
    tiposVisitado: d.tiposVisitado,
    identificacoes: d.identificacoes.map((i) => {
      const biometrica = IDENTIFICACAO_BIOMETRICA.includes(i.codigo);
      return { ...i, biometrica, disponivel: !biometrica || biometriaLigada };
    }),
    tiposTerminal: d.tiposTerminal,
    situacoesAcesso: d.situacoesAcesso,
  };
}

export function visitanteParaTela(v: VisitanteLidoSgh): VisitanteLido {
  return {
    id: v.id,
    nome: v.nome,
    tipoDocumento: v.tipoDocumento as TipoDocumentoVisitante,
    documentoMascarado: mascararDocumento(v.documento),
    nascimento: v.nascimento,
    telefone: v.telefone,
    tipoVisitante: v.tipoVisitante,
    temFoto: v.fotoChave !== null,
    reterAte: v.reterAte,
    ultimaVisita: v.ultimaVisita,
  };
}

/** As palavras da busca estão todas no nome? */
export function casaBusca(nome: string, busca: string): boolean {
  const n = nomeDeBusca(nome);
  const palavras = nomeDeBusca(busca)
    .split(' ')
    .filter((p) => p.length > 0);
  return palavras.length > 0 && palavras.every((p) => n.split(' ').some((w) => w.startsWith(p)));
}

export interface ContextoDoPaciente {
  readonly regra: RegraVisita;
  readonly padrao: boolean;
  readonly bloqueios: ReturnType<typeof paraAvaliar>[];
  readonly abertas: number;
  readonly acompanhante: { visitante: number; nome: string; fundamento?: FundamentoAcompanhante } | null;
}

/** A visita aberta que ocupa a vaga agora: sem a saída e com o crachá válido (a vencida não conta). */
export const visitaEmCurso = (v: Pick<VisitaLidaSgh, 'saida' | 'validoAte'>, agora: string): boolean =>
  v.saida === null && !crachaVencido(v.validoAte, agora);

export class ServicoPortaria {
  constructor(private readonly porta: PortaPortaria) {}

  /** A regra de cada unidade (a da unidade, a do estabelecimento ou a de mercado), como a tela mostra. */
  regrasParaTela(regras: readonly RegraVisitaLidaSgh[]): RegraVisitaLida[] {
    const r: RegraVisitaLida[] = regras.map((x) => ({ ...x, padrao: false }));
    if (!regras.some((x) => x.unidade === '*')) {
      const p = regraDaUnidade([], '*').regra;
      r.unshift({
        ...p,
        id: null,
        unidade: '*',
        observacao: null,
        versao: 0,
        atualizadoPor: null,
        atualizadoEm: null,
        padrao: true,
      });
    }
    return r;
  }

  /** O contexto de um paciente para a avaliação: a regra, os bloqueios vigentes, as visitas abertas, o acompanhante. */
  async contexto(c: ContextoPortaria, i: InternadoPortaria, agora: string): Promise<ContextoDoPaciente> {
    const [regras, bloqueios, abertas, acompanhantes] = await Promise.all([
      this.porta.regras(c),
      this.porta.bloqueios(c, i.internacao),
      this.porta.abertas(c),
      this.porta.acompanhantes(c, i.unidade),
    ]);
    const { regra, padrao } = regraDaUnidade(regras, i.unidade);
    const acomp = acompanhantes.find((a) => a.internacao === i.internacao) ?? null;
    return {
      regra,
      padrao,
      bloqueios: bloqueiosVigentes(bloqueios.map(paraAvaliar), agora),
      abertas: abertas.filter(
        (v) => v.internacao === i.internacao && v.papel === 'visitante' && visitaEmCurso(v, agora),
      ).length,
      acompanhante: acomp
        ? { visitante: acomp.visitante, nome: acomp.visitanteNome, fundamento: acomp.fundamento }
        : null,
    };
  }

  /** A busca da portaria: os internados cujo nome casa com a busca, sem o sigilo de presença, até o teto. */
  async buscarPacientes(c: ContextoPortaria, busca: string, agora: string): Promise<PacientePortaria[]> {
    const [internados, regras, bloqueios, abertas, acompanhantes] = await Promise.all([
      this.porta.internados(c),
      this.porta.regras(c),
      this.porta.bloqueios(c, null),
      this.porta.abertas(c),
      this.porta.acompanhantes(c, null),
    ]);
    const porReg = new Map<number, ReturnType<typeof paraAvaliar>[]>();
    for (const b of bloqueiosVigentes(
      bloqueios.map((x) => ({ ...paraAvaliar(x), reg: x.internacao })),
      agora,
    ))
      (porReg.get(b.reg) ?? porReg.set(b.reg, []).get(b.reg)!).push(b);
    return internados
      .filter((i) => casaBusca(i.nome, busca) && !temSigilo(porReg.get(i.internacao) ?? []))
      .slice(0, TETO_BUSCA_PACIENTE)
      .map((i) => {
        const { regra } = regraDaUnidade(regras, i.unidade);
        const acomp = acompanhantes.find((a) => a.internacao === i.internacao) ?? null;
        const ctx: ContextoDoPaciente = {
          regra,
          padrao: false,
          bloqueios: porReg.get(i.internacao) ?? [],
          abertas: abertas.filter(
            (v) => v.internacao === i.internacao && v.papel === 'visitante' && visitaEmCurso(v, agora),
          ).length,
          acompanhante: acomp
            ? { visitante: acomp.visitante, nome: acomp.visitanteNome, fundamento: acomp.fundamento }
            : null,
        };
        return this.pacienteParaTela(i, ctx, this.avaliar(ctx, i, agora, null));
      });
  }

  avaliar(
    ctx: ContextoDoPaciente,
    i: Pick<InternadoPortaria, 'isolamento'>,
    agora: string,
    v: {
      id: number;
      nascimento: string | null;
      emVisita: boolean;
      biometrica: boolean;
      biometriaLigada: boolean;
      excecao: boolean;
    } | null,
  ): AvaliacaoVisita {
    return avaliarVisita({
      agora,
      regra: ctx.regra,
      isolamento: i.isolamento,
      bloqueios: ctx.bloqueios,
      abertas: ctx.abertas,
      acompanhante: ctx.acompanhante?.visitante ?? null,
      acompanhanteFundamento: ctx.acompanhante?.fundamento ?? null,
      visitante: v ? { id: v.id, nascimento: v.nascimento, emVisita: v.emVisita } : null,
      biometrica: v?.biometrica ?? false,
      biometriaLigada: v?.biometriaLigada ?? false,
      excecao: v?.excecao ?? false,
    });
  }

  /** O paciente como o porteiro vê: o leito só com a visita permitida; o motivo do bloqueio nunca. */
  pacienteParaTela(i: InternadoPortaria, ctx: ContextoDoPaciente, a: AvaliacaoVisita): PacientePortaria {
    return {
      internacao: i.internacao,
      nome: i.nome,
      unidade: i.unidade,
      unidadeNome: i.unidadeNome,
      leito: a.permitida ? i.leito : null,
      permitida: a.permitida,
      recusa: a.permitida ? null : a.recusa,
      mensagem: a.permitida ? 'Visita permitida agora.' : a.mensagem,
      orientacao: a.permitida ? a.orientacao : null,
      visitantesAgora: ctx.abertas,
      limite: a.limite,
      horario: `${ctx.regra.horaInicio} às ${ctx.regra.horaFim}`,
      acompanhante: ctx.acompanhante
        ? { visitante: ctx.acompanhante.visitante, nome: ctx.acompanhante.nome }
        : null,
    };
  }

  /** A visita como a portaria a vê (o leito só se a visita é ao paciente; o paciente pelo nome lido). */
  visitaParaTela(
    v: VisitaLidaSgh,
    internados: ReadonlyMap<number, InternadoPortaria>,
    agora: string,
  ): VisitaLida {
    const i = v.internacao !== null ? internados.get(v.internacao) : undefined;
    return {
      id: v.id,
      visitante: { id: v.visitante, nome: v.visitanteNome, temFoto: v.temFoto },
      papel: v.papel,
      destino:
        v.internacao !== null
          ? {
              tipo: 'paciente',
              internacao: v.internacao,
              paciente: i?.nome ?? '',
              unidade: i?.unidadeNome ?? v.bloco ?? '',
              leito: [v.acomod, v.leito].filter(Boolean).join('-') || null,
            }
          : { tipo: 'outro', tipoVisitado: v.tipoVisitado, local: v.local ?? '' },
      cracha: v.cracha,
      identificacao: v.identificacao,
      entrada: v.entrada,
      validoAte: v.validoAte,
      saida: v.saida,
      excecao: v.excecao,
      vencida: v.saida === null && crachaVencido(v.validoAte, agora),
      usuario: v.usuario,
    };
  }

  contatoParaTela(v: VisitaLidaSgh, internados: ReadonlyMap<number, InternadoPortaria>): ContatoVisita {
    const i = v.internacao !== null ? internados.get(v.internacao) : undefined;
    return {
      visita: v.id,
      visitante: v.visitanteNome,
      documentoMascarado: mascararDocumento(v.documento),
      telefone: v.telefone,
      papel: v.papel,
      paciente: i?.nome ?? `Internação ${v.internacao ?? ''}`.trim(),
      unidade: i?.unidadeNome ?? v.bloco ?? '',
      entrada: v.entrada,
      saida: v.saida,
    };
  }
}
