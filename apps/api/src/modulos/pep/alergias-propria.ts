// Alergias do paciente sobre o banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo), nas duas portas do PEP:
//   - documentos: `alergias`, `catalogoAlergias`, `registrosParaAlergia` e `versaoAlergias`;
//   - prescrição: `alergias` (o contexto do alerta de alergia do motor da prescrição).
// Funções sobre (nucleo, cliente, contexto, ...): o integrador troca as recusas 501 das portas próprias por elas.
// Tabelas: alergia_paciente, alergeno, tipo_alergia, alergeno_principio_ativo, alergia_paciente_principio,
// principio_ativo, principio_ativo_cliente, profissional, pessoa_fisica, registro_assistencial,
// modelo_documento_clinico, inscricao_conselho e estabelecimento.
//
// Segurança do paciente (decisão do orquestrador): a leitura mostra TODA alergia ou intolerância confirmada do
// paciente, inclusive a de descrição livre (sem alérgeno cadastrado) e a sem registro clínico (vinda da classificação
// de risco ou da importação). Nunca esconde uma alergia: o agente da linha é o alérgeno do catálogo ou, sem ele, a
// descrição livre. Fora da lista ficam só o que não é alergia: a declaração "nega/desconhece alergias", o rascunho
// (só o autor vê; nunca dispara alerta) e o rascunho descartado, além da linha com exclusão lógica.
//
// Alcance: o paciente é do cliente inteiro (o mesmo paciente_id em todos os estabelecimentos do banco). Por isso a
// lista, a versão (documentos) e o contexto da prescrição leem as alergias do paciente em TODOS os estabelecimentos do
// cliente: uma alergia nunca some da tela, do cabeçalho, do sumário de alta nem da conferência de duplicidade por ter
// sido informada no hospital vizinho, e a tela, o painel e o alerta da prescrição veem o mesmo conjunto. A linha traz
// o estabelecimento de origem (estabelecimentoId). A memória recorta por hospital só porque nela cada hospital é um
// mundo separado; isso não vale para o banco de um cliente. Nenhuma leitura cruza bancos.
//
// Alerta da alergia de descrição livre: o motor casa a alergia com o item pelos princípios ativos. A alergia livre
// alerta pelos princípios registrados nela (alergia_paciente_principio) e, além disso, quando a descrição livre é o
// nome de um princípio ativo (oficial ou do cadastro do cliente), comparação exata na colação utf8mb4_uca1400_ai_ci
// (sem diferença de maiúsculas e acentos; explícita porque principio_ativo_cliente tem colação própria). Nada é
// inferido por semelhança.
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import type { AlergiaDoProntuarioLida, AlergiaLida } from './tipos-pep.js';
import { dataHora, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';

/** O contexto mínimo que as duas portas passam (ContextoDocs e ContextoPrescricao). */
export interface ContextoAlergias {
  readonly hospital: string;
  readonly cliente?: string | null;
}

/**
 * Alergia lida com o dado completo. Estende localmente AlergiaDoProntuarioLida: o agente do catálogo é opcional
 * (descrição livre) e o registro clínico também (alergia da classificação de risco ou importada).
 */
export interface AlergiaDoProntuarioCompleta extends Omit<AlergiaDoProntuarioLida, 'agenteId' | 'registro'> {
  /** Alérgeno do catálogo; null na alergia de descrição livre. */
  readonly agenteId: number | null;
  /** Registro clínico em que foi informada; null na alergia sem registro clínico. */
  readonly registro: number | null;
  /** Agente descrito em texto (não cadastrado), quando houver. */
  readonly descricaoLivre: string | null;
  readonly tipoRegistro: 'alergia' | 'intolerancia';
  readonly reacao: string | null;
  readonly gravidade: string | null;
  readonly certeza: string | null;
  readonly origemInformacao: string | null;
  readonly inativadaEm: string | null;
  readonly motivoInativacao: string | null;
  /** Estabelecimento (do mesmo cliente) em que a alergia foi registrada. */
  readonly estabelecimentoId: number;
}

export interface CatalogoAlergiasLido {
  agentes: { id: number; nome: string; tipo: string | null }[];
  principios: { id: number; nome: string }[];
}

export interface RegistroParaAlergia {
  registro: number;
  modelo: string;
  dataHora: string | null;
}

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** Nome do tipo de agente pela natureza do alérgeno (quando o alérgeno não tem tipo de alergia). */
export const TIPO_DA_NATUREZA: Readonly<Record<string, string>> = {
  medicamento: 'Medicamento',
  alimento: 'Alimento',
  latex: 'Látex',
  contraste: 'Contraste',
  ambiental: 'Ambiental',
  inseto: 'Inseto',
  outro: 'Outro',
};

/** Agente da linha sem alérgeno e sem descrição (o CHECK do banco não deixa; nunca some da lista). */
export const AGENTE_NAO_INFORMADO = 'Agente não informado';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const verdade = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const idsValidos = (ids: readonly number[]): number[] =>
  [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0);

/** Filtro comum: alergia ou intolerância confirmada, sem exclusão lógica. */
const SQL_E_ALERGIA = `ap.excluido_em IS NULL AND ap.tipo_registro IN ('alergia','intolerancia')
   AND ap.situacao_registro = 'confirmado'`;

function ler<T>(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  rotulo: string,
  fn: (l: Leitor, est: Estabelecimento) => Promise<T>,
): Promise<T> {
  return nucleo.lerSomente(
    { cliente: c.cliente || cliente, correlacao: `pep.alergias.${rotulo}` },
    async (l) => {
      const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
        'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      if (!e)
        throw new ErroOperacao(
          404,
          'estabelecimento-inexistente',
          'Estabelecimento não encontrado',
          'O estabelecimento da sessão não existe neste cliente.',
        );
      return fn(l, { id: num(e.id), fuso: fusoValido(e.fuso_horario) });
    },
  );
}

/** Princípios ativos de cada alergia: os registrados nela e os ligados ao alérgeno (nome e id oficial, se houver). */
async function principiosDe(
  l: Leitor,
  alergias: readonly number[],
  porNomeLivre: boolean,
): Promise<Map<number, { id: number | null; nome: string }[]>> {
  const r = new Map<number, { id: number | null; nome: string }[]>();
  if (alergias.length === 0) return r;
  const m = marcadores(alergias.length);
  const partes = [
    `SELECT app.alergia_paciente_id AS alergia, COALESCE(pa.id, pac.principio_ativo_id) AS id,
            COALESCE(pa.descricao, pac.nome) COLLATE utf8mb4_uca1400_ai_ci AS nome, 1 AS ordem, app.id AS seq
       FROM alergia_paciente_principio app
       LEFT JOIN principio_ativo pa ON pa.id = app.principio_ativo_id
       LEFT JOIN principio_ativo_cliente pac ON pac.id = app.principio_ativo_cliente_id
      WHERE app.alergia_paciente_id IN (${m}) AND app.excluido_em IS NULL`,
    `SELECT ap.id AS alergia, COALESCE(pa.id, pac.principio_ativo_id) AS id,
            COALESCE(pa.descricao, pac.nome) COLLATE utf8mb4_uca1400_ai_ci AS nome, 2 AS ordem, apa.id AS seq
       FROM alergia_paciente ap
       JOIN alergeno_principio_ativo apa ON apa.alergeno_id = ap.alergeno_id
            AND apa.ativo = TRUE AND apa.excluido_em IS NULL
       LEFT JOIN principio_ativo pa ON pa.id = apa.principio_ativo_id
       LEFT JOIN principio_ativo_cliente pac ON pac.id = apa.principio_ativo_cliente_id
      WHERE ap.id IN (${m})`,
  ];
  const params: unknown[] = [...alergias, ...alergias];
  if (porNomeLivre) {
    partes.push(
      `SELECT ap.id AS alergia, pa.id AS id, pa.descricao COLLATE utf8mb4_uca1400_ai_ci AS nome, 3 AS ordem, pa.id AS seq
         FROM alergia_paciente ap
         JOIN principio_ativo pa ON pa.descricao COLLATE utf8mb4_uca1400_ai_ci = TRIM(ap.descricao_livre) COLLATE utf8mb4_uca1400_ai_ci
        WHERE ap.id IN (${m}) AND ap.descricao_livre IS NOT NULL`,
      `SELECT ap.id AS alergia, pac.principio_ativo_id AS id, pac.nome COLLATE utf8mb4_uca1400_ai_ci AS nome, 4 AS ordem, pac.id AS seq
         FROM alergia_paciente ap
         JOIN principio_ativo_cliente pac ON pac.nome COLLATE utf8mb4_uca1400_ai_ci = TRIM(ap.descricao_livre) COLLATE utf8mb4_uca1400_ai_ci
        WHERE ap.id IN (${m}) AND ap.descricao_livre IS NOT NULL`,
    );
    params.push(...alergias, ...alergias);
  }
  const linhas = await l.consultar(
    `SELECT x.alergia, x.id, x.nome FROM (${partes.join(' UNION ALL ')}) x ORDER BY x.alergia, x.ordem, x.seq`,
    params,
  );
  for (const x of linhas) {
    const nome = textoOuNull(x['nome']);
    if (nome === null) continue;
    const a = num(x['alergia']);
    const lista = r.get(a) ?? [];
    const id = numOuNull(x['id']);
    if (!lista.some((p) => p.nome === nome && p.id === id)) lista.push({ id, nome });
    r.set(a, lista);
  }
  return r;
}

/**
 * As alergias do paciente em todos os estabelecimentos do cliente (ativas e inativadas), na ordem em que foram
 * registradas; as datas no fuso do estabelecimento da sessão.
 * Nunca esconde uma alergia: a de descrição livre e a sem registro clínico entram (agenteId/registro nulos).
 */
export function alergias(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  paciente: number,
): Promise<AlergiaDoProntuarioCompleta[]> {
  return ler(nucleo, cliente, c, 'lista', async (l, est) => {
    const linhas = await l.consultar(
      `SELECT ap.id, ap.estabelecimento_id, ap.alergeno_id, ap.descricao_livre, ag.descricao AS agente_nome, ag.natureza,
              ta.descricao AS tipo_alergia, ap.tipo_registro, ap.observacao, ap.reacao, ap.gravidade, ap.certeza,
              ap.fonte_informacao, ap.ativa, ap.registro_assistencial_id, ap.registrado_em, ap.inativado_em,
              ap.motivo_inativacao, COALESCE(p.nome_exibicao, pf.nome) AS profissional
         FROM alergia_paciente ap
         LEFT JOIN alergeno ag ON ag.id = ap.alergeno_id
         LEFT JOIN tipo_alergia ta ON ta.id = ag.tipo_alergia_id
         LEFT JOIN profissional p ON p.id = ap.registrado_profissional_id
         LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE ap.paciente_id = ? AND ${SQL_E_ALERGIA}
        ORDER BY ap.id`,
      [paciente],
    );
    const princ = await principiosDe(
      l,
      linhas.map((x) => num(x['id'])),
      false,
    );
    return linhas.map((x): AlergiaDoProntuarioCompleta => {
      const id = num(x['id']);
      const livre = textoOuNull(x['descricao_livre']);
      const natureza = textoOuNull(x['natureza']);
      return {
        id,
        agenteId: numOuNull(x['alergeno_id']),
        agente: textoOuNull(x['agente_nome']) ?? livre ?? AGENTE_NAO_INFORMADO,
        tipo: textoOuNull(x['tipo_alergia']) ?? (natureza ? (TIPO_DA_NATUREZA[natureza] ?? null) : null),
        observacao: textoOuNull(x['observacao']),
        ativa: verdade(x['ativa']),
        registro: numOuNull(x['registro_assistencial_id']),
        registradaEm: dataHora(x['registrado_em'], est.fuso),
        profissional: textoOuNull(x['profissional']),
        principios: [...new Set((princ.get(id) ?? []).map((p) => p.nome))],
        descricaoLivre: livre,
        tipoRegistro: String(x['tipo_registro']) === 'intolerancia' ? 'intolerancia' : 'alergia',
        reacao: textoOuNull(x['reacao']),
        gravidade: textoOuNull(x['gravidade']),
        certeza: textoOuNull(x['certeza']),
        origemInformacao: textoOuNull(x['fonte_informacao']),
        inativadaEm: dataHora(x['inativado_em'], est.fuso),
        motivoInativacao: textoOuNull(x['motivo_inativacao']),
        estabelecimentoId: num(x['estabelecimento_id']),
      };
    });
  });
}

/**
 * O catálogo da tela de alergias: alérgenos ativos (com o tipo) e princípios ativos oficiais vigentes (id oficial, o
 * mesmo que a prescrição usa no item), por nome.
 */
export function catalogoAlergias(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
): Promise<CatalogoAlergiasLido> {
  return ler(nucleo, cliente, c, 'catalogo', async (l) => {
    const ags = await l.consultar(
      `SELECT ag.id, ag.descricao, ag.natureza, ta.descricao AS tipo_alergia
         FROM alergeno ag
         LEFT JOIN tipo_alergia ta ON ta.id = ag.tipo_alergia_id
        WHERE ag.ativo = TRUE
        ORDER BY ag.descricao, ag.id`,
      [],
    );
    const prs = await l.consultar(
      `SELECT pa.id, pa.descricao FROM principio_ativo pa
        WHERE pa.ativo = TRUE AND (pa.vigencia_fim IS NULL OR pa.vigencia_fim >= CURRENT_DATE)
        ORDER BY pa.descricao, pa.id`,
      [],
    );
    return {
      agentes: ags.map((x) => {
        const natureza = textoOuNull(x['natureza']);
        return {
          id: num(x['id']),
          nome: String(x['descricao']),
          tipo: textoOuNull(x['tipo_alergia']) ?? (natureza ? (TIPO_DA_NATUREZA[natureza] ?? null) : null),
        };
      }),
      principios: prs.map((x) => ({ id: num(x['id']), nome: String(x['descricao']) })),
    };
  });
}

/**
 * Os registros clínicos do atendimento em que a alergia pode ser informada: do autor com uma das inscrições no
 * conselho do profissional da sessão (`cbos` = ids de inscricao_conselho, como em ProfissionalPep), na ocupação da
 * inscrição, não suspensos nem corrigidos; o mais recente primeiro.
 */
export function registrosParaAlergia(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  atendimento: number,
  cbos: readonly number[],
): Promise<RegistroParaAlergia[]> {
  const ins = idsValidos(cbos);
  if (ins.length === 0) return Promise.resolve([]);
  return ler(nucleo, cliente, c, 'registros', async (l, est) => {
    const linhas = await l.consultar(
      `SELECT r.id, m.titulo, r.data_hora_clinica
         FROM registro_assistencial r
         JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
        WHERE r.atendimento_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL
          AND r.situacao IN ('finalizado','aguardando_coassinatura') AND r.suspenso_em IS NULL
          AND EXISTS (SELECT 1 FROM inscricao_conselho ic
                       WHERE ic.id IN (${marcadores(ins.length)}) AND ic.profissional_id = r.autor_profissional_id
                         AND ic.excluido_em IS NULL
                         AND (r.ocupacao_cbo_id IS NULL OR ic.ocupacao_cbo_id = r.ocupacao_cbo_id))
        ORDER BY r.data_hora_lancamento DESC, r.id DESC`,
      [atendimento, est.id, ...ins],
    );
    return linhas.map((x) => ({
      registro: num(x['id']),
      modelo: String(x['titulo']),
      dataHora: dataHora(x['data_hora_clinica'], est.fuso),
    }));
  });
}

/**
 * A versão da lista de alergias ativas do paciente (todos os estabelecimentos do cliente, o mesmo conjunto da lista):
 * os ids ativos em ordem, separados por vírgula.
 */
export function versaoAlergias(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  paciente: number,
): Promise<string> {
  return ler(nucleo, cliente, c, 'versao', async (l) => {
    const linhas = await l.consultar(
      `SELECT ap.id FROM alergia_paciente ap
        WHERE ap.paciente_id = ? AND ap.ativa = TRUE AND ${SQL_E_ALERGIA}
        ORDER BY ap.id`,
      [paciente],
    );
    return linhas.map((x) => num(x['id'])).join(',');
  });
}

/**
 * Prescrição: as alergias ATIVAS do paciente (todos os estabelecimentos do cliente), com os ids oficiais dos
 * princípios ativos que o motor casa com os itens. A alergia sem princípio conhecido entra com a lista vazia (aparece
 * no contexto; o motor não tem com o que casá-la).
 */
export function alergiasDaPrescricao(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  paciente: number,
): Promise<AlergiaLida[]> {
  return ler(nucleo, cliente, c, 'prescricao', async (l) => {
    const linhas = await l.consultar(
      `SELECT ap.id, COALESCE(ag.descricao, ap.descricao_livre) AS nome
         FROM alergia_paciente ap
         LEFT JOIN alergeno ag ON ag.id = ap.alergeno_id
        WHERE ap.paciente_id = ? AND ap.ativa = TRUE AND ${SQL_E_ALERGIA}
        ORDER BY ap.id`,
      [paciente],
    );
    const princ = await principiosDe(
      l,
      linhas.map((x) => num(x['id'])),
      true,
    );
    return linhas.map((x) => {
      const id = num(x['id']);
      const ids = (princ.get(id) ?? []).map((p) => p.id).filter((p): p is number => p !== null);
      return {
        alergia: id,
        nome: textoOuNull(x['nome']) ?? AGENTE_NAO_INFORMADO,
        principios: [...new Set(ids)],
      };
    });
  });
}
