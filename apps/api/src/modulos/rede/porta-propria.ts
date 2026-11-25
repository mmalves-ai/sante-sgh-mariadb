// Porta PRÓPRIA do índice de pacientes da Rede (MPI; M57, etapas 1 e 2) sobre o banco do cliente, pelo @sgh/nucleo.
// Um banco por cliente: os estabelecimentos da rede moram no MESMO banco, e o paciente é do cliente inteiro. Por isso:
//   - o "cadastro de um estabelecimento" é o paciente cadastrado nele (`paciente.cadastro_estabelecimento_id`);
//   - o par suspeito entre dois estabelecimentos é uma linha de `suspeita_duplicidade` (a mesma fila do cadastro), com
//     os dois pacientes cadastrados em estabelecimentos diferentes; "outra pessoa" decide a linha;
//   - "a mesma pessoa" é a UNIFICAÇÃO dos cadastros (`unificacao_cadastro`, feita no cadastro, que transfere os
//     registros e pode ser revertida); o vínculo da tela é a unificação efetivada (desfeito: revertida), e a pessoa da
//     rede é o cadastro mantido. A porta não grava vínculo nem unifica: recusa com 409 `unificar-no-cadastro`;
//   - o cursor do pareamento incremental de cada estabelecimento fica em `marca_sincronismo` (sistema
//     `pareamento_rede`, tabela `paciente`): só ids e o carimbo, nunca dado de pessoa;
//   - o aviso "tem atendimentos em outro estabelecimento" (atendimentosNaRede) conta `atendimento` e `internacao` do
//     paciente e dos cadastros unificados com ele, agrupados pelo estabelecimento do registro, fora o da sessão: sem
//     depender de vínculo (o paciente atendido em outra unidade sem unificação nenhuma também avisa). Só contagens e datas;
//   - o prontuário mostrado e filtrado na fila é o da UNIDADE (`prontuario_estabelecimento`, interno, do estabelecimento
//     do cadastro); sem ele (ou fora do formato numérico do contrato), o número do cliente;
//   - um estabelecimento de código fora do formato da chave do par fica fora do MPI com aviso no log (código e contagem)
//     e recusa 403 `codigo-fora-do-formato` (não some em silêncio).
// Leituras: somente leitura (lerSomente). Gravações: sempre pelo Executor; a decisão sobre um par é UMA operação (uma
// transação e uma trilha), com o outbox e a idempotência na mesma transação. SQL parametrizado; nomes literais.
// Dado da rede inteira (sem estabelecimento_id): usuario (o login e o CPF de quem decide), unificacao_cadastro (filtrada
// pelo estabelecimento do cadastro de um dos lados) e, no aviso, atendimento/internacao dos OUTROS estabelecimentos
// (motivo: o aviso é justamente o que o paciente tem fora da unidade da sessão; só contagens).
// Melhoria: nenhuma tabela espelho do índice nem cópia entre bancos (o par, a decisão e a unificação são as linhas do
// cadastro): o relatório de divergência entre os índices deixa de ter o que divergir.
// Melhoria: quem decide é o usuário do contexto (id, com chave estrangeira), não um login em texto.
// Melhoria: o pareamento automático não une cadastros sozinho: o par de pontuação alta vai à fila com a pontuação, e uma
// pessoa decide (a unificação transfere registros clínicos; não é um vínculo reversível de índice).
// Melhoria: toda leitura filtra a exclusão lógica (paciente, pessoa, estabelecimento, suspeita e unificação).
// Melhoria: o par excluído logicamente não é recriado pelo ciclo (fica mantido; a chave única do par não quebra o ciclo).
import { randomUUID } from 'node:crypto';
import { FAIXAS_PONTUACAO_REDE } from '@sgh/contratos';
import { chavePar, ErroChaveRede, ladosDaChave } from '@sgh/dominio-rede';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type {
  AtendimentosNaRede,
  AtendimentosRede,
  ContextoRede,
  EstabelecimentoRede,
  GravadorRede,
  MarcaRede,
  PortaRede,
  RecorteFilaRede,
} from './porta.js';
import type {
  CadastroRedeLido,
  CandidatoParaGravarRede,
  CandidatoRedeLido,
  ChavesProcuraRede,
  EscritaIndiceRede,
  FiltroFilaRede,
  ParNovo,
  TrilhaRede,
  VinculoRedeLido,
} from './tipos-indice.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoRede {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Código de estabelecimento que cabe na chave do par (`<estabelecimento>:<id>`). */
const CODIGO_CHAVE = /^[a-z][a-z0-9]{1,9}$/;
/** Teto de ids por leitura em lista (cadastros, pessoas, situações). */
const TETO_IDS = 2_000;
/** Teto de candidatos por chave de procura (a pontuação do domínio decide entre eles). */
const TETO_CANDIDATOS = 50;
const SISTEMA_MARCA = 'pareamento_rede';
const TABELA_MARCA = 'paciente';

// ---- conversões (sem sentinela: ausente é null) ----

const numero = (v: unknown): number => Number(v ?? 0);
const textoOuNulo = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
function carimbo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const dataIso = (v: unknown): string | null => carimbo(v)?.slice(0, 10) ?? null;
const lista = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');

/** Palavras fonéticas (distintas) de uma chave de procura. */
function palavras(v: string | null): string[] {
  if (!v) return [];
  return [...new Set(v.split(/\s+/).filter((p) => p.length > 0 && p.length <= 40))].slice(0, 12);
}

export function recusaUnificacao(): ErroOperacao {
  return recusa(
    'unificar-no-cadastro',
    'No banco do cliente, os dois cadastros são do mesmo banco: "a mesma pessoa" é a unificação dos cadastros, feita em Cadastros > Pacientes > Unificar (transfere os registros e pode ser revertida lá).',
  );
}

// ---- leituras ----

/**
 * O prontuário da unidade do cadastro (`prontuario_estabelecimento`, interno, do estabelecimento do cadastro); sem ele, ou
 * fora do formato numérico do contrato, o número do cliente. `p`: o apelido literal do paciente na consulta.
 */
