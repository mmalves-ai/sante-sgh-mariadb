// Redação do laudo de imagem e de métodos gráficos e o laudo estruturado (F3.5, 05-SADT linhas 16 e 17) no banco do
// cliente. O médico abre o exame e vê, numa tela só, o paciente, o modelo sugerido (o dele primeiro), as medidas do
// exame com a faixa do paciente e o histórico de versões; salva o rascunho, ou salva e assina num clique. Depois de
// assinado, o texto só muda por retificação com motivo, que vira versão nova (a anterior fica). As medidas gravam em
// valor_grandeza_laudo com a marca de fora da referência; a medida retirada fica marcada como excluída (nunca apagada)
// e cada versão guarda a foto das medidas. A regra mora em @sgh/dominio-sadt (redacao.ts e estruturado.ts); cada
// gravação é uma operação do Executor com a trilha na mesma transação. Nenhum gatilho.
import {
  aplicarModelo,
  avaliarValores,
  avisoDoAchadoCritico,
  conferirPalavrasChave,
  destinatariosDaRetificacaoDoLaudo,
  exameAposAssinatura,
  mudancaDePalavras,
  PRAZO_ACHADO_CRITICO_MINUTOS,
  camposDoModelo,
  completarValoresCalculados,
  conferirAssinante,
  conferirDonoDoModelo,
  conferirExameParaLaudo,
  conferirRetificador,
  dataDoExame,
  conferirMotivoRetificacao,
  conferirTextoParaAssinar,
  ehMedico,
  type FaixaDaGrandeza,
  type FormulaDaGrandeza,
  type GrandezaDoLaudo,
  ordenarModelos,
  type PacienteDoExame,
  ORIGEM_DOCUMENTO_LAUDO,
  proximaVersao,
  RecusaLaudo,
  TIPO_DOCUMENTO_LAUDO,
  tituloDocumentoLaudo,
  assinaturaIcpDoLaudo,
  type AssinaturaIcpDoLaudo,
  type SituacaoLaudo,
  situacaoDepois,
  superficieCorporal,
  type ValorAvaliado,
  valoresParaModelo,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIAS_ASSINAVEIS } from '../../assinatura/aplicacao/regras-assinatura.js';
import { TIPOS_DOCUMENTO_ICP } from '../../assinatura/tipos.js';
import { lerFormulasDasGrandezas } from '../laudo-grandezas-propria.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';
import {
  buscarPorPalavras,
  filaDeLaudos,
  laudosAnteriores,
  modelosParaManutencao,
  pacienteDoExame,
  palavrasAtivas,
  palavrasDoLaudo,
  setoresDeLaudo,
  versaoDoLaudo,
} from './laudo-leituras.js';

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const valor = z.object({
  grandeza: id,
  numero: z.number().finite().nullable().default(null),
  texto: z.string().trim().max(500).nullable().default(null),
});
const corpoLaudo = {
  modelo: id.nullable().default(null),
  titulo: z.string().trim().max(500).nullable().default(null),
  texto: z.string().max(200_000).default(''),
  resultado: z.enum(['normal', 'alterado', 'inconclusivo']).nullable().default(null),
  achadoCritico: z.boolean().default(false),
  achadoCriticoDescricao: z.string().trim().max(500).nullable().default(null),
  pesoKg: z.number().positive().max(500).nullable().default(null),
  alturaCm: z.number().positive().max(260).nullable().default(null),
  valores: z.array(valor).max(500).default([]),
  /** As palavras-chave do laudo (ids do cadastro); sem o campo, as gravadas ficam como estão. */
  palavrasChave: z.array(id).max(100).nullable().default(null),
};
const semCriticoVazio = (x: { achadoCritico: boolean; achadoCriticoDescricao: string | null }) =>
  !x.achadoCritico || (x.achadoCriticoDescricao ?? '').length >= 5;
const msgCritico = {
  message: 'Descreva o achado crítico (ao menos 5 caracteres).',
  path: ['achadoCriticoDescricao'],
};

export const esquemaSalvarLaudo = z
  .object({ ...corpoLaudo, revisao: z.boolean().default(false) })
  .refine(semCriticoVazio, msgCritico);
export const esquemaAssinarLaudo = z.object(corpoLaudo).refine(semCriticoVazio, msgCritico);
export const esquemaRetificarLaudo = z
  .object({
    ...corpoLaudo,
    motivo: id.nullable().default(null),
    motivoTexto: z.string().trim().max(500).nullable().default(null),
  })
  .refine(semCriticoVazio, msgCritico);
export const esquemaModeloLaudo = z.object({
  id: id.nullable().default(null),
  codigo: z.string().trim().min(1).max(30),
  nome: z.string().trim().min(2).max(150),
  exame: id.nullable().default(null),
  setor: id.nullable().default(null),
  /** Modelo pessoal do médico da sessão (os outros não o veem como sugestão). */
  pessoal: z.boolean().default(false),
  tipo: z.enum(['texto', 'normal', 'alterado', 'conclusao', 'frase']).default('texto'),
  atalho: z.string().trim().max(30).nullable().default(null),
  texto: z.string().min(1).max(200_000),
  ativo: z.boolean().default(true),
});

// ── Saídas ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface LaudoEmRedacao {
  readonly exame: { item: number; exame: number; nome: string; setor: number; tipoSetor: string };
  readonly paciente: {
    id: number;
    sexo: 'feminino' | 'masculino' | null;
    idadeDias: number | null;
    /** A data do exame (realização, coleta ou pedido): a da faixa e da idade. */
    dataExame: string;
    nome: string;
    prontuario: string;
  };
  /** As palavras-chave vigentes do laudo e as do cadastro ativo (para a escolha na tela). */
  readonly palavrasChave: readonly number[];
  readonly palavras: readonly { id: number; codigo: string; descricao: string }[];
  /** Os laudos assinados anteriores do mesmo exame do paciente, para comparar. */
  readonly anteriores: readonly {
    item: number;
    assinadoEm: string | null;
    resultado: string | null;
    achadoCritico: boolean;
    texto: string;
  }[];
  readonly laudo: {
    id: number;
    situacao: SituacaoLaudo;
    titulo: string | null;
    texto: string;
    resultado: string | null;
    achadoCritico: boolean;
    achadoCriticoDescricao: string | null;
    modelo: number | null;
    versaoAtual: number;
    versao: number;
    /** O peso, a altura e a superfície gravados no laudo (a tela os traz de volta). */
    pesoKg: number | null;
    alturaCm: number | null;
    superficieCorporal: number | null;
  } | null;
  readonly versoes: readonly {
    numero: number;
    situacao: string;
    em: string;
    motivo: string | null;
    hash: string | null;
    /** C3-005: o documento do prontuário da versão e onde está a assinatura com certificado ICP-Brasil. */
    documento: number | null;
    assinaturaIcp: AssinaturaIcpDoLaudo;
  }[];
  readonly secoes: readonly { id: number; nome: string; ordem: number }[];
  readonly grandezas: readonly (GrandezaDoLaudo & { secao: number | null; sigla: string })[];
  readonly faixas: readonly FaixaDaGrandeza[];
  /** As fórmulas das medidas calculadas (a tela faz a mesma conta na hora, pela regra do domínio). */
  readonly formulas: readonly FormulaDaGrandeza[];
  readonly valores: readonly ValorAvaliado[];
  readonly modelos: readonly {
    id: number;
    nome: string;
    tipo: string;
    atalho: string | null;
    texto: string;
    campos: string[];
  }[];
  /** O que a regra libera na tela (o botão aparece só quando faz sentido). */
  readonly pode: { salvar: boolean; assinar: boolean; retificar: boolean };
}

