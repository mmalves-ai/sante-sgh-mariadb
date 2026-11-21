// Porta própria da operadora (M56; F2.2 lote 02-10) sobre o banco do cliente pelo @sgh/nucleo.
//   - F0, catálogos da ANS (dado do cliente inteiro, catálogo público: sem filtro de estabelecimento): os grupos de
//     eventos do SIP (item_assistencial_ans), os procedimentos de cada grupo pelos critérios de procedimento
//     (item_assistencial_ans_criterio → termo_terminologia), paginados pela chave, e a classificação de procedimentos
//     (grupo_procedimento_operadora, só os códigos numéricos).
//   - F1, cadastro da operadora no estabelecimento da sessão: operadora_saude (pessoa_juridica, vínculo com o
//     estabelecimento e histórico), produto (produto_plano com o plano comercializado, a segmentação, a coparticipação
//     padrão, as carências e a tabela de preço por faixa etária), contrato (contrato_plano e contratante_plano),
//     beneficiário (beneficiario_plano sobre pessoa_fisica, movimento cadastral) e as vias da carteirinha
//     (cartao_beneficiario).
//   - Gravações pelo Executor (uma operação por gravação, as tabelas declaradas, trilha, outbox e idempotência na mesma
//     transação; trava otimista pela versão em cada linha alterada).
// Domínios do cliente usados pela gravação (carga do "criar cliente"; pedido do lote): grupo_prazo_carencia por tipo,
// faixa_etaria_modelo 'dez_faixas', segmentacao_assistencial, tipo_acomodacao_plano (código 1 a 3),
// classificacao_plano por tipo de contratação, grau_parentesco_dependente (código 2 a 8), sexo, motivos de exclusão
// (motivo_movimento_cadastral) e de nova via (motivo_solicitacao_cartao). Sem a linha, a recusa diz qual cadastro falta.
// Melhoria: o beneficiário é uma pessoa do cadastro único (pessoa_fisica, CPF único), não uma cópia do nome e documento.
// Melhoria: cada inclusão, alteração, baixa e reativação deixa o movimento cadastral (o que vai ao SIB) com a data de
// efeito; a baixa do titular leva os dependentes ativos, cada um com o seu movimento.
// Melhoria: a carteirinha emitida é um registro por via (número, via, validade, motivo), e a via anterior é cancelada.
// Melhoria: preços, carências e coparticipação do produto ficam nos cadastros próprios (tabela de preço por faixa,
// carência por grupo, regra de coparticipação), que o faturamento e a autorização usam.
// Melhoria: o beneficiário não sobrescreve o cadastro único: um CPF já cadastrado só é reaproveitado com o mesmo nome e
// nascimento ('cpf-de-outra-pessoa'), e a alteração do beneficiário não regrava a pessoa (dados pessoais diferentes
// dos gravados são recusados: mudam pelo cadastro de pessoas, com as regras e a trilha dele). O contratante idem.
// Melhoria: carteirinha e código do contratante numerados por cliente (a chave única vale para o cliente / a operadora,
// não para o estabelecimento): a mesma operadora em dois estabelecimentos não repete número.
// Melhoria: a regravação do produto só mexe no que mudou: a segmentação sai por exclusão lógica (com versão e trilha),
// e um preço novo encerra a tabela vigente e abre outra (o histórico de preços fica para o reajuste e as mensalidades
// já calculadas); nada é apagado.
// Melhoria: o produto guarda a operadora dona (produto_plano.operadora_saude_id) e a natureza (plano ou cartão de
// desconto). A linha antiga sem operadora é lida como da operadora principal do estabelecimento e passa a gravá-la na
// primeira alteração; a operadora dona não muda depois (os preços e a coparticipação são dela).
import { FAIXAS_ETARIAS_ANS } from '@sgh/contratos';
import {
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { camposPessoaisMudados, mesmaPessoa, nomeComparavel } from './aplicacao/identidade.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  dominioAusente,
  estabelecimentoDaSessao,
  inicioLike,
  instanteIso,
  inteiro,
  type MapaRestricoes,
  marcadores,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  traduzirRestricao,
  trechoLike,
} from './apoio-banco.js';
import {
  type Beneficiario,
  type CarenciasProduto,
  type ChaveSip,
  type ClassificacaoAns,
  type ContextoOperadora,
  type Contrato,
  type DadosBeneficiario,
  type DadosContrato,
  type DadosOperadora,
  type DadosProduto,
  type DominiosBeneficiario,
  type Elegibilidade,
  type FiltroBeneficiarios,
  type FiltroClassificacao,
  type FiltroContratos,
  type FiltroSip,
  type GravadorOperadora,
  type GrupoSip,
  LIMITE_PAGINA_OPERADORA,
  LIMITE_PAGINA_SIP,
  type Operadora,
  type PortaOperadora,
  type ProcedimentoSip,
  type Produto,
  type ViaCarteirinha,
} from './porta.js';
import {
  ABRANGENCIA,
  CARENCIAS,
  FORMA_REAJUSTE,
  MODALIDADE,
  SEGMENTACOES,
  SITUACAO_CONTRATO,
  SITUACAO_PRODUTO,
  TIPO_CONTRATACAO,
  TIPO_COPARTICIPACAO,
  TIPO_VIGENCIA,
} from './vocabulario-banco.js';

/** Tabelas que as gravações da F1 escrevem (a transação recusa as outras). */
export const TABELAS_OPERADORA = [
  'pessoa_juridica',
  'pessoa_fisica',
  'operadora_saude',
  'operadora_saude_estabelecimento',
  'operadora_saude_historico',
  'produto_plano',
  'plano_comercializado',
  'produto_plano_segmentacao',
  'regra_coparticipacao',
  'carencia_produto_contrato',
  'tabela_preco_plano',
  'tabela_preco_plano_faixa',
  'contratante_plano',
  'contrato_plano',
  'beneficiario_plano',
  'cartao_beneficiario',
  'movimento_cadastral_beneficiario',
  'sequencia_negocio',
] as const;

const RESTRICOES: MapaRestricoes = {
  uq_operadora_saude_registro_ans: [
    'registro-ans-em-uso',
    'Já existe operadora com este registro na ANS.',
    'registroAns',
  ],
  uq_produto_plano_codigo: [
    'codigo-em-uso',
    'Já existe produto com este código no estabelecimento.',
    'codigo',
  ],
  uq_plano_comercializado_codigo: [
    'codigo-em-uso',
    'Já existe plano com este código no estabelecimento.',
    'codigo',
  ],
  uq_produto_plano_registro: [
    'registro-ans-em-uso',
    'Já existe produto com este registro na ANS.',
    'registroAns',
  ],
  uq_contrato_plano_numero: [
    'numero-em-uso',
    'Já existe contrato com este número no estabelecimento.',
    'numero',
  ],
  uq_beneficiario_plano_matricula: [
    'carteirinha-em-uso',
    'O número de carteirinha gerado já existe: tente de novo.',
    'carteirinha',
  ],
  uq_beneficiario_plano_contrato_plano_id_pessoa_fisica_id__96881c: [
    'cpf-no-contrato',
    'Esta pessoa já é beneficiária deste contrato.',
    'cpf',
  ],
  uq_cartao_beneficiario_via: [
    'desatualizado',
    'Outra pessoa emitiu uma via desta carteirinha agora há pouco. Abra de novo.',
    'via',
  ],
  uq_contratante_plano_codigo: [
    'contratante-codigo-em-uso',
    'O código gerado para o contratante já existe: tente de novo.',
    'contratanteDocumento',
  ],
  uq_pessoa_fisica_cpf: ['cpf-em-uso', 'Este CPF já pertence a outra pessoa do cadastro.', 'cpf'],
  uq_pessoa_fisica_cns: ['cns-em-uso', 'Este CNS já pertence a outra pessoa do cadastro.', 'cns'],
  ck_beneficiario_plano_adesao: ['inclusao-invalida', 'A data de inclusão é inválida.', 'inclusao'],
  ck_contrato_plano_vigencia: [
    'fim-antes-do-inicio',
    'O fim do contrato não pode ser antes do início.',
    'fim',
  ],
};

const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
    { campos: ['versao'] },
  );
const naoEncontrado = (oque: string) =>
  recusa('nao-encontrado', `${oque} não está no estabelecimento da sessão.`);

const esquemaEntrada = z.record(z.string(), z.unknown());

/** Operadoras vinculadas ao estabelecimento (vigentes ou não: o histórico do vínculo fica). */
const SQL_OPERADORA_DO_ESTAB = `EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe
  WHERE oe.operadora_saude_id = o.id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)`;

const SELECT_OPERADORA = `
  SELECT o.id, o.registro_ans, pj.cnpj, pj.razao_social, pj.nome_fantasia, o.modalidade, o.ativo, o.versao,
         COALESCE(o.alterado_em, o.criado_em) AS alterado_em
    FROM operadora_saude o JOIN pessoa_juridica pj ON pj.id = o.pessoa_juridica_id
   WHERE o.excluido_em IS NULL AND ${SQL_OPERADORA_DO_ESTAB}`;

const operadoraDaLinha = (x: Linha): Operadora => ({
  id: Number(x['id']),
  registroAns: textoObrigatorio(x['registro_ans']),
  cnpj: textoObrigatorio(x['cnpj']),
  razaoSocial: textoObrigatorio(x['razao_social']),
  nomeFantasia: texto(x['nome_fantasia']),
  modalidade: MODALIDADE.codigo(x['modalidade']) ?? textoObrigatorio(x['modalidade']),
  situacao: booleano(x['ativo']) ? 'ativa' : 'inativa',
  versao: Number(x['versao']),
  alteradoEm: instanteIso(x['alterado_em']) ?? '',
});

