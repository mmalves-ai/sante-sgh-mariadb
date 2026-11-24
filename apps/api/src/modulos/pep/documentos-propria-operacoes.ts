// Porta PRÓPRIA dos documentos do prontuário, família "pep-resto" (modulos-proprios-2): as gravações do executar de
// documentos que ainda recusavam com 501 no banco próprio. O integrador as registra em `outras` de
// documentos-propria-painel.ts `executar` (mesma assinatura de GravacaoDocumentos). A especificação é a porta de
// memória (documentos-porta-memoria.ts, `executar`): mesmos esquemas, erros de domínio e retorno.
//   - pep.registrarAlergia: alergia_paciente (+ alergia_paciente_principio), com o alérgeno do catálogo OU a descrição
//     livre (duplicidade da livre pela descrição normalizada: sem acento, sem caixa, espaços colapsados), ou a
//     declaração "nega alergias" (nega repetida sem alergia depois dela: 409);
//   - pep.inativarAlergia: nova versão da linha (ativa = falso, quem, quando e o motivo); nunca apagada;
//   - pep.emitirDocumento: receita (receita_medica, número pela sequencia_negocio "receita_medica" do estabelecimento,
//     conteúdo e resumo na própria linha, migração 06_PEP/93_receita_conteudo) e atestado, declaração ou requerimento
//     (documento_emitido + documento_emitido_versao "emissao");
//   - pep.lancarExameExterno: exame_lancado_prontuario (resultado = o conteúdo formatado);
//   - pep.finalizarSumarioAlta: nova versão finalizada de sumario_alta (versão esperada = a última + 1).
// Cada gravação cria o documento do prontuário (documento_prontuario, situação "lançado", evento "criacao") com o
// resumo do conteúdo, como a memória devolve `documento`. A gravação exige o profissional da sessão: usuário → vínculo
// vigente no estabelecimento → inscrição ativa no conselho (a indicada em `cbo`, que tem de ser dele). Trilha, versão e
// idempotência pelo executor, na mesma transação. Registro clínico nunca é apagado (SBIS-26).
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import type { GravacaoDocumentos } from './documentos-propria-painel.js';
import { instanteLocal } from './prescricao-propria-gravacao.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import {
  esquemaEmissaoDocumento,
  esquemaExameExterno,
  esquemaFinalizacaoSumario,
  esquemaGravacaoAlergia,
  esquemaInativacaoAlergia,
} from './tipos-pep.js';

/** Operações do executor de documentos que esta família grava no banco próprio. */
export const OPERACOES_PEP_RESTO: readonly string[] = [
  'pep.registrarAlergia',
  'pep.inativarAlergia',
  'pep.emitirDocumento',
  'pep.lancarExameExterno',
  'pep.finalizarSumarioAlta',
];

/** Sequência de negócio do número da receita (por estabelecimento). */
export const SEQUENCIA_RECEITA = 'receita_medica';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** Resultado gravado na idempotência: só ids, códigos e nulos (ResultadoOperacao do núcleo). */
type Resultado = Readonly<Record<string, number | string | boolean | null>>;
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);
const conflitoAlergias = () =>
  new ErroOperacao(409, 'conflito-versao', 'A lista mudou', 'A lista de alergias mudou desde a leitura.');

