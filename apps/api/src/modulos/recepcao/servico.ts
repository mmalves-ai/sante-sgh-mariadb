// Serviço da recepção (M19; ficha, seções 4 e 7): monta as telas a partir da porta (própria ou memória) com as regras
// puras de @sgh/dominio-recepcao: a fila do guichê na ordem de chamada, os eventos possíveis, o painel de chamada sem
// nome (iniciais no máximo, por parâmetro), o totem, o painel do supervisor (esperas, guichês, mais antigas) e os
// indicadores (agregados do banco e as esperas que o novo mede). Nenhum SQL aqui (fronteira Nx).
import {
  type AgendadoDoDia,
  type AgendadosDoDia,
  type ApoioRecepcao,
  type ChamadaPainel,
  type FilaGuiche,
  foraDaFila,
  GRUPOS_PRIORIDADE,
  type IndicadoresRecepcao,
  MOTIVOS_SUSPENSAO,
  type PainelChamadas,
  type PainelSupervisor,
  type SenhaEmitida,
  type SenhaLida,
  TETO_FILA,
  type TotemConfig,
  ULTIMAS_CHAMADAS_PAINEL,
} from '@sgh/contratos';
import {
  esperaAte,
  esperasPorGuiche,
  esperasPorHora,
  falaChamada,
  iniciaisDaChamada,
  maisAntigas,
  nomeNaLista,
  usaNomeSocial,
  resumirEsperas,
  resumirFila,
} from '@sgh/dominio-recepcao';
import type {
  AgendadoRecepcao,
  DispositivoRecepcao,
  PacienteDaSenha,
  Recepcao,
  SenhaRecepcao,
} from './tipos.js';
import type { CentralChamadas, ChamadaInterna } from './chamadas.js';
import { ordemDosServicos, ordenarCandidatas } from './regra-fila.js';
import { geradorParaTela, prioridadeDaTela, senhaNaTela } from './codigos-senha.js';
import type { ContextoRecepcao, PortaRecepcao } from './porta.js';

export function senhaParaTela(s: SenhaRecepcao, agora: string, comUsuario: boolean): SenhaLida {
  const t = senhaNaTela(s);
  return {
    id: s.id,
    numero: s.numero,
    texto: s.texto,
    gerador: s.gerador,
    servico: s.servico,
    tipoGerador: t.tipoGerador,
    prioridade: t.prioridade,
    grupo: t.grupo,
    situacao: t.situacao,
    guiche: t.guiche,
    usuario: comUsuario ? s.usuario || null : null,
    emitidaEm: s.emitidaEm,
    esperaMinutos: esperaAte(s.emitidaEm, agora),
    origem: s.origem,
    chamadas: s.chamadas,
    chamadaEm: s.chamadaEm,
    atendida: s.atendida,
    agendamento: s.agendamento,
    ultimoLocal: s.ultimoLocal,
  };
}

/**
 * As senhas no guichê, a chamada mais recente primeiro: pelo instante da última chamada que o novo mediu
 * (evento de chamada da senha); sem medida (chamada pelo outro sistema), a emitida depois vem antes.
 */
export function ordenarNoGuiche<T extends Pick<SenhaRecepcao, 'id' | 'chamadaEm' | 'emitidaEm'>>(
  xs: readonly T[],
): T[] {
  const chave = (s: T) => s.chamadaEm ?? s.emitidaEm;
  return [...xs].sort((a, b) => chave(b).localeCompare(chave(a)) || b.id - a.id);
}

export class ServicoRecepcao {
  constructor(
    private readonly porta: PortaRecepcao,
    private readonly central: CentralChamadas | null = null,
  ) {}

