// Serviço do NIR (M44, etapa 2): monta as respostas das telas a partir das leituras da porta (vocabulário do novo) e
// decide no servidor o que a tela só mostra: a fila priorizada com o prazo e o estouro, a situação equivalente do
// sistema anterior pelo de-para, os leitos compatíveis com o perfil (sobre o mapa operacional do M21), a cor do quadro
// de permanência pela alta prevista e pelos limites (dias da Portaria 312), a terapia intensiva pela trajetória, a
// calibragem com as duas réguas e os indicadores da reunião de leitos com numerador e denominador. Nenhuma regra mora na
// tela; as gravações passam pelas recusas do motor (máquina, reserva) antes de chegar ao banco.
import {
  type AltasPrevistas,
  type BarreiraAlta,
  type Calibragem,
  chaveTextoLeito,
  CLINICAS_INTERNACAO,
  type DeparaSituacoes,
  type EscopoLimitePermanencia,
  type FilaNir,
  type InternadoNir,
  type LeitosCompativeis,
  type PrioridadeNir,
  type QuadroPermanencia,
  type ReservaNir,
  type ReservasNir,
  type SolicitacaoNir,
} from '@sgh/contratos';
import {
  barreiraVencida,
  calibrar,
  contagemPorEstado,
  corPermanencia,
  deparaVigente,
  diasInternado312,
  diasUtiPelaTrajetoria,
  idadeEmAnos,
  incompatibilidadeComPerfil,
  indicadoresNir,
  type LinhaDepara,
  limiteAplicavel,
  minutosDeEspera,
  minutosParaVencer,
  ordenarFilaNir,
  prazoEstourado,
  situacaoEquivalente,
} from '@sgh/dominio-internacao';
import { type ReservaLeitoNir, type SolicitacaoLeitoNir } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoAdt } from './porta.js';
import type { ServicoAdt } from './servico.js';
import type { ContextoNir, PortaNir } from './nir-porta.js';

const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const AMOSTRA_MINIMA_CALIBRAGEM = 20;

export interface ParametrosNir {
  readonly prazos: Readonly<Record<PrioridadeNir, number>>;
  readonly validadeReservaMin: number;
  readonly amareloDias: number;
  readonly vermelhoDias: number;
  readonly intensivas: readonly number[];
}

export class ServicoNir {
  constructor(
    readonly porta: PortaNir,
    private readonly adt: ServicoAdt,
    private readonly portaAdt: {
      pacienteParaLeito(
        c: ContextoAdt,
        q: { paciente?: number; reg?: number },
      ): Promise<{ paciente: number; sexo: string | null; nascimento: string | null } | null>;
      altasMedicas(c: ContextoAdt, regs: readonly number[]): Promise<Map<number, unknown>>;
    },
  ) {}

  async deparaLinhas(c: ContextoNir): Promise<LinhaDepara[]> {
    const [aprovados, rotulos] = await Promise.all([
      this.porta.depara(c),
      this.porta.situacoes(c).catch(() => new Map<number, string>()),
    ]);
    return deparaVigente(aprovados, rotulos);
  }

  reservaDaLinha(r: ReservaLeitoNir, agora: string): ReservaNir {
    return {
      id: r.id,
      solicitacao: r.solicitacao,
      leito: { bloco: r.bloco, acomodacao: r.acomodacao, leito: r.leito },
      chave: `${r.bloco}|${r.acomodacao}|${r.leito}`,
      situacao: r.situacao,
      validaAte: r.validaAte,
      minutosRestantes: minutosParaVencer(r.validaAte, agora),
      excecao: r.excecao,
      criadaPor: r.criadaPor,
      criadaEm: r.criadaEm,
      confirmadaEm: r.confirmadaEm,
      conflito: r.conflitoEm ? { internacao: r.conflitoReg ?? 0, em: r.conflitoEm } : null,
    };
  }

