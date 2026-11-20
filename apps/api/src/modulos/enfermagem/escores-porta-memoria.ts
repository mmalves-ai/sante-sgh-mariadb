// Porta EM MEMÓRIA dos escores, da classificação e dos índices de UTI (M45, etapa 2): a sessão sintética de dev/ci (E2E
// e testes da API), com as mesmas recusas das gravações SGH_ (a reavaliação com a chave única, a dispensa só da pendente,
// a classificação uma por turno, a validação uma vez). Os pacientes são os da UTI e da enfermaria sintéticas da porta da
// enfermagem (M25); a configuração dos índices é a sintética (a mesma da cópia). Nada é de pessoa real.
import { CONFIGURACAO_INDICES_SINTETICA } from '@sgh/dominio-pep';
import { comVigencia, HORAS_JANELA_ALERTA_TRR } from '@sgh/legado';
import type {
  AcionamentoTrrLidoSgh,
  EventoTrrLidoSgh,
  VersaoPcrLidaSgh,
  ContencaoLidaSgh,
  ClassificacaoLidaSgh,
  EscalaEmFormularioLida,
  EscoreLidoSgh,
  IndiceUtiLidoSgh,
  InternacaoParaEscore,
  OrigemEstorno,
  ReavaliacaoLidaSgh,
  RegraEscoreLida,
  ProtocoloInternadoLido,
  LesaoLidaSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { ContextoEscores, GravadorEscores, PortaEscores, VinculoAssistencial } from './escores-porta.js';
import { gravadorLesaoMemoria, lesoesMemoria } from './lesao-porta-memoria.js';
import { VINCULOS_SINTETICOS } from './porta-memoria.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não gravado', detalhe, { codigo });

/** Os vínculos assistenciais dos logins sintéticos (a enfermagem do M25 e o médico da UTI). */
export const VINCULOS_ESCORES_SINTETICOS: Readonly<Record<string, VinculoAssistencial>> = {
  ...Object.fromEntries(
    Object.entries(VINCULOS_SINTETICOS).map(([login, v]) => [
      login,
      { vinculo: v.cbo, codigoCbo: v.codigo, conselhoAtivo: true },
    ]),
  ),
  'SINT.MEDICO.UTI': { vinculo: 92601, codigoCbo: '225150', conselhoAtivo: true },
};

const p2 = (x: number) => String(x).padStart(2, '0');
const menosHoras = (t: string, h: number) => {
  const d = new Date(Date.parse(`${t.slice(0, 19)}Z`) - h * 3_600_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00`;
};
/** O objeto sem o campo interno da memória (a chave da reavaliação, a unidade da classificação). */
function semCampo<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const r = { ...o };
  delete r[k];
  return r;
}
const comSegundos = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));
const minutosEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate.slice(0, 16)}:00Z`) - Date.parse(`${de.slice(0, 16)}:00Z`)) / 60_000);

interface Estado {
  seq: number;
  escores: EscoreLidoSgh[];
  cuidados: {
    escore: number;
    codigo: string;
    decisao: string;
    motivo: string | null;
    usuario?: string;
    em?: string;
    /** Revisão W0-03: as correções da decisão de profilaxia (a anulação reabre a pendência). */
    retificacoes?: {
      decisao: 'prescrita' | 'nao-prescrita' | 'anulada';
      motivo: string | null;
      justificativa: string;
      usuario: string;
      em: string;
    }[];
  }[];
  reavaliacoes: (ReavaliacaoLidaSgh & { chave: string })[];
  regras: RegraEscoreLida[];
  classificacoes: (ClassificacaoLidaSgh & { unidade: string })[];
  indices: IndiceUtiLidoSgh[];
  sinais: number;
  avisos: { login: string; evento: string; objeto: string; link: string | null; gravidade: string }[];
  /** W0-03, M5: as ordens de contenção, com os horários e as checagens. */
  contencoes: ContencaoLidaSgh[];
  /** W0-03, M2: os acionamentos do TRR (com os registros da chegada e do desfecho) e as versões das fichas de PCR. */
  trr: (AcionamentoTrrLidoSgh & { eventos: EventoTrrLidoSgh[] })[];
  pcr: VersaoPcrLidaSgh[];
  /** W0-03, M3: os protocolos gerenciados do internado, com os eventos. */
  protocolos?: ProtocoloInternadoLido[];
  /** W0-03, M4: as lesões (feridas e LPP), com as versões, os curativos, as fotos e os eventos. */
  lesoes?: LesaoLidaSgh[];
}