/** A operadora principal do estabelecimento (vigente; a principal primeiro): dona dos produtos dele. */
const SQL_OPERADORA_PRINCIPAL = `(SELECT oe.operadora_saude_id FROM operadora_saude_estabelecimento oe
   WHERE oe.estabelecimento_id = ? AND oe.excluido_em IS NULL
   ORDER BY (oe.vigencia_fim IS NULL OR oe.vigencia_fim >= CURRENT_DATE) DESC, oe.principal DESC, oe.vigencia_inicio DESC,
            oe.id DESC LIMIT 1)`;

const SELECT_PRODUTO = `
  SELECT pr.id, COALESCE(pr.operadora_saude_id, ${SQL_OPERADORA_PRINCIPAL}) AS operadora, pr.natureza, pr.codigo, pr.nome, pr.numero_registro_ans, pr.tipo_contratacao,
         pr.abrangencia_geografica, ta.codigo AS acomodacao, pr.situacao_ans, pr.versao,
         COALESCE(pr.alterado_em, pr.criado_em) AS alterado_em, pc.id AS plano
    FROM produto_plano pr
    LEFT JOIN plano_comercializado pc ON pc.produto_plano_id = pr.id AND pc.estabelecimento_id = pr.estabelecimento_id
         AND pc.codigo = pr.codigo AND pc.excluido_em IS NULL
    LEFT JOIN tipo_acomodacao_plano ta ON ta.id = pr.tipo_acomodacao_plano_id
   WHERE pr.estabelecimento_id = ? AND pr.excluido_em IS NULL`;

const SELECT_CONTRATO = `
  SELECT cp.id, cp.operadora_saude_id, cp.produto_plano_id, pr.nome AS produto_nome, cp.numero, ct.tipo_pessoa,
         cl.tipo_contratacao, COALESCE(pf.nome, pj.razao_social) AS contratante_nome,
         COALESCE(pf.cpf, pj.cnpj) AS contratante_documento, cp.forma_reajuste, cp.mes_reajuste, cp.tipo_vigencia,
         cp.inicio_vigencia, cp.fim_vigencia, cp.dia_vencimento, cp.situacao, cp.motivo_situacao, cp.versao,
         COALESCE(cp.alterado_em, cp.criado_em) AS alterado_em,
         (SELECT COUNT(*) FROM beneficiario_plano b WHERE b.contrato_plano_id = cp.id AND b.excluido_em IS NULL
             AND b.situacao = 'ativo') AS ativos
    FROM contrato_plano cp
    JOIN contratante_plano ct ON ct.id = cp.contratante_plano_id
    LEFT JOIN pessoa_fisica pf ON pf.id = ct.pessoa_fisica_id
    LEFT JOIN pessoa_juridica pj ON pj.id = ct.pessoa_juridica_id
    JOIN classificacao_plano cl ON cl.id = cp.classificacao_plano_id
    LEFT JOIN produto_plano pr ON pr.id = cp.produto_plano_id
   WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL`;

const contratoDaLinha = (x: Linha): Contrato => ({
  id: Number(x['id']),
  operadora: Number(x['operadora_saude_id']),
  produto: inteiro(x['produto_plano_id']) ?? 0,
  produtoNome: textoObrigatorio(x['produto_nome']),
  numero: textoObrigatorio(x['numero']),
  tipo: textoObrigatorio(x['tipo_pessoa']) === 'fisica' ? 1 : 2,
  tipoContratacao: TIPO_CONTRATACAO.codigo(x['tipo_contratacao']) ?? 1,
  contratanteNome: textoObrigatorio(x['contratante_nome']),
  contratanteDocumento: textoObrigatorio(x['contratante_documento']),
  formaReajuste: FORMA_REAJUSTE.codigo(x['forma_reajuste']) ?? 0,
  mesReajuste: inteiro(x['mes_reajuste']) ?? 1,
  tipoVigencia: TIPO_VIGENCIA.codigo(x['tipo_vigencia']) ?? 2,
  inicio: dataIso(x['inicio_vigencia']) ?? '',
  fim: dataIso(x['fim_vigencia']),
  diaVencimento: inteiro(x['dia_vencimento']),
  situacao: SITUACAO_CONTRATO.codigo(x['situacao']) ?? 'ativo',
  motivoSituacao: texto(x['motivo_situacao']),
  beneficiariosAtivos: inteiro(x['ativos']) ?? 0,
  versao: Number(x['versao']),
  alteradoEm: instanteIso(x['alterado_em']) ?? '',
});

const SELECT_BENEFICIARIO = `
  SELECT b.id, cp.operadora_saude_id, b.contrato_plano_id, cp.numero AS contrato_numero, pr.nome AS produto_nome,
         b.titular_beneficiario_plano_id, b.tipo, gp.codigo AS vinculo, pf.nome, pf.nome_social, pf.cpf,
         pf.data_nascimento, sx.sigla AS sexo, pf.cns, pf.nome_mae, b.data_adesao, b.paciente_id, b.matricula,
         b.via_cartao, b.situacao, b.data_exclusao, b.motivo_movimento_cadastral_id, b.versao,
         COALESCE(b.alterado_em, b.criado_em) AS alterado_em
    FROM beneficiario_plano b
    JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
    JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN grau_parentesco_dependente gp ON gp.id = b.grau_parentesco_dependente_id
    LEFT JOIN plano_comercializado pc ON pc.id = b.plano_comercializado_id
    LEFT JOIN produto_plano pr ON pr.id = pc.produto_plano_id
   WHERE cp.estabelecimento_id = ? AND b.excluido_em IS NULL AND cp.excluido_em IS NULL`;

const beneficiarioDaLinha = (x: Linha): Beneficiario => {
  const situacao = textoObrigatorio(x['situacao']);
  return {
    id: Number(x['id']),
    operadora: Number(x['operadora_saude_id']),
    contrato: Number(x['contrato_plano_id']),
    contratoNumero: textoObrigatorio(x['contrato_numero']),
    produtoNome: textoObrigatorio(x['produto_nome']),
    titular: inteiro(x['titular_beneficiario_plano_id']),
    vinculo: textoObrigatorio(x['tipo']) === 'titular' ? 1 : (inteiro(texto(x['vinculo'])) ?? 8),
    nome: textoObrigatorio(x['nome']),
    nomeSocial: texto(x['nome_social']),
    cpf: texto(x['cpf']),
    nascimento: dataIso(x['data_nascimento']) ?? '',
    sexo: texto(x['sexo']) ?? 'I',
    cns: texto(x['cns']),
    nomeMae: textoObrigatorio(x['nome_mae']),
    inclusao: dataIso(x['data_adesao']) ?? '',
    pacienteHospital: inteiro(x['paciente_id']),
    carteirinha: textoObrigatorio(x['matricula']),
    via: inteiro(x['via_cartao']) ?? 1,
    situacao: situacao === 'excluido' || situacao === 'suspenso' ? situacao : 'ativo',
    exclusao: dataIso(x['data_exclusao']),
    motivoBaixa: inteiro(x['motivo_movimento_cadastral_id']),
    versao: Number(x['versao']),
    alteradoEm: instanteIso(x['alterado_em']) ?? '',
  };
};

/** Segmentação pelos indicadores do catálogo da ANS (a primeira que casa). */
function segmentacaoDosIndicadores(x: Linha): string | null {
  const v = {
    amb: booleano(x['inclui_ambulatorial']),
    hosp: booleano(x['inclui_hospitalar']),
    obst: booleano(x['inclui_obstetricia']),
    odonto: booleano(x['inclui_odontologia']),
    referencia: booleano(x['plano_referencia']),
  };
  for (const [k, s] of Object.entries(SEGMENTACOES))
    if (
      s.amb === v.amb &&
      s.hosp === v.hosp &&
      s.obst === v.obst &&
      s.odonto === v.odonto &&
      s.referencia === v.referencia
    )
      return k;
  return null;
}