  async apoio(c: ContextoRecepcao, login: string): Promise<ApoioRecepcao> {
    const [recepcoes, guiches, r] = await Promise.all([
      this.porta.recepcoes(c),
      this.porta.guichesEmUso(c),
      this.porta.relogio(c),
    ]);
    const meu = guiches.find((g) => g.usuario === login) ?? null;
    return {
      recepcoes: recepcoes.map((x) => ({
        id: x.id,
        descricao: x.descricao,
        locais: x.locais.map((l) => ({
          id: l.id,
          cod: l.cod,
          descricao: l.descricao,
          ativo: l.ativo,
          encaminha: l.encaminha,
        })),
        geradores: x.geradores.map((g) => geradorParaTela(g)),
        guiches: x.guiches,
      })),
      guichesEmUso: guiches.map((g) => ({
        recepcao: g.recepcao,
        local: g.local,
        guiche: g.guiche,
        ocupadoPor: g.usuario === login ? ('voce' as const) : ('outro' as const),
        usuario: null,
      })),
      meuGuiche: meu ? { recepcao: meu.recepcao, local: meu.local, guiche: meu.guiche } : null,
      hoje: r.hoje,
      agora: r.agora,
      motivosSuspensao: MOTIVOS_SUSPENSAO.map((m) => ({ codigo: m.codigo, texto: m.texto })),
    };
  }

  /** A fila do guichê: aguardando na ordem de chamada, as do guichê, as suspensas e as em atendimento. */
  async fila(
    c: ContextoRecepcao,
    p: { recepcao: number; local: number; guiche: number; geradores: readonly number[]; login: string },
  ): Promise<FilaGuiche> {
    const [r, recepcoes, guiches, todas] = await Promise.all([
      this.porta.relogio(c),
      this.porta.recepcoes(c),
      this.porta.guichesEmUso(c),
      this.porta.senhasDoDia(c, { recepcao: p.recepcao }),
    ]);
    const rec = recepcoes.find((x) => x.id === p.recepcao);
    const geradores =
      p.geradores.length > 0 ? p.geradores : (rec?.geradores.filter((g) => g.ativo).map((g) => g.id) ?? []);
    const dos = todas.senhas.filter((s) => geradores.includes(s.gerador));
    // A ordem de chamada é a do cadastro dos serviços (a mesma da operação de chamar); serviços com ordens diferentes
    // são listados pela chegada (a chamada da próxima, nesse caso, é recusada e a senha é escolhida na lista).
    const ordem = ordemDosServicos(
      (rec?.geradores ?? []).filter((g) => geradores.includes(g.id)).map((g) => g.ordem),
    );
    const aguardando = ordenarCandidatas(
      dos.filter((s) => s.situacao === 'aguardando' && !s.atendida),
      ordem.ok ? ordem.ordem : 'chegada',
    );
    const tela = (s: SenhaRecepcao) => senhaParaTela(s, r.agora, false);
    const aberto = guiches.some(
      (g) =>
        g.recepcao === p.recepcao && g.local === p.local && g.guiche === p.guiche && g.usuario === p.login,
    );
    return {
      hoje: r.hoje,
      agora: r.agora,
      recepcao: p.recepcao,
      local: p.local,
      guiche: p.guiche,
      guicheAberto: aberto,
      aguardando: aguardando.slice(0, TETO_FILA).map(tela),
      // A mais recente primeiro (a última chamada pelo guichê): F7 e F8 agem nela, nunca na senha antiga que
      // ficou no guichê (a do tipo recepção só sai dele com a abertura do atendimento).
      noGuiche: ordenarNoGuiche(
        dos.filter((s) => s.guiche === p.guiche && !s.atendida && s.situacao === 'chamada'),
      ).map(tela),
      suspensas: dos.filter((s) => foraDaFila(s.situacao) && !s.atendida && s.guiche !== p.guiche).map(tela),
      emAtendimento: todas.senhas
        .filter((s) => s.atendida && ['chamada', 'em_atendimento', 'encaminhada'].includes(s.situacao))
        .map(tela),
      total: dos.length,
      cortada: todas.cortada || aguardando.length > TETO_FILA,
    };
  }

  /** Os agendados do dia pela busca do guichê (CPF, prontuário, agenda); `cortada` avisa a tela para refinar. */
  async agendados(
    c: ContextoRecepcao,
    f: { cpf?: string | undefined; prontuario?: number | undefined; agenda?: string | undefined } = {},
  ): Promise<AgendadosDoDia> {
    const { itens, cortada } = await this.porta.agendados(c, {
      cpf: f.cpf ?? null,
      prontuario: f.prontuario ?? null,
      agenda: f.agenda ?? null,
    });
    const prontuarios = itens.map((a) => a.prontuario);
    const [sigilosos, fotos] = await Promise.all([
      this.porta.sigilosos(c, prontuarios),
      this.porta.fotos(c, prontuarios),
    ]);
    return {
      cortada,
      itens: itens.map((a) => {
        const sigiloso = sigilosos.has(a.prontuario);
        // O sigiloso não mostra a foto (mascarado como o nome; a identidade se confere pelo documento).
        return this.agendadoParaTela(a, sigiloso, sigiloso ? null : (fotos.get(a.prontuario) ?? null));
      }),
    };
  }

