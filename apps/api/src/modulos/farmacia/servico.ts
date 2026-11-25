// Aplicação da farmácia hospitalar e da farmácia clínica (M29): a fila de dispensação na janela da unidade (regras 1 a
// 3), a dispensação pelo executor com a etiqueta de dose na fila da impressora depois do commit, as doses do paciente e
// a sugestão de devolução pelos não administrados (regra 6), a entrega ao setor (regra 5), a fila de avaliação com a
// triagem (regras 7 e 8), a intervenção e a resposta do médico, os controlados (regra 4), o livro (regra 9) e a farmácia
// ambulatorial (regra 10). A tela nunca manda número de documento, valor, nem data gravada.
import {
  type DoseDispensadaLida,
  type DoseFila,
  EVENTOS_AUDITAVEIS,
  type FilaAvaliacao,
  type FilaDispensacao,
  type ItemAvaliacao,
  type LivroControladosLido,
  type ResultadoFarmacia,
  type SaldoControlado,
  type WorklistFarmaceutico,
} from '@sgh/contratos';
import {
  type ClasseMedicamento,
  classeDoItem,
  codigoEtiquetaDose,
  conferirChaveSngpc,
  conferirPoliticaDispensacao,
  type DoseNaFila,
  GRUPOS_SITUACAO_FARMACIA,
  grupoDaSituacao,
  janelaDaFila,
  lerPolitica,
  listaDoItem,
  livroDaLista,
  LIVROS_CONTROLADOS,
  conferirFechamentoLivro,
  type LivroMontado,
  montarFila,
  montarLivro,
  textoDoTermo,
  nomeDaSituacao,
  ordenarFilaAvaliacao,
  resumoPorGrupo,
  saldoPorSubstancia,
  sugestoesDevolucao,
  triarItem,
  type SugestaoDevolucao,
} from '@sgh/contratos/regras-suprimentos';
import { enfileirarZpl, ErroZpl, zplEtiquetaDose } from '@sgh/dominio-documento';
import type { DoseDaFila, Triagem } from './tipos.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { recusa } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { FonteDocumento } from '../documento/public-api.js';
import type { ApoiosFarmacia } from './apoios.js';
import type { ContextoFarmacia, PortaFarmacia } from './porta.js';

const ctx = (s: SessaoCadastro): ContextoFarmacia => s.porta;
const p2 = (n: number) => String(n).padStart(2, '0');
export const minuto = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const doMinuto = (m: string) => new Date(`${m}:00`);
const dataIso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dataDe = (iso: string) => new Date(`${iso}T00:00:00`);

const MENSAGENS: Readonly<Record<string, string>> = {
  'suprimentos.dispensarHorario': 'Doses dispensadas; a etiqueta foi para a impressora da farmácia.',
  'suprimentos.confirmarEntrega': 'Entrega registrada.',
  'suprimentos.devolverDose': 'Dose devolvida ao estoque.',
  'suprimentos.cancelarDispensacao': 'Dispensação cancelada; a dose voltou ao estoque.',
  'suprimentos.registrarPerdaControlado': 'Perda do controlado registrada.',
  'suprimentos.avaliarPrescricao': 'Avaliação registrada.',
  'suprimentos.gravarRegraIntegracao': 'Regra de integração gravada.',
  'suprimentos.gravarHorariosPadrao': 'Horários padrão gravados.',
};

const resultado = (
  mensagem: string,
  repetida: boolean,
  ids: Record<string, unknown>,
  avisos: string[] = [],
  etiquetas?: ResultadoFarmacia['etiquetas'],
): ResultadoFarmacia => ({
  mensagem,
  repetida,
  ids: Object.fromEntries(
    Object.entries(ids).filter(
      (e): e is [string, number | string] => typeof e[1] === 'number' || typeof e[1] === 'string',
    ),
  ),
  avisos,
  ...(etiquetas ? { etiquetas } : {}),
});

export class ServicoFarmacia {
  constructor(
    private readonly porta: PortaFarmacia,
    readonly apoios: ApoiosFarmacia,
    private readonly documento: FonteDocumento | null,
  ) {}

