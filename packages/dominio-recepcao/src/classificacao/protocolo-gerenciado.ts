// Protocolos gerenciados no PA (ficha do M44, etapa 3, regra 8; cap-05a §5.3; cap-05b §5.11), puro (sem banco): a
// definição versionada (critérios, metas com prazo, checklist) e as conferências da publicação; quem inclui (enfermeiro
// ou médico com conselho ativo); a sugestão pelo discriminador da classificação; o relógio das metas (prazo a partir da
// chegada ou da inclusão, "vencendo" nos últimos minutos, vencida sem registro); o registro da meta (cumprida no prazo,
// perdida com o motivo obrigatório; hora nunca no futuro nem antes da chegada); o encerramento (descarte e meta sem
// registro pedem o motivo); a adesão por meta com numerador e denominador. As horas são locais (AAAA-MM-DDTHH:mm[:ss]),
// somadas como se fossem UTC (sem fuso), como o resto do PA.
import {
  AVISO_META_MIN,
  type ConteudoGerenciado,
  type DesfechoProtocolo,
  type MetaGerenciada,
  type TipoProtocoloGerenciado,
  TIPOS_PROTOCOLO_GERENCIADO,
} from '@sgh/contratos';
import type { CategoriaVinculo } from './autorizacao.js';

const MS_MIN = 60_000;
const iso = (x: number) => new Date(x).toISOString().slice(0, 19);

/** Hora local normalizada com segundos (AAAA-MM-DDTHH:mm:ss). */
export function comSegundos(h: string): string {
  const x = h.slice(0, 19);
  return x.length === 16 ? `${x}:00` : x;
}
const t = (h: string) => Date.parse(`${comSegundos(h)}Z`);

export function somarMinutos(h: string, min: number): string {
  return iso(t(h) + min * MS_MIN);
}

export function nomeDoTipo(tipo: string): string {
  return TIPOS_PROTOCOLO_GERENCIADO.find((x) => x.codigo === tipo)?.rotulo ?? tipo;
}

// ── Publicação ─────────────────────────────────────────────────────────────────────────────────

