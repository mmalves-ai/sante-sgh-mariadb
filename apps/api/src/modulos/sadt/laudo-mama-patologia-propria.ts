// Laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18), no banco do cliente
// (`laudo_mama`, `achado_mama`, `laudo_anatomopatologico`, `amostra_anatomopatologica`), ligados ao item do pedido do
// SADT (`exame_item`). Contrato de efeito:
//   - fila: os exames pedidos no período (pela data do pedido) — mamografia: setor de imagem e exame da modalidade
//     MG; anatomia patológica: setor de anatomia patológica —, com o laudo de cada um e a categoria ou o resultado;
//   - abrir: o exame, o laudo com os achados (ou as amostras) vigentes, os laudos já liberados do mesmo paciente
//     (visão por paciente), as opções e os alertas;
//   - salvar: cria o laudo em rascunho do item (um por item) ou altera o rascunho pela versão lida, validado pela
//     regra do domínio (a mesma da tela); o achado mudado ou retirado recebe a marca de exclusão (histórico, nunca
//     apagado) e o novo entra com a sequência seguinte; a amostra é alterada no lugar (trilha), a retirada recebe a
//     marca de exclusão e volta reativada se a mesma identificação reaparecer; o laudo anatomopatológico recebe o
//     número pela sequência do estabelecimento;
//   - liberar: confere o laudo completo, grava liberado (com quem e quando) e marca o exame pedido como realizado;
//     assina o profissional da sessão (vínculo da conta), médico com inscrição ativa no conselho; o rascunho que indica
//     outro profissional é recusado; laudo liberado não muda mais;
//   - retificar: o laudo liberado vira 'retificado' (motivo, quando e quem) e um laudo novo do mesmo exame nasce em
//     rascunho ligado a ele, com os achados (ou as amostras) copiados; nada se apaga;
//   - peças enviadas: as descrições cirúrgicas com envio de peça ainda sem laudo, com os pedidos de anatomia
//     patológica abertos do mesmo paciente; receber cria o laudo em rascunho no pedido escolhido, ligado à descrição,
//     com a coleta no fim da cirurgia, o recebimento agora, o cirurgião como solicitante e a peça como amostra A;
//   - SISCAN: os laudos de mamografia liberados no período na ficha de campos do resultado de mamografia.
// A trilha vai na mesma transação (executor).
import {
  ADEQUABILIDADES_AMOSTRA,
  type AchadoMama,
  achadoMamaMudou,
  alertasLaudoAnatomopatologico,
  alertasLaudoMama,
  type AmostraAnatomopatologica,
  type AutorLaudo,
  amostraMudou,
  CATEGORIAS_MAMA,
  categoriaMaisGrave,
  COMPOSICOES_MAMA,
  conferirLaudoAnatomopatologico,
  conferirAutorLaudo,
  conferirLaudoMama,
  conferirRetificacaoEspecializado,
  CONTORNOS_ACHADO_MAMA,
  type DadosEstruturadosAnatomopatologico,
  DENSIDADES_ACHADO_MAMA,
  DISTRIBUICOES_CALCIFICACAO,
  ehMedico,
  fichaSiscanMamografia,
  FORMAS_ACHADO_MAMA,
  HER2_ESCORES,
  itemEmExecucaoHemodinamica as itemEmExecucao,
  type LaudoAnatomopatologico,
  type LaudoMama,
  MARGENS_CIRURGICAS,
  numeroRetificacao,
  QUADRANTES_MAMA,
  RECOMENDACOES_MAMA,
  RESULTADOS_ANATOMOPATOLOGICO,
  TIPOS_ACHADO_MAMA,
  TIPOS_AMOSTRA_ANATOMOPATOLOGICA,
  TIPOS_EXAME_ANATOMOPATOLOGICO,
  TIPOS_MAMOGRAFIA,
} from '@sgh/dominio-sadt';
import { ErroOperacao, garantirSequencia, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_LAUDO_MAMA_PATOLOGIA = Symbol('PORTA_LAUDO_MAMA_PATOLOGIA');

const MAMA = 'laudo_mama';
const ACHADO = 'achado_mama';
const AP = 'laudo_anatomopatologico';
const AMOSTRA = 'amostra_anatomopatologica';
const ITEM = 'exame_item';
const SEQUENCIA = 'sequencia_negocio';
const TIPO_SEQUENCIA = 'laudo_anatomopatologico';

type Linha = Record<string, unknown>;
type Tipo = 'mama' | 'anatomopatologico';

const id = z.number().int().positive();
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);
const numero = z.number().finite().nullable().default(null);
const inteiro = z.number().int().nullable().default(null);
const instante = z.string().datetime({ offset: true }).nullable().default(null);

const esquemaAchado = z
  .object({
    id: id.optional(),
    lateralidade: z.string().trim().max(30),
    quadrante: texto(30),
    tipo: z.string().trim().max(30),
    categoria: texto(5),
    tamanhoMm: numero,
    posicaoHoraria: inteiro,
    distanciaMamiloMm: numero,
    forma: texto(30),
    contorno: texto(30),
    densidade: texto(30),
    morfologiaCalcificacao: texto(60),
    distribuicaoCalcificacao: texto(30),
    correlacaoUltrassom: z.boolean().default(false),
    descricao: texto(2000),
  })
  .strict();
const esquemaMama = z
  .object({
    versao: id.optional(),
    tipoMamografia: z.string().trim().max(30),
    noduloPalpavel: z.boolean().default(false),
    historicoFamiliar: z.boolean().default(false),
    mamografiaAnterior: z.boolean().default(false),
    mamografiaAnteriorAno: inteiro,
    composicaoDireita: texto(30),
    composicaoEsquerda: texto(30),
    categoriaDireita: texto(5),
    categoriaEsquerda: texto(5),
    recomendacao: texto(30),
    intervaloControleMeses: inteiro,
    conclusao: texto(8000),
    laudista: id.nullable().default(null),
    achados: z.array(esquemaAchado).max(40).default([]),
  })
  .strict();

const esquemaAmostra = z
  .object({
    id: id.optional(),
    tipo: z.string().trim().max(30),
    identificacao: z.string().trim().max(30),
    descricao: texto(1000),
    quantidadeFragmentos: inteiro,
    dimensoes: texto(60),
    fixador: texto(60),
    coloracao: texto(60),
  })
  .strict();
const esquemaDados = z
  .object({
    margens: texto(30),
    tamanhoTumorMm: numero,
    invasaoAngiolinfatica: z.boolean().nullable().default(null),
    invasaoPerineural: z.boolean().nullable().default(null),
    linfonodosExaminados: inteiro,
    linfonodosComprometidos: inteiro,
    receptorEstrogenioPercentual: numero,
    receptorProgesteronaPercentual: numero,
    her2: texto(5),
    ki67Percentual: numero,
  })
  .strict();
const esquemaAp = z
  .object({
    versao: id.optional(),
    tipoExame: z.string().trim().max(30),
    coletaEm: instante,
    recebidoEm: instante,
    dadosClinicos: texto(4000),
    macroscopia: texto(20000),
    microscopia: texto(20000),
    diagnostico: texto(8000),
    conclusao: texto(8000),
    nota: texto(4000),
    grauHistologico: id.nullable().default(null),
    adequabilidade: texto(30),
    resultado: texto(30),
    patologista: id.nullable().default(null),
    dados: esquemaDados.optional().transform((v) => v ?? esquemaDados.parse({})),
    amostras: z.array(esquemaAmostra).max(60).default([]),
  })
  .strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaReceber = z.object({ item: id }).strict();