  get destino() {
    return this.porta.destino;
  }

  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    extras: { reautenticadoEm?: number } = {},
  ): Promise<ResultadoFarmacia> {
    const r = await this.apoios.daOperacao(op).executar(s, op, entrada, MENSAGENS[op] ?? 'Gravado.', extras);
    return resultado(r.mensagem, r.repetida, r.resultado as Record<string, unknown>);
  }

  private async parametroTexto(s: SessaoCadastro, chave: string): Promise<string | null> {
    const v = await this.apoios.apoios.dispensacao.parametroValor(s, chave);
    return typeof v === 'string' ? v : null;
  }

  // ── Fila de dispensação ──────────────────────────────────────────────────────────────────────────

  async janela(s: SessaoCadastro): Promise<{ inicio: string; fim: string; agora: Date; horas: number }> {
    const r = await this.porta.relogio(ctx(s));
    const horas =
      (await this.apoios.apoios.dispensacao.parametro(s, 'suprimentos.farmaciaJanelaHoras')) || 12;
    return { ...janelaDaFila(minuto(r.agora), horas), agora: r.agora, horas };
  }

  async fila(s: SessaoCadastro, unidade: string): Promise<FilaDispensacao> {
    const j = await this.janela(s);
    const { doses, cortada } = await this.porta.filaDaUnidade(ctx(s), {
      unidade,
      inicio: doMinuto(j.inicio),
      fim: doMinuto(j.fim),
    });
    const produtos = [...new Set(doses.map((d) => d.horario.produto ?? 0).filter((x) => x > 0))];
    const [itens, avals] = await Promise.all([
      this.porta.itens(ctx(s), produtos),
      this.porta.avaliacoes(
        ctx(s),
        doses.map((d) => d.horario.item),
      ),
    ]);
    const politica = lerPolitica(await this.parametroTexto(s, 'suprimentos.farmaciaPoliticaDispensacao'));
    const extras = new Map<number, { d: DoseDaFila; dose: DoseFila }>();
    const naFila: DoseNaFila[] = doses.map((d) => {
      const i = itens.get(d.horario.produto ?? 0);
      const controlado = !!(i?.portaria || i?.psico);
      const classe = classeDoItem({
        tipo: d.horario.tipo,
        altaVigilancia: d.horario.altaVigilancia,
        antimicrobiano: d.horario.antimicrobiano || !!i?.antimicrobiano,
        controlado,
      });
      const a = avals.get(d.horario.item);
      const validada =
        d.validadaAntes || a?.estado === 'automatico' || (a?.estado === 'decidido' && a.decisao === 'valido');
      const n: DoseNaFila = {
        horario: d.horario.id,
        atendimento: d.atendimento,
        paciente: d.paciente,
        leito: d.leito,
        item: d.horario.produto ?? 0,
        descricao: d.horario.descricao,
        previsto: d.horario.previsto,
        quantidade: d.horario.dose,
        classe,
        urgente: d.urgente,
        agora: false,
        dispensada: d.dispensada,
        suspensa: d.horario.suspenso,
        validada,
      };
      const bloqueio = conferirPoliticaDispensacao(n, politica);
      extras.set(d.horario.id, {
        d,
        dose: {
          horario: d.horario.id,
          item: n.item,
          descricao: n.descricao,
          previsto: n.previsto,
          quantidade: n.quantidade,
          unidadeDose: d.horario.unidadeDose,
          via: d.horario.via,
          classe,
          urgente: n.urgente,
          agora: false,
          validada,
          rastreavel: !!i?.rastreavel,
          controlado: i?.portaria ?? (i?.psico ? 'PSICO' : null),
          bloqueio: bloqueio?.mensagem ?? null,
        },
      });
      return n;
    });
    const f = montarFila(naFila, j);
    return {
      unidade,
      inicio: j.inicio,
      fim: j.fim,
      total: f.total,
      cortada: cortada || f.cortada,
      pacientes: f.pacientes.map((p) => {
        const x = extras.get(p.horarios[0]!.doses[0]!.horario)!;
        return {
          atendimento: p.atendimento,
          paciente: p.paciente,
          leito: p.leito,
          iniciais: x.d.iniciais,
          alergia: x.d.alergia,
          horarios: p.horarios.map((h) => ({
            previsto: h.previsto,
            doses: h.doses.map((d) => extras.get(d.horario)!.dose),
          })),
        };
      }),
    };
  }

  /** Dispensa pelo executor; depois do commit, a etiqueta de cada dose vai à fila da impressora (ou à tela). */
  async dispensar(
    s: SessaoCadastro,
    entrada: { atendimento: number } & Record<string, unknown>,
  ): Promise<ResultadoFarmacia> {
    const r = await this.apoios
      .daOperacao('suprimentos.dispensarHorario')
      .executar(s, 'suprimentos.dispensarHorario', entrada, MENSAGENS['suprimentos.dispensarHorario']!);
    const ids = String(r.resultado['idsDoses'] ?? '')
      .split(',')
      .map(Number)
      .filter((x) => x > 0);
    const ocupadas = Number(r.resultado['ocupadas'] ?? 0);
    const avisos = ocupadas
      ? [`${ocupadas} dose(s) passaram adiante: já dispensadas, suspensas ou em outro terminal.`]
      : [];
    const etiquetas = await this.etiquetas(s, entrada.atendimento, ids);
    return resultado(r.mensagem, r.repetida, r.resultado as Record<string, unknown>, avisos, etiquetas);
  }

  private async etiquetas(s: SessaoCadastro, reg: number, ids: readonly number[]) {
    if (ids.length === 0) return { naFila: false, zpl: [] };
    const desde = new Date(Date.now() - 2 * 86_400_000);
    const [doses, leitos] = await Promise.all([
      this.porta.dosesDoAtendimento(ctx(s), reg, desde),
      this.porta.leitos(ctx(s), [reg]),
    ]);
    const l = leitos.get(reg) ?? { leito: '-', iniciais: '' };
    const zpl: string[] = [];
    for (const d of doses.filter((x) => ids.includes(x.dose))) {
      const c = codigoEtiquetaDose({
        dose: d.dose,
        item: d.item,
        barras: d.barras,
        lote: d.lote,
        validade: d.validade,
      });
      try {
        zpl.push(
          zplEtiquetaDose({
            leito: l.leito,
            atendimento: reg,
            iniciais: l.iniciais,
            medicamento: d.descricao,
            dose: `${d.quantidade}`,
            horario: d.dispensadaEm.slice(5).replace('T', ' '),
            lote: d.lote,
            validade: d.validade ? d.validade.split('-').reverse().join('/') : null,
            datamatrix: c.dado,
          }),
        );
      } catch (x) {
        if (!(x instanceof ErroZpl)) throw x;
      }
    }
    let naFila = false;
    const fonte = this.documento;
    if (fonte && zpl.length > 0) {
      try {
        for (const [k, z] of zpl.entries())
          await enfileirarZpl(
            {
              chaveIdempotencia: `dose-${ids[k] ?? k}`,
              rede: s.rede || 'rede',
              estabelecimento: s.hospital,
              estacao: estacaoDaRequisicao(s.req)
                .replace(/[^A-Za-z0-9._-]/g, '-')
                .slice(0, 64),
              modelo: 'etiqueta-dose',
              zpl: z,
            },
            fonte.armazem,
            fonte.destino,
            fonte.novoId,
          );
        naFila = true;
      } catch {
        naFila = false;
      }
    }
    return { naFila, zpl };
  }

  // ── Doses do paciente e devolução ─────────────────────────────────────────────────────────────────

  async dosesDoAtendimento(
    s: SessaoCadastro,
    reg: number,
  ): Promise<{ doses: DoseDispensadaLida[]; sugestoes: SugestaoDevolucao[] }> {
    const desde = new Date(Date.now() - 3 * 86_400_000);
    const doses = await this.porta.dosesDoAtendimento(ctx(s), reg, desde);
    const situacoes = await this.porta.situacoes(
      ctx(s),
      doses.flatMap((d) => (d.horario ? [d.horario] : [])),
    );
    const devolvidas = new Set(doses.filter((d) => d.devolvido >= d.quantidade).map((d) => d.dose));
    return {
      doses: doses.map((d) => ({
        dose: d.dose,
        horario: d.horario,
        item: d.item,
        descricao: d.descricao,
        quantidade: d.quantidade,
        dispensadaEm: d.dispensadaEm,
        etiquetaEmitida: d.etiquetaEmitida,
        saida: d.saida,
        lote: d.lote,
        validade: d.validade,
        situacaoEntrega: d.situacaoEntrega,
      })),
      sugestoes: sugestoesDevolucao(doses, situacoes, devolvidas).map((x) => ({
        ...x,
        quantidade: x.quantidade - (doses.find((d) => d.dose === x.dose)?.devolvido ?? 0),
      })),
    };
  }

  // ── Entrega ao setor ──────────────────────────────────────────────────────────────────────────────

  async entregas(s: SessaoCadastro, situacao: number, centroCusto?: number) {
    const ls = await this.porta.entregas(ctx(s), { situacao, ...(centroCusto ? { centroCusto } : {}) });
    const [leitos, aceites] = await Promise.all([
      this.porta.leitos(
        ctx(s),
        ls.map((x) => x.atendimento),
      ),
      this.porta.aceites(
        ctx(s),
        ls.map((x) => x.controle),
      ),
    ]);
    const doses = await Promise.all(
      ls.slice(0, 100).map((x) => (x.saida ? this.porta.dosesDaSaida(ctx(s), x.saida.id) : [])),
    );
    return ls.map((x, k) => ({
      controle: x.controle,
      situacao: x.situacao,
      situacaoNome: nomeDaSituacao(x.situacao),
      desde: x.desde,
      documento: x.saida,
      atendimento: x.atendimento,
      leito: leitos.get(x.atendimento)?.leito ?? '',
      centroCusto: x.centroCusto,
      itens: x.itens,
      usuario: x.usuario,
      doses: (doses[k] ?? []).map((d) => ({
        dose: d.dose,
        descricao: d.descricao,
        quantidade: d.quantidade,
        serie: codigoEtiquetaDose({
          dose: d.dose,
          item: d.item,
          barras: d.barras,
          lote: d.lote,
          validade: d.validade,
        }).serie,
      })),
      aceite: aceites.get(x.controle) ?? null,
    }));
  }

  // ── Avaliação farmacêutica ────────────────────────────────────────────────────────────────────────

  private async classesHumanas(s: SessaoCadastro): Promise<ClasseMedicamento[]> {
    const t =
      (await this.parametroTexto(s, 'suprimentos.farmaciaClassesFilaHumana')) ?? 'alto-risco,antimicrobiano';
    return t
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean) as ClasseMedicamento[];
  }

  /** A fila da unidade: os itens das próximas 24 h, com a triagem (automática ou humana) e o estado da avaliação. */
  async filaAvaliacao(s: SessaoCadastro, unidade: string): Promise<FilaAvaliacao & { triagens: Triagem[] }> {
    const r = await this.porta.relogio(ctx(s));
    const inicio = new Date(r.agora.getTime() - 2 * 3_600_000);
    const fim = new Date(r.agora.getTime() + 24 * 3_600_000);
    const { doses, cortada } = await this.porta.filaDaUnidade(ctx(s), { unidade, inicio, fim });
    const porItem = new Map<number, DoseDaFila>();
    for (const d of doses) if (!porItem.has(d.horario.item)) porItem.set(d.horario.item, d);
    const lista = [...porItem.values()];
    const [itens, avals, prescritos, intervs] = await Promise.all([
      this.porta.itens(
        ctx(s),
        lista.map((d) => d.horario.produto ?? 0),
      ),
      this.porta.avaliacoes(ctx(s), [...porItem.keys()]),
      this.porta.itensPrescritos(ctx(s), [...porItem.keys()]),
      this.porta.intervencoesDosItens(ctx(s), [...porItem.keys()]),
    ]);
    const humanas = await this.classesHumanas(s);
    const contagemProduto = new Map<string, number>();
    for (const d of lista) {
      const k = `${d.atendimento}:${d.horario.produto}`;
      contagemProduto.set(k, (contagemProduto.get(k) ?? 0) + 1);
    }
    const triagens: Triagem[] = [];
    const itensFila: ItemAvaliacao[] = lista.map((d) => {
      const i = itens.get(d.horario.produto ?? 0);
      const classe = classeDoItem({
        tipo: d.horario.tipo,
        altaVigilancia: d.horario.altaVigilancia,
        antimicrobiano: d.horario.antimicrobiano || !!i?.antimicrobiano,
        controlado: !!(i?.portaria || i?.psico),
      });
      const t = triarItem(
        {
          classe,
          alergiaConflitante: d.alergia && !!prescritos.get(d.horario.item)?.alergiaJustificada,
          duplicado: (contagemProduto.get(`${d.atendimento}:${d.horario.produto}`) ?? 0) > 1,
          via: d.horario.via,
          viasDoCadastro: [],
          dose: d.horario.dose,
          doseMinima: null,
          doseMaxima: null,
          urgente: d.urgente,
          enviarParaAvaliacao: i?.envioAvaliacao === 2 || (i?.envioAvaliacao === 3 && d.urgente),
        },
        humanas,
      );
      const a = avals.get(d.horario.item);
      if (!a)
        triagens.push({
          item: d.horario.item,
          horario: d.horario.id,
          classe,
          destino: t.destino,
          prioridade: t.prioridade,
          achados: t.achados,
          regra: t.regra,
        });
      const situacao = d.validadaAntes ? 5 : null;
      return {
        item: d.horario.item,
        horario: d.horario.id,
        prescricao: d.horario.prescricao,
        atendimento: d.atendimento,
        paciente: d.paciente,
        leito: d.leito,
        iniciais: d.iniciais,
        descricao: d.horario.descricao,
        classe,
        dose: d.horario.dose,
        unidadeDose: d.horario.unidadeDose,
        via: d.horario.via,
        situacao,
        situacaoNome: situacao ? nomeDaSituacao(situacao) : 'Sem avaliação registrada',
        grupo:
          a?.estado === 'decidido'
            ? a.decisao === 'valido'
              ? 'liberado'
              : 'pendencia'
            : (grupoDaSituacao(situacao) ?? 'a-avaliar'),
        destino: a?.destino ?? t.destino,
        prioridade: a?.prioridade ?? t.prioridade,
        achados: a?.achados ?? t.achados,
        estado: a?.estado ?? (t.destino === 'automatica' ? 'automatico' : 'pendente'),
        decisao: a?.decisao ?? null,
        desde: a?.desde ?? d.horario.previsto,
        intervencoesAbertas: intervs.filter((x) => x.item === d.horario.item && x.estado === 'aberta').length,
      };
    });
    const humanaPendente = itensFila.filter((x) => x.destino === 'humana');
    const ordenados = [
      ...ordenarFilaAvaliacao(humanaPendente.map((x) => ({ ...x, id: x.item }))),
      ...itensFila.filter((x) => x.destino !== 'humana'),
    ];
    const resumo = resumoPorGrupo([]);
    const contagem: Record<string, number> = { ...resumo };
    for (const g of GRUPOS_SITUACAO_FARMACIA)
      contagem[g.id] = ordenados.filter((x) => x.grupo === g.id).length;
    return {
      resumo: contagem,
      itens: ordenados.slice(0, 300).map((x) => {
        const r: Partial<ItemAvaliacao & { id: number }> = { ...x };
        delete r.id;
        return r as ItemAvaliacao;
      }),
      cortada: cortada || ordenados.length > 300,
      triagens,
    };
  }

  async worklist(s: SessaoCadastro, unidades: readonly string[]): Promise<WorklistFarmaceutico> {
    const filas = await Promise.all(unidades.slice(0, 10).map((u) => this.filaAvaliacao(s, u)));
    const itens = filas
      .flatMap((f) => f.itens)
      .filter((x) => x.destino === 'humana' && x.estado === 'pendente');
    const t = await this.porta.totaisIntervencoes(ctx(s), new Date(Date.now() - 30 * 86_400_000));
    return {
      aValidar: itens.length,
      altoRisco: itens.filter((x) => x.classe === 'alto-risco').length,
      antimicrobianos: itens.filter((x) => x.classe === 'antimicrobiano').length,
      intervencoesAbertas: t.abertas,
      itens: itens.slice(0, 20).map((x) => ({
        item: x.item,
        leito: x.leito,
        descricao: x.descricao,
        prioridade: x.prioridade,
        classe: x.classe,
        desde: x.desde,
      })),
    };
  }

  // ── Controlados e livro ───────────────────────────────────────────────────────────────────────────

  async controlados(s: SessaoCadastro, inicio: string, fim: string): Promise<SaldoControlado[]> {
    const cs = await this.porta.controlados(ctx(s));
    const hoje = (await this.porta.relogio(ctx(s))).hoje;
    const movs = await this.porta.movimentos(ctx(s), {
      itens: cs.map((c) => c.item),
      inicio: dataDe(inicio),
      fim: dataDe(hoje > fim ? hoje : fim),
    });
    const confs = await this.porta.conferencias(ctx(s), dataDe(inicio));
    return cs.map((c) => {
      const doItem = movs.filter((m) => m.item === c.item);
      const noPeriodo = doItem.filter((m) => m.data >= inicio && m.data <= fim);
      const depois = doItem.filter((m) => m.data > fim);
      // O saldo anterior: o saldo da empresa de hoje desfeito dos movimentos do período e dos posteriores.
      const tudo = saldoPorSubstancia(0, [...noPeriodo, ...depois]);
      const anterior = c.estoque - (tudo.entradas - tudo.saidas);
      const t = saldoPorSubstancia(anterior, noPeriodo);
      const lista = listaDoItem(c.portaria);
      return {
        item: c.item,
        nome: c.nome,
        lista: c.portaria,
        livro: livroDaLista(lista),
        saldoEmpresa: c.estoque,
        saldoLocal: null,
        ...t,
        conferencias: confs.filter((x) => x.item === c.item).length,
      };
    });
  }

  async movimentosDoControlado(s: SessaoCadastro, item: number, inicio: string, fim: string) {
    const [movs, confs] = await Promise.all([
      this.porta.movimentos(ctx(s), { itens: [item], inicio: dataDe(inicio), fim: dataDe(fim) }),
      this.porta.conferencias(ctx(s), dataDe(inicio)),
    ]);
    return movs.map((m) => ({
      item: m.item,
      data: m.data,
      tipo: m.tipo,
      quantidade: m.quantidade,
      documento: m.documento,
      documentoId: m.documentoId,
      prescritor: m.prescritor,
      conferido: confs.some((c) => c.item === item && c.docId === m.documentoId),
    }));
  }

  async livro(
    s: SessaoCadastro,
    livro: number,
    inicio: string,
    fim: string,
    /** No fechamento, o modo pedido; na leitura (omitido), o modo em que o período está fechado. */
    comoOficial?: boolean,
  ): Promise<LivroControladosLido & { montado: LivroMontado }> {
    if (!LIVROS_CONTROLADOS.some((l) => l.id === livro))
      throw new ErroProblema('nao-encontrado', 404, 'Livro inválido');
    const saldos = await this.controlados(s, inicio, fim);
    const movs = await this.porta.movimentos(ctx(s), {
      itens: saldos.map((x) => x.item),
      inicio: dataDe(inicio),
      fim: dataDe(fim),
    });
    const f = await this.porta.livroFechado(ctx(s), livro, dataDe(inicio));
    // O período fechado como oficial é lido como oficial: o termo de abertura não leva o aviso de conferência.
    const oficial = comoOficial ?? f?.modo === 'oficial';
    const montado = montarLivro({
      livro: livro as 1 | 2 | 3 | 4,
      inicio,
      fim,
      estabelecimento: s.hospital.toUpperCase(),
      oficial,
      substancias: saldos.flatMap((x) => {
        const l = listaDoItem(x.lista);
        return l ? [{ item: x.item, nome: x.nome, lista: l, saldoAnterior: x.anterior }] : [];
      }),
      movimentos: movs.map((m) => ({
        item: m.item,
        data: m.data,
        tipo: m.tipo,
        quantidade: m.quantidade,
        documento: m.documento,
      })),
    });
    const fechadoOficial = f?.modo === 'oficial';
    return {
      livro: montado.livro,
      titulo: montado.titulo,
      inicio,
      fim,
      modo: montado.modo,
      termoAbertura: montado.termoAbertura,
      termoEncerramento: montado.termoEncerramento,
      paginas: montado.paginas.map((p) => ({
        ...p,
        movimentos: p.movimentos.map((m) => ({
          data: m.data,
          tipo: m.tipo,
          quantidade: m.quantidade,
          documento: m.documento,
        })),
      })),
      fechado: f
        ? {
            em: f.em,
            por: f.por,
            guardaAte: f.guardaAte,
            hash: f.hash,
            modo: fechadoOficial ? 'oficial' : 'conferencia',
            termos: f.termos.map((t) => ({
              ...t,
              texto: textoDoTermo(t, { titulo: montado.titulo, inicio, fim, oficial: fechadoOficial }),
            })),
          }
        : null,
      montado,
    };
  }

  /** O HTML do livro para o PDF/A (o Gotenberg converte); só o que o livro mostra, nada de paciente. */
  htmlDoLivro(l: LivroControladosLido): string {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paginas = l.paginas
      .map(
        (
          p,
        ) => `<section style="page-break-after:always"><h2>Página ${p.pagina}: ${esc(p.nome)} (lista ${esc(p.lista)})</h2>
<p>Saldo anterior: ${p.anterior}; entradas: ${p.entradas}; saídas: ${p.saidas}; saldo final: ${p.final}</p>
<table border="1" cellspacing="0" cellpadding="4"><tr><th>Data</th><th>Movimento</th><th>Quantidade</th><th>Documento</th></tr>
${p.movimentos.map((m) => `<tr><td>${esc(m.data)}</td><td>${esc(m.tipo)}</td><td>${m.quantidade}</td><td>${esc(m.documento)}</td></tr>`).join('\n')}
</table></section>`,
      )
      .join('\n');
    // O livro fechado leva os termos como ficaram gravados; sem fechamento (ou sem o emitente), os montados na hora.
    const gravado = (tipo: 'abertura' | 'encerramento') =>
      l.fechado?.termos.find((t) => t.tipo === tipo)?.texto;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(l.titulo)}</title></head><body>