  private solicitacaoDaLinha(
    x: SolicitacaoLeitoNir,
    o: {
      agora: string;
      hoje: string;
      reservas: readonly ReservaLeitoNir[];
      depara: readonly LinhaDepara[];
      historico: SolicitacaoNir['historico'];
    },
  ): SolicitacaoNir {
    const r = o.reservas.find((y) => y.solicitacao === x.id) ?? null;
    return {
      id: x.id,
      origem: x.origem,
      estado: x.estado,
      prioridade: x.prioridade,
      paciente: {
        id: x.paciente,
        prontuario: x.prontuario,
        nome: x.nome,
        idade: idadeEmAnos(x.nascimento, o.hoje),
        sexo: x.sexo,
      },
      atendimento: x.atendimento,
      internacao: x.internacao,
      cirurgia: x.cirurgia,
      perfil: { intensiva: x.intensiva, precaucao: x.precaucao, tiposAcomodacao: x.tiposAcomodacao },
      clinica: x.clinica,
      justificativa: x.justificativa,
      solicitadoPor: x.solicitadoPor,
      solicitadoEm: x.solicitadoEm,
      prazoEm: x.prazoEm,
      minutosEspera: minutosDeEspera(x.solicitadoEm, o.agora),
      prazoEstourado: prazoEstourado(x, o.agora),
      reserva: r ? this.reservaDaLinha(r, o.agora) : null,
      situacaoEquivalente: situacaoEquivalente(x.estado, o.depara),
      internacaoGerada: x.regGerado,
      versao: x.versao,
      recursos: [...(x.recursos ?? [])],
      observacao: x.observacao ?? null,
      historico: o.historico,
    };
  }

  /** A fila do NIR: as solicitações abertas na ordem da prioridade, os conflitos e as cirurgias que pedem UTI. */
  async fila(c: ContextoNir): Promise<FilaNir> {
    const [{ agora, hoje }, abertas, reservas, depara, cirurgias] = await Promise.all([
      this.porta.relogio(c),
      this.porta.abertas(c),
      this.porta.reservasVigentes(c),
      this.deparaLinhas(c),
      this.porta.cirurgiasUti(c).catch(() => []),
    ]);
    const eventos = await this.porta.eventos(
      c,
      abertas.itens.map((x) => x.id),
    );
    const comSolicitacao = await this.porta.cirurgiasComSolicitacao(
      c,
      cirurgias.map((x) => x.agendamento),
    );
    const itens = ordenarFilaNir(abertas.itens, agora).map((x) =>
      this.solicitacaoDaLinha(x, {
        agora,
        hoje,
        reservas,
        depara,
        historico: eventos
          .filter((e) => e.solicitacao === x.id)
          .map((e) => ({ de: e.de, para: e.para, acao: e.acao, motivo: e.motivo, por: e.por, em: e.em })),
      }),
    );
    return {
      itens,
      conflitos: reservas
        .filter((r) => r.conflitoEm !== null)
        .map((r) => ({
          reserva: r.id,
          solicitacao: r.solicitacao,
          chave: `${r.bloco}|${r.acomodacao}|${r.leito}`,
          internacao: r.conflitoReg ?? 0,
          em: r.conflitoEm as string,
        })),
      cirurgiasUti: cirurgias.map((x) => ({ ...x, comSolicitacao: comSolicitacao.has(x.agendamento) })),
      contagens: contagemPorEstado(itens),
      estourados: itens.filter((i) => i.prazoEstourado).length,
      lidoEm: agora,
    };
  }