/** Os satélites do produto (segmentação, coparticipação padrão, carências e preços) para os ids da página. */
async function produtosCompletos(l: Leitor, linhas: readonly Linha[]): Promise<Produto[]> {
  if (linhas.length === 0) return [];
  const ids = linhas.map((x) => Number(x['id']));
  const planos = linhas.map((x) => inteiro(x['plano'])).filter((v): v is number => v !== null);
  const seg = await l.consultar(
    `SELECT ps.produto_plano_id, sa.inclui_ambulatorial, sa.inclui_hospitalar, sa.inclui_obstetricia, sa.inclui_odontologia,
            sa.plano_referencia
       FROM produto_plano_segmentacao ps JOIN segmentacao_assistencial sa ON sa.id = ps.segmentacao_assistencial_id
      WHERE ps.produto_plano_id IN (${marcadores(ids.length)}) AND ps.excluido_em IS NULL ORDER BY ps.id`,
    ids,
    { teto: ids.length * 10 },
  );
  const copart = planos.length
    ? await l.consultar(
        `SELECT plano_comercializado_id, tipo_coparticipacao, percentual, valor FROM regra_coparticipacao
          WHERE plano_comercializado_id IN (${marcadores(planos.length)}) AND contrato_plano_id IS NULL
            AND grupo_procedimento_operadora_id IS NULL AND item_faturavel_id IS NULL AND ativo = TRUE
          ORDER BY vigencia_inicio DESC, id DESC`,
        planos,
        { teto: planos.length * 20 },
      )
    : [];
  const caren = await l.consultar(
    `SELECT c.produto_plano_id, g.tipo_carencia, c.dias_carencia FROM carencia_produto_contrato c
       JOIN grupo_prazo_carencia g ON g.id = c.grupo_prazo_carencia_id
      WHERE c.produto_plano_id IN (${marcadores(ids.length)}) AND c.contrato_plano_id IS NULL AND c.ativo = TRUE
      ORDER BY c.vigencia_inicio DESC, c.id DESC`,
    ids,
    { teto: ids.length * 40 },
  );
  const precos = await l.consultar(
    `SELECT f.produto_plano_id, f.sequencia, f.valor_mensalidade FROM tabela_preco_plano_faixa f
       JOIN tabela_preco_plano t ON t.id = f.tabela_preco_plano_id
      WHERE f.produto_plano_id IN (${marcadores(ids.length)}) AND t.situacao = 'vigente' AND t.excluido_em IS NULL
        AND t.exclusiva_contrato_plano_id IS NULL AND f.excluido_em IS NULL
      ORDER BY f.produto_plano_id, f.sequencia`,
    ids,
    { teto: ids.length * 20 },
  );
  return linhas.map((x) => {
    const id = Number(x['id']);
    const plano = inteiro(x['plano']);
    const s = seg.find((r) => Number(r['produto_plano_id']) === id);
    const cp =
      plano === null ? undefined : copart.find((r) => Number(r['plano_comercializado_id']) === plano);
    const carencias: CarenciasProduto = { urgencia: 0, partos: 0, demais: 0, cpt: 0 };
    for (const [k, tipo] of Object.entries(CARENCIAS) as [keyof CarenciasProduto, string][]) {
      const r = caren.find((c) => Number(c['produto_plano_id']) === id && texto(c['tipo_carencia']) === tipo);
      carencias[k] = inteiro(r?.['dias_carencia']) ?? 0;
    }
    const faixas = precos.filter((p) => Number(p['produto_plano_id']) === id);
    const tipoCopart = TIPO_COPARTICIPACAO.codigo(cp?.['tipo_coparticipacao']) ?? 1;
    return {
      id,
      operadora: inteiro(x['operadora']) ?? 0,
      codigo: textoObrigatorio(x['codigo']),
      nome: textoObrigatorio(x['nome']),
      natureza: texto(x['natureza']) === 'cartao_desconto' ? 'cartaoDesconto' : 'plano',
      registroAns: texto(x['numero_registro_ans']),
      tipoContratacao: TIPO_CONTRATACAO.codigo(x['tipo_contratacao']) ?? 1,
      segmentacao: s ? segmentacaoDosIndicadores(s) : null,
      abrangencia: ABRANGENCIA.codigo(x['abrangencia_geografica']),
      acomodacao: inteiro(texto(x['acomodacao'])),
      coparticipacao: {
        tipo: tipoCopart,
        valor:
          tipoCopart === 2 ? numero(cp?.['percentual']) : tipoCopart === 3 ? numero(cp?.['valor']) : null,
      },
      carencias,
      precos:
        faixas.length === FAIXAS_ETARIAS_ANS.length
          ? faixas.map((f) => numero(f['valor_mensalidade']) ?? 0)
          : null,
      situacao: SITUACAO_PRODUTO.codigo(x['situacao_ans']) ?? 'ativo',
      versao: Number(x['versao']),
      alteradoEm: instanteIso(x['alterado_em']) ?? '',
    };
  });
}

