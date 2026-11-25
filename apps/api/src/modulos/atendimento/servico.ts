// Serviço do atendimento externo (M20): monta as respostas das telas a partir das leituras da porta (vocabulário do
// novo) e decide no servidor o que a tela só mostra: a ordem da fila do consultório, as colunas do quadro do PA com os
// tempos, o alerta da observação (24 h), os indicadores com as parcelas, a prévia da exclusão, a herança e o que cada
// impresso exige. Nenhuma regra mora na tela.
import {
  type AlertaEscorePa,
  type ApoioAtendimento,
  type AtendimentoDetalhe,
  type AtendimentosDia,
  type CartaoPa,
  CAMPOS_PADRAO_ABERTURA,
  type ConfiguracaoHeranca,
  type ConfiguracaoPadraoAbertura,
  type EtapaPa,
  ETAPAS_PA,
  type FilaConsultorio,
  HERANCAS,
  type HerancaPaciente,
  IMPRESSOS_ATENDIMENTO,
  type IndicadoresAtendimento,
  type ItemFilaConsultorio,
  type MarcacaoAbertura,
  type ObservacaoPa,
  type PreviaCancelamento,
  type QuadroPa,
  rotuloConta,
  permiteLancar,
} from '@sgh/contratos';
import {
  alertaObservacao,
  calcularIndicadoresAgregados,
  camposHerdados,
  versaoHeranca,
  aplicarHeranca,
  aplicarPadraoAbertura,
  resolverPadraoAbertura,
  esperaMinutos,
  horasDeObservacao,
  idadeEmAnos,
  impressosDoAtendimento,
  montarQuadro,
  ordenarFilaConsultorio,
  situacaoPelaLetra,
  type SituacaoFila,
} from '@sgh/dominio-atendimento';
import { ErroProblema } from '../../problema.filter.js';
import { ordenarPorRisco } from '@sgh/dominio-recepcao';
import type { ContextoAtendimento, DadosImpresso, FonteRiscoPa, PortaAtendimento } from './porta.js';

const ETAPAS = new Set<string>(ETAPAS_PA.map((e) => e.codigo));
const SITUACOES_NOVO = new Set<string>(['aguardando', 'chamado', 'emAtendimento', 'liberado']);

/** Sugestão do procedimento pelo tipo (a pessoa confirma ou troca na tela). */
const PROCEDIMENTOS_PADRAO = [
  { codigo: 10101012, nome: 'Consulta em consultório', tipo: 'consulta' },
  { codigo: 10101039, nome: 'Consulta em pronto socorro', tipo: 'pa' },
];

export function exigirDia(v: string | null | undefined, hoje: string): string {
  if (v === undefined || v === null || v === '') return hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
}

export class ServicoAtendimento {
  constructor(private readonly porta: PortaAtendimento) {}

  async dia(
    c: ContextoAtendimento,
    f: {
      data: string | null;
      unidade: number | null;
      requisicoes: boolean;
      local?: number | null;
      termo?: string | null;
    },
  ): Promise<AtendimentosDia> {
    const { hoje } = await this.porta.relogio(c);
    const data = exigirDia(f.data, hoje);
    const r = await this.porta.atendimentosDoDia(c, {
      data,
      ...(f.unidade ? { unidade: f.unidade } : {}),
      requisicoes: f.requisicoes,
      ...(f.local ? { local: f.local } : {}),
      ...(f.termo ? { termo: f.termo } : {}),
    });
    return { data, itens: r.itens, cortada: r.cortada, requisicoes: r.requisicoes };
  }

