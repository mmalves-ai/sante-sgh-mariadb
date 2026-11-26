// Serviço da internação, dos leitos, da higienização e do SAME (M21): monta as respostas das telas a partir das
// leituras da porta (vocabulário do novo) e decide no servidor o que a tela só mostra: o mapa operacional (o painel do
// M16 com os estados só do novo e o conflito), o vencimento das guias, a saída com as diárias faturáveis e a
// permanência da Portaria 312 (nomes distintos), a reinternação em 30 dias, a fila da higienização com o prazo, o
// cronômetro sem as pausas e o histórico (quem, quando, de qual aparelho) e a localização do volume no SAME. Nenhuma
// regra mora na tela.
import {
  type ChaveLeito,
  chaveTextoLeito,
  type EtapaLimpeza,
  type InternacaoDetalhe,
  type InternacoesLista,
  type LeitoMapa,
  type LocalizacaoConta,
  type MapaOperacional,
  type PainelHigienizacao,
  type SolicitacaoLimpeza,
} from '@sgh/contratos';
import {
  atrasada,
  minutosEmExecucao,
  ordenarFila,
  type ParametrosPrazo,
  devolucaoAtrasada,
} from '@sgh/dominio-hotelaria';
import {
  compativelComPaciente,
  diariasFaturaveis,
  ehReinternacao,
  idadeEmAnos,
  grupoMotivoAlta,
  montarMapaOperacional,
  montarPainel,
  permanenciaPortaria312,
  vencimentoDaGuia,
} from '@sgh/dominio-internacao';
import { ErroProblema } from '../../problema.filter.js';
import {
  type ContextoAdt,
  type EtapaDaLimpeza,
  MEDICO_ALTA_NAO_REGISTRADO,
  type OpcoesListaInternacoes,
  type PortaAdt,
} from './porta.js';

const ms = (iso: string) => {
  const t = Date.parse(iso.length <= 19 ? `${iso.replace(' ', 'T')}Z` : iso);
  return Number.isFinite(t) ? t : 0;
};
const isoMin = (t: number) => new Date(t).toISOString().slice(0, 19);

export class ServicoAdt {
  /**
   * @param janela as horas da janela das limpezas pedidas pela alta ainda sem etapa (parâmetro
   *   `hotelaria.janelaOutroSistemaHoras` do estabelecimento); sem ela, 0 (desligado).
   */
  constructor(
    private readonly porta: PortaAdt,
    private readonly janela: (c: ContextoAdt) => Promise<number> = async () => 0,
  ) {}

  private async janelaHoras(c: ContextoAdt): Promise<number> {
    try {
      return await this.janela(c);
    } catch {
      return 0;
    }
  }

  async internacoes(c: ContextoAdt, o: OpcoesListaInternacoes): Promise<InternacoesLista> {
    const [{ agora }, r] = await Promise.all([this.porta.relogio(c), this.porta.internacoes(c, o)]);
    const altas = await this.porta.altasMedicas(
      c,
      r.itens.map((i) => i.reg),
    );
    const medicos = await this.porta.medicos(c, '').catch(() => []);
    const nomeMedico = (v: number) => medicos.find((m) => m.vinculo === v)?.nome ?? '';
    return {
      itens: r.itens.map((i) => {
        const a = altas.get(i.reg);
        return a
          ? {
              ...i,
              altaMedica: {
                motivo: a.motivo,
                destino: a.destino,
                decididaEm: a.decididaEm,
                medico: a.vinculo === null ? MEDICO_ALTA_NAO_REGISTRADO : nomeMedico(a.vinculo),
              },
            }
          : i;
      }),
      cortada: r.cortada,
      lidoEm: agora,
    };
  }