export class PortaOperadoraPropria implements PortaOperadora {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private lerCatalogo<T>(c: ContextoOperadora, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'operadora' }, fn);
  }

  /** Leitura no estabelecimento da sessão (sem ele no banco: o vazio, nunca outro estabelecimento). */
  private ler<T>(c: ContextoOperadora, fn: (l: Leitor, est: number) => Promise<T>, vazio: T): Promise<T> {
    return this.lerCatalogo(c, async (l) => {
      const est = await estabelecimentoDaSessao(c, l);
      return est === null ? vazio : fn(l, est);
    });
  }

  // ---- F0: catálogos da ANS (catálogo público do cliente inteiro) ----

  gruposSip(c: ContextoOperadora): Promise<GrupoSip[]> {
    return this.lerCatalogo(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM item_assistencial_ans ORDER BY id', [], { teto: 1_000 })
      ).map((x) => ({ id: Number(x['id']), nome: textoObrigatorio(x['descricao']) })),
    );
  }

  procedimentosSip(
    c: ContextoOperadora,
    f: FiltroSip,
  ): Promise<{ itens: ProcedimentoSip[]; proxima: ChaveSip | null }> {
    return this.lerCatalogo(c, async (l) => {
      const limite = LIMITE_PAGINA_SIP;
      const onde = [
        "cr.tipo_criterio = 'procedimento'",
        'cr.excluido_em IS NULL',
        'cr.excludente = FALSE',
        "t.codigo_termo REGEXP '^[0-9]{1,15}$'",
      ];
      const ps: unknown[] = [];
      if (f.grupo !== undefined) {
        onde.push('i.id = ?');
        ps.push(f.grupo);
      }
      if (f.procedimento !== undefined) {
        onde.push('CAST(t.codigo_termo AS UNSIGNED) = ?');
        ps.push(f.procedimento);
      }
      if (f.vigentesEm !== undefined) {
        onde.push('i.vigencia_inicio <= ? AND (i.vigencia_fim IS NULL OR i.vigencia_fim >= ?)');
        ps.push(f.vigentesEm, f.vigentesEm);
      }
      if (f.apos) {
        onde.push(
          '(CAST(t.codigo_termo AS UNSIGNED) > ? OR (CAST(t.codigo_termo AS UNSIGNED) = ? AND (i.id > ? OR (i.id = ? AND i.vigencia_inicio > ?))))',
        );
        ps.push(f.apos.procedimento, f.apos.procedimento, f.apos.grupo, f.apos.grupo, f.apos.vigenciaInicial);
      }
      const r = await l.consultar(
        `SELECT CAST(t.codigo_termo AS UNSIGNED) AS procedimento, t.descricao, i.id AS grupo, i.vigencia_inicio,
                i.vigencia_fim
           FROM item_assistencial_ans_criterio cr
           JOIN item_assistencial_ans i ON i.id = cr.item_assistencial_ans_id
           JOIN termo_terminologia t ON t.id = cr.procedimento_termo_terminologia_id
          WHERE ${onde.join(' AND ')}
          ORDER BY CAST(t.codigo_termo AS UNSIGNED), i.id, i.vigencia_inicio LIMIT ${limite + 1}`,
        ps,
        { teto: limite + 1 },
      );
      const itens = r.slice(0, limite).map((x) => ({
        procedimento: Number(x['procedimento']),
        nome: texto(x['descricao']),
        grupo: Number(x['grupo']),
        vigenciaInicial: dataIso(x['vigencia_inicio']),
        vigenciaFinal: dataIso(x['vigencia_fim']),
      }));
      const u = itens[itens.length - 1];
      return {
        itens,
        proxima:
          r.length > limite && u?.vigenciaInicial
            ? { procedimento: u.procedimento, grupo: u.grupo, vigenciaInicial: u.vigenciaInicial }
            : null,
      };
    });
  }

  classificacoesAns(
    c: ContextoOperadora,
    f: FiltroClassificacao,
  ): Promise<{ itens: ClassificacaoAns[]; proxima: number | null }> {
    return this.lerCatalogo(c, async (l) => {
      const limite = LIMITE_PAGINA_SIP;
      const onde = ['ativo = TRUE', "codigo REGEXP '^[0-9]{1,9}$'"];
      const ps: unknown[] = [];
      const busca = f.busca?.trim();
      if (busca) {
        if (/^\d{1,9}$/.test(busca)) {
          onde.push('CAST(codigo AS UNSIGNED) = ?');
          ps.push(Number(busca));
        } else {
          onde.push("descricao LIKE ? ESCAPE '\\\\'");
          ps.push(trechoLike(busca.slice(0, 60)));
        }
      }
      if (f.apos !== undefined) {
        onde.push('CAST(codigo AS UNSIGNED) > ?');
        ps.push(f.apos);
      }
      const r = await l.consultar(
        `SELECT CAST(codigo AS UNSIGNED) AS codigo, descricao FROM grupo_procedimento_operadora
          WHERE ${onde.join(' AND ')} ORDER BY CAST(codigo AS UNSIGNED) LIMIT ${limite + 1}`,
        ps,
        { teto: limite + 1 },
      );
      const itens = r
        .slice(0, limite)
        .map((x) => ({ codigo: Number(x['codigo']), nome: textoObrigatorio(x['descricao']) }));
      return { itens, proxima: r.length > limite ? (itens[itens.length - 1]?.codigo ?? null) : null };
    });
  }

  // ---- F1: leituras no estabelecimento da sessão ----

  operadoras(c: ContextoOperadora): Promise<Operadora[]> {
    return this.ler(
      c,
      async (l, est) =>
        (
          await l.consultar(
            `${SELECT_OPERADORA} ORDER BY o.nome, o.id LIMIT ${LIMITE_PAGINA_OPERADORA}`,
            [est],
            {
              teto: LIMITE_PAGINA_OPERADORA,
            },
          )
        ).map(operadoraDaLinha),
      [],
    );
  }

  operadora(c: ContextoOperadora, id: number): Promise<Operadora | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_OPERADORA} AND o.id = ?`, [est, id]);
        return x ? operadoraDaLinha(x) : null;
      },
      null,
    );
  }

  produtos(c: ContextoOperadora, operadora?: number): Promise<Produto[]> {
    return this.ler(
      c,
      async (l, est) => {
        const linhas = await l.consultar(
          `${SELECT_PRODUTO} ORDER BY pr.nome, pr.id LIMIT ${LIMITE_PAGINA_OPERADORA}`,
          [est, est],
          {
            teto: LIMITE_PAGINA_OPERADORA,
          },
        );
        const todos = await produtosCompletos(l, linhas);
        return operadora === undefined ? todos : todos.filter((p) => p.operadora === operadora);
      },
      [],
    );
  }

  produto(c: ContextoOperadora, id: number): Promise<Produto | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_PRODUTO} AND pr.id = ?`, [est, est, id]);
        return x ? ((await produtosCompletos(l, [x]))[0] ?? null) : null;
      },
      null,
    );
  }

  contratos(
    c: ContextoOperadora,
    f: FiltroContratos,
  ): Promise<{ itens: Contrato[]; proxima: number | null }> {
    return this.ler(
      c,
      async (l, est) => {
        const onde = ['cp.operadora_saude_id = ?'];
        const ps: unknown[] = [est, f.operadora];
        if (f.produto !== undefined) {
          onde.push('cp.produto_plano_id = ?');
          ps.push(f.produto);
        }
        if (f.numero) {
          onde.push("cp.numero LIKE ? ESCAPE '\\\\'");
          ps.push(inicioLike(f.numero));
        }
        if (f.nome) {
          onde.push("COALESCE(pf.nome, pj.razao_social) LIKE ? ESCAPE '\\\\'");
          ps.push(inicioLike(f.nome));
        }
        if (f.apos !== undefined) {
          onde.push('cp.id > ?');
          ps.push(f.apos);
        }
        const r = await l.consultar(
          `${SELECT_CONTRATO} AND ${onde.join(' AND ')} ORDER BY cp.id LIMIT ${LIMITE_PAGINA_OPERADORA + 1}`,
          ps,
          { teto: LIMITE_PAGINA_OPERADORA + 1 },
        );
        const itens = r.slice(0, LIMITE_PAGINA_OPERADORA).map(contratoDaLinha);
        return {
          itens,
          proxima: r.length > LIMITE_PAGINA_OPERADORA ? (itens[itens.length - 1]?.id ?? null) : null,
        };
      },
      { itens: [], proxima: null },
    );
  }

  contrato(c: ContextoOperadora, id: number): Promise<Contrato | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_CONTRATO} AND cp.id = ?`, [est, id]);
        return x ? contratoDaLinha(x) : null;
      },
      null,
    );
  }

  beneficiarios(
    c: ContextoOperadora,
    f: FiltroBeneficiarios,
  ): Promise<{ itens: Beneficiario[]; proxima: number | null }> {
    return this.ler(
      c,
      async (l, est) => {
        const onde = ['cp.operadora_saude_id = ?'];
        const ps: unknown[] = [est, f.operadora];
        const igual = (coluna: string, v: unknown) => {
          onde.push(`${coluna} = ?`);
          ps.push(v);
        };
        if (f.contrato !== undefined) igual('b.contrato_plano_id', f.contrato);
        if (f.titular !== undefined) igual('b.titular_beneficiario_plano_id', f.titular);
        if (f.carteirinha) igual('b.matricula', f.carteirinha);
        if (f.cpf) igual('pf.cpf', f.cpf);
        if (f.situacao) igual('b.situacao', f.situacao);
        if (f.nome) {
          onde.push("pf.nome LIKE ? ESCAPE '\\\\'");
          ps.push(inicioLike(f.nome));
        }
        if (f.apos !== undefined) {
          onde.push('b.id > ?');
          ps.push(f.apos);
        }
        const r = await l.consultar(
          `${SELECT_BENEFICIARIO} AND ${onde.join(' AND ')} ORDER BY b.id LIMIT ${LIMITE_PAGINA_OPERADORA + 1}`,
          ps,
          { teto: LIMITE_PAGINA_OPERADORA + 1 },
        );
        const itens = r.slice(0, LIMITE_PAGINA_OPERADORA).map(beneficiarioDaLinha);
        return {
          itens,
          proxima: r.length > LIMITE_PAGINA_OPERADORA ? (itens[itens.length - 1]?.id ?? null) : null,
        };
      },
      { itens: [], proxima: null },
    );
  }

  beneficiario(c: ContextoOperadora, id: number): Promise<Beneficiario | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_BENEFICIARIO} AND b.id = ?`, [est, id]);
        return x ? beneficiarioDaLinha(x) : null;
      },
      null,
    );
  }

  dependentes(c: ContextoOperadora, titular: number): Promise<Beneficiario[]> {
    return this.ler(
      c,
      async (l, est) =>
        (
          await l.consultar(
            `${SELECT_BENEFICIARIO} AND b.titular_beneficiario_plano_id = ? ORDER BY b.id`,
            [est, titular],
            {
              teto: 500,
            },
          )
        ).map(beneficiarioDaLinha),
      [],
    );
  }

  vias(c: ContextoOperadora, beneficiario: number): Promise<ViaCarteirinha[]> {
    return this.ler(
      c,
      async (l, est) =>
        (
          await l.consultar(
            `SELECT k.via, k.motivo_solicitacao_cartao_id, k.validade, k.emitido_em, k.criado_em, u.login
               FROM cartao_beneficiario k
               JOIN beneficiario_plano b ON b.id = k.beneficiario_plano_id
               JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
               LEFT JOIN usuario u ON u.id = k.criado_por
              WHERE k.beneficiario_plano_id = ? AND cp.estabelecimento_id = ? AND k.excluido_em IS NULL
              ORDER BY k.via`,
            [beneficiario, est],
            { teto: 1_000 },
          )
        ).map((x) => ({
          via: Number(x['via']),
          motivo: inteiro(x['motivo_solicitacao_cartao_id']),
          validade: dataIso(x['validade']) ?? '',
          emitidaPor: texto(x['login']) ?? 'sistema',
          emitidaEm: instanteIso(x['criado_em']) ?? dataIso(x['emitido_em']) ?? '',
        })),
      [],
    );
  }

  elegibilidade(c: ContextoOperadora, carteirinha: string): Promise<Elegibilidade | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_BENEFICIARIO} AND b.matricula = ?`, [est, carteirinha]);
        if (!x) return null;
        const beneficiario = beneficiarioDaLinha(x);
        const ct = await l.uma(
          `SELECT cp.situacao, cp.inicio_vigencia, cp.fim_vigencia, pc.produto_plano_id
             FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
             LEFT JOIN plano_comercializado pc ON pc.id = b.plano_comercializado_id
            WHERE b.id = ?`,
          [beneficiario.id],
        );
        const idProduto = inteiro(ct?.['produto_plano_id']);
        const pr =
          idProduto === null ? null : await l.uma(`${SELECT_PRODUTO} AND pr.id = ?`, [est, est, idProduto]);
        const produto = pr ? (await produtosCompletos(l, [pr]))[0] : undefined;
        if (!ct || !produto) return null;
        return {
          beneficiario,
          contrato: {
            situacao: SITUACAO_CONTRATO.codigo(ct['situacao']) ?? 'ativo',
            inicio: dataIso(ct['inicio_vigencia']) ?? '',
            fim: dataIso(ct['fim_vigencia']),
          },
          produto,
        };
      },
      null,
    );
  }

  contagensDoContrato(
    c: ContextoOperadora,
    x: { contrato: number; cpf: string | null; exceto: number | null },
  ): Promise<{ titularesAtivos: number; cpfNoContrato: number }> {
    return this.ler(
      c,
      async (l, est) => {
        const r = await l.uma(
          `SELECT SUM(CASE WHEN b.tipo = 'titular' AND b.situacao = 'ativo' THEN 1 ELSE 0 END) AS titulares,
                  SUM(CASE WHEN b.situacao <> 'excluido' AND pf.cpf = ? THEN 1 ELSE 0 END) AS cpf
             FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
             JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
            WHERE b.contrato_plano_id = ? AND cp.estabelecimento_id = ? AND b.excluido_em IS NULL AND b.id <> ?`,
          [x.cpf, x.contrato, est, x.exceto ?? 0],
        );
        return {
          titularesAtivos: inteiro(r?.['titulares']) ?? 0,
          cpfNoContrato: x.cpf ? (inteiro(r?.['cpf']) ?? 0) : 0,
        };
      },
      { titularesAtivos: 0, cpfNoContrato: 0 },
    );
  }

  contagensDeUso(
    c: ContextoOperadora,
    x: { contrato: number | null; produto: number | null },
  ): Promise<{ beneficiariosVinculados: number; contratosEmUso: number }> {
    return this.ler(
      c,
      async (l, est) => {
        const b =
          x.contrato === null
            ? null
            : await l.uma(
                `SELECT COUNT(*) AS n FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
                  WHERE b.contrato_plano_id = ? AND cp.estabelecimento_id = ? AND b.excluido_em IS NULL
                    AND b.situacao <> 'excluido'`,
                [x.contrato, est],
              );
        const k =
          x.produto === null
            ? null
            : await l.uma(
                `SELECT COUNT(*) AS n FROM contrato_plano WHERE produto_plano_id = ? AND estabelecimento_id = ?
                    AND excluido_em IS NULL AND situacao <> 'encerrado'`,
                [x.produto, est],
              );
        return { beneficiariosVinculados: inteiro(b?.['n']) ?? 0, contratosEmUso: inteiro(k?.['n']) ?? 0 };
      },
      { beneficiariosVinculados: 0, contratosEmUso: 0 },
    );
  }

  dominiosBeneficiario(c: ContextoOperadora): Promise<DominiosBeneficiario> {
    return this.lerCatalogo(c, async (l) => {
      const baixa = await l.consultar(
        "SELECT id, descricao FROM motivo_movimento_cadastral WHERE ativo = TRUE AND tipo_movimento = 'exclusao' ORDER BY descricao, id",
        [],
        { teto: 500 },
      );
      const via = await l.consultar(
        'SELECT id, descricao FROM motivo_solicitacao_cartao WHERE ativo = TRUE ORDER BY descricao, id',
        [],
        { teto: 500 },
      );
      const item = (x: Linha) => ({ codigo: Number(x['id']), nome: textoObrigatorio(x['descricao']) });
      // O dia de vencimento é livre (1 a 31, conferido pelo contrato da tela e pelo CHECK do banco).
      return { motivosBaixa: baixa.map(item), motivosSegundaVia: via.map(item), diasVencimento: [] };
    });
  }

  pacienteExiste(c: ContextoOperadora, id: number): Promise<boolean> {
    // O paciente é do cliente inteiro (prontuário único): sem filtro de estabelecimento.
    return this.lerCatalogo(
      c,
      async (l) =>
        (await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [id])) !== null,
    );
  }

  // ---- F1: gravações ----

  async gravar<T>(
    c: ContextoOperadora,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorOperadora) => Promise<T>,
  ): Promise<T> {
    const est = await this.lerCatalogo(c, (l) => estabelecimentoDaSessao(c, l));
    if (est === null) throw semEstabelecimento();
    const fixa = typeof trilha === 'function' ? null : trilha;
    // O resultado da tela fica com quem chama; o núcleo guarda só os campos simples (ids, números, textos curtos).
    let feito: { readonly r: T } | null = null;
    const linha = (): RegistroTrilhaTela => {
      if (!feito) throw new Error('Gravação sem resultado.');
      return typeof trilha === 'function' ? trilha(feito.r) : trilha;
    };
    const operacao = definirOperacao<Record<string, unknown>, ResultadoOperacao>({
      nome: 'operadora.cadastro.gravacao',
      tabelas: TABELAS_OPERADORA,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        try {
          const r = await fn(new GravadorOperadoraBanco(tx, est));
          feito = { r };
          return resultadoSimples(r);
        } catch (e) {
          throw traduzirRestricao(e, RESTRICOES);
        }
      },
      alvo: () => {
        const l = linha();
        return { tabela: l.entidade, id: l.entidadeId };
      },
      trilha: () => {
        const l = linha();
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    await this.executor.executar(operacao, this.cliente, {}, contextoDireto(this.cliente, est, c, fixa));
    const pronto = feito as { readonly r: T } | null;
    if (!pronto) throw new Error('Gravação sem resultado.');
    return pronto.r;
  }
}

/** Os campos simples do resultado (o que vai ao resultado da operação no núcleo). */
function resultadoSimples(r: unknown): ResultadoOperacao {
  if (!r || typeof r !== 'object') return {};
  return Object.fromEntries(
    Object.entries(r).filter(
      ([, v]) =>
        v === null ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        (typeof v === 'string' && v.length <= 200),
    ),
  ) as ResultadoOperacao;
}

/** O gravador da F1 sobre a transação da operação (o estabelecimento é o da sessão). */
class GravadorOperadoraBanco implements GravadorOperadora {
  private hojeLido: string | null = null;

  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
  ) {}

  private async hoje(): Promise<string> {
    if (this.hojeLido) return this.hojeLido;
    const r = await this.tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
    this.hojeLido = dataIso(r?.['hoje']) ?? new Date().toISOString().slice(0, 10);
    return this.hojeLido;
  }

  private get usuario(): number | null {
    return this.tx.contexto.usuario;
  }

  /** Id de um cadastro do cliente pelo filtro (null: falta a linha). */
  private async idDe(sql: string, ps: readonly unknown[]): Promise<number | null> {
    const r = await this.tx.uma<{ id: unknown }>(sql, ps);
    return r ? Number(r['id']) : null;
  }

  private async exigirId(
    sql: string,
    ps: readonly unknown[],
    dominio: string,
    campo: string,
  ): Promise<number> {
    const id = await this.idDe(sql, ps);
    if (id === null) throw dominioAusente(dominio, campo);
    return id;
  }

  /** A operadora tem de estar vinculada ao estabelecimento da sessão. */
  private async operadoraDoEstabelecimento(operadora: number): Promise<void> {
    const ok = await this.idDe(
      `SELECT o.id FROM operadora_saude o WHERE o.id = ? AND o.excluido_em IS NULL AND ${SQL_OPERADORA_DO_ESTAB}`,
      [operadora, this.est],
    );
    if (ok === null) throw naoEncontrado('A operadora');
  }

  private async pessoaJuridica(
    cnpj: string,
    razaoSocial: string,
    nomeFantasia: string | null,
  ): Promise<number> {
    const pj = await this.idDe('SELECT id FROM pessoa_juridica WHERE cnpj = ? AND excluido_em IS NULL', [
      cnpj,
    ]);
    if (pj !== null) return pj;
    return this.tx.incluir('pessoa_juridica', {
      cnpj,
      estrangeira: false,
      razao_social: razaoSocial,
      nome_fantasia: nomeFantasia,
    });
  }

  async gravarOperadora(x: { id: number | null; versao: number | null; dados: DadosOperadora; por: string }) {
    const d = x.dados;
    const modalidade = MODALIDADE.banco(d.modalidade);
    if (!modalidade)
      throw recusa('dominio-invalido', 'Modalidade fora do domínio aceito.', { campos: ['modalidade'] });
    const segmentacao = modalidade.includes('odontolog') ? 'odontologico' : 'medico_hospitalar';
    const hoje = await this.hoje();
    const pj = await this.pessoaJuridica(d.cnpj, d.razaoSocial, d.nomeFantasia);
    const outra = await this.idDe(
      'SELECT id FROM operadora_saude WHERE pessoa_juridica_id = ? AND excluido_em IS NULL AND id <> ?',
      [pj, x.id ?? 0],
    );
    if (outra !== null)
      throw recusa('cnpj-em-uso', 'Já existe operadora com este CNPJ.', { campos: ['cnpj'] });
    const valores = {
      pessoa_juridica_id: pj,
      nome: (d.nomeFantasia ?? d.razaoSocial).slice(0, 150),
      registro_ans: d.registroAns,
      modalidade,
      ativo: d.situacao === 'ativa',
    };
    let id: number;
    if (x.id === null) {
      id = await this.tx.incluir('operadora_saude', { ...valores, segmentacao, situacao_registro: 'ativo' });
      const principal = await this.idDe(
        'SELECT id FROM operadora_saude_estabelecimento WHERE estabelecimento_id = ? AND principal = TRUE AND excluido_em IS NULL',
        [this.est],
      );
      await this.tx.incluir('operadora_saude_estabelecimento', {
        operadora_saude_id: id,
        estabelecimento_id: this.est,
        principal: principal === null,
        vigencia_inicio: hoje,
      });
    } else {
      await this.operadoraDoEstabelecimento(x.id);
      if (x.versao === null) throw desatualizado();
      id = x.id;
      await this.tx.alterar('operadora_saude', id, x.versao, valores);
    }
    // O nome da pessoa jurídica acompanha o cadastro da operadora (é a própria empresa).
    const pjLinha = await this.tx.uma(
      'SELECT versao, razao_social, nome_fantasia FROM pessoa_juridica WHERE id = ?',
      [pj],
    );
    if (
      pjLinha &&
      (texto(pjLinha['razao_social']) !== d.razaoSocial || texto(pjLinha['nome_fantasia']) !== d.nomeFantasia)
    )
      await this.tx.alterar('pessoa_juridica', pj, Number(pjLinha['versao']), {
        razao_social: d.razaoSocial,
        nome_fantasia: d.nomeFantasia,
      });
    await this.tx.incluir('operadora_saude_historico', {
      operadora_saude_id: id,
      operacao: x.id === null ? 'inclusao' : 'alteracao',
      dados: JSON.stringify({ registroAns: d.registroAns, modalidade, ativo: d.situacao === 'ativa' }),
      ocorrido_em: new Date(),
      usuario_id: this.usuario,
      vigencia_inicio: hoje,
      modalidade,
      situacao_registro: 'ativo',
    });
    return { id };
  }

  async gravarProduto(x: { id: number | null; versao: number | null; dados: DadosProduto; por: string }) {
    const d = x.dados;
    await this.operadoraDoEstabelecimento(d.operadora);
    const tipoContratacao = TIPO_CONTRATACAO.banco(d.tipoContratacao);
    if (!tipoContratacao)
      throw recusa('dominio-invalido', 'Tipo de contratação fora do domínio.', {
        campos: ['tipoContratacao'],
      });
    const abrangencia = d.abrangencia === null ? null : ABRANGENCIA.banco(d.abrangencia);
    if (!abrangencia)
      throw recusa(
        'abrangencia-obrigatoria',
        'Informe a abrangência geográfica do plano (exigida pela ANS).',
        {
          campos: ['abrangencia'],
        },
      );
    const situacao = SITUACAO_PRODUTO.banco(d.situacao);
    if (!situacao) throw recusa('dominio-invalido', 'Situação fora do domínio.', { campos: ['situacao'] });
    const acomodacao =
      d.acomodacao === null
        ? null
        : await this.exigirId(
            'SELECT id FROM tipo_acomodacao_plano WHERE codigo = ? AND ativo = TRUE',
            [String(d.acomodacao)],
            'tipos de acomodação',
            'acomodacao',
          );
    const odontologico = d.segmentacao === 'odontologico';
    const hoje = await this.hoje();
    const valores = {
      codigo: d.codigo,
      nome: d.nome,
      numero_registro_ans: d.registroAns,
      tipo_contratacao: tipoContratacao,
      abrangencia_geografica: abrangencia,
      tipo_acomodacao_plano_id: acomodacao,
      odontologico,
      situacao_ans: situacao,
      natureza: d.natureza === 'cartaoDesconto' ? 'cartao_desconto' : 'plano',
      operadora_saude_id: d.operadora,
    };
    const situacaoPlano =
      d.situacao === 'ativo' ? 'ativo' : d.situacao === 'suspenso' ? 'suspenso' : 'inativo';
    let id: number;
    let plano: number;
    if (x.id === null) {
      id = await this.tx.incluir('produto_plano', {
        ...valores,
        estabelecimento_id: this.est,
        vigencia_inicio: hoje,
        situacao_em: hoje,
      });
      plano = await this.tx.incluir('plano_comercializado', {
        estabelecimento_id: this.est,
        produto_plano_id: id,
        codigo: d.codigo,
        nome_comercial: d.nome,
        tipo_acomodacao_plano_id: acomodacao,
        odontologico,
        vigencia_inicio: hoje,
        situacao: situacaoPlano,
      });
    } else {
      const atual = await this.tx.uma(
        `SELECT id, versao, codigo, situacao_ans, COALESCE(operadora_saude_id, ${SQL_OPERADORA_PRINCIPAL}) AS operadora
           FROM produto_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [this.est, x.id, this.est],
      );
      if (!atual) throw naoEncontrado('O produto');
      if (x.versao === null || Number(atual['versao']) !== x.versao) throw desatualizado();
      // A operadora dona não muda: os preços, a coparticipação e os contratos do produto são dela.
      if (inteiro(atual['operadora']) !== d.operadora)
        throw recusa(
          'operadora-do-produto',
          'O produto pertence a outra operadora; cadastre um produto novo.',
          {
            campos: ['operadora'],
          },
        );
      id = x.id;
      await this.tx.alterar('produto_plano', id, x.versao, {
        ...valores,
        ...(texto(atual['situacao_ans']) !== situacao ? { situacao_em: hoje } : {}),
      });
      const pc = await this.tx.uma(
        `SELECT id, versao FROM plano_comercializado WHERE produto_plano_id = ? AND estabelecimento_id = ? AND codigo = ?
            AND excluido_em IS NULL`,
        [id, this.est, textoObrigatorio(atual['codigo'])],
      );
      if (pc) {
        plano = Number(pc['id']);
        await this.tx.alterar('plano_comercializado', plano, Number(pc['versao']), {
          codigo: d.codigo,
          nome_comercial: d.nome,
          tipo_acomodacao_plano_id: acomodacao,
          odontologico,
          situacao: situacaoPlano,
        });
      } else
        plano = await this.tx.incluir('plano_comercializado', {
          estabelecimento_id: this.est,
          produto_plano_id: id,
          codigo: d.codigo,
          nome_comercial: d.nome,
          tipo_acomodacao_plano_id: acomodacao,
          odontologico,
          vigencia_inicio: hoje,
          situacao: situacaoPlano,
        });
    }
    await this.segmentacao(id, d.segmentacao);
    await this.coparticipacao(d.operadora, plano, d.coparticipacao, hoje);
    await this.carencias(id, d.carencias, hoje);
    await this.precos(d.operadora, id, d.nome, d.precos, hoje);
    return { id };
  }

  /** A segmentação do produto: só muda o que mudou; a que sai fica com exclusão lógica (o par é único: volta a mesma linha). */
  private async segmentacao(produto: number, segmentacao: string | null): Promise<void> {
    let alvo: number | null = null;
    if (segmentacao !== null) {
      const s = SEGMENTACOES[segmentacao];
      if (!s) throw recusa('dominio-invalido', 'Segmentação fora do domínio.', { campos: ['segmentacao'] });
      alvo = await this.exigirId(
        `SELECT id FROM segmentacao_assistencial
          WHERE inclui_ambulatorial = ? AND inclui_hospitalar = ? AND inclui_obstetricia = ? AND inclui_odontologia = ?
            AND plano_referencia = ? AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          ORDER BY id LIMIT 1`,
        [s.amb, s.hosp, s.obst, s.odonto, s.referencia],
        'segmentações assistenciais',
        'segmentacao',
      );
    }
    // Inclui as excluídas de propósito: o par (produto, segmentação) é único, e a que volta é reativada.
    const linhas = await this.tx.consultar(
      `SELECT id, versao, segmentacao_assistencial_id, excluido_em IS NOT NULL AS excluida FROM produto_plano_segmentacao
        WHERE produto_plano_id = ? ORDER BY id`,
      [produto],
      { teto: 50 },
    );
    let presente = false;
    for (const r of linhas) {
      const excluida = booleano(r['excluida']);
      if (alvo !== null && Number(r['segmentacao_assistencial_id']) === alvo) {
        presente = true;
        if (excluida)
          await this.tx.alterar('produto_plano_segmentacao', Number(r['id']), Number(r['versao']), {
            excluido_em: null,
            excluido_por: null,
          });
      } else if (!excluida)
        await this.tx.alterar('produto_plano_segmentacao', Number(r['id']), Number(r['versao']), {
          excluido_em: new Date(),
          excluido_por: this.usuario,
        });
    }
    if (alvo !== null && !presente)
      await this.tx.incluir('produto_plano_segmentacao', {
        produto_plano_id: produto,
        segmentacao_assistencial_id: alvo,
      });
  }

  private async coparticipacao(
    operadora: number,
    plano: number,
    cp: DadosProduto['coparticipacao'],
    hoje: string,
  ): Promise<void> {
    const tipo = TIPO_COPARTICIPACAO.banco(cp.tipo);
    if (!tipo)
      throw recusa('dominio-invalido', 'Tipo de coparticipação fora do domínio.', {
        campos: ['coparticipacao.tipo'],
      });
    const valores = {
      tipo_coparticipacao: tipo,
      percentual: tipo === 'percentual' ? cp.valor : null,
      valor: tipo === 'valor_fixo' ? cp.valor : null,
    };
    const atual = await this.tx.uma(
      `SELECT id, versao, tipo_coparticipacao, percentual, valor FROM regra_coparticipacao WHERE plano_comercializado_id = ?
          AND contrato_plano_id IS NULL AND grupo_procedimento_operadora_id IS NULL AND item_faturavel_id IS NULL
          AND ativo = TRUE
        ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
      [plano],
    );
    if (atual) {
      const igual =
        texto(atual['tipo_coparticipacao']) === tipo &&
        numero(atual['percentual']) === valores.percentual &&
        numero(atual['valor']) === valores.valor;
      if (!igual)
        await this.tx.alterar('regra_coparticipacao', Number(atual['id']), Number(atual['versao']), valores);
    } else
      await this.tx.incluir('regra_coparticipacao', {
        ...valores,
        operadora_saude_id: operadora,
        codigo: `PLANO-${plano}`,
        descricao: 'Coparticipação padrão do plano',
        plano_comercializado_id: plano,
        vigencia_inicio: hoje,
        ativo: true,
      });
  }

  private async carencias(produto: number, c: CarenciasProduto, hoje: string): Promise<void> {
    for (const [k, tipo] of Object.entries(CARENCIAS) as [keyof CarenciasProduto, string][]) {
      const grupo = await this.exigirId(
        'SELECT id FROM grupo_prazo_carencia WHERE tipo_carencia = ? AND ativo = TRUE ORDER BY id LIMIT 1',
        [tipo],
        'grupos de prazo de carência',
        `carencias.${k}`,
      );
      const atual = await this.tx.uma(
        `SELECT id, versao, dias_carencia FROM carencia_produto_contrato WHERE grupo_prazo_carencia_id = ? AND produto_plano_id = ?
            AND contrato_plano_id IS NULL AND ativo = TRUE ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
        [grupo, produto],
      );
      if (atual) {
        if (inteiro(atual['dias_carencia']) !== c[k])
          await this.tx.alterar('carencia_produto_contrato', Number(atual['id']), Number(atual['versao']), {
            dias_carencia: c[k],
          });
      } else
        await this.tx.incluir('carencia_produto_contrato', {
          grupo_prazo_carencia_id: grupo,
          produto_plano_id: produto,
          dias_carencia: c[k],
          vigencia_inicio: hoje,
          ativo: true,
        });
    }
  }

  /**
   * A tabela de preço do produto (código PRODUTO-<id>, e PRODUTO-<id>-V<n> nas seguintes): nada muda quando os preços
   * são os mesmos; preço novo encerra a tabela vigente (situação e fim da vigência) e abre outra a partir de hoje. As
   * faixas antigas ficam (o preço com que as mensalidades foram calculadas e a base do reajuste).
   */
  private async precos(
    operadora: number,
    produto: number,
    nome: string,
    precos: readonly number[] | null,
    hoje: string,
  ): Promise<void> {
    const codigo = `PRODUTO-${produto}`;
    // Pelo código, sem a operadora (o produto ainda não guarda a dona). Inclui as excluídas só para numerar a versão
    // (o código é único por operadora, excluída ou não); as vigentes filtram excluido_em.
    const tabelas = await this.tx.consultar(
      `SELECT id, versao, codigo, situacao, vigencia_inicio, excluido_em IS NOT NULL AS excluida FROM tabela_preco_plano
        WHERE (codigo = ? OR codigo LIKE ?) AND exclusiva_contrato_plano_id IS NULL ORDER BY id`,
      [codigo, `${codigo}-V%`],
      { teto: 1000 },
    );
    const vigentes = tabelas.filter((t) => !booleano(t['excluida']) && texto(t['situacao']) === 'vigente');
    const encerrar = async () => {
      for (const t of vigentes) {
        const inicio = dataIso(t['vigencia_inicio']) ?? hoje;
        const ontem = new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await this.tx.alterar('tabela_preco_plano', Number(t['id']), Number(t['versao']), {
          situacao: 'encerrada',
          vigencia_fim: ontem < inicio ? inicio : ontem,
        });
      }
    };
    if (precos === null) {
      // Sem preços (ex.: o produto deixou de ter tabela): a tabela vigente se encerra.
      await encerrar();
      return;
    }
    if (precos.length !== FAIXAS_ETARIAS_ANS.length)
      throw recusa('precos-invalidos', 'Informe o preço das 10 faixas etárias.', { campos: ['precos'] });
    const [unica] = vigentes;
    if (vigentes.length === 1 && unica) {
      const faixas = await this.tx.consultar(
        `SELECT sequencia, valor_mensalidade FROM tabela_preco_plano_faixa
          WHERE tabela_preco_plano_id = ? AND produto_plano_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [Number(unica['id']), produto],
        { teto: 20 },
      );
      const iguais =
        faixas.length === precos.length &&
        faixas.every(
          (f, i) =>
            Math.round((numero(f['valor_mensalidade']) ?? -1) * 100) === Math.round((precos[i] ?? -2) * 100),
        );
      if (iguais) return;
    }
    const modelo = await this.exigirId(
      "SELECT id FROM faixa_etaria_modelo WHERE tipo = 'dez_faixas' AND ativo = TRUE ORDER BY id LIMIT 1",
      [],
      'modelos de faixa etária',
      'precos',
    );
    await encerrar();
    const versoes = tabelas.map((t) => {
      const m = /-V(\d+)$/.exec(textoObrigatorio(t['codigo']));
      return m ? Number(m[1]) : 1;
    });
    const proxima = tabelas.length === 0 ? 1 : Math.max(...versoes) + 1;
    const idTabela = await this.tx.incluir('tabela_preco_plano', {
      operadora_saude_id: operadora,
      codigo: proxima === 1 ? codigo : `${codigo}-V${proxima}`,
      nome: `Preços do produto ${nome}`.slice(0, 150),
      modelo_valor: 'faixa_etaria',
      faixa_etaria_modelo_id: modelo,
      situacao: 'vigente',
      vigencia_inicio: hoje,
    });
    const itens = await this.tx.consultar(
      'SELECT id, sequencia FROM faixa_etaria_modelo_item WHERE faixa_etaria_modelo_id = ? ORDER BY sequencia',
      [modelo],
      { teto: 20 },
    );
    for (const [i, faixa] of FAIXAS_ETARIAS_ANS.entries())
      await this.tx.incluir('tabela_preco_plano_faixa', {
        tabela_preco_plano_id: idTabela,
        sequencia: i + 1,
        produto_plano_id: produto,
        faixa_etaria_modelo_item_id:
          itens.length === FAIXAS_ETARIAS_ANS.length ? Number(itens[i]?.['id']) : null,
        idade_inicial: faixa.de,
        idade_final: faixa.ate ?? null,
        valor_mensalidade: precos[i],
        vigencia_inicio: hoje,
      });
  }

  /** O produto do estabelecimento e o plano comercializado dele (o beneficiário entra no plano). */
  private async planoDoProduto(produto: number): Promise<number> {
    const r = await this.tx.uma(
      `SELECT pc.id FROM produto_plano pr JOIN plano_comercializado pc ON pc.produto_plano_id = pr.id
         AND pc.estabelecimento_id = pr.estabelecimento_id AND pc.excluido_em IS NULL
        WHERE pr.id = ? AND pr.estabelecimento_id = ? AND pr.excluido_em IS NULL ORDER BY (pc.codigo = pr.codigo) DESC, pc.id LIMIT 1`,
      [produto, this.est],
    );
    if (!r) throw naoEncontrado('O produto');
    return Number(r['id']);
  }

  private async contratante(operadora: number, d: DadosContrato): Promise<number> {
    const fisica = d.tipo === 1;
    // Documento já cadastrado: só é a mesma pessoa (física ou jurídica) com o mesmo nome; o cadastro não é regravado.
    const existente = fisica
      ? await this.tx.uma(
          'SELECT id, nome, NULL AS fantasia FROM pessoa_fisica WHERE cpf = ? AND excluido_em IS NULL',
          [d.contratanteDocumento],
        )
      : await this.tx.uma(
          'SELECT id, razao_social AS nome, nome_fantasia AS fantasia FROM pessoa_juridica WHERE cnpj = ? AND excluido_em IS NULL',
          [d.contratanteDocumento],
        );
    if (
      existente &&
      ![existente['nome'], existente['fantasia']].some(
        (n) => n && nomeComparavel(texto(n)) === nomeComparavel(d.contratanteNome),
      )
    )
      throw recusa(
        'documento-de-outra-pessoa',
        'Este documento já está no cadastro com outro nome. Confira o documento e o nome do contratante.',
        { campos: ['contratanteDocumento'] },
      );
    const pessoa = existente
      ? Number(existente['id'])
      : fisica
        ? await this.tx.incluir('pessoa_fisica', { nome: d.contratanteNome, cpf: d.contratanteDocumento })
        : await this.pessoaJuridica(d.contratanteDocumento, d.contratanteNome, null);
    const coluna = fisica ? 'pessoa_fisica_id' : 'pessoa_juridica_id';
    const atual = await this.idDe(
      `SELECT id FROM contratante_plano WHERE operadora_saude_id = ? AND ${coluna} = ? AND excluido_em IS NULL`,
      [operadora, pessoa],
    );
    if (atual !== null) return atual;
    await garantirSequencia(
      this.tx,
      { tipo: 'contratante_plano', estabelecimento: null },
      { usuario: this.usuario, agora: new Date() },
    );
    // Por cliente: o código é único na operadora, que pode servir a vários estabelecimentos.
    const numeroContratante = await this.tx.proximoNumero('contratante_plano', { porCliente: true });
    return this.tx.incluir('contratante_plano', {
      operadora_saude_id: operadora,
      codigo: numeroContratante.formatado,
      tipo_pessoa: fisica ? 'fisica' : 'juridica',
      [coluna]: pessoa,
      natureza: fisica ? 'pessoa_fisica' : 'empresa',
      situacao: 'ativa',
    });
  }

  async gravarContrato(x: {
    operadora: number;
    id: number | null;
    versao: number | null;
    dados: DadosContrato;
    por: string;
  }) {
    const d = x.dados;
    await this.operadoraDoEstabelecimento(x.operadora);
    await this.planoDoProduto(d.produto);
    const tipoContratacao = TIPO_CONTRATACAO.banco(d.tipoContratacao);
    if (!tipoContratacao)
      throw recusa('dominio-invalido', 'Tipo de contratação fora do domínio.', {
        campos: ['tipoContratacao'],
      });
    const classificacao = await this.exigirId(
      'SELECT id FROM classificacao_plano WHERE tipo_contratacao = ? AND ativo = TRUE ORDER BY id LIMIT 1',
      [tipoContratacao],
      'classificações de plano',
      'tipoContratacao',
    );
    const forma = FORMA_REAJUSTE.banco(d.formaReajuste);
    const vigencia = TIPO_VIGENCIA.banco(d.tipoVigencia);
    const situacao = SITUACAO_CONTRATO.banco(d.situacao);
    if (!forma)
      throw recusa('dominio-invalido', 'Forma de reajuste fora do domínio.', { campos: ['formaReajuste'] });
    if (!vigencia)
      throw recusa('dominio-invalido', 'Tipo de vigência fora do domínio.', { campos: ['tipoVigencia'] });
    if (!situacao) throw recusa('dominio-invalido', 'Situação fora do domínio.', { campos: ['situacao'] });
    const valores = {
      operadora_saude_id: x.operadora,
      numero: d.numero,
      contratante_plano_id: await this.contratante(x.operadora, d),
      classificacao_plano_id: classificacao,
      produto_plano_id: d.produto,
      inicio_vigencia: d.inicio,
      fim_vigencia: d.fim,
      tipo_vigencia: vigencia,
      dia_vencimento: d.diaVencimento,
      forma_reajuste: forma,
      mes_reajuste: d.mesReajuste,
      situacao,
      motivo_situacao: d.motivoSituacao,
    };
    if (x.id === null)
      return { id: await this.tx.incluir('contrato_plano', { ...valores, estabelecimento_id: this.est }) };
    const atual = await this.idDe(
      'SELECT id FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [x.id, this.est],
    );
    if (atual === null) throw naoEncontrado('O contrato');
    if (x.versao === null) throw desatualizado();
    await this.tx.alterar('contrato_plano', x.id, x.versao, valores);
    return { id: x.id };
  }

  async proximaSequenciaCarteirinha(): Promise<number> {
    await garantirSequencia(
      this.tx,
      { tipo: 'carteirinha_beneficiario', estabelecimento: null },
      { usuario: this.usuario, agora: new Date() },
    );
    // Por cliente: a matrícula é única no cliente, e a mesma operadora pode estar em vários estabelecimentos.
    return (await this.tx.proximoNumero('carteirinha_beneficiario', { porCliente: true })).valor;
  }

  /** O contrato do estabelecimento (e da operadora, quando dada) com o produto. */
  private async contratoDoEstabelecimento(contrato: number, operadora?: number): Promise<Linha> {
    const r = await this.tx.uma(
      `SELECT id, operadora_saude_id, produto_plano_id FROM contrato_plano
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [contrato, this.est],
    );
    if (!r || (operadora !== undefined && Number(r['operadora_saude_id']) !== operadora))
      throw naoEncontrado('O contrato');
    return r;
  }

  private async sexo(sigla: string): Promise<number | null> {
    return sigla === 'I'
      ? null
      : this.exigirId(
          'SELECT id FROM sexo WHERE sigla = ? AND ativo = TRUE ORDER BY id LIMIT 1',
          [sigla],
          'sexos',
          'sexo',
        );
  }

  private async grau(d: DadosBeneficiario): Promise<number | null> {
    if (d.titular === null) return null;
    return this.exigirId(
      'SELECT id FROM grau_parentesco_dependente WHERE codigo = ? AND ativo = TRUE',
      [String(d.vinculo)],
      'graus de parentesco',
      'vinculo',
    );
  }

  private async titularDoContrato(d: DadosBeneficiario): Promise<void> {
    if (d.titular === null) return;
    const t = await this.idDe(
      `SELECT id FROM beneficiario_plano WHERE id = ? AND contrato_plano_id = ? AND tipo = 'titular' AND excluido_em IS NULL`,
      [d.titular, d.contrato],
    );
    if (t === null)
      throw recusa('titular-invalido', 'O titular não é titular deste contrato.', { campos: ['titular'] });
  }

  private async movimento(
    beneficiario: number,
    tipo: 'inclusao' | 'alteracao' | 'exclusao' | 'reativacao',
    efeito: string,
    contrato: Linha | null,
    motivo: number | null = null,
  ): Promise<void> {
    await this.tx.incluir('movimento_cadastral_beneficiario', {
      beneficiario_plano_id: beneficiario,
      operacao: tipo === 'inclusao' ? 'inclusao' : 'alteracao',
      dados: JSON.stringify({ tipo }),
      ocorrido_em: new Date(),
      usuario_id: this.usuario,
      tipo_movimento: tipo,
      motivo_movimento_cadastral_id: motivo,
      data_efeito: efeito,
      situacao: 'efetivado',
      contrato_plano_id: contrato ? Number(contrato['id']) : null,
      produto_plano_id: contrato ? inteiro(contrato['produto_plano_id']) : null,
      canal: 'manual',
    });
  }

  async incluirBeneficiario(x: {
    operadora: number;
    dados: DadosBeneficiario;
    carteirinha: string;
    validade: string;
    por: string;
  }) {
    const d = x.dados;
    const contrato = await this.contratoDoEstabelecimento(d.contrato, x.operadora);
    const produto = inteiro(contrato['produto_plano_id']);
    if (produto === null)
      throw recusa('contrato-sem-produto', 'O contrato não tem produto.', { campos: ['contrato'] });
    const plano = await this.planoDoProduto(produto);
    await this.titularDoContrato(d);
    const sexo = await this.sexo(d.sexo);
    const existente = d.cpf
      ? await this.tx.uma(
          'SELECT id, nome, data_nascimento FROM pessoa_fisica WHERE cpf = ? AND excluido_em IS NULL',
          [d.cpf],
        )
      : null;
    if (
      existente &&
      !mesmaPessoa({ nome: texto(existente['nome']), nascimento: dataIso(existente['data_nascimento']) }, d)
    )
      throw recusa(
        'cpf-de-outra-pessoa',
        'Este CPF já está no cadastro de pessoas com outro nome ou outra data de nascimento. Confira o CPF; se a pessoa é a mesma, corrija o cadastro dela antes.',
        { campos: ['cpf'] },
      );
    const pessoa =
      (existente ? Number(existente['id']) : null) ??
      (await this.tx.incluir('pessoa_fisica', {
        nome: d.nome,
        nome_social: d.nomeSocial,
        usa_nome_social: d.nomeSocial !== null,
        cpf: d.cpf,
        cns: d.cns,
        data_nascimento: d.nascimento,
        sexo_id: sexo,
        nome_mae: d.nomeMae,
      }));
    const hoje = await this.hoje();
    const id = await this.tx.incluir('beneficiario_plano', {
      contrato_plano_id: d.contrato,
      plano_comercializado_id: plano,
      pessoa_fisica_id: pessoa,
      paciente_id: d.pacienteHospital,
      tipo: d.titular === null ? 'titular' : 'dependente',
      titular_beneficiario_plano_id: d.titular,
      grau_parentesco_dependente_id: await this.grau(d),
      matricula: x.carteirinha,
      via_cartao: 1,
      data_adesao: d.inclusao,
      inicio_vigencia: d.inclusao,
      situacao: 'ativo',
    });
    await this.tx.incluir('cartao_beneficiario', {
      beneficiario_plano_id: id,
      numero_cartao: x.carteirinha,
      via: 1,
      formato: 'fisico',
      emitido_em: hoje,
      validade: x.validade,
      situacao: 'emitido',
    });
    await this.movimento(id, 'inclusao', d.inclusao, contrato);
    return { id };
  }

  /** Trava o beneficiário do estabelecimento e confere a versão vista. */
  private async travarBeneficiario(id: number, versao: number): Promise<Linha> {
    const [b] = await this.tx.consultarParaAtualizar(
      `SELECT b.id, b.versao, b.situacao, b.pessoa_fisica_id, b.contrato_plano_id, b.tipo, b.via_cartao, b.matricula,
              cp.produto_plano_id
         FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
        WHERE b.id = ? AND cp.estabelecimento_id = ? AND b.excluido_em IS NULL`,
      [id, this.est],
      { teto: 1 },
    );
    if (!b || Number(b['versao']) !== versao) throw desatualizado();
    return b;
  }

  private contratoDaLinha(b: Linha): Linha {
    return { id: b['contrato_plano_id'], produto_plano_id: b['produto_plano_id'] };
  }

  async alterarBeneficiario(x: { id: number; versao: number; dados: DadosBeneficiario; por: string }) {
    const d = x.dados;
    const b = await this.travarBeneficiario(x.id, x.versao);
    if (Number(b['contrato_plano_id']) !== d.contrato) throw desatualizado();
    await this.titularDoContrato(d);
    // A pessoa é do cadastro único (a mesma do paciente): a operadora não a regrava. Dado pessoal diferente do gravado
    // é recusado e muda pelo cadastro de pessoas, com as regras e a trilha dele.
    const p = await this.tx.uma(
      `SELECT pf.nome, pf.nome_social, pf.cpf, pf.cns, pf.data_nascimento, sx.sigla AS sexo, pf.nome_mae
         FROM pessoa_fisica pf LEFT JOIN sexo sx ON sx.id = pf.sexo_id WHERE pf.id = ?`,
      [Number(b['pessoa_fisica_id'])],
    );
    if (!p) throw desatualizado();
    const mudados = camposPessoaisMudados(
      {
        nome: textoObrigatorio(p['nome']),
        nomeSocial: texto(p['nome_social']),
        cpf: texto(p['cpf']),
        cns: texto(p['cns']),
        nascimento: dataIso(p['data_nascimento']),
        sexo: texto(p['sexo']) ?? 'I',
        nomeMae: texto(p['nome_mae']),
      },
      d,
    );
    if (mudados.length)
      throw recusa(
        'dados-pessoais-pelo-cadastro',
        'Nome, documentos, nascimento, sexo e mãe são do cadastro de pessoas (o mesmo do paciente): altere-os por lá.',
        { campos: mudados },
      );
    await this.tx.alterar('beneficiario_plano', x.id, x.versao, {
      paciente_id: d.pacienteHospital,
      tipo: d.titular === null ? 'titular' : 'dependente',
      titular_beneficiario_plano_id: d.titular,
      grau_parentesco_dependente_id: await this.grau(d),
      data_adesao: d.inclusao,
      inicio_vigencia: d.inclusao,
    });
    await this.movimento(x.id, 'alteracao', await this.hoje(), this.contratoDaLinha(b));
    return { id: x.id };
  }

  async baixarBeneficiario(x: { id: number; versao: number; motivo: number; data: string; por: string }) {
    const b = await this.travarBeneficiario(x.id, x.versao);
    if (textoObrigatorio(b['situacao']) === 'excluido') throw desatualizado();
    const motivo = await this.exigirId(
      "SELECT id FROM motivo_movimento_cadastral WHERE id = ? AND tipo_movimento = 'exclusao' AND ativo = TRUE",
      [x.motivo],
      'motivos de exclusão',
      'motivo',
    );
    const baixa = { situacao: 'excluido', data_exclusao: x.data, motivo_movimento_cadastral_id: motivo };
    await this.tx.alterar('beneficiario_plano', x.id, x.versao, baixa);
    await this.movimento(x.id, 'exclusao', x.data, this.contratoDaLinha(b), motivo);
    let dependentes = 0;
    if (textoObrigatorio(b['tipo']) === 'titular') {
      const deps = await this.tx.consultarParaAtualizar(
        `SELECT id, versao FROM beneficiario_plano WHERE titular_beneficiario_plano_id = ? AND situacao <> 'excluido'
            AND excluido_em IS NULL`,
        [x.id],
        { teto: 500 },
      );
      for (const dep of deps) {
        await this.tx.alterar('beneficiario_plano', Number(dep['id']), Number(dep['versao']), baixa);
        await this.movimento(Number(dep['id']), 'exclusao', x.data, this.contratoDaLinha(b), motivo);
        dependentes += 1;
      }
    }
    return { id: x.id, dependentes };
  }

  async reativarBeneficiario(x: { id: number; versao: number; por: string }) {
    const b = await this.travarBeneficiario(x.id, x.versao);
    if (textoObrigatorio(b['situacao']) !== 'excluido') throw desatualizado();
    await this.tx.alterar('beneficiario_plano', x.id, x.versao, {
      situacao: 'ativo',
      data_exclusao: null,
      motivo_movimento_cadastral_id: null,
    });
    await this.movimento(x.id, 'reativacao', await this.hoje(), this.contratoDaLinha(b));
    return { id: x.id };
  }

  async emitirVia(x: { id: number; versao: number; motivo: number | null; validade: string; por: string }) {
    const b = await this.travarBeneficiario(x.id, x.versao);
    if (textoObrigatorio(b['situacao']) !== 'ativo') throw desatualizado();
    const motivo =
      x.motivo === null
        ? null
        : await this.exigirId(
            'SELECT id FROM motivo_solicitacao_cartao WHERE id = ? AND ativo = TRUE',
            [x.motivo],
            'motivos de nova via',
            'motivo',
          );
    const via = (inteiro(b['via_cartao']) ?? 1) + 1;
    const anteriores = await this.tx.consultar(
      `SELECT id, versao FROM cartao_beneficiario WHERE beneficiario_plano_id = ? AND situacao <> 'cancelado'
          AND excluido_em IS NULL`,
      [x.id],
      { teto: 100 },
    );
    for (const a of anteriores)
      await this.tx.alterar('cartao_beneficiario', Number(a['id']), Number(a['versao']), {
        situacao: 'cancelado',
        cancelado_em: new Date(),
        cancelado_por_usuario_id: this.usuario,
      });
    await this.tx.alterar('beneficiario_plano', x.id, x.versao, { via_cartao: via });
    await this.tx.incluir('cartao_beneficiario', {
      beneficiario_plano_id: x.id,
      numero_cartao: textoObrigatorio(b['matricula']),
      via,
      formato: 'fisico',
      emitido_em: await this.hoje(),
      validade: x.validade,
      motivo_solicitacao_cartao_id: motivo,
      situacao: 'emitido',
    });
    return { id: x.id, via };
  }
}