const PRONTUARIO = (p: 'p' | 'pa' | 'pb' | 'pm') =>
  `COALESCE((SELECT pe.numero_prontuario FROM prontuario_estabelecimento pe
     WHERE pe.paciente_id = ${p}.id AND pe.estabelecimento_id = ${p}.cadastro_estabelecimento_id AND pe.tipo = 'interno'
       AND pe.excluido_em IS NULL AND pe.numero_prontuario REGEXP '^[0-9]{1,15}$' ORDER BY pe.id LIMIT 1),
     ${p}.numero_prontuario)`;

const FONETICA = (campo: 'nome' | 'mae') =>
  `(SELECT GROUP_CONCAT(DISTINCT k.fonetica ORDER BY k.fonetica SEPARATOR ' ') FROM chave_busca_nome k
     WHERE k.entidade = 'paciente' AND k.registro_id = p.id AND k.campo = '${campo}')`;
const ATUALIZADO = `GREATEST(COALESCE(p.alterado_em, p.criado_em), COALESCE(pf.alterado_em, pf.criado_em))`;
const SELECT_CADASTRO = `SELECT p.id, ${PRONTUARIO('p')} AS numero_prontuario, p.situacao, p.sobrevivente_paciente_id, pf.nome,
    COALESCE(p.nome_mae, pf.nome_mae) AS mae, pf.data_nascimento, sx.sigla AS sexo, pf.cpf, pf.cns,
    ${ATUALIZADO} AS atualizado_em, ${FONETICA('nome')} AS nome_fonetico, ${FONETICA('mae')} AS mae_fonetica
  FROM paciente p
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id AND pf.excluido_em IS NULL
  LEFT JOIN sexo sx ON sx.id = pf.sexo_id
  WHERE p.cadastro_estabelecimento_id = ? AND p.excluido_em IS NULL`;

function cadastroDaLinha(est: string, x: Linha): CadastroRedeLido {
  const sexo = textoOuNulo(x['sexo']);
  const situacao = String(x['situacao'] ?? '');
  const sobrevivente = x['sobrevivente_paciente_id'];
  return {
    estabelecimento: est,
    id: numero(x['id']),
    prontuario: numero(x['numero_prontuario']),
    nome: textoOuNulo(x['nome']),
    mae: textoOuNulo(x['mae']),
    nascimento: dataIso(x['data_nascimento']),
    sexo: sexo === 'F' || sexo === 'M' ? sexo : null,
    cpf: textoOuNulo(x['cpf']),
    cns: textoOuNulo(x['cns']),
    // Óbito não tira o cadastro da rede (a identidade continua); inativo e unificado tiram.
    ativo: situacao !== 'inativo' && situacao !== 'unificado',
    idUnificado: sobrevivente === null || sobrevivente === undefined ? null : numero(sobrevivente),
    nomeFoneticoBanco: textoOuNulo(x['nome_fonetico']),
    maeFoneticaBanco: textoOuNulo(x['mae_fonetica']),
    atualizadoEm: carimbo(x['atualizado_em']),
  };
}

const SELECT_PAR = `SELECT s.id, s.escore, s.criterio_cpf, s.criterio_fonetica, s.criterio_nascimento, s.criterio_mae,
    s.situacao, s.decidido_em, s.detectado_em, u.login AS decidido_por,
    pa.id AS id_a, ${PRONTUARIO('pa')} AS pront_a, ea.id AS est_a_id, ea.codigo AS est_a,
    pb.id AS id_b, ${PRONTUARIO('pb')} AS pront_b, eb.id AS est_b_id, eb.codigo AS est_b
  FROM suspeita_duplicidade s
  JOIN paciente pa ON pa.id = s.primeiro_paciente_id AND pa.excluido_em IS NULL
  JOIN paciente pb ON pb.id = s.segundo_paciente_id AND pb.excluido_em IS NULL
  JOIN estabelecimento ea ON ea.id = pa.cadastro_estabelecimento_id AND ea.excluido_em IS NULL
  JOIN estabelecimento eb ON eb.id = pb.cadastro_estabelecimento_id AND eb.excluido_em IS NULL
  LEFT JOIN usuario u ON u.id = s.decidido_por_usuario_id
  WHERE s.excluido_em IS NULL AND ea.id <> eb.id AND (ea.id = ? OR eb.id = ?)`;

const SITUACAO_DO_PAR: Readonly<Record<CandidatoRedeLido['situacao'], string>> = {
  aberto: 'aberto',
  outra_pessoa: 'outra_pessoa',
  vinculado: 'unificado',
};

function situacaoDaLinha(v: unknown): CandidatoRedeLido['situacao'] {
  return v === 'unificado' ? 'vinculado' : v === 'outra_pessoa' ? 'outra_pessoa' : 'aberto';
}

function criteriosDaLinha(x: Linha): string[] {
  const r: string[] = [];
  if (numero(x['criterio_cpf'])) r.push('cpf');
  if (numero(x['criterio_fonetica'])) r.push('nome_fonetico');
  if (numero(x['criterio_mae'])) r.push('mae');
  if (numero(x['criterio_nascimento'])) r.push('nascimento');
  return r;
}

function colunasCriterio(criterios: readonly string[]) {
  const tem = (...c: string[]) => c.some((x) => criterios.includes(x));
  return {
    criterio_cpf: tem('cpf'),
    criterio_fonetica: tem('nome', 'nome_fonetico'),
    criterio_nascimento: tem('nascimento'),
    criterio_mae: tem('mae', 'mae_fonetica'),
  };
}

