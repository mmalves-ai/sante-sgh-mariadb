// Porta PRÓPRIA da CCIH (comissão de controle de infecção hospitalar; M48, etapa 3) sobre o MariaDB do cliente, pelo
// @sgh/nucleo. Lê as internações (internacao, paciente, pessoa_fisica e o leito: leito_hospitalar, acomodacao,
// bloco_internacao), as prescrições de antimicrobiano (prescricao, prescricao_item, item_prescritivel, insumo), a
// dispensação (dispensacao, dispensacao_item), as culturas (exame_item, requisicao_exame, exame), as cirurgias
// (ato_cirurgico), a temperatura (afericao, afericao_valor, parametro_vital), o censo fechado (fechamento_censo) e os
// profissionais. Grava, numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação), o
// dispositivo invasivo (dispositivo_invasivo_paciente e o evento), o checklist do bundle (verificacao_bundle e itens), a
// observação de higiene das mãos (observacao_higiene_maos e itens), o consumo de preparação alcoólica, o surto e o
// fechamento da competência da vigilância (fechamento_vigilancia_iras), com a linha travada (FOR UPDATE) e conferida
// pela versão vista.
// Melhoria: a internação (`reg`) é a do estabelecimento da sessão; o dispositivo grava o atendimento dela e o leito
// resolvido pela chave (bloco, acomodação e leito) no cadastro do estabelecimento.
// Melhoria: tipo de dispositivo, sítio de inserção, item do bundle e categoria profissional observada são os cadastros do
// cliente (o código do contrato em snake_case é o código do cadastro); o que não está cadastrado é recusado, nunca
// gravado solto.
// Melhoria: a versão anterior de cada correção, estorno, cancelamento, fechamento e reabertura vai à trilha_auditoria
// (dados.versaoAnterior, com o motivo), e `versoes` a lê de lá; o estorno é a exclusão lógica (excluido_em/excluido_por),
// e o registro estornado fica visível como inativo.
// Melhoria: o setor do consumo, da observação e do surto é o bloco de internação da unidade ligada ao setor funcional
// (o mesmo código do censo e do leito), e não um texto solto.
// Pendente (pedido em docs/obra/fatias/f24/saida/p-qualidade-ccih.json): a ficha de IRAS (caso_infeccao sem implante nem
// a cultura do caso), a decisão e as revisões D3/D7 do antimicrobiano (liberacao_antimicrobiano exige a ficha completa),
// a configuração do antimicrobiano por item do cadastro e a precaução (isolamento_paciente sem o motivo, a origem, a
// cultura e o multirresistente). Essas leituras falham fechadas (503 `modelo-pendente`) e essas gravações recusam com
// `modelo-pendente` (409), sem gravar nada pela metade.
import type { ChaveLeito, UnidadeNotificacao } from '@sgh/contratos';
import { type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  camelo,
  cobra,
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  json,
  type L,
  leituraPendente,
  lerNoEstabelecimento,
  type Linha,
  marcas,
  modeloPendente,
  n,
  nn,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  setoresDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';
import type { ContextoCcih, GravadorCcih, PortaCcih } from './porta-ccih.js';
import {
  type AcaoVersao,
  type AntimicrobianoPrescrito,
  type BundleRegistrado,
  type CompetenciaFechada,
  type CulturaDoPaciente,
  type DependentesRegistro,
  type DispositivoInvasivoRegistrado,
  type InternadoCcih,
  type ObservacaoMaosRegistrada,
  recusaVersaoCcih,
  type SurtoRegistrado,
  type TabelaCorrigivel,
  type VersaoRegistro,
} from './tipos.js';

/** As tabelas que a gravação da CCIH escreve (a transação recusa as outras). */
export const TABELAS_CCIH = [
  'dispositivo_invasivo_paciente',
  'dispositivo_invasivo_evento',
  'verificacao_bundle',
  'verificacao_bundle_item',
  'observacao_higiene_maos',
  'observacao_higiene_maos_item',
  'consumo_preparacao_alcoolica',
  'surto_infeccao',
  'fechamento_vigilancia_iras',
] as const;

const IRAS = 'A ficha de IRAS (infecção relacionada à assistência)';
const LIBERACAO = 'A liberação e as revisões D3/D7 do antimicrobiano';
const CONFIGURACAO = 'A configuração do antimicrobiano por item do cadastro';
const PRECAUCAO = 'A precaução (isolamento) e o bloqueio dos leitos vizinhos';

const TETO = 2000;
const TETO_PERIODO = 5000;
const DIA = 86_400_000;

const comSegundos = (t: string) => paraBanco(t.length === 16 ? `${t}:00` : t);
const diaSeguinte = (d: string) =>
  new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + DIA).toISOString().slice(0, 10);
const competenciaDe = (ano: unknown, mes: unknown) => `${n(ano)}-${String(n(mes)).padStart(2, '0')}`;

/** Motivo da retirada: contrato ↔ modelo. */
const RETIRADA_BANCO: Record<string, string> = {
  eletiva: 'fim_indicacao',
  acidental: 'retirada_acidental',
  troca: 'troca_programada',
  alta: 'alta',
  obito: 'obito',
};
const RETIRADA_CONTRATO: Record<string, string> = Object.fromEntries(
  Object.entries(RETIRADA_BANCO).map(([k, v]) => [v, k]),
);
/** Categoria do dispositivo pelo tipo (a coluna de classificação do modelo). */
const CATEGORIA_DISPOSITIVO: Record<string, string> = {
  cvc: 'cateter_central',
  sonda_vesical: 'sonda_vesical',
  ventilacao_mecanica: 'ventilacao_mecanica',
};
/** Momento da higiene das mãos: contrato ↔ modelo (os cinco momentos da OMS). */
const MOMENTO_BANCO: Record<string, string> = {
  antesContato: 'antes_contato_paciente',
  antesAsseptico: 'antes_procedimento_asseptico',
  aposFluidos: 'apos_risco_fluidos',
  aposContato: 'apos_contato_paciente',
  aposAmbiente: 'apos_contato_ambiente',
};
const MOMENTO_CONTRATO: Record<string, string> = Object.fromEntries(
  Object.entries(MOMENTO_BANCO).map(([k, v]) => [v, k]),
);

/** O bloco do leito (o "setor" do contrato), a acomodação e o leito, a partir de `lh` (leito_hospitalar). */
const JUNTAR_LEITO = `LEFT JOIN acomodacao ac ON ac.id = lh.acomodacao_id
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)`;
/** O setor (bloco de internação) da unidade ligada ao setor funcional `sf`. */
const SETOR_DO_SETOR_FUNCIONAL = (sf: string) => `(SELECT COALESCE(bx.codigo, '') FROM unidade_internacao ux
      LEFT JOIN bloco_internacao bx ON bx.id = ux.bloco_internacao_id
     WHERE ux.setor_funcional_id = ${sf} AND ux.excluido_em IS NULL ORDER BY ux.id LIMIT 1)`;

const SQL_INTERNADO = `
  SELECT i.id, p.numero_prontuario, i.paciente_id, COALESCE(p.nome_social, pf.nome) AS nome, i.atendimento_id,
         COALESCE(b.codigo, '') AS bloco, COALESCE(ac.codigo, '') AS acomodacao, COALESCE(lh.codigo, '') AS leito,
         i.data_hora_entrada, i.data_hora_alta
    FROM internacao i
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
    LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'`;

function internadoDe(r: Linha): InternadoCcih {
  return {
    reg: n(r['id']),
    pront: n(r['numero_prontuario']),
    paciente: nn(r['paciente_id']),
    nome: texto(r['nome']),
    atendimento: nn(r['atendimento_id']),
    bloco: texto(r['bloco']),
    acomodacao: texto(r['acomodacao']),
    leito: texto(r['leito']),
    entrada: dataIso(r['data_hora_entrada']) ?? '',
    aberta: r['data_hora_alta'] === null || r['data_hora_alta'] === undefined,
  };
}

const SQL_ANTIMICROBIANO = `
  SELECT i.id AS reg, pr.id AS prescricao, pi.id AS item_prescricao, ins.id AS item, ins.nome, pr.prescrito_em,
         pi.inicio_em, COALESCE(pi.fim_em, pr.vigencia_fim_em) AS fim,
         CASE WHEN pi.suspenso_em IS NULL THEN pr.suspensa_em WHEN pr.suspensa_em IS NULL THEN pi.suspenso_em
              ELSE LEAST(pi.suspenso_em, pr.suspensa_em) END AS suspenso
    FROM prescricao_item pi
    JOIN prescricao pr ON pr.id = pi.prescricao_id
    JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
    JOIN insumo ins ON ins.id = ip.insumo_id
    JOIN internacao i ON i.atendimento_id = pr.atendimento_id AND i.estabelecimento_id = pr.estabelecimento_id
                     AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
   WHERE pr.estabelecimento_id = ? AND ins.antimicrobiano = TRUE AND pr.situacao NOT IN ('rascunho', 'cancelada')
     AND pi.situacao <> 'cancelado' AND pr.excluido_em IS NULL AND pi.excluido_em IS NULL`;

