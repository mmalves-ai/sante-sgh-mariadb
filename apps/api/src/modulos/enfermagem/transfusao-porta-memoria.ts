// Porta da agência transfusional (M47, etapa 1) EM MEMÓRIA: a sessão sintética de dev/ci (E2E). Os internados, o
// relógio e os horários vêm da porta da enfermagem em memória: cada horário de hemoterapia dela é um item de hemoterapia
// da prescrição vigente (com o horário, o início checa o horário pela checagem do M25); um item SINTÉTICO a mais, sem
// horário, fica com o primeiro internado (o ato fica só no novo). Os termos de consentimento são um termo assinado
// SINTÉTICO por paciente. A requisição, a amostra, o ato, os sinais e a reação ficam em memória, com as mesmas recusas
// da gravação SGH_ (a requisição aberta por item, o cancelamento antes da transfusão, a requisição fechada, a mesma
// pessoa conferindo, o ato em curso, a bolsa já usada, uma medida por momento, o ato encerrado, a notificação uma vez).
// Nada é de pessoa real (marca "SINTETICO M47").
import {
  type AdendoAtoLido,
  type AtoTransfusionalLido,
  classeDoHemocomponente,
  fatorRhPorId,
  grupoAboPorId,
  HEMOCOMPONENTES_VISTOS,
  type ItemHemoterapiaAAtender,
  type ReacaoTransfusionalLida,
  type RequisicaoTransfusionalLida,
  type SinaisRegistrados,
  type TipagemSanguinea,
  urgenciaPorId,
  MENSAGENS_CORRECAO_HEMO,
  type VersaoRequisicaoLida,
} from '@sgh/contratos';
import { type ContextoOperacao, recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import type { HorarioEnfermagemLido } from './tipos-vinculados.js';
import { chaveDoEstabelecimento } from './tipos-vinculados.js';
import type { HorarioHemoterapia, TermoConsentimentoLido } from './transfusao-tipos.js';
import type { PortaEnfermagem } from './porta.js';
import type {
  ContextoTransfusao,
  FiltroRequisicoesPorta,
  GravadorTransfusao,
  PortaTransfusao,
} from './transfusao-porta.js';

const M = 'SINTETICO M47';
/** O item SINTÉTICO sem horário (o ato fica só no novo). */
export const ITEM_SEM_HORARIO_SINTETICO = 47_001;
const TERMO_BASE = 47_900;

type Requisicao = Omit<
  RequisicaoTransfusionalLida,
  'paciente' | 'amostra' | 'tipagem' | 'atrasada' | 'hemocomponente'
> & {
  paciente: number;
  hemocomponente: string;
  aberta: boolean;
  chave: string | null;
};
interface Amostra {
  id: number;
  requisicao: number;
  codigo: string;
  coletadaEm: string;
  validaAte: string;
  chave: string | null;
  usuario: string;
}
type Ato = Omit<AtoTransfusionalLido, 'sinais' | 'reacao'> & {
  paciente: number;
  atendimento: number;
  chave: string | null;
};
type Sinal = SinaisRegistrados & { id: number; ato: number; chave: string | null; usuario: string };
type Reacao = Omit<ReacaoTransfusionalLida, 'paciente' | 'bolsa' | 'transfusaoIniciadaEm' | 'requisicao'> & {
  paciente: number;
  chave: string | null;
};
interface Estado {
  seq: number;
  requisicoes: Requisicao[];
  amostras: Amostra[];
  atos: Ato[];
  sinais: Sinal[];
  reacoes: Reacao[];
  ganhos: Set<string>;
  /** W0-03: as versões anteriores das requisições e os adendos dos atos. */
  versoes: (VersaoRequisicaoLida & { requisicao: number })[];
  adendos: AdendoAtoLido[];
}

export class PortaTransfusaoMemoria implements PortaTransfusao {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly enfermagem: PortaEnfermagem) {}

  private e(c: ContextoTransfusao): Estado {
    let s = this.estados.get(chaveDoEstabelecimento(c));
    if (!s) {
      s = {
        seq: 47_100,
        requisicoes: [],
        amostras: [],
        atos: [],
        sinais: [],
        reacoes: [],
        ganhos: new Set(),
        versoes: [],
        adendos: [],
      };
      this.estados.set(chaveDoEstabelecimento(c), s);
    }
    return s;
  }

  private async agora(c: ContextoTransfusao): Promise<string> {
    return (await this.enfermagem.relogio(c)).slice(0, 19);
  }

  /** Os internados da enfermagem em memória e os horários de hemoterapia deles (de ontem a amanhã). */
  private async hemoterapia(c: ContextoTransfusao) {
    const unidades = await this.enfermagem.unidades(c);
    const internados = (
      await Promise.all(unidades.map((u) => this.enfermagem.internados(c, u.unidade)))
    ).flat();
    const agora = await this.agora(c);
    const mais = (h: number) =>
      new Date(Date.parse(`${agora.slice(0, 16)}:00Z`) + h * 3_600_000).toISOString();
    const hs = internados.length
      ? (
          await this.enfermagem.horarios(c, {
            atendimentos: internados.map((i) => i.atendimento),
            inicio: mais(-24).slice(0, 16),
            fim: mais(24).slice(0, 16),
            teto: 2_000,
          })
        ).itens.filter((h) => h.tipo === 'hemoterapia')
      : [];
    return { internados, hs, agora };
  }

  private itemDoHorario(
    h: HorarioEnfermagemLido,
    i: { paciente: number; nome: string; numero: number },
    todos: readonly HorarioEnfermagemLido[],
  ): ItemHemoterapiaAAtender {
    const codigo = /PLAQUETA/i.test(h.descricao) ? 'CP' : /PLASMA/i.test(h.descricao) ? 'PLC' : 'CH';
    return {
      item: h.item,
      prescricao: h.prescricao,
      atendimento: h.atendimento,
      paciente: { id: i.paciente, nome: i.nome, prontuario: i.numero },
      hemocomponente: {
        codigo,
        rotulo: HEMOCOMPONENTES_VISTOS[codigo]!.rotulo,
        classe: classeDoHemocomponente(codigo),
      },
      dose: h.dose ?? 1,
      unidadeDose: h.unidadeDose ?? 'UN',
      indicacao: `Hemoglobina 6,9 g/dL com taquicardia (${M})`,
      iniciarAgora: false,
      prescritoEm: `${h.previsto.slice(0, 10)}T06:00:00`,
      vigenteAte: null,
      suspenso: h.situacao === 'S' || h.situacao === 'C',
      horarios: todos.filter((x) => x.item === h.item).length,
    };
  }

  private async todosOsItens(c: ContextoTransfusao): Promise<ItemHemoterapiaAAtender[]> {
    const { internados, hs, agora } = await this.hemoterapia(c);
    const r = new Map<number, ItemHemoterapiaAAtender>();
    for (const h of hs) {
      const i = internados.find((x) => x.atendimento === h.atendimento);
      if (i && !r.has(h.item)) r.set(h.item, this.itemDoHorario(h, i, hs));
    }
    const p = internados[0];
    if (p)
      r.set(ITEM_SEM_HORARIO_SINTETICO, {
        item: ITEM_SEM_HORARIO_SINTETICO,
        prescricao: 47_002,
        atendimento: p.atendimento,
        paciente: { id: p.paciente, nome: p.nome, prontuario: p.numero },
        hemocomponente: { codigo: 'CP', rotulo: 'Concentrado de plaquetas', classe: 'plaquetas' },
        dose: 1,
        unidadeDose: 'BOLS',
        indicacao: `Plaquetas 9 mil com petéquias (${M})`,
        iniciarAgora: true,
        prescritoEm: `${agora.slice(0, 10)}T06:00:00`,
        vigenteAte: null,
        suspenso: false,
        horarios: 0,
      });
    return [...r.values()];
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(c: ContextoTransfusao, op: string, e: unknown, x: ContextoOperacao): never {
    void [c, e, x];
    throw new Error(`Operação ${op} sem simulação nesta porta: a checagem vai pela enfermagem.`);
  }

  async gravarSgh<T>(
    c: ContextoTransfusao,
    _trilha: unknown,
    fn: (g: GravadorTransfusao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const agora = await this.agora(c);
    const k = (chave: string | null, sufixo = '') => (chave ? `${chaveDoEstabelecimento(c)}:${chave}${sufixo}` : null);
    const mesma = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
    const req = (id: number) => {
      const q = s.requisicoes.find((x) => x.id === id);
      if (!q)
        throw recusa(
          'nao-encontrada',
          'A requisição transfusional não foi encontrada neste estabelecimento.',
        );
      return q;
    };
    const ato = (id: number) => {
      const a = s.atos.find((x) => x.id === id);
      if (!a) throw recusa('nao-encontrado', 'A transfusão não foi encontrada neste estabelecimento.');
      return a;
    };
    const aberta = (q: Requisicao) => ['requisitada', 'amostraColetada', 'emAtendimento'].includes(q.estado);
    const sinal = (x: Omit<Sinal, 'id'>) => {
      if (s.sinais.some((y) => y.ato === x.ato && y.momento === x.momento))
        throw recusa('sinais-ja-registrados', 'Os sinais deste momento da transfusão já foram registrados.');
      const id = ++s.seq;
      s.sinais.push({ ...x, id });
      return id;
    };
    const concluir: GravadorTransfusao['concluir'] = async (x) => {
      const a = ato(x.ato);
      if (a.estado !== 'emCurso')
        throw recusa('ato-encerrado', 'A transfusão já foi concluída ou interrompida.');
      const q = req(a.requisicao);
      let ganho: number | null = null;
      const chaveGanho = `hemo-ato:${a.id}`;
      if (x.volumeTransfundidoMl > 0 && x.janelaBalanco !== null && !s.ganhos.has(chaveGanho)) {
        s.ganhos.add(chaveGanho);
        ganho = ++s.seq;
      }
      Object.assign(a, {
        estado: x.interrompida ? 'interrompido' : 'concluido',
        terminoEm: `${x.terminoEm.slice(0, 16)}:00`,
        volumeTransfundidoMl: x.volumeTransfundidoMl,
        motivoInterrupcao: x.interrompida ? (x.motivoInterrupcao ?? 'Interrompida') : null,
        ganhoLancado: ganho !== null,
      });
      const transfundidas = Math.min(q.quantidadeBolsas, q.bolsasTransfundidas + 1);
      const estado = transfundidas >= q.quantidadeBolsas ? 'atendida' : 'emAtendimento';
      Object.assign(q, { bolsasTransfundidas: transfundidas, estado, aberta: estado !== 'atendida' });
      return { id: a.id, estadoRequisicao: estado, ganho };
    };
    return fn({
      requisitar: async (r) => {
        const ja = s.requisicoes.find((x) => x.chave !== null && x.chave === k(r.chave));
        if (ja) return { id: ja.id, repetida: true };
        if (s.requisicoes.some((x) => x.item === r.item && x.aberta))
          throw recusa('requisicao-em-aberto', 'Já há uma requisição em aberto para este item.');
        const id = ++s.seq;
        s.requisicoes.push({
          id,
          item: r.item,
          prescricao: r.prescricao,
          atendimento: r.atendimento,
          paciente: r.paciente,
          hemocomponente: r.hemocomponente,
          quantidadeBolsas: r.quantidadeBolsas,
          bolsasTransfundidas: 0,
          volumeMl: r.volumeMl,
          urgencia: urgenciaPorId(r.urgencia) ?? 'rotina',
          programadaPara: r.programadaPara ? `${r.programadaPara.slice(0, 16)}:00` : null,
          prazo: r.prazo ? `${r.prazo.slice(0, 16)}:00` : null,
          estado: 'requisitada',
          indicacao: r.indicacao,
          termo: r.termo,
          requisitadaEm: agora,
          requisitadaPor: r.usuario,
          examesDeApoio: r.examesDeApoio,
          justificativaUrgencia: r.justificativaUrgencia,
          transfusaoAnterior: r.transfusaoAnterior,
          reacaoAnterior: r.reacaoAnterior,
          gestacaoAnterior: r.gestacaoAnterior,
          motivoCancelamento: null,
          aberta: true,
          chave: k(r.chave),
        });
        return { id, repetida: false };
      },
      alterar: async (x) => {
        const q = req(x.requisicao);
        const rec = (codigo: string) => recusa(codigo, MENSAGENS_CORRECAO_HEMO[codigo] ?? codigo);
        if (q.estado !== 'requisitada' && q.estado !== 'amostraColetada') throw rec('requisicao-ja-atendida');
        if (x.urgencia === 1 && !x.programadaPara) throw rec('programada-sem-data');
        const urgencia = urgenciaPorId(x.urgencia) ?? 'rotina';
        const programadaPara = x.programadaPara ? `${x.programadaPara.slice(0, 16)}:00` : null;
        if (
          q.hemocomponente === x.hemocomponente &&
          q.volumeMl === x.volumeMl &&
          q.urgencia === urgencia &&
          q.programadaPara === programadaPara
        )
          throw rec('requisicao-sem-mudanca');
        const versao = s.versoes.filter((v) => v.requisicao === q.id).length + 1;
        s.versoes.push({
          requisicao: q.id,
          versao,
          hemocomponente: q.hemocomponente,
          volumeMl: q.volumeMl,
          urgencia: q.urgencia,
          programadaPara: q.programadaPara?.slice(0, 16) ?? null,
          prazo: q.prazo?.slice(0, 16) ?? null,
          motivo: x.motivo,
          alteradaPor: x.usuario,
          alteradaEm: agora.slice(0, 16),
        });
        Object.assign(q, {
          hemocomponente: x.hemocomponente,
          volumeMl: x.volumeMl,
          urgencia,
          programadaPara,
          prazo: x.prazo ? `${x.prazo.slice(0, 16)}:00` : null,
        });
        return { id: q.id, versao: versao + 1 };
      },
      adendo: async (x) => {
        ato(x.ato);
        if (!s.sinais.some((y) => y.ato === x.ato && y.momento === x.momento))
          throw recusa('momento-sem-medida', MENSAGENS_CORRECAO_HEMO['momento-sem-medida']!);
        const id = ++s.seq;
        s.adendos.push({
          id,
          ato: x.ato,
          momento: x.momento,
          sinais: x.sinais,
          motivo: x.motivo,
          usuario: x.usuario,
          em: agora.slice(0, 16),
        });
        return { id };
      },
      cancelar: async (x) => {
        const q = req(x.requisicao);
        if (q.estado === 'cancelada') throw recusa('ja-cancelada', 'A requisição já foi cancelada.');
        if (q.estado !== 'requisitada' && q.estado !== 'amostraColetada')
          throw recusa('nao-cancelavel', 'A transfusão já começou: a requisição não é mais cancelável.');
        Object.assign(q, { estado: 'cancelada', aberta: false, motivoCancelamento: x.motivo });
        return { id: q.id };
      },
      amostra: async (a) => {
        const ja = s.amostras.find((x) => x.chave !== null && x.chave === k(a.chave));
        if (ja) return { id: ja.id, codigo: ja.codigo, repetida: true };
        const q = req(a.requisicao);
        if (!aberta(q))
          throw recusa('requisicao-fechada', 'A requisição não está aberta: a amostra não é registrada.');
        const id = ++s.seq;
        const codigo = `HT${a.coletadaEm.slice(2, 4)}${String(id).padStart(8, '0')}`;
        s.amostras.push({
          id,
          requisicao: q.id,
          codigo,
          coletadaEm: `${a.coletadaEm.slice(0, 16)}:00`,
          validaAte: `${a.validaAte.slice(0, 16)}:00`,
          chave: k(a.chave),
          usuario: a.usuario,
        });
        if (q.estado === 'requisitada') Object.assign(q, { estado: 'amostraColetada' });
        return { id, codigo, repetida: false };
      },
      iniciar: async (t) => {
        const ja = s.atos.find((x) => x.chave !== null && x.chave === k(t.chave, ':ato'));
        if (ja) return { id: ja.id, repetida: true };
        if (mesma(t.conferente, t.profissional))
          throw recusa('segundo-profissional-igual', 'O segundo profissional tem de ser outra pessoa.');
        const q = req(t.requisicao);
        if (!aberta(q)) throw recusa('requisicao-fechada', 'A requisição não está aberta para transfusão.');
        if (s.atos.some((x) => x.requisicao === q.id && x.estado === 'emCurso'))
          throw recusa(
            'ato-em-curso',
            'Há uma transfusão em curso nesta requisição: conclua-a antes de iniciar outra bolsa.',
          );
        if (q.bolsasTransfundidas >= q.quantidadeBolsas)
          throw recusa('requisicao-fechada', 'Todas as bolsas da requisição já foram transfundidas.');
        const numero = t.bolsa.numero.trim().toUpperCase();
        if (s.atos.some((x) => x.bolsa.numero === numero))
          throw recusa('bolsa-ja-usada', 'Esta bolsa já foi usada em outra transfusão.');
        const id = ++s.seq;
        s.atos.push({
          id,
          requisicao: q.id,
          paciente: q.paciente,
          atendimento: q.atendimento,
          bolsa: {
            numero,
            hemocomponente: t.bolsa.hemocomponente,
            tipagem: { abo: grupoAboPorId(t.bolsa.abo), rh: fatorRhPorId(t.bolsa.rh) },
            volumeMl: t.bolsa.volumeMl,
          },
          estado: 'emCurso',
          inicioEm: `${t.inicioEm.slice(0, 16)}:00`,
          terminoEm: null,
          volumeTransfundidoMl: null,
          profissional: t.profissional,
          segundoProfissional: t.conferente,
          horario: t.horario,
          pulseiraLida: t.pulseiraLida,
          alertas: [...t.alertas],
          motivoInterrupcao: null,
          ganhoLancado: false,
          chave: k(t.chave, ':ato'),
        });
        sinal({
          ato: id,
          momento: 'antes',
          medidoEm: `${t.sinaisAntesEm.slice(0, 16)}:00`,
          ...t.sinaisAntes,
          chave: null,
          usuario: t.profissional,
        });
        Object.assign(q, { estado: 'emAtendimento' });
        return { id, repetida: false };
      },
      sinais: async (x) => {
        const ja = s.sinais.find((y) => y.chave !== null && y.chave === k(x.chave));
        if (ja) return { id: ja.id, repetida: true };
        const a = ato(x.ato);
        if (x.momento === 'durante' && a.estado !== 'emCurso')
          throw recusa('ato-encerrado', 'A transfusão já terminou: registre os sinais do término.');
        if (x.momento === 'depois' && a.estado === 'emCurso')
          throw recusa(
            'ato-em-curso',
            'Os sinais do término são registrados depois de concluir a transfusão.',
          );
        const id = sinal({
          ato: a.id,
          momento: x.momento,
          medidoEm: `${x.medidoEm.slice(0, 16)}:00`,
          ...x.sinais,
          chave: k(x.chave),
          usuario: x.usuario,
        });
        return { id, repetida: false };
      },
      concluir,
      reacao: async (r) => {
        const ja = s.reacoes.find((y) => y.chave !== null && y.chave === k(r.chave));
        if (ja) return { id: ja.id, repetida: true, interrompeu: false };
        const a = ato(r.ato);
        let interrompeu = false;
        if (a.estado === 'emCurso') {
          if (!r.interromper)
            throw recusa(
              'em-curso-sem-interromper',
              'Com a transfusão em curso, a primeira conduta é interrompê-la.',
            );
          await concluir({ ato: a.id, usuario: r.usuario, interrompida: true, ...r.interromper });
          interrompeu = true;
        }
        const id = ++s.seq;
        s.reacoes.push({
          id,
          ato: a.id,
          paciente: a.paciente,
          tipo: r.tipo as Reacao['tipo'],
          descricaoOutra: r.descricaoOutra,
          grau: r.grau as Reacao['grau'],
          correlacao: r.correlacao as Reacao['correlacao'],
          inicioEm: `${r.inicioEm.slice(0, 16)}:00`,
          sinaisESintomas: r.sinaisESintomas,
          condutas: r.condutas as Reacao['condutas'],
          condutaOutra: r.condutaOutra,
          destinoBolsa: r.destinoBolsa as Reacao['destinoBolsa'],
          notificacao: { sugerida: true, prioridade: r.prioridade, enviadaEm: null },
          registradaEm: agora,
          registradaPor: r.usuario,
          chave: k(r.chave),
        });
        return { id, repetida: false, interrompeu };
      },
      notificada: async (m) => {
        const x = s.reacoes.find((y) => y.id === m.reacao);
        if (!x) throw recusa('nao-encontrada', 'A reação não foi encontrada neste estabelecimento.');
        if (x.notificacao.enviadaEm !== null)
          throw recusa('ja-notificada', 'A notificação desta reação já foi registrada como enviada.');
        Object.assign(x, { notificacao: { ...x.notificacao, enviadaEm: `${m.enviadaEm.slice(0, 16)}:00` } });
        return { id: x.id };
      },
    });
  }

  async itensAAtender(c: ContextoTransfusao, o: { agora: string; atendimento?: number }) {
    const s = this.e(c);
    const ja = new Set(s.requisicoes.filter((x) => x.estado !== 'cancelada').map((x) => x.item));
    const itens = (await this.todosOsItens(c)).filter(
      (i) =>
        !ja.has(i.item) && !i.suspenso && (o.atendimento === undefined || i.atendimento === o.atendimento),
    );
    return { itens, cortada: false };
  }

  async item(c: ContextoTransfusao, item: number) {
    return (await this.todosOsItens(c)).find((i) => i.item === item) ?? null;
  }

  async horarios(c: ContextoTransfusao, item: number): Promise<HorarioHemoterapia[]> {
    const { hs } = await this.hemoterapia(c);
    return hs
      .filter((h) => h.item === item)
      .map((h) => ({
        id: h.id,
        previsto: `${h.previsto.slice(0, 16)}:00`,
        situacao: h.situacao,
        situacaoEm: h.checadoEm,
        historico: 0,
      }));
  }

  async tipagem(_c: ContextoTransfusao, paciente: number): Promise<TipagemSanguinea> {
    // Tipagem SINTÉTICA do cadastro: O positivo para os pacientes pares, A negativo para os ímpares.
    return paciente % 2 === 0 ? { abo: 'O', rh: 'positivo' } : { abo: 'A', rh: 'negativo' };
  }

  async termos(c: ContextoTransfusao, paciente: number): Promise<TermoConsentimentoLido[]> {
    const { internados } = await this.hemoterapia(c);
    const i = internados.find((x) => x.paciente === paciente);
    if (!i) return [];
    return [
      {
        id: TERMO_BASE + (paciente % 100),
        anterior: null,
        atendimento: i.atendimento,
        tipo: null,
        procedimento: `Transfusão de hemocomponentes (${M})`,
        situacao: 'assinado',
        motivo: null,
        documento: null,
        usuario: 'SINT.MEDICO',
        em: (await this.agora(c)).slice(0, 10),
      },
    ];
  }

  private lida(
    c: ContextoTransfusao,
    q: Requisicao,
    agora: string,
    nomes: Map<number, { nome: string; numero: number }>,
    t: TipagemSanguinea,
  ): RequisicaoTransfusionalLida {
    const s = this.e(c);
    const a = s.amostras
      .filter((x) => x.requisicao === q.id)
      .sort((x, y) => y.coletadaEm.localeCompare(x.coletadaEm))[0];
    const { aberta: _a, chave: _k, paciente, hemocomponente, ...resto } = q;
    void [_a, _k];
    const p = nomes.get(paciente);
    return {
      ...resto,
      paciente: { id: paciente, nome: p?.nome ?? '', prontuario: p?.numero ?? null },
      hemocomponente: {
        codigo: hemocomponente,
        rotulo: HEMOCOMPONENTES_VISTOS[hemocomponente]?.rotulo ?? hemocomponente,
      },
      amostra: a ? { codigo: a.codigo, coletadaEm: a.coletadaEm, validaAte: a.validaAte } : null,
      tipagem: t,
      atrasada: q.estado !== 'atendida' && q.estado !== 'cancelada' && q.prazo !== null && q.prazo < agora,
    };
  }

  private async nomes(c: ContextoTransfusao) {
    const { internados } = await this.hemoterapia(c);
    return new Map(internados.map((i) => [i.paciente, { nome: i.nome, numero: i.numero }]));
  }

  async requisicoes(c: ContextoTransfusao, f: FiltroRequisicoesPorta) {
    const nomes = await this.nomes(c);
    const itens: RequisicaoTransfusionalLida[] = [];
    const termo = (f.termo ?? '').trim().toUpperCase();
    for (const q of [...this.e(c).requisicoes].reverse()) {
      if (f.estado && q.estado !== f.estado) continue;
      if (termo) {
        const n = nomes.get(q.paciente);
        const prontuario = n ? String(n.numero) : '';
        if (!(n?.nome ?? '').toUpperCase().includes(termo) && prontuario !== termo) continue;
      }
      if (f.urgencia && urgenciaPorId(f.urgencia) !== q.urgencia) continue;
      if (f.de && q.requisitadaEm.slice(0, 10) < f.de) continue;
      if (f.ate && q.requisitadaEm.slice(0, 10) > f.ate) continue;
      if (f.atendimento !== undefined && q.atendimento !== f.atendimento) continue;
      itens.push(this.lida(c, q, f.agora, nomes, await this.tipagem(c, q.paciente)));
    }
    return { itens, cortada: false };
  }

  async requisicao(c: ContextoTransfusao, id: number, agora: string) {
    const q = this.e(c).requisicoes.find((x) => x.id === id);
    return q ? this.lida(c, q, agora, await this.nomes(c), await this.tipagem(c, q.paciente)) : null;
  }

  async atos(
    c: ContextoTransfusao,
    f: { requisicao?: number; ato?: number; paciente?: number; de?: string; ate?: string },
  ): Promise<AtoTransfusionalLido[]> {
    const s = this.e(c);
    return s.atos
      .filter(
        (a) =>
          (f.requisicao === undefined || a.requisicao === f.requisicao) &&
          (f.ato === undefined || a.id === f.ato) &&
          (f.paciente === undefined || a.paciente === f.paciente) &&
          (!f.de || a.inicioEm.slice(0, 10) >= f.de) &&
          (!f.ate || a.inicioEm.slice(0, 10) <= f.ate),
      )
      .reverse()
      .map((a) => {
        const { paciente: _p, atendimento: _t, chave: _k, ...resto } = a;
        void [_p, _t, _k];
        return {
          ...resto,
          sinais: s.sinais
            .filter((x) => x.ato === a.id)
            .map(({ id: _i, ato: _a, chave: _c, usuario: _u, ...x }) => (void [_i, _a, _c, _u], x)),
          reacao: s.reacoes.find((x) => x.ato === a.id)?.id ?? null,
        };
      });
  }

  async reacoes(c: ContextoTransfusao, f: { de?: string; ate?: string; reacao?: number }) {
    const s = this.e(c);
    const nomes = await this.nomes(c);
    return s.reacoes
      .filter(
        (r) =>
          (f.reacao === undefined || r.id === f.reacao) &&
          (!f.de || r.inicioEm.slice(0, 10) >= f.de) &&
          (!f.ate || r.inicioEm.slice(0, 10) <= f.ate),
      )
      .reverse()
      .map((r): ReacaoTransfusionalLida => {
        const a = s.atos.find((x) => x.id === r.ato)!;
        const { paciente, chave: _k, ...resto } = r;
        void _k;
        const p = nomes.get(paciente);
        return {
          ...resto,
          requisicao: a.requisicao,
          paciente: { id: paciente, nome: p?.nome ?? '', prontuario: p?.numero ?? null },
          bolsa: { numero: a.bolsa.numero, hemocomponente: a.bolsa.hemocomponente },
          transfusaoIniciadaEm: a.inicioEm,
        };
      });
  }

  async versoesRequisicao(c: ContextoTransfusao, requisicao: number): Promise<VersaoRequisicaoLida[]> {
    return this.e(c)
      .versoes.filter((v) => v.requisicao === requisicao)
      .map(({ requisicao: _r, ...v }) => (void _r, v));
  }

  async adendos(c: ContextoTransfusao, atos: readonly number[]): Promise<AdendoAtoLido[]> {
    return this.e(c).adendos.filter((a) => atos.includes(a.ato));
  }

  async bolsaUsada(c: ContextoTransfusao, numero: string) {
    return this.e(c).atos.some((a) => a.bolsa.numero === numero.trim().toUpperCase());
  }

  async gravadoPorChave(
    c: ContextoTransfusao,
    o: { tipo: 'requisicao' | 'ato'; chave: string; usuario: string },
  ): Promise<number | null> {
    const s = this.e(c);
    const mesma = (a: string) => a.trim().toUpperCase() === o.usuario.trim().toUpperCase();
    if (o.tipo === 'ato') {
      const a = s.atos.find((x) => x.chave === `${chaveDoEstabelecimento(c)}:${o.chave}:ato`);
      return a && mesma(a.profissional) ? a.id : null;
    }
    const q = s.requisicoes.find((x) => x.chave === `${chaveDoEstabelecimento(c)}:${o.chave}`);
    return q && mesma(q.requisitadaPor) ? q.id : null;
  }

  async pessoa(c: ContextoTransfusao, paciente: number) {
    const n = (await this.nomes(c)).get(paciente);
    return {
      sexo: (paciente % 2 === 0 ? 'F' : 'M') as 'F' | 'M',
      nascimento: '1958-04-12',
      nome: n?.nome ?? '',
    };
  }
}