  /** Nome de tratamento mascarado (nome social quando houver; o sigiloso não mostra nem as letras). */
  private agendadoParaTela(a: AgendadoRecepcao, sigiloso: boolean, foto: string | null): AgendadoDoDia {
    const ident = { nome: a.paciente, nomeSocial: a.nomeSocial, sigiloso };
    return {
      tipo: a.tipo,
      marcacao: a.marcacao,
      hora: a.hora,
      agenda: a.agenda,
      paciente: nomeNaLista(ident),
      nomeSocial: usaNomeSocial(ident),
      sigiloso,
      foto,
      prontuario: a.prontuario,
      chegou: a.senha !== null,
      senha: a.senha,
    };
  }

  // ── Totem ───────────────────────────────────────────────────────────────────────────────────────

  async totemConfig(c: ContextoRecepcao, d: DispositivoRecepcao): Promise<TotemConfig> {
    const recepcoes = await this.porta.recepcoes(c);
    const rec = recepcoes.find((x) => x.id === d.recepcao);
    const servicos = (rec?.geradores ?? [])
      .filter((g) => g.ativo && g.noTotem)
      .filter((g) => d.geradores.length === 0 || d.geradores.includes(g.id))
      .map((g) => ({
        gerador: g.id,
        rotulo: g.rotuloTotem || g.nome,
        letra: g.letra,
        prioritaria: g.prioritaria,
        recepcao: g.tipo === 'atendimento',
      }));
    return {
      nome: d.nome,
      recepcao: d.recepcao ?? 0,
      servicos,
      checkin: true,
      gruposPrioridade: GRUPOS_PRIORIDADE.filter((g) => g.grupo !== 2).map((g) => ({
        grupo: g.grupo,
        rotulo: g.rotulo,
        prioridade: g.prioridade,
      })),
    };
  }

  async senhaEmitida(
    c: ContextoRecepcao,
    id: number,
    agendamento: { tipo: string; hora: string } | null = null,
  ): Promise<SenhaEmitida> {
    const [s, aFrente] = await Promise.all([this.porta.senha(c, id), this.porta.aFrente(c, id)]);
    if (!s) throw new Error('Senha emitida não relida.');
    return {
      senha: s.id,
      numero: s.numero,
      texto: s.texto,
      servico: s.servico,
      emitidaEm: s.emitidaEm,
      aFrente,
      prioridade: prioridadeDaTela(s),
      agendamento,
    };
  }

  // ── Painel de chamada ───────────────────────────────────────────────────────────────────────────

  private destino(recepcoes: Recepcao[], c: ChamadaInterna): string {
    const local = recepcoes.flatMap((r) => r.locais).find((l) => l.id === c.local);
    if (c.guiche > 0 && (!local || local.recepcao === c.recepcao)) return `Guichê ${c.guiche}`;
    return local?.descricao ?? 'Recepção';
  }

