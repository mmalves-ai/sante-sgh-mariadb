// Operações da classificação de risco e dos protocolos gerenciados pelo Executor do @sgh/nucleo (F2.2): publicar o
// protocolo de classificação, classificar (e reclassificar), registrar os sinais vitais, publicar a definição do
// protocolo gerenciado e incluir o paciente nele. Cada operação valida a entrada (zod), declara as tabelas que grava
// e deixa a trilha, o outbox e a idempotência na mesma transação (o Executor). As regras clínicas (cor, tempo-alvo,
// discriminadores do fluxograma) são do domínio (@sgh/dominio-recepcao), conferidas pelo serviço antes de gravar.
//
// Melhoria: o encerramento da vigência da versão anterior é uma alteração auditada com a versão lida (trava otimista),
// nunca um UPDATE solto; a trilha leva a ação real de cada escrita (inclusão ou alteração).
// Melhoria: a resposta da classificação é ligada ao discriminador pelo par (fluxograma, código); discriminador ou
// fluxograma que não esteja na versão publicada é recusado (nunca gravado em branco nem descartado).
// Melhoria: o código do fluxograma que não cabe no modelo é recusado na publicação (sem corte silencioso).
// Melhoria: o tipo do protocolo gerenciado é traduzido entre o contrato e o cadastro por tabela fechada.
import { z } from 'zod';
import {
  definirOperacao,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { etapasNaInclusaoTx } from '../enfermagem/protocolo-criterios-propria.js';
import { bool, instanteDaHoraCivil, num, txt } from './banco.js';
import type { VinculoDaSessao } from './classificacao-porta.js';
import type { MotivoClassificacao, SinaisVitais } from './tipos.js';

/** Parâmetro vital de cada sinal da classificação (parametro_vital.codigo, catálogo do produto). */
export const PARAMETRO_DO_SINAL: Readonly<Record<keyof SinaisVitais, string>> = {
  pas: 'pressao_sistolica',
  pad: 'pressao_diastolica',
  fc: 'frequencia_cardiaca',
  fr: 'frequencia_respiratoria',
  temperatura: 'temperatura',
  saturacao: 'saturacao_oxigenio',
  glicemia: 'glicemia_capilar',
  dor: 'escala_dor',
  glasgow: 'escala_glasgow',
};
export const SINAIS = Object.keys(PARAMETRO_DO_SINAL) as (keyof SinaisVitais)[];

/** Tipo do protocolo de classificação no contrato ↔ no cadastro. */
export const TIPO_NO_BANCO: Readonly<Record<string, string>> = {
  manchester: 'manchester',
  accr: 'institucional',
};
export const tipoDoBanco = (t: string): string => (t === 'manchester' ? 'manchester' : 'accr');

/** Tipo do protocolo gerenciado no contrato (TIPOS_PROTOCOLO_GERENCIADO) ↔ no cadastro (ck_protocolo_gerenciado_tipo). */
export const TIPO_GERENCIADO_NO_BANCO: Readonly<Record<string, string>> = {
  sepse: 'sepse',
  'dor-toracica': 'dor_toracica',
  avc: 'avc',
  trauma: 'trauma',
  tev: 'tev',
};
const TIPO_GERENCIADO_DO_BANCO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TIPO_GERENCIADO_NO_BANCO).map(([c, b]) => [b, c]),
);
/** O tipo do contrato a partir do cadastro (tipo do cadastro sem par no contrato: o próprio código). */
export const tipoGerenciadoDoBanco = (t: string): string => TIPO_GERENCIADO_DO_BANCO[t] ?? t;
export function tipoGerenciadoNoBanco(t: string): string {
  const b = TIPO_GERENCIADO_NO_BANCO[t];
  if (!b) throw recusa('tipo-de-protocolo', 'Tipo de protocolo gerenciado desconhecido.');
  return b;
}

/** Motivo da reclassificação ↔ tipo do motivo no cadastro. */
const TIPO_DO_MOTIVO: Readonly<Record<Exclude<MotivoClassificacao, 'inicial'>, string>> = {
  estouro: 'tempo_alvo_vencido',
  mudanca_quadro: 'piora_clinica',
};

/** Forma de inclusão no protocolo gerenciado pela origem do contrato. */
const FORMA_DA_ORIGEM: Readonly<Record<string, string>> = {
  enfermeiro: 'manual',
  medico: 'manual',
  sugerido: 'alerta_automatico',
};

/** Tamanho da coluna fluxograma_classificacao_risco.codigo (pedido de alargar registrado na saída do lote). */
export const MAX_CODIGO_FLUXOGRAMA = 30;

export const json = (v: unknown): unknown => (typeof v === 'string' ? (JSON.parse(v) as unknown) : v);