const esquemaRetificar = z.object({ versao: id, motivo: z.string().trim().max(500) }).strict();

/** O profissional da conta: pela mesma pessoa ou pelo vínculo vigente da conta. */
const DO_USUARIO = `(pr.pessoa_fisica_id = u.pessoa_fisica_id OR EXISTS (SELECT 1 FROM usuario_vinculo_profissional v
  WHERE v.usuario_id = u.id AND v.profissional_id = pr.id AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
    AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)))`;
/** O laudo vigente do exame: o retificado e o cancelado ficam no histórico. */
const VIGENTE = "situacao NOT IN ('retificado','cancelado') AND excluido_em IS NULL";
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaFila = z.object({ de: data, ate: data, tipo: z.enum(['mama', 'anatomopatologico']) }).strict();
const esquemaPeriodo = z.object({ de: data, ate: data }).strict();

type EntradaAchado = z.infer<typeof esquemaAchado>;
type EntradaAp = z.infer<typeof esquemaAp>;
type EntradaAmostra = z.infer<typeof esquemaAmostra>;

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();
const opcoes = (lista: readonly string[]) => lista.map((v) => ({ id: v, rotulo: v }));
const periodoValido = (p: { de: string; ate: string }) => {
  if (p.de > p.ate)
    throw recusaRegra('Período inválido', [{ campo: 'ate', mensagem: 'O fim vem antes do início.' }]);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
const achadoDeEntrada = ({ id: _id, ...a }: EntradaAchado): AchadoMama => a;
const achadoLido = (r: Linha) => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  lateralidade: String(r['lateralidade']),
  quadrante: txtOuNull(r['quadrante']),
  tipo: String(r['tipo_achado']),
  categoria: txtOuNull(r['categoria']),
  tamanhoMm: numOuNull(r['tamanho_mm']),
  posicaoHoraria: numOuNull(r['posicao_horaria']),
  distanciaMamiloMm: numOuNull(r['distancia_mamilo_mm']),
  forma: txtOuNull(r['forma']),
  contorno: txtOuNull(r['contorno']),
  densidade: txtOuNull(r['densidade']),
  morfologiaCalcificacao: txtOuNull(r['morfologia_calcificacao']),
  distribuicaoCalcificacao: txtOuNull(r['distribuicao_calcificacao']),
  correlacaoUltrassom: bool(r['correlacao_ultrassom']),
  descricao: txtOuNull(r['descricao']),
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
const semId = ({ id: _i, sequencia: _s, ...a }: ReturnType<typeof achadoLido>): AchadoMama => a;

const mamaLido = (r: Linha) => ({
  id: num(r['id']),
  versao: num(r['versao']),
  situacao: String(r['situacao']),
  liberadoEm: iso(r['liberado_em']),
  tipoMamografia: String(r['tipo_mamografia']),
  noduloPalpavel: bool(r['nodulo_palpavel']),
  historicoFamiliar: bool(r['historico_familiar_cancer']),
  mamografiaAnterior: bool(r['mamografia_anterior']),
  mamografiaAnteriorAno: numOuNull(r['mamografia_anterior_ano']),
  composicaoDireita: txtOuNull(r['composicao_mama_direita']),
  composicaoEsquerda: txtOuNull(r['composicao_mama_esquerda']),
  categoriaDireita: txtOuNull(r['cat_direita']),
  categoriaEsquerda: txtOuNull(r['cat_esquerda']),
  recomendacao: txtOuNull(r['recomendacao']),
  intervaloControleMeses: numOuNull(r['intervalo_controle_meses']),
  conclusao: txtOuNull(r['conclusao']),
  laudista: numOuNull(r['laudista_profissional_id']),
});

const SQL_MAMA = `SELECT lm.*, cd.categoria AS cat_direita, ce.categoria AS cat_esquerda FROM laudo_mama lm
  LEFT JOIN categoria_achado_mama cd ON cd.id = lm.categoria_direita_id
  LEFT JOIN categoria_achado_mama ce ON ce.id = lm.categoria_esquerda_id`;
const SQL_MAMA_PACIENTE = `SELECT lm.*, cd.categoria AS cat_direita, ce.categoria AS cat_esquerda, pf.nome AS paciente,
       pa.numero_prontuario FROM laudo_mama lm
  JOIN paciente pa ON pa.id = lm.paciente_id
  JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
  LEFT JOIN categoria_achado_mama cd ON cd.id = lm.categoria_direita_id
  LEFT JOIN categoria_achado_mama ce ON ce.id = lm.categoria_esquerda_id`;
const SQL_ACHADOS = `SELECT a.*, c.categoria FROM achado_mama a
  LEFT JOIN categoria_achado_mama c ON c.id = a.categoria_achado_mama_id`;

const amostraLida = (r: Linha) => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  tipo: String(r['tipo']),
  identificacao: String(r['identificacao']),
  descricao: txtOuNull(r['descricao']),
  quantidadeFragmentos: numOuNull(r['quantidade_fragmentos']),
  dimensoes: txtOuNull(r['dimensoes']),
  fixador: txtOuNull(r['fixador']),
  coloracao: txtOuNull(r['coloracao']),
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
const amostraDeEntrada = ({ id: _id, ...a }: EntradaAmostra): AmostraAnatomopatologica => ({
  ...a,
  identificacao: a.identificacao.toUpperCase(),
});

const dadosLidos = (v: unknown): DadosEstruturadosAnatomopatologico => {
  if (v === null || v === undefined) return {};
  const o = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return o && typeof o === 'object' ? (o as DadosEstruturadosAnatomopatologico) : {};
};

const apLido = (r: Linha) => ({
  id: num(r['id']),
  versao: num(r['versao']),
  numero: String(r['numero']),
  situacao: String(r['situacao']),
  liberadoEm: iso(r['liberado_em']),
  descricaoCirurgica: numOuNull(r['descricao_cirurgica_id']),
  tipoExame: String(r['tipo_exame']),
  coletaEm: iso(r['coleta_em']),
  recebidoEm: iso(r['recebido_laboratorio_em']),
  dadosClinicos: txtOuNull(r['dados_clinicos']),
  macroscopia: txtOuNull(r['macroscopia']),
  microscopia: txtOuNull(r['microscopia']),
  diagnostico: txtOuNull(r['diagnostico']),
  conclusao: txtOuNull(r['conclusao']),
  nota: txtOuNull(r['nota']),
  grauHistologico: numOuNull(r['grau_histologico_id']),
  adequabilidade: txtOuNull(r['adequabilidade_amostra']),
  resultado: txtOuNull(r['resultado']),
  patologista: numOuNull(r['patologista_profissional_id']),
  solicitante: numOuNull(r['solicitante_profissional_id']),
  dados: dadosLidos(r['dados_estruturados']),
});

/** O exame pedido com o paciente; o setor do item, ou o do pedido. */
const SQL_ITENS = `
  SELECT ei.id AS item, ei.situacao AS situacao_item, ei.urgente, ei.versao AS versao_item, re.numero,
         re.solicitado_em, re.paciente_id, re.atendimento_id, re.solicitante_profissional_id, sd.id AS setor_id,
         pf.nome AS paciente, pa.numero_prontuario, ex.nome AS exame, sd.nome AS setor, sd.tipo AS tipo_setor,
         mi.sigla_padrao AS modalidade
    FROM exame_item ei
    JOIN requisicao_exame re ON re.id = ei.requisicao_exame_id AND re.excluido_em IS NULL
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, re.setor_diagnostico_id)
    JOIN exame ex ON ex.id = ei.exame_id
    LEFT JOIN modalidade_imagem mi ON mi.id = ex.modalidade_imagem_id
    JOIN paciente pa ON pa.id = re.paciente_id
    JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
   WHERE re.estabelecimento_id = ? AND ei.excluido_em IS NULL`;
const FILTRO: Record<Tipo, string> = {
  mama: ` AND sd.tipo = 'imagem' AND mi.sigla_padrao = 'MG'`,
  anatomopatologico: ` AND sd.tipo = 'anatomia_patologica'`,
};
const doTipo = (i: Linha, t: Tipo) =>
  t === 'mama'
    ? i['tipo_setor'] === 'imagem' && i['modalidade'] === 'MG'
    : i['tipo_setor'] === 'anatomia_patologica';

const exameLido = (i: Linha) => ({
  item: num(i['item']),
  numero: String(i['numero']),
  solicitadoEm: iso(i['solicitado_em']),
  urgente: bool(i['urgente']),
  situacaoItem: String(i['situacao_item']),
  paciente: String(i['paciente']),
  pacienteId: num(i['paciente_id']),
  prontuario: txtOuNull(i['numero_prontuario']),
  exame: String(i['exame']),
  setor: String(i['setor']),
});

const encerrado = () =>
  new ErroOperacao(422, 'laudo-liberado', 'Laudo liberado', 'O laudo já foi liberado e não muda mais.');

export class PortaLaudoMamaPatologiaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [MAMA, ACHADO, AP, AMOSTRA, ITEM, SEQUENCIA], 'sadt.laudo-mama-patologia');
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Os exames de mamografia ou de anatomia patológica pedidos no período, com o laudo de cada um. */
  fila(c: ContextoPortaPropria, consulta: unknown) {
    const p = entradaValida(esquemaFila, consulta);
    periodoValido(p);
    return this.ler(c, 'fila', async (l, est) => {
      const laudo =
        p.tipo === 'mama'
          ? `(SELECT CONCAT_WS('|', x.id, x.situacao, COALESCE(cd.categoria, ''), COALESCE(ce.categoria, ''))
               FROM laudo_mama x LEFT JOIN categoria_achado_mama cd ON cd.id = x.categoria_direita_id
               LEFT JOIN categoria_achado_mama ce ON ce.id = x.categoria_esquerda_id
              WHERE x.exame_item_id = ei.id AND x.situacao NOT IN ('retificado','cancelado') AND x.excluido_em IS NULL LIMIT 1)`
          : `(SELECT CONCAT_WS('|', x.id, x.situacao, COALESCE(x.resultado, ''), x.numero)
               FROM laudo_anatomopatologico x WHERE x.exame_item_id = ei.id AND x.situacao NOT IN ('retificado','cancelado') AND x.excluido_em IS NULL LIMIT 1)`;
      const linhas = await l.consultar<Linha>(
        `SELECT q.*, ${laudo} AS laudo FROM (${SQL_ITENS}${FILTRO[p.tipo]}
           AND re.solicitado_em >= ? AND re.solicitado_em < DATE_ADD(?, INTERVAL 1 DAY)) q
           JOIN exame_item ei ON ei.id = q.item
          ORDER BY q.urgente DESC, q.solicitado_em, q.item LIMIT 500`,
        [est.id, p.de, p.ate],
      );
      const exames = linhas.map((r) => {
        const [lid, situacao, a, b] = r['laudo'] === null ? [] : String(r['laudo']).split('|');
        return {
          ...exameLido(r),
          laudo: lid ? Number(lid) : null,
          situacao: situacao ?? 'sem_laudo',
          categoria: p.tipo === 'mama' ? categoriaMaisGrave([a || null, b || null]) : null,
          resultado: p.tipo === 'anatomopatologico' ? a || null : null,
          numeroLaudo: p.tipo === 'anatomopatologico' ? (b ?? null) : null,
        };
      });
      return {
        de: p.de,
        ate: p.ate,
        tipo: p.tipo,
        exames: exames.filter((x) => x.laudo !== null || itemEmExecucao(x.situacaoItem)),
      };
    });
  }

  /** O exame de mamografia, o laudo com os achados, os laudos anteriores da paciente e as opções. */
  abrirMama(c: ContextoPortaPropria, item: number) {
    return this.ler(c, 'abrir-mama', async (l, est) => {
      const i = await this.item(l, est.id, item, 'mama');
      const [reg] = await l.consultar<Linha>(
        `${SQL_MAMA} WHERE lm.exame_item_id = ? AND lm.situacao NOT IN ('retificado','cancelado') AND lm.excluido_em IS NULL`,
        [item],
      );
      const laudo = reg ? mamaLido(reg) : null;
      const achados = laudo ? await this.achados(l, laudo.id) : [];
      const corrigidos = laudo
        ? num(
            (
              await l.uma(
                'SELECT COUNT(*) AS n FROM achado_mama WHERE laudo_mama_id = ? AND excluido_em IS NOT NULL',
                [laudo.id],
              )
            )?.['n'],
          )
        : 0;
      const anteriores = (
        await l.consultar<Linha>(
          `${SQL_MAMA} WHERE lm.paciente_id = ? AND lm.exame_item_id <> ? AND lm.situacao = 'liberado'
              AND lm.excluido_em IS NULL ORDER BY lm.liberado_em DESC LIMIT 20`,
          [num(i['paciente_id']), item],
        )
      ).map((r) => {
        const m = mamaLido(r);
        return {
          id: m.id,
          liberadoEm: m.liberadoEm,
          categoriaDireita: m.categoriaDireita,
          categoriaEsquerda: m.categoriaEsquerda,
          recomendacao: m.recomendacao,
        };
      });
      return {
        exame: exameLido(i),
        laudo,
        achados,
        achadosCorrigidos: corrigidos,
        anteriores,
        retificados: await this.retificados(l, MAMA, item),
        emExecucao: itemEmExecucao(String(i['situacao_item'])),
        alertas: laudo ? alertasLaudoMama(laudo) : [],
        opcoes: {
          assinante: (await this.assinante(l, c.usuario))?.profissional ?? null,
          profissionais: await this.profissionais(l),
          categorias: CATEGORIAS_MAMA.map((k) => ({ ...k })),
          tipos: opcoes(TIPOS_MAMOGRAFIA),
          composicoes: opcoes(COMPOSICOES_MAMA),
          recomendacoes: opcoes(RECOMENDACOES_MAMA),
          quadrantes: opcoes(QUADRANTES_MAMA),
          tiposAchado: opcoes(TIPOS_ACHADO_MAMA),
          formas: opcoes(FORMAS_ACHADO_MAMA),
          contornos: opcoes(CONTORNOS_ACHADO_MAMA),
          densidades: opcoes(DENSIDADES_ACHADO_MAMA),
          distribuicoes: opcoes(DISTRIBUICOES_CALCIFICACAO),
        },
      };
    });
  }

  /** O exame de anatomia patológica, o laudo com as amostras, os laudos anteriores do paciente e as opções. */
  abrirAnatomopatologico(c: ContextoPortaPropria, item: number) {
    return this.ler(c, 'abrir-ap', async (l, est) => {
      const i = await this.item(l, est.id, item, 'anatomopatologico');
      const reg = await l.uma(
        `SELECT * FROM laudo_anatomopatologico WHERE exame_item_id = ? AND ${VIGENTE}`,
        [item],
      );
      const laudo = reg ? apLido(reg) : null;
      const amostras = laudo ? await this.amostras(l, laudo.id) : [];
      const anteriores = (
        await l.consultar<Linha>(
          `SELECT id, numero, tipo_exame, resultado, liberado_em FROM laudo_anatomopatologico
            WHERE paciente_id = ? AND exame_item_id <> ? AND situacao = 'liberado' AND excluido_em IS NULL
            ORDER BY liberado_em DESC LIMIT 20`,
          [num(i['paciente_id']), item],
        )
      ).map((r) => ({
        id: num(r['id']),
        numero: String(r['numero']),
        tipoExame: String(r['tipo_exame']),
        resultado: txtOuNull(r['resultado']),
        liberadoEm: iso(r['liberado_em']),
      }));
      const graus = (
        await l.consultar<Linha>(
          `SELECT id, codigo, descricao, sistema_graduacao FROM grau_histologico WHERE ativo = TRUE
            ORDER BY ordem, codigo`,
        )
      ).map((r) => ({
        id: num(r['id']),
        rotulo: `${String(r['descricao'])}${r['sistema_graduacao'] ? ` (${String(r['sistema_graduacao'])})` : ''}`,
      }));
      return {
        exame: exameLido(i),
        laudo,
        amostras,
        anteriores,
        retificados: await this.retificados(l, AP, item),
        emExecucao: itemEmExecucao(String(i['situacao_item'])),
        alertas: laudo ? alertasLaudoAnatomopatologico(laudo) : [],
        opcoes: {
          assinante: (await this.assinante(l, c.usuario))?.profissional ?? null,
          profissionais: await this.profissionais(l),
          graus,
          tiposExame: opcoes(TIPOS_EXAME_ANATOMOPATOLOGICO),
          adequabilidades: opcoes(ADEQUABILIDADES_AMOSTRA),
          resultados: opcoes(RESULTADOS_ANATOMOPATOLOGICO),
          tiposAmostra: opcoes(TIPOS_AMOSTRA_ANATOMOPATOLOGICA),
          margens: opcoes(MARGENS_CIRURGICAS),
          her2: opcoes(HER2_ESCORES),
        },
      };
    });
  }

  /** As peças enviadas pela cirurgia no período ainda sem laudo, com os pedidos abertos do mesmo paciente. */
  pecasEnviadas(c: ContextoPortaPropria, consulta: unknown) {
    const p = entradaValida(esquemaPeriodo, consulta);
    periodoValido(p);
    return this.ler(c, 'pecas', async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT dc.id, dc.descricao_pecas, dc.situacao, ac.numero AS cirurgia, ac.paciente_id,
                COALESCE(ac.fim_cirurgia_em, ac.inicio_cirurgia_em, dc.criado_em) AS realizada_em,
                pf.nome AS paciente, pa.numero_prontuario, cpf.nome AS cirurgiao
           FROM descricao_cirurgica dc
           JOIN ato_cirurgico ac ON ac.id = dc.ato_cirurgico_id
           JOIN paciente pa ON pa.id = ac.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           JOIN profissional cp ON cp.id = dc.cirurgiao_profissional_id
           JOIN pessoa_fisica cpf ON cpf.id = cp.pessoa_fisica_id
          WHERE ac.estabelecimento_id = ? AND dc.envio_anatomopatologico = TRUE AND dc.excluido_em IS NULL
            AND COALESCE(ac.fim_cirurgia_em, ac.inicio_cirurgia_em, dc.criado_em) >= ?
            AND COALESCE(ac.fim_cirurgia_em, ac.inicio_cirurgia_em, dc.criado_em) < DATE_ADD(?, INTERVAL 1 DAY)
            AND NOT EXISTS (SELECT 1 FROM laudo_anatomopatologico x
                             WHERE x.descricao_cirurgica_id = dc.id AND x.excluido_em IS NULL)
          ORDER BY realizada_em, dc.id LIMIT 300`,
        [est.id, p.de, p.ate],
      );
      const pacientes = [...new Set(linhas.map((r) => num(r['paciente_id'])))];
      const pedidos = pacientes.length
        ? await l.consultar<Linha>(
            `SELECT q.* FROM (${SQL_ITENS}${FILTRO.anatomopatologico}
               AND re.paciente_id IN (${pacientes.map(() => '?').join(', ')})) q
              WHERE NOT EXISTS (SELECT 1 FROM laudo_anatomopatologico x
                                 WHERE x.exame_item_id = q.item AND x.situacao NOT IN ('retificado','cancelado') AND x.excluido_em IS NULL)
              ORDER BY q.solicitado_em DESC LIMIT 1000`,
            [est.id, ...pacientes],
          )
        : [];
      return {
        de: p.de,
        ate: p.ate,
        pecas: linhas.map((r) => ({
          descricao: num(r['id']),
          cirurgia: String(r['cirurgia']),
          realizadaEm: iso(r['realizada_em']),
          paciente: String(r['paciente']),
          prontuario: txtOuNull(r['numero_prontuario']),
          cirurgiao: String(r['cirurgiao']),
          pecas: txtOuNull(r['descricao_pecas']),
          pedidos: pedidos
            .filter(
              (x) =>
                num(x['paciente_id']) === num(r['paciente_id']) && itemEmExecucao(String(x['situacao_item'])),
            )
            .map((x) => ({ item: num(x['item']), numero: String(x['numero']), exame: String(x['exame']) })),
        })),
      };
    });
  }

  /** Os laudos de mamografia liberados no período, na ficha de campos do resultado de mamografia do SISCAN. */
  siscanMamografia(c: ContextoPortaPropria, consulta: unknown) {
    const p = entradaValida(esquemaPeriodo, consulta);
    periodoValido(p);
    return this.ler(c, 'siscan', async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `${SQL_MAMA_PACIENTE}
          WHERE lm.estabelecimento_id = ? AND lm.situacao = 'liberado' AND lm.excluido_em IS NULL
            AND lm.liberado_em >= ? AND lm.liberado_em < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY lm.liberado_em, lm.id LIMIT 2000`,
        [est.id, p.de, p.ate],
      );
      const fichas = [];
      for (const r of linhas) {
        const m = mamaLido(r);
        const achados = (await this.achados(l, m.id)).map(semId);
        fichas.push({
          laudo: m.id,
          paciente: String(r['paciente']),
          prontuario: txtOuNull(r['numero_prontuario']),
          ...fichaSiscanMamografia({ ...m, achados }),
        });
      }
      return { de: p.de, ate: p.ate, fichas };
    });
  }

  // ── Gravações ────────────────────────────────────────────────────────────────────────────────────────────

  /** Cria o laudo de mamografia em rascunho (um por item) ou altera o rascunho pela versão lida. */
  async salvarMama(c: ContextoPortaPropria, item: number, entrada: unknown) {
    const e = entradaValida(esquemaMama, entrada);
    const achados = e.achados.map(achadoDeEntrada);
    const problemas = conferirLaudoMama({ ...e, achados }, 'rascunho', new Date().getUTCFullYear());
    if (problemas.length) throw recusaRegra('Laudo de mamografia recusado', problemas);
    return this.gravar(c, 'sadt.laudo-mama.salvar', [MAMA, ACHADO], async (tx, est, usuario) => {
      const i = await this.itemParaGravar(tx, est.id, item, 'mama');
      const categorias = await this.idsCategorias(tx);
      const cat = (v: string | null) => (v === null ? null : (categorias.get(v) ?? null));
      if (
        [e.categoriaDireita, e.categoriaEsquerda, ...achados.map((a) => a.categoria)].some(
          (v) => v && !cat(v),
        )
      )
        throw naoEncontrado('Categoria do laudo mamário');
      if (e.laudista !== null) await this.profissionalExiste(tx, e.laudista);
      const colunas = {
        tipo_mamografia: e.tipoMamografia,
        nodulo_palpavel: e.noduloPalpavel,
        historico_familiar_cancer: e.historicoFamiliar,
        mamografia_anterior: e.mamografiaAnterior,
        mamografia_anterior_ano: e.mamografiaAnteriorAno,
        composicao_mama_direita: e.composicaoDireita,
        composicao_mama_esquerda: e.composicaoEsquerda,
        categoria_direita_id: cat(e.categoriaDireita),
        categoria_esquerda_id: cat(e.categoriaEsquerda),
        recomendacao: e.recomendacao,
        intervalo_controle_meses: e.intervaloControleMeses,
        conclusao: e.conclusao,
        laudista_profissional_id: e.laudista,
      };
      const [atual] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, situacao, versao FROM laudo_mama WHERE exame_item_id = ? AND ${VIGENTE}`,
        [item],
      );
      let laudo: number;
      let versao: number;
      if (!atual) {
        if (e.versao !== undefined) throw naoEncontrado('Laudo de mamografia');
        laudo = await tx.incluir(MAMA, {
          estabelecimento_id: est.id,
          exame_item_id: item,
          paciente_id: num(i['paciente_id']),
          atendimento_id: numOuNull(i['atendimento_id']),
          situacao: 'rascunho',
          ...colunas,
        });
        versao = 1;
      } else {
        if (atual['situacao'] !== 'rascunho') throw encerrado();
        if (e.versao === undefined)
          throw new ErroOperacao(
            409,
            'laudo-existente',
            'Laudo já aberto',
            'Este exame já tem laudo: abra o existente.',
          );
        laudo = num(atual['id']);
        versao = await tx.alterar(MAMA, laudo, e.versao, colunas);
      }
      const r = await this.gravarAchados(tx, laudo, e.achados, categorias, usuario);
      return { tabela: MAMA, id: laudo, versao, ...r };
    });
  }

  /** Libera o laudo de mamografia completo e marca o exame pedido como realizado. */
  async liberarMama(c: ContextoPortaPropria, laudo: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'sadt.laudo-mama.liberar', [MAMA, ITEM], async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar<Linha>(
        `${SQL_MAMA} WHERE lm.id = ? AND lm.estabelecimento_id = ? AND lm.excluido_em IS NULL`,
        [laudo, est.id],
      );
      if (!r) throw naoEncontrado('Laudo de mamografia');
      if (r['situacao'] !== 'rascunho') throw encerrado();
      const lido = mamaLido(r);
      const autor = await this.autor(tx, c.usuario, lido.laudista, 'laudista');
      const m = { ...lido, laudista: autor };
      const achados = (await this.achados(tx, laudo)).map(semId);
      const l: LaudoMama = { ...m, achados };
      const problemas = conferirLaudoMama(l, 'liberar', new Date().getUTCFullYear());
      if (problemas.length) throw recusaRegra('Laudo de mamografia incompleto', problemas);
      const agora = new Date();
      const versao = await tx.alterar(MAMA, laudo, e.versao, {
        situacao: 'liberado',
        liberado_em: agora,
        laudista_profissional_id: autor,
      });
      await this.marcarRealizado(tx, num(r['exame_item_id']), agora, usuario, m.laudista);
      return { tabela: MAMA, id: laudo, versao, alertas: alertasLaudoMama(l) };
    });
  }

  /** Cria o laudo anatomopatológico em rascunho (número pela sequência) ou altera o rascunho pela versão lida. */
  async salvarAnatomopatologico(c: ContextoPortaPropria, item: number, entrada: unknown) {
    const e = entradaValida(esquemaAp, entrada);
    const amostras = e.amostras.map(amostraDeEntrada);
    const problemas = conferirLaudoAnatomopatologico({ ...e, amostras }, 'rascunho');
    if (problemas.length) throw recusaRegra('Laudo anatomopatológico recusado', problemas);
    return this.gravar(c, 'sadt.laudo-ap.salvar', [AP, AMOSTRA, SEQUENCIA], async (tx, est, usuario) => {
      const i = await this.itemParaGravar(tx, est.id, item, 'anatomopatologico');
      if (e.patologista !== null) await this.profissionalExiste(tx, e.patologista);
      if (e.grauHistologico !== null) {
        const g = await tx.uma('SELECT id FROM grau_histologico WHERE id = ? AND ativo = TRUE', [
          e.grauHistologico,
        ]);
        if (!g) throw naoEncontrado('Grau histológico');
      }
      const colunas = this.colunasAp(e);
      const [atual] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, situacao FROM laudo_anatomopatologico WHERE exame_item_id = ? AND ${VIGENTE}`,
        [item],
      );
      let laudo: number;
      let versao: number;
      let numeroLaudo: string | null = null;
      if (!atual) {
        if (e.versao !== undefined) throw naoEncontrado('Laudo anatomopatológico');
        const n = await this.numeroLaudo(tx, est.id, usuario);
        numeroLaudo = n;
        laudo = await tx.incluir(AP, {
          estabelecimento_id: est.id,
          exame_item_id: item,
          paciente_id: num(i['paciente_id']),
          atendimento_id: numOuNull(i['atendimento_id']),
          setor_diagnostico_id: num(i['setor_id']),
          numero: n,
          solicitante_profissional_id: numOuNull(i['solicitante_profissional_id']),
          situacao: 'rascunho',
          ...colunas,
        });
        versao = 1;
      } else {
        if (atual['situacao'] !== 'rascunho' && atual['situacao'] !== 'em_revisao') throw encerrado();
        if (e.versao === undefined)
          throw new ErroOperacao(
            409,
            'laudo-existente',
            'Laudo já aberto',
            'Este exame já tem laudo: abra o existente.',
          );
        laudo = num(atual['id']);
        versao = await tx.alterar(AP, laudo, e.versao, colunas);
      }
      const r = await this.gravarAmostras(tx, laudo, e.amostras, usuario);
      return { tabela: AP, id: laudo, versao, numero: numeroLaudo, ...r };
    });
  }

  /** Libera o laudo anatomopatológico completo (com quem e quando) e marca o exame pedido como realizado. */
  async liberarAnatomopatologico(c: ContextoPortaPropria, laudo: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'sadt.laudo-ap.liberar', [AP, ITEM], async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM laudo_anatomopatologico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [laudo, est.id],
      );
      if (!r) throw naoEncontrado('Laudo anatomopatológico');
      if (r['situacao'] !== 'rascunho' && r['situacao'] !== 'em_revisao') throw encerrado();
      const lido = apLido(r);
      const autor = await this.autor(tx, c.usuario, lido.patologista, 'patologista');
      const a = { ...lido, patologista: autor };
      const amostras = (await this.amostras(tx, laudo)).map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
        ({ id: _i, sequencia: _s, ...x }): AmostraAnatomopatologica => x,
      );
      const l: LaudoAnatomopatologico = { ...a, amostras };
      const problemas = conferirLaudoAnatomopatologico(l, 'liberar');
      if (problemas.length) throw recusaRegra('Laudo anatomopatológico incompleto', problemas);
      const agora = new Date();
      const versao = await tx.alterar(AP, laudo, e.versao, {
        situacao: 'liberado',
        liberado_em: agora,
        liberado_por_usuario_id: usuario,
        patologista_profissional_id: autor,
      });
      await this.marcarRealizado(tx, num(r['exame_item_id']), agora, usuario, a.patologista);
      return { tabela: AP, id: laudo, versao, alertas: alertasLaudoAnatomopatologico(l) };
    });
  }

  /** Retifica o laudo de mamografia liberado: ele vai ao histórico e um rascunho novo, ligado a ele, o substitui. */
  async retificarMama(c: ContextoPortaPropria, laudo: number, entrada: unknown) {
    const e = entradaValida(esquemaRetificar, entrada);
    return this.gravar(c, 'sadt.laudo-mama.retificar', [MAMA, ACHADO], async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM laudo_mama WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [laudo, est.id],
      );
      if (!r) throw naoEncontrado('Laudo de mamografia');
      const problemas = conferirRetificacaoEspecializado(String(r['situacao']), e.motivo);
      if (problemas.length) throw recusaRegra('Retificação recusada', problemas);
      const autor = await this.autor(tx, c.usuario, null, 'laudista');
      const agora = new Date();
      await tx.alterar(MAMA, laudo, e.versao, {
        situacao: 'retificado',
        motivo_retificacao: e.motivo,
        retificado_em: agora,
        retificado_por_usuario_id: usuario,
      });
      const copia = Object.fromEntries(
        [
          'estabelecimento_id',
          'exame_item_id',
          'paciente_id',
          'atendimento_id',
          'tipo_mamografia',
          'nodulo_palpavel',
          'historico_familiar_cancer',
          'mamografia_anterior',
          'mamografia_anterior_ano',
          'anamnese',
          'composicao_mama_direita',
          'composicao_mama_esquerda',
          'categoria_direita_id',
          'categoria_esquerda_id',
          'recomendacao',
          'intervalo_controle_meses',
          'conclusao',
        ].map((k) => [k, r[k] ?? null]),
      );
      const novo = await tx.incluir(MAMA, {
        ...copia,
        laudo_retificado_id: laudo,
        laudista_profissional_id: autor,
        situacao: 'rascunho',
      });
      const achados = await tx.consultar<Linha>(
        'SELECT * FROM achado_mama WHERE laudo_mama_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [laudo],
      );
      let sequencia = 0;
      for (const a of achados) {
        const campos = Object.fromEntries(
          Object.entries(a).filter(
            ([k]) =>
              !['id', 'laudo_mama_id', 'sequencia', 'versao'].includes(k) &&
              !/^(criado|alterado|excluido)_/.test(k),
          ),
        );
        await tx.incluir(ACHADO, { ...campos, laudo_mama_id: novo, sequencia: ++sequencia });
      }
      return { tabela: MAMA, id: novo, versao: 1, retificado: laudo, achados: sequencia };
    });
  }

  /** Retifica o laudo anatomopatológico liberado: o mesmo número com a ordem (AP-1-R1), amostras copiadas. */
  async retificarAnatomopatologico(c: ContextoPortaPropria, laudo: number, entrada: unknown) {
    const e = entradaValida(esquemaRetificar, entrada);
    return this.gravar(c, 'sadt.laudo-ap.retificar', [AP, AMOSTRA], async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM laudo_anatomopatologico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [laudo, est.id],
      );
      if (!r) throw naoEncontrado('Laudo anatomopatológico');
      const problemas = conferirRetificacaoEspecializado(String(r['situacao']), e.motivo);
      if (problemas.length) throw recusaRegra('Retificação recusada', problemas);
      const autor = await this.autor(tx, c.usuario, null, 'patologista');
      const ordem = num(
        (
          await tx.uma(
            "SELECT COUNT(*) AS n FROM laudo_anatomopatologico WHERE exame_item_id = ? AND situacao = 'retificado'",
            [num(r['exame_item_id'])],
          )
        )?.['n'],
      );
      const agora = new Date();
      await tx.alterar(AP, laudo, e.versao, {
        situacao: 'retificado',
        motivo_retificacao: e.motivo,
        retificado_em: agora,
        retificado_por_usuario_id: usuario,
      });
      const copia = Object.fromEntries(
        [
          'estabelecimento_id',
          'exame_item_id',
          'paciente_id',
          'atendimento_id',
          'descricao_cirurgica_id',
          'setor_diagnostico_id',
          'tipo_exame',
          'solicitante_profissional_id',
          'coleta_em',
          'recebido_laboratorio_em',
          'dados_clinicos',
          'macroscopia',
          'microscopia',
          'diagnostico',
          'conclusao',
          'nota',
          'topografia_termo_id',
          'morfologia_termo_id',
          'diagnostico_termo_id',
          'grau_histologico_id',
          'adequabilidade_amostra',
          'resultado',
          'dados_estruturados',
        ].map((k) => [k, r[k] ?? null]),
      );
      if (copia['dados_estruturados'] !== null && typeof copia['dados_estruturados'] === 'object')
        copia['dados_estruturados'] = JSON.stringify(copia['dados_estruturados']);
      const numero = numeroRetificacao(String(r['numero']), ordem + 1);
      const novo = await tx.incluir(AP, {
        ...copia,
        numero,
        laudo_retificado_id: laudo,
        patologista_profissional_id: autor,
        situacao: 'rascunho',
      });
      const amostras = await tx.consultar<Linha>(
        'SELECT * FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [laudo],
      );
      let sequencia = 0;
      for (const a of amostras) {
        const campos = Object.fromEntries(
          Object.entries(a).filter(
            ([k]) =>
              !['id', 'laudo_anatomopatologico_id', 'sequencia', 'versao'].includes(k) &&
              !/^(criado|alterado|excluido)_/.test(k),
          ),
        );
        await tx.incluir(AMOSTRA, { ...campos, laudo_anatomopatologico_id: novo, sequencia: ++sequencia });
      }
      return { tabela: AP, id: novo, versao: 1, numero, retificado: laudo, amostras: sequencia };
    });
  }

  /** Recebe a peça enviada pela cirurgia: cria o laudo em rascunho no pedido escolhido, ligado à descrição. */
  async receberPeca(c: ContextoPortaPropria, descricao: number, entrada: unknown) {
    const e = entradaValida(esquemaReceber, entrada);
    return this.gravar(c, 'sadt.laudo-ap.receber', [AP, AMOSTRA, SEQUENCIA], async (tx, est, usuario) => {
      const [d] = await tx.consultarParaAtualizar<Linha>(
        `SELECT dc.id, dc.envio_anatomopatologico, dc.descricao_pecas, dc.cirurgiao_profissional_id,
                ac.paciente_id, ac.diagnostico_pre_operatorio,
                COALESCE(ac.fim_cirurgia_em, ac.inicio_cirurgia_em) AS coleta
           FROM descricao_cirurgica dc JOIN ato_cirurgico ac ON ac.id = dc.ato_cirurgico_id
          WHERE dc.id = ? AND ac.estabelecimento_id = ? AND dc.excluido_em IS NULL`,
        [descricao, est.id],
      );
      if (!d || !bool(d['envio_anatomopatologico'])) throw naoEncontrado('Peça enviada pela cirurgia');
      const ja = await tx.uma(
        'SELECT id FROM laudo_anatomopatologico WHERE descricao_cirurgica_id = ? AND excluido_em IS NULL',
        [descricao],
      );
      if (ja)
        throw new ErroOperacao(
          409,
          'peca-recebida',
          'Peça já recebida',
          'A peça desta cirurgia já tem laudo.',
        );
      const i = await this.itemParaGravar(tx, est.id, e.item, 'anatomopatologico');
      if (num(i['paciente_id']) !== num(d['paciente_id']))
        throw recusaRegra('Pedido de outro paciente', [
          { campo: 'item', mensagem: 'O pedido escolhido é de outro paciente.' },
        ]);
      const doItem = await tx.uma(
        `SELECT id FROM laudo_anatomopatologico WHERE exame_item_id = ? AND ${VIGENTE}`,
        [e.item],
      );
      if (doItem)
        throw new ErroOperacao(
          409,
          'laudo-existente',
          'Laudo já aberto',
          'Este pedido já tem laudo: escolha outro.',
        );
      const agora = new Date();
      const coleta = d['coleta'] === null ? null : new Date(iso(d['coleta'])!);
      const n = await this.numeroLaudo(tx, est.id, usuario);
      const laudo = await tx.incluir(AP, {
        estabelecimento_id: est.id,
        exame_item_id: e.item,
        paciente_id: num(i['paciente_id']),
        atendimento_id: numOuNull(i['atendimento_id']),
        descricao_cirurgica_id: descricao,
        setor_diagnostico_id: num(i['setor_id']),
        numero: n,
        tipo_exame: 'histopatologia',
        solicitante_profissional_id: num(d['cirurgiao_profissional_id']),
        coleta_em: coleta && coleta <= agora ? coleta : null,
        recebido_laboratorio_em: agora,
        dados_clinicos: txtOuNull(d['diagnostico_pre_operatorio']),
        situacao: 'rascunho',
      });
      await tx.incluir(AMOSTRA, {
        laudo_anatomopatologico_id: laudo,
        sequencia: 1,
        tipo: 'peca',
        identificacao: 'A',
        descricao: txtOuNull(d['descricao_pecas']),
        recebida_em: agora,
        situacao: 'recebida',
      });
      return { tabela: AP, id: laudo, numero: n, item: e.item };
    });
  }

  // ── Apoio ────────────────────────────────────────────────────────────────────────────────────────────────

  private colunasAp(e: EntradaAp) {
    return {
      tipo_exame: e.tipoExame,
      coleta_em: e.coletaEm ? new Date(e.coletaEm) : null,
      recebido_laboratorio_em: e.recebidoEm ? new Date(e.recebidoEm) : null,
      dados_clinicos: e.dadosClinicos,
      macroscopia: e.macroscopia,
      microscopia: e.microscopia,
      diagnostico: e.diagnostico,
      conclusao: e.conclusao,
      nota: e.nota,
      grau_histologico_id: e.grauHistologico,
      adequabilidade_amostra: e.adequabilidade,
      resultado: e.resultado,
      patologista_profissional_id: e.patologista,
      dados_estruturados: JSON.stringify(e.dados),
    };
  }

  private async numeroLaudo(tx: TxOperacao, estabelecimento: number, usuario: number): Promise<string> {
    await garantirSequencia(
      tx,
      { tipo: TIPO_SEQUENCIA, estabelecimento, prefixo: 'AP' },
      { agora: new Date(), usuario },
    );
    return (await tx.proximoNumero(TIPO_SEQUENCIA)).formatado;
  }

  private async item(l: Leitor, est: number, item: number, tipo: Tipo): Promise<Linha> {
    const [i] = await l.consultar<Linha>(`${SQL_ITENS} AND ei.id = ?`, [est, item]);
    if (!i || !doTipo(i, tipo))
      throw naoEncontrado(tipo === 'mama' ? 'Exame de mamografia' : 'Exame de anatomia patológica');
    return i;
  }

  /** O item em execução, travado; outro setor, outro estabelecimento ou pedido cancelado é recusado. */
  private async itemParaGravar(tx: TxOperacao, est: number, item: number, tipo: Tipo): Promise<Linha> {
    const [i] = await tx.consultarParaAtualizar<Linha>(`${SQL_ITENS} AND ei.id = ?`, [est, item]);
    if (!i || !doTipo(i, tipo))
      throw naoEncontrado(tipo === 'mama' ? 'Exame de mamografia' : 'Exame de anatomia patológica');
    if (!itemEmExecucao(String(i['situacao_item'])))
      throw recusaRegra('Exame fora de execução', [
        { campo: 'item', mensagem: 'O exame foi cancelado ou recusado: não recebe laudo.' },
      ]);
    return i;
  }

  private async marcarRealizado(
    tx: TxOperacao,
    item: number,
    agora: Date,
    usuario: number,
    executante: number | null,
  ): Promise<void> {
    const [i] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, realizado_em, executante_profissional_id FROM exame_item WHERE id = ?',
      [item],
    );
    if (i && i['realizado_em'] === null)
      await tx.alterar(ITEM, num(i['id']), num(i['versao']), {
        realizado_em: agora,
        realizado_por_usuario_id: usuario,
        executante_profissional_id: numOuNull(i['executante_profissional_id']) ?? executante,
      });
  }

  private async profissionais(l: Leitor) {
    return (
      await l.consultar<Linha>(
        `SELECT p.id, pf.nome AS rotulo FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.situacao = 'ativo' AND p.excluido_em IS NULL ORDER BY pf.nome LIMIT 3000`,
      )
    ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) }));
  }

  /** O vínculo profissional da conta que assina (o de médico com inscrição ativa primeiro). */
  private async assinante(l: Leitor, usuario: number | null): Promise<AutorLaudo | null> {
    if (usuario === null) return null;
    const vs = await l.consultar<Linha>(
      `SELECT pr.id, COALESCE(oc.codigo_cbo, '') AS cbo, (ic.situacao = 'ativa' AND pr.situacao = 'ativo') AS ativo
         FROM usuario u
         JOIN profissional pr ON pr.excluido_em IS NULL AND ${DO_USUARIO}
         JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
         LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
        WHERE u.id = ? AND u.excluido_em IS NULL ORDER BY ic.principal DESC, ic.id`,
      [usuario],
    );
    const lista = vs.map((r) => ({
      profissional: num(r['id']),
      cbo: String(r['cbo']),
      conselhoAtivo: Boolean(num(r['ativo'])),
    }));
    return lista.find((v) => v.conselhoAtivo && ehMedico(v.cbo)) ?? lista[0] ?? null;
  }

  /** Quem assina: o médico da sessão com inscrição ativa; o rascunho que indica outro profissional é recusado. */
  private async autor(
    tx: TxOperacao,
    usuario: number | null,
    indicado: number | null,
    campo: 'laudista' | 'patologista',
  ): Promise<number> {
    const v = await this.assinante(tx, usuario);
    const problemas = conferirAutorLaudo(v, indicado, campo);
    if (problemas.length) throw recusaRegra('Assinatura recusada', problemas);
    return v!.profissional;
  }

  /** Os laudos retificados do mesmo exame, do mais recente ao mais antigo (histórico; nada se apaga). */
  private async retificados(l: Leitor, tabela: typeof MAMA | typeof AP, item: number) {
    const sql =
      tabela === MAMA
        ? `SELECT id, liberado_em, retificado_em, motivo_retificacao FROM laudo_mama
            WHERE exame_item_id = ? AND situacao = 'retificado' AND excluido_em IS NULL ORDER BY retificado_em DESC`
        : `SELECT id, liberado_em, retificado_em, motivo_retificacao FROM laudo_anatomopatologico
            WHERE exame_item_id = ? AND situacao = 'retificado' AND excluido_em IS NULL ORDER BY retificado_em DESC`;
    return (await l.consultar<Linha>(sql, [item])).map((r) => ({
      id: num(r['id']),
      liberadoEm: iso(r['liberado_em']),
      retificadoEm: iso(r['retificado_em']),
      motivo: txtOuNull(r['motivo_retificacao']),
    }));
  }

  private async profissionalExiste(tx: TxOperacao, profissional: number): Promise<void> {
    const p = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
      profissional,
    ]);
    if (!p) throw naoEncontrado('Profissional');
  }

  private async idsCategorias(l: Leitor): Promise<Map<string, number>> {
    const linhas = await l.consultar<Linha>(
      'SELECT id, categoria FROM categoria_achado_mama WHERE ativo = TRUE',
    );
    return new Map(linhas.map((r) => [String(r['categoria']), num(r['id'])]));
  }

  private async achados(l: Leitor, laudo: number) {
    return (
      await l.consultar<Linha>(
        `${SQL_ACHADOS} WHERE a.laudo_mama_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
        [laudo],
      )
    ).map(achadoLido);
  }

  private async amostras(l: Leitor, laudo: number) {
    return (
      await l.consultar<Linha>(
        `SELECT * FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id = ? AND excluido_em IS NULL
          ORDER BY sequencia`,
        [laudo],
      )
    ).map(amostraLida);
  }

  private async gravarAchados(
    tx: TxOperacao,
    laudo: number,
    entrada: readonly EntradaAchado[],
    categorias: Map<string, number>,
    usuario: number,
  ): Promise<{ achadosIncluidos: number; achadosRetirados: number }> {
    const vigentes = await tx.consultarParaAtualizar<Linha>(
      `${SQL_ACHADOS} WHERE a.laudo_mama_id = ? AND a.excluido_em IS NULL`,
      [laudo],
    );
    const ultima = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM achado_mama WHERE laudo_mama_id = ?',
      [laudo],
    );
    let sequencia = num(ultima?.['s']);
    const porId = new Map(vigentes.map((v) => [num(v['id']), v]));
    for (const a of entrada)
      if (a.id !== undefined && !porId.has(a.id)) throw naoEncontrado('Achado do laudo');
    const ficam = new Set<number>();
    const novos: AchadoMama[] = [];
    for (const a of entrada) {
      const nov = achadoDeEntrada(a);
      const antigo = a.id === undefined ? undefined : porId.get(a.id);
      if (antigo && !achadoMamaMudou(semId(achadoLido(antigo)), nov)) ficam.add(num(antigo['id']));
      else novos.push(nov);
    }
    const agora = new Date();
    let retirados = 0;
    for (const v of vigentes) {
      if (ficam.has(num(v['id']))) continue;
      await tx.alterar(ACHADO, num(v['id']), num(v['versao']), { excluido_em: agora, excluido_por: usuario });
      retirados++;
    }
    for (const a of novos)
      await tx.incluir(ACHADO, {
        laudo_mama_id: laudo,
        sequencia: ++sequencia,
        lateralidade: a.lateralidade,
        quadrante: a.quadrante,
        tipo_achado: a.tipo,
        categoria_achado_mama_id: a.categoria === null ? null : (categorias.get(a.categoria) ?? null),
        tamanho_mm: a.tamanhoMm,
        posicao_horaria: a.posicaoHoraria,
        distancia_mamilo_mm: a.distanciaMamiloMm,
        forma: a.forma,
        contorno: a.contorno,
        densidade: a.densidade,
        morfologia_calcificacao: a.morfologiaCalcificacao,
        distribuicao_calcificacao: a.distribuicaoCalcificacao,
        correlacao_ultrassom: a.correlacaoUltrassom,
        descricao: a.descricao,
      });
    return { achadosIncluidos: novos.length, achadosRetirados: retirados };
  }

  /** Amostras: alteradas no lugar (a trilha guarda o antes), a retirada marcada e a reaparecida reativada. */
  private async gravarAmostras(
    tx: TxOperacao,
    laudo: number,
    entrada: readonly EntradaAmostra[],
    usuario: number,
  ): Promise<{ amostrasIncluidas: number; amostrasAlteradas: number; amostrasRetiradas: number }> {
    const todas = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id = ?',
      [laudo],
    );
    const porIdent = new Map(todas.map((v) => [String(v['identificacao']).toUpperCase(), v]));
    let sequencia = todas.reduce((m, v) => Math.max(m, num(v['sequencia'])), 0);
    const colunas = (a: AmostraAnatomopatologica) => ({
      tipo: a.tipo,
      identificacao: a.identificacao,
      descricao: a.descricao,
      quantidade_fragmentos: a.quantidadeFragmentos,
      dimensoes: a.dimensoes,
      fixador: a.fixador,
      coloracao: a.coloracao,
    });
    const ficam = new Set<number>();
    let incluidas = 0;
    let alteradas = 0;
    for (const bruta of entrada) {
      const a = amostraDeEntrada(bruta);
      const porIdEntrada = bruta.id === undefined ? undefined : todas.find((v) => num(v['id']) === bruta.id);
      if (bruta.id !== undefined && (!porIdEntrada || porIdEntrada['excluido_em'] !== null))
        throw naoEncontrado('Amostra do laudo');
      const dona = porIdent.get(a.identificacao);
      if (porIdEntrada && dona && num(dona['id']) !== num(porIdEntrada['id']))
        throw recusaRegra('Amostra repetida', [
          {
            campo: 'amostras',
            mensagem: `A identificação ${a.identificacao} já é de outra amostra deste laudo.`,
          },
        ]);
      const antiga = porIdEntrada ?? dona;
      if (!antiga) {
        await tx.incluir(AMOSTRA, {
          laudo_anatomopatologico_id: laudo,
          sequencia: ++sequencia,
          recebida_em: new Date(),
          situacao: 'recebida',
          ...colunas(a),
        });
        incluidas++;
        continue;
      }
      ficam.add(num(antiga['id']));
      const lida = amostraLida(antiga);
      const reativar = antiga['excluido_em'] !== null;
      if (reativar || amostraMudou(lida, a)) {
        await tx.alterar(AMOSTRA, lida.id, num(antiga['versao']), {
          ...colunas(a),
          ...(reativar ? { excluido_em: null, excluido_por: null } : {}),
        });
        alteradas++;
      }
    }
    const agora = new Date();
    let retiradas = 0;
    for (const v of todas) {
      if (ficam.has(num(v['id'])) || v['excluido_em'] !== null) continue;
      await tx.alterar(AMOSTRA, num(v['id']), num(v['versao']), {
        excluido_em: agora,
        excluido_por: usuario,
      });
      retiradas++;
    }
    return { amostrasIncluidas: incluidas, amostrasAlteradas: alteradas, amostrasRetiradas: retiradas };
  }
}