<h1>${esc(l.titulo)}</h1><p>${esc(gravado('abertura') ?? l.termoAbertura)}</p>${paginas}<p>${esc(gravado('encerramento') ?? l.termoEncerramento)}</p>
${l.fechado ? `<p>Fechado por ${esc(l.fechado.por)} em ${esc(l.fechado.em)}; guarda até ${esc(l.fechado.guardaAte)}; impressão digital ${esc(l.fechado.hash)}.</p>` : ''}
</body></html>`;
  }

  async fecharLivro(s: SessaoCadastro, livro: number, inicio: string, fim: string, oficial: boolean) {
    const l = await this.livro(s, livro, inicio, fim, oficial);
    const chaveOficial = (await this.apoios.apoios.livroOficial.liberacao(s)).ligada;
    const montado: LivroMontado = { ...l.montado, modo: oficial ? 'oficial' : 'conferencia' };
    // O oficial guarda antes o conteúdo na porta de arquivos (ADR 0004); só depois das regras que não leem o banco,
    // para não guardar arquivo de quem não pode fechar. A gravação confere o hash do arquivo com o do livro.
    let conteudo: { arquivo: number; hash: string } | null = null;
    if (oficial) {
      const r0 = conferirFechamentoLivro({
        responsavelTecnico: s.pode('suprimentos.livro.fechar'),
        inicio: montado.inicio,
        fim: montado.fim,
        oficial,
        chaveOficialLigada: chaveOficial,
        jaFechado: false,
      });
      if (r0) throw recusa(r0.codigo, r0.mensagem, r0.campos ? { campos: r0.campos } : {});
      if (this.apoios.porta.guardarConteudoLivro)
        conteudo = await this.apoios.porta.guardarConteudoLivro(ctx(s), montado);
    }
    const r = await this.apoios.apoios.controlados.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosLivroFechado.codigo,
      'suprimentos.controlados',
      (x: { id: number }) => ({ tabela: 'livro_controlado', id: String(x.id) }),
      (g) =>
        g.fecharLivro({
          livro: montado,
          usuario: s.login,
          responsavelTecnico: s.pode('suprimentos.livro.fechar'),
          chaveOficialLigada: chaveOficial,
          conteudo,
        }),
    );
    return resultado(
      `Livro fechado (${montado.modo === 'oficial' ? 'oficial' : 'modo conferência'}); guarda até ${r.guardaAte}.`,
      false,
      { livro: r.id, hash: r.hash },
    );
  }

  // ── Farmácia ambulatorial (regra 10) ──────────────────────────────────────────────────────────────

  async exigirAmbulatorial(s: SessaoCadastro): Promise<void> {
    const l = await this.apoios.apoios.ambulatorial.liberacao(s);
    const r = conferirChaveSngpc(l.ligada);
    if (r)
      throw new ErroProblema('recurso-desligado', 403, 'Funcionalidade desligada', r.mensagem, {
        codigo: r.codigo,
      });
  }

  async datas(s: SessaoCadastro): Promise<{ hoje: string }> {
    const r = await this.porta.relogio(ctx(s));
    return { hoje: r.hoje || dataIso(r.agora) };
  }
}