  async solicitacaoAberta(c: ContextoNir, id: number): Promise<SolicitacaoLeitoNir> {
    const s = await this.porta.solicitacao(c, id);
    if (!s)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Solicitação não encontrada',
        'A solicitação de leito não existe.',
      );
    return s;
  }

  /** Os leitos do mapa para a solicitação: os livres, cada um com o motivo quando não atende o perfil. */
  async leitosCompativeis(
    c: ContextoNir,
    id: number,
    intensivas: readonly number[],
  ): Promise<LeitosCompativeis> {
    const s = await this.solicitacaoAberta(c, id);
    const [{ agora, hoje }, mapa, p] = await Promise.all([
      this.porta.relogio(c),
      this.adt.mapa(c, intensivas),
      this.portaAdt.pacienteParaLeito(c, { paciente: s.paciente }),
    ]);
    const paciente = { sexo: p?.sexo ?? s.sexo, idade: idadeEmAnos(p?.nascimento ?? s.nascimento, hoje) };
    const perfil = { intensiva: s.intensiva, precaucao: s.precaucao, tiposAcomodacao: s.tiposAcomodacao };
    const leitos = this.leitosParaReserva(mapa).filter((l) => l.situacao === 'livre');
    const r = leitos.map((l) => {
      const motivo = incompatibilidadeComPerfil(l, perfil, paciente);
      return {
        chave: l.chave,
        leito: l.leito,
        tipo: l.tipoNome,
        intensiva: l.intensiva,
        compativel: motivo === null,
        motivo,
      };
    });
    r.sort((a, b) => Number(b.compativel) - Number(a.compativel) || a.chave.localeCompare(b.chave));
    return { solicitacao: id, leitos: r, compativeis: r.filter((x) => x.compativel).length, lidoEm: agora };
  }

  /** Os tipos de acomodação dos leitos do mapa (um por código, pelo nome), para o pedido restringir o tipo de leito. */
  async tiposAcomodacao(
    c: ContextoNir,
    intensivas: readonly number[],
  ): Promise<{ codigo: number; nome: string }[]> {
    const mapa = await this.adt.mapa(c, intensivas);
    const tipos = new Map<number, string>();
    for (const b of mapa.painel.blocos)
      for (const a of b.acomodacoes) if (a.tipo && a.tipo.id > 0) tipos.set(a.tipo.id, a.tipo.nome);
    return [...tipos]
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }

  /** Os leitos do mapa com o que a reserva confere (tipo, terapia intensiva, atributos, a acomodação). */
  leitosParaReserva(mapa: Awaited<ReturnType<ServicoAdt['mapa']>>) {
    const porAcomodacao = new Map<string, { ocupados: number; precaucoes: string[] }>();
    const tipos = new Map<string, { tipo: { codigo: number; nome: string }; intensiva: boolean }>();
    for (const b of mapa.painel.blocos)
      for (const a of b.acomodacoes)
        tipos.set(`${b.bloco}|${a.acomodacao}`, {
          tipo: { codigo: a.tipo?.id ?? 0, nome: a.tipo?.nome ?? a.nome },
          intensiva: a.intensiva,
        });
    for (const l of mapa.leitos) {
      const k = `${l.leito.bloco}|${l.leito.acomodacao}`;
      const x = porAcomodacao.get(k) ?? { ocupados: 0, precaucoes: [] };
      if (l.situacao === 'ocupado' || l.situacao === 'conflito') x.ocupados++;
      for (const e of l.estados) if (e.estado === 'precaucao' && e.precaucao) x.precaucoes.push(e.precaucao);
      porAcomodacao.set(k, x);
    }
    return mapa.leitos.map((l) => {
      const k = `${l.leito.bloco}|${l.leito.acomodacao}`;
      const t = tipos.get(k) ?? { tipo: { codigo: 0, nome: '' }, intensiva: false };
      const ac = porAcomodacao.get(k) ?? { ocupados: 0, precaucoes: [] };
      const proprio = l.situacao === 'ocupado' || l.situacao === 'conflito' ? 1 : 0;
      return {
        chave: l.chave,
        leito: l.leito,
        situacao: l.situacao,
        tipo: t.tipo.codigo,
        tipoNome: t.tipo,
        intensiva: t.intensiva,
        atributos: l.atributos,
        acomodacao: {
          ocupados: ac.ocupados - proprio,
          precaucoes: ac.precaucoes as ('contato' | 'goticulas' | 'aerossois')[],
        },
      };
    });
  }

  async reservas(c: ContextoNir): Promise<ReservasNir> {
    const [{ agora }, vigentes, encerradas] = await Promise.all([
      this.porta.relogio(c),
      this.porta.reservasVigentes(c),
      this.porta.reservasEncerradas(c),
    ]);
    return {
      vigentes: vigentes.map((r) => this.reservaDaLinha(r, agora)),
      encerradas: encerradas.map((r) => this.reservaDaLinha(r, agora)),
      lidoEm: agora,
    };
  }

  /** Os internados com a alta prevista vigente, o histórico, as barreiras e a cor do quadro (regra 13). */
  async internados(c: ContextoNir, p: ParametrosNir): Promise<AltasPrevistas> {
    const [{ agora, hoje }, lista, limites] = await Promise.all([
      this.porta.relogio(c),
      this.porta.internados(c),
      this.porta.limites(c),
    ]);
    const regs = lista.itens.map((i) => i.reg);
    const [dpas, barreiras, altas] = await Promise.all([
      this.porta.dpas(c, regs),
      this.porta.barreiras(c, regs),
      this.portaAdt.altasMedicas(c, regs).catch(() => new Map<number, unknown>()),
    ]);
    const itens: InternadoNir[] = lista.itens.map((i) => {
      const hist = dpas
        .filter((d) => d.reg === i.reg)
        .map((d) => ({
          id: d.id,
          data: d.data,
          motivo: d.motivo,
          por: d.por,
          em: d.em,
          retirada: d.retirada ?? false,
        }));
      // W0-07: a última versão retirada deixa a internação sem DPA (o histórico continua legível).
      const ultima = hist.at(-1) ?? null;
      const dpa = ultima && !ultima.retirada ? ultima : null;
      const dias312 = diasInternado312(i.entrada, hoje);
      const limite = limiteAplicavel(
        limites,
        { procedimento: i.procedimento, cid: i.cid, clinica: i.clinica },
        { amareloDias: p.amareloDias, vermelhoDias: p.vermelhoDias },
      );
      const cor = corPermanencia({ hoje, dpa: dpa?.data ?? null, dias312, limite });
      const bs: BarreiraAlta[] = barreiras
        .filter(
          (b) => b.reg === i.reg && (b.situacao === 'aberta' || (b.resolvidaEm ?? '') >= somaDias(hoje, -2)),
        )
        .map((b) => ({
          id: b.id,
          tipo: b.tipo,
          descricao: b.descricao,
          responsavel: b.responsavel,
          prazo: b.prazo,
          vencida: barreiraVencida(b, hoje),
          situacao: b.situacao,
          criadaPor: b.criadaPor,
          criadaEm: b.criadaEm,
          resolvidaEm: b.resolvidaEm,
        }));
      return {
        internacao: i.reg,
        paciente: i.paciente,
        nome: i.nome,
        leito: { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito },
        clinica: i.clinica,
        entrada: i.entrada,
        dias312,
        diasUti: diasUtiPelaTrajetoria(i.trechos, p.intensivas, hoje),
        dpa,
        historicoDpa: hist,
        limite: {
          amareloDias: limite.amareloDias,
          vermelhoDias: limite.vermelhoDias,
          origem: limite.origem,
          escopo: limite.escopo,
        },
        cor: cor.cor,
        motivoCor: cor.motivo,
        barreiras: bs,
        altaMedicaDecidida: altas.has(i.reg),
      };
    });
    return { itens, cortada: lista.cortada, hoje, lidoEm: agora };
  }

  /** O quadro de permanência em três colunas e a reunião de leitos (solicitações, altas previstas, indicadores). */
  async quadro(c: ContextoNir, p: ParametrosNir): Promise<QuadroPermanencia> {
    const r = await this.internados(c, p);
    const [abertas, reservas, concluidas] = await Promise.all([
      this.porta.abertas(c),
      this.porta.reservasVigentes(c),
      this.porta.concluidas(c, somaDias(r.hoje, -30)),
    ]);
    const amanha = somaDias(r.hoje, 1);
    const ordem = (a: InternadoNir, b: InternadoNir) => b.dias312 - a.dias312 || a.internacao - b.internacao;
    const col = (cor: string) => r.itens.filter((i) => i.cor === cor).sort(ordem);
    const altasHoje = r.itens.filter((i) => i.dpa?.data === r.hoje);
    const barreiras = r.itens.flatMap((i) => i.barreiras.filter((b) => b.situacao === 'aberta'));
    return {
      colunas: { verde: col('verde'), amarelo: col('amarelo'), vermelho: col('vermelho') },
      reuniao: {
        altasHoje: altasHoje.map((i) => i.internacao),
        altasAmanha: r.itens.filter((i) => i.dpa?.data === amanha).map((i) => i.internacao),
        semDpa: r.itens.filter((i) => i.dpa === null).length,
        barreirasAbertas: barreiras.length,
        barreirasVencidas: barreiras.filter((b) => b.vencida).length,
        solicitacoesAbertas: abertas.itens.length,
        reservasVigentes: reservas.length,
        indicadores: indicadoresNir({ concluidas, internados: r.itens, altasHoje }),
      },
      hoje: r.hoje,
      lidoEm: r.lidoEm,
    };
  }

  /** A calibragem dos limites: as três réguas por chave (agregadas no banco) e a proposta pela Portaria 312. */
  async calibragem(
    c: ContextoNir,
    o: { escopo: EscopoLimitePermanencia; inicio: string; fim: string; intensivas: readonly number[] },
  ): Promise<Calibragem> {
    const [h, limites] = await Promise.all([this.porta.histogramas(c, o), this.porta.limites(c)]);
    const linhas = calibrar(h, AMOSTRA_MINIMA_CALIBRAGEM)
      .sort((a, b) => b.portaria312.n - a.portaria312.n)
      .slice(0, 60);
    const nome = (chave: string) =>
      o.escopo === 'clinica'
        ? (CLINICAS_INTERNACAO.find((x) => x.codigo === chave)?.rotulo ?? chave)
        : (h.nomes.get(chave) ?? chave);
    return {
      periodo: { inicio: o.inicio, fim: o.fim },
      escopo: o.escopo,
      amostraMinima: AMOSTRA_MINIMA_CALIBRAGEM,
      linhas: linhas.map((l) => {
        const v = limites.find((x) => x.escopo === o.escopo && x.chave === l.chave);
        return {
          chave: l.chave,
          nome: nome(l.chave),
          portaria312: l.portaria312,
          diariasFaturaveis: l.diariasFaturaveis,
          uti: l.uti,
          proposta: l.proposta,
          vigente: v ? { amareloDias: v.amareloDias, vermelhoDias: v.vermelhoDias, origem: v.origem } : null,
        };
      }),
    };
  }

  async situacoesDepara(c: ContextoNir): Promise<DeparaSituacoes> {
    const linhas = await this.deparaLinhas(c);
    return {
      itens: linhas,
      comDestino: linhas.filter((l) => l.estado !== null).length,
      aConfirmar: linhas.filter((l) => l.aConfirmar).length,
    };
  }

  /** O leito do mapa para a reserva (a decisão de vaga e perfil fica no motor). */
  async leitoParaReserva(c: ContextoNir, chave: string, intensivas: readonly number[]) {
    const mapa = await this.adt.mapa(c, intensivas);
    const l = this.leitosParaReserva(mapa).find((x) => x.chave === chave);
    if (!l)
      throw new ErroProblema('nao-encontrado', 404, 'Leito não encontrado', 'O leito não existe no mapa.');
    return l;
  }

  chaveDe(l: { bloco: string; acomodacao: string; leito: string }): string {
    return chaveTextoLeito(l);
  }
}