/** W0-03, M5: o censo sintético da memória (internados por dia em cada unidade), para o denominador do indicador. */
export const INTERNADOS_POR_DIA_SINTETICOS = 8;
const diasEntre = (de: string, ate: string) =>
  Math.max(
    0,
    Math.round(
      (Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86_400_000,
    ) + 1,
  );

export class PortaEscoresMemoria implements PortaEscores {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly opcoes: { readonly agora?: () => Date } = {}) {}

  private agora(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora;
  }

  /** O estado do estabelecimento (exposto aos testes da API). */
  estado(hospital: string): Estado {
    let s = this.estados.get(hospital);
    if (!s) {
      s = {
        seq: 45_000,
        escores: [],
        cuidados: [],
        reavaliacoes: [],
        regras: [],
        classificacoes: [],
        indices: [],
        sinais: 0,
        avisos: [],
        contencoes: [],
        trr: [],
        pcr: [],
      };
      this.estados.set(hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: false, codigo: 'so-sante', motivo: 'Gravação só no Sante SGH.' };
  }

  async executar(): Promise<never> {
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação pelo executor',
      'Os escores gravam só no Sante SGH.',
    );
  }

  async gravarSgh<T>(
    c: ContextoEscores,
    _trilha: unknown,
    fn: (g: GravadorEscores) => Promise<T>,
  ): Promise<T> {
    const s = this.estado(c.hospital);
    // A "transação" em memória: a cópia de trabalho só vale se nada recusar.
    const copia: Estado = structuredClone(s);
    const g: Omit<
      GravadorEscores,
      | 'incluirProtocoloInternado'
      | 'eventoProtocoloInternado'
      | 'registrarLesao'
      | 'versaoLesao'
      | 'curativoLesao'
      | 'corrigirCurativoLesao'
      | 'fotoLesao'
      | 'encerrarLesao'
      | 'inativarLesao'
    > = {
      registrarEscore: async (x) => {
        const sinais = x.sinais.map(() => ++copia.seq);
        copia.sinais += sinais.length;
        const id = ++copia.seq;
        copia.escores.push({
          id,
          paciente: x.escore.paciente,
          reg: x.escore.reg,
          atendimento: x.escore.atendimento,
          unidade: x.escore.unidade,
          escala: x.escore.escala,
          versaoRegra: x.escore.versaoRegra,
          itens: { ...x.escore.itens },
          total: x.escore.total,
          faixa: x.escore.faixa,
          gatilho: x.escore.gatilho,
          suspeitaInfeccao: x.escore.suspeitaInfeccao,
          origem: x.escore.origem,
          aferidoEm: comSegundos(x.escore.aferidoEm),
          usuario: x.escore.usuario,
        });
        for (const d of x.cuidados)
          copia.cuidados.push({ escore: id, codigo: d.codigo, decisao: d.decisao, motivo: d.motivo ?? null });
        if (x.cumprir)
          for (const r of copia.reavaliacoes)
            if (
              r.paciente === x.escore.paciente &&
              r.escala === x.cumprir.escala &&
              r.situacao === 'pendente' &&
              r.devidaEm <= comSegundos(x.cumprir.quando)
            )
              Object.assign(r, {
                situacao: 'cumprida',
                cumpridaEm: comSegundos(x.cumprir.quando),
                cumpridaPor: 'escore',
                escore: id,
              });
        for (const p of x.programar) {
          const chave = p.chave(id);
          if (
            copia.reavaliacoes.some(
              (r) => r.paciente === p.paciente && r.escala === p.escala && r.chave === chave,
            )
          )
            continue;
          copia.reavaliacoes.push({
            id: ++copia.seq,
            paciente: p.paciente,
            reg: p.reg,
            escala: p.escala,
            motivo: p.motivo,
            devidaEm: comSegundos(p.devidaEm),
            prazoEm: comSegundos(p.prazoEm),
            situacao: 'pendente',
            cumpridaEm: null,
            cumpridaPor: null,
            chave,
          });
        }
        let avisos = 0;
        for (const a of x.avisos) {
          const v = a(id);
          if (
            copia.avisos.some(
              (y) => y.login === v.login && y.evento === v.evento && y.objeto === v.objetoChave,
            )
          )
            continue;
          copia.avisos.push({
            login: v.login,
            evento: v.evento,
            objeto: v.objetoChave,
            link: v.link,
            gravidade: v.gravidade,
          });
          avisos++;
        }
        return { id, sinais, avisos };
      },
      programarReavaliacao: async (r) => {
        if (
          copia.reavaliacoes.some(
            (x) => x.paciente === r.paciente && x.escala === r.escala && x.chave === r.chave,
          )
        )
          throw recusa('ja-programada', 'Esta reavaliação já está programada para o paciente.');
        const id = ++copia.seq;
        copia.reavaliacoes.push({
          id,
          paciente: r.paciente,
          reg: r.reg,
          escala: r.escala,
          motivo: r.motivo,
          devidaEm: comSegundos(r.devidaEm),
          prazoEm: comSegundos(r.prazoEm),
          situacao: 'pendente',
          cumpridaEm: null,
          cumpridaPor: null,
          chave: r.chave,
        });
        return id;
      },
      dispensarReavaliacao: async (d) => {
        const r = copia.reavaliacoes.find((x) => x.id === d.id);
        if (!r) throw recusa('nao-encontrado', 'A reavaliação não existe neste estabelecimento.');
        if (r.situacao !== 'pendente')
          throw recusa('reavaliacao-encerrada', 'Esta reavaliação já foi cumprida ou dispensada.');
        Object.assign(r, { situacao: 'dispensada', cumpridaEm: comSegundos(d.quando) });
        return { paciente: r.paciente };
      },
      publicarRegra: async (p) => {
        const versao =
          Math.max(1, ...copia.regras.filter((r) => r.escala === p.escala).map((r) => r.versao)) + 1;
        const id = ++copia.seq;
        copia.regras.push({
          id,
          escala: p.escala,
          versao,
          faixas: structuredClone(p.faixas),
          impressao: p.impressao,
          notas: p.notas,
          autor: p.autor,
          publicadoEm: this.agora(),
        });
        return { id, versao };
      },
      classificar: async (x) => {
        if (
          copia.classificacoes.some(
            (y) =>
              y.paciente === x.paciente &&
              y.reg === x.reg &&
              y.data === x.data &&
              y.turno === x.turno &&
              y.instrumento === x.instrumento &&
              !y.estorno,
          )
        )
          throw recusa(
            'ja-classificado',
            'Este paciente já foi classificado por este instrumento neste turno.',
          );
        const id = ++copia.seq;
        copia.classificacoes.push({
          id,
          paciente: x.paciente,
          reg: x.reg,
          instrumento: x.instrumento,
          itens: { ...x.itens },
          total: x.total,
          categoria: x.categoria,
          horas24h: x.horas24h,
          usuario: x.usuario,
          criadoEm: this.agora(),
          data: x.data,
          turno: x.turno,
          unidade: x.unidade,
        });
        return id;
      },
      registrarIndice: async (x) => {
        const id = ++copia.seq;
        copia.indices.push({
          id,
          paciente: x.paciente,
          reg: x.reg,
          indice: x.indice,
          variaveis: structuredClone(x.variaveis),
          pontuacao: x.pontuacao,
          categoria: x.categoria,
          tipoAdmissao: x.tipoAdmissao,
          mortalidade: x.mortalidade === null ? null : Math.round(x.mortalidade * 10_000) / 10_000,
          impressaoConfig: x.impressaoConfig,
          coletadoEm: comSegundos(x.coletadoEm),
          registradoPor: x.usuario,
          situacao: 'registrado',
          validadoPor: null,
          validadoEm: null,
        });
        return id;
      },
      estornarRegistro: async (x) => {
        const lista: { id: number; paciente: number; estorno?: unknown }[] =
          x.origem === 'escore'
            ? copia.escores
            : x.origem === 'classificacao'
              ? copia.classificacoes
              : copia.indices;
        const o = lista.find((y) => y.id === x.id);
        if (!o) throw recusa('registro-inexistente', 'O registro não foi encontrado.');
        if (o.paciente !== x.paciente)
          throw recusa('registro-de-outro-paciente', 'O registro não é deste paciente.');
        if (o.estorno) throw recusa('registro-ja-estornado', 'O registro já foi estornado.');
        Object.assign(o, {
          estorno: {
            tipo: x.tipo,
            motivo: x.motivo,
            usuario: x.usuario,
            em: this.agora(),
            alerta: x.origem === 'escore' ? x.alerta : null,
            escoreMantem: x.escoreMantem,
          },
        });
        // Revisão: como reabrirReavaliacoesDoEscoreSgh — a baixa fica; linha nova cumprida pelo escore válido seguinte
        // da mesma escala (aferido depois do vencimento) ou pendente outra vez.
        if (x.origem === 'escore')
          for (const r of copia.reavaliacoes.filter((y) => y.situacao === 'cumprida' && y.escore === x.id)) {
            const sub = copia.escores
              .filter(
                (y) =>
                  y.paciente === r.paciente &&
                  y.escala === r.escala &&
                  y.id !== x.id &&
                  !y.estorno &&
                  y.aferidoEm >= r.devidaEm,
              )
              .sort((a, b) => a.aferidoEm.localeCompare(b.aferidoEm) || a.id - b.id)[0];
            copia.reavaliacoes.push({
              ...r,
              id: ++copia.seq,
              chave: `${r.chave}:r${r.id}`.slice(-60),
              situacao: sub ? 'cumprida' : 'pendente',
              cumpridaEm: sub ? sub.aferidoEm : null,
              cumpridaPor: sub ? 'escore' : null,
              escore: sub ? sub.id : null,
            });
          }
        return ++copia.seq;
      },
      decidirProfilaxia: async (d) => {
        const e = copia.escores.find((y) => y.id === d.escore);
        if (!e) throw recusa('escore-inexistente', 'O escore não foi encontrado.');
        if (e.paciente !== d.paciente)
          throw recusa('escore-de-outro-paciente', 'O escore não é deste paciente.');
        if ((e.escala !== 'caprini' && e.escala !== 'padua') || e.gatilho !== 'profilaxia')
          throw recusa('sem-profilaxia-sugerida', 'Este escore não sugere profilaxia de TEV.');
        if (e.estorno)
          throw recusa('escore-estornado', 'O escore foi estornado: não há profilaxia a decidir.');
        const ja = copia.cuidados.find((c) => c.escore === d.escore && c.codigo === 'profilaxiaTev');
        if (ja) {
          // Revisão W0-03: depois da anulação, a nova decisão entra como retificação.
          if (ja.retificacoes?.at(-1)?.decisao !== 'anulada')
            throw recusa('profilaxia-ja-decidida', 'A profilaxia deste escore já foi decidida.');
          ja.retificacoes.push({
            decisao: d.decisao,
            motivo: d.motivo,
            justificativa: 'Nova decisão depois da anulação da anterior.',
            usuario: d.usuario,
            em: this.agora(),
          });
          return ++copia.seq;
        }
        copia.cuidados.push({
          escore: d.escore,
          codigo: 'profilaxiaTev',
          decisao: d.decisao === 'prescrita' ? 'aceito' : 'recusado',
          motivo: d.motivo,
          usuario: d.usuario,
          em: this.agora(),
        });
        return ++copia.seq;
      },
      retificarProfilaxia: async (r) => {
        const e = copia.escores.find((y) => y.id === r.escore);
        if (!e) throw recusa('escore-inexistente', 'O escore não foi encontrado.');
        if (e.estorno)
          throw recusa('escore-estornado', 'O escore foi estornado: não há profilaxia a decidir.');
        const c = copia.cuidados.find((x) => x.escore === r.escore && x.codigo === 'profilaxiaTev');
        if (!c) throw recusa('profilaxia-nao-decidida', 'A profilaxia deste escore ainda não foi decidida.');
        const v = c.retificacoes?.at(-1) ?? {
          decisao: c.decisao === 'aceito' ? 'prescrita' : 'nao-prescrita',
          motivo: c.motivo,
          usuario: c.usuario ?? '',
        };
        if (v.decisao === 'anulada')
          throw recusa(
            'profilaxia-anulada',
            'A decisão foi anulada: a pendência está aberta para uma nova decisão.',
          );
        if (v.usuario !== r.usuario)
          throw recusa('so-o-autor', 'Só quem decidiu corrige a decisão (fato novo, com a justificativa).');
        if (r.decisao === v.decisao && (r.motivo ?? null) === v.motivo)
          throw recusa('sem-mudanca', 'Nada mudou em relação à decisão vigente.');
        c.retificacoes = [
          ...(c.retificacoes ?? []),
          {
            decisao: r.decisao,
            motivo: r.decisao === 'nao-prescrita' ? r.motivo : null,
            justificativa: r.justificativa,
            usuario: r.usuario,
            em: this.agora(),
          },
        ];
        return ++copia.seq;
      },
      prescreverContencao: async (o) => {
        if (o.horarios.length === 0 || o.horarios.some((h) => h.slice(0, 16) <= o.inicio.slice(0, 16)))
          throw recusa('aprazamento-invalido', 'Os horários da checagem são posteriores ao início.');
        if (o.anterior !== null) {
          const a = copia.contencoes.find((x) => x.id === o.anterior);
          if (!a) throw recusa('contencao-inexistente', 'A ordem a renovar não foi encontrada.');
          if (a.atendimento !== o.atendimento)
            throw recusa('contencao-de-outro-atendimento', 'A ordem a renovar é de outro atendimento.');
          if (a.encerramento) throw recusa('contencao-encerrada', 'A contenção já foi encerrada.');
          if (a.renovadaPor !== null) throw recusa('contencao-ja-renovada', 'Esta ordem já foi renovada.');
        } else if (
          copia.contencoes.some(
            (x) =>
              x.atendimento === o.atendimento &&
              !x.encerramento &&
              x.renovadaPor === null &&
              (x.horarios.at(-1)?.previsto ?? x.inicio.slice(0, 16)) > o.inicio.slice(0, 16),
          )
        )
          throw recusa(
            'contencao-em-curso',
            'Já há uma ordem de contenção em curso neste atendimento: renove-a ou retire-a antes.',
          );
        const id = ++copia.seq;
        copia.contencoes.push({
          id,
          paciente: o.paciente,
          atendimento: o.atendimento,
          unidade: o.unidade,
          motivo: o.motivo,
          justificativa: o.justificativa,
          tipo: o.tipo,
          membros: [...o.membros],
          prazoHoras: o.prazoHoras,
          intervaloMinutos: o.intervaloMinutos,
          inicio: comSegundos(o.inicio),
          anterior: o.anterior,
          renovadaPor: null,
          prescritor: o.prescritor,
          criadoEm: this.agora(),
          encerramento: null,
          horarios: o.horarios.map((h) => ({ id: ++copia.seq, previsto: h.slice(0, 16), checagem: null })),
        });
        if (o.anterior !== null) {
          const a = copia.contencoes.find((x) => x.id === o.anterior)!;
          Object.assign(a, { renovadaPor: id, renovadaEm: comSegundos(o.inicio) });
        }
        return id;
      },
      checarContencao: async (k) => {
        const o = copia.contencoes.find((x) => x.id === k.contencao);
        if (!o) throw recusa('contencao-inexistente', 'A ordem de contenção não foi encontrada.');
        if (o.encerramento?.tipo === 'inativacao')
          throw recusa('contencao-inativada', 'A ordem foi inativada: não há checagem a registrar.');
        if (o.encerramento && k.previsto.slice(0, 16) > o.encerramento.em.slice(0, 16))
          throw recusa(
            'horario-cancelado',
            'A contenção foi retirada antes deste horário: a checagem foi cancelada.',
          );
        if (o.renovadaPor !== null && o.renovadaEm && k.previsto.slice(0, 16) > o.renovadaEm.slice(0, 16))
          throw recusa(
            'horario-da-renovacao',
            'A ordem foi renovada antes deste horário: a checagem é registrada na ordem nova.',
          );
        const h = o.horarios.find((x) => x.previsto === k.previsto.slice(0, 16));
        if (!h) throw recusa('horario-inexistente', 'O horário não é um dos aprazados pela ordem.');
        if (h.checagem) throw recusa('checagem-ja-feita', 'Este horário já foi checado.');
        const alterado = Object.values(k.achados).includes('alterado');
        Object.assign(h, {
          checagem: {
            achados: { ...k.achados },
            alterado,
            observacao: k.observacao,
            usuario: k.usuario,
            feitaEm: this.agora(),
          },
        });
        return ++copia.seq;
      },
      adendoChecagemContencao: async (x) => {
        const o = copia.contencoes.find((y) => y.id === x.contencao);
        const h = o?.horarios.find((y) => y.previsto === x.previsto.slice(0, 16));
        if (!h?.checagem)
          throw recusa('checagem-inexistente', 'Este horário ainda não foi checado: não há o que corrigir.');
        if (h.checagem.usuario !== x.usuario)
          throw recusa(
            'so-o-autor',
            'Só quem registrou a checagem faz o adendo (correção do próprio registro).',
          );
        const alterado = Object.values(x.achados).includes('alterado');
        Object.assign(h.checagem, {
          adendos: [
            ...(h.checagem.adendos ?? []),
            {
              achados: { ...x.achados },
              alterado,
              observacao: x.observacao,
              motivo: x.motivo,
              usuario: x.usuario,
              em: this.agora(),
            },
          ],
        });
        return ++copia.seq;
      },
      encerrarContencao: async (x) => {
        const o = copia.contencoes.find((y) => y.id === x.contencao);
        if (!o) throw recusa('contencao-inexistente', 'A ordem de contenção não foi encontrada.');
        if (o.renovadaPor !== null)
          throw recusa(
            'contencao-renovada',
            'Esta ordem foi renovada: encerre a ordem vigente (a renovação).',
          );
        if (o.encerramento) throw recusa('contencao-ja-encerrada', 'Esta ordem já foi encerrada.');
        if (x.tipo === 'inativacao' && o.prescritor !== x.usuario)
          throw recusa('so-o-autor', 'Só quem lançou a ordem a inativa (lançamento errado).');
        Object.assign(o, {
          encerramento: { tipo: x.tipo, motivo: x.motivo, usuario: x.usuario, em: this.agora() },
        });
        // Revisão W0-03: a renovação inativada não conta — a anterior volta a ser a vigente.
        if (x.tipo === 'inativacao')
          for (const a of copia.contencoes)
            if (a.renovadaPor === o.id) Object.assign(a, { renovadaPor: null, renovadaEm: null });
        return ++copia.seq;
      },
      acionarTrr: async (a) => {
        let alertaEm: string | null = null;
        if (a.escore !== null) {
          const x = copia.escores.find((y) => y.id === a.escore);
          if (!x) throw recusa('escore-inexistente', 'O alerta não foi encontrado.');
          if (x.paciente !== a.paciente)
            throw recusa('escore-de-outro-paciente', 'O alerta não é deste paciente.');
          if (x.gatilho !== 'trr')
            throw recusa('sem-gatilho-trr', 'Este escore não aciona o Time de Resposta Rápida.');
          if (x.atendimento !== undefined && x.atendimento !== null && x.atendimento !== a.atendimento)
            throw recusa('escore-de-outro-atendimento', 'O alerta é de outro atendimento do paciente.');
          if (x.estorno) throw recusa('escore-estornado', 'O escore do alerta foi estornado.');
          if (copia.trr.some((t) => t.escore === a.escore))
            throw recusa('trr-ja-acionado', 'O time já foi acionado por este alerta.');
          alertaEm = x.aferidoEm.slice(0, 16);
          if (minutosEntre(alertaEm, a.acionadoEm) > HORAS_JANELA_ALERTA_TRR * 60)
            throw recusa('alerta-fora-da-janela', 'O alerta passou da janela: acione à mão, com o motivo.');
        } else if (!a.motivo) throw recusa('motivo-obrigatorio', 'Sem o alerta do escore, informe o motivo.');
        const id = ++copia.seq;
        copia.trr.push({
          id,
          paciente: a.paciente,
          atendimento: a.atendimento,
          unidade: a.unidade,
          uti: a.uti,
          origem: a.escore === null ? 'manual' : 'escore',
          escore: a.escore,
          alertaEm,
          acionadoEm: a.acionadoEm.slice(0, 16),
          motivo: a.motivo,
          usuario: a.usuario,
          chegadaEm: null,
          desfecho: null,
          inativacao: null,
          eventos: [],
        });
        return { id, alertaEm };
      },
      eventoTrr: async (x) => {
        const t = copia.trr.find((y) => y.id === x.trr);
        if (!t) throw recusa('trr-inexistente', 'O acionamento não foi encontrado.');
        if (t.inativacao) throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
        if (x.em.slice(0, 16) < t.acionadoEm)
          throw recusa('antes-do-acionamento', 'A hora é anterior ao acionamento do time.');
        const u = t.eventos.filter((v) => v.tipo === x.tipo).at(-1);
        if (u && !u.inativacao)
          throw recusa(
            'evento-ja-registrado',
            x.tipo === 'chegada' ? 'A chegada do time já foi registrada.' : 'O desfecho já foi registrado.',
          );
        const id = ++copia.seq;
        t.eventos.push({
          id,
          tipo: x.tipo,
          seq: (u?.seq ?? 0) + 1,
          em: x.em.slice(0, 16),
          desfecho: x.tipo === 'desfecho' ? x.desfecho : null,
          usuario: x.usuario,
          motivo: null,
          anterior: null,
          inativacao: null,
          vigente: false,
        });
        return id;
      },
      retificarEventoTrr: async (x) => {
        const t = copia.trr.find((y) => y.eventos.some((v) => v.id === x.evento));
        if (!t) throw recusa('evento-inexistente', 'O registro do time não foi encontrado.');
        if (t.inativacao) throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
        const ev = t.eventos.find((v) => v.id === x.evento)!;
        const u = t.eventos.filter((v) => v.tipo === ev.tipo).at(-1)!;
        if (u.id !== ev.id || u.inativacao)
          throw recusa('evento-nao-vigente', 'Este registro já foi corrigido ou inativado: abra o vigente.');
        if (u.usuario !== x.usuario)
          throw recusa('so-o-autor', 'Só quem registrou corrige (versão nova com o motivo).');
        const em = (x.em ?? u.em).slice(0, 16);
        if (em < t.acionadoEm)
          throw recusa('antes-do-acionamento', 'A hora é anterior ao acionamento do time.');
        if (em > x.agora.slice(0, 16)) throw recusa('hora-no-futuro', 'A hora corrigida é do futuro.');
        const desfecho = ev.tipo === 'desfecho' ? (x.desfecho ?? u.desfecho) : null;
        if (em === u.em && desfecho === u.desfecho)
          throw recusa('sem-mudanca', 'Nada mudou em relação ao registro vigente.');
        const id = ++copia.seq;
        t.eventos.push({
          id,
          tipo: ev.tipo,
          seq: u.seq + 1,
          em,
          desfecho,
          usuario: x.usuario,
          motivo: x.motivo,
          anterior: u.id,
          inativacao: null,
          vigente: false,
        });
        return { id, trr: t.id, tipo: ev.tipo };
      },
      inativarTrr: async (x) => {
        const inativacao = { motivo: x.motivo, usuario: x.usuario, em: this.agora().slice(0, 16) };
        if (x.origem === 'trr') {
          const t = copia.trr.find((y) => y.id === x.id);
          if (!t) throw recusa('trr-inexistente', 'O acionamento não foi encontrado.');
          if (t.usuario !== x.usuario)
            throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
          const fichas = copia.pcr.filter(
            (p) => p.trr === t.id && !p.inativacao && !copia.pcr.some((s) => s.anterior === p.id),
          ).length;
          if (fichas > 0)
            throw recusa(
              'trr-com-ficha',
              `O acionamento tem ${fichas} ficha(s) de parada vigente(s): inative a ficha antes do acionamento.`,
            );
          if (t.inativacao) throw recusa('ja-inativado', 'O registro já foi inativado.');
          Object.assign(t, { inativacao });
          return { id: ++copia.seq, paciente: t.paciente };
        }
        if (x.origem === 'evento') {
          const t = copia.trr.find((y) => y.eventos.some((v) => v.id === x.id));
          if (!t) throw recusa('evento-inexistente', 'O registro do time não foi encontrado.');
          const ev = t.eventos.find((v) => v.id === x.id)!;
          const u = t.eventos.filter((v) => v.tipo === ev.tipo).at(-1)!;
          if (u.id !== ev.id || u.inativacao)
            throw recusa(
              'evento-nao-vigente',
              'Este registro já foi corrigido ou inativado: abra o vigente.',
            );
          if (u.usuario !== x.usuario)
            throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
          Object.assign(ev, { inativacao });
          return { id: ++copia.seq, paciente: t.paciente };
        }
        const p = copia.pcr.find((y) => y.id === x.id);
        if (!p) throw recusa('pcr-inexistente', 'A ficha da parada não foi encontrada.');
        if (copia.pcr.some((y) => y.anterior === p.id))
          throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
        if (p.autor !== x.usuario)
          throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
        if (p.inativacao) throw recusa('ja-inativado', 'O registro já foi inativado.');
        Object.assign(p, { inativacao });
        return { id: ++copia.seq, paciente: p.paciente };
      },
      gravarFichaPcr: async (f) => {
        let versao = 1;
        let unidade = f.unidade;
        let uti = f.uti;
        let motivo: string | null = null;
        if (f.anterior !== null) {
          const a = copia.pcr.find((y) => y.id === f.anterior);
          if (!a) throw recusa('pcr-inexistente', 'A ficha da parada não foi encontrada.');
          if (a.atendimento !== f.atendimento)
            throw recusa('pcr-de-outro-atendimento', 'A ficha é de outro atendimento.');
          if (a.autor !== f.autor) throw recusa('so-o-autor', 'Só o autor da ficha a continua ou corrige.');
          if (a.inativacao)
            throw recusa('pcr-inativada', 'A ficha foi inativada (lançada errada): relance uma ficha nova.');
          if (copia.pcr.some((y) => y.anterior === a.id))
            throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
          if (a.situacao === 'finalizada') {
            motivo = (f.motivo ?? '').replace(/\s+/g, ' ').trim();
            if (motivo.length < 10)
              throw recusa('motivo-obrigatorio', 'A correção da ficha finalizada exige a justificativa.');
            if (f.situacao !== 'finalizada')
              throw recusa(
                'correcao-finaliza',
                'A correção da ficha finalizada é gravada finalizada (a ficha não volta a rascunho).',
              );
          }
          versao = a.versao + 1;
          unidade = a.unidade;
          uti = a.uti;
        } else if (f.trr !== null) {
          const t = copia.trr.find((y) => y.id === f.trr);
          if (t?.atendimento !== f.atendimento)
            throw recusa('trr-de-outro-atendimento', 'O acionamento do time é de outro atendimento.');
          if (t.inativacao) throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
          if (
            copia.pcr.some(
              (p) => p.trr === t.id && !p.inativacao && !copia.pcr.some((s) => s.anterior === p.id),
            )
          )
            throw recusa(
              'pcr-ja-aberta',
              'Este acionamento já tem a ficha da parada: abra a ficha existente.',
            );
          unidade = t.unidade;
          uti = t.uti;
        }
        const id = ++copia.seq;
        copia.pcr.push({
          id,
          paciente: f.paciente,
          atendimento: f.atendimento,
          unidade,
          uti,
          trr: f.trr,
          anterior: f.anterior,
          versao,
          situacao: f.situacao,
          colapsoEm: f.colapsoEm.slice(0, 16),
          dados: f.dados,
          autor: f.autor,
          criadoEm: this.agora(),
          motivo,
          inativacao: null,
        });
        return { id, versao };
      },
      avisar: async (xs) => {
        let k = 0;
        for (const a of xs) {
          if (
            copia.avisos.some(
              (y) => y.login === a.login && y.evento === a.evento && y.objeto === a.objetoChave,
            )
          )
            continue;
          copia.avisos.push({
            login: a.login,
            evento: a.evento,
            objeto: a.objetoChave,
            link: a.link,
            gravidade: a.gravidade,
          });
          k++;
        }
        return k;
      },
      validarIndice: async (v) => {
        const i = copia.indices.find((x) => x.id === v.id);
        if (!i) throw recusa('nao-encontrado', 'O índice não existe neste estabelecimento.');
        if (i.estorno)
          throw recusa(
            'indice-estornado',
            'Este índice foi estornado ou invalidado e não pode ser validado.',
          );
        if (i.situacao !== 'registrado') throw recusa('ja-validado', 'Este índice já foi validado.');
        Object.assign(i, {
          situacao: 'validado',
          validadoPor: v.validadoPor,
          validadoEm: comSegundos(v.quando),
        });
        return { paciente: i.paciente };
      },
    };
    // W0-03, M3: as mesmas recusas da gravação SGH_ (a versão é conferida pelo serviço contra as publicadas).
    const incluirProtocoloInternado: GravadorEscores['incluirProtocoloInternado'] = async (p) => {
      const ps = (copia.protocolos ??= []);
      if (p.origem === 'news2' && (p.escore === null || p.tipo !== 'sepse'))
        throw recusa('escore-obrigatorio', 'O alerta do NEWS2 abre o protocolo de sepse, com o escore.');
      const fechado = (x: ProtocoloInternadoLido) =>
        x.eventos.some((e) => e.tipo === 'encerramento' || e.tipo === 'inativacao');
      if (ps.some((x) => x.atendimento === p.atendimento && x.tipo === p.tipo && !fechado(x)))
        throw recusa('protocolo-ja-aberto', 'O paciente já está neste protocolo neste atendimento.');
      if (p.escore !== null && ps.some((x) => x.escore === p.escore && x.tipo === p.tipo))
        throw recusa('alerta-ja-usado', 'Este alerta do NEWS2 já abriu o protocolo de sepse.');
      const id = ++copia.seq;
      ps.push({
        id,
        paciente: p.paciente,
        atendimento: p.atendimento,
        unidade: p.unidade,
        local: p.local,
        tipo: p.tipo,
        gerenciado: p.gerenciado,
        origem: p.origem,
        escore: p.escore,
        criterios: [...p.criterios],
        observacao: p.observacao,
        reconhecidoEm: comSegundos(p.reconhecidoEm),
        incluidoEm: this.agora(),
        incluidoPor: p.autor,
        eventos: [],
      });
      return id;
    };
    const eventoProtocoloInternado: GravadorEscores['eventoProtocoloInternado'] = async (x) => {
      const p = (copia.protocolos ?? []).find((y) => y.id === x.protocolo);
      if (!p)
        throw recusa('protocolo-inexistente', 'O protocolo do paciente não existe neste estabelecimento.');
      if (p.eventos.some((e) => e.tipo === 'inativacao'))
        throw recusa(
          x.tipoEvento === 'inativacao' ? 'ja-inativado' : 'protocolo-inativado',
          'Esta inclusão foi inativada (lançada por engano): nada mais se registra nela.',
        );
      if (p.eventos.some((e) => e.tipo === 'encerramento') && x.tipoEvento !== 'inativacao')
        throw recusa(
          x.tipoEvento === 'encerramento' ? 'ja-encerrado' : 'protocolo-encerrado',
          'O protocolo deste paciente já foi encerrado.',
        );
      if (p.eventos.some((e) => e.tipo === x.tipoEvento && e.codigo === x.codigo))
        throw recusa(
          'ja-registrado',
          'Este item do protocolo já foi registrado. Abra de novo para ver o registro.',
        );
      const id = ++copia.seq;
      p.eventos.push({
        id,
        tipo: x.tipoEvento,
        codigo: x.codigo,
        situacao: x.situacao,
        quando: x.ocorridoEm ? comSegundos(x.ocorridoEm) : null,
        prazoEm: x.prazoEm ? comSegundos(x.prazoEm) : null,
        motivo: x.motivo,
        por: x.por,
        em: this.agora(),
      });
      return id;
    };
    const r = await fn({
      ...g,
      incluirProtocoloInternado,
      eventoProtocoloInternado,
      ...gravadorLesaoMemoria(copia, () => this.agora()),
    });
    this.estados.set(c.hospital, copia);
    return r;
  }

  async regras(c: ContextoEscores) {
    return [...this.estado(c.hospital).regras].sort(
      (a, b) => a.escala.localeCompare(b.escala) || b.versao - a.versao,
    );
  }

  async escores(c: ContextoEscores, pacientes: readonly number[], desde: string) {
    const ps = new Set(pacientes);
    return this.estado(c.hospital)
      .escores.filter((e) => ps.has(e.paciente) && e.aferidoEm >= comSegundos(desde))
      .sort((a, b) => b.aferidoEm.localeCompare(a.aferidoEm) || b.id - a.id);
  }

  async ultimosEscores(c: ContextoEscores, pacientes: readonly number[], desde: string) {
    const vistos = new Set<string>();
    return (await this.escores(c, pacientes, desde)).filter((e) => {
      if (e.estorno) return false;
      const k = `${e.paciente}:${e.escala}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  async reavaliacoes(c: ContextoEscores, pacientes: readonly number[], desde: string) {
    const ps = new Set(pacientes);
    return this.estado(c.hospital)
      .reavaliacoes.filter(
        (r) =>
          ps.has(r.paciente) && (r.situacao === 'pendente' || (r.cumpridaEm ?? '') >= comSegundos(desde)),
      )
      .map((r) => semCampo(r, 'chave'));
  }

  /** O formulário de Braden registrado ontem no prontuário pelo paciente UM (o cumprimento pelo formulário). */
  async escalasEmFormulario(
    _c: ContextoEscores,
    pacientes: readonly number[],
  ): Promise<EscalaEmFormularioLida[]> {
    return pacientes.includes(25_001)
      ? [
          {
            registro: 45_901,
            paciente: 25_001,
            modelo: 'ENF021',
            escala: 'braden',
            quando: menosHoras(this.agora(), 30),
            total: 14,
            faixaFormulario: null,
          },
        ]
      : [];
  }

  /** As internações sintéticas: a do paciente QUATRO entrou há 2 horas (a admissão ainda no prazo); as outras, há 30. */
  async internacoes(_c: ContextoEscores, regs: readonly number[]): Promise<InternacaoParaEscore[]> {
    return regs.map((reg) => ({
      reg,
      entrada: menosHoras(this.agora(), reg === 25_204 ? 2 : 30),
      alta: null,
      motivoAlta: null,
    }));
  }

  async classificacoes(c: ContextoEscores, unidade: string, data: string, turno: string) {
    return this.estado(c.hospital)
      .classificacoes.filter((x) => x.unidade === unidade && x.data === data && x.turno === turno)
      .map((x) => semCampo(x, 'unidade'));
  }

  async configuracaoIndices() {
    return CONFIGURACAO_INDICES_SINTETICA;
  }

  async indicesDoPaciente(c: ContextoEscores, paciente: number) {
    return this.estado(c.hospital)
      .indices.filter((i) => i.paciente === paciente)
      .sort((a, b) => b.coletadoEm.localeCompare(a.coletadoEm) || b.id - a.id);
  }

  async apachesDoPeriodo(c: ContextoEscores, de: string, ate: string) {
    return this.estado(c.hospital).indices.filter(
      (i) =>
        i.indice === 'apache2' &&
        i.situacao === 'validado' &&
        !i.estorno &&
        i.coletadoEm.slice(0, 10) >= de &&
        i.coletadoEm.slice(0, 10) <= ate,
    );
  }

  async vinculo(_c: ContextoEscores, login: string) {
    return VINCULOS_ESCORES_SINTETICOS[login] ?? null;
  }

  async decisoesProfilaxia(c: ContextoEscores, escores: readonly number[]) {
    const ids = new Set(escores);
    return this.estado(c.hospital)
      .cuidados.filter((x) => x.codigo === 'profilaxiaTev' && ids.has(x.escore))
      .map((x) => {
        const historico = [
          {
            decisao: x.decisao === 'aceito' ? ('prescrita' as const) : ('nao-prescrita' as const),
            motivo: x.motivo,
            justificativa: null,
            usuario: x.usuario ?? '',
            em: x.em ?? '',
          },
          ...(x.retificacoes ?? []),
        ];
        const v = historico.at(-1)!;
        const ultima = [...historico].reverse().find((y) => y.decisao !== 'anulada')!;
        return {
          escore: x.escore,
          decisao: ultima.decisao === 'prescrita' ? ('prescrita' as const) : ('nao-prescrita' as const),
          motivo: v.decisao === 'anulada' ? ultima.motivo : v.motivo,
          usuario: v.usuario,
          em: v.em,
          anulada: v.decisao === 'anulada',
          historico: structuredClone(historico),
        };
      });
  }

  async registroParaEstorno(c: ContextoEscores, origem: OrigemEstorno, id: number) {
    const e = this.estado(c.hospital);
    if (origem === 'escore') {
      const x = e.escores.find((y) => y.id === id);
      return x
        ? {
            id,
            paciente: x.paciente,
            usuario: x.usuario,
            escala: x.escala,
            gatilho: x.gatilho,
            quando: x.aferidoEm,
            estornado: !!x.estorno,
          }
        : null;
    }
    if (origem === 'classificacao') {
      const x = e.classificacoes.find((y) => y.id === id);
      return x
        ? {
            id,
            paciente: x.paciente,
            usuario: x.usuario,
            escala: x.instrumento,
            gatilho: null,
            quando: x.criadoEm,
            estornado: !!x.estorno,
          }
        : null;
    }
    const x = e.indices.find((y) => y.id === id);
    return x
      ? {
          id,
          paciente: x.paciente,
          usuario: x.registradoPor,
          escala: x.indice,
          gatilho: null,
          quando: x.coletadoEm,
          estornado: !!x.estorno,
        }
      : null;
  }

  async contencoes(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; unidade?: string; desde: string; ate?: string; abertas?: boolean },
  ) {
    const ats = f.atendimentos ? new Set(f.atendimentos) : null;
    return structuredClone(
      this.estado(c.hospital)
        .contencoes.filter(
          (x) =>
            (!ats || ats.has(x.atendimento)) &&
            (!f.unidade || x.unidade === f.unidade) &&
            (x.inicio.slice(0, 16) >= f.desde.slice(0, 16) ||
              (f.abertas === true && !x.encerramento && x.renovadaPor === null)) &&
            (!f.ate || x.inicio.slice(0, 16) < f.ate.slice(0, 16)),
        )
        .sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : b.id - a.id)),
    );
  }

  async protocolosInternados(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; escores?: readonly number[]; desde?: string; ate?: string },
  ): Promise<ProtocoloInternadoLido[]> {
    const ats = f.atendimentos ? new Set(f.atendimentos) : null;
    const escs = f.escores ? new Set(f.escores) : null;
    return structuredClone(
      (this.estado(c.hospital).protocolos ?? [])
        .filter(
          (x) =>
            (!ats || ats.has(x.atendimento)) &&
            (!escs || (x.escore !== null && escs.has(x.escore))) &&
            (!f.desde || x.incluidoEm.slice(0, 16) >= f.desde.slice(0, 16)) &&
            (!f.ate || x.incluidoEm.slice(0, 16) < f.ate.slice(0, 16)),
        )
        .sort((a, b) => (a.incluidoEm < b.incluidoEm ? 1 : a.incluidoEm > b.incluidoEm ? -1 : b.id - a.id)),
    );
  }

  async protocoloInternado(c: ContextoEscores, id: number): Promise<ProtocoloInternadoLido | null> {
    const x = (this.estado(c.hospital).protocolos ?? []).find((y) => y.id === id);
    return x ? structuredClone(x) : null;
  }

  async contencao(c: ContextoEscores, id: number) {
    const x = this.estado(c.hospital).contencoes.find((y) => y.id === id);
    return x
      ? {
          id: x.id,
          paciente: x.paciente,
          atendimento: x.atendimento,
          unidade: x.unidade,
          inicio: x.inicio,
          prazoHoras: x.prazoHoras,
          intervaloMinutos: x.intervaloMinutos,
          prescritor: x.prescritor,
          encerramento: x.encerramento ? { tipo: x.encerramento.tipo, em: x.encerramento.em } : null,
          renovadaPor: x.renovadaPor,
          renovadaEm: x.renovadaEm ?? null,
        }
      : null;
  }

  /** O censo sintético: oito internados por dia em cada unidade (só a memória de dev/ci). */
  async pacientesDia(_c: ContextoEscores, _unidade: string, de: string, ate: string) {
    const dias = diasEntre(de, ate);
    return { pacientesDia: dias * INTERNADOS_POR_DIA_SINTETICOS, diasFechados: dias };
  }

  async acionamentosTrr(c: ContextoEscores, f: { unidade?: string; desde: string; ate?: string }) {
    const s = this.estado(c.hospital);
    return structuredClone(
      s.trr
        .filter(
          (t) =>
            (!f.unidade || t.unidade === f.unidade) &&
            t.acionadoEm >= f.desde.slice(0, 16) &&
            (!f.ate || t.acionadoEm < f.ate.slice(0, 16)),
        )
        .sort((a, b) => (a.acionadoEm < b.acionadoEm ? 1 : -1))
        .map((t) => {
          const eventos = comVigencia(t.eventos);
          const chegada = eventos.find((v) => v.tipo === 'chegada' && v.vigente);
          const desfecho = eventos.find((v) => v.tipo === 'desfecho' && v.vigente);
          return {
            ...t,
            eventos,
            chegadaEm: chegada?.em ?? null,
            desfecho: desfecho?.desfecho ?? null,
            escoreEstornado: t.escore !== null && !!s.escores.find((e) => e.id === t.escore)?.estorno,
          };
        }),
    );
  }

  async acionamentosDosEscores(c: ContextoEscores, escores: readonly number[]) {
    const ids = new Set(escores);
    return this.estado(c.hospital)
      .trr.filter((t) => t.escore !== null && ids.has(t.escore))
      .map((t) => ({ escore: t.escore!, trr: t.id, acionadoEm: t.acionadoEm, inativo: !!t.inativacao }));
  }

  async escoresComTrr(c: ContextoEscores, escores: readonly number[]) {
    const ids = new Set(escores);
    return new Set(
      this.estado(c.hospital)
        .trr.filter((t) => t.escore !== null && ids.has(t.escore))
        .map((t) => t.escore!),
    );
  }

  async versoesPcr(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; unidade?: string; desde?: string; ate?: string },
  ) {
    if (f.id !== undefined) return structuredClone(this.estado(c.hospital).pcr.filter((p) => p.id === f.id));
    const ats = f.atendimentos ? new Set(f.atendimentos) : null;
    return structuredClone(
      this.estado(c.hospital)
        .pcr.filter(
          (p) =>
            (!ats || ats.has(p.atendimento)) &&
            (ats ||
              ((!f.desde || p.colapsoEm >= f.desde.slice(0, 16)) &&
                (!f.ate || p.colapsoEm < f.ate.slice(0, 16)) &&
                (!f.unidade || p.unidade === f.unidade))),
        )
        .sort((a, b) =>
          a.colapsoEm < b.colapsoEm ? 1 : a.colapsoEm > b.colapsoEm ? -1 : b.versao - a.versao,
        ),
    );
  }

  /** O censo sintético: oito internados por dia na UTI e na enfermaria sintéticas. */
  async lesoes(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; desde?: string; ate?: string },
  ): Promise<LesaoLidaSgh[]> {
    return lesoesMemoria(this.estado(c.hospital).lesoes, f);
  }

  async lesaoDoCurativo(c: ContextoEscores, curativo: number): Promise<number | null> {
    return (
      (this.estado(c.hospital).lesoes ?? []).find((l) => l.curativos.some((x) => x.id === curativo))?.id ??
      null
    );
  }

  /** W0-03, M4: os internados sintéticos do período (as duas unidades do censo sintético, sem rotatividade). */
  async pacientesInternados(): Promise<number> {
    return 2 * INTERNADOS_POR_DIA_SINTETICOS;
  }

  async censo(_c: ContextoEscores, de: string, ate: string) {
    const dias = diasEntre(de, ate);
    return {
      porSetor: ['ENF1', 'UTI'].map((setor) => ({
        setor,
        pacientesDia: dias * INTERNADOS_POR_DIA_SINTETICOS,
      })),
      diasFechados: dias,
    };
  }
}