/** O par na perspectiva do estabelecimento `estId` (null: código fora do formato da chave). */
function parDaLinha(estId: number, x: Linha): CandidatoRedeLido | null {
  const a = { est: String(x['est_a']), id: numero(x['id_a']), pront: numero(x['pront_a']) };
  const b = { est: String(x['est_b']), id: numero(x['id_b']), pront: numero(x['pront_b']) };
  let chave: string;
  try {
    chave = chavePar({ estabelecimento: a.est, id: a.id }, { estabelecimento: b.est, id: b.id });
  } catch {
    return null;
  }
  const [local, remoto] = numero(x['est_a_id']) === estId ? [a, b] : [b, a];
  const decididoEm = carimbo(x['decidido_em']);
  return {
    estabelecimento: local.est,
    chave,
    idLocal: local.id,
    prontuarioLocal: local.pront,
    estabelecimentoRemoto: remoto.est,
    idRemoto: remoto.id,
    prontuarioRemoto: remoto.pront,
    pontuacao: numero(x['escore']),
    criterios: criteriosDaLinha(x),
    // As divergências não são guardadas: a tela as recalcula dos dois cadastros lidos ao vivo.
    divergencias: [],
    situacao: situacaoDaLinha(x['situacao']),
    origem: decididoEm ? 'humano' : null,
    decididoPor: textoOuNulo(x['decidido_por']),
    decididoEm,
    criadoEm: carimbo(x['detectado_em']),
  };
}

const SELECT_UNIFICACAO = `SELECT uc.id, uc.situacao, uc.unificado_em, uc.revertido_em, uc.justificativa,
    uc.motivo_reversao, uc.mantido_paciente_id, uc.absorvido_paciente_id, uu.login AS por, ur.login AS desfeito_por,
    ${PRONTUARIO('pm')} AS pront_m, em.id AS est_m_id, em.codigo AS est_m,
    ${PRONTUARIO('pa')} AS pront_a, ea.id AS est_a_id, ea.codigo AS est_a
  FROM unificacao_cadastro uc
  JOIN paciente pm ON pm.id = uc.mantido_paciente_id AND pm.excluido_em IS NULL
  JOIN paciente pa ON pa.id = uc.absorvido_paciente_id AND pa.excluido_em IS NULL
  JOIN estabelecimento em ON em.id = pm.cadastro_estabelecimento_id AND em.excluido_em IS NULL
  JOIN estabelecimento ea ON ea.id = pa.cadastro_estabelecimento_id AND ea.excluido_em IS NULL
  LEFT JOIN usuario uu ON uu.id = uc.unificado_por_usuario_id
  LEFT JOIN usuario ur ON ur.id = uc.revertido_por_usuario_id
  WHERE uc.excluido_em IS NULL AND uc.situacao IN ('efetivada', 'revertida') AND em.id <> ea.id`;