/** Suspensão efetiva do item: a do item ou a da prescrição, a que vier primeiro. */
const SUSPENSO_SQL = `CASE WHEN pi.suspenso_em IS NULL THEN pr.suspensa_em WHEN pr.suspensa_em IS NULL THEN pi.suspenso_em
  ELSE LEAST(pi.suspenso_em, pr.suspensa_em) END`;
/**
 * Fim efetivo da vigência do antimicrobiano: o primeiro entre o fim (do item ou da prescrição) e a suspensão. Nulo quer
 * dizer tratamento em curso, que segue vigente (nunca some das listas da vigilância).
 */
const FIM_EFETIVO_SQL = `(CASE WHEN COALESCE(pi.fim_em, pr.vigencia_fim_em) IS NULL THEN ${SUSPENSO_SQL}
  WHEN (${SUSPENSO_SQL}) IS NULL THEN COALESCE(pi.fim_em, pr.vigencia_fim_em)
  ELSE LEAST(COALESCE(pi.fim_em, pr.vigencia_fim_em), ${SUSPENSO_SQL}) END)`;
/** Vigente a partir de um instante: em curso (sem fim) ou com fim efetivo nele ou depois. */
const VIGENTE_DESDE_SQL = `(${FIM_EFETIVO_SQL} IS NULL OR ${FIM_EFETIVO_SQL} >= ?)`;

function prescritoDe(r: Linha): AntimicrobianoPrescrito {
  return {
    reg: n(r['reg']),
    prescricao: n(r['prescricao']),
    itemPrescricao: n(r['item_prescricao']),
    item: n(r['item']),
    nome: texto(r['nome']),
    prescritoEm: instante(r['prescrito_em']),
    inicioVigencia: instante(r['inicio_em']),
    fimVigencia: instanteN(r['fim']),
    suspensoEm: instanteN(r['suspenso']),
  };
}

const SQL_CULTURA = `
  SELECT ei.id, i.id AS reg, ex.nome AS exame, DATE(COALESCE(ei.coletado_em, re.solicitado_em)) AS data, ei.liberado_em
    FROM exame_item ei
    JOIN requisicao_exame re ON re.id = ei.requisicao_exame_id
    JOIN exame ex ON ex.id = ei.exame_id
    JOIN internacao i ON i.atendimento_id = re.atendimento_id AND i.estabelecimento_id = re.estabelecimento_id
                     AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
   WHERE re.estabelecimento_id = ? AND ex.cultura = TRUE AND ei.situacao NOT IN ('cancelado', 'recusado')
     AND ei.excluido_em IS NULL AND re.excluido_em IS NULL`;

const culturaDe = (r: Linha): CulturaDoPaciente => ({
  id: n(r['id']),
  reg: n(r['reg']),
  exame: texto(r['exame']),
  data: dataIso(r['data']) ?? '',
  liberado: r['liberado_em'] !== null && r['liberado_em'] !== undefined,
});

const SQL_CIRURGIA = `
  SELECT a.id, i.id AS reg, DATE(COALESCE(a.inicio_cirurgia_em, a.entrada_sala_em, a.criado_em)) AS data
    FROM ato_cirurgico a
    JOIN internacao i ON i.atendimento_id = a.atendimento_id AND i.estabelecimento_id = a.estabelecimento_id
                     AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
   WHERE a.estabelecimento_id = ? AND a.situacao <> 'cancelado' AND a.excluido_em IS NULL`;

const SQL_DISPOSITIVO = `
  SELECT d.id, d.paciente_id, d.atendimento_id,
         (SELECT MAX(ix.id) FROM internacao ix WHERE ix.atendimento_id = d.atendimento_id AND ix.excluido_em IS NULL) AS reg,
         COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito, t.codigo AS tipo,
         la.descricao AS sitio, d.inserido_em, d.insercao_prescricao_item_id, d.observacao, d.retirado_em,
         d.motivo_retirada, d.cancelado_em, d.justificativa_cancelamento, d.versao, u.login AS registrado_por,
         d.inserido_por_profissional_id AS responsavel, COALESCE(pr.nome_exibicao, pfr.nome) AS responsavel_nome
    FROM dispositivo_invasivo_paciente d
    JOIN tipo_dispositivo_invasivo t ON t.id = d.tipo_dispositivo_invasivo_id
    LEFT JOIN local_acesso_invasivo la ON la.id = d.local_acesso_invasivo_id
    LEFT JOIN leito_hospitalar lh ON lh.id = d.leito_hospitalar_id
    ${JUNTAR_LEITO}
    LEFT JOIN usuario u ON u.id = d.criado_por
    LEFT JOIN profissional pr ON pr.id = d.inserido_por_profissional_id
    LEFT JOIN pessoa_fisica pfr ON pfr.id = pr.pessoa_fisica_id
   WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`;

function dispositivoDe(r: Linha): DispositivoInvasivoRegistrado {
  const motivo = textoN(r['motivo_retirada']);
  const resp = nn(r['responsavel']);
  return {
    id: n(r['id']),
    reg: n(r['reg']),
    paciente: nn(r['paciente_id']),
    setor: texto(r['bloco']),
    acomodacao: textoN(r['acomodacao']),
    leito: textoN(r['leito']),
    tipo: camelo(r['tipo']),
    sitio: textoN(r['sitio']),
    inseridoEm: instante(r['inserido_em']),
    itemPrescricao: nn(r['insercao_prescricao_item_id']),
    observacao: textoN(r['observacao']),
    retiradoEm: instanteN(r['retirado_em']),
    motivoRetirada: motivo === null ? null : (RETIRADA_CONTRATO[motivo] ?? camelo(motivo)),
    registradoPor: texto(r['registrado_por']),
    versao: n(r['versao']),
    canceladoEm: instanteN(r['cancelado_em']),
    motivoCancelamento: textoN(r['justificativa_cancelamento']),
    responsavel: resp === null ? null : { registro: resp, nome: texto(r['responsavel_nome']) },
  };
}

const SQL_MAOS = `
  SELECT o.id, o.setor_funcional_id, ${SETOR_DO_SETOR_FUNCIONAL('o.setor_funcional_id')} AS setor, o.inicio_em,
         o.observacao, o.versao, o.excluido_em, u.login AS registrado_por
    FROM observacao_higiene_maos o
    LEFT JOIN usuario u ON u.id = o.observador_usuario_id
   WHERE o.estabelecimento_id = ?`;