  async painel(
    c: ContextoRecepcao,
    d: DispositivoRecepcao,
    mostrarIniciais: boolean,
  ): Promise<PainelChamadas> {
    if (!this.central) throw new Error('Central de chamadas ausente.');
    const [{ chamadas, atualizadoEm }, recepcoes] = await Promise.all([
      this.central.chamadas(c.hospital, { recepcao: d.recepcao, locais: d.locais }),
      this.porta.recepcoes(c),
    ]);
    const ultimas = chamadas.slice(0, ULTIMAS_CHAMADAS_PAINEL);
    const nomes = mostrarIniciais
      ? await this.porta.pacientesDasSenhas(
          c,
          ultimas.map((x) => x.senha),
        )
      : new Map<number, PacienteDaSenha>();
    const sigilosos =
      nomes.size > 0
        ? await this.porta.sigilosos(
            c,
            [...nomes.values()].map((p) => p.prontuario),
          )
        : new Set<number>();
    const iniciaisDe = (senha: number): string | null => {
      const p = nomes.get(senha);
      return p ? iniciaisDaChamada({ ...p, sigiloso: sigilosos.has(p.prontuario) }) : null;
    };
    const tela = (x: ChamadaInterna): ChamadaPainel => {
      const destino = this.destino(recepcoes, x);
      return {
        chave: x.chave,
        senha: x.senha,
        texto: x.texto,
        destino,
        guiche: x.guiche,
        // Iniciais no máximo (LGPD; regra 6), do nome social quando houver; o sigiloso não tem iniciais (W1-04).
        iniciais: mostrarIniciais ? iniciaisDe(x.senha) : null,
        prioridade: x.prioridade,
        em: x.em,
        origem: x.origem,
        fala: falaChamada({ texto: x.texto, destino, guiche: x.guiche }),
      };
    };
    const lista = ultimas.map(tela);
    return {
      nome: d.nome,
      recepcao: d.recepcao ?? 0,
      voz: d.voz,
      atual: lista[0] ?? null,
      ultimas: lista,
      atualizadoEm,
    };
  }

  // ── Supervisor e indicadores ────────────────────────────────────────────────────────────────────

  async supervisor(
    c: ContextoRecepcao,
    recepcao: number | null,
    tempoAlvoPadrao: number,
  ): Promise<PainelSupervisor> {
    const [r, recepcoes, guiches, todas] = await Promise.all([
      this.porta.relogio(c),
      this.porta.recepcoes(c),
      this.porta.guichesEmUso(c),
      this.porta.senhasDoDia(c, { recepcao }),
    ]);
    const geradores = recepcoes
      .filter((x) => recepcao === null || x.id === recepcao)
      .flatMap((x) => x.geradores.filter((g) => g.ativo || todas.senhas.some((s) => s.gerador === g.id)));
    const aguardando = todas.senhas
      .filter((s) => s.situacao === 'aguardando' && !s.atendida)
      .map((s) => ({ ...s, prioridade: prioridadeDaTela(s) }));
    const filas = geradores.map((g) => {
      const alvo = g.tempoAlvoMinutos ?? tempoAlvoPadrao;
      const f = resumirFila(
        aguardando.filter((s) => s.gerador === g.id),
        r.agora,
        alvo,
      );
      return {
        gerador: g.id,
        recepcao: g.recepcao,
        servico: `${g.letra} · ${g.nome}`,
        tempoAlvoMinutos: alvo,
        ...f,
      };
    });
    const contar = (f: (s: SenhaRecepcao) => boolean) => todas.senhas.filter(f).length;
    return {
      hoje: r.hoje,
      agora: r.agora,
      filas,
      guiches: guiches
        .filter((g) => recepcao === null || g.recepcao === recepcao)
        .map((g) => ({
          recepcao: g.recepcao,
          local: g.local,
          guiche: g.guiche,
          ocupadoPor: 'outro' as const,
          usuario: g.usuario,
          chamadasHoje: todas.senhas.filter((s) => s.recepcao === g.recepcao && s.guiche === g.guiche).length,
        })),
      maisAntigas: maisAntigas(aguardando, 10).map((s) => senhaParaTela(s, r.agora, false)),
      totais: {
        emitidas: todas.senhas.length,
        aguardando: aguardando.length,
        chamadas: contar((s) => s.guiche !== null || s.chamadas > 0),
        liberadas: contar((s) => s.situacao === 'atendida'),
        suspensas: contar((s) => foraDaFila(s.situacao)),
        atendidas: contar((s) => s.atendida),
      },
    };
  }

  async indicadores(
    c: ContextoRecepcao,
    de: string,
    ate: string,
    recepcao: number | null,
  ): Promise<IndicadoresRecepcao> {
    const x = await this.porta.indicadores(c, de, ate, recepcao);
    return {
      de,
      ate,
      porHora: x.porHora,
      porDia: x.porDia,
      porSituacao: x.porSituacao,
      prioridade: x.prioridade,
      porServico: x.porServico,
      esperas: resumirEsperas(x.tempos),
      esperaPorHora: esperasPorHora(x.tempos),
      porGuiche: esperasPorGuiche(x.tempos),
      naoLocalizado: x.naoLocalizado,
      total: x.total,
    };
  }
}