  async detalhe(c: ContextoAdt, reg: number, intensivas: readonly number[]): Promise<InternacaoDetalhe> {
    const [{ hoje }, d, a] = await Promise.all([
      this.porta.relogio(c),
      this.porta.detalhe(c, reg, intensivas),
      this.porta.altaMedica(c, reg),
    ]);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Internação não encontrada',
        'A internação não existe mais.',
      );
    const r = d.resumo;
    const saida =
      r.alta && d.motivo !== null
        ? {
            motivo: { codigo: d.motivo, nome: d.motivoNome },
            grupo: grupoMotivoAlta(d.motivo),
            diariasFaturaveis: d.permanen || diariasFaturaveis(r.entrada, r.alta, r.horaSaida ?? '0000'),
            permanencia312: permanenciaPortaria312(r.entrada, r.alta),
          }
        : null;
    return {
      ...r,
      altaMedica: a
        ? { motivo: a.motivo, destino: a.destino, decididaEm: a.decididaEm, medico: a.decididaPor }
        : null,
      cabecalho: d.cabecalho,
      procedimento: d.procedimento,
      cid: d.cid,
      medicoSolicitante: d.medicoSolicitante,
      acomodacaoPlano: d.acomodacaoPlano,
      matricula: d.matricula,
      validadeCarteira: d.validadeCarteira,
      carater: d.carater,
      origem: null,
      nivelCuidado: null,
      trechos: d.trechos,
      guias: d.guias.map((g) => ({ ...g, vencimento: r.alta ? 'vigente' : vencimentoDaGuia(g.fim, hoje) })),
      trocas: d.trocas,
      contas: d.contas,
      procedimentosExtras: d.procedimentosExtras,
      saida,
      reinternacao30: ehReinternacao(d.historicoPaciente, { reg: r.reg, entrada: r.entrada }),
    };
  }

  /** O mapa operacional: os mesmos números do painel do M16 com os estados só do novo e o conflito (regra 8). */
  async mapa(
    c: ContextoAdt,
    intensivas: readonly number[],
    /** M44: a solicitação do NIR que a tela atende (o leito reservado para ela fica admissível). */
    o: { solicitacao?: number | null } = {},
  ): Promise<MapaOperacional> {
    const janelaHoras = await this.janelaHoras(c);
    const [{ agora }, leituras, estados] = await Promise.all([
      this.porta.relogio(c),
      this.porta.leiturasPainel(c),
      this.porta.estadosDoMapa(c, { janelaHoras }),
    ]);
    const t = ms(agora);
    const painel = montarPainel(leituras, {
      intensivas,
      agora: t,
      lidoEm: new Date(t).toISOString(),
      dadosAte: new Date(t).toISOString(),
      destino: this.porta.destino === 'memoria' ? 'memoria' : 'banco',
    });
    return montarMapaOperacional(
      painel,
      estados.estados,
      estados.limpezas.map((l) => ({
        ...l,
        atrasada: atrasada(l.prazo ? ms(l.prazo) : null, l.etapa as EtapaLimpeza, t),
      })),
      estados.atributos,
      estados.reservas ?? [],
      o.solicitacao ?? null,
    );
  }

  /**
   * Os leitos que não aceitam o paciente pelos atributos do novo (sexo e faixa de idade, D-COMP-21): o motivo por
   * leito; null quando aceita. Sem atributos no leito, aceita; sem o paciente lido, nada a dizer.
   */
  async incompatibilidades(
    c: ContextoAdt,
    leitos: readonly LeitoMapa[],
    q: { paciente?: number; reg?: number },
  ): Promise<Map<string, string | null>> {
    const r = new Map<string, string | null>();
    const comAtributo = leitos.filter((l) => l.atributos !== null);
    if (comAtributo.length === 0) return r;
    const [p, { hoje }] = await Promise.all([this.porta.pacienteParaLeito(c, q), this.porta.relogio(c)]);
    if (!p) return r;
    const idade = idadeEmAnos(p.nascimento, hoje);
    for (const l of comAtributo) r.set(l.chave, compativelComPaciente(l.atributos, { sexo: p.sexo, idade }));
    return r;
  }

  /** O mapa com a compatibilidade de cada leito para o paciente (a admissão e a transferência filtram por ela). */
  async mapaPara(
    c: ContextoAdt,
    intensivas: readonly number[],
    q: { paciente?: number; reg?: number },
    solicitacao: number | null = null,
  ): Promise<MapaOperacional> {
    const m = await this.mapa(c, intensivas, { solicitacao });
    const inc = await this.incompatibilidades(c, m.leitos, q);
    return { ...m, leitos: m.leitos.map((l) => ({ ...l, incompatibilidade: inc.get(l.chave) ?? null })) };
  }

  /** Recusa (409) o leito que não aceita o paciente pelos atributos do novo; a admissão e a transferência conferem. */
  async exigirCompativel(
    c: ContextoAdt,
    l: LeitoMapa,
    q: { paciente?: number; reg?: number },
    campo: string,
  ): Promise<void> {
    const motivo = (await this.incompatibilidades(c, [l], q)).get(l.chave) ?? null;
    if (motivo)
      throw new ErroProblema('recusa-de-negocio', 409, 'Leito incompatível com o paciente', motivo, {
        codigo: 'leito-incompativel',
        campos: [campo],
      });
  }

  /** O leito está no mapa e qual a situação dele agora (a ação no cartão confere antes de gravar). */
  async leitoNoMapa(
    c: ContextoAdt,
    leito: ChaveLeito,
    intensivas: readonly number[],
    solicitacao: number | null = null,
  ) {
    const m = await this.mapa(c, intensivas, { solicitacao });
    const l = m.leitos.find((x) => x.chave === chaveTextoLeito(leito));
    if (!l)
      throw new ErroProblema('nao-encontrado', 404, 'Leito não encontrado', 'O leito não existe no mapa.');
    return l;
  }

  /** A situação da limpeza: a última etapa do novo (sem etapa: "solicitado", como a solicitação nasce). */
  etapaAtual(etapas: readonly EtapaDaLimpeza[]): EtapaLimpeza {
    return etapas.at(-1)?.etapa ?? 'solicitado';
  }

  async painelHigienizacao(
    c: ContextoAdt,
    _p: ParametrosPrazo,
    o: { profissional?: number | null } = {},
  ): Promise<PainelHigienizacao> {
    const janelaHoras = await this.janelaHoras(c);
    const [{ agora }, r, apoio] = await Promise.all([
      this.porta.relogio(c),
      this.porta.solicitacoes(c, { janelaHoras }),
      this.porta.apoio(c),
    ]);
    const t = ms(agora);
    const nomeTipo = (k: number | null) =>
      k === null
        ? null
        : (apoio.tiposLimpeza.find((x) => x.codigo === k) ?? { codigo: k, nome: `Tipo ${k}` });
    const nomeProf = (k: number | null) =>
      k === null
        ? null
        : (apoio.profissionaisLimpeza.find((x) => x.codigo === k) ?? {
            codigo: k,
            nome: `Profissional ${k}`,
          });
    const itens: (SolicitacaoLimpeza & { _prazo: number | null; _sol: number })[] = [];
    for (const s of r.itens) {
      const etapas = await this.porta.etapas(c, s.solicitacao);
      const etapa = this.etapaAtual(etapas);
      const ultimaCom = <K extends keyof EtapaDaLimpeza>(k: K) =>
        [...etapas].reverse().find((e) => e[k] !== null && e[k] !== undefined)?.[k] ?? null;
      const prazo = ultimaCom('prazo') as string | null;
      const prazoMs = prazo ? ms(prazo) : null;
      const item = {
        solicitacao: s.solicitacao,
        leito: s.leito,
        chave: chaveTextoLeito(s.leito),
        // A limpeza pedida pela alta (ainda sem etapa registrada) nasce como a da alta.
        origem: (ultimaCom('origem') as string | null) ?? (s.doOutroSistema ? 'alta' : null),
        tipoLimpeza: nomeTipo(ultimaCom('tipoLimpeza') as number | null),
        etapa,
        situacaoLegado: s.situacaoCodigo,
        profissional: nomeProf(ultimaCom('profissional') as number | null),
        precaucao: (ultimaCom('precaucao') as string | null) ?? null,
        solicitadaEm: s.solicitadaEm,
        prazo,
        atrasada: atrasada(prazoMs, etapa, t),
        minutosExecucao: minutosEmExecucao(
          etapas.map((e) => ({ etapa: e.etapa, em: ms(e.registradoEm) })),
          t,
        ),
        minutosDesdeSolicitacao: Math.max(0, Math.round((t - ms(s.solicitadaEm)) / 60_000)),
        checklist: [...(etapas.findLast((e) => e.checklist.length > 0)?.checklist ?? [])],
        foto: (ultimaCom('foto') as string | null) ?? null,
        historico: etapas.map((e) => ({
          etapa: e.etapa,
          em: e.registradoEm,
          por: e.registradoPor,
          aparelho: e.aparelho,
        })),
        _prazo: prazoMs,
        _sol: ms(s.solicitadaEm),
      };
      if (o.profissional && item.profissional?.codigo !== o.profissional && etapa !== 'solicitado') continue;
      itens.push(item);
    }
    const ordenados = ordenarFila(
      itens.map((i) => ({
        etapa: i.etapa as EtapaLimpeza,
        prazo: i._prazo,
        solicitadaEm: i._sol,
        original: i,
      })),
      t,
    ).map((x) => x.original);
    // As concluídas e inspecionadas ficam na fila da inspeção (limpezaAberta as mantém); a ordem é a do prazo.
    const contagens: Record<string, number> = {};
    for (const i of itens) contagens[i.etapa] = (contagens[i.etapa] ?? 0) + 1;
    return {
      itens: ordenados.map((x) => {
        const limpo: Partial<typeof x> = { ...x };
        delete limpo._prazo;
        delete limpo._sol;
        return limpo as SolicitacaoLimpeza;
      }),
      contagens,
      atrasadas: itens.filter((i) => i.atrasada).length,
      paradasAntigas: r.paradasAntigas,
      lidoEm: agora,
    };
  }

  async localizacao(
    c: ContextoAdt,
    codigo: number,
    o: { setorSame: number; prazoDias: number },
  ): Promise<LocalizacaoConta> {
    const conta = await this.porta.contaDoCodigo(c, codigo);
    const l = conta === null ? null : await this.porta.localizacao(c, conta, o);
    if (!l)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Conta não encontrada',
        'Nenhuma conta com este código: confira a etiqueta ou digite o número.',
      );
    const { agora } = await this.porta.relogio(c);
    const atual = l.linhaDoTempo.find((m) => !m.excluido) ?? null;
    return {
      ...l,
      devolucaoAtrasada: devolucaoAtrasada(
        atual ? { operacao: atual.operacao.codigo, destino: atual.destino.codigo, em: ms(atual.em) } : null,
        o.setorSame,
        o.prazoDias,
        ms(agora),
      ),
    };
  }

  /** O prazo da limpeza a partir de agora (ISO sem fuso, na hora do estabelecimento). */
  prazoDe(agora: string, minutos: number): string {
    return isoMin(ms(agora) + minutos * 60_000);
  }
}