/** `fluxograma:sequência` → código do discriminador, na ordem do conteúdo publicado. */
export function codigosDosDiscriminadores(conteudo: unknown): Map<string, string> {
  const r = new Map<string, string>();
  for (const [k, seq] of sequenciasDosDiscriminadores(conteudo)) {
    const [fluxo, codigo] = k.split('\u0000') as [string, string];
    r.set(`${fluxo}:${seq}`, codigo);
  }
  return r;
}

/** (fluxograma, código) → sequência do discriminador dentro do fluxograma, na ordem do conteúdo publicado. */
function sequenciasDosDiscriminadores(conteudo: unknown): Map<string, number> {
  const c = conteudo as { discriminadores?: readonly { fluxograma: string; codigo: string }[] } | null;
  const seq = new Map<string, number>();
  const r = new Map<string, number>();
  for (const d of c?.discriminadores ?? []) {
    const k = `${d.fluxograma}\u0000${d.codigo}`;
    if (r.has(k))
      throw recusa(
        'discriminador-repetido',
        `O discriminador "${d.codigo}" aparece duas vezes no fluxograma "${d.fluxograma}".`,
      );
    const n = (seq.get(d.fluxograma) ?? 0) + 1;
    seq.set(d.fluxograma, n);
    r.set(k, n);
  }
  return r;
}

export async function vinculoDoLogin(l: Leitor, login: string): Promise<VinculoDaSessao | null> {
  // O profissional é a mesma pessoa do usuário (pelo CPF da conta e da pessoa física).
  const x = await l.uma(
    `SELECT p.id, COALESCE(oi.codigo_cbo, ou.codigo_cbo) AS cbo,
            EXISTS (SELECT 1 FROM inscricao_conselho ic WHERE ic.profissional_id = p.id AND ic.situacao = 'ativa'
                       AND ic.excluido_em IS NULL AND (ic.validade IS NULL OR ic.validade >= CURRENT_DATE)) AS conselho
       FROM usuario u JOIN pessoa_fisica pf ON pf.cpf = u.cpf AND pf.excluido_em IS NULL
       JOIN profissional p ON p.pessoa_fisica_id = pf.id AND p.situacao = 'ativo' AND p.excluido_em IS NULL
       LEFT JOIN inscricao_conselho ip ON ip.profissional_id = p.id AND ip.principal = TRUE AND ip.excluido_em IS NULL
       LEFT JOIN ocupacao_cbo oi ON oi.id = ip.ocupacao_cbo_id
       LEFT JOIN ocupacao_cbo ou ON ou.id = u.ocupacao_cbo_id
      WHERE u.login = ? AND u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.cpf IS NOT NULL
      LIMIT 1`,
    [login],
  );
  if (!x || !x['cbo']) return null;
  return { vinculo: num(x['id']), codigoCbo: txt(x['cbo']), conselhoAtivo: bool(x['conselho']) };
}

// ── apoio das operações ──────────────────────────────────────────────────────────────────────────

interface Sessao {
  readonly estabelecimento: number;
  readonly fuso: string;
  readonly usuario: number;
}

async function sessao(tx: TxOperacao): Promise<Sessao> {
  const { estabelecimento, usuario } = tx.contexto;
  if (estabelecimento === null || usuario === null)
    throw recusa('contexto-incompleto', 'A gravação pede o estabelecimento e o usuário da sessão.');
  const e = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [
    estabelecimento,
  ]);
  if (!e) throw recusa('estabelecimento-inexistente', 'O estabelecimento da sessão não existe.');
  return { estabelecimento, usuario, fuso: txt(e['fuso_horario']) || 'America/Sao_Paulo' };
}

async function exigirUsuario(tx: TxOperacao, login: string): Promise<number> {
  const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
  if (!u) throw recusa('usuario-inexistente', 'O usuário informado não está no cadastro deste cliente.');
  return num(u['id']);
}

async function nivel(tx: TxOperacao, cor: string): Promise<number> {
  const n = await tx.uma(
    "SELECT id FROM nivel_prioridade WHERE codigo = ? AND contexto = 'classificacao_risco' AND ativo = TRUE",
    [cor],
  );
  if (!n) throw recusa('nivel-nao-cadastrado', `O nível de prioridade "${cor}" não está cadastrado.`);
  return num(n['id']);
}

/** Fecha a vigência das versões vigentes já iniciadas (alteração auditada, com a versão lida no FOR UPDATE). */
async function encerrarVigentes(tx: TxOperacao, tabela: string, vigentes: readonly Linha[], agora: Date) {
  for (const v of vigentes)
    if (v['vigencia_fim'] === null && (v['vigencia_inicio'] as Date) < agora)
      await tx.alterar(tabela, num(v['id']), num(v['versao']), { vigencia_fim: agora });
}