export interface LaudoGravado {
  readonly id: number;
  readonly situacao: SituacaoLaudo;
  readonly versaoAtual: number;
  readonly valores: number;
  readonly foraReferencia: number;
  /** A assinatura liberou o exame (ele segue para a emissão). */
  readonly exameLiberado?: boolean;
  /** O que houve com o aviso do achado crítico e quantas pessoas foram avisadas (quem pediu; quem emitiu). */
  readonly avisoCritico?: 'abrir' | 'cancelar' | 'nada';
  readonly avisados?: number;
  /** Emissões do laudo anteriores a esta retificação (a via impressa deixou de ser a atual). */
  readonly emissoesSuperadas?: number;
}

// ── Utilitários ─────────────────────────────────────────────────────────────────────────────────────────────

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const sexoDe = (s: unknown) => {
  const x = texto(s).toUpperCase();
  return x === 'F' ? ('feminino' as const) : x === 'M' ? ('masculino' as const) : null;
};
/** Setores que não laudam por aqui: o laboratório e a agência usam o resultado próprio. */
/** O profissional da conta: pelo vínculo vigente da conta ou pela mesma pessoa. */
const DO_USUARIO = `(pr.pessoa_fisica_id = u.pessoa_fisica_id OR EXISTS (SELECT 1 FROM usuario_vinculo_profissional v
  WHERE v.usuario_id = u.id AND v.profissional_id = pr.id AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
    AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)))`;
const SEM_LAUDO = new Set(['laboratorio', 'agencia_transfusional']);

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaLaudo) throw recusa(e.codigo, e.message);
    throw e;
  }
}

/**
 * C3-005: o documento do prontuário (alias dp) está na fila de assinaturas com certificado do laudista, pelas mesmas
 * condições da fila (assinatura/porta-propria.ts, filaIcp; igual à da descrição cirúrgica): tipo que a fila conhece,
 * situação assinável, sem envelope e, sem tentativa, a política do estabelecimento exigindo ICP-Brasil para o tipo;
 * com tentativa pendente ou em falha, sempre.
 */
const SQL_NA_FILA_ICP = `(dp.documento_assinado_id IS NULL
    AND EXISTS (SELECT 1 FROM tipo_documento_clinico t WHERE t.id = dp.tipo_documento_clinico_id AND t.codigo IN (${TIPOS_DOCUMENTO_ICP.map(() => '?').join(', ')}))
    AND EXISTS (SELECT 1 FROM situacao_documento_prontuario s WHERE s.id = dp.situacao_documento_prontuario_id
                 AND s.categoria IN (${CATEGORIAS_ASSINAVEIS.map(() => '?').join(', ')}))
    AND (EXISTS (SELECT 1 FROM assinatura_icp ai WHERE ai.documento_prontuario_id = dp.id
                  AND ai.origem_assinatura = 'documento' AND ai.situacao IN ('pendente', 'falha'))
         OR EXISTS (SELECT 1 FROM regra_politica_assinatura r
                      JOIN politica_assinatura p ON p.id = r.politica_assinatura_id
                     WHERE p.tipo_documento_clinico_id = dp.tipo_documento_clinico_id
                       AND p.estabelecimento_id = dp.estabelecimento_id AND p.ativo AND r.vigente = 1
                       AND r.nivel = 'icp-brasil' AND r.destino = 'interno')))`;
const PARAMETROS_NA_FILA_ICP: readonly string[] = [...TIPOS_DOCUMENTO_ICP, ...CATEGORIAS_ASSINAVEIS];

const TABELAS = [
  'laudo_diagnostico',
  'laudo_diagnostico_versao',
  'valor_grandeza_laudo',
  'modelo_laudo',
  'laudo_palavra_chave',
  'exame_item',
  'aviso_valor_critico',
  'aviso_clinico',
  'aviso_clinico_destinatario',
  'documento_prontuario',
  'documento_prontuario_evento',
  'exame_item_assinatura',
];

interface MedidasPaciente {
  pesoKg: number | null;
  alturaCm: number | null;
  superficieCorporal: number | null;
}

interface Base {
  item: number;
  exame: number;
  nomeExame: string;
  setor: number;
  tipoSetor: string;
  paciente: number;
  sexo: 'feminino' | 'masculino' | null;
  idadeDias: number | null;
  situacao: string;
  realizadoEm: string | null;
  dataExame: string;
}

/** O conteúdo coberto pelo hash da versão (exportado para a conferência reproduzir o hash a partir do banco). */
export function hashDaVersao(c: {
  titulo: string | null;
  texto: string;
  resultado: string | null;
  achadoCritico: boolean;
  paciente: { pesoKg: number | null; alturaCm: number | null; superficieCorporal: number | null };
  valores: readonly { grandeza: number; numero: number | null; texto: string | null; fora: boolean }[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        texto: c.texto,
        titulo: c.titulo,
        resultado: c.resultado,
        achadoCritico: c.achadoCritico,
        paciente: c.paciente,
        valores: c.valores,
      }),
    )
    .digest('hex');
}

// ── Serviço ─────────────────────────────────────────────────────────────────────────────────────────────────