/** A descrição livre normalizada para a duplicidade: sem acento, minúscula, espaços colapsados. */
export function descricaoNormalizada(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Origem da informação da tela → valor do banco (hífen → sublinhado; CHECK de alergia_paciente). */
export const fonteDaOrigem = (o: string | undefined): string | null => (o ? o.replace(/-/g, '_') : null);

/**
 * A alergia aceita, além do esquema da memória, a descrição livre (agente fora do catálogo): sem `agente`, a descrição
 * livre é obrigatória (exceto "nega alergias"). Mesmos campos e recusas do esquema comum.
 */
export const esquemaAlergiaPropria = z
  .object({ ...esquemaGravacaoAlergia.shape, descricaoLivre: z.string().trim().min(2).max(250).optional() })
  .strict()
  .refine((x) => x.nega || x.agente !== undefined || x.descricaoLivre !== undefined, {
    path: ['agente'],
    message: 'agente',
  });

/** O atestado (tipo "atestado") exige os dias de afastamento (CHECK do banco); declaração e requerimento não. */
export const esquemaEmissaoPropria = z.union([
  esquemaEmissaoDocumento.options[0],
  esquemaEmissaoDocumento.options[1]
    .extend({ diasAfastamento: z.number().int().min(0).max(365).optional() })
    .strict(),
]);

/**
 * Inativação da alergia: o esquema comum aceita 500 caracteres no motivo, mas a coluna guarda 250. Acima disso a entrada
 * é recusada com 400 (o registro clínico nunca é truncado em silêncio; divergência intencional registrada).
 */
export const esquemaInativacaoPropria = esquemaInativacaoAlergia.refine((x) => x.motivo.length <= 250, {
  path: ['motivo'],
  message: 'motivo',
});

/** Validade da receita: a data LOCAL da emissão (fuso do estabelecimento) somada dos dias de validade. */
export function validadeLocal(emitida: Date, fuso: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataHora(emitida, fuso) ?? '');
  if (!m) throw new Error('Data local da emissão indisponível.');
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + dias)).toISOString().slice(0, 10);
}

function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

interface Sessao {
  readonly est: number;
  readonly fuso: string;
  readonly usuario: number;
  /** Profissional da sessão (vínculo vigente); null só onde a operação não exige (inativar alergia). */
  readonly profissional: number | null;
  readonly ocupacao: number | null;
  readonly cbo: string | null;
}

/** Profissional do usuário da sessão no estabelecimento; com `inscricao`, ela tem de ser dele e estar ativa. */
async function sessao(
  tx: TxOperacao,
  est: { id: number; fuso: string },
  inscricao: number | null,
  exigir: boolean,
): Promise<Sessao> {
  const usuario = num(tx.contexto.usuario);
  const v = await tx.uma(
    `SELECT v.profissional_id FROM usuario_vinculo_profissional v
       JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
      WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
        AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
      ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
    [usuario, est.id],
  );
  const profissional = numOuNull(v?.['profissional_id']);
  if (profissional === null) {
    if (!exigir)
      return { est: est.id, fuso: est.fuso, usuario, profissional: null, ocupacao: null, cbo: null };
    throw recusar(403, 'sem-profissional', 'A conta da sessão não tem vínculo de profissional vigente neste estabelecimento.');
  }
  const i = await tx.uma(
    `SELECT i.id, i.ocupacao_cbo_id, o.codigo_cbo FROM inscricao_conselho i
       LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
      WHERE i.profissional_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa','provisoria')
        ${inscricao !== null ? 'AND i.id = ?' : ''}
      ORDER BY i.principal DESC, i.sequencia, i.id LIMIT 1`,
    inscricao !== null ? [profissional, inscricao] : [profissional],
  );
  if (!i) {
    if (!exigir)
      return { est: est.id, fuso: est.fuso, usuario, profissional, ocupacao: null, cbo: null };
    throw recusar(
      403,
      inscricao !== null ? 'cbo-de-outro-profissional' : 'sem-conselho-ativo',
      'A inscrição informada não é do profissional da sessão ou não está ativa no conselho.',
    );
  }
  return {
    est: est.id,
    fuso: est.fuso,
    usuario,
    profissional,
    ocupacao: numOuNull(i['ocupacao_cbo_id']),
    cbo: textoOuNull(i['codigo_cbo'])?.replace(/\D/g, '') ?? null,
  };
}

/** Documento emitido só por médico (CBO 225x), como a memória. */
function conferirMedico(s: Sessao): void {
  if (!(s.cbo ?? '').startsWith('225'))
    throw recusar(422, 'categoria-nao-permitida', 'Este documento é emitido só por médico com registro ativo no conselho.');
}

async function conferirAtendimento(tx: TxOperacao, s: Sessao, atendimento: number, paciente: number): Promise<void> {
  const at = await tx.uma(
    'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [atendimento, s.est],
  );
  if (!at) throw recusar(404, 'atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
  if (num(at['paciente_id']) !== paciente)
    throw recusar(409, 'atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
}

/** O horário clínico (local do estabelecimento) como instante; retroativo além de 5 minutos exige justificativa. */
function horarioClinico(s: Sessao, local: string, justificativa: string | undefined, agora: Date): Date {
  const t = instanteLocal(local, s.fuso);
  if (t.getTime() > agora.getTime() + 5 * 60_000)
    throw recusar(422, 'horario-futuro', 'O horário clínico não pode estar no futuro.');
  if (t.getTime() < agora.getTime() - 5 * 60_000 && !justificativa)
    throw recusar(422, 'justificativa-retroativo', 'Horário retroativo: informe a justificativa.');
  return t;
}

/** Documento do prontuário da gravação (lançado, à espera de assinatura) e o evento de criação. */
async function documentoProntuario(
  tx: TxOperacao,
  s: Sessao,
  d: {
    categoria: string;
    paciente: number;
    atendimento: number | null;
    tabela: string;
    id: number;
    titulo: string;
    referencia: Date;
    hash: string;
    comoSuporte: boolean;
  },
): Promise<number> {
  const tipo = await tx.uma(
    `SELECT id FROM tipo_documento_clinico WHERE categoria IN (?, 'outro') AND ativo = TRUE
      ORDER BY (categoria = ?) DESC, (ordem IS NULL), ordem, id LIMIT 1`,
    [d.categoria, d.categoria],
  );
  if (!tipo)
    throw recusar(409, 'tipo-documento-sem-cadastro', `O cliente não tem tipo de documento clínico ativo na categoria "${d.categoria}".`);
  const sit = await tx.uma(
    `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE
      ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
  );
  if (!sit)
    throw recusar(409, 'situacao-documento-sem-cadastro', 'O cliente não tem situação de documento ativa na categoria "lancado".');
  const agora = new Date();
  const documento = await tx.incluir('documento_prontuario', {
    estabelecimento_id: s.est,
    paciente_id: d.paciente,
    atendimento_id: d.atendimento,
    tipo_documento_clinico_id: num(tipo['id']),
    situacao_documento_prontuario_id: num(sit['id']),
    entidade_origem: d.tabela,
    entidade_origem_id: d.id,
    titulo: d.titulo,
    profissional_id: s.profissional,
    referencia_em: d.referencia,
    lancado_em: agora,
    numero_versao: 1,
    confidencial: false,
    conteudo: JSON.stringify({ hash_conteudo: d.hash, como_suporte: d.comoSuporte }),
    origem: 'sistema',
  });
  await tx.incluir('documento_prontuario_evento', {
    documento_prontuario_id: documento,
    operacao: 'inclusao',
    acao: 'criacao',
    situacao_documento_prontuario_id: num(sit['id']),
    profissional_id: s.profissional,
    evento_em: agora,
    dados: JSON.stringify({ hash: d.hash }),
    ocorrido_em: agora,
    usuario_id: s.usuario,
  });
  return documento;
}