async function gravarAfericao(
  tx: TxOperacao,
  s: Sessao,
  a: {
    atendimento: number;
    paciente: number;
    sinais: SinaisVitais;
    hora: string;
    profissional: number | null;
    classificacao: number | null;
  },
): Promise<{ afericao: number | null; sinais: number }> {
  const presentes = SINAIS.filter((x) => a.sinais[x] !== null);
  if (presentes.length === 0) return { afericao: null, sinais: 0 };
  const parametros = await tx.consultar(
    `SELECT id, codigo FROM parametro_vital WHERE ativo = TRUE AND codigo IN (${presentes.map(() => '?').join(', ')})`,
    presentes.map((x) => PARAMETRO_DO_SINAL[x]),
  );
  const idDe = new Map(parametros.map((p) => [txt(p['codigo']), num(p['id'])]));
  if (presentes.some((x) => !idDe.has(PARAMETRO_DO_SINAL[x])))
    throw recusa(
      'parametro-vital-nao-cadastrado',
      'Um dos sinais vitais não está cadastrado nos parâmetros aferíveis.',
    );
  const afericao = await tx.incluir('afericao', {
    estabelecimento_id: s.estabelecimento,
    paciente_id: a.paciente,
    atendimento_id: a.atendimento,
    classificacao_risco_id: a.classificacao,
    profissional_id: a.profissional,
    aferido_em: instanteDaHoraCivil(a.hora, s.fuso),
    fonte: 'manual',
    finalizada: true,
  });
  let n = 0;
  for (const x of presentes)
    await tx.incluir('afericao_valor', {
      afericao_id: afericao,
      sequencia: ++n,
      parametro_vital_id: idDe.get(PARAMETRO_DO_SINAL[x]),
      valor_numerico: a.sinais[x],
    });
  return { afericao, sinais: n };
}

async function exigirAtendimento(tx: TxOperacao, s: Sessao, atendimento: number, paciente: number) {
  const a = await tx.uma(
    'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [atendimento, s.estabelecimento],
  );
  if (!a) throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
  if (num(a['paciente_id']) !== paciente)
    throw recusa('paciente-diferente', 'O paciente não é o do atendimento.');
}

// ── entradas ─────────────────────────────────────────────────────────────────────────────────────

const login = z.string().trim().min(1).max(60);
const id = z.number().int().positive();
const sinal = z.number().finite().nullable();
const esquemaSinais = z.object({
  pas: sinal,
  pad: sinal,
  fc: sinal,
  fr: sinal,
  temperatura: sinal,
  saturacao: sinal,
  glicemia: sinal,
  dor: sinal,
  glasgow: sinal,
});
const horaCivilEsquema = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/);

export const esquemaPublicarProtocolo = z.object({
  protocolo: id.nullable(),
  tipo: z.enum(['manchester', 'accr']),
  nome: z.string().trim().min(1),
  conteudo: z.unknown(),
  impressao: z.string(),
  notas: z.string(),
  autor: login,
  aprovador: login,
  licenca: z.object({ registro: z.string(), titular: z.string(), validaAte: z.string() }).nullable(),
  cores: z
    .array(
      z.object({ cor: z.string().min(1).max(30), nome: z.string(), tempoAlvoMin: z.number().int().min(0) }),
    )
    .min(1),
  discriminadores: z.array(
    z.object({
      fluxograma: z.string().min(1),
      codigo: z.string().min(1),
      titulo: z.string().min(1),
      cor: z.string().min(1).max(30),
      regra: z.unknown(),
    }),
  ),
});

export const esquemaClassificar = z.object({
  cabecalho: z.string().regex(/^\d{1,18}$/),
  queixa: z.string(),
  paciente: id,
  versaoProtocolo: id,
  fluxograma: z.string().min(1),
  discriminadores: z.array(z.string().min(1)),
  sinais: esquemaSinais,
  corProposta: z.string().min(1).max(30),
  corFinal: z.string().min(1).max(30),
  justificativa: z.string().nullable(),
  motivo: z.enum(['inicial', 'estouro', 'mudanca_quadro']),
  descricaoMudanca: z.string().nullable(),
  anterior: id.nullable(),
  tempoAlvoMin: z.number().int().min(0),
  horaSinais: horaCivilEsquema,
  e08: z.union([
    z.object({ situacao: z.enum(['gravado', 'semPrioridade']), registro: id }),
    z.object({ situacao: z.literal('desligado') }),
  ]),
  autor: login,
});

export const esquemaRegistrarSinais = z.object({
  cabecalho: z.string().regex(/^\d{1,18}$/),
  paciente: id,
  sinais: esquemaSinais,
  horaSinais: horaCivilEsquema,
  autor: login,
});

export const esquemaPublicarGerenciado = z.object({
  tipo: z.string().min(1),
  nome: z.string().trim().min(1),
  conteudo: z.unknown(),
  impressao: z.string(),
  notas: z.string(),
  autor: login,
  aprovador: login,
});