  async detalhe(c: ContextoAtendimento, reg: number): Promise<AtendimentoDetalhe> {
    const d = await this.porta.detalhe(c, reg);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não existe mais.',
      );
    return d;
  }

  async fila(
    c: ContextoAtendimento,
    o: { local: number | null; crm: number | null; profissional: { crm: number; nome: string } | null },
  ): Promise<FilaConsultorio> {
    const [{ hoje, agora }, locais] = await Promise.all([this.porta.relogio(c), this.porta.locais(c)]);
    // Só os locais que o usuário vê (vínculo e visibilidade entre locais); o local escolhido leva o horário de agora.
    const visiveis = locais.filter((l) => l.visivel !== false);
    const lista = visiveis.map((l) => ({ id: l.id, descricao: l.descricao }));
    const doLocal = o.local ? visiveis.find((l) => l.id === o.local) : undefined;
    const local = doLocal
      ? { id: doLocal.id, descricao: doLocal.descricao, horario: doLocal.horario ?? null }
      : null;
    if (!local)
      return {
        local: null,
        locais: lista,
        profissional: o.profissional,
        itens: [],
        cortada: false,
        atualizadoEm: agora,
      };
    const r = await this.porta.fila(c, { local: local.id, hoje, ...(o.crm ? { crm: o.crm } : {}) });
    const itens: ItemFilaConsultorio[] = r.itens
      .filter((x) => !x.encerrado)
      .map((x) => {
        const situacao: SituacaoFila = x.letraNoLocal
          ? situacaoPelaLetra(x.letraNoLocal)
          : SITUACOES_NOVO.has(x.situacaoNovo ?? '')
            ? (x.situacaoNovo as SituacaoFila)
            : 'aguardando';
        return {
          reg: x.reg,
          idPaciente: x.idPaciente,
          paciente: x.paciente,
          prontuario: x.prontuario,
          senha: x.senha,
          prioridade: x.prioridade,
          agendadoPara: x.agendadoPara,
          chegada: x.chegada,
          esperaMinutos: esperaMinutos(x.chegada, agora),
          situacao,
          chamadas: x.chamadas,
          tipo: x.tipo,
          convenio: x.convenio,
        };
      });
    return {
      local,
      locais: lista,
      profissional: o.profissional,
      itens: ordenarFilaConsultorio(itens),
      cortada: r.cortada,
      atualizadoEm: agora,
    };
  }

  async quadro(
    c: ContextoAtendimento,
    alvoPortaMedico: number,
    avisoHoras: number,
    risco: FonteRiscoPa | null = null,
    /** Revisão do M44.3: o chip do protocolo gerenciado só para quem tem `recepcao.protocoloPaciente.ler`. */
    verProtocolos = false,
    /** W0-07 (M1): o alerta de deterioração e de sepse de cada atendimento (indisponível: o quadro segue sem o chip). */
    alertas:
      | ((
          itens: readonly { reg: number; cabecalho: string; chegada: string }[],
        ) => Promise<Map<number, AlertaEscorePa | null>>)
      | null = null,
  ): Promise<QuadroPa> {
    const { hoje, agora } = await this.porta.relogio(c);
    const r = await this.porta.paAbertos(c, { hoje });
    // Saiu pela outra ponta sem o desfecho codificado (liberado do local ou com alta no cabeçalho): à parte.
    const saidasSemDesfecho = r.itens
      .filter((x) => x.saida !== null)
      .map((x) => ({
        reg: x.reg,
        paciente: x.paciente,
        senha: x.senha,
        chegada: x.chegada,
        sinal: x.saida as 'liberado' | 'alta',
        leito: x.leito,
      }));
    const itens = r.itens
      .filter((x) => x.saida === null)
      .map((x) => ({
        ...x,
        marcas: x.marcas
          .filter((m) => ETAPAS.has(m.etapa))
          .map((m) => ({ etapa: m.etapa as EtapaPa, em: m.em })),
        emObservacao: x.observacaoDesde !== null,
      }));
    const colunas = montarQuadro(itens, agora).map((col) => ({
      codigo: col.codigo,
      rotulo: col.rotulo,
      cartoes: col.cartoes.map((k): CartaoPa => ({
        reg: k.item.reg,
        paciente: k.item.paciente,
        idade: idadeEmAnos(k.item.nascimento, hoje),
        senha: k.item.senha,
        prioridade: k.item.prioridade,
        chegada: k.item.chegada,
        etapa: k.etapa,
        etapaDesde: k.desde,
        minutosNaEtapa: k.minutosNaEtapa,
        minutosTotal: k.minutosTotal,
        profissional: k.item.profissional,
        leito: k.item.leito,
        alertaObservacao:
          k.item.observacaoDesde !== null &&
          alertaObservacao(horasDeObservacao(k.item.observacaoDesde, agora), avisoHoras) !== 'nenhum',
        semMarcas: !k.item.comMarcas,
      })),
    }));
    if (alertas) {
      const m = await alertas(
        itens.map((x) => ({ reg: x.reg, cabecalho: x.cabecalho, chegada: x.chegada })),
      ).catch(() => null);
      if (m) for (const col of colunas) for (const k of col.cartoes) k.alertaEscore = m.get(k.reg) ?? null;
    }
    // M44: com a classificação de risco, cada cartão ganha a cor e o cronômetro, e a coluna passa à ordem do risco
    // (a cor mais grave primeiro, depois o prazo); sem classificação (ou indisponível), o quadro segue como no M20.
    let porCor: QuadroPa['porCor'];
    if (risco) {
      const r2 = await risco.riscos(c, itens, { protocolos: verProtocolos }).catch(() => null);
      if (r2) {
        porCor = r2.porCor;
        for (const col of colunas) {
          for (const k of col.cartoes) {
            k.risco = r2.porReg.get(k.reg) ?? null;
            const p = verProtocolos ? r2.protocolos?.get(k.reg) : undefined;
            if (p && p.length > 0) k.protocolos = p;
          }
          col.cartoes = ordenarPorRisco(col.cartoes.map((k) => ({ ...k, risco: k.risco ?? null })));
        }
      }
    }
    return {
      colunas,
      total: colunas.reduce((t, x) => t + x.cartoes.length, 0),
      saidasSemDesfecho,
      atualizadoEm: agora,
      alvoPortaMedico,
      ...(porCor ? { porCor } : {}),
    };
  }

  async observacao(c: ContextoAtendimento, avisoHoras: number): Promise<ObservacaoPa> {
    const [{ agora }, r] = await Promise.all([this.porta.relogio(c), this.porta.observacao(c)]);
    return {
      leitos: r.leitos.map((l) => {
        const horas = l.ocupacao ? Math.round((l.ocupacao.minutos / 60) * 10) / 10 : 0;
        return {
          id: l.id,
          codigo: l.codigo,
          local: l.local,
          tipo: l.tipo,
          ativo: l.ativo,
          ocupacao: l.ocupacao
            ? {
                reg: l.ocupacao.reg,
                paciente: l.ocupacao.paciente,
                entrada: l.ocupacao.entrada,
                horas,
                alerta: alertaObservacao(horas, avisoHoras),
              }
            : null,
        };
      }),
      historico: r.historico,
      atualizadoEm: agora,
    };
  }

  async indicadores(
    c: ContextoAtendimento,
    f: { inicio: string; fim: string; unidade: number | null },
  ): Promise<IndicadoresAtendimento> {
    const a = await this.porta.indicadores(c, {
      inicio: f.inicio,
      fim: f.fim,
      ...(f.unidade ? { unidade: f.unidade } : {}),
    });
    return calcularIndicadoresAgregados({ inicio: f.inicio, fim: f.fim }, a);
  }

  async apoio(c: ContextoAtendimento): Promise<ApoioAtendimento> {
    const [a, locais] = await Promise.all([this.porta.apoio(c), this.porta.locais(c)]);
    const herdados = new Set(camposHerdados(a.heranca));
    return {
      convenios: a.convenios.map((x) => ({
        codigo: x.codigo,
        nome: x.nome,
        aceita: x.ativo,
        motivo: x.ativo ? null : 'Convênio suspenso para atendimento.',
      })),
      unidades: a.unidades,
      especialidades: a.especialidades,
      profissionais: a.profissionais
        .filter((p) => p.ativo)
        .map((p) => ({
          id: p.id,
          crm: p.crm,
          nome: p.nome,
          especialidades: p.especialidades,
          conselhoAtivo: p.ativo && p.crm > 0,
        })),
      centrosCusto: a.centrosCusto,
      locais: locais.map((l) => ({ id: l.id, descricao: l.descricao })),
      procedimentosPadrao: PROCEDIMENTOS_PADRAO,
      motivosExclusao: a.motivosExclusao,
      heranca: HERANCAS.filter((h) => herdados.has(h.campo)).map((h) => ({
        campo: h.campo,
        rotulo: h.rotulo,
      })),
    };
  }

  async configuracaoHeranca(c: ContextoAtendimento): Promise<ConfiguracaoHeranca> {
    const a = await this.porta.apoio(c);
    const est = a.herancaEscopo?.estabelecimento ?? a.heranca;
    const pessoal = a.herancaEscopo?.pessoal ?? {};
    return {
      campos: HERANCAS.map((h) => ({
        campo: h.campo,
        rotulo: h.rotulo,
        herda: a.heranca[h.chave] === true,
        estabelecimento: est[h.chave] === true,
        pessoal: pessoal[h.chave] ?? null,
      })),
      versao: versaoHeranca(a.heranca),
    };
  }

  async marcacao(c: ContextoAtendimento, id: number): Promise<MarcacaoAbertura> {
    const m = await this.porta.marcacao(c, id);
    if (!m)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Agendamento não encontrado',
        'O agendamento não existe mais.',
      );
    return m;
  }

  async historico(c: ContextoAtendimento, paciente: number): Promise<HerancaPaciente> {
    const [r, { hoje }] = await Promise.all([this.porta.historico(c, paciente), this.porta.relogio(c)]);
    const h = r.anterior ? aplicarHeranca(r.heranca, r.anterior.valores, hoje) : null;
    // Os valores habituais completam o que a herança deixou vazio (o paciente sem atendimento anterior recebe todos).
    const p = r.padrao
      ? aplicarPadraoAbertura(
          resolverPadraoAbertura(r.padrao.estabelecimento, r.padrao.pessoal),
          h?.valores ?? {},
        )
      : null;
    const padrao = p && (Object.keys(p.valores).length > 0 || p.avisos.length > 0) ? { padrao: p } : {};
    if (!r.anterior || !h) return { paciente, anterior: null, historico: r.historico, ...padrao };
    return {
      paciente,
      anterior: { ...r.anterior, herdados: h.valores, avisos: h.avisos },
      historico: r.historico,
      ...padrao,
    };
  }

  /** Os valores habituais da abertura, por escopo, e o que está em vigor para a sessão. */
  async configuracaoPadraoAbertura(c: ContextoAtendimento): Promise<ConfiguracaoPadraoAbertura> {
    const p = (await this.porta.apoio(c)).padraoAbertura;
    const emVigor = resolverPadraoAbertura(p?.estabelecimento ?? null, p?.pessoal ?? null);
    return {
      campos: CAMPOS_PADRAO_ABERTURA.map((x) => ({
        campo: x.campo,
        rotulo: x.rotulo,
        estabelecimento: p?.estabelecimento?.[x.campo] ?? null,
        pessoal: p?.pessoal?.[x.campo] ?? null,
        emVigor: emVigor.campos[x.campo] ?? null,
      })),
      versaoEstabelecimento: p?.versaoEstabelecimento ?? 0,
      versaoPessoal: p?.versaoPessoal ?? 0,
    };
  }

  async previa(
    c: ContextoAtendimento,
    reg: number,
    liberacao: { ligada: boolean; motivo: string | null },
  ): Promise<PreviaCancelamento> {
    const p = await this.porta.previaCancelamento(c, reg);
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não existe mais.',
      );
    const s = p.situacaoConta as Parameters<typeof rotuloConta>[0];
    return {
      reg,
      pode: p.pode,
      motivo: p.motivo,
      conta: { situacao: s, rotulo: rotuloConta(s), permiteLancar: permiteLancar(s), itens: p.itensConta },
      procedimentosExtras: p.procedimentosExtras,
      senhaVolta: p.senha !== null ? 'A senha volta para a fila da recepção.' : null,
      liberada: liberacao.ligada,
      motivoLiberacao: liberacao.motivo,
      ...(p.dependentes
        ? {
            dependentes: p.dependentes.map((d) => ({
              rotulo: d.rotulo,
              quantidade: d.quantidade,
              amostra: [...d.amostra],
            })),
          }
        : {}),
      ...(p.saida ? { saida: p.saida } : {}),
      marcacaoVolta: p.marcacao
        ? 'A marcação do agendamento volta a não atendida (o horário fica livre).'
        : null,
    };
  }

  /** Os impressos e o que falta para cada um (a pulseira exige a data de nascimento). */
  impressos(d: DadosImpresso) {
    return impressosDoAtendimento({ nome: d.nome, nascimento: d.nascimento, prontuario: d.prontuario }).map(
      (i) => ({
        ...i,
        rotulo: IMPRESSOS_ATENDIMENTO.find((x) => x.codigo === i.impresso)?.rotulo ?? i.impresso,
        formatos: [...i.formatos],
      }),
    );
  }
}