const TABELAS_DOCUMENTO = ['documento_prontuario', 'documento_prontuario_evento'] as const;

/** Linhas de alergia que valem para a lista e a versão (as mesmas de alergias-propria.ts). */
const SQL_E_ALERGIA = `excluido_em IS NULL AND tipo_registro IN ('alergia','intolerancia') AND situacao_registro = 'confirmado'`;

/** Versão da lista (ids ativos em ordem, todos os estabelecimentos do cliente), com as linhas travadas. */
async function versaoTravada(tx: TxOperacao, paciente: number): Promise<{ versao: string; linhas: Record<string, unknown>[] }> {
  const linhas = await tx.consultarParaAtualizar(
    `SELECT id, alergeno_id, descricao_livre, versao FROM alergia_paciente
      WHERE paciente_id = ? AND ativa = TRUE AND ${SQL_E_ALERGIA} ORDER BY id`,
    [paciente],
  );
  return { versao: linhas.map((x) => num(x['id'])).join(','), linhas };
}

/** As gravações desta família, por nome de operação, para o `outras` do executar de documentos. */
export function operacoesDocumentosPropria(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  executor: Executor = nucleo.criarExecutor(),
): Readonly<Record<string, GravacaoDocumentos>> {
  /**
   * Grava pela operação do executor com a ENTRADA VALIDADA (o hash da idempotência é o dela): a repetição com a mesma
   * chave e a mesma entrada devolve o resultado gravado (sem segunda linha) e a mesma chave com outra entrada recusa
   * com 422 `idempotencia-divergente`. O resultado (só ids, códigos e nulos) vem do retorno do executor.
   */
  async function gravar(
    c: ContextoDocs,
    ctx: ContextoOperacao,
    nome: string,
    entrada: Record<string, unknown>,
    tabelas: readonly string[],
    fn: (tx: TxOperacao, est: { id: number; fuso: string }) => Promise<Resultado & { tabela: string; id: number }>,
    trilha: (r: Resultado) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const banco = c.cliente || cliente;
    const est = await nucleo.lerSomente({ cliente: banco, correlacao: `pep.documentos.${nome}` }, async (l) => {
      const e = await l.uma('SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(404, 'estabelecimento-inexistente', 'Estabelecimento não encontrado', 'O estabelecimento da sessão não existe neste cliente.');
      return { id: num(e['id']), fuso: fusoValido(e['fuso_horario']) };
    });
    const op = definirOperacao({
      nome,
      tabelas: [...tabelas, ...TABELAS_DOCUMENTO],
      entrada: z.object({}).passthrough(),
      gravar: (tx: TxOperacao) => fn(tx, est),
      alvo: (_e, x) => ({ tabela: String(x['tabela']), id: Number(x['id']) }),
      trilha: (_e, x) => ({ dados: trilha(x) }),
    });
    const saida = await executor.executar(op, banco, entrada, { ...ctx, cliente: banco, estabelecimento: est.id });
    const resto: Record<string, unknown> = { ...saida.resultado };
    delete resto['tabela'];
    delete resto['id'];
    return resto;
  }

  const registrarAlergia: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaAlergiaPropria, entrada);
    return gravar(
      c,
      ctx,
      'pep.alergia.registrar',
      x,
      ['alergia_paciente', 'alergia_paciente_principio'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const { versao, linhas } = await versaoTravada(tx, x.paciente);
        if (versao !== x.versao) throw conflitoAlergias();
        const agora = new Date();
        const comum = {
          estabelecimento_id: s.est,
          paciente_id: x.paciente,
          atendimento_id: x.atendimento,
          registro_assistencial_id: null as number | null,
          registrado_em: agora,
          registrado_profissional_id: s.profissional,
          situacao_registro: 'confirmado',
          origem: 'sistema',
        };
        const reg = await tx.uma(
          'SELECT id FROM registro_assistencial WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL',
          [x.registro, x.paciente],
        );
        comum.registro_assistencial_id = reg ? num(reg['id']) : null;
        let alergia: number;
        let id: number;
        if (x.nega) {
          const u = await tx.uma(
            `SELECT
               (SELECT MAX(registrado_em) FROM alergia_paciente WHERE paciente_id = ? AND excluido_em IS NULL
                  AND tipo_registro = 'nega_alergias' AND situacao_registro = 'confirmado') AS nega,
               (SELECT MAX(registrado_em) FROM alergia_paciente WHERE paciente_id = ? AND ${SQL_E_ALERGIA}) AS alergia`,
            [x.paciente, x.paciente],
          );
          const nega = u?.['nega'] ?? null;
          const ultima = u?.['alergia'] ?? null;
          if (nega !== null && (ultima === null || new Date(String(ultima)) <= new Date(String(nega))))
            throw new ErroOperacao(409, 'nega-repetida', 'Já registrado', 'O paciente já está registrado como "nega alergias".');
          id = await tx.incluir('alergia_paciente', { ...comum, tipo_registro: 'nega_alergias', observacao: x.observacao ?? null });
          alergia = 0;
        } else {
          if (x.agente !== undefined) {
            const ag = await tx.uma('SELECT id FROM alergeno WHERE id = ? AND ativo = TRUE', [x.agente]);
            if (!ag)
              throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', { campos: ['agente'] });
            if (linhas.some((l) => numOuNull(l['alergeno_id']) === x.agente))
              throw new ErroOperacao(422, 'duplicada', 'Alergia já registrada', 'O agente já está na lista ativa.');
          } else {
            const alvo = descricaoNormalizada(x.descricaoLivre ?? '');
            if (
              linhas.some(
                (l) => l['alergeno_id'] === null && descricaoNormalizada(String(l['descricao_livre'] ?? '')) === alvo,
              )
            )
              throw new ErroOperacao(422, 'duplicada', 'Alergia já registrada', 'O agente já está na lista ativa.');
          }
          const principios = [...new Set(x.principios)];
          if (principios.length) {
            const ok = await tx.consultar(
              `SELECT id FROM principio_ativo WHERE id IN (${marcadores(principios.length)})`,
              principios,
            );
            if (ok.length !== principios.length)
              throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', { campos: ['principios'] });
          }
          id = await tx.incluir('alergia_paciente', {
            ...comum,
            tipo_registro: 'alergia',
            alergeno_id: x.agente ?? null,
            descricao_livre: x.agente === undefined ? (x.descricaoLivre ?? null) : null,
            reacao: x.reacao ?? null,
            gravidade: x.gravidade ?? null,
            fonte_informacao: fonteDaOrigem(x.origem),
            observacao: x.observacao ?? null,
            ativa: true,
          });
          for (const p of principios)
            await tx.incluir('alergia_paciente_principio', { alergia_paciente_id: id, principio_ativo_id: p });
          alergia = id;
        }
        const documento = await documentoProntuario(tx, s, {
          categoria: 'outro',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: 'alergia_paciente',
          id,
          titulo: x.nega ? 'Nega alergias' : 'Alergia',
          referencia: agora,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        return { tabela: 'alergia_paciente', id, alergia, documento, trilha: null };
      },
      (r) => ({ evento: 'pep.alergia.registrada', paciente: x.paciente, documento: r['documento'] }),
    );
  };

  const inativarAlergia: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaInativacaoPropria, entrada);
    return gravar(
      c,
      ctx,
      'pep.alergia.inativar',
      x,
      ['alergia_paciente'],
      async (tx, est) => {
        const s = await sessao(tx, est, null, false);
        const [a] = await tx.consultarParaAtualizar(
          `SELECT id, ativa, versao FROM alergia_paciente WHERE id = ? AND paciente_id = ? AND ${SQL_E_ALERGIA}`,
          [x.alergia, x.paciente],
        );
        if (!a) throw new ErroOperacao(404, 'registro-inexistente', 'Alergia não encontrada', 'A alergia não é deste paciente.');
        const { versao } = await versaoTravada(tx, x.paciente);
        if (!Number(a['ativa']) || versao !== x.versao) throw conflitoAlergias();
        await tx.alterar('alergia_paciente', num(a['id']), num(a['versao']), {
          ativa: false,
          inativado_em: new Date(),
          inativado_por_usuario_id: s.usuario,
          inativado_profissional_id: s.profissional,
          motivo_inativacao: x.motivo,
        });
        return { tabela: 'alergia_paciente', id: num(a['id']), alergia: num(a['id']), trilha: null };
      },
      () => ({ evento: 'pep.alergia.inativada', paciente: x.paciente, motivo: x.motivo }),
    );
  };

  const emitirDocumento: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaEmissaoPropria, entrada);
    const receita = x.familia === 'receita';
    return gravar(
      c,
      ctx,
      receita ? 'pep.receita.emitir' : 'pep.atestado.emitir',
      x,
      receita ? ['receita_medica', 'sequencia_negocio'] : ['documento_emitido', 'documento_emitido_versao'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        // Mesma ordem da memória: profissional e inscrição da sessão, médico (atestado), depois o CID sem autorização.
        if (x.familia === 'atestado' && x.tipo === 'atestado') conferirMedico(s);
        if (x.familia === 'atestado' && x.cid && !x.autorizacaoCid)
          throw recusar(422, 'cid-sem-autorizacao', 'O CID exige a autorização do paciente.');
        // Divergência intencional (registrada): o CHECK ck_documento_emitido_dias_afastamento exige os dias no atestado;
        // a memória não tem o campo. Recusa depois das conferências da memória, nunca inventa o número de dias.
        if (x.familia === 'atestado' && x.tipo === 'atestado' && x.diasAfastamento === undefined)
          throw recusar(422, 'dias-afastamento-obrigatorio', 'O atestado exige os dias de afastamento.');
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const agora = new Date();
        const clinico = horarioClinico(s, x.dataHoraClinica, x.justificativaRetroativo, agora);
        let origem: number;
        let titulo: string;
        if (x.familia === 'receita') {
          const flags =
            x.tipo === 'receita-controlada'
              ? 'controle_especial = TRUE'
              : x.tipo === 'receita-antimicrobiano'
                ? 'antimicrobiano = TRUE AND controle_especial = FALSE'
                : 'controle_especial = FALSE AND antimicrobiano = FALSE';
          const t = await tx.uma(
            `SELECT id, numero_vias, validade_dias FROM tipo_receita WHERE ativo = TRUE AND ${flags}
              ORDER BY padrao DESC, exige_notificacao, id LIMIT 1`,
          );
          if (!t) throw recusar(409, 'tipo-receita-sem-cadastro', `O cliente não tem tipo de receita ativo para "${x.tipo}".`);
          const numero = await tx.proximoNumero(SEQUENCIA_RECEITA);
          const validade = numOuNull(t['validade_dias']);
          const validadeAte = validade === null ? null : validadeLocal(clinico, s.fuso, validade);
          origem = await tx.incluir('receita_medica', {
            estabelecimento_id: s.est,
            numero: numero.formatado,
            paciente_id: x.paciente,
            atendimento_id: x.atendimento,
            prescritor_profissional_id: s.profissional,
            tipo_receita_id: num(t['id']),
            emitida_em: clinico,
            registrada_em: agora,
            justificativa_retroativa: x.justificativaRetroativo ?? null,
            validade_ate: validadeAte,
            numero_vias: Math.min(3, Math.max(1, num(t['numero_vias']))),
            situacao: 'emitida',
            conteudo: x.rtf,
            hash_conteudo: x.hashConteudo,
            origem: 'sistema',
          });
          titulo =
            x.tipo === 'receita-controlada'
              ? 'Receita de controle especial'
              : x.tipo === 'receita-antimicrobiano'
                ? 'Receita de antimicrobiano'
                : 'Receita simples';
        } else {
          if (x.corrige !== undefined) {
            const o = await tx.uma(
              `SELECT situacao FROM documento_emitido WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?
                  AND excluido_em IS NULL`,
              [x.corrige, x.paciente, s.est],
            );
            if (!o) throw new ErroOperacao(404, 'registro-inexistente', 'Documento não encontrado', 'O documento corrigido não é deste paciente.');
          }
          const modelo = await tx.uma(
            `SELECT id FROM modelo_documento_clinico WHERE titulo = ? AND excluido_em IS NULL ORDER BY id LIMIT 1`,
            [x.modeloNome],
          );
          origem = await tx.incluir('documento_emitido', {
            estabelecimento_id: s.est,
            paciente_id: x.paciente,
            atendimento_id: x.atendimento,
            tipo: x.tipo,
            modelo_documento_clinico_id: numOuNull(modelo?.['id']),
            profissional_id: s.profissional,
            emitido_em: clinico,
            lancado_em: agora,
            justificativa_retroativo: x.justificativaRetroativo ?? null,
            texto: x.conteudoXml,
            dias_afastamento: x.diasAfastamento ?? null,
            autorizacao_cid: x.cid ? (x.autorizacaoCid ?? null) : null,
            situacao: 'valido',
            corrige_documento_emitido_id: x.corrige ?? null,
            origem: 'sistema',
          });
          await tx.incluir('documento_emitido_versao', {
            documento_emitido_id: origem,
            operacao: 'inclusao',
            acao: x.corrige !== undefined ? 'correcao' : 'emissao',
            motivo: x.corrige !== undefined ? `Corrige o documento ${x.corrige}` : null,
            dados: JSON.stringify({ hash_conteudo: x.hashConteudo }),
            ocorrido_em: agora,
            usuario_id: s.usuario,
          });
          titulo = x.modeloNome;
        }
        const documento = await documentoProntuario(tx, s, {
          categoria: receita ? 'receita' : x.tipo === 'atestado' ? 'atestado' : 'declaracao',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: receita ? 'receita_medica' : 'documento_emitido',
          id: origem,
          titulo,
          referencia: clinico,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        if (!receita) {
          const v = await tx.uma('SELECT versao FROM documento_emitido WHERE id = ?', [origem]);
          await tx.alterar('documento_emitido', origem, num(v?.['versao'] ?? 1), { documento_prontuario_id: documento });
        }
        return {
          tabela: receita ? 'receita_medica' : 'documento_emitido',
          id: origem,
          origem,
          documentoTrilha: documento,
          documento,
          trilha: null,
        };
      },
      (r) => ({
        evento: receita ? 'pep.receita.emitida' : 'pep.atestado.emitido',
        paciente: x.paciente,
        documento: r['documento'],
        comoSuporte: x.comoSuporte === true,
      }),
    );
  };

  const lancarExameExterno: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaExameExterno, entrada);
    if (x.realizadoEm > x.dataHoraClinica)
      return Promise.reject(recusar(422, 'horario-futuro', 'O exame não pode ter sido feito no futuro.'));
    return gravar(
      c,
      ctx,
      'pep.exame.externo',
      x,
      ['exame_lancado_prontuario'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const agora = new Date();
        const realizado = instanteLocal(x.realizadoEm, s.fuso);
        if (realizado.getTime() > agora.getTime())
          throw recusar(422, 'horario-futuro', 'O exame não pode ter sido feito no futuro.');
        const origem = await tx.incluir('exame_lancado_prontuario', {
          estabelecimento_id: s.est,
          paciente_id: x.paciente,
          atendimento_id: x.atendimento,
          nome_exame: x.nomeExame,
          metodo: x.metodo ?? null,
          realizado_em: realizado,
          lancado_em: agora,
          profissional_id: s.profissional,
          ocupacao_cbo_id: s.ocupacao,
          resultado: x.rtf,
          situacao: 'ativo',
          origem: 'sistema',
        });
        const documento = await documentoProntuario(tx, s, {
          categoria: 'laudo',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: 'exame_lancado_prontuario',
          id: origem,
          titulo: x.nomeExame,
          referencia: realizado,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        return { tabela: 'exame_lancado_prontuario', id: origem, origem, documento, trilha: null };
      },
      (r) => ({ evento: 'pep.exame.externoLancado', paciente: x.paciente, documento: r['documento'] }),
    );
  };

  const finalizarSumarioAlta: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaFinalizacaoSumario, entrada);
    return gravar(
      c,
      ctx,
      'pep.sumario.finalizar',
      x,
      ['sumario_alta'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        conferirMedico(s);
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const vs = await tx.consultarParaAtualizar(
          `SELECT id, numero_versao, situacao FROM sumario_alta WHERE atendimento_id = ? AND excluido_em IS NULL`,
          [x.atendimento],
        );
        if (vs.some((v) => ['finalizado', 'assinado'].includes(String(v['situacao']))))
          throw new ErroOperacao(409, 'sumario-finalizado', 'Já finalizado', 'O sumário de alta deste atendimento já foi finalizado.');
        if (x.versao !== Math.max(0, ...vs.map((v) => num(v['numero_versao']))) + 1)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Gravado por outra pessoa',
            'O sumário foi salvo por outra pessoa enquanto você editava. Releia e finalize de novo.',
          );
        const agora = new Date();
        const clinico = instanteLocal(x.dataHoraClinica, s.fuso);
        let rascunho: string;
        try {
          JSON.parse(x.sumario);
          rascunho = x.sumario;
        } catch {
          rascunho = JSON.stringify({ texto: x.sumario });
        }
        const origem = await tx.incluir('sumario_alta', {
          estabelecimento_id: s.est,
          atendimento_id: x.atendimento,
          paciente_id: x.paciente,
          numero_versao: x.versao,
          situacao: 'finalizado',
          responsavel_profissional_id: s.profissional,
          registrado_em: agora,
          registrado_usuario_id: s.usuario,
          conteudo_rascunho: rascunho,
          hash_conteudo: x.hashConteudo,
          finalizado_em: agora,
          finalizado_usuario_id: s.usuario,
          origem: 'sistema',
        });
        const documento = await documentoProntuario(tx, s, {
          categoria: 'sumario',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: 'sumario_alta',
          id: origem,
          titulo: x.modeloNome,
          referencia: clinico,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await tx.alterar('sumario_alta', origem, 1, { documento_prontuario_id: documento });
        return { tabela: 'sumario_alta', id: origem, origem, documento, trilha: null };
      },
      (r) => ({ evento: 'pep.sumarioAlta.finalizado', paciente: x.paciente, documento: r['documento'] }),
    );
  };

  return {
    'pep.registrarAlergia': registrarAlergia,
    'pep.inativarAlergia': inativarAlergia,
    'pep.emitirDocumento': emitirDocumento,
    'pep.lancarExameExterno': lancarExameExterno,
    'pep.finalizarSumarioAlta': finalizarSumarioAlta,
  };
}