export const esquemaIncluirProtocolo = z.object({
  cabecalho: z.string().regex(/^\d{1,18}$/),
  paciente: id,
  gerenciado: id,
  origem: z.enum(['enfermeiro', 'medico', 'sugerido']),
  criterios: z.array(z.string().min(1)),
  chegadaEm: horaCivilEsquema,
  autor: login,
});

// ── classificacao.publicar_protocolo ─────────────────────────────────────────────────────────────

interface ConteudoPublicado {
  readonly fluxogramas?: readonly {
    readonly codigo: string;
    readonly nome?: string;
    readonly titulo?: string;
  }[];
}

/** Conferências da publicação antes de gravar: a licença (registro, titular e validade) e os códigos que o modelo comporta. */
export function conferirPublicacao(p: {
  licenca: unknown;
  conteudo: unknown;
  discriminadores: readonly { fluxograma: string }[];
}): void {
  const lic = p.licenca as { registro: string; titular: string; validaAte: string } | null;
  if (lic !== null) {
    if (
      !lic.registro.trim() ||
      lic.registro.trim().length > 60 ||
      !lic.titular.trim() ||
      lic.titular.trim().length > 150
    )
      throw recusa(
        'licenca-invalida',
        'A licença do protocolo precisa do registro (até 60) e do titular (até 150).',
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lic.validaAte.slice(0, 10)))
      throw recusa('licenca-invalida', 'A validade da licença do protocolo deve ser uma data (AAAA-MM-DD).');
  }
  const codigos = [
    ...((p.conteudo as ConteudoPublicado | null)?.fluxogramas ?? []).map((f) => f.codigo),
    ...p.discriminadores.map((d) => d.fluxograma),
  ];
  const longo = codigos.find((c) => c.length > MAX_CODIGO_FLUXOGRAMA);
  if (longo !== undefined)
    throw recusa(
      'codigo-fluxograma-longo',
      `O código do fluxograma "${longo.slice(0, 40)}…" passa de ${MAX_CODIGO_FLUXOGRAMA} caracteres: encurte-o antes de publicar.`,
    );
  sequenciasDosDiscriminadores(p.conteudo);
}