export class ServicoLaudoRedacao {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar<T extends { readonly id: number }>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(tx, est) };
        return { valor: JSON.stringify(saida.valor) };
      },
      alvo: () => ({ tabela, id: saida ? saida.valor.id : null }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-laudo:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return (saida as { valor: T }).valor;
    const v = r.resultado['valor'];
    return (typeof v === 'string' ? JSON.parse(v) : null) as T;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  private async base(l: Leitor, est: number, item: number): Promise<Base> {
    const r = await l.uma(
      `SELECT ei.id, ei.exame_id, ex.nome AS exame_nome, COALESCE(ei.setor_diagnostico_id, q.setor_diagnostico_id) AS setor,
              sd.tipo AS tipo_setor, q.paciente_id, sx.sigla AS sexo, ei.situacao, ei.realizado_em, ei.coletado_em, q.solicitado_em,
              DATEDIFF(DATE(COALESCE(ei.realizado_em, ei.coletado_em, q.solicitado_em)), pf.data_nascimento) AS idade_dias
         FROM exame_item ei
         JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
         JOIN exame ex ON ex.id = ei.exame_id
         JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, q.setor_diagnostico_id)
         JOIN paciente pa ON pa.id = q.paciente_id
         JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
         LEFT JOIN sexo sx ON sx.id = pf.sexo_id
        WHERE ei.id = ? AND q.estabelecimento_id = ? AND ei.excluido_em IS NULL AND q.excluido_em IS NULL`,
      [item, est],
    );
    if (!r) throw recusa('exame-inexistente', 'O exame não existe neste estabelecimento.');
    if (SEM_LAUDO.has(texto(r['tipo_setor'])))
      throw recusa(
        'setor-sem-laudo',
        'Este exame é de laboratório: o resultado é digitado e liberado na bancada.',
      );
    return {
      item,
      exame: n(r['exame_id']),
      nomeExame: texto(r['exame_nome']),
      setor: n(r['setor']),
      tipoSetor: texto(r['tipo_setor']),
      paciente: n(r['paciente_id']),
      sexo: sexoDe(r['sexo']),
      idadeDias: nn(r['idade_dias']),
      situacao: texto(r['situacao']),
      realizadoEm: dataIso(r['realizado_em']),
      dataExame: dataDoExame(
        dataIso(r['realizado_em']),
        dataIso(r['coletado_em']),
        dataIso(r['solicitado_em']) ?? new Date().toISOString(),
      ),
    };
  }

  /** O profissional é responsável vigente do setor pelos laudos (assina, revisa ou responde tecnicamente)? */
  private async responsavelDoSetor(l: Leitor, setor: number, exame: number, profissional: number) {
    const r = await l.uma(
      `SELECT id FROM responsavel_laudo_setor
        WHERE setor_diagnostico_id = ? AND profissional_id = ? AND (exame_id IS NULL OR exame_id = ?)
          AND (assina_laudo OR revisa_laudo OR responsavel_tecnico) AND excluido_em IS NULL
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        LIMIT 1`,
      [setor, profissional, exame],
    );
    return r !== null && r !== undefined;
  }

  private async catalogo(l: Leitor, exame: number) {
    const grandezas = (
      await l.consultar(
        `SELECT id, codigo, COALESCE(sigla, codigo) AS sigla, descricao, casas_decimais, obrigatoria, calculada, ordem,
                unidade_resultado_id, secao_laudo_estruturado_id
           FROM grandeza_laudo WHERE exame_id = ? AND ativo = TRUE ORDER BY ordem, id`,
        [exame],
        { teto: 500 },
      )
    ).map((r) => ({
      id: n(r['id']),
      codigo: texto(r['codigo']),
      sigla: texto(r['sigla']),
      descricao: texto(r['descricao']),
      casasDecimais: nn(r['casas_decimais']),
      obrigatoria: Boolean(r['obrigatoria']),
      calculada: Boolean(r['calculada']),
      ordem: n(r['ordem']),
      unidade: nn(r['unidade_resultado_id']),
      secao: nn(r['secao_laudo_estruturado_id']),
    }));
    const faixas: FaixaDaGrandeza[] = (
      await l.consultar(
        `SELECT f.*, sx.sigla AS sexo FROM faixa_referencia_grandeza f JOIN grandeza_laudo g ON g.id = f.grandeza_laudo_id
           LEFT JOIN sexo sx ON sx.id = f.sexo_id
          WHERE g.exame_id = ? AND f.ativo = TRUE ORDER BY f.grandeza_laudo_id, f.vigencia_inicio`,
        [exame],
        { teto: 2000 },
      )
    ).map((r) => ({
      grandeza: n(r['grandeza_laudo_id']),
      sexo: sexoDe(r['sexo']),
      idadeMinimaDias: nn(r['idade_minima_dias']),
      idadeMaximaDias: nn(r['idade_maxima_dias']),
      pesoMinimoKg: nn(r['peso_minimo_kg']),
      pesoMaximoKg: nn(r['peso_maximo_kg']),
      superficieMinima: nn(r['superficie_corporal_minima']),
      superficieMaxima: nn(r['superficie_corporal_maxima']),
      minima: nn(r['referencia_minima']),
      maxima: nn(r['referencia_maxima']),
      indexadaSuperficie: Boolean(r['indexada_superficie']),
      vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '1900-01-01',
      vigenciaFim: dataIso(r['vigencia_fim']),
    }));
    const secoes = (
      await l.consultar(
        'SELECT id, nome, ordem FROM secao_laudo_estruturado WHERE exame_id = ? AND ativo = TRUE ORDER BY ordem, id',
        [exame],
        { teto: 100 },
      )
    ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']), ordem: n(r['ordem']) }));
    // A medida calculada sai da fórmula vigente na data do exame (grandeza-calculada.ts); o digitado nela é ignorado.
    const formulas = await lerFormulasDasGrandezas(l, exame);
    return { grandezas, faixas, secoes, formulas };
  }

  /** O profissional da sessão com o vínculo que assina (o de médico ativo primeiro). */
  private async assinante(l: Leitor, usuario: number | null) {
    if (usuario === null) return null;
    const vs = await l.consultar(
      `SELECT pr.id, COALESCE(oc.codigo_cbo, '') AS cbo, (ic.situacao = 'ativa' AND pr.situacao = 'ativo') AS ativo
         FROM usuario u
         JOIN profissional pr ON pr.excluido_em IS NULL AND ${DO_USUARIO}
         JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
         LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
        WHERE u.id = ? AND u.excluido_em IS NULL ORDER BY ic.principal DESC, ic.id`,
      [usuario],
      { teto: 20 },
    );
    const lista = vs.map((r) => ({
      profissional: n(r['id']),
      cbo: texto(r['cbo']),
      conselhoAtivo: Boolean(n(r['ativo'])),
    }));
    return lista.find((v) => v.conselhoAtivo && ehMedico(v.cbo)) ?? lista[0] ?? null;
  }

  private async profissionalDoUsuario(l: Leitor, usuario: number | null): Promise<number | null> {
    if (usuario === null) return null;
    const r = await l.uma(
      `SELECT pr.id FROM usuario u JOIN profissional pr ON pr.excluido_em IS NULL AND ${DO_USUARIO}
        WHERE u.id = ? ORDER BY pr.id LIMIT 1`,
      [usuario],
    );
    return r ? n(r['id']) : null;
  }

  private paciente(b: Base, pesoKg: number | null, alturaCm: number | null): PacienteDoExame {
    return {
      sexo: b.sexo,
      idadeDias: b.idadeDias,
      pesoKg,
      alturaCm,
      dataExame: b.dataExame,
    };
  }

  /** Tudo o que a tela do laudo precisa, numa leitura. */
  abrir(c: ContextoSadt, item: number): Promise<LaudoEmRedacao> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const b = await this.base(l, est, item);
      const cat = await this.catalogo(l, b.exame);
      const ld = await l.uma(
        `SELECT id, situacao, titulo, texto, resultado, achado_critico, achado_critico_descricao, modelo_laudo_id,
                versao_atual, versao, peso_kg, altura_cm, superficie_corporal
           FROM laudo_diagnostico WHERE exame_item_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [item, est],
      );
      const laudo = ld
        ? {
            id: n(ld['id']),
            situacao: texto(ld['situacao']) as SituacaoLaudo,
            titulo: textoOuNulo(ld['titulo']),
            texto: texto(ld['texto']),
            resultado: textoOuNulo(ld['resultado']),
            achadoCritico: Boolean(ld['achado_critico']),
            achadoCriticoDescricao: textoOuNulo(ld['achado_critico_descricao']),
            modelo: nn(ld['modelo_laudo_id']),
            versaoAtual: n(ld['versao_atual']),
            versao: n(ld['versao']),
            pesoKg: nn(ld['peso_kg']),
            alturaCm: nn(ld['altura_cm']),
            superficieCorporal: nn(ld['superficie_corporal']),
          }
        : null;
      const versoes = laudo
        ? (
            await l.consultar(
              `SELECT v.numero_versao, v.situacao, v.ocorrido_em, COALESCE(m.descricao, v.motivo) AS motivo, v.hash_sha256,
                      dp.id AS documento,
                      (dp.documento_assinado_id IS NOT NULL AND EXISTS (SELECT 1 FROM documento_assinado da
                         WHERE da.id = dp.documento_assinado_id AND da.situacao = 'assinado')) AS envelope_assinado,
                      (dp.id IS NOT NULL AND ${SQL_NA_FILA_ICP}) AS na_fila
                 FROM laudo_diagnostico_versao v LEFT JOIN motivo_retificacao_laudo m ON m.id = v.motivo_retificacao_laudo_id
                 LEFT JOIN documento_prontuario dp ON dp.entidade_origem = ? AND dp.entidade_origem_id = v.id
                       AND dp.numero_versao = 1 AND dp.excluido_em IS NULL
                WHERE v.laudo_diagnostico_id = ? ORDER BY v.numero_versao DESC`,
              [...PARAMETROS_NA_FILA_ICP, ORIGEM_DOCUMENTO_LAUDO, laudo.id],
              { teto: 200 },
            )
          ).map((r) => ({
            numero: n(r['numero_versao']),
            situacao: texto(r['situacao']),
            em: r['ocorrido_em'] instanceof Date ? r['ocorrido_em'].toISOString() : texto(r['ocorrido_em']),
            motivo: textoOuNulo(r['motivo']),
            hash: textoOuNulo(r['hash_sha256']),
            documento: nn(r['documento']),
            assinaturaIcp: assinaturaIcpDoLaudo({
              documento: nn(r['documento']),
              envelopeAssinado: Boolean(Number(r['envelope_assinado'] ?? 0)),
              naFila: Boolean(Number(r['na_fila'] ?? 0)),
            }),
          }))
        : [];
      const brutos = laudo
        ? (
            await l.consultar(
              `SELECT grandeza_laudo_id, valor_numerico, valor_texto FROM valor_grandeza_laudo
                WHERE laudo_diagnostico_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
              [laudo.id],
              { teto: 500 },
            )
          ).map((r) => ({
            grandeza: n(r['grandeza_laudo_id']),
            numero: nn(r['valor_numerico']),
            texto: textoOuNulo(r['valor_texto']),
          }))
        : [];
      const valores = daRegra(() =>
        avaliarValores(
          cat.grandezas,
          brutos.filter((v) => cat.grandezas.some((g) => g.id === v.grandeza)),
          cat.faixas,
          this.paciente(b, laudo?.pesoKg ?? null, laudo?.alturaCm ?? null),
        ),
      );
      const profissional = await this.profissionalDoUsuario(l, c.usuario);
      const modelos = ordenarModelos(
        (
          await l.consultar(
            `SELECT id, nome, tipo, atalho, texto, exame_id, setor_diagnostico_id, profissional_id FROM modelo_laudo
              WHERE estabelecimento_id = ? AND ativo = TRUE AND (exame_id = ? OR exame_id IS NULL)
                AND (setor_diagnostico_id = ? OR setor_diagnostico_id IS NULL)`,
            [est, b.exame, b.setor],
            { teto: 300 },
          )
        ).map((r) => ({
          id: n(r['id']),
          nome: texto(r['nome']),
          tipo: texto(r['tipo']),
          atalho: textoOuNulo(r['atalho']),
          texto: texto(r['texto']),
          campos: camposDoModelo(texto(r['texto'])),
          exame: nn(r['exame_id']),
          setor: nn(r['setor_diagnostico_id']),
          profissional: nn(r['profissional_id']),
        })),
        { exame: b.exame, setor: b.setor, profissional },
      ).map(({ id: i, nome, tipo, atalho, texto: t, campos }) => ({
        id: i,
        nome,
        tipo,
        atalho,
        texto: t,
        campos,
      }));
      const s = laudo?.situacao ?? null;
      const tenta = (a: 'salvar' | 'retificar') => {
        try {
          situacaoDepois(s, a);
          return true;
        } catch {
          return false;
        }
      };
      return {
        exame: { item, exame: b.exame, nome: b.nomeExame, setor: b.setor, tipoSetor: b.tipoSetor },
        paciente: {
          id: b.paciente,
          sexo: b.sexo,
          idadeDias: b.idadeDias,
          dataExame: b.dataExame,
          ...(await pacienteDoExame(l, b.paciente)),
        },
        palavrasChave: laudo ? await palavrasDoLaudo(l, laudo.id) : [],
        palavras: await palavrasAtivas(l),
        anteriores: await laudosAnteriores(l, est, b.paciente, b.exame, item),
        laudo,
        versoes,
        secoes: cat.secoes,
        grandezas: cat.grandezas,
        faixas: cat.faixas,
        formulas: cat.formulas,
        valores,
        modelos,
        pode: { salvar: tenta('salvar'), assinar: tenta('salvar'), retificar: tenta('retificar') },
      };
    });
  }

  /** Os motivos de retificação ativos (cadastro). */
  motivosRetificacao(c: ContextoSadt) {
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) =>
      (
        await l.consultar(
          'SELECT id, codigo, descricao FROM motivo_retificacao_laudo WHERE ativo = TRUE ORDER BY descricao',
          [],
          {
            teto: 200,
          },
        )
      ).map((r) => ({ id: n(r['id']), codigo: texto(r['codigo']), descricao: texto(r['descricao']) })),
    );
  }

  /** Pré-visualização do modelo com as medidas informadas (nada gravado): o texto e os campos que faltam. */
  previaModelo(
    c: ContextoSadt,
    item: number,
    modelo: number,
    entrada: { valores: z.infer<typeof valor>[]; pesoKg: number | null; alturaCm: number | null },
  ) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const b = await this.base(l, est, item);
      const m = await l.uma(
        'SELECT texto FROM modelo_laudo WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
        [modelo, est],
      );
      if (!m) throw recusa('modelo-inexistente', 'O modelo não existe ou está inativo.');
      const cat = await this.catalogo(l, b.exame);
      const p = this.paciente(b, entrada.pesoKg, entrada.alturaCm);
      const av = daRegra(() =>
        avaliarValores(
          cat.grandezas,
          completarValoresCalculados(cat.grandezas, entrada.valores, cat.formulas, p),
          cat.faixas,
          p,
        ),
      );
      const sc = superficieCorporal(p.pesoKg, p.alturaCm);
      return aplicarModelo(texto(m['texto']), {
        ...valoresParaModelo(cat.grandezas, av),
        exame: b.nomeExame,
        superficie_corporal: sc === null ? null : sc.toFixed(2).replace('.', ','),
        peso: p.pesoKg,
        altura: p.alturaCm,
      });
    });
  }

  /** A lista de trabalho de quem lauda (exames realizados sem laudo assinado) e os setores para o filtro. */
  fila(c: ContextoSadt, setor: number | null) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => ({
      itens: await filaDeLaudos(l, est, setor),
      setores: await setoresDeLaudo(l, est),
    }));
  }

  /** O texto inteiro de uma versão anterior do laudo. */
  versaoAnterior(c: ContextoSadt, item: number, numero: number) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      await this.base(l, est, item);
      return versaoDoLaudo(l, est, item, numero);
    });
  }

  /** As palavras-chave ativas do cadastro. */
  palavrasChave(c: ContextoSadt) {
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => palavrasAtivas(l));
  }

  /** Busca de casos pelas palavras-chave (os laudos assinados que têm todas). */
  buscar(c: ContextoSadt, palavras: readonly number[]) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => buscarPorPalavras(l, est, palavras));
  }

  /** Os modelos para a manutenção (os do estabelecimento e os pessoais de quem está na sessão). */
  modelos(c: ContextoSadt) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) =>
      modelosParaManutencao(l, est, await this.profissionalDoUsuario(l, c.usuario)),
    );
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Grava as palavras-chave do laudo: a nova entra, a que voltou é reativada e a retirada fica marcada (nunca apaga). */
  private async gravarPalavras(tx: TxOperacao, laudo: number, pedidas: readonly number[] | null) {
    if (pedidas === null) return;
    const gravadas = (
      await tx.consultarParaAtualizar(
        'SELECT id, palavra_chave_laudo_id, versao, excluido_em FROM laudo_palavra_chave WHERE laudo_diagnostico_id = ?',
        [laudo],
        { teto: 1000 },
      )
    ).map((r) => ({
      id: n(r['id']),
      palavra: n(r['palavra_chave_laudo_id']),
      versao: n(r['versao']),
      excluida: r['excluido_em'] !== null,
    }));
    // A palavra já vigente no laudo continua aceita mesmo se o cadastro a desativou depois; a nova tem de estar ativa.
    const aceitas = new Set([
      ...(
        await tx.consultar('SELECT id FROM palavra_chave_laudo WHERE ativo = TRUE', [], { teto: 5000 })
      ).map((r) => n(r['id'])),
      ...gravadas.filter((g) => !g.excluida).map((g) => g.palavra),
    ]);
    const quer = daRegra(() => conferirPalavrasChave(pedidas, aceitas));
    const m = mudancaDePalavras(gravadas, quer);
    const versaoDe = (i: number) => gravadas.find((g) => g.id === i)!.versao;
    for (const palavra of m.incluir)
      await tx.incluir('laudo_palavra_chave', {
        laudo_diagnostico_id: laudo,
        palavra_chave_laudo_id: palavra,
      });
    for (const i of m.reativar)
      await tx.alterar('laudo_palavra_chave', i, versaoDe(i), { excluido_em: null, excluido_por: null });
    for (const i of m.retirar)
      await tx.alterar('laudo_palavra_chave', i, versaoDe(i), {
        excluido_em: new Date(),
        excluido_por: tx.contexto.usuario,
      });
  }

  /** O atendimento do pedido e as contas de quem pediu o exame (para os avisos). */
  private async pedido(tx: TxOperacao, item: number) {
    const q = await tx.uma(
      `SELECT q.atendimento_id, q.solicitante_profissional_id FROM exame_item ei
         JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id WHERE ei.id = ?`,
      [item],
    );
    const prof = nn(q?.['solicitante_profissional_id']);
    const solicitantes =
      prof === null
        ? []
        : (
            await tx.consultar(
              `SELECT u.id FROM usuario u JOIN profissional pr ON pr.id = ? AND ${DO_USUARIO}
                WHERE u.excluido_em IS NULL ORDER BY u.id`,
              [prof],
              { teto: 5 },
            )
          ).map((r) => n(r['id']));
    return { atendimento: nn(q?.['atendimento_id']), solicitantes };
  }

  /** Aviso clínico com destinatários, ligado ao laudo; devolve quantos foram avisados (sem destinatário, nada grava). */
  private async avisoClinico(
    tx: TxOperacao,
    est: number,
    b: Base,
    laudo: number,
    atendimento: number | null,
    a: { titulo: string; mensagem: string; prioridade: 'alta' | 'critica' },
    destinatarios: readonly number[],
  ): Promise<number> {
    if (destinatarios.length === 0) return 0;
    const aviso = await tx.incluir('aviso_clinico', {
      estabelecimento_id: est,
      paciente_id: b.paciente,
      atendimento_id: atendimento,
      titulo: a.titulo,
      mensagem: a.mensagem.slice(0, 2000),
      prioridade: a.prioridade,
      canal: 'sistema',
      situacao: 'pendente',
      gerado_em: new Date(),
      modulo_origem: 'sadt.laudo',
      entidade_origem: 'laudo_diagnostico',
      entidade_origem_chave: laudo,
    });
    let sequencia = 0;
    for (const usuario of destinatarios)
      await tx.incluir('aviso_clinico_destinatario', {
        aviso_clinico_id: aviso,
        sequencia: ++sequencia,
        usuario_id: usuario,
        canal: 'sistema',
        situacao: 'pendente',
      });
    return destinatarios.length;
  }

  /**
   * O achado crítico do laudo assinado abre o aviso crítico (o mesmo painel e a mesma comunicação do valor crítico do
   * laboratório, com o prazo da regra do exame) e avisa quem pediu o exame; a retificação que mantém o achado não
   * repete o aviso, e a que o retira cancela o aviso ainda não comunicado (sem apagar).
   */
  private async avisarAchadoCritico(
    tx: TxOperacao,
    est: number,
    b: Base,
    laudo: number,
    p: { achadoCritico: boolean; achadoCriticoDescricao: string | null },
  ): Promise<{ acao: 'abrir' | 'cancelar' | 'nada'; avisados: number }> {
    const avisos = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao FROM aviso_valor_critico WHERE laudo_diagnostico_id = ? AND excluido_em IS NULL',
      [laudo],
      { teto: 100 },
    );
    const acao = avisoDoAchadoCritico(
      p.achadoCritico,
      avisos.map((a) => ({ situacao: texto(a['situacao']) })),
    );
    if (acao === 'cancelar') {
      for (const a of avisos)
        if (['pendente', 'em_contato', 'escalonado'].includes(texto(a['situacao'])))
          await tx.alterar('aviso_valor_critico', n(a['id']), n(a['versao']), {
            situacao: 'cancelado',
            observacao: 'Achado crítico retirado na retificação do laudo, antes da comunicação.',
          });
      return { acao, avisados: 0 };
    }
    if (acao !== 'abrir') return { acao, avisados: 0 };
    const agora = new Date();
    const regra = await tx.uma(
      `SELECT id, prazo_comunicacao_minutos FROM regra_valor_critico
        WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo = TRUE AND exame_id = ?
          AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
        ORDER BY estabelecimento_id IS NULL, id LIMIT 1`,
      [est, b.exame, agora, agora],
    );
    const minutos = nn(regra?.['prazo_comunicacao_minutos']) ?? PRAZO_ACHADO_CRITICO_MINUTOS;
    await tx.incluir('aviso_valor_critico', {
      estabelecimento_id: est,
      laudo_diagnostico_id: laudo,
      paciente_id: b.paciente,
      regra_valor_critico_id: regra ? n(regra['id']) : null,
      gerado_em: agora,
      prazo_em: new Date(agora.getTime() + minutos * 60_000),
      situacao: 'pendente',
      nivel_escalonamento: 0,
    });
    const { atendimento, solicitantes } = await this.pedido(tx, b.item);
    const avisados = await this.avisoClinico(
      tx,
      est,
      b,
      laudo,
      atendimento,
      {
        titulo: 'Achado crítico em laudo',
        mensagem: `O laudo de ${b.nomeExame} que você pediu tem achado crítico: ${p.achadoCriticoDescricao ?? ''}`,
        prioridade: 'critica',
      },
      solicitantes.filter((u) => u !== tx.contexto.usuario),
    );
    return { acao, avisados };
  }

  /** Grava as medidas do laudo: atualiza a da mesma grandeza, inclui a nova e marca a retirada (nunca apaga). */
  private async gravarValores(tx: TxOperacao, laudo: number, av: readonly ValorAvaliado[]): Promise<void> {
    const atuais = await tx.consultarParaAtualizar(
      'SELECT id, grandeza_laudo_id, sequencia, versao, excluido_em FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ?',
      [laudo],
      { teto: 1000 },
    );
    const porGrandeza = new Map(atuais.map((r) => [n(r['grandeza_laudo_id']), r]));
    let ultima = Math.max(0, ...atuais.map((r) => n(r['sequencia'])));
    const agora = new Date();
    const usuario = tx.contexto.usuario;
    for (const v of av) {
      const dados = {
        valor_numerico: v.numero,
        valor_texto: v.texto,
        unidade_resultado_id: v.unidade,
        calculado: v.calculado,
        fora_referencia: v.foraReferencia,
      };
      const r = porGrandeza.get(v.grandeza);
      if (r)
        await tx.alterar('valor_grandeza_laudo', n(r['id']), n(r['versao']), {
          ...dados,
          excluido_em: null,
          excluido_por: null,
        });
      else
        await tx.incluir('valor_grandeza_laudo', {
          laudo_diagnostico_id: laudo,
          sequencia: ++ultima,
          grandeza_laudo_id: v.grandeza,
          ...dados,
        });
    }
    const ficam = new Set(av.map((v) => v.grandeza));
    for (const r of atuais)
      if (!ficam.has(n(r['grandeza_laudo_id'])) && r['excluido_em'] === null)
        await tx.alterar('valor_grandeza_laudo', n(r['id']), n(r['versao']), {
          excluido_em: agora,
          excluido_por: usuario,
        });
  }

  /** Lê e trava o laudo do exame (ou nada) e avalia as medidas contra o catálogo. */
  private async preparar(
    tx: TxOperacao,
    est: number,
    item: number,
    p: z.infer<typeof esquemaAssinarLaudo>,
    exigirObrigatorias: boolean,
  ) {
    const b = await this.base(tx, est, item);
    daRegra(() => conferirExameParaLaudo(b.situacao, b.realizadoEm));
    const [ld] = await tx.consultarParaAtualizar(
      `SELECT id, situacao, versao, versao_atual, peso_kg, altura_cm, laudista_profissional_id FROM laudo_diagnostico
        WHERE exame_item_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [item, est],
      { teto: 1 },
    );
    // Sem peso e altura novos, valem os gravados no laudo: a retificação sem redigitar mantém a mesma avaliação.
    const herda = p.pesoKg === null && p.alturaCm === null && ld;
    const pesoKg = herda ? nn(ld['peso_kg']) : p.pesoKg;
    const alturaCm = herda ? nn(ld['altura_cm']) : p.alturaCm;
    const medidas = { pesoKg, alturaCm, superficieCorporal: superficieCorporal(pesoKg, alturaCm) };
    const cat = await this.catalogo(tx, b.exame);
    const pac = this.paciente(b, pesoKg, alturaCm);
    const av = daRegra(() =>
      avaliarValores(
        cat.grandezas,
        completarValoresCalculados(cat.grandezas, p.valores, cat.formulas, pac),
        cat.faixas,
        pac,
        exigirObrigatorias,
      ),
    );
    if (p.modelo !== null) {
      const m = await tx.uma(
        'SELECT id FROM modelo_laudo WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
        [p.modelo, est],
      );
      if (!m)
        throw recusa('modelo-inexistente', 'O modelo não existe neste estabelecimento ou está inativo.');
    }
    return { b, ld: ld ?? null, av, medidas };
  }

  private campos(p: z.infer<typeof esquemaAssinarLaudo>, m: MedidasPaciente) {
    return {
      peso_kg: m.pesoKg,
      altura_cm: m.alturaCm,
      superficie_corporal: m.superficieCorporal,
      modelo_laudo_id: p.modelo,
      titulo: p.titulo,
      texto: p.texto,
      resultado: p.resultado,
      achado_critico: p.achadoCritico,
      achado_critico_descricao: p.achadoCritico ? p.achadoCriticoDescricao : null,
    };
  }

  /** Inclui ou altera o laudo (rascunho) e grava as medidas; devolve o id. */
  private async gravarRascunho(
    tx: TxOperacao,
    est: number,
    b: Base,
    ld: Linha | null,
    p: z.infer<typeof esquemaAssinarLaudo>,
    situacao: SituacaoLaudo,
    av: readonly ValorAvaliado[],
    m: MedidasPaciente,
  ): Promise<number> {
    let laudo: number;
    if (ld) {
      laudo = n(ld['id']);
      await tx.alterar('laudo_diagnostico', laudo, n(ld['versao']), { ...this.campos(p, m), situacao });
    } else {
      laudo = await tx.incluir('laudo_diagnostico', {
        estabelecimento_id: est,
        exame_item_id: b.item,
        paciente_id: b.paciente,
        setor_diagnostico_id: b.setor,
        tipo_laudo: 'definitivo',
        situacao,
        versao_atual: 1,
        ...this.campos(p, m),
      });
    }
    await this.gravarValores(tx, laudo, av);
    await this.gravarPalavras(tx, laudo, p.palavrasChave);
    return laudo;
  }

  private async versao(
    tx: TxOperacao,
    laudo: number,
    situacao: 'assinado' | 'retificado',
    p: z.infer<typeof esquemaAssinarLaudo>,
    av: readonly ValorAvaliado[],
    profissional: number,
    motivo: { id: number | null; texto: string | null },
    m: MedidasPaciente,
  ): Promise<number> {
    const nums = (
      await tx.consultar(
        'SELECT numero_versao FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ?',
        [laudo],
        {
          teto: 1000,
        },
      )
    ).map((r) => n(r['numero_versao']));
    const numero = proximaVersao(nums);
    const foto = av.map((v) => ({
      grandeza: v.grandeza,
      numero: v.numero,
      texto: v.texto,
      fora: v.foraReferencia,
    }));
    const hash = hashDaVersao({
      titulo: p.titulo,
      texto: p.texto,
      resultado: p.resultado,
      achadoCritico: p.achadoCritico,
      paciente: m,
      valores: foto,
    });
    await tx.incluir('laudo_diagnostico_versao', {
      laudo_diagnostico_id: laudo,
      operacao: numero === 1 ? 'inclusao' : 'alteracao',
      dados: JSON.stringify({
        valores: foto,
        resultado: p.resultado,
        achadoCritico: p.achadoCritico,
        achadoCriticoDescricao: p.achadoCritico ? p.achadoCriticoDescricao : null,
        paciente: m,
      }),
      ocorrido_em: new Date(),
      usuario_id: tx.contexto.usuario,
      numero_versao: numero,
      situacao,
      titulo: p.titulo,
      texto: p.texto,
      laudista_profissional_id: profissional,
      motivo_retificacao_laudo_id: motivo.id,
      motivo: motivo.texto,
      hash_sha256: hash,
    });
    return numero;
  }

  /**
   * C3-005: a versão assinada ou retificada vira um documento do prontuário do paciente (tipo do registro clínico,
   * situação "lançado"), ligado ao exame em exame_item_assinatura. É por ele que o médico assina com certificado
   * ICP-Brasil na fila de assinaturas (nuvem por PSC, A3 ou A1), quando a política do estabelecimento exige; sem
   * tipo ou situação no cadastro, fica a assinatura eletrônica avançada do clique (devolve null).
   */
  private async documentoDaVersao(
    tx: TxOperacao,
    est: number,
    b: Base,
    laudo: number,
    numero: number,
    situacao: 'assinado' | 'retificado',
    profissional: number,
    p: { titulo: string | null; texto: string; resultado: string | null; achadoCritico: boolean },
  ): Promise<number | null> {
    const tipo = await tx.uma(
      'SELECT id FROM tipo_documento_clinico WHERE ativo = TRUE AND codigo = ? ORDER BY id LIMIT 1',
      [TIPO_DOCUMENTO_LAUDO],
    );
    const lancado = await tx.uma(
      `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE
        ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
    );
    const ver = await tx.uma(
      'SELECT id FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ? AND numero_versao = ?',
      [laudo, numero],
    );
    if (!tipo || !lancado || !ver) return null;
    const { atendimento } = await this.pedido(tx, b.item);
    const agora = new Date();
    const documento = await tx.incluir('documento_prontuario', {
      estabelecimento_id: est,
      paciente_id: b.paciente,
      atendimento_id: atendimento,
      tipo_documento_clinico_id: n(tipo['id']),
      situacao_documento_prontuario_id: n(lancado['id']),
      entidade_origem: ORIGEM_DOCUMENTO_LAUDO,
      entidade_origem_id: n(ver['id']),
      titulo: tituloDocumentoLaudo(b.nomeExame, numero, situacao),
      profissional_id: profissional,
      referencia_em: agora,
      lancado_em: agora,
      fechado_em: agora,
      numero_versao: 1,
      confidencial: false,
      conteudo: JSON.stringify({
        laudo: laudo,
        exame_item: b.item,
        versao: numero,
        titulo: p.titulo,
        texto: p.texto,
        resultado: p.resultado,
        achado_critico: p.achadoCritico,
        assinatura_eletronica: { nivel: 'eletronica-avancada', reautenticacao: false },
      }),
      origem: 'sistema',
    });
    await tx.incluir('documento_prontuario_evento', {
      documento_prontuario_id: documento,
      operacao: 'inclusao',
      acao: 'criacao',
      situacao_documento_prontuario_id: n(lancado['id']),
      profissional_id: profissional,
      evento_em: agora,
      dados: JSON.stringify({ origem: ORIGEM_DOCUMENTO_LAUDO, laudo, versao: numero }),
      ocorrido_em: agora,
      usuario_id: n(tx.contexto.usuario),
    });
    await tx.incluir('exame_item_assinatura', {
      exame_item_id: b.item,
      documento_prontuario_id: documento,
      origem: 'sistema',
    });
    return documento;
  }

  /** Salva o rascunho (ou o envia para revisão): texto, modelo e medidas; nada de versão até a assinatura. */
  salvar(c: ContextoSadt, item: number, entrada: unknown): Promise<LaudoGravado> {
    const p = esquemaSalvarLaudo.parse(entrada);
    return this.gravar(c, 'sadt.laudo.rascunho', 'laudo_diagnostico', async (tx, est) => {
      const { b, ld, av, medidas } = await this.preparar(tx, est, item, p, false);
      const situacao = daRegra(() =>
        situacaoDepois(
          ld ? (texto(ld['situacao']) as SituacaoLaudo) : null,
          p.revisao ? 'enviar_revisao' : 'salvar',
        ),
      );
      const laudo = await this.gravarRascunho(tx, est, b, ld, p, situacao, av, medidas);
      return {
        id: laudo,
        situacao,
        versaoAtual: ld ? n(ld['versao_atual']) : 1,
        valores: av.length,
        foraReferencia: av.filter((v) => v.foraReferencia).length,
      };
    });
  }

  /** Salva e assina num clique: só o médico com registro ativo, com o texto e as medidas obrigatórias; vira a versão. */
  assinar(c: ContextoSadt, item: number, entrada: unknown): Promise<LaudoGravado> {
    const p = esquemaAssinarLaudo.parse(entrada);
    return this.gravar(c, 'sadt.laudo.assinado', 'laudo_diagnostico', async (tx, est) => {
      const { b, ld, av, medidas } = await this.preparar(tx, est, item, p, true);
      const situacao = daRegra(() =>
        situacaoDepois(ld ? (texto(ld['situacao']) as SituacaoLaudo) : null, 'assinar'),
      );
      daRegra(() => conferirTextoParaAssinar(p.texto));
      const v = await this.assinante(tx, tx.contexto.usuario);
      daRegra(() => conferirAssinante(v, b.tipoSetor));
      const laudo = await this.gravarRascunho(tx, est, b, ld, p, 'rascunho', av, medidas);
      const numero = await this.versao(
        tx,
        laudo,
        'assinado',
        p,
        av,
        v!.profissional,
        { id: null, texto: null },
        medidas,
      );
      await this.documentoDaVersao(tx, est, b, laudo, numero, 'assinado', v!.profissional, p);
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT versao FROM laudo_diagnostico WHERE id = ?',
        [laudo],
        { teto: 1 },
      );
      const agora = new Date();
      await tx.alterar('laudo_diagnostico', laudo, n(atual!['versao']), {
        situacao,
        laudista_profissional_id: v!.profissional,
        laudado_em: agora,
        assinado_em: agora,
        assinado_por_usuario_id: tx.contexto.usuario,
        versao_atual: numero,
      });
      // A assinatura libera o exame (segue para a emissão e para o prontuário); o já liberado fica como está.
      const [ei] = await tx.consultarParaAtualizar(
        'SELECT versao, situacao FROM exame_item WHERE id = ?',
        [item],
        {
          teto: 1,
        },
      );
      const liberar = exameAposAssinatura(texto(ei!['situacao']));
      if (liberar)
        await tx.alterar('exame_item', item, n(ei!['versao']), {
          situacao: liberar,
          liberado_em: agora,
          liberado_por_usuario_id: tx.contexto.usuario,
        });
      const critico = await this.avisarAchadoCritico(tx, est, b, laudo, p);
      return {
        id: laudo,
        situacao,
        versaoAtual: numero,
        valores: av.length,
        foraReferencia: av.filter((x) => x.foraReferencia).length,
        exameLiberado: liberar !== null,
        avisoCritico: critico.acao,
        avisados: critico.avisados,
      };
    });
  }

  /** Retifica o laudo assinado: motivo obrigatório, versão nova com o texto e as medidas; a anterior fica. */
  retificar(c: ContextoSadt, item: number, entrada: unknown): Promise<LaudoGravado> {
    const p = esquemaRetificarLaudo.parse(entrada);
    return this.gravar(c, 'sadt.laudo.retificado', 'laudo_diagnostico', async (tx, est) => {
      const { b, ld, av, medidas } = await this.preparar(tx, est, item, p, true);
      if (!ld) throw recusa('laudo-nao-assinado', 'O exame ainda não tem laudo assinado.');
      const situacao = daRegra(() => situacaoDepois(texto(ld['situacao']) as SituacaoLaudo, 'retificar'));
      daRegra(() => conferirMotivoRetificacao(p.motivo, p.motivoTexto));
      daRegra(() => conferirTextoParaAssinar(p.texto));
      if (p.motivo !== null) {
        const m = await tx.uma('SELECT ativo FROM motivo_retificacao_laudo WHERE id = ?', [p.motivo]);
        if (!m || !m['ativo'])
          throw recusa('motivo-inexistente', 'O motivo de retificação não existe ou está inativo.');
      }
      const v = await this.assinante(tx, tx.contexto.usuario);
      daRegra(() => conferirAssinante(v, b.tipoSetor));
      const responsavel = await this.responsavelDoSetor(tx, b.setor, b.exame, v!.profissional);
      daRegra(() => conferirRetificador(nn(ld['laudista_profissional_id']), v!.profissional, responsavel));
      const laudo = n(ld['id']);
      await tx.alterar('laudo_diagnostico', laudo, n(ld['versao']), { ...this.campos(p, medidas) });
      await this.gravarValores(tx, laudo, av);
      await this.gravarPalavras(tx, laudo, p.palavrasChave);
      const numero = await this.versao(
        tx,
        laudo,
        'retificado',
        p,
        av,
        v!.profissional,
        { id: p.motivo, texto: p.motivoTexto },
        medidas,
      );
      await this.documentoDaVersao(tx, est, b, laudo, numero, 'retificado', v!.profissional, p);
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT versao FROM laudo_diagnostico WHERE id = ?',
        [laudo],
        { teto: 1 },
      );
      await tx.alterar('laudo_diagnostico', laudo, n(atual!['versao']), {
        situacao,
        laudista_profissional_id: v!.profissional,
        versao_atual: numero,
      });
      const critico = await this.avisarAchadoCritico(tx, est, b, laudo, p);
      // O laudo que já tinha sido emitido: a via impressa deixa de ser a atual (a validação do código passa a dizer
      // isso) e quem emitiu e quem pediu são avisados para emitir e buscar a nova via.
      const emissoes = await tx.consultar(
        `SELECT el.id, el.emitido_por_usuario_id FROM emissao_laudo_exame ex
           JOIN emissao_laudo el ON el.id = ex.emissao_laudo_id
          WHERE ex.exame_item_id = ? AND ex.excluido_em IS NULL AND el.excluido_em IS NULL`,
        [item],
        { teto: 200 },
      );
      let avisados = critico.avisados;
      if (emissoes.length > 0) {
        const { atendimento, solicitantes } = await this.pedido(tx, item);
        avisados += await this.avisoClinico(
          tx,
          est,
          b,
          laudo,
          atendimento,
          {
            titulo: 'Laudo emitido foi retificado',
            mensagem: `O laudo de ${b.nomeExame}, já emitido, foi retificado (versão ${numero}). A via emitida antes não é mais a atual: emita a nova via.`,
            prioridade: 'alta',
          },
          destinatariosDaRetificacaoDoLaudo(
            emissoes.map((e) => nn(e['emitido_por_usuario_id'])),
            solicitantes,
            tx.contexto.usuario,
          ),
        );
      }
      return {
        id: laudo,
        situacao,
        versaoAtual: numero,
        valores: av.length,
        foraReferencia: av.filter((x) => x.foraReferencia).length,
        avisoCritico: critico.acao,
        avisados,
        emissoesSuperadas: emissoes.length,
      };
    });
  }

  /** Inclui ou altera o modelo de laudo (o pessoal fica do médico da sessão); o modelo se desativa, nunca se apaga. */
  salvarModelo(c: ContextoSadt, entrada: unknown): Promise<{ id: number; campos: string[] }> {
    const p = esquemaModeloLaudo.parse(entrada);
    return this.gravar(c, 'sadt.laudo.modelo', 'modelo_laudo', async (tx, est) => {
      const sessao = await this.profissionalDoUsuario(tx, tx.contexto.usuario);
      const profissional = p.pessoal ? sessao : null;
      if (p.pessoal && profissional === null)
        throw recusa('sem-profissional', 'O modelo pessoal precisa de um profissional ligado à sua conta.');
      const repetido = await tx.uma(
        'SELECT id FROM modelo_laudo WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
        [est, p.codigo, p.id ?? 0],
      );
      if (repetido) throw recusa('modelo-codigo-repetido', 'Já existe um modelo com este código.');
      const dados = {
        codigo: p.codigo,
        nome: p.nome,
        exame_id: p.exame,
        setor_diagnostico_id: p.setor,
        profissional_id: profissional,
        tipo: p.tipo,
        atalho: p.atalho,
        texto: p.texto,
        campos_variaveis: JSON.stringify(camposDoModelo(p.texto)),
        ativo: p.ativo,
      };
      if (p.id === null) {
        const novo = await tx.incluir('modelo_laudo', { estabelecimento_id: est, ...dados });
        return { id: novo, campos: camposDoModelo(p.texto) };
      }
      const [m] = await tx.consultarParaAtualizar(
        'SELECT id, versao, profissional_id FROM modelo_laudo WHERE id = ? AND estabelecimento_id = ?',
        [p.id, est],
      );
      if (!m) throw recusa('modelo-inexistente', 'O modelo não existe neste estabelecimento.');
      // O modelo pessoal só muda pelo dono; na alteração o dono não muda (nem o pessoal vira do estabelecimento, nem o
      // do estabelecimento vira pessoal de quem o edita).
      const dono = nn(m['profissional_id']);
      daRegra(() => conferirDonoDoModelo(dono, sessao));
      await tx.alterar('modelo_laudo', p.id, n(m['versao']), { ...dados, profissional_id: dono });
      return { id: p.id, campos: camposDoModelo(p.texto) };
    });
  }
}