/** A unificação vista do estabelecimento `estId` como vínculo (null: código fora do formato da chave). */
function vinculoDaLinha(estId: number, x: Linha): (VinculoRedeLido & { readonly id: number }) | null {
  const m = { est: String(x['est_m']), id: numero(x['mantido_paciente_id']), pront: numero(x['pront_m']) };
  const a = { est: String(x['est_a']), id: numero(x['absorvido_paciente_id']), pront: numero(x['pront_a']) };
  let chave: string;
  try {
    chave = chavePar({ estabelecimento: m.est, id: m.id }, { estabelecimento: a.est, id: a.id });
  } catch {
    return null;
  }
  const [local, remoto] = numero(x['est_m_id']) === estId ? [m, a] : [a, m];
  const revertida = x['situacao'] === 'revertida';
  return {
    id: numero(x['id']),
    estabelecimento: local.est,
    chave,
    pessoa: String(m.id),
    idLocal: local.id,
    prontuarioLocal: local.pront,
    estabelecimentoRemoto: remoto.est,
    idRemoto: remoto.id,
    prontuarioRemoto: remoto.pront,
    origem: 'humano',
    situacao: revertida ? 'desfeito' : 'ativo',
    criadoPor: textoOuNulo(x['por']) ?? '',
    criadoEm: carimbo(x['unificado_em']) ?? '',
    desfeitoPor: revertida ? textoOuNulo(x['desfeito_por']) : null,
    desfeitoEm: revertida ? carimbo(x['revertido_em']) : null,
    justificativa: textoOuNulo(revertida ? x['motivo_reversao'] : x['justificativa']),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id
const semId = ({ id: _id, ...v }: VinculoRedeLido & { readonly id: number }): VinculoRedeLido => v;

// ---- gravações (dentro da operação do Executor) ----

const esquemaGravacao = z
  .object({ estabelecimento: z.string().regex(CODIGO_CHAVE), rotulo: z.string().max(200) })
  .strict();

interface ParDaChave {
  readonly primeiro: number;
  readonly segundo: number;
  readonly lados: ReturnType<typeof ladosDaChave>;
}

function parDaChave(chave: string): ParDaChave {
  const lados = ladosDaChave(chave);
  const [x, y] = lados;
  return { primeiro: Math.min(x.id, y.id), segundo: Math.max(x.id, y.id), lados };
}

/**
 * A linha travada da suspeita do par, se os estabelecimentos do cadastro conferem com a chave. `comExcluida`: também a
 * excluída logicamente (a chave única do par não considera a exclusão: quem vai incluir tem de vê-la).
 */
async function suspeitaTravada(tx: TxOperacao, chave: string, comExcluida = false): Promise<Linha | null> {
  const p = parDaChave(chave);
  const [x] = await tx.consultarParaAtualizar(
    `SELECT s.id, s.situacao, s.versao, s.escore, s.criterio_cpf, s.criterio_fonetica, s.criterio_nascimento,
       s.criterio_mae, s.excluido_em, ea.codigo AS est_a, eb.codigo AS est_b, pa.id AS id_a
     FROM suspeita_duplicidade s
     JOIN paciente pa ON pa.id = s.primeiro_paciente_id
     JOIN paciente pb ON pb.id = s.segundo_paciente_id
     JOIN estabelecimento ea ON ea.id = pa.cadastro_estabelecimento_id
     JOIN estabelecimento eb ON eb.id = pb.cadastro_estabelecimento_id
     WHERE s.primeiro_paciente_id = ? AND s.segundo_paciente_id = ?${comExcluida ? '' : ' AND s.excluido_em IS NULL'}`,
    [p.primeiro, p.segundo],
  );
  if (!x) return null;
  const codigos = new Set([String(x['est_a']), String(x['est_b'])]);
  if (!p.lados.every((l) => codigos.has(l.estabelecimento)))
    throw recusa('par-fora-da-rede', 'Os cadastros do par não são dos estabelecimentos da chave.');
  return x;
}

function gravadorSobre(tx: TxOperacao, estId: number): GravadorRede {
  return {
    async escritas(ws: readonly EscritaIndiceRede[]) {
      let gravadas = 0;
      let jaEstavam = 0;
      for (const w of ws) {
        // A pessoa da rede é o próprio paciente do cliente: nada a incluir.
        if (w.alvo === 'pessoa') {
          jaEstavam++;
          continue;
        }
        if (w.alvo === 'vinculo') throw recusaUnificacao();
        if (w.situacao === 'vinculado') throw recusaUnificacao();
        const x = await suspeitaTravada(tx, w.chave);
        const alvo = SITUACAO_DO_PAR[w.situacao];
        if (!x || x['situacao'] === alvo) {
          jaEstavam++;
          continue;
        }
        if (x['situacao'] === 'unificado')
          throw recusa('par-decidido', 'O par já foi unificado no cadastro: a reversão é feita lá.');
        await tx.alterar(
          'suspeita_duplicidade',
          numero(x['id']),
          numero(x['versao']),
          alvo === 'outra_pessoa'
            ? {
                situacao: alvo,
                decidido_por_usuario_id: tx.contexto.usuario,
                decidido_em: new Date(w.em),
                justificativa: (w.justificativa ?? '').trim().slice(0, 200) || null,
              }
            : // Reaberto: a decisão anterior fica registrada (o automático não decide de novo um par reaberto).
              { situacao: alvo },
        );
        gravadas++;
      }
      return { gravadas, jaEstavam };
    },

    async candidatos(cs: readonly CandidatoParaGravarRede[]) {
      let novos = 0;
      let atualizados = 0;
      let mantidos = 0;
      for (const c of cs) {
        const escore = Math.max(0, Math.min(100, Math.round(c.pontuacao)));
        const criterios = colunasCriterio(c.criterios);
        const x = await suspeitaTravada(tx, c.chave, true);
        if (!x) {
          const p = parDaChave(c.chave);
          await tx.incluir('suspeita_duplicidade', {
            primeiro_paciente_id: p.primeiro,
            segundo_paciente_id: p.segundo,
            escore,
            ...criterios,
            detectado_em: new Date(c.em),
            situacao: 'aberto',
          });
          novos++;
          continue;
        }
        // Excluída logicamente: quem excluiu tirou o par da fila; o automático não o recria nem o restaura.
        if (x['excluido_em'] !== null && x['excluido_em'] !== undefined) {
          mantidos++;
          continue;
        }
        const igual =
          numero(x['escore']) === escore &&
          Object.entries(criterios).every(([k, v]) => Boolean(numero(x[k])) === v);
        if (x['situacao'] !== 'aberto' || igual) {
          mantidos++;
          continue;
        }
        await tx.alterar('suspeita_duplicidade', numero(x['id']), numero(x['versao']), {
          escore,
          ...criterios,
        });
        atualizados++;
      }
      return { novos, atualizados, mantidos };
    },

    async marca(m: MarcaRede) {
      const valor = JSON.stringify({
        u: m.ultimoId,
        a: m.ultimaAtualizacao,
        i: m.ultimoIdAlterado ?? 0,
      });
      const [x] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM marca_sincronismo
         WHERE estabelecimento_id = ? AND sistema_origem = ? AND tabela_origem = ?`,
        [estId, SISTEMA_MARCA, TABELA_MARCA],
      );
      const valores = { tipo_marca: 'sequencial', valor_marca: valor, marcado_em: new Date(), ativo: true };
      if (x) await tx.alterar('marca_sincronismo', numero(x['id']), numero(x['versao']), valores);
      else
        await tx.incluir('marca_sincronismo', {
          estabelecimento_id: estId,
          sistema_origem: SISTEMA_MARCA,
          tabela_origem: TABELA_MARCA,
          ...valores,
        });
    },

    async duplicidadesLocais(pares: readonly ParNovo[]) {
      let n = 0;
      for (const p of pares) {
        const primeiro = Math.min(p.a.id, p.b.id);
        const segundo = Math.max(p.a.id, p.b.id);
        if (primeiro === segundo) continue;
        const [x] = await tx.consultarParaAtualizar(
          `SELECT s.id FROM suspeita_duplicidade s
           JOIN paciente pa ON pa.id = s.primeiro_paciente_id AND pa.cadastro_estabelecimento_id = ?
           WHERE s.primeiro_paciente_id = ? AND s.segundo_paciente_id = ?`,
          [estId, primeiro, segundo],
        );
        if (x) continue;
        await tx.incluir('suspeita_duplicidade', {
          primeiro_paciente_id: primeiro,
          segundo_paciente_id: segundo,
          escore: Math.max(0, Math.min(100, Math.round(p.escore))),
          ...colunasCriterio(p.criterios),
          detectado_em: new Date(),
          situacao: 'aberto',
        });
        n++;
      }
      return n;
    },
  };
}

// ---- a porta ----

export class PortaRedePropria implements PortaRede {
  readonly destino = 'proprio' as const;
  readonly mesmaPessoaPorUnificacao = true;
  private readonly executor: Executor;
  private porCodigo = new Map<string, { id: number; nome: string }>();
  private lista: EstabelecimentoRede[] = [];
  /** Códigos de estabelecimento fora do formato da chave do par (fora do MPI, com aviso). */
  private foraDoFormato = new Set<string>();

  constructor(
    private readonly nucleo: NucleoRede,
    private readonly cliente: string,
    private readonly rede: string | null,
    executor?: Executor,
    private readonly aviso: (mensagem: string) => void = (m) => console.warn(m),
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  /**
   * Lê (ou relê) os estabelecimentos do cliente. Os de código fora do formato da chave do par ficam de fora do MPI, com
   * um aviso no log (só os códigos e a contagem) a cada mudança da lista, e recusa explícita em `estId`.
   */
  async carregar(): Promise<void> {
    const linhas = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'rede-estabelecimentos' },
      (l) =>
        l.consultar(
          'SELECT id, codigo, nome_fantasia FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo',
          [],
          { teto: 10_000 },
        ),
    );
    const validos = linhas.filter((x) => CODIGO_CHAVE.test(String(x['codigo'])));
    const fora = linhas.map((x) => String(x['codigo'])).filter((k) => !CODIGO_CHAVE.test(k));
    const mudou = fora.length !== this.foraDoFormato.size || fora.some((k) => !this.foraDoFormato.has(k));
    this.foraDoFormato = new Set(fora);
    if (mudou && fora.length > 0)
      this.aviso(
        `[rede] ${fora.length} estabelecimento(s) fora do MPI: código fora do formato da chave do par (${fora
          .map((k) => JSON.stringify(k.slice(0, 30)))
          .join(', ')}); ajuste o código no cadastro do estabelecimento.`,
      );
    this.porCodigo = new Map(
      validos.map((x) => [String(x['codigo']), { id: numero(x['id']), nome: String(x['nome_fantasia']) }]),
    );
    this.lista = validos.map((x) => ({ codigo: String(x['codigo']), nome: String(x['nome_fantasia']) }));
  }

  redeConfigurada(): string | null {
    return this.rede;
  }

  estabelecimentos(): readonly EstabelecimentoRede[] {
    return this.lista;
  }

  async contextoBanco(c: ContextoRede): Promise<ContextoNucleo> {
    return {
      cliente: this.cliente,
      estabelecimento: await this.estId(c),
      usuario: null,
      correlacao: 'rede-bi',
    };
  }

  private async estId(c: ContextoRede): Promise<number> {
    if (this.rede === null || c.rede !== this.rede)
      throw new ErroProblema('sem-permissao', 403, 'Fora da rede', 'A rede da sessão não é a deste cliente.');
    if (!this.porCodigo.has(c.hospital)) await this.carregar();
    const e = this.porCodigo.get(c.hospital);
    if (!e && this.foraDoFormato.has(c.hospital))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Estabelecimento fora do MPI',
        'O código deste estabelecimento não cabe na chave do par da rede (letra minúscula seguida de 1 a 9 letras minúsculas ou dígitos): ajuste o código no cadastro do estabelecimento.',
        { codigo: 'codigo-fora-do-formato' },
      );
    if (!e)
      throw new ErroProblema('sem-permissao', 403, 'Fora da rede', 'O estabelecimento não é deste cliente.', {
        codigo: 'fora-da-rede',
      });
    return e.id;
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'rede-mpi' }, fn);
  }

  // ---- cadastros ----

  async cadastrosPorIds(c: ContextoRede, ids: readonly number[]): Promise<CadastroRedeLido[]> {
    const est = await this.estId(c);
    const unicos = [...new Set(ids)].filter((i) => Number.isInteger(i) && i > 0).slice(0, TETO_IDS);
    if (unicos.length === 0) return [];
    const linhas = await this.ler((l) =>
      l.consultar(`${SELECT_CADASTRO} AND p.id IN (${lista(unicos)}) ORDER BY p.id`, [est, ...unicos], {
        teto: TETO_IDS,
      }),
    );
    return linhas.map((x) => cadastroDaLinha(c.hospital, x));
  }

  async procurarCandidatos(c: ContextoRede, k: ChavesProcuraRede): Promise<number[]> {
    const est = await this.estId(c);
    const ativo = `p.situacao NOT IN ('inativo', 'unificado')`;
    const ids = new Set<number>();
    const juntar = (linhas: Linha[]) => linhas.forEach((x) => ids.add(numero(x['id'])));
    const nome = palavras(k.nomeFoneticoBanco);
    const mae = palavras(k.maeFoneticaBanco);
    await this.ler(async (l) => {
      const base = `SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id AND pf.excluido_em IS NULL
        WHERE p.cadastro_estabelecimento_id = ? AND p.excluido_em IS NULL AND ${ativo}`;
      if (k.cpf && /^\d{11}$/.test(k.cpf))
        juntar(await l.consultar(`${base} AND pf.cpf = ? LIMIT ?`, [est, k.cpf, TETO_CANDIDATOS]));
      if (k.cns && /^\d{15}$/.test(k.cns))
        juntar(await l.consultar(`${base} AND pf.cns = ? LIMIT ?`, [est, k.cns, TETO_CANDIDATOS]));
      // Nome foneticamente igual (todas as palavras) e o mesmo nascimento, ou também a mãe foneticamente igual.
      const porFonetica = async (extra: string, extraP: unknown[], comMae: boolean) => {
        const condicao = comMae
          ? `((k.campo = 'nome' AND k.fonetica IN (${lista(nome)})) OR (k.campo = 'mae' AND k.fonetica IN (${lista(mae)})))`
          : `k.campo = 'nome' AND k.fonetica IN (${lista(nome)})`;
        const having = comMae
          ? `COUNT(DISTINCT CASE WHEN k.campo = 'nome' THEN k.fonetica END) = ? AND COUNT(DISTINCT CASE WHEN k.campo = 'mae' THEN k.fonetica END) = ?`
          : `COUNT(DISTINCT k.fonetica) = ?`;
        juntar(
          await l.consultar(
            `SELECT p.id FROM chave_busca_nome k
             JOIN paciente p ON p.id = k.registro_id AND p.excluido_em IS NULL AND ${ativo}
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id AND pf.excluido_em IS NULL
             WHERE k.entidade = 'paciente' AND ${condicao} AND p.cadastro_estabelecimento_id = ? ${extra}
             GROUP BY p.id HAVING ${having} LIMIT ?`,
            [
              ...nome,
              ...(comMae ? mae : []),
              est,
              ...extraP,
              nome.length,
              ...(comMae ? [mae.length] : []),
              TETO_CANDIDATOS,
            ],
          ),
        );
      };
      if (nome.length > 0 && k.nascimento && /^\d{4}-\d{2}-\d{2}$/.test(k.nascimento))
        await porFonetica('AND pf.data_nascimento = ?', [k.nascimento], false);
      if (nome.length > 0 && mae.length > 0) await porFonetica('', [], true);
    });
    return [...ids].sort((a, b) => a - b);
  }

  async loteCadastros(c: ContextoRede, depoisDoId: number, tamanho: number) {
    const est = await this.estId(c);
    const n = Math.max(1, Math.min(TETO_IDS, Math.trunc(tamanho)));
    const linhas = await this.ler((l) =>
      l.consultar(`${SELECT_CADASTRO} AND p.id > ? ORDER BY p.id LIMIT ?`, [est, depoisDoId, n], { teto: n }),
    );
    const itens = linhas.map((x) => cadastroDaLinha(c.hospital, x));
    return { itens, ultimoId: itens.length ? (itens[itens.length - 1] as CadastroRedeLido).id : depoisDoId };
  }

  async cadastrosAlterados(c: ContextoRede, desde: Date, depoisDoId: number, tamanho: number) {
    const est = await this.estId(c);
    const n = Math.max(1, Math.min(TETO_IDS, Math.trunc(tamanho)));
    const linhas = await this.ler((l) =>
      l.consultar(
        `${SELECT_CADASTRO} AND (${ATUALIZADO} > ? OR (${ATUALIZADO} = ? AND p.id > ?))
         ORDER BY atualizado_em, p.id LIMIT ?`,
        [est, desde, desde, depoisDoId, n],
        { teto: n },
      ),
    );
    return linhas.map((x) => cadastroDaLinha(c.hospital, x));
  }

  // ---- a fila (suspeita_duplicidade entre estabelecimentos) ----

  private filtroFila(
    est: number,
    f: Partial<FiltroFilaRede> & RecorteFilaRede,
  ): { sql: string; p: unknown[] } {
    const partes: string[] = [];
    const p: unknown[] = [];
    if (f.situacao) {
      partes.push('s.situacao = ?');
      p.push(SITUACAO_DO_PAR[f.situacao]);
    }
    if (f.pontuacaoMinima !== undefined) {
      partes.push('s.escore >= ?');
      p.push(f.pontuacaoMinima);
    }
    if (f.pontuacaoMaxima !== undefined) {
      partes.push('s.escore <= ?');
      p.push(f.pontuacaoMaxima);
    }
    const remoto = '(CASE WHEN ea.id = ? THEN eb.codigo ELSE ea.codigo END)';
    if (f.estabelecimentoRemoto) {
      partes.push(`${remoto} = ?`);
      p.push(est, f.estabelecimentoRemoto);
    }
    if (f.estabelecimentosRemotos) {
      if (f.estabelecimentosRemotos.length === 0) partes.push('1 = 0');
      else {
        partes.push(`${remoto} IN (${lista(f.estabelecimentosRemotos)})`);
        p.push(est, ...f.estabelecimentosRemotos);
      }
    }
    if (f.prontuarioLocal !== undefined) {
      // O prontuário da unidade (o mesmo da tela), comparado como número.
      partes.push(
        `CAST((CASE WHEN ea.id = ? THEN ${PRONTUARIO('pa')} ELSE ${PRONTUARIO('pb')} END) AS UNSIGNED) = ?`,
      );
      p.push(est, f.prontuarioLocal);
    }
    return { sql: partes.map((x) => ` AND ${x}`).join(''), p };
  }

  async fila(c: ContextoRede, f: FiltroFilaRede) {
    const est = await this.estId(c);
    const w = this.filtroFila(est, f);
    const porPagina = Math.max(1, Math.min(200, Math.trunc(f.porPagina)));
    const inicio = (Math.max(1, Math.trunc(f.pagina)) - 1) * porPagina;
    return this.ler(async (l) => {
      const linhas = await l.consultar(
        `${SELECT_PAR}${w.sql} ORDER BY s.criterio_cpf DESC, s.escore DESC, s.id LIMIT ? OFFSET ?`,
        [est, est, ...w.p, porPagina, inicio],
        { teto: porPagina },
      );
      const total = await l.uma(`SELECT COUNT(*) AS n FROM (${SELECT_PAR}${w.sql}) x`, [est, est, ...w.p]);
      return {
        itens: linhas.map((x) => parDaLinha(est, x)).filter((x): x is CandidatoRedeLido => x !== null),
        total: numero(total?.['n']),
      };
    });
  }

  async filaPorFaixa(
    c: ContextoRede,
    situacao: CandidatoRedeLido['situacao'],
    recorte: RecorteFilaRede = {},
  ) {
    const est = await this.estId(c);
    const w = this.filtroFila(est, { situacao, ...recorte });
    const x = await this.ler((l) =>
      l.uma(
        `SELECT COALESCE(SUM(escore >= ?), 0) AS alta, COALESCE(SUM(escore >= ? AND escore < ?), 0) AS media,
           COALESCE(SUM(escore < ?), 0) AS baixa
         FROM (${SELECT_PAR}${w.sql}) x`,
        [
          FAIXAS_PONTUACAO_REDE.alta.minimo,
          FAIXAS_PONTUACAO_REDE.media.minimo,
          FAIXAS_PONTUACAO_REDE.alta.minimo,
          FAIXAS_PONTUACAO_REDE.media.minimo,
          est,
          est,
          ...w.p,
        ],
      ),
    );
    return { alta: numero(x?.['alta']), media: numero(x?.['media']), baixa: numero(x?.['baixa']) };
  }

  async candidato(c: ContextoRede, chave: string): Promise<CandidatoRedeLido | null> {
    const est = await this.estId(c);
    let p: ParDaChave;
    try {
      p = parDaChave(chave);
    } catch (e) {
      if (e instanceof ErroChaveRede) return null;
      throw e;
    }
    const x = await this.ler((l) =>
      l.uma(`${SELECT_PAR} AND s.primeiro_paciente_id = ? AND s.segundo_paciente_id = ?`, [
        est,
        est,
        p.primeiro,
        p.segundo,
      ]),
    );
    const par = x ? parDaLinha(est, x) : null;
    return par && par.chave === chave ? par : null;
  }

  async situacoes(c: ContextoRede, chaves: readonly string[]) {
    const est = await this.estId(c);
    const r = new Map<string, CandidatoRedeLido['situacao'] | 'reaberto'>();
    const pares: ParDaChave[] = [];
    for (const k of new Set(chaves)) {
      try {
        pares.push(parDaChave(k));
      } catch (e) {
        if (!(e instanceof ErroChaveRede)) throw e;
      }
    }
    for (let i = 0; i < pares.length; i += 500) {
      const lote = pares.slice(i, i + 500);
      const linhas = await this.ler((l) =>
        l.consultar(
          `${SELECT_PAR} AND (s.primeiro_paciente_id, s.segundo_paciente_id) IN (${lote.map(() => '(?, ?)').join(', ')})`,
          [est, est, ...lote.flatMap((p) => [p.primeiro, p.segundo])],
          { teto: 1_000 },
        ),
      );
      for (const x of linhas) {
        const par = parDaLinha(est, x);
        if (!par) continue;
        r.set(par.chave, par.situacao === 'aberto' && par.decididoEm !== null ? 'reaberto' : par.situacao);
      }
    }
    return r;
  }

  // ---- vínculos (unificações entre estabelecimentos) ----

  async vinculo(c: ContextoRede, chave: string): Promise<VinculoRedeLido | null> {
    const est = await this.estId(c);
    let p: ParDaChave;
    try {
      p = parDaChave(chave);
    } catch (e) {
      if (e instanceof ErroChaveRede) return null;
      throw e;
    }
    const x = await this.ler((l) =>
      l.uma(
        `${SELECT_UNIFICACAO} AND (em.id = ? OR ea.id = ?)
           AND ((uc.mantido_paciente_id = ? AND uc.absorvido_paciente_id = ?)
             OR (uc.mantido_paciente_id = ? AND uc.absorvido_paciente_id = ?))
         ORDER BY uc.id DESC LIMIT 1`,
        [est, est, p.primeiro, p.segundo, p.segundo, p.primeiro],
      ),
    );
    const v = x ? vinculoDaLinha(est, x) : null;
    return v && v.chave === chave ? semId(v) : null;
  }

  async vinculosDoCadastro(c: ContextoRede, id: number): Promise<VinculoRedeLido[]> {
    const est = await this.estId(c);
    const linhas = await this.ler((l) =>
      l.consultar(
        `${SELECT_UNIFICACAO} AND ((uc.mantido_paciente_id = ? AND em.id = ?) OR (uc.absorvido_paciente_id = ? AND ea.id = ?))
         ORDER BY uc.id DESC`,
        [id, est, id, est],
        { teto: 500 },
      ),
    );
    return linhas
      .map((x) => vinculoDaLinha(est, x))
      .filter((v): v is VinculoRedeLido & { id: number } => v !== null)
      .map(semId);
  }

  async pessoasDosCadastros(c: ContextoRede, ids: readonly number[]): Promise<Map<number, string>> {
    const est = await this.estId(c);
    const unicos = [...new Set(ids)].filter((i) => Number.isInteger(i) && i > 0).slice(0, TETO_IDS);
    const r = new Map<number, string>();
    if (unicos.length === 0) return r;
    const linhas = await this.ler((l) =>
      l.consultar(
        `${SELECT_UNIFICACAO} AND uc.situacao = 'efetivada'
           AND ((uc.mantido_paciente_id IN (${lista(unicos)}) AND em.id = ?)
             OR (uc.absorvido_paciente_id IN (${lista(unicos)}) AND ea.id = ?))
         ORDER BY uc.id`,
        [...unicos, est, ...unicos, est],
        { teto: 10_000 },
      ),
    );
    const pedidos = new Set(unicos);
    for (const x of linhas) {
      const pessoa = String(numero(x['mantido_paciente_id']));
      for (const [lado, estLado] of [
        [numero(x['mantido_paciente_id']), numero(x['est_m_id'])],
        [numero(x['absorvido_paciente_id']), numero(x['est_a_id'])],
      ] as const)
        if (estLado === est && pedidos.has(lado) && !r.has(lado)) r.set(lado, pessoa);
    }
    return r;
  }

  async loteVinculos(c: ContextoRede, depoisDoId: number, tamanho: number) {
    const est = await this.estId(c);
    const n = Math.max(1, Math.min(TETO_IDS, Math.trunc(tamanho)));
    const linhas = await this.ler((l) =>
      l.consultar(`${SELECT_UNIFICACAO} AND uc.id > ? AND (em.id = ? OR ea.id = ?) ORDER BY uc.id LIMIT ?`, [
        depoisDoId,
        est,
        est,
        n,
      ]),
    );
    const vs = linhas.map((x) => vinculoDaLinha(est, x));
    const ultimoId = linhas.length ? numero(linhas[linhas.length - 1]?.['id']) : depoisDoId;
    return {
      itens: vs.filter((v): v is VinculoRedeLido & { id: number } => v !== null).map(semId),
      ultimoId,
    };
  }

  async marca(c: ContextoRede): Promise<MarcaRede | null> {
    const est = await this.estId(c);
    const x = await this.ler((l) =>
      l.uma(
        `SELECT valor_marca FROM marca_sincronismo
         WHERE estabelecimento_id = ? AND sistema_origem = ? AND tabela_origem = ? AND ativo = TRUE`,
        [est, SISTEMA_MARCA, TABELA_MARCA],
      ),
    );
    const v = textoOuNulo(x?.['valor_marca']);
    if (!v) return null;
    try {
      const m = JSON.parse(v) as { u?: unknown; a?: unknown; i?: unknown };
      return {
        ultimoId: numero(m.u),
        ultimaAtualizacao: typeof m.a === 'string' ? m.a : null,
        ultimoIdAlterado: numero(m.i),
      };
    } catch {
      return null;
    }
  }

  // ---- etapa 2: o aviso e o CPF do login ----

  async atendimentos(c: ContextoRede, prontuario: number): Promise<AtendimentosRede> {
    const est = await this.estId(c);
    return this.ler(async (l) => {
      // O paciente do prontuário da unidade (o do cliente, se a unidade não tiver o número), e o mantido, quando já
      // unificado: os registros foram para ele.
      const pe = await l.uma(
        `SELECT pe.paciente_id AS id FROM prontuario_estabelecimento pe
         WHERE pe.estabelecimento_id = ? AND pe.tipo = 'interno' AND pe.excluido_em IS NULL
           AND pe.numero_prontuario REGEXP '^[0-9]{1,15}$' AND CAST(pe.numero_prontuario AS UNSIGNED) = ?
         ORDER BY pe.id LIMIT 1`,
        [est, prontuario],
      );
      const p = await l.uma(
        `SELECT COALESCE(sobrevivente_paciente_id, id) AS id FROM paciente
         WHERE ${pe ? 'id' : 'numero_prontuario'} = ? AND excluido_em IS NULL`,
        [pe ? numero(pe['id']) : prontuario],
      );
      if (!p) return { atendimentos: 0, ultimoAtendimento: null, internacoes: 0, ultimaInternacao: null };
      const a = await l.uma(
        `SELECT COUNT(*) AS n, MAX(entrada_em) AS ultimo FROM atendimento
         WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [numero(p['id']), est],
      );
      const i = await l.uma(
        `SELECT COUNT(*) AS n, MAX(data_hora_entrada) AS ultimo FROM internacao
         WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND data_hora_cancelamento IS NULL`,
        [numero(p['id']), est],
      );
      return {
        atendimentos: numero(a?.['n']),
        ultimoAtendimento: dataIso(a?.['ultimo']),
        internacoes: numero(i?.['n']),
        ultimaInternacao: dataIso(i?.['ultimo']),
      };
    });
  }

  async atendimentosNaRede(c: ContextoRede, id: number): Promise<AtendimentosNaRede[]> {
    const est = await this.estId(c);
    if (!Number.isInteger(id) || id <= 0) return [];
    const linhas = await this.ler(async (l): Promise<Linha[]> => {
      // O grupo do paciente: o mantido (ele mesmo, se não foi unificado) e os absorvidos por ele.
      const p = await l.uma(
        'SELECT COALESCE(sobrevivente_paciente_id, id) AS raiz FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [id],
      );
      if (!p) return [];
      const raiz = numero(p['raiz']);
      const grupo =
        'SELECT g.id FROM paciente g WHERE (g.id = ? OR g.sobrevivente_paciente_id = ?) AND g.excluido_em IS NULL';
      return l
        .consultar(
          `SELECT e.codigo, SUM(x.na) AS na, MAX(x.ua) AS ua, SUM(x.ni) AS ni, MAX(x.ui) AS ui FROM (
           SELECT a.estabelecimento_id AS est, COUNT(*) AS na, MAX(a.entrada_em) AS ua, 0 AS ni,
             CAST(NULL AS DATETIME(3)) AS ui
           FROM atendimento a
           WHERE a.paciente_id IN (${grupo}) AND a.estabelecimento_id <> ? AND a.excluido_em IS NULL
             AND a.situacao <> 'cancelado'
           GROUP BY a.estabelecimento_id
           UNION ALL
           SELECT i.estabelecimento_id, 0, CAST(NULL AS DATETIME(3)), COUNT(*), MAX(i.data_hora_entrada)
           FROM internacao i
           WHERE i.paciente_id IN (${grupo}) AND i.estabelecimento_id <> ? AND i.excluido_em IS NULL
             AND i.data_hora_cancelamento IS NULL
           GROUP BY i.estabelecimento_id
         ) x
         JOIN estabelecimento e ON e.id = x.est AND e.excluido_em IS NULL
         GROUP BY e.id, e.codigo ORDER BY e.codigo`,
          [raiz, raiz, est, raiz, raiz, est],
          { teto: 1_000 },
        )
        .then((xs) => xs.map((x): Linha => ({ ...x, raiz })));
    });
    return linhas
      .filter((x) => this.porCodigo.has(String(x['codigo'])))
      .map((x) => ({
        estabelecimento: String(x['codigo']),
        idRemoto: numero(x['raiz']),
        atendimentos: numero(x['na']),
        ultimoAtendimento: dataIso(x['ua']),
        internacoes: numero(x['ni']),
        ultimaInternacao: dataIso(x['ui']),
      }));
  }

  async cpfDoLogin(c: ContextoRede, login: string): Promise<string | null> {
    await this.estId(c);
    // O usuário é do cliente inteiro (um cadastro de usuários por banco): o mesmo login é a mesma conta.
    const x = await this.ler((l) =>
      l.uma('SELECT cpf FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]),
    );
    const cpf = textoOuNulo(x?.['cpf']);
    return cpf && /^\d{11}$/.test(cpf) ? cpf : null;
  }

  // ---- gravação: uma operação do Executor por chamada (a decisão sobre um par é uma só) ----

  async gravar<T>(
    c: ContextoRede,
    fn: (g: GravadorRede) => Promise<T>,
    trilha: TrilhaRede | null,
  ): Promise<T> {
    const est = await this.estId(c);
    let resultado: { valor: T } | null = null;
    const op = definirOperacao({
      nome: 'rede.gravar-indice',
      tabelas: ['suspeita_duplicidade', 'marca_sincronismo'],
      entrada: esquemaGravacao,
      acao: 'operacao',
      async gravar(tx, e) {
        resultado = { valor: await fn(gravadorSobre(tx, est)) };
        return { estabelecimento: e.estabelecimento };
      },
      alvo: () => ({ tabela: 'suspeita_duplicidade', id: trilha?.entidadeId ?? null }),
      trilha: () => ({ dados: trilha?.dadosDepois ?? null, motivo: trilha?.motivo ?? null }),
    });
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: trilha?.estabelecimento ?? est,
      usuario: trilha?.usuario ?? null,
      correlacao: (trilha?.correlacao ?? 'rede-mpi').slice(0, 64) || 'rede-mpi',
      chaveIdempotencia: `rede:${randomUUID()}`,
    };
    const rotulo = JSON.stringify(trilha?.dadosDepois ?? null).slice(0, 200);
    await this.executor.executar(op, this.cliente, { estabelecimento: c.hospital, rotulo }, contexto);
    if (!resultado) throw new Error('Gravação do índice sem resultado.');
    return (resultado as { valor: T }).valor;
  }
}