export const opPublicarProtocolo = definirOperacao({
  nome: 'classificacao.publicar_protocolo',
  tabelas: [
    'sequencia_negocio',
    'protocolo_classificacao_risco',
    'protocolo_classificacao_estabelecimento',
    'protocolo_classificacao_risco_versao',
    'nivel_prioridade_protocolo',
    'fluxograma_classificacao_risco',
    'discriminador_classificacao_risco',
  ],
  entrada: esquemaPublicarProtocolo,
  async gravar(tx, p) {
    conferirPublicacao(p);
    const s = await sessao(tx);
    const agora = new Date();
    const tipo = TIPO_NO_BANCO[p.tipo]!;
    const autor = await exigirUsuario(tx, p.autor);
    const aprovador = await exigirUsuario(tx, p.aprovador);
    let protocolo: number;
    let versao = 1;
    if (p.protocolo === null) {
      await garantirSequencia(
        tx,
        { tipo: 'protocolo_classificacao', estabelecimento: null, prefixo: 'PCR-' },
        { usuario: s.usuario, agora },
      );
      const n = await tx.proximoNumero('protocolo_classificacao', { porCliente: true });
      protocolo = await tx.incluir('protocolo_classificacao_risco', {
        codigo: n.formatado,
        nome: p.nome.slice(0, 150),
        tipo,
        situacao: 'publicado',
      });
      await tx.incluir('protocolo_classificacao_estabelecimento', {
        protocolo_classificacao_risco_id: protocolo,
        estabelecimento_id: s.estabelecimento,
        vigencia_inicio: agora,
      });
    } else {
      const [x] = await tx.consultarParaAtualizar(
        `SELECT p.id, p.tipo FROM protocolo_classificacao_risco p
          WHERE p.id = ? AND p.excluido_em IS NULL AND EXISTS (SELECT 1 FROM protocolo_classificacao_estabelecimento pe
                 WHERE pe.protocolo_classificacao_risco_id = p.id AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL)`,
        [p.protocolo, s.estabelecimento],
        { teto: 1 },
      );
      if (!x) throw recusa('protocolo-inexistente', 'O protocolo não existe neste estabelecimento.');
      if (txt(x['tipo']) !== tipo)
        throw recusa('tipo-diferente', 'A versão nova tem de ser do mesmo tipo do protocolo.');
      protocolo = p.protocolo;
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT id, versao, numero_versao, vigencia_inicio, vigencia_fim FROM protocolo_classificacao_risco_versao
          WHERE protocolo_classificacao_risco_id = ?`,
        [protocolo],
      );
      versao = Math.max(0, ...vigentes.map((v) => num(v['numero_versao']))) + 1;
      await encerrarVigentes(tx, 'protocolo_classificacao_risco_versao', vigentes, agora);
    }
    const id = await tx.incluir('protocolo_classificacao_risco_versao', {
      protocolo_classificacao_risco_id: protocolo,
      operacao: 'inclusao',
      dados: JSON.stringify(p.conteudo),
      ocorrido_em: agora,
      usuario_id: autor,
      numero_versao: String(versao),
      vigencia_inicio: agora,
      motivo_publicacao: p.notas.slice(0, 500),
      publicado_por_usuario_id: aprovador,
      ...(p.licenca
        ? {
            licenca_registro: p.licenca.registro.trim(),
            licenca_titular: p.licenca.titular.trim(),
            licenca_valida_ate: p.licenca.validaAte.slice(0, 10),
          }
        : {}),
    });
    // Desdobra o conteúdo nas tabelas do modelo: níveis da versão, fluxogramas (todos, na ordem do conteúdo) e
    // discriminadores (a sequência dentro do fluxograma é a do conteúdo publicado).
    for (const cor of p.cores)
      await tx.incluir('nivel_prioridade_protocolo', {
        protocolo_classificacao_risco_versao_id: id,
        nivel_prioridade_id: await nivel(tx, cor.cor),
        descricao_risco: cor.nome.slice(0, 80),
        tempo_alvo_minutos: cor.tempoAlvoMin,
      });
    const doConteudo = (p.conteudo as ConteudoPublicado | null)?.fluxogramas ?? [];
    const nomes = new Map(doConteudo.map((f) => [f.codigo, f.nome ?? f.titulo ?? f.codigo]));
    const ordem = [
      ...new Set([...doConteudo.map((f) => f.codigo), ...p.discriminadores.map((d) => d.fluxograma)]),
    ];
    const fluxos = new Map<string, number>();
    for (const codigo of ordem)
      fluxos.set(
        codigo,
        await tx.incluir('fluxograma_classificacao_risco', {
          protocolo_classificacao_risco_versao_id: id,
          sequencia: fluxos.size + 1,
          codigo,
          nome: (nomes.get(codigo) ?? codigo).slice(0, 200),
        }),
      );
    const seqs = sequenciasDosDiscriminadores(p.conteudo);
    for (const d of p.discriminadores) {
      const seq = seqs.get(`${d.fluxograma}\u0000${d.codigo}`);
      if (seq === undefined)
        throw recusa(
          'discriminador-fora-do-conteudo',
          `O discriminador "${d.codigo}" não está no conteúdo publicado do fluxograma "${d.fluxograma}".`,
        );
      await tx.incluir('discriminador_classificacao_risco', {
        fluxograma_classificacao_risco_id: fluxos.get(d.fluxograma),
        sequencia: seq,
        pergunta: d.titulo.slice(0, 300),
        nivel_prioridade_id: await nivel(tx, d.cor),
        selecao_automatica: d.regra !== null && d.regra !== undefined,
      });
    }
    return { id, protocolo, versao };
  },
  eventos: (_p, r) => [
    { tipo: 'classificacao.protocolo_publicado', carga: { versao: r.id, protocolo: r.protocolo } },
  ],
  alvo: (_p, r) => ({ tabela: 'protocolo_classificacao_risco_versao', id: r.id }),
});

// ── classificacao.classificar ────────────────────────────────────────────────────────────────────

/** Dados da classificação estruturada gravada na transação de quem chama (recepção ou registro clínico do PEP). */
export interface ClassificacaoNaTx {
  estabelecimento: number;
  fuso: string;
  atendimento: number;
  paciente: number;
  autorUsuario: number;
  classificador: number;
  versaoProtocolo: number;
  /** Código do fluxograma na versão; o registro clínico pode mandar o nome. */
  fluxograma: string;
  discriminadores: readonly string[];
  sinais: SinaisVitais;
  horaSinais: string;
  corProposta: string;
  corFinal: string;
  justificativa: string | null;
  motivo: MotivoClassificacao;
  descricaoMudanca: string | null;
  anterior: number | null;
  tempoAlvoMin: number;
  /** Sem queixa digitada, vale o nome do fluxograma (a queixa do protocolo). */
  queixa: string | null;
  registro: number | null;
}

/**
 * Grava classificacao_risco, as respostas dos discriminadores, o evento e a aferição dos sinais, na transação de quem
 * chama: a recepção (classificacao.classificar) e o registro clínico com classificação (03-PEP L96).
 */
export async function gravarClassificacaoNaTx(
  tx: TxOperacao,
  x: ClassificacaoNaTx,
): Promise<{ id: number; sinais: number }> {
  const agora = new Date();
  let motivo: number | null = null;
  if (x.anterior === null) {
    const ja = await tx.consultarParaAtualizar(
      `SELECT id FROM classificacao_risco WHERE atendimento_id = ? AND anterior_classificacao_risco_id IS NULL
            AND excluido_em IS NULL AND situacao <> 'cancelada'`,
      [x.atendimento],
    );
    if (ja.length > 0)
      throw recusa(
        'ja-classificado',
        'Este atendimento acabou de ser classificado por outra pessoa. Abra de novo.',
      );
  } else {
    const [ant] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao FROM classificacao_risco
          WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [x.anterior, x.atendimento, x.estabelecimento],
      { teto: 1 },
    );
    if (!ant || txt(ant['situacao']) !== 'concluida')
      throw recusa(
        'anterior-desatualizada',
        'A classificação mudou depois que você abriu. Abra de novo antes de reclassificar.',
      );
    const m = await tx.uma(
      'SELECT id FROM motivo_reclassificacao WHERE tipo = ? AND ativo = TRUE ORDER BY id LIMIT 1',
      [TIPO_DO_MOTIVO[x.motivo as Exclude<MotivoClassificacao, 'inicial'>] ?? 'outro'],
    );
    if (!m) throw recusa('motivo-nao-cadastrado', 'O motivo da reclassificação não está cadastrado.');
    motivo = num(m['id']);
    await tx.alterar('classificacao_risco', x.anterior, num(ant['versao']), { situacao: 'reclassificada' });
  }
  // A versão do protocolo, o fluxograma escolhido e os discriminadores marcados, todos da versão publicada.
  const v = await tx.uma(
    `SELECT v.dados FROM protocolo_classificacao_risco_versao v
        WHERE v.id = ? AND EXISTS (SELECT 1 FROM protocolo_classificacao_estabelecimento pe
              WHERE pe.protocolo_classificacao_risco_id = v.protocolo_classificacao_risco_id
                AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL)`,
    [x.versaoProtocolo, x.estabelecimento],
  );
  if (!v) throw recusa('protocolo-inexistente', 'A versão do protocolo não existe neste estabelecimento.');
  // O fluxograma vem pelo código (recepção) ou pelo nome (registro clínico); o código é a chave dos discriminadores.
  const fluxo = await tx.uma(
    `SELECT id, codigo, nome FROM fluxograma_classificacao_risco
        WHERE protocolo_classificacao_risco_versao_id = ? AND (codigo = ? OR nome = ?) AND excluido_em IS NULL
        ORDER BY (codigo = ?) DESC, id LIMIT 1`,
    [x.versaoProtocolo, x.fluxograma, x.fluxograma, x.fluxograma],
  );
  if (!fluxo)
    throw recusa(
      'fluxograma-inexistente',
      'O fluxograma escolhido não está na versão publicada do protocolo.',
    );
  const codigoFluxo = txt(fluxo['codigo']) || x.fluxograma;
  const seqs = sequenciasDosDiscriminadores(json(v['dados']));
  const ds = await tx.consultar(
    'SELECT id, sequencia FROM discriminador_classificacao_risco WHERE fluxograma_classificacao_risco_id = ? AND excluido_em IS NULL',
    [num(fluxo['id'])],
  );
  const marcados = [...new Set(x.discriminadores)].map((cod) => {
    const seq = seqs.get(`${codigoFluxo}\u0000${cod}`);
    const d = seq === undefined ? undefined : ds.find((y) => num(y['sequencia']) === seq);
    if (!d)
      throw recusa(
        'discriminador-inexistente',
        `O discriminador "${cod}" não é do fluxograma escolhido nesta versão do protocolo. Abra de novo.`,
      );
    return num(d['id']);
  });
  const sobreposta = x.corProposta !== x.corFinal;
  const id = await tx.incluir('classificacao_risco', {
    estabelecimento_id: x.estabelecimento,
    atendimento_id: x.atendimento,
    paciente_id: x.paciente,
    protocolo_classificacao_risco_versao_id: x.versaoProtocolo,
    fluxograma_classificacao_risco_id: num(fluxo['id']),
    proposto_nivel_prioridade_id: await nivel(tx, x.corProposta),
    nivel_prioridade_id: await nivel(tx, x.corFinal),
    sobreposta,
    justificativa_sobreposicao: sobreposta ? (x.justificativa ?? '').slice(0, 500) || null : null,
    tempo_alvo_minutos: x.tempoAlvoMin,
    prazo_atendimento_em: new Date(agora.getTime() + x.tempoAlvoMin * 60_000),
    queixa_principal: x.queixa ?? txt(fluxo['nome']),
    classificador_profissional_id: x.classificador,
    inicio_em: agora,
    classificado_em: agora,
    situacao: 'concluida',
    anterior_classificacao_risco_id: x.anterior,
    motivo_reclassificacao_id: motivo,
    descricao_mudanca_quadro: x.descricaoMudanca?.slice(0, 500) ?? null,
    registro_assistencial_id: x.registro,
  });
  let n = 0;
  for (const d of marcados)
    await tx.incluir('classificacao_risco_resposta', {
      classificacao_risco_id: id,
      sequencia: ++n,
      discriminador_classificacao_risco_id: d,
      resposta: 'sim',
      decisivo: n === 1,
      respondido_em: agora,
    });
  await tx.incluir('classificacao_risco_evento', {
    classificacao_risco_id: id,
    operacao: 'inclusao',
    marco: x.anterior === null ? 'conclusao' : 'reclassificacao',
    ocorrido_em: agora,
    usuario_id: x.autorUsuario,
  });
  const sinais =
    x.motivo === 'estouro'
      ? 0
      : (
          await gravarAfericao(
            tx,
            { estabelecimento: x.estabelecimento, usuario: x.autorUsuario, fuso: x.fuso },
            {
              atendimento: x.atendimento,
              paciente: x.paciente,
              sinais: x.sinais,
              hora: x.horaSinais,
              profissional: x.classificador,
              classificacao: id,
            },
          )
        ).sinais;
  return { id, sinais };
}

export const opClassificar = definirOperacao({
  nome: 'classificacao.classificar',
  tabelas: [
    'classificacao_risco',
    'classificacao_risco_resposta',
    'classificacao_risco_evento',
    'afericao',
    'afericao_valor',
  ],
  entrada: esquemaClassificar,
  async gravar(tx, x) {
    const s = await sessao(tx);
    const autor = await exigirUsuario(tx, x.autor);
    const prof = await vinculoDoLogin(tx, x.autor);
    if (!prof)
      throw recusa('sem-vinculo-assistencial', 'O usuário não tem vínculo profissional ativo no cadastro.');
    const atendimento = Number(x.cabecalho);
    await exigirAtendimento(tx, s, atendimento, x.paciente);
    return gravarClassificacaoNaTx(tx, {
      estabelecimento: s.estabelecimento,
      fuso: s.fuso,
      atendimento,
      paciente: x.paciente,
      autorUsuario: autor,
      classificador: prof.vinculo,
      versaoProtocolo: x.versaoProtocolo,
      fluxograma: x.fluxograma,
      discriminadores: x.discriminadores,
      sinais: x.sinais,
      horaSinais: x.horaSinais,
      corProposta: x.corProposta,
      corFinal: x.corFinal,
      justificativa: x.justificativa,
      motivo: x.motivo,
      descricaoMudanca: x.descricaoMudanca,
      anterior: x.anterior,
      tempoAlvoMin: x.tempoAlvoMin,
      queixa: x.queixa,
      registro: x.e08.situacao === 'desligado' ? null : x.e08.registro,
    });
  },
  eventos: (x, r) => [
    {
      tipo: 'classificacao.risco_classificado',
      carga: { classificacao: r.id, atendimento: Number(x.cabecalho), cor: x.corFinal },
    },
  ],
  alvo: (_x, r) => ({ tabela: 'classificacao_risco', id: r.id }),
  trilha: (x) => ({ motivo: x.descricaoMudanca ?? null }),
});

// ── classificacao.registrar_sinais ───────────────────────────────────────────────────────────────

export const opRegistrarSinais = definirOperacao({
  nome: 'classificacao.registrar_sinais',
  tabelas: ['afericao', 'afericao_valor'],
  entrada: esquemaRegistrarSinais,
  async gravar(tx, r) {
    const s = await sessao(tx);
    await exigirUsuario(tx, r.autor);
    const atendimento = Number(r.cabecalho);
    await exigirAtendimento(tx, s, atendimento, r.paciente);
    const prof = await vinculoDoLogin(tx, r.autor);
    return gravarAfericao(tx, s, {
      atendimento,
      paciente: r.paciente,
      sinais: r.sinais,
      hora: r.horaSinais,
      profissional: prof?.vinculo ?? null,
      classificacao: null,
    });
  },
  alvo: (_r, x) => ({ tabela: 'afericao', id: x.afericao }),
});

// ── protocolo_gerenciado.publicar ────────────────────────────────────────────────────────────────

export const opPublicarGerenciado = definirOperacao({
  nome: 'protocolo_gerenciado.publicar',
  tabelas: ['sequencia_negocio', 'protocolo_gerenciado', 'protocolo_gerenciado_versao'],
  entrada: esquemaPublicarGerenciado,
  async gravar(tx, p) {
    const s = await sessao(tx);
    const agora = new Date();
    const tipo = tipoGerenciadoNoBanco(p.tipo);
    const autor = await exigirUsuario(tx, p.autor);
    await exigirUsuario(tx, p.aprovador);
    const [x] = await tx.consultarParaAtualizar(
      `SELECT id FROM protocolo_gerenciado WHERE tipo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
          AND excluido_em IS NULL ORDER BY estabelecimento_id DESC`,
      [tipo, s.estabelecimento],
      { teto: 1 },
    );
    let protocolo: number;
    if (x) protocolo = num(x['id']);
    else {
      await garantirSequencia(
        tx,
        { tipo: 'protocolo_gerenciado', estabelecimento: null, prefixo: 'PG-' },
        { usuario: s.usuario, agora },
      );
      const n = await tx.proximoNumero('protocolo_gerenciado', { porCliente: true });
      protocolo = await tx.incluir('protocolo_gerenciado', {
        estabelecimento_id: s.estabelecimento,
        codigo: n.formatado,
        nome: p.nome.slice(0, 150),
        tipo,
        situacao: 'ativo',
      });
    }
    const vs = await tx.consultarParaAtualizar(
      `SELECT id, versao, numero_versao, vigencia_inicio, vigencia_fim FROM protocolo_gerenciado_versao
        WHERE protocolo_gerenciado_id = ?`,
      [protocolo],
    );
    const versao = Math.max(0, ...vs.map((v) => num(v['numero_versao']))) + 1;
    await encerrarVigentes(tx, 'protocolo_gerenciado_versao', vs, agora);
    const id = await tx.incluir('protocolo_gerenciado_versao', {
      protocolo_gerenciado_id: protocolo,
      operacao: 'inclusao',
      dados: JSON.stringify(p.conteudo),
      ocorrido_em: agora,
      usuario_id: autor,
      numero_versao: versao,
      vigencia_inicio: agora,
      motivo: p.notas.slice(0, 500),
    });
    return { id, versao };
  },
  eventos: (p, r) => [{ tipo: 'protocolo_gerenciado.publicado', carga: { versao: r.id, tipo: p.tipo } }],
  alvo: (_p, r) => ({ tabela: 'protocolo_gerenciado_versao', id: r.id }),
});

// ── protocolo_gerenciado.incluir_paciente ────────────────────────────────────────────────────────

export const opIncluirProtocolo = definirOperacao({
  nome: 'protocolo_gerenciado.incluir_paciente',
  tabelas: ['inclusao_protocolo_paciente', 'inclusao_protocolo_criterio', 'inclusao_protocolo_etapa'],
  entrada: esquemaIncluirProtocolo,
  async gravar(tx, p) {
    const s = await sessao(tx);
    const autor = await exigirUsuario(tx, p.autor);
    const atendimento = Number(p.cabecalho);
    await exigirAtendimento(tx, s, atendimento, p.paciente);
    const v = await tx.uma(
      `SELECT v.protocolo_gerenciado_id FROM protocolo_gerenciado_versao v
         JOIN protocolo_gerenciado pg ON pg.id = v.protocolo_gerenciado_id
        WHERE v.id = ? AND pg.excluido_em IS NULL
          AND (pg.estabelecimento_id = ? OR pg.estabelecimento_id IS NULL)`,
      [p.gerenciado, s.estabelecimento],
    );
    if (!v)
      throw recusa(
        'protocolo-inexistente',
        'A versão do protocolo gerenciado não existe neste estabelecimento.',
      );
    const protocolo = num(v['protocolo_gerenciado_id']);
    const ja = await tx.consultarParaAtualizar(
      `SELECT id FROM inclusao_protocolo_paciente WHERE atendimento_id = ? AND protocolo_gerenciado_id = ?
          AND excluido_em IS NULL AND situacao IN ('sugerido','ativo')`,
      [atendimento, protocolo],
    );
    if (ja.length > 0) throw recusa('ja-incluido', 'O paciente já está neste protocolo neste atendimento.');
    const agora = new Date();
    const id = await tx.incluir('inclusao_protocolo_paciente', {
      estabelecimento_id: s.estabelecimento,
      protocolo_gerenciado_id: protocolo,
      paciente_id: p.paciente,
      atendimento_id: atendimento,
      forma_inclusao: FORMA_DA_ORIGEM[p.origem] ?? 'manual',
      horario_zero_em: instanteDaHoraCivil(p.chegadaEm, s.fuso),
      situacao: 'ativo',
      aceito_por_usuario_id: autor,
      aceito_em: agora,
    });
    let n = 0;
    for (const k of p.criterios)
      await tx.incluir('inclusao_protocolo_criterio', {
        inclusao_protocolo_paciente_id: id,
        sequencia: ++n,
        descricao: k.slice(0, 1000),
        identificador: k.slice(0, 100),
        atendido: true,
      });
    // As etapas com meta nascem com a inclusão (C2-042): o relógio de cada etapa começa no horário zero.
    await etapasNaInclusaoTx(tx, s.estabelecimento, id);
    return { id };
  },
  eventos: (p, r) => [
    {
      tipo: 'protocolo_gerenciado.paciente_incluido',
      carga: { inclusao: r.id, atendimento: Number(p.cabecalho) },
    },
  ],
  alvo: (_p, r) => ({ tabela: 'inclusao_protocolo_paciente', id: r.id }),
});