export interface ProblemaGerenciado {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Conferências da versão antes de publicar (códigos únicos, metas com prazo, tipo da versão anterior). */
export function problemasDaDefinicao(
  c: ConteudoGerenciado,
  o: { autor: string; aprovador: string },
): ProblemaGerenciado[] {
  const p: ProblemaGerenciado[] = [];
  const repetidos = (xs: readonly { codigo: string }[]) =>
    xs.map((x) => x.codigo).filter((k, i, a) => a.indexOf(k) !== i);
  for (const [lista, nome] of [
    [c.criterios, 'critério'],
    [c.metas, 'meta'],
    [c.checklist, 'item do checklist'],
  ] as const)
    for (const r of new Set(repetidos(lista)))
      p.push({ codigo: 'codigo-repetido', mensagem: `O código "${r}" aparece em mais de um ${nome}.` });
  const metasEChecklist = [...c.metas.map((m) => m.codigo), ...c.checklist.map((x) => x.codigo)];
  for (const r of new Set(metasEChecklist.filter((k, i, a) => a.indexOf(k) !== i)))
    p.push({
      codigo: 'codigo-repetido',
      mensagem: `O código "${r}" é ao mesmo tempo meta e item do checklist.`,
    });
  if (o.autor.trim().toUpperCase() === o.aprovador.trim().toUpperCase())
    p.push({ codigo: 'autoaprovacao', mensagem: 'Quem aprova a versão não pode ser quem a redigiu.' });
  return p;
}

// ── Quem inclui e registra (regra 8) ─────────────────────────────────────────────────────────────

export type MotivoRecusaGerenciado = 'sem-vinculo-assistencial' | 'categoria-nao-inclui' | 'conselho-inativo';

/** Inclusão e registro: enfermeiro ou médico com conselho ativo (o técnico e a recepção não incluem). */
export function recusaDoGerenciado(ator: {
  categoria: CategoriaVinculo;
  conselhoAtivo: boolean;
  vinculoAssistencial: boolean;
}): MotivoRecusaGerenciado | null {
  if (!ator.vinculoAssistencial) return 'sem-vinculo-assistencial';
  if (ator.categoria !== 'enfermeiro' && ator.categoria !== 'medico') return 'categoria-nao-inclui';
  if (!ator.conselhoAtivo) return 'conselho-inativo';
  return null;
}

export function origemDaInclusao(
  categoria: CategoriaVinculo,
  sugeridoPor: string | null,
): 'enfermeiro' | 'medico' | 'sugerido' {
  if (sugeridoPor) return 'sugerido';
  return categoria === 'medico' ? 'medico' : 'enfermeiro';
}

// ── Sugestão pelo discriminador ──────────────────────────────────────────────────────────────────

export interface DiscriminadorQueSugere {
  readonly codigo: string;
  readonly titulo: string;
  readonly sugereProtocolo: string | null;
}

/**
 * Os protocolos que a classificação vigente sugere (os discriminadores presentes com `sugereProtocolo`), sem os tipos
 * que o paciente já tem nesse atendimento e só os que têm definição publicada.
 */
export function sugestoesDaClassificacao(
  presentes: readonly string[],
  discriminadores: readonly DiscriminadorQueSugere[],
  jaIncluidos: ReadonlySet<string>,
  publicados: ReadonlySet<string>,
): { tipo: TipoProtocoloGerenciado; discriminador: string; titulo: string }[] {
  const r: { tipo: TipoProtocoloGerenciado; discriminador: string; titulo: string }[] = [];
  const vistos = new Set<string>();
  for (const codigo of presentes) {
    const d = discriminadores.find((x) => x.codigo === codigo);
    const tipo = d?.sugereProtocolo;
    if (!d || !tipo || vistos.has(tipo) || jaIncluidos.has(tipo) || !publicados.has(tipo)) continue;
    if (!TIPOS_PROTOCOLO_GERENCIADO.some((x) => x.codigo === tipo)) continue;
    vistos.add(tipo);
    r.push({ tipo: tipo as TipoProtocoloGerenciado, discriminador: d.codigo, titulo: d.titulo });
  }
  return r;
}

// ── Relógio ────────────────────────────────────────────────────────────────────────────────────

export interface EventoDoProtocolo {
  readonly tipo: 'meta' | 'checklist' | 'encerramento';
  readonly codigo: string;
  readonly situacao: string;
  readonly quando: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

export interface MetaNoRelogioCalculada {
  readonly codigo: string;
  readonly titulo: string;
  readonly tipo: 'meta' | 'checklist';
  readonly prazoEm: string | null;
  readonly minutosRestantes: number | null;
  readonly situacao: 'no_prazo' | 'vencendo' | 'vencida' | 'cumprida' | 'perdida' | 'pendente' | 'feito';
  readonly registradoEm: string | null;
  readonly quando: string | null;
  readonly motivo: string | null;
  readonly por: string | null;
}

export function prazoDaMeta(m: MetaGerenciada, chegadaEm: string, incluidoEm: string): string {
  return somarMinutos(m.desde === 'chegada' ? chegadaEm : incluidoEm, m.prazoMin);
}

/** O relógio do protocolo do paciente: cada meta com o prazo e a situação, a próxima e as atrasadas. */
export function relogioDoProtocolo(p: {
  conteudo: ConteudoGerenciado;
  chegadaEm: string;
  incluidoEm: string;
  eventos: readonly EventoDoProtocolo[];
  agora: string;
}): {
  metas: MetaNoRelogioCalculada[];
  proxima: { titulo: string; minutosRestantes: number; situacao: string } | null;
  atrasadas: number;
  minutosDesdeInclusao: number;
  encerrado: EventoDoProtocolo | null;
} {
  const encerrado = p.eventos.find((e) => e.tipo === 'encerramento') ?? null;
  // Encerrado, o relógio para na hora do encerramento.
  const agora = encerrado ? comSegundos(encerrado.em) : comSegundos(p.agora);
  const metas: MetaNoRelogioCalculada[] = p.conteudo.metas.map((m) => {
    const prazoEm = prazoDaMeta(m, p.chegadaEm, p.incluidoEm);
    const ev = p.eventos.find((e) => e.tipo === 'meta' && e.codigo === m.codigo);
    if (ev)
      return {
        codigo: m.codigo,
        titulo: m.titulo,
        tipo: 'meta',
        prazoEm,
        minutosRestantes: null,
        situacao: ev.situacao === 'cumprida' ? 'cumprida' : 'perdida',
        registradoEm: ev.em,
        quando: ev.quando,
        motivo: ev.motivo,
        por: ev.por,
      };
    const restam = Math.floor((t(prazoEm) - t(agora)) / MS_MIN);
    return {
      codigo: m.codigo,
      titulo: m.titulo,
      tipo: 'meta',
      prazoEm,
      minutosRestantes: restam,
      situacao: restam < 0 ? 'vencida' : restam <= AVISO_META_MIN ? 'vencendo' : 'no_prazo',
      registradoEm: null,
      quando: null,
      motivo: null,
      por: null,
    };
  });
  for (const c of p.conteudo.checklist) {
    const ev = p.eventos.find((e) => e.tipo === 'checklist' && e.codigo === c.codigo);
    metas.push({
      codigo: c.codigo,
      titulo: c.titulo,
      tipo: 'checklist',
      prazoEm: null,
      minutosRestantes: null,
      situacao: ev ? (ev.situacao === 'cumprida' ? 'feito' : 'perdida') : 'pendente',
      registradoEm: ev?.em ?? null,
      quando: ev?.quando ?? null,
      motivo: ev?.motivo ?? null,
      por: ev?.por ?? null,
    });
  }
  const pendentes = metas
    .filter((m) => m.tipo === 'meta' && m.minutosRestantes !== null)
    .sort((a, b) => (a.minutosRestantes ?? 0) - (b.minutosRestantes ?? 0));
  const prox = pendentes[0];
  return {
    metas,
    proxima:
      prox && !encerrado
        ? { titulo: prox.titulo, minutosRestantes: prox.minutosRestantes ?? 0, situacao: prox.situacao }
        : null,
    atrasadas: metas.filter((m) => m.situacao === 'vencida' || m.situacao === 'perdida').length,
    minutosDesdeInclusao: Math.max(0, Math.floor((t(agora) - t(p.incluidoEm)) / MS_MIN)),
    encerrado,
  };
}

// ── Registro da meta (regra 8) ───────────────────────────────────────────────────────────────────

export type DecisaoMeta =
  | { ok: true; situacao: 'cumprida' | 'perdida'; prazoEm: string | null }
  | { ok: false; codigo: string; mensagem: string; campo: string };

/**
 * A meta feita até o prazo é cumprida; feita depois do prazo, ou não feita, é perdida e exige o motivo. O item do
 * checklist não tem prazo: feito ou não feito (não feito pede o motivo). A hora nunca no futuro nem antes da chegada.
 */
export function decidirRegistroMeta(p: {
  meta: MetaGerenciada | null;
  feita: boolean;
  quando: string | null;
  motivo: string | null;
  chegadaEm: string;
  incluidoEm: string;
  agora: string;
}): DecisaoMeta {
  if (p.feita && p.quando) {
    if (t(p.quando) > t(p.agora) + MS_MIN)
      return {
        ok: false,
        codigo: 'hora-no-futuro',
        mensagem: 'A hora informada ainda não chegou.',
        campo: 'quando',
      };
    if (t(p.quando) < t(p.chegadaEm) - MS_MIN)
      return {
        ok: false,
        codigo: 'hora-antes-da-chegada',
        mensagem: 'A hora informada é anterior à chegada do paciente ao PA.',
        campo: 'quando',
      };
  }
  const prazoEm = p.meta ? prazoDaMeta(p.meta, p.chegadaEm, p.incluidoEm) : null;
  const noPrazo = p.feita && p.quando !== null && (prazoEm === null || t(p.quando) <= t(prazoEm));
  const situacao = noPrazo ? 'cumprida' : 'perdida';
  if (situacao === 'perdida' && !(p.motivo ?? '').trim())
    return {
      ok: false,
      codigo: 'motivo-obrigatorio',
      mensagem: p.feita
        ? 'Feita depois do prazo: a meta conta como perdida e pede o motivo.'
        : 'Meta não cumprida: escreva o motivo.',
      campo: 'motivo',
    };
  return { ok: true, situacao, prazoEm };
}

/** O encerramento: o descarte e as metas ainda sem registro pedem o motivo. */
export function problemaDoEncerramento(
  desfecho: DesfechoProtocolo,
  motivo: string | null,
  metasSemRegistro: number,
): string | null {
  const temMotivo = !!(motivo ?? '').trim();
  if (desfecho === 'descartado' && !temMotivo) return 'Diga por que o critério não se confirmou.';
  if (metasSemRegistro > 0 && !temMotivo)
    return `Ainda há ${metasSemRegistro} meta(s) sem registro: escreva o motivo do encerramento.`;
  return null;
}

// ── Adesão (numerador e denominador) ─────────────────────────────────────────────────────────────

export function adesaoDasMetas(
  protocolos: readonly {
    tipo: string;
    conteudo: ConteudoGerenciado;
    eventos: readonly EventoDoProtocolo[];
  }[],
): {
  tipo: TipoProtocoloGerenciado;
  meta: string;
  titulo: string;
  cumpridas: number;
  registradas: number;
  percentual: number | null;
}[] {
  const m = new Map<
    string,
    { tipo: TipoProtocoloGerenciado; meta: string; titulo: string; cumpridas: number; registradas: number }
  >();
  for (const p of protocolos)
    for (const meta of p.conteudo.metas) {
      const k = `${p.tipo}:${meta.codigo}`;
      const a = m.get(k) ?? {
        tipo: p.tipo as TipoProtocoloGerenciado,
        meta: meta.codigo,
        titulo: meta.titulo,
        cumpridas: 0,
        registradas: 0,
      };
      const ev = p.eventos.find((e) => e.tipo === 'meta' && e.codigo === meta.codigo);
      if (ev) {
        a.registradas++;
        if (ev.situacao === 'cumprida') a.cumpridas++;
      }
      m.set(k, a);
    }
  return [...m.values()].map((a) => ({
    ...a,
    percentual: a.registradas === 0 ? null : Math.round((a.cumpridas / a.registradas) * 1000) / 10,
  }));
}

// ── Definições sintéticas (contorno: a diretoria clínica publica as de produção) ─────────────────

const SUFIXO = '(sintético, não clínico)';

/**
 * As definições SINTÉTICAS de teste. Metas na forma das diretrizes públicas (dor torácica: ECG em até 10 min
 * da chegada; sepse: antibiótico na primeira hora da inclusão), mas não são protocolo clínico: a diretoria clínica
 * redige e publica as de produção pela tela.
 */
export const PROTOCOLOS_GERENCIADOS_SINTETICOS: readonly ConteudoGerenciado[] = [
  {
    tipo: 'dor-toracica',
    nome: `Dor torácica ${SUFIXO}`,
    criterios: [
      { codigo: 'dor-precordial', titulo: 'Dor ou desconforto torácico de possível origem cardíaca' },
      { codigo: 'equivalente', titulo: 'Equivalente isquêmico (dispneia, sudorese, síncope)' },
    ],
    metas: [
      { codigo: 'ecg', titulo: 'ECG de 12 derivações', prazoMin: 10, desde: 'chegada' },
      { codigo: 'avaliacao-medica', titulo: 'Avaliação médica do ECG', prazoMin: 20, desde: 'chegada' },
      { codigo: 'troponina', titulo: 'Coleta da troponina', prazoMin: 60, desde: 'inclusao' },
    ],
    checklist: [{ codigo: 'aas', titulo: 'Antiagregante avaliado (contraindicações conferidas)' }],
  },
  {
    tipo: 'sepse',
    nome: `Sepse ${SUFIXO}`,
    criterios: [
      { codigo: 'suspeita-infeccao', titulo: 'Suspeita de infecção' },
      {
        codigo: 'disfuncao',
        titulo: 'Sinal de disfunção orgânica ou dois critérios de resposta inflamatória',
      },
    ],
    metas: [
      { codigo: 'lactato', titulo: 'Coleta do lactato', prazoMin: 30, desde: 'inclusao' },
      {
        codigo: 'hemoculturas',
        titulo: 'Hemoculturas antes do antibiótico',
        prazoMin: 45,
        desde: 'inclusao',
      },
      { codigo: 'antibiotico', titulo: 'Antibiótico administrado', prazoMin: 60, desde: 'inclusao' },
    ],
    checklist: [{ codigo: 'reavaliacao', titulo: 'Reavaliação da volemia registrada' }],
  },
  {
    tipo: 'avc',
    nome: `AVC ${SUFIXO}`,
    criterios: [{ codigo: 'deficit-focal', titulo: 'Déficit neurológico focal súbito' }],
    metas: [
      {
        codigo: 'avaliacao-neurologica',
        titulo: 'Avaliação médica com escala neurológica',
        prazoMin: 10,
        desde: 'chegada',
      },
      { codigo: 'tomografia', titulo: 'Tomografia de crânio realizada', prazoMin: 25, desde: 'chegada' },
      {
        codigo: 'decisao-terapeutica',
        titulo: 'Decisão terapêutica registrada',
        prazoMin: 60,
        desde: 'chegada',
      },
    ],
    checklist: [{ codigo: 'glicemia', titulo: 'Glicemia capilar conferida' }],
  },
  {
    tipo: 'trauma',
    nome: `Trauma ${SUFIXO}`,
    criterios: [{ codigo: 'mecanismo', titulo: 'Mecanismo de trauma de alta energia ou instabilidade' }],
    metas: [
      { codigo: 'avaliacao-primaria', titulo: 'Avaliação primária completa', prazoMin: 10, desde: 'chegada' },
      { codigo: 'imagem', titulo: 'Exame de imagem inicial', prazoMin: 30, desde: 'chegada' },
    ],
    checklist: [],
  },
  {
    // W0-03 (mercado M3): TEV no internado; o risco vem da escala de Padua ou de Caprini (pendência ao prescritor).
    tipo: 'tev',
    nome: `TEV ${SUFIXO}`,
    criterios: [
      { codigo: 'risco-alto', titulo: 'Risco de TEV alto pela escala institucional (Padua ou Caprini)' },
      {
        codigo: 'suspeita-tvp-tep',
        titulo: 'Suspeita clínica de trombose venosa profunda ou embolia pulmonar',
      },
    ],
    metas: [
      {
        codigo: 'avaliacao-medica',
        titulo: 'Avaliação médica do risco e do sangramento',
        prazoMin: 60,
        desde: 'inclusao',
      },
      {
        codigo: 'profilaxia',
        titulo: 'Profilaxia prescrita ou contraindicação registrada',
        prazoMin: 240,
        desde: 'inclusao',
      },
    ],
    checklist: [{ codigo: 'deambulacao', titulo: 'Deambulação ou medida mecânica orientada' }],
  },
];