const SQL_SURTO = `
  SELECT s.id, s.titulo, s.tipo_surto_infeccao_id, s.agente_descricao, s.setor_funcional_id,
         ${SETOR_DO_SETOR_FUNCIONAL('s.setor_funcional_id')} AS setor, s.inicio_em, s.casos_quantidade,
         s.medidas_controle, s.situacao, s.encerrado_em, s.versao, u.login AS registrado_por
    FROM surto_infeccao s
    LEFT JOIN usuario u ON u.id = s.criado_por
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

const surtoDe = (r: Linha): SurtoRegistrado => ({
  id: n(r['id']),
  titulo: texto(r['titulo']),
  tipoSurto: nn(r['tipo_surto_infeccao_id']),
  agente: textoN(r['agente_descricao']),
  unidade: n(r['setor_funcional_id']),
  setor: textoN(r['setor']),
  inicio: dataIso(r['inicio_em']) ?? '',
  casos: n(r['casos_quantidade']),
  medidas: textoN(r['medidas_controle']),
  situacao: texto(r['situacao']),
  encerradoEm: dataIso(r['encerrado_em']),
  registradoPor: texto(r['registrado_por']),
  versao: n(r['versao']),
});

const SQL_BUNDLE = `
  SELECT vb.id, vb.dispositivo_invasivo_paciente_id, vb.data_referencia, vb.turno, vb.conforme, vb.indicacao_revisada,
         vb.observacao, vb.verificado_em, vb.versao, vb.excluido_em, u.login AS registrado_por, ue.login AS estornado_por
    FROM verificacao_bundle vb
    LEFT JOIN usuario u ON u.id = vb.verificador_usuario_id
    LEFT JOIN usuario ue ON ue.id = vb.excluido_por
   WHERE vb.estabelecimento_id = ?`;

const SQL_COMPETENCIA = `
  SELECT f.id, f.ano, f.mes, f.situacao, f.fechado_em, f.reaberto_em, f.motivo_reabertura, f.versao,
         uf.login AS fechada_por, ua.login AS alterado_por
    FROM fechamento_vigilancia_iras f
    LEFT JOIN usuario uf ON uf.id = f.fechado_por_usuario_id
    LEFT JOIN usuario ua ON ua.id = f.alterado_por
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao IN ('fechada', 'enviada', 'reaberta')`;

const competenciaFechadaDe = (r: Linha): CompetenciaFechada => {
  const reaberta = texto(r['situacao']) === 'reaberta';
  return {
    id: n(r['id']),
    area: 'ccih',
    competencia: competenciaDe(r['ano'], r['mes']),
    situacao: reaberta ? 'reaberta' : 'fechada',
    fechadaPor: texto(r['fechada_por']),
    fechadaEm: instante(r['fechado_em']),
    reabertaPor: reaberta ? textoN(r['alterado_por']) : null,
    reabertaEm: reaberta ? instanteN(r['reaberto_em']) : null,
    motivoReabertura: reaberta ? textoN(r['motivo_reabertura']) : null,
    versao: n(r['versao']),
  };
};

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

const filtroVersao = (campo: string) => `JSON_VALUE(t.dados_depois, '$.dados.versaoAnterior.${campo}')`;

/** Os motivos do estorno gravados na trilha (versão anterior com a ação `estorno`), por id. */
async function motivosDeEstorno(
  l: L,
  est: number,
  tabela: string,
  ids: readonly number[],
): Promise<Map<number, string>> {
  const r = new Map<number, string>();
  if (!ids.length) return r;
  const linhas = await l.consultar(
    `SELECT ${filtroVersao('id')} AS id, ${filtroVersao('motivo')} AS motivo FROM trilha_auditoria t
      WHERE t.estabelecimento_id = ? AND ${filtroVersao('tabela')} = ? AND ${filtroVersao('acao')} = 'estorno'
        AND ${filtroVersao('id')} IN (${marcas(ids.length)})
      ORDER BY t.id`,
    [est, tabela, ...ids.map(String)],
    { teto: TETO },
  );
  for (const x of linhas) r.set(n(x['id']), texto(x['motivo']));
  return r;
}

type Itens = Record<string, boolean>;

export class PortaCcihPropria implements PortaCcih {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoCcih, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  /** A CCIH grava direto, pela própria tela (a liberação é a da chave de permissão). */
  podeGravar() {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoCcih, op: string): Promise<GravacaoFeita> {
    return Promise.reject(recusa('operacao-desconhecida', `Operação ${op} sem receita do executor na CCIH.`));
  }

  gravarSgh<T>(
    c: ContextoCcih,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorCcih) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.ccih',
      tabelas: TABELAS_CCIH,
      trilha,
      gravador: (tx, est, anotacao) => this.gravador(tx, est, anotacao),
      fn,
    });
  }

  /** Trava a linha do estabelecimento e confere a versão vista e o estado (outra pessoa agiu nela: recusa). */
  private async travar(
    tx: TxOperacao,
    tabela: TabelaCorrigivel | 'surto_infeccao',
    est: number,
    id: number,
    versao: number,
    cabe: (r: Linha) => boolean = () => true,
  ): Promise<Linha> {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT * FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!r || n(r['versao']) !== versao || !cabe(r)) throw recusaVersaoCcih();
    return r;
  }

  private gravador(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorCcih {
    /** A versão anterior vai à trilha da operação (lida por `versoes`). */
    const versionar = (
      tabela: TabelaCorrigivel,
      r: Linha,
      acao: AcaoVersao,
      motivo: string,
      extra?: unknown,
    ) => {
      anotacao.motivo = motivo;
      anotacao.dados = {
        ...(anotacao.dados ?? {}),
        versaoAnterior: {
          tabela,
          id: n(r['id']),
          versao: n(r['versao']),
          acao,
          motivo,
          dados: { ...retrato(r), ...(extra === undefined ? {} : { itens: extra }) },
        },
      };
    };
    const internacao = async (reg: number, paciente: number | null) => {
      const i = await tx.uma<Linha>(
        `SELECT id, atendimento_id, paciente_id, leito_hospitalar_id FROM internacao
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
        [reg, est],
      );
      if (!i) throw recusa('internacao-inexistente', 'A internação não é deste estabelecimento.');
      if (paciente !== null && n(i['paciente_id']) !== paciente)
        throw recusa('internacao-de-outro-paciente', 'A internação informada é de outro paciente.');
      return i;
    };
    const leitoPelaChave = async (l: { bloco: string; acomodacao: string | null; leito: string | null }) => {
      if (l.acomodacao === null || l.leito === null) return null;
      const r = await tx.uma<Linha>(
        `SELECT lh.id FROM leito_hospitalar lh ${JUNTAR_LEITO}
          WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL AND COALESCE(b.codigo, '') = ? AND ac.codigo = ?
            AND lh.codigo = ?`,
        [est, l.bloco, l.acomodacao, l.leito],
      );
      if (!r) throw recusa('leito-inexistente', 'O leito informado não existe neste estabelecimento.');
      return n(r['id']);
    };
    const tipoDispositivo = async (tipo: string) => {
      const r = await tx.uma<Linha>(
        'SELECT id FROM tipo_dispositivo_invasivo WHERE codigo = ? AND ativo = TRUE',
        [cobra(tipo)],
      );
      if (!r)
        throw recusa(
          'tipo-dispositivo-nao-cadastrado',
          `O tipo de dispositivo "${tipo}" não está no cadastro do cliente.`,
        );
      return n(r['id']);
    };
    const sitio = async (s: string | null) => {
      if (s === null || !s.trim()) return null;
      const r = await tx.uma<Linha>(
        `SELECT id FROM local_acesso_invasivo
          WHERE ativo = TRUE AND (UPPER(codigo) = UPPER(?) OR UPPER(sigla) = UPPER(?) OR UPPER(descricao) = UPPER(?))
          ORDER BY id LIMIT 1`,
        [s.trim(), s.trim(), s.trim()],
      );
      if (!r)
        throw recusa('sitio-nao-cadastrado', `O sítio de inserção "${s}" não está no cadastro do cliente.`);
      return n(r['id']);
    };
    const profissional = async (id: number | null | undefined) => {
      if (id === null || id === undefined) return null;
      const r = await tx.uma<Linha>('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [id]);
      if (!r) throw recusa('profissional-inexistente', 'O profissional responsável não foi encontrado.');
      return id;
    };
    const itemPrescricao = async (id: number | null) => {
      if (id === null) return null;
      const r = await tx.uma<Linha>(
        `SELECT pi.id FROM prescricao_item pi JOIN prescricao pr ON pr.id = pi.prescricao_id
          WHERE pi.id = ? AND pr.estabelecimento_id = ? AND pi.excluido_em IS NULL`,
        [id, est],
      );
      if (!r)
        throw recusa('item-prescricao-inexistente', 'O item da prescrição não é deste estabelecimento.');
      return id;
    };
    const setorFuncional = async (id: number) => {
      const r = await tx.uma<Linha>(
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      if (!r) throw recusa('unidade-inexistente', 'A unidade informada não é deste estabelecimento.');
      return id;
    };
    const evento = (
      dispositivo: number,
      tipo: string,
      em: string,
      usuario: number,
      descricao: string | null,
      dados: unknown,
    ) =>
      tx.incluir('dispositivo_invasivo_evento', {
        dispositivo_invasivo_paciente_id: dispositivo,
        operacao: tipo === 'insercao' ? 'inclusao' : 'alteracao',
        tipo_evento: tipo,
        descricao,
        dados: JSON.stringify(dados ?? {}),
        ocorrido_em: em,
        usuario_id: usuario,
      });
    /** Os itens do bundle de prevenção vigente para o tipo do dispositivo (o checklist do turno). */
    const bundleDoDispositivo = async (dispositivo: number, data: string) => {
      const d = await tx.uma<Linha>(
        `SELECT tipo_dispositivo_invasivo_id FROM dispositivo_invasivo_paciente
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [dispositivo, est],
      );
      if (!d)
        throw recusa(
          'dispositivo-inexistente',
          'O dispositivo não é deste estabelecimento (ou foi cancelado).',
        );
      const b = await tx.uma<Linha>(
        `SELECT id FROM bundle_prevencao
          WHERE tipo_dispositivo_invasivo_id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo = TRUE
            AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          ORDER BY estabelecimento_id IS NULL, id LIMIT 1`,
        [d['tipo_dispositivo_invasivo_id'], est, data, data],
      );
      if (!b)
        throw recusa(
          'bundle-nao-configurado',
          'Não há bundle de prevenção vigente cadastrado para este tipo de dispositivo.',
        );
      const itens = await tx.consultar(
        'SELECT id, codigo FROM bundle_prevencao_item WHERE bundle_prevencao_id = ? AND ativo = TRUE ORDER BY ordem, id',
        [b['id']],
        { teto: 200 },
      );
      return { bundle: n(b['id']), itens: new Map(itens.map((x) => [texto(x['codigo']), n(x['id'])])) };
    };
    const itensDoBundle = (mapa: Map<string, number>, itens: Itens) =>
      Object.entries(itens).map(([k, v]) => {
        const id = mapa.get(cobra(k)) ?? mapa.get(k);
        if (id === undefined)
          throw recusa('item-bundle-nao-cadastrado', `O item "${k}" não está no bundle vigente.`);
        return { id, resultado: v ? 'cumprida' : 'nao_cumprida' };
      });
    /** Itens do checklist: atualiza os que mudaram, marca 'nao_se_aplica' o que saiu e inclui os novos. */
    const regravarItensBundle = async (
      vb: number,
      atuais: readonly Linha[],
      lista: readonly { id: number; resultado: string }[],
    ) => {
      const novos = new Map(lista.map((i) => [i.id, i.resultado]));
      let seq = atuais.reduce((m, r) => Math.max(m, n(r['sequencia'])), 0);
      for (const r of atuais) {
        const alvo = novos.get(n(r['bundle_prevencao_item_id'])) ?? 'nao_se_aplica';
        novos.delete(n(r['bundle_prevencao_item_id']));
        if (alvo !== texto(r['resultado']))
          await tx.alterar('verificacao_bundle_item', n(r['id']), n(r['versao']), { resultado: alvo });
      }
      for (const [item, resultado] of novos)
        await tx.incluir('verificacao_bundle_item', {
          verificacao_bundle_id: vb,
          sequencia: ++seq,
          bundle_prevencao_item_id: item,
          resultado,
        });
    };
    const itensBundle = (vb: number) =>
      tx.consultar(
        'SELECT * FROM verificacao_bundle_item WHERE verificacao_bundle_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [vb],
        { teto: 200 },
      );
    const categoria = async (codigo: string) => {
      const r = await tx.uma<Linha>(
        'SELECT id FROM categoria_profissional WHERE codigo = ? AND ativo = TRUE',
        [cobra(codigo)],
      );
      if (!r)
        throw recusa(
          'categoria-nao-cadastrada',
          `A categoria profissional "${codigo}" não está no cadastro do cliente.`,
        );
      return n(r['id']);
    };
    const incluirMaos = async (
      obs: number,
      cat: number,
      detalhe: readonly { momento: string; acao: string; luvas: boolean }[],
    ) => {
      for (const [i, d] of detalhe.entries()) {
        const momento = MOMENTO_BANCO[d.momento];
        if (!momento) throw recusa('momento-invalido', `Momento de higiene "${d.momento}" desconhecido.`);
        const acao = cobra(d.acao);
        await tx.incluir('observacao_higiene_maos_item', {
          observacao_higiene_maos_id: obs,
          sequencia: i + 1,
          momento,
          categoria_profissional_id: cat,
          acao,
          usou_luvas: d.luvas,
          conforme: acao !== 'nao_realizada',
        });
      }
    };
    const itensMaos = (obs: number) =>
      tx.consultar(
        'SELECT * FROM observacao_higiene_maos_item WHERE observacao_higiene_maos_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [obs],
        { teto: 500 },
      );
    /** Pacientes-dia do setor funcional na competência (o censo fechado das unidades ligadas a ele). */
    const pacientesDiaDoSetor = async (setor: number, competencia: string) => {
      const r = await tx.uma<Linha>(
        `SELECT COALESCE(SUM(fc.pacientes_dia), 0) AS pd, COUNT(*) AS dias FROM fechamento_censo fc
           JOIN unidade_internacao u ON u.id = fc.unidade_internacao_id
          WHERE fc.estabelecimento_id = ? AND u.setor_funcional_id = ? AND fc.situacao = 'fechado' AND fc.excluido_em IS NULL
            AND fc.data_referencia >= ? AND fc.data_referencia < DATE_ADD(?, INTERVAL 1 MONTH)`,
        [est, setor, competencia, competencia],
      );
      return { pacientesDia: n(r?.['pd']), dias: n(r?.['dias']) };
    };
    const pendente = (o: string) => () => Promise.reject(modeloPendente(o));

    return {
      registrarDispositivo: async (d) => {
        const usuario = await exigirUsuario(tx, d.usuario);
        const i = await internacao(d.reg, d.paciente);
        const tipo = await tipoDispositivo(d.tipo);
        const leito = (await leitoPelaChave(d.leito)) ?? nn(i['leito_hospitalar_id']);
        const inserido = comSegundos(d.inseridoEm);
        const resp = await profissional(d.responsavel?.registro);
        const id = await tx.incluir('dispositivo_invasivo_paciente', {
          estabelecimento_id: est,
          paciente_id: n(i['paciente_id']),
          atendimento_id: n(i['atendimento_id']),
          tipo_dispositivo_invasivo_id: tipo,
          local_acesso_invasivo_id: await sitio(d.sitio),
          categoria: CATEGORIA_DISPOSITIVO[cobra(d.tipo)] ?? null,
          leito_hospitalar_id: leito,
          insercao_prescricao_item_id: await itemPrescricao(d.itemPrescricao),
          inserido_em: inserido,
          inserido_por_profissional_id: resp,
          situacao: 'em_uso',
          observacao: d.observacao,
        });
        await evento(id, 'insercao', inserido, usuario, d.observacao, { tipo: d.tipo, sitio: d.sitio });
        return { id };
      },
      retirarDispositivo: async (r) => {
        const usuario = await exigirUsuario(tx, r.usuario);
        const x = await this.travar(
          tx,
          'dispositivo_invasivo_paciente',
          est,
          r.id,
          r.versao,
          (y) => texto(y['situacao']) === 'em_uso',
        );
        const motivo = RETIRADA_BANCO[r.motivo];
        if (!motivo) throw recusa('motivo-invalido', `Motivo de retirada "${r.motivo}" desconhecido.`);
        const em = comSegundos(r.retiradoEm);
        const versao = await tx.alterar('dispositivo_invasivo_paciente', r.id, n(x['versao']), {
          retirado_em: em,
          motivo_retirada: motivo,
          situacao: 'retirado',
        });
        await evento(r.id, 'retirada', em, usuario, r.observacao, { motivo: r.motivo });
        return { versao };
      },
      corrigirDispositivo: async (c) => {
        await exigirUsuario(tx, c.usuario);
        const x = await this.travar(
          tx,
          'dispositivo_invasivo_paciente',
          est,
          c.id,
          c.versao,
          (y) => texto(y['situacao']) !== 'cancelado',
        );
        versionar('dispositivo_invasivo_paciente', x, 'correcao', c.justificativa);
        const valores: Record<string, unknown> = {
          tipo_dispositivo_invasivo_id: await tipoDispositivo(c.tipo),
          categoria: CATEGORIA_DISPOSITIVO[cobra(c.tipo)] ?? null,
          local_acesso_invasivo_id: await sitio(c.sitio),
          inserido_em: comSegundos(c.inseridoEm),
        };
        // A retirada só se lança pela retirada (com o motivo e a situação); a correção só acerta a data de uma retirada
        // já lançada, e nunca para antes da inserção.
        const seg = (t: string) => (t.length === 16 ? `${t}:00` : t).slice(0, 19);
        if (texto(x['situacao']) === 'retirado') {
          const retirada = c.retiradoEm ? seg(c.retiradoEm) : seg(instante(x['retirado_em']));
          if (retirada < seg(c.inseridoEm))
            throw recusa('antes-da-insercao', 'A retirada não pode ser anterior à inserção do dispositivo.');
          if (c.retiradoEm) valores['retirado_em'] = comSegundos(c.retiradoEm);
        } else if (c.retiradoEm)
          throw recusa(
            'retirada-pela-correcao',
            'O dispositivo está em uso: a retirada se lança pela retirada, com o motivo, e não pela correção.',
          );
        if (c.responsavel !== undefined)
          valores['inserido_por_profissional_id'] = await profissional(c.responsavel?.registro);
        return { versao: await tx.alterar('dispositivo_invasivo_paciente', c.id, c.versao, valores) };
      },
      cancelarDispositivo: async (c) => {
        const usuario = await exigirUsuario(tx, c.usuario);
        const x = await this.travar(
          tx,
          'dispositivo_invasivo_paciente',
          est,
          c.id,
          c.versao,
          (y) => texto(y['situacao']) !== 'cancelado',
        );
        const dep = await tx.uma<Linha>(
          `SELECT COUNT(*) AS q FROM caso_infeccao WHERE dispositivo_invasivo_paciente_id = ? AND situacao = 'confirmado'
              AND excluido_em IS NULL`,
          [c.id],
        );
        if (n(dep?.['q']) > 0)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        versionar('dispositivo_invasivo_paciente', x, 'cancelamento', c.justificativa);
        const em = comSegundos(c.agora);
        const versao = await tx.alterar('dispositivo_invasivo_paciente', c.id, c.versao, {
          situacao: 'cancelado',
          cancelado_em: em,
          cancelado_por_usuario_id: usuario,
          justificativa_cancelamento: c.justificativa,
        });
        await evento(c.id, 'cancelamento', em, usuario, c.justificativa, null);
        return { versao };
      },
      registrarBundle: async (c) => {
        const usuario = await exigirUsuario(tx, c.usuario);
        const { bundle, itens } = await bundleDoDispositivo(c.dispositivo, c.data);
        const lista = itensDoBundle(itens, c.itens);
        const [ja] = await tx.consultarParaAtualizar(
          `SELECT * FROM verificacao_bundle
            WHERE dispositivo_invasivo_paciente_id = ? AND data_referencia = ? AND turno = ? AND estabelecimento_id = ?`,
          [c.dispositivo, c.data, c.turno, est],
          { teto: 1 },
        );
        if (ja && (ja['excluido_em'] === null || ja['excluido_em'] === undefined))
          throw recusa(
            'bundle-ja-registrado',
            'O checklist deste turno já foi registrado para o dispositivo: corrija o registrado pela versão.',
          );
        // A decisão de manter o dispositivo não vem do contrato (o item "indicacao" só diz que a indicação foi
        // revisada, e ele fica nos itens): a porta não grava decisão clínica que ninguém tomou.
        const valores = {
          bundle_prevencao_id: bundle,
          verificado_em: comSegundos(c.agora),
          verificador_usuario_id: usuario,
          conforme: c.conforme,
          indicacao_revisada: false,
          manter_dispositivo: null,
          observacao: c.observacao,
        };
        if (ja) {
          // O turno estornado é lançado de novo na mesma linha: ela volta a valer, e o lançamento estornado (com os
          // itens) vai à trilha como versão anterior.
          const id = n(ja['id']);
          const atuais = await itensBundle(id);
          versionar(
            'verificacao_bundle',
            ja,
            'correcao',
            'Novo lançamento do checklist do turno estornado',
            atuais.map(retrato),
          );
          await tx.alterar('verificacao_bundle', id, n(ja['versao']), {
            ...valores,
            excluido_em: null,
            excluido_por: null,
          });
          await regravarItensBundle(id, atuais, lista);
          return { id };
        }
        const id = await tx.incluir('verificacao_bundle', {
          estabelecimento_id: est,
          dispositivo_invasivo_paciente_id: c.dispositivo,
          data_referencia: c.data,
          turno: c.turno,
          ...valores,
        });
        await regravarItensBundle(id, [], lista);
        return { id };
      },
      corrigirBundle: async (c) => {
        await exigirUsuario(tx, c.usuario);
        const x = await this.travar(tx, 'verificacao_bundle', est, c.id, c.versao);
        const atuais = await itensBundle(c.id);
        versionar('verificacao_bundle', x, 'correcao', c.justificativa, atuais.map(retrato));
        const { itens } = await bundleDoDispositivo(
          n(x['dispositivo_invasivo_paciente_id']),
          dataIso(x['data_referencia']) ?? '',
        );
        await regravarItensBundle(c.id, atuais, itensDoBundle(itens, c.itens));
        return {
          versao: await tx.alterar('verificacao_bundle', c.id, c.versao, {
            conforme: c.conforme,
            observacao: c.observacao,
          }),
        };
      },
      estornarBundle: async (c) => {
        const usuario = await exigirUsuario(tx, c.usuario);
        const x = await this.travar(tx, 'verificacao_bundle', est, c.id, c.versao);
        versionar('verificacao_bundle', x, 'estorno', c.justificativa);
        return {
          versao: await tx.alterar('verificacao_bundle', c.id, c.versao, {
            excluido_em: comSegundos(c.agora),
            excluido_por: usuario,
          }),
        };
      },
      registrarObservacaoMaos: async (o) => {
        const usuario = await exigirUsuario(tx, o.usuario);
        const setor = await setorFuncional(o.unidade);
        const cat = await categoria(o.categoria);
        const id = await tx.incluir('observacao_higiene_maos', {
          estabelecimento_id: est,
          setor_funcional_id: setor,
          observador_usuario_id: usuario,
          inicio_em: comSegundos(o.observadoEm),
          observacao: o.observacao,
        });
        await incluirMaos(id, cat, o.detalhe);
        return { id };
      },
      corrigirObservacaoMaos: async (c) => {
        await exigirUsuario(tx, c.usuario);
        const x = await this.travar(tx, 'observacao_higiene_maos', est, c.id, c.versao);
        const atuais = await itensMaos(c.id);
        versionar('observacao_higiene_maos', x, 'correcao', c.justificativa, atuais.map(retrato));
        const cat = await categoria(c.categoria);
        for (const r of atuais) await tx.excluir('observacao_higiene_maos_item', n(r['id']), n(r['versao']));
        await incluirMaos(c.id, cat, c.detalhe);
        return {
          versao: await tx.alterar('observacao_higiene_maos', c.id, c.versao, {
            inicio_em: comSegundos(c.observadoEm),
            observacao: c.observacao,
          }),
        };
      },
      estornarObservacaoMaos: async (c) => {
        const usuario = await exigirUsuario(tx, c.usuario);
        const x = await this.travar(tx, 'observacao_higiene_maos', est, c.id, c.versao);
        versionar(
          'observacao_higiene_maos',
          x,
          'estorno',
          c.justificativa,
          (await itensMaos(c.id)).map(retrato),
        );
        return {
          versao: await tx.alterar('observacao_higiene_maos', c.id, c.versao, {
            excluido_em: comSegundos(c.agora),
            excluido_por: usuario,
          }),
        };
      },
      registrarConsumoAlcool: async (c) => {
        await exigirUsuario(tx, c.usuario);
        const setor = await setorFuncional(c.unidade);
        const competencia = `${c.competencia.slice(0, 7)}-01`;
        const censo = await pacientesDiaDoSetor(setor, competencia);
        // Sem censo fechado na competência não há denominador: a taxa fica nula e o cálculo diz por quê. A coluna
        // pacientes_dia ainda é NOT NULL no modelo (pedido de DDL para aceitar nulo em p-qualidade-ccih.json).
        const valores = {
          quantidade_ml: c.mililitros,
          pacientes_dia: censo.dias > 0 ? censo.pacientesDia : 0,
          ml_por_paciente_dia:
            censo.dias > 0 && censo.pacientesDia > 0
              ? Math.round((c.mililitros / censo.pacientesDia) * 10_000) / 10_000
              : null,
          calculo:
            censo.dias > 0
              ? `${c.mililitros} mL / ${censo.pacientesDia} pacientes-dia (censo fechado da competência: ${censo.dias} dia(s))`
              : `${c.mililitros} mL; sem denominador: nenhum dia do censo da competência fechado no setor`,
        };
        const [x] = await tx.consultarParaAtualizar(
          `SELECT * FROM consumo_preparacao_alcoolica
            WHERE estabelecimento_id = ? AND competencia = ? AND setor_funcional_id = ? AND excluido_em IS NULL`,
          [est, competencia, setor],
          { teto: 1 },
        );
        if (x) {
          // O novo lançamento substitui o da competência (contrato sem versão vista; pedido em p-qualidade-ccih.json),
          // com a linha travada e o valor anterior na trilha: nada se perde em silêncio.
          anotacao.motivo = 'Novo lançamento do consumo da competência substitui o anterior';
          anotacao.dados = {
            ...(anotacao.dados ?? {}),
            versaoAnterior: {
              tabela: 'consumo_preparacao_alcoolica',
              id: n(x['id']),
              versao: n(x['versao']),
              acao: 'correcao',
              motivo: anotacao.motivo,
              dados: retrato(x),
            },
          };
          await tx.alterar('consumo_preparacao_alcoolica', n(x['id']), n(x['versao']), valores);
          return { id: null, criado: false };
        }
        const id = await tx.incluir('consumo_preparacao_alcoolica', {
          estabelecimento_id: est,
          competencia,
          setor_funcional_id: setor,
          fonte: 'manual',
          ...valores,
        });
        return { id, criado: true };
      },
      registrarSurto: async (s) => {
        const usuario = await exigirUsuario(tx, s.usuario);
        const setor = await setorFuncional(s.unidade);
        if (s.tipoSurto !== null) {
          const t = await tx.uma<Linha>('SELECT id FROM tipo_surto_infeccao WHERE id = ? AND ativo = TRUE', [
            s.tipoSurto,
          ]);
          if (!t) throw recusa('tipo-surto-inexistente', 'O tipo de surto não está no cadastro do cliente.');
        }
        if (s.tipoSurto === null && (s.agente === null || !s.agente.trim()))
          throw recusa('surto-sem-agente', 'Informe o tipo do surto ou o agente suspeito.');
        const numero = await tx.proximoNumero('surto_infeccao');
        const id = await tx.incluir('surto_infeccao', {
          estabelecimento_id: est,
          numero: numero.formatado,
          titulo: s.titulo,
          tipo_surto_infeccao_id: s.tipoSurto,
          agente_descricao: s.agente,
          setor_funcional_id: setor,
          inicio_em: s.inicio.slice(0, 10),
          casos_quantidade: s.casos,
          medidas_controle: s.medidas,
          responsavel_usuario_id: usuario,
          situacao: 'investigacao',
        });
        return { id };
      },
      atualizarSurto: async (a) => {
        await exigirUsuario(tx, a.usuario);
        const x = await this.travar(
          tx,
          'surto_infeccao',
          est,
          a.id,
          a.versao,
          (y) => texto(y['situacao']) !== 'encerrado',
        );
        const encerrado = a.situacao === 'encerrado';
        return {
          versao: await tx.alterar('surto_infeccao', a.id, a.versao, {
            situacao: a.situacao,
            casos_quantidade: a.casos,
            medidas_controle: a.medidas,
            encerrado_em: encerrado ? (a.encerradoEm ?? a.agora).slice(0, 10) : null,
            resumo_encerramento: encerrado
              ? (a.medidas ?? textoN(x['medidas_controle']) ?? 'Surto encerrado pela CCIH.')
              : null,
          }),
        };
      },
      fecharCompetencia: async (c) => {
        const usuario = await exigirUsuario(tx, c.usuario);
        const [ano, mes] = c.competencia.split('-').map(Number);
        const em = comSegundos(c.agora);
        const [x] = await tx.consultarParaAtualizar(
          'SELECT * FROM fechamento_vigilancia_iras WHERE estabelecimento_id = ? AND ano = ? AND mes = ? AND excluido_em IS NULL',
          [est, ano, mes],
          { teto: 1 },
        );
        if (!x) {
          const id = await tx.incluir('fechamento_vigilancia_iras', {
            estabelecimento_id: est,
            ano,
            mes,
            situacao: 'fechada',
            responsavel_usuario_id: usuario,
            fechado_em: em,
            fechado_por_usuario_id: usuario,
          });
          return { id, versao: 1 };
        }
        if (['fechada', 'enviada'].includes(texto(x['situacao'])))
          throw recusa('competencia-fechada', 'A competência já está fechada.');
        versionar('fechamento_vigilancia_iras', x, 'fechamento', 'Fechamento depois da reabertura');
        const versao = await tx.alterar('fechamento_vigilancia_iras', n(x['id']), n(x['versao']), {
          situacao: 'fechada',
          fechado_em: em,
          fechado_por_usuario_id: usuario,
          reaberto_em: null,
          motivo_reabertura: null,
        });
        return { id: n(x['id']), versao };
      },
      reabrirCompetencia: async (c) => {
        await exigirUsuario(tx, c.usuario);
        const x = await this.travar(tx, 'fechamento_vigilancia_iras', est, c.id, c.versao, (y) =>
          ['fechada', 'enviada'].includes(texto(y['situacao'])),
        );
        versionar('fechamento_vigilancia_iras', x, 'reabertura', c.justificativa);
        return {
          versao: await tx.alterar('fechamento_vigilancia_iras', c.id, c.versao, {
            situacao: 'reaberta',
            reaberto_em: comSegundos(c.agora),
            motivo_reabertura: c.justificativa.slice(0, 500),
          }),
        };
      },
      // Pendentes de estrutura (pedido em saida/p-qualidade-ccih.json): recusam antes de gravar qualquer coisa.
      registrarIras: pendente(IRAS),
      descartarIras: pendente(IRAS),
      corrigirIras: pendente(IRAS),
      configurarAntimicrobiano: pendente(CONFIGURACAO),
      liberarAntimicrobiano: pendente(LIBERACAO),
      revisarAntimicrobiano: pendente(LIBERACAO),
      definirPrecaucao: pendente(PRECAUCAO),
      encerrarPrecaucao: pendente(PRECAUCAO),
      alterarPrecaucao: pendente(PRECAUCAO),
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoCcih) {
    return this.ler(c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  unidades(c: ContextoCcih): Promise<UnidadeNotificacao[]> {
    return this.ler(c, (l, est) => setoresDoEstabelecimento(l, est));
  }

  internados(c: ContextoCcih) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${SQL_INTERNADO} AND i.data_hora_alta IS NULL ORDER BY bloco, acomodacao, leito, i.id LIMIT ${TETO + 1}`,
        [est],
        {
          teto: TETO + 1,
        },
      );
      return { itens: r.slice(0, TETO).map(internadoDe), cortada: r.length > TETO };
    });
  }

  internacao(c: ContextoCcih, reg: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_INTERNADO} AND i.id = ?`, [est, reg]);
      return r ? internadoDe(r) : null;
    });
  }

  altasDas(c: ContextoCcih, regs: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(regs)];
      if (!u.length) return [];
      const r = await l.consultar(
        `SELECT id, data_hora_alta FROM internacao WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${marcas(u.length)})`,
        [est, ...u],
        { teto: u.length },
      );
      return r.map((x) => ({ reg: n(x['id']), alta: instanteN(x['data_hora_alta']) }));
    });
  }

  vizinhos(c: ContextoCcih, leito: ChaveLeito) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT COALESCE(b2.codigo, '') AS bloco, ac2.codigo AS acomodacao, v.codigo AS leito,
                EXISTS (SELECT 1 FROM internacao i WHERE i.leito_hospitalar_id = v.id AND i.estabelecimento_id = v.estabelecimento_id
                          AND i.data_hora_alta IS NULL AND i.situacao <> 'cancelada' AND i.excluido_em IS NULL) AS ocupado
           FROM leito_hospitalar lh ${JUNTAR_LEITO}
           JOIN leito_hospitalar v ON v.acomodacao_id = lh.acomodacao_id AND v.id <> lh.id AND v.ativo = TRUE AND v.excluido_em IS NULL
           JOIN acomodacao ac2 ON ac2.id = v.acomodacao_id
           LEFT JOIN bloco_internacao b2 ON b2.id = COALESCE(v.bloco_internacao_id, ac2.bloco_internacao_id)
          WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL AND COALESCE(b.codigo, '') = ? AND ac.codigo = ? AND lh.codigo = ?
          ORDER BY v.codigo, v.id`,
        [est, leito.bloco, leito.acomodacao, leito.leito],
        { teto: 200 },
      );
      return r.map((x) => ({
        bloco: texto(x['bloco']),
        acomodacao: texto(x['acomodacao']),
        leito: texto(x['leito']),
        ocupado: verdadeiro(x['ocupado']),
      }));
    });
  }

  antimicrobianos(c: ContextoCcih, regs: readonly number[], desde: string | null) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(regs)];
      if (!u.length) return { itens: [], cortada: false };
      const filtro = desde === null ? '' : ` AND ${VIGENTE_DESDE_SQL}`;
      const r = await l.consultar(
        `${SQL_ANTIMICROBIANO} AND i.id IN (${marcas(u.length)})${filtro} ORDER BY pi.inicio_em, pi.id LIMIT ${TETO + 1}`,
        [
          est,
          ...u,
          ...(desde === null ? [] : [comSegundos(desde.length === 10 ? `${desde}T00:00:00` : desde)]),
        ],
        { teto: TETO + 1 },
      );
      return { itens: r.slice(0, TETO).map(prescritoDe), cortada: r.length > TETO };
    });
  }

  antimicrobianoPrescrito(c: ContextoCcih, itemPrescricao: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_ANTIMICROBIANO} AND pi.id = ?`, [est, itemPrescricao]);
      return r ? prescritoDe(r) : null;
    });
  }

  vigencias(c: ContextoCcih, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${SQL_ANTIMICROBIANO} AND pi.inicio_em < ? AND ${VIGENTE_DESDE_SQL}
          ORDER BY pi.inicio_em, pi.id LIMIT ${TETO_PERIODO + 1}`,
        [est, diaSeguinte(ate), de.slice(0, 10)],
        { teto: TETO_PERIODO + 1 },
      );
      return { itens: r.slice(0, TETO_PERIODO).map(prescritoDe), cortada: r.length > TETO_PERIODO };
    });
  }

  consumoDispensado(c: ContextoCcih, ano: number, mes: number) {
    return this.ler(c, async (l, est) => {
      const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
      const r = await l.consultar(
        `SELECT ins.id, ins.nome, SUM(di.quantidade - di.quantidade_devolvida) AS unidades
           FROM dispensacao_item di
           JOIN dispensacao d ON d.id = di.dispensacao_id
           JOIN insumo ins ON ins.id = di.insumo_id
          WHERE d.estabelecimento_id = ? AND ins.antimicrobiano = TRUE AND d.situacao <> 'cancelada'
            AND di.situacao <> 'cancelado' AND d.excluido_em IS NULL AND di.excluido_em IS NULL
            AND d.dispensado_em >= ? AND d.dispensado_em < DATE_ADD(?, INTERVAL 1 MONTH)
          GROUP BY ins.id, ins.nome ORDER BY ins.nome, ins.id`,
        [est, inicio, inicio],
        { teto: TETO },
      );
      return r.map((x) => ({ item: n(x['id']), nome: texto(x['nome']), unidades: n(x['unidades']) }));
    });
  }

  itensAntimicrobianos(c: ContextoCcih) {
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        `SELECT id, nome FROM insumo WHERE antimicrobiano = TRUE AND situacao = 'ativo' AND excluido_em IS NULL
          ORDER BY nome, id`,
        [],
        { teto: TETO },
      );
      return r.map((x) => ({ item: n(x['id']), nome: texto(x['nome']) }));
    });
  }

  itemDoCadastro(c: ContextoCcih, item: number) {
    return this.ler(c, async (l) => {
      const r = await l.uma<Linha>(
        'SELECT id, nome, antimicrobiano FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      return r
        ? { item: n(r['id']), nome: texto(r['nome']), antimicrobiano: verdadeiro(r['antimicrobiano']) }
        : null;
    });
  }

  fichas(c: ContextoCcih, itensPrescricao: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const m = new Map<number, number>();
      const u = [...new Set(itensPrescricao)];
      if (!u.length) return m;
      const r = await l.consultar(
        `SELECT prescricao_item_id, MAX(id) AS id FROM ficha_antimicrobiano
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND prescricao_item_id IN (${marcas(u.length)})
          GROUP BY prescricao_item_id`,
        [est, ...u],
        { teto: u.length },
      );
      for (const x of r) m.set(n(x['prescricao_item_id']), n(x['id']));
      return m;
    });
  }

  culturas(c: ContextoCcih, regs: readonly number[], desde: string) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(regs)];
      if (!u.length) return [];
      const r = await l.consultar(
        `${SQL_CULTURA} AND i.id IN (${marcas(u.length)}) AND DATE(COALESCE(ei.coletado_em, re.solicitado_em)) >= ?
          ORDER BY data, ei.id`,
        [est, ...u, desde.slice(0, 10)],
        { teto: TETO_PERIODO },
      );
      return r.map(culturaDe);
    });
  }

  exame(c: ContextoCcih, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_CULTURA} AND ei.id = ?`, [est, id]);
      return r ? culturaDe(r) : null;
    });
  }

  cirurgias(c: ContextoCcih, regs: readonly number[], desde: string) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(regs)];
      if (!u.length) return [];
      const r = await l.consultar(
        `${SQL_CIRURGIA} AND i.id IN (${marcas(u.length)}) AND DATE(COALESCE(a.inicio_cirurgia_em, a.entrada_sala_em, a.criado_em)) >= ?
          ORDER BY data, a.id`,
        [est, ...u, desde.slice(0, 10)],
        { teto: TETO },
      );
      return r.map((x) => ({ id: n(x['id']), reg: n(x['reg']), data: dataIso(x['data']) ?? '' }));
    });
  }

  cirurgia(c: ContextoCcih, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_CIRURGIA} AND a.id = ?`, [est, id]);
      return r ? { id: n(r['id']), reg: n(r['reg']), data: dataIso(r['data']) ?? '' } : null;
    });
  }

  temperaturas(c: ContextoCcih, pacientes: readonly number[], desde: string) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(pacientes)];
      if (!u.length) return [];
      const r = await l.consultar(
        `SELECT a.paciente_id, v.valor_numerico, a.aferido_em
           FROM afericao a
           JOIN afericao_valor v ON v.afericao_id = a.id
           JOIN parametro_vital pv ON pv.id = v.parametro_vital_id AND pv.codigo = 'temperatura'
          WHERE a.estabelecimento_id = ? AND a.paciente_id IN (${marcas(u.length)}) AND a.aferido_em >= ?
            AND a.excluido_em IS NULL AND v.excluido_em IS NULL AND v.nao_aferido = FALSE AND v.valor_numerico IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM afericao_valor rv WHERE rv.retifica_afericao_valor_id = v.id AND rv.excluido_em IS NULL)
          ORDER BY a.aferido_em, v.id`,
        [est, ...u, comSegundos(desde.length === 10 ? `${desde}T00:00:00` : desde)],
        { teto: TETO_PERIODO },
      );
      return r.map((x) => ({
        paciente: n(x['paciente_id']),
        valor: n(x['valor_numerico']),
        em: instante(x['aferido_em']),
      }));
    });
  }

  censo(c: ContextoCcih, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const filtro = `fc.estabelecimento_id = ? AND fc.situacao = 'fechado' AND fc.excluido_em IS NULL
            AND fc.data_referencia BETWEEN ? AND ?`;
      const p = [est, de.slice(0, 10), ate.slice(0, 10)];
      const r = await l.consultar(
        `SELECT COALESCE(b.codigo, '') AS setor, SUM(COALESCE(fc.pacientes_dia, 0)) AS pd
           FROM fechamento_censo fc
           JOIN unidade_internacao u ON u.id = fc.unidade_internacao_id
           LEFT JOIN bloco_internacao b ON b.id = u.bloco_internacao_id
          WHERE ${filtro}
          GROUP BY setor ORDER BY setor`,
        p,
        { teto: 1000 },
      );
      const d = await l.uma<Linha>(
        `SELECT COUNT(DISTINCT fc.data_referencia) AS dias FROM fechamento_censo fc WHERE ${filtro}`,
        p,
      );
      return {
        porSetor: r.map((x) => ({ setor: texto(x['setor']), pacientesDia: n(x['pd']) })),
        diasFechados: n(d?.['dias']),
      };
    });
  }

  tiposSurto(c: ContextoCcih) {
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        'SELECT id, descricao FROM tipo_surto_infeccao WHERE ativo = TRUE ORDER BY descricao, id',
        [],
        {
          teto: 500,
        },
      );
      return r.map((x) => ({ codigo: n(x['id']), nome: texto(x['descricao']) }));
    });
  }

  dispositivo(c: ContextoCcih, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_DISPOSITIVO} AND d.id = ?`, [est, id]);
      return r ? dispositivoDe(r) : null;
    });
  }

  dispositivosDas(c: ContextoCcih, regs: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const u = [...new Set(regs)];
      if (!u.length) return [];
      const r = await l.consultar(
        `${SQL_DISPOSITIVO} AND d.atendimento_id IN (SELECT ix.atendimento_id FROM internacao ix
            WHERE ix.estabelecimento_id = ? AND ix.id IN (${marcas(u.length)}))
          ORDER BY d.inserido_em, d.id`,
        [est, est, ...u],
        { teto: TETO },
      );
      return r.map(dispositivoDe);
    });
  }

  dispositivosNoPeriodo(c: ContextoCcih, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${SQL_DISPOSITIVO} AND d.situacao <> 'cancelado' AND d.inserido_em < ? AND (d.retirado_em IS NULL OR d.retirado_em >= ?)
          ORDER BY d.inserido_em, d.id LIMIT ${TETO_PERIODO + 1}`,
        [est, diaSeguinte(ate), de.slice(0, 10)],
        { teto: TETO_PERIODO + 1 },
      );
      return { itens: r.slice(0, TETO_PERIODO).map(dispositivoDe), cortada: r.length > TETO_PERIODO };
    });
  }

  private async lerMaos(
    l: L,
    est: number,
    where: string,
    p: unknown[],
    teto: number,
  ): Promise<{ itens: ObservacaoMaosRegistrada[]; cortada: boolean }> {
    const r = await l.consultar(
      `${SQL_MAOS} ${where} ORDER BY o.inicio_em, o.id LIMIT ${teto + 1}`,
      [est, ...p],
      { teto: teto + 1 },
    );
    const linhas = r.slice(0, teto);
    const ids = linhas.map((x) => n(x['id']));
    const itens = ids.length
      ? await l.consultar(
          `SELECT i.observacao_higiene_maos_id AS obs, i.momento, i.acao, i.usou_luvas, i.conforme, cp.codigo AS categoria
             FROM observacao_higiene_maos_item i
             JOIN categoria_profissional cp ON cp.id = i.categoria_profissional_id
            WHERE i.excluido_em IS NULL AND i.observacao_higiene_maos_id IN (${marcas(ids.length)})
            ORDER BY i.observacao_higiene_maos_id, i.sequencia`,
          ids,
          { teto: TETO_PERIODO * 4 },
        )
      : [];
    const estornadas = linhas
      .filter((x) => x['excluido_em'] !== null && x['excluido_em'] !== undefined)
      .map((x) => n(x['id']));
    const motivos = await motivosDeEstorno(l, est, 'observacao_higiene_maos', estornadas);
    return {
      itens: linhas.map((x) => {
        const id = n(x['id']);
        const meus = itens.filter((i) => n(i['obs']) === id);
        return {
          id,
          unidade: n(x['setor_funcional_id']),
          setor: textoN(x['setor']),
          observadoEm: instante(x['inicio_em']),
          categoria: meus.length ? camelo(meus[0]?.['categoria']) : '',
          oportunidades: meus.length,
          conformes: meus.filter((i) => verdadeiro(i['conforme'])).length,
          detalhe: meus.map((i) => ({
            momento: MOMENTO_CONTRATO[texto(i['momento'])] ?? camelo(i['momento']),
            acao: camelo(i['acao']),
            luvas: verdadeiro(i['usou_luvas']),
          })),
          registradoPor: texto(x['registrado_por']),
          versao: n(x['versao']),
          observacao: textoN(x['observacao']),
          estornadoEm: instanteN(x['excluido_em']),
          motivoEstorno: motivos.get(id) ?? null,
        };
      }),
      cortada: r.length > teto,
    };
  }

  observacoesMaos(c: ContextoCcih, de: string, ate: string) {
    return this.ler(c, (l, est) =>
      this.lerMaos(
        l,
        est,
        'AND o.excluido_em IS NULL AND DATE(o.inicio_em) BETWEEN ? AND ?',
        [de.slice(0, 10), ate.slice(0, 10)],
        TETO_PERIODO,
      ),
    );
  }

  sessoesMaos(c: ContextoCcih, de: string, ate: string) {
    return this.ler(c, (l, est) =>
      this.lerMaos(
        l,
        est,
        'AND DATE(o.inicio_em) BETWEEN ? AND ?',
        [de.slice(0, 10), ate.slice(0, 10)],
        TETO_PERIODO,
      ),
    );
  }

  observacaoMaos(c: ContextoCcih, id: number) {
    return this.ler(
      c,
      async (l, est) => (await this.lerMaos(l, est, 'AND o.id = ?', [id], 1)).itens[0] ?? null,
    );
  }

  consumoAlcool(c: ContextoCcih, competencia: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT x.setor_funcional_id, ${SETOR_DO_SETOR_FUNCIONAL('x.setor_funcional_id')} AS setor, x.quantidade_ml
           FROM consumo_preparacao_alcoolica x
          WHERE x.estabelecimento_id = ? AND x.competencia = ? AND x.excluido_em IS NULL
          ORDER BY x.setor_funcional_id`,
        [est, `${competencia.slice(0, 7)}-01`],
        { teto: 1000 },
      );
      return r.map((x) => ({
        unidade: n(x['setor_funcional_id']),
        setor: textoN(x['setor']),
        mililitros: n(x['quantidade_ml']),
      }));
    });
  }

  surto(c: ContextoCcih, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_SURTO} AND s.id = ?`, [est, id]);
      return r ? surtoDe(r) : null;
    });
  }

  surtos(c: ContextoCcih, desde: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${SQL_SURTO} AND (s.situacao <> 'encerrado' OR s.inicio_em >= ?) ORDER BY s.inicio_em DESC, s.id DESC`,
        [est, desde.slice(0, 10)],
        { teto: TETO },
      );
      return r.map(surtoDe);
    });
  }

  versoes(c: ContextoCcih, tabela: TabelaCorrigivel, id: number) {
    return this.ler(c, async (l, est): Promise<VersaoRegistro[]> => {
      const r = await l.consultar(
        `SELECT t.ocorrido_em, u.login, JSON_EXTRACT(t.dados_depois, '$.dados.versaoAnterior') AS va
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND ${filtroVersao('tabela')} = ? AND ${filtroVersao('id')} = ?
          ORDER BY t.id DESC`,
        [est, tabela, String(id)],
        { teto: 500 },
      );
      return r.map((x) => {
        const va = json<{
          versao?: number;
          acao?: AcaoVersao;
          motivo?: string;
          dados?: Record<string, unknown>;
        }>(x['va'], {});
        return {
          versao: n(va.versao),
          acao: va.acao ?? 'correcao',
          motivo: texto(va.motivo),
          alteradoPor: texto(x['login']),
          alteradoEm: instante(x['ocorrido_em']),
          dados: va.dados ?? {},
        };
      });
    });
  }

  competencias(c: ContextoCcih, competencias?: readonly string[]) {
    return this.ler(c, async (l, est) => {
      const pares = (competencias ?? []).map((x) => x.split('-').map(Number));
      const filtro = pares.length
        ? ` AND (${pares.map(() => '(f.ano = ? AND f.mes = ?)').join(' OR ')})`
        : '';
      const r = await l.consultar(
        `${SQL_COMPETENCIA}${filtro} ORDER BY f.ano, f.mes`,
        [est, ...pares.flat()],
        { teto: 1000 },
      );
      return r.map(competenciaFechadaDe);
    });
  }

  dependentes(c: ContextoCcih, tabela: string, id: number) {
    return this.ler(c, async (l, est): Promise<DependentesRegistro[]> => {
      if (tabela !== 'dispositivo_invasivo_paciente') return [];
      const r = await l.consultar(
        `SELECT id FROM caso_infeccao WHERE estabelecimento_id = ? AND dispositivo_invasivo_paciente_id = ?
            AND situacao = 'confirmado' AND excluido_em IS NULL ORDER BY id LIMIT 51`,
        [est, id],
        { teto: 51 },
      );
      const q = await l.uma<Linha>(
        `SELECT COUNT(*) AS q FROM caso_infeccao WHERE estabelecimento_id = ? AND dispositivo_invasivo_paciente_id = ?
            AND situacao = 'confirmado' AND excluido_em IS NULL`,
        [est, id],
      );
      return r.length
        ? [
            {
              grupo: 'Fichas de IRAS confirmadas',
              dependente: 'caso_infeccao',
              quantidade: n(q?.['q']),
              ids: r.slice(0, 50).map((x) => n(x['id'])),
            },
          ]
        : [];
    });
  }

  private async lerBundles(l: L, est: number, where: string, p: unknown[]): Promise<BundleRegistrado[]> {
    const r = await l.consultar(
      `${SQL_BUNDLE} ${where} ORDER BY vb.verificado_em DESC, vb.id DESC`,
      [est, ...p],
      { teto: TETO },
    );
    const ids = r.map((x) => n(x['id']));
    const itens = ids.length
      ? await l.consultar(
          `SELECT i.verificacao_bundle_id AS vb, bi.codigo, i.resultado FROM verificacao_bundle_item i
             JOIN bundle_prevencao_item bi ON bi.id = i.bundle_prevencao_item_id
            WHERE i.excluido_em IS NULL AND i.verificacao_bundle_id IN (${marcas(ids.length)})`,
          ids,
          { teto: TETO * 30 },
        )
      : [];
    const estornados = r
      .filter((x) => x['excluido_em'] !== null && x['excluido_em'] !== undefined)
      .map((x) => n(x['id']));
    const motivos = await motivosDeEstorno(l, est, 'verificacao_bundle', estornados);
    return r.map((x) => {
      const id = n(x['id']);
      const marcados: Itens = {};
      for (const i of itens.filter((y) => n(y['vb']) === id))
        if (texto(i['resultado']) !== 'nao_se_aplica')
          marcados[camelo(i['codigo'])] = texto(i['resultado']) === 'cumprida';
      return {
        id,
        dispositivo: n(x['dispositivo_invasivo_paciente_id']),
        data: dataIso(x['data_referencia']) ?? '',
        turno: texto(x['turno']) as BundleRegistrado['turno'],
        itens: marcados,
        conforme: verdadeiro(x['conforme']),
        indicacaoRevisada: verdadeiro(x['indicacao_revisada']) || marcados['indicacao'] === true,
        observacao: textoN(x['observacao']),
        registradoPor: texto(x['registrado_por']),
        registradoEm: instante(x['verificado_em']),
        versao: n(x['versao']),
        estornadoEm: instanteN(x['excluido_em']),
        estornadoPor: textoN(x['estornado_por']),
        motivoEstorno: motivos.get(id) ?? null,
      };
    });
  }

  bundles(c: ContextoCcih, dispositivos: readonly number[]) {
    return this.ler(c, (l, est) => {
      const u = [...new Set(dispositivos)];
      if (!u.length) return Promise.resolve([]);
      return this.lerBundles(l, est, `AND vb.dispositivo_invasivo_paciente_id IN (${marcas(u.length)})`, u);
    });
  }

  bundle(c: ContextoCcih, id: number) {
    return this.ler(c, async (l, est) => (await this.lerBundles(l, est, 'AND vb.id = ?', [id]))[0] ?? null);
  }

  buscarProfissionais(c: ContextoCcih, termo: string) {
    return this.ler(c, async (l) => {
      const q = termo.trim().toUpperCase();
      if (q.length < 2) return [];
      const r = await l.consultar(
        `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome FROM profissional p
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.excluido_em IS NULL AND p.situacao = 'ativo'
            AND (UPPER(COALESCE(p.nome_exibicao, pf.nome)) LIKE ? OR UPPER(pf.nome) LIKE ? OR p.id = ?)
          ORDER BY nome, p.id LIMIT 30`,
        [`%${q}%`, `%${q}%`, /^\d+$/.test(q) ? Number(q) : 0],
        { teto: 30 },
      );
      return r.map((x) => ({ id: n(x['id']), cod: n(x['id']), nome: texto(x['nome']) }));
    });
  }

  profissionaisPorRegistro(c: ContextoCcih, ids: readonly number[]) {
    return this.ler(c, async (l) => {
      const u = [...new Set(ids)];
      if (!u.length) return [];
      const r = await l.consultar(
        `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome FROM profissional p
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.excluido_em IS NULL AND p.id IN (${marcas(u.length)})`,
        u,
        { teto: u.length },
      );
      return r.map((x) => ({ id: n(x['id']), cod: n(x['id']), nome: texto(x['nome']) }));
    });
  }

  // ── Leituras que aguardam a estrutura (pedido em saida/p-qualidade-ccih.json): falham fechadas, nunca vazio ──

  iras(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(IRAS));
  }

  irasDas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(IRAS));
  }

  irasNoPeriodo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(IRAS));
  }

  itensConfigurados(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(CONFIGURACAO));
  }

  liberacao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(LIBERACAO));
  }

  liberacoesDos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(LIBERACAO));
  }

  precaucao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(PRECAUCAO));
  }

  precaucoesAbertas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(PRECAUCAO));
  }

  precaucoesDa(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(PRECAUCAO));
  }
}
