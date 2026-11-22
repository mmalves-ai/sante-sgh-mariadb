// Porta da nutrição, do mapa de dietas e do serviço social sobre o banco do cliente (M45, etapa 5; F2.2), pelo
// @sgh/nucleo: leituras somente leitura e as gravações diretas numa operação do Executor (trilha, outbox e idempotência
// na mesma transação), nas tabelas do modelo: triagem_nutricional (+ triagem_nutricional_resposta e o instrumento),
// terapia_nutricional (a meta da EMTN), mapa_dieta (+ mapa_dieta_item), barreira_alta, e as leituras de internacao,
// unidade_internacao, refeicao_do_dia, prescricao/prescricao_item/prescricao_item_dieta (com as características),
// horario_administracao (a checagem), alergia_paciente (alergeno alimentar), agendamento_cirurgico e os vínculos do
// usuário (usuario_profissional → profissional_ocupacao → ocupacao_cbo). Toda leitura filtra o estabelecimento da
// sessão e os registros excluídos; horários no fuso do estabelecimento (estabelecimento.fuso_horario).
// Melhoria: o escore da triagem é gravado com as parcelas e as respostas uma por linha (triagem_nutricional_resposta),
// com o instrumento e a versão do cadastro; o prazo da triagem (dentro_prazo) fica na própria linha.
// Melhoria: a meta da terapia guarda as grandezas de base (peso, meta calórica, proteica e volume do dia); as razões
// (kcal/kg, g/kg, densidade e proteína por litro) são derivadas na leitura, sem dado duplicado que possa divergir.
// Melhoria: o mapa fechado é um registro com o horário de corte e uma linha por paciente (jejum, alergias e
// características copiadas no fechamento), único por estabelecimento, dia, refeição e setor (restrição do banco).
// Melhoria: o usuário e o profissional vêm do contexto da sessão (ids), não do login em texto.
// Melhoria: o prazo da triagem gravado (dentro_prazo) é o decidido no serviço pelo parâmetro, não uma constante da porta;
// o paciente em jejum entra no mapa com a modalidade de jejum do cadastro; o sem prescrição fica na trilha do fechamento.
// Melhoria: a chave de idempotência da gravação vem da Idempotency-Key do pedido (pedido.ts), contada por pedido.
// F2.4: o acompanhamento diário da meta (acompanhamento_terapia_nutricional, um ativo por meta e dia; a retificação
// marca o anterior 'retificado' e liga o novo por substitui_id), o registro do serviço social e o adendo
// (registro_social, com a barreira social em barreira_alta), a correção (correcao_registro_nutricao, uma por
// registro), a avaliação farmacêutica da NPT (avaliacao_nutricao_parenteral, uma por formulação), o plano de refeição
// do acompanhante (plano_refeicao_acompanhante + as refeições) e o histórico da ordem do lactário
// (preparo_lactario_evento) e o do plano de refeição do acompanhante (plano_refeicao_acompanhante_evento) gravam e
// leem no modelo próprio.
// Pendências (pedido em docs/obra/fatias/f24/saida/p-especialidades-nutricao.json): o hash do mapa, os exames com
// jejum da agenda e o volume parenteral do balanço.
import {
  type AvaliacaoNptLida,
  CODIGOS_TIPO_BARREIRA,
  type RegistroCorrigivel,
  type RiscoSocial,
  type TipoBarreiraAlta,
  type TipoLinhaMapa,
  type TipoRegistroSocial,
  type VolumeBalanco,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import {
  type ContextoNutricao,
  type GravadorNutricao,
  METODOS_PORTA_NUTRICAO,
  type PortaNutricao,
  type VinculoDoLogin,
} from './porta.js';
import type {
  AcompanhamentoTerapiaRegistrado,
  AlteracaoHotelariaRegistrada,
  BarreiraAltaRegistrada,
  ChecagemDieta,
  CirurgiaDaJanela,
  CorrecaoRegistrada,
  DietaEnteral,
  ExameDaJanela,
  InternadoNutricao,
  ItemDietaMapa,
  MetaTerapiaRegistrada,
  RefeicaoAcompanhanteRegistrada,
  RefeicaoDoCadastro,
  RegistroSocialRegistrado,
  RetratoMapa,
  TriagemRegistrada,
  UnidadeInternacaoNutricao,
} from './tipos.js';
import { chaveDaGravacao } from './pedido.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoNutricao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

/** Teto dos internados da fila da nutrição (a tela avisa que a lista foi cortada). */
export const TETO_INTERNADOS_NUTRICAO = 500;
/** Prazo da triagem nutricional (horas desde a admissão) gravado na linha. */

/** Instante do banco → "AAAA-MM-DDTHH:mm" no fuso do estabelecimento. */
function local(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
/** "AAAA-MM-DDTHH:mm" (ou "AAAA-MM-DD") no fuso do estabelecimento → instante. */
const instante = (t: string, fuso: string): Date =>
  instanteCivil(t.slice(0, 10), t.length >= 16 ? `${t.slice(11, 13)}${t.slice(14, 16)}` : '0000', fuso);

/** Via da meta (tela) ↔ tipo da terapia e via de acesso (modelo). */
const TIPO_DA_VIA = { enteral: 'enteral', parenteral: 'parenteral', oral: 'oral_suplementar' } as const;
const ACESSO_DA_VIA = { enteral: 'sonda_nasoenteral', parenteral: 'acesso_central', oral: 'oral' } as const;
const VIA_DO_TIPO: Readonly<Record<string, MetaTerapiaRegistrada['via']>> = {
  enteral: 'enteral',
  parenteral: 'parenteral',
  oral_suplementar: 'oral',
  mista: 'enteral',
};
const TIPOS_LINHA: readonly string[] = ['jejum', 'livre', 'oral', 'enteral', 'parenteral', 'sem-prescricao'];

/** Tabelas das gravações diretas da nutrição. */
const TABELAS_GRAVACAO = [
  'triagem_nutricional',
  'triagem_nutricional_resposta',
  'terapia_nutricional',
  'mapa_dieta',
  'mapa_dieta_item',
  'acompanhamento_terapia_nutricional',
  'registro_social',
  'barreira_alta',
  'correcao_registro_nutricao',
  'avaliacao_nutricao_parenteral',
  'plano_refeicao_acompanhante',
  'plano_refeicao_acompanhante_refeicao',
  'preparo_lactario_evento',
  'plano_refeicao_acompanhante_evento',
] as const;

/** Estado da gravação: os acompanhamentos marcados 'retificado' à espera da correção (anterior → novo). */
interface ExtrasGravacao {
  dados: Record<string, unknown>;
  provisorias: Map<number, number>;
}

/** Ação da correção (tela) → ação do modelo. */
const ACAO_DO_MODELO: Readonly<Record<string, string>> = {
  retificacao: 'retificacao',
  estorno: 'estorno',
  'nova-versao': 'nova_versao',
  encerramento: 'encerramento',
};
const ACAO_DA_TELA: Readonly<Record<string, CorrecaoRegistrada['acao']>> = {
  retificacao: 'retificacao',
  estorno: 'estorno',
  nova_versao: 'nova-versao',
  encerramento: 'encerramento',
};
/** Evento do histórico (tela) ↔ evento do modelo. */
const EVENTO_DO_MODELO = {
  alterada: 'alterado',
  cancelada: 'cancelado',
  'etiqueta-emitida': 'etiqueta_emitida',
} as const;

/** Texto livre do histórico → JSON (literal de texto, sem perda); a leitura devolve o texto como veio. */
const jsonDoTexto = (v: string | null) => (v === null ? null : JSON.stringify(v));

/** Lista JSON do banco (texto ou já lida) → lista de textos. */
function listaJson(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || v === '') return [];
  try {
    const x = JSON.parse(v) as unknown;
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

const SQL_INTERNADOS = `
  SELECT i.id, i.paciente_id, i.atendimento_id, pf.nome, pf.data_nascimento, i.data_hora_entrada, i.situacao,
         ui.codigo AS unidade, ac.codigo AS acomod, ac.categoria_acomodacao_id, lh.codigo AS leito
    FROM internacao i
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN ocupacao_leito o ON o.internacao_vigente_id = i.id AND o.excluido_em IS NULL
    LEFT JOIN leito_hospitalar lh ON lh.id = COALESCE(o.leito_hospitalar_id, i.leito_hospitalar_id)
    LEFT JOIN acomodacao ac ON ac.id = COALESCE(o.acomodacao_id, lh.acomodacao_id, i.acomodacao_id)
    LEFT JOIN unidade_internacao ui ON ui.id = COALESCE(o.unidade_internacao_id, i.unidade_internacao_id)
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL`;

const SQL_METAS = `
  SELECT t.id, t.tipo_terapia, t.peso_kg, t.meta_calorica_kcal_dia, t.meta_proteica_g_dia, t.volume_total_ml_dia,
         t.prescricao_item_id, pid.id AS item_dieta, t.observacao, t.criado_em, u.login, i.id AS internacao
    FROM terapia_nutricional t
    JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.excluido_em IS NULL
    LEFT JOIN prescricao_item_dieta pid ON pid.prescricao_item_id = t.prescricao_item_id AND pid.excluido_em IS NULL
    LEFT JOIN usuario u ON u.id = t.criado_por
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao NOT IN ('encerrada', 'cancelada')`;

function internadoDe(r: Linha, fuso: string): InternadoNutricao {
  const acomodacao = texto(r['acomod']);
  const leito = texto(r['leito']);
  return {
    reg: n(r['id']),
    pront: n(r['paciente_id']),
    paciente: n(r['paciente_id']),
    atendimento: nn(r['atendimento_id']),
    nome: texto(r['nome']),
    nascimento: dataIso(r['data_nascimento']),
    bloco: texto(r['unidade']),
    acomodacao,
    leito: leito ? `${acomodacao}-${leito}` : acomodacao,
    admissao: local(r['data_hora_entrada'], fuso) ?? '',
    tipoAcomodacaoAtual: nn(r['categoria_acomodacao_id']),
  };
}

function metaDe(r: Linha): MetaTerapiaRegistrada & { reg: number } {
  const peso = n(r['peso_kg']);
  const kcal = n(r['meta_calorica_kcal_dia']);
  const prot = n(r['meta_proteica_g_dia']);
  const vol = n(r['volume_total_ml_dia']);
  return {
    id: n(r['id']),
    reg: n(r['internacao']),
    via: VIA_DO_TIPO[texto(r['tipo_terapia'])] ?? 'enteral',
    itemDieta: nn(r['item_dieta']),
    pesoKg: peso,
    kcalPorKg: peso > 0 ? arred(kcal / peso) : 0,
    proteinaGPorKg: peso > 0 ? arred(prot / peso) : 0,
    metaKcal: kcal,
    metaProteinaG: prot,
    densidadeKcalMl: vol > 0 ? arred(kcal / vol) : 0,
    proteinaGL: vol > 0 ? arred((prot * 1000) / vol) : 0,
    metaVolumeMl: vol,
    por: texto(r['login']),
    em: '',
    origemTerapia:
      r['prescricao_item_id'] === null || r['prescricao_item_id'] === undefined ? 'informada' : 'prescrita',
    observacao: textoN(r['observacao']),
  };
}

/** "?, ?, ?" para uma lista (nunca vazia: a chamada confere antes). */
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'nutricao').slice(0, 64),
  };
}

/** Resposta do instrumento → a coluna tipada da resposta. */
function colunasDaResposta(v: unknown): Record<string, unknown> {
  if (typeof v === 'boolean') return { resposta_booleana: v };
  if (typeof v === 'number' && Number.isFinite(v)) return { resposta_numerica: v };
  if (v === null || v === undefined || v === '') return {};
  return { resposta_texto: String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 500) };
}

const SQL_SOCIAIS = `
  SELECT r.id, r.internacao_id, r.tipo, r.rede_apoio, r.vulnerabilidades, r.risco, r.encaminhamentos, r.parecer,
         r.orientacoes, r.barreira_alta_id, r.adendo_registro_social_id, r.motivo_adendo, r.criado_em, u.login
    FROM registro_social r
    LEFT JOIN usuario u ON u.id = r.criado_por
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

function socialDe(r: Linha, fuso: string): RegistroSocialRegistrado {
  return {
    id: n(r['id']),
    reg: n(r['internacao_id']),
    tipo: texto(r['tipo']) as RegistroSocialRegistrado['tipo'],
    redeApoio: texto(r['rede_apoio']) as RegistroSocialRegistrado['redeApoio'],
    vulnerabilidades: listaJson(r['vulnerabilidades']) as RegistroSocialRegistrado['vulnerabilidades'],
    risco: texto(r['risco']) as RiscoSocial,
    encaminhamentos: listaJson(r['encaminhamentos']) as RegistroSocialRegistrado['encaminhamentos'],
    parecer: texto(r['parecer']),
    orientacoes: textoN(r['orientacoes']),
    barreira: nn(r['barreira_alta_id']),
    por: texto(r['login']),
    em: local(r['criado_em'], fuso) ?? '',
    adendoDe: nn(r['adendo_registro_social_id']),
    motivoAdendo: textoN(r['motivo_adendo']),
  };
}

/** A internação dona do registro corrigível, no estabelecimento (null: não existe ou é de outro). */
async function internacaoDoRegistroEm(
  l: Leitor,
  est: number,
  registro: RegistroCorrigivel,
  id: number,
): Promise<number | null> {
  const sql: Readonly<Record<RegistroCorrigivel, string>> = {
    triagem:
      'SELECT internacao_id FROM triagem_nutricional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    meta: `SELECT i.id AS internacao_id FROM terapia_nutricional t
             JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
            WHERE t.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL AND i.excluido_em IS NULL
            ORDER BY i.id LIMIT 1`,
    acompanhamento: `SELECT i.id AS internacao_id FROM acompanhamento_terapia_nutricional a
             JOIN terapia_nutricional t ON t.id = a.terapia_nutricional_id
             JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
            WHERE a.id = ? AND t.estabelecimento_id = ? AND a.excluido_em IS NULL AND i.excluido_em IS NULL
            ORDER BY i.id LIMIT 1`,
    social:
      'SELECT internacao_id FROM registro_social WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
  };
  const r = await l.uma(sql[registro], [id, est]);
  return nn(r?.['internacao_id']);
}

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  usuario: number,
  fuso: string,
  extras: ExtrasGravacao,
): GravadorNutricao {
  const internacao = async (reg: number) => {
    const r = await tx.uma(
      'SELECT id, atendimento_id, paciente_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [reg, est],
    );
    if (!r) throw recusa('internacao-inexistente', 'Internação não encontrada neste estabelecimento.');
    return { atendimento: n(r['atendimento_id']), paciente: n(r['paciente_id']) };
  };
  return {
    async triar(t) {
      const i = await internacao(t.reg);
      const inst = await tx.uma(
        'SELECT id FROM instrumento_triagem_nutricional WHERE codigo = ? AND ativo = TRUE',
        [t.instrumento],
      );
      if (!inst) throw recusa('instrumento-inexistente', 'Instrumento de triagem não cadastrado ou inativo.');
      const agora = new Date();
      const id = await tx.incluir('triagem_nutricional', {
        estabelecimento_id: est,
        internacao_id: t.reg,
        paciente_id: i.paciente,
        instrumento_triagem_nutricional_id: n(inst['id']),
        versao_instrumento: t.versao,
        triado_em: agora,
        profissional_id: t.vinculo || null,
        responsavel_usuario_id: usuario,
        peso_kg: t.pesoKg,
        altura_cm: t.alturaCm,
        imc: t.imc,
        pontuacao_estado_nutricional: t.estado,
        pontuacao_gravidade: t.gravidade,
        pontuacao_idade: t.idade,
        pontuacao_total: t.total,
        risco: t.risco,
        conduta: t.conduta,
        horas_desde_admissao: Math.max(0, Math.floor(t.horasDesdeAdmissao)),
        dentro_prazo: t.dentroDoPrazo,
        reavaliar_em: t.reavaliarEm,
        situacao: 'ativo',
      });
      let respostas: Record<string, unknown> = {};
      try {
        const p = JSON.parse(t.respostas) as unknown;
        if (p && typeof p === 'object' && !Array.isArray(p)) respostas = p as Record<string, unknown>;
      } catch {
        throw recusa('respostas-invalidas', 'As respostas da triagem não vieram num formato válido.');
      }
      let seq = 0;
      for (const [pergunta, valor] of Object.entries(respostas)) {
        const col = colunasDaResposta(valor);
        if (Object.keys(col).length === 0) continue;
        seq += 1;
        await tx.incluir('triagem_nutricional_resposta', {
          triagem_nutricional_id: id,
          sequencia: seq,
          codigo_pergunta: pergunta.slice(0, 60),
          ...col,
        });
      }
      return id;
    },
    async registrarMeta(m) {
      const i = await internacao(m.reg);
      let prescricaoItem: number | null = null;
      let prescricao: number | null = null;
      if (m.itemDieta !== null) {
        const r = await tx.uma(
          `SELECT pi.id, pi.prescricao_id FROM prescricao_item_dieta pid
             JOIN prescricao_item pi ON pi.id = pid.prescricao_item_id
             JOIN prescricao p ON p.id = pi.prescricao_id
            WHERE pid.id = ? AND p.atendimento_id = ? AND pid.excluido_em IS NULL`,
          [m.itemDieta, i.atendimento],
        );
        if (!r)
          throw recusa('item-dieta-inexistente', 'O item de dieta não é da prescrição desta internação.');
        prescricaoItem = n(r['id']);
        prescricao = n(r['prescricao_id']);
      }
      const agora = new Date();
      return tx.incluir('terapia_nutricional', {
        estabelecimento_id: est,
        atendimento_id: i.atendimento,
        paciente_id: i.paciente,
        prescricao_id: prescricao,
        prescricao_item_id: prescricaoItem,
        tipo_terapia: TIPO_DA_VIA[m.via],
        via_acesso: ACESSO_DA_VIA[m.via],
        indicacao: (m.observacao ?? 'Meta nutricional calculada pela equipe de terapia nutricional').slice(
          0,
          500,
        ),
        peso_kg: m.pesoKg,
        meta_calorica_kcal_dia: m.metaKcal,
        meta_proteica_g_dia: m.metaProteinaG,
        volume_total_ml_dia: m.metaVolumeMl,
        situacao: 'liberada',
        inicio_em: agora,
        responsavel_profissional_id: m.vinculo,
        calculo_profissional_id: m.vinculo,
        liberada_em: agora,
        liberada_usuario_id: usuario,
        observacao: m.observacao,
      });
    },
    async registrarAcompanhamento(a) {
      const t = await tx.uma(
        `SELECT t.id FROM terapia_nutricional t
           JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
          WHERE t.id = ? AND t.estabelecimento_id = ? AND i.id = ? AND t.excluido_em IS NULL AND i.excluido_em IS NULL`,
        [a.meta, est, a.reg],
      );
      if (!t)
        throw recusa('meta-de-outra-internacao', 'A meta de terapia nutricional não é desta internação.');
      // Um acompanhamento ativo por meta e dia (restrição do banco): o do dia que já existe fica 'retificado' à espera
      // da correção na mesma gravação; sem ela, a gravação inteira é recusada (gravarSgh).
      const [vigente] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM acompanhamento_terapia_nutricional
          WHERE terapia_nutricional_id = ? AND dia_vigente = ?`,
        [a.meta, a.data],
      );
      if (vigente)
        await tx.alterar('acompanhamento_terapia_nutricional', n(vigente['id']), n(vigente['versao']), {
          situacao: 'retificado',
        });
      const id = await tx.incluir('acompanhamento_terapia_nutricional', {
        terapia_nutricional_id: a.meta,
        data_referencia: a.data,
        volume_prescrito_ml: a.volumePrescritoMl,
        volume_infundido_ml: a.volumeInfundidoMl,
        origem_volume: a.origemVolume,
        calorias_atingidas_kcal: a.kcalAtingida,
        proteina_atingida_g: a.proteinaAtingidaG,
        percentual_calorico: a.pctKcal,
        percentual_proteico: a.pctProteina,
        motivo_meta_nao_atingida: a.motivo,
        observacao: a.observacao,
        profissional_id: a.vinculo,
        situacao: 'ativo',
      });
      if (vigente) extras.provisorias.set(n(vigente['id']), id);
      return id;
    },
    async fecharMapa(m) {
      const u = await tx.uma(
        `SELECT id, setor_funcional_id FROM unidade_internacao
          WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL`,
        [est, m.unidade],
      );
      if (!u)
        throw recusa('unidade-inexistente', 'Unidade de internação não encontrada neste estabelecimento.');
      if (u['setor_funcional_id'] === null || u['setor_funcional_id'] === undefined)
        throw recusa(
          'unidade-sem-setor',
          'A unidade não tem o setor funcional cadastrado: o mapa não pode ser fechado.',
        );
      // A linha em jejum leva a modalidade de jejum do cadastro (classe 'jejum'); a linha sem prescrição não gera
      // bandeja: fica no registro do fechamento (trilha) até a coluna do tipo de linha (pedido do lote).
      const comDieta = m.linhas.filter((l) => l.dieta !== null || l.tipo === 'jejum');
      const semPrescricao = m.linhas.filter((l) => l.dieta === null && l.tipo !== 'jejum');
      if (semPrescricao.some((l) => l.tipo !== 'sem-prescricao'))
        throw recusa(
          'dieta-sem-modalidade',
          'Há prescrição de dieta sem modalidade cadastrada: corrija a prescrição antes de fechar o mapa.',
        );
      let modalidadeJejum: number | null = null;
      if (comDieta.some((l) => l.dieta === null)) {
        const j = await tx.uma(
          "SELECT id FROM modalidade_dieta WHERE classe = 'jejum' AND ativo = TRUE ORDER BY ordem IS NULL, ordem, id LIMIT 1",
          [],
        );
        if (!j)
          throw recusa(
            'sem-modalidade-jejum',
            'Cadastre a modalidade de dieta de jejum para fechar o mapa com pacientes em jejum.',
          );
        modalidadeJejum = n(j['id']);
      }
      const agora = new Date();
      const id = await tx.incluir('mapa_dieta', {
        estabelecimento_id: est,
        data_referencia: m.data,
        refeicao_do_dia_id: m.refeicao,
        setor_funcional_id: n(u['setor_funcional_id']),
        unidade_internacao_id: n(u['id']),
        horario_corte: instante(m.corteEm, fuso),
        situacao: 'fechado',
        fechado_em: agora,
        fechado_por_usuario_id: usuario,
      });
      let seq = 0;
      for (const l of comDieta) {
        const i = await internacao(l.reg);
        seq += 1;
        const jejum = l.tipo === 'jejum';
        await tx.incluir('mapa_dieta_item', {
          mapa_dieta_id: id,
          sequencia: seq,
          atendimento_id: i.atendimento,
          paciente_id: i.paciente,
          prescricao_item_dieta_id: l.itemDieta,
          modalidade_dieta_id: l.dieta ?? modalidadeJejum,
          caracteristicas: l.caracteristicas?.slice(0, 1000) ?? null,
          alergias_restricoes: l.alergias?.slice(0, 1000) ?? null,
          jejum,
          jejum_motivo: jejum ? (l.jejumOrigem ?? null) : null,
          quantidade_acompanhantes: l.acompanhante ? 1 : 0,
          situacao: 'previsto',
        });
      }
      extras.dados = {
        ...extras.dados,
        hash: m.hash,
        linhas: m.linhas.length,
        semPrescricao: semPrescricao.map((l) => l.reg),
      };
      return id;
    },
    async registrarAcompanhante(a) {
      await internacao(a.reg);
      const vigente = await tx.consultarParaAtualizar(
        `SELECT id FROM plano_refeicao_acompanhante
          WHERE internacao_id = ? AND estabelecimento_id = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
        [a.reg, est],
      );
      if (vigente.length > 0)
        throw recusa(
          'acompanhante-vigente',
          'A internação já tem a refeição do acompanhante vigente: encerre a atual antes de registrar outra.',
        );
      const id = await tx.incluir('plano_refeicao_acompanhante', {
        estabelecimento_id: est,
        internacao_id: a.reg,
        direito_legal: a.baseLegal,
        inicio_em: instante(a.inicio, fuso),
        fim_em: a.fim ? instante(a.fim, fuso) : null,
        observacao: a.observacao,
        situacao: 'ativa',
      });
      for (const r of [...new Set(a.refeicoes)].sort((p, q) => p - q))
        await tx.incluir('plano_refeicao_acompanhante_refeicao', {
          plano_refeicao_acompanhante_id: id,
          refeicao_do_dia_id: r,
        });
      return id;
    },
    async encerrarAcompanhante(a) {
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM plano_refeicao_acompanhante
          WHERE id = ? AND estabelecimento_id = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
        [a.id, est],
      );
      if (!atual) throw recusa('acompanhante-desatualizado', 'A refeição do acompanhante já foi encerrada.');
      await tx.alterar('plano_refeicao_acompanhante', a.id, n(atual['versao']), { situacao: 'encerrada' });
      return 1;
    },
    async registrarSocial(a) {
      const i = await internacao(a.reg);
      let barreira: number | null = null;
      if (a.barreira) {
        const tipo = await tx.uma(
          "SELECT id FROM tipo_barreira_alta WHERE categoria = 'social' AND ativo = TRUE ORDER BY id LIMIT 1",
          [],
        );
        if (!tipo)
          throw recusa(
            'sem-tipo-barreira-social',
            'Cadastre o tipo de barreira de alta da categoria social.',
          );
        // O responsável vem em texto da tela (não é um usuário do cadastro): vai junto da descrição.
        barreira = await tx.incluir('barreira_alta', {
          internacao_id: a.reg,
          tipo_barreira_alta_id: n(tipo['id']),
          descricao: `${a.barreira.descricao} (responsável: ${a.barreira.responsavel})`.slice(0, 1000),
          identificada_em: new Date(),
          prazo_em: instante(a.barreira.prazo, fuso),
          situacao: 'aberta',
        });
      }
      const id = await tx.incluir('registro_social', {
        estabelecimento_id: est,
        internacao_id: a.reg,
        paciente_id: i.paciente,
        tipo: a.tipo,
        rede_apoio: a.redeApoio,
        vulnerabilidades: JSON.stringify([...new Set(a.vulnerabilidades)]),
        risco: a.risco,
        encaminhamentos: JSON.stringify([...new Set(a.encaminhamentos)]),
        parecer: a.parecer,
        orientacoes: a.orientacoes,
        barreira_alta_id: barreira,
        profissional_id: a.vinculo,
        situacao: 'ativo',
      });
      return { id, barreira };
    },
    async registrarEvento(linha) {
      // O evento próprio vai nos dados da trilha da operação (uma linha da trilha por gravação).
      const eventos = (extras.dados['eventos'] as unknown[] | undefined) ?? [];
      extras.dados = {
        ...extras.dados,
        eventos: [...eventos, { acao: linha.acao, entidade: linha.entidade, id: linha.entidadeId }],
      };
    },
    async corrigir(k) {
      const dono = await internacaoDoRegistroEm(tx, est, k.registro, k.id);
      if (dono === null || dono !== k.reg)
        throw recusa('registro-de-outra-internacao', 'O registro não existe ou não é desta internação.');
      const ja = await tx.consultarParaAtualizar(
        `SELECT id FROM correcao_registro_nutricao
          WHERE estabelecimento_id = ? AND tipo_registro = ? AND registro_id = ?`,
        [est, k.registro, k.id],
      );
      if (ja.length > 0)
        throw recusa(
          'registro-ja-corrigido',
          'O registro já foi retificado, estornado ou encerrado (inativo).',
        );
      const substitui = k.acao === 'retificacao' || k.acao === 'nova-versao';
      if (k.registro === 'acompanhamento') {
        const provisoria = extras.provisorias.get(k.id);
        if (provisoria !== undefined && (!substitui || provisoria !== k.idNovo))
          throw recusa(
            'acompanhamento-do-dia',
            'O dia já tem acompanhamento ativo: retifique o registro do dia.',
          );
        extras.provisorias.delete(k.id);
        const [o] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao FROM acompanhamento_terapia_nutricional WHERE id = ?',
          [k.id],
        );
        if (o && texto(o['situacao']) === 'ativo' && k.acao !== 'encerramento')
          await tx.alterar('acompanhamento_terapia_nutricional', k.id, n(o['versao']), {
            situacao: substitui ? 'retificado' : 'estornado',
          });
        if (substitui && k.idNovo !== null) {
          const [novo] = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM acompanhamento_terapia_nutricional WHERE id = ? AND terapia_nutricional_id = (SELECT terapia_nutricional_id FROM acompanhamento_terapia_nutricional WHERE id = ?)',
            [k.idNovo, k.id],
          );
          if (!novo)
            throw recusa('registro-novo-inexistente', 'O registro novo da retificação não é da mesma meta.');
          await tx.alterar('acompanhamento_terapia_nutricional', k.idNovo, n(novo['versao']), {
            substitui_id: k.id,
            motivo_correcao: k.motivo.slice(0, 500),
          });
        }
      }
      if (k.registro === 'social') {
        const [o] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao FROM registro_social WHERE id = ?',
          [k.id],
        );
        if (o && texto(o['situacao']) === 'ativo')
          await tx.alterar('registro_social', k.id, n(o['versao']), {
            situacao:
              k.acao === 'estorno' ? 'estornado' : k.acao === 'encerramento' ? 'encerrado' : 'retificado',
          });
      }
      return tx.incluir('correcao_registro_nutricao', {
        estabelecimento_id: est,
        internacao_id: k.reg,
        tipo_registro: k.registro,
        registro_id: k.id,
        acao: ACAO_DO_MODELO[k.acao] ?? k.acao,
        novo_registro_id: k.idNovo,
        motivo: k.motivo.slice(0, 500),
        profissional_id: k.vinculo,
      });
    },
    async avaliarNpt(a) {
      const [t] = await tx.consultarParaAtualizar(
        `SELECT t.id, t.tipo_terapia FROM terapia_nutricional t
           JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
          WHERE t.id = ? AND t.estabelecimento_id = ? AND i.id = ? AND t.excluido_em IS NULL`,
        [a.meta, est, a.reg],
      );
      if (!t || texto(t['tipo_terapia']) !== 'parenteral')
        throw recusa('meta-nao-parenteral', 'A meta não é uma terapia parenteral desta internação.');
      const ja = await tx.uma(
        'SELECT id FROM avaliacao_nutricao_parenteral WHERE terapia_nutricional_id = ?',
        [a.meta],
      );
      if (ja)
        throw recusa(
          'avaliacao-registrada',
          'A avaliação farmacêutica desta formulação já foi registrada e não se edita.',
        );
      return tx.incluir('avaliacao_nutricao_parenteral', {
        terapia_nutricional_id: a.meta,
        parecer: a.parecer,
        acesso: a.acesso,
        osmolaridade_mosm_l: a.osmolaridade,
        estavel: a.estabilidade,
        compativel: a.compatibilidade,
        observacao: a.observacao,
        profissional_id: a.vinculo,
      });
    },
    async adendoSocial(a) {
      const [o] = await tx.consultarParaAtualizar(
        `SELECT id, paciente_id, rede_apoio, risco, situacao FROM registro_social
          WHERE id = ? AND estabelecimento_id = ? AND internacao_id = ? AND excluido_em IS NULL`,
        [a.de, est, a.reg],
      );
      if (!o) throw recusa('registro-de-outra-internacao', 'O registro social não existe.');
      const corrigido = await tx.uma(
        "SELECT id FROM correcao_registro_nutricao WHERE estabelecimento_id = ? AND tipo_registro = 'social' AND registro_id = ?",
        [est, a.de],
      );
      if (corrigido || texto(o['situacao']) === 'estornado')
        throw recusa('registro-ja-corrigido', 'O registro foi estornado (inativo).');
      return tx.incluir('registro_social', {
        estabelecimento_id: est,
        internacao_id: a.reg,
        paciente_id: n(o['paciente_id']),
        tipo: 'adendo',
        rede_apoio: texto(o['rede_apoio']),
        vulnerabilidades: '[]',
        risco: texto(o['risco']),
        encaminhamentos: '[]',
        parecer: a.texto,
        adendo_registro_social_id: a.de,
        motivo_adendo: a.motivo.slice(0, 500),
        profissional_id: a.vinculo,
        situacao: 'ativo',
      });
    },
    async alterarAcompanhante(a) {
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, inicio_em, fim_em, dieta, observacao FROM plano_refeicao_acompanhante
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [a.id, est],
      );
      const inicio = atual ? (local(atual['inicio_em'], fuso) ?? '').slice(0, 10) : '';
      if (!atual || texto(atual['situacao']) !== 'ativa' || (a.fim !== null && a.fim < inicio))
        throw recusa(
          'acompanhante-desatualizado',
          'A refeição do acompanhante foi encerrada (ou o fim ficou antes do início).',
        );
      // Todas as linhas do plano, inclusive as excluídas: a chave única (plano, refeição) faz a refeição que volta
      // reativar a linha excluída, e a que sai é exclusão lógica (excluido_em e excluido_por) pelo Executor, com trilha.
      const linhas = await tx.consultarParaAtualizar(
        `SELECT id, versao, refeicao_do_dia_id, excluido_em FROM plano_refeicao_acompanhante_refeicao
          WHERE plano_refeicao_acompanhante_id = ? ORDER BY refeicao_do_dia_id`,
        [a.id],
      );
      const ativas = linhas.filter((r) => r['excluido_em'] === null || r['excluido_em'] === undefined);
      const antes = ativas.map((r) => n(r['refeicao_do_dia_id']));
      await tx.alterar('plano_refeicao_acompanhante', a.id, n(atual['versao']), {
        dieta: a.dieta,
        fim_em: a.fim ? instante(a.fim, fuso) : null,
        observacao: a.observacao,
      });
      const novas = [...new Set(a.refeicoes)];
      const sair = antes.filter((r) => !novas.includes(r));
      for (const l of ativas.filter((r) => sair.includes(n(r['refeicao_do_dia_id']))))
        await tx.alterar('plano_refeicao_acompanhante_refeicao', n(l['id']), n(l['versao']), {
          excluido_em: new Date(),
          excluido_por: tx.contexto.usuario,
        });
      for (const r of novas.filter((x) => !antes.includes(x)).sort((p, q) => p - q)) {
        const excluida = linhas.find((l) => n(l['refeicao_do_dia_id']) === r && !ativas.includes(l));
        if (excluida)
          await tx.alterar('plano_refeicao_acompanhante_refeicao', n(excluida['id']), n(excluida['versao']), {
            excluido_em: null,
            excluido_por: null,
          });
        else
          await tx.incluir('plano_refeicao_acompanhante_refeicao', {
            plano_refeicao_acompanhante_id: a.id,
            refeicao_do_dia_id: r,
          });
      }
      return {
        dieta: textoN(atual['dieta']),
        refeicoes: antes,
        fim: atual['fim_em'] ? (local(atual['fim_em'], fuso) ?? '').slice(0, 10) : null,
        observacao: textoN(atual['observacao']),
      };
    },
    async registrarAlteracao(a) {
      if (a.tabela !== 'ordem_lactario') {
        // Histórico do plano de refeição do acompanhante: só 'alterado' e 'cancelado' (CHECK da tabela).
        if (a.evento === 'etiqueta-emitida')
          throw recusa('evento-invalido', 'O plano de refeição do acompanhante não emite etiqueta.');
        const p = await tx.uma(
          'SELECT id FROM plano_refeicao_acompanhante WHERE id = ? AND estabelecimento_id = ?',
          [a.id, est],
        );
        if (!p)
          throw recusa(
            'acompanhante-inexistente',
            'O plano de refeição do acompanhante não existe neste estabelecimento.',
          );
        return tx.incluir('plano_refeicao_acompanhante_evento', {
          plano_refeicao_acompanhante_id: a.id,
          evento: EVENTO_DO_MODELO[a.evento],
          dados_antes: jsonDoTexto(a.antes),
          dados_depois: jsonDoTexto(a.depois),
          motivo: a.motivo,
          ocorrido_em: new Date(),
          usuario_id: usuario,
        });
      }
      const o = await tx.uma('SELECT id FROM preparo_lactario WHERE id = ? AND estabelecimento_id = ?', [
        a.id,
        est,
      ]);
      if (!o) throw recusa('ordem-inexistente', 'A ordem do lactário não existe neste estabelecimento.');
      return tx.incluir('preparo_lactario_evento', {
        preparo_lactario_id: a.id,
        evento: EVENTO_DO_MODELO[a.evento],
        dados_antes: jsonDoTexto(a.antes),
        dados_depois: jsonDoTexto(a.depois),
        motivo: a.motivo,
        ocorrido_em: new Date(),
        usuario_id: usuario,
      });
    },
  };
}

export class PortaNutricaoPropria implements PortaNutricao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoNutricao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoNutricao, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  /** A nutrição não tem operação de tela pelo Executor: as gravações são diretas (gravarSgh). */
  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'A nutrição grava pelas ações da própria tela.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorNutricao) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da nutrição exige o usuário da sessão.');
    const usuario = c.usuario;
    let saida: { valor: T } | null = null;
    const extras: ExtrasGravacao = { dados: {}, provisorias: new Map() };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'nutricao.gravacao-direta',
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        const fuso = await fusoDe(tx, est);
        saida = { valor: await fn(gravadorSobre(tx, est, usuario, fuso, extras)) };
        if (extras.provisorias.size > 0)
          throw recusa(
            'acompanhamento-do-dia',
            'O dia já tem acompanhamento ativo desta meta: retifique ou estorne o registro do dia.',
          );
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'triagem_nutricional', id: l?.entidadeId ?? null };
      },
      trilha: () => {
        const depois = linha()?.dadosDepois;
        const dados =
          depois && typeof depois === 'object'
            ? { ...(depois as object), ...extras.dados }
            : (depois ?? extras.dados);
        return { dados, motivo: linha()?.motivo ?? null };
      },
    });
    const chave = chaveDaGravacao('nutricao', c);
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...contextoDe(c), chaveIdempotencia: chave },
    );
    if (r.repetida) return JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
    if (!saida) throw new Error('Gravação da nutrição sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoNutricao): Promise<{ agora: string; hoje: string }> {
    return this.ler(c, async (_l, _e, fuso) => {
      const r = relogioNoFuso(fuso);
      return { agora: `${r.hoje}T${r.hora}`, hoje: r.hoje };
    });
  }

  vinculos(c: ContextoNutricao, login: string): Promise<VinculoDoLogin[]> {
    // Vínculos do usuário: profissional ligado ao usuário (vigente) e as ocupações (CBO) dele.
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT up.profissional_id, oc.codigo_cbo, po.ativo, pr.situacao, up.vigencia_fim
             FROM usuario u
             JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
             JOIN profissional pr ON pr.id = up.profissional_id AND pr.excluido_em IS NULL
             JOIN profissional_ocupacao po ON po.profissional_id = pr.id AND po.excluido_em IS NULL
             JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
            WHERE u.login = ? AND u.excluido_em IS NULL
            ORDER BY po.principal DESC, po.id`,
          [login],
          { teto: 50 },
        )
      ).map((r) => ({
        vinculo: n(r['profissional_id']),
        cbo: texto(r['codigo_cbo']).trim(),
        ativo:
          verdadeiro(r['ativo']) &&
          texto(r['situacao']) === 'ativo' &&
          (r['vigencia_fim'] === null ||
            r['vigencia_fim'] === undefined ||
            dataIso(r['vigencia_fim'])! >= new Date().toISOString().slice(0, 10)),
      })),
    );
  }

  cadastrosDoLogin(c: ContextoNutricao, login: string): Promise<number> {
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT COUNT(DISTINCT up.profissional_id) AS q FROM usuario u
           JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
          WHERE u.login = ? AND u.excluido_em IS NULL`,
        [login],
      );
      return n(r?.['q']);
    });
  }

  internados(
    c: ContextoNutricao,
    unidade: string | null,
  ): Promise<{ itens: InternadoNutricao[]; cortada: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_INTERNADOS} AND i.situacao IN ('ativa', 'alta_medica')${unidade ? ' AND ui.codigo = ?' : ''}
          ORDER BY ui.codigo, ac.codigo, lh.codigo, i.id LIMIT ${TETO_INTERNADOS_NUTRICAO + 1}`,
        unidade ? [est, unidade] : [est],
        { teto: TETO_INTERNADOS_NUTRICAO + 1 },
      );
      return {
        itens: rs.slice(0, TETO_INTERNADOS_NUTRICAO).map((r) => internadoDe(r, fuso)),
        cortada: rs.length > TETO_INTERNADOS_NUTRICAO,
      };
    });
  }

  internacao(c: ContextoNutricao, reg: number): Promise<(InternadoNutricao & { aberta: boolean }) | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = (await l.consultar(`${SQL_INTERNADOS} AND i.id = ?`, [est, reg], { teto: 1 }))[0];
      return r
        ? { ...internadoDe(r, fuso), aberta: ['ativa', 'alta_medica'].includes(texto(r['situacao'])) }
        : null;
    });
  }

  triagens(c: ContextoNutricao, regs: readonly number[]): Promise<TriagemRegistrada[]> {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT t.id, t.internacao_id, it.codigo AS instrumento, t.versao_instrumento, t.pontuacao_total,
                  t.pontuacao_estado_nutricional, t.pontuacao_gravidade, t.pontuacao_idade, t.risco, t.conduta, t.imc,
                  t.horas_desde_admissao, t.reavaliar_em, t.situacao, t.triado_em, u.login
             FROM triagem_nutricional t
             JOIN instrumento_triagem_nutricional it ON it.id = t.instrumento_triagem_nutricional_id
             LEFT JOIN usuario u ON u.id = t.responsavel_usuario_id
            WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.internacao_id IN (${marcas(regs)})
            ORDER BY t.triado_em DESC, t.id DESC`,
          [est, ...regs],
          { teto: 2000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        reg: n(r['internacao_id']),
        instrumento: texto(r['instrumento']) as TriagemRegistrada['instrumento'],
        versao: texto(r['versao_instrumento']),
        total: n(r['pontuacao_total']),
        estado: nn(r['pontuacao_estado_nutricional']),
        gravidade: nn(r['pontuacao_gravidade']),
        idade: nn(r['pontuacao_idade']),
        risco: texto(r['risco']) as TriagemRegistrada['risco'],
        conduta: textoN(r['conduta']),
        imc: nn(r['imc']),
        horasDesdeAdmissao: n(r['horas_desde_admissao']),
        reavaliarEm: dataIso(r['reavaliar_em']),
        por: texto(r['login']),
        em: local(r['triado_em'], fuso) ?? '',
        inativa: texto(r['situacao']) !== 'ativo',
      })),
    );
  }

  comMeta(c: ContextoNutricao, regs: readonly number[]): Promise<Set<number>> {
    if (regs.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(`${SQL_METAS} AND i.id IN (${marcas(regs)})`, [est, ...regs], {
        teto: 5000,
      });
      return new Set(rs.map((r) => n(r['internacao'])));
    });
  }

  dietasEnterais(c: ContextoNutricao, atendimento: number, desde: string): Promise<DietaEnteral[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT pid.id AS item_dieta, pi.id AS item, p.id AS prescricao, p.numero, pid.modalidade_dieta_id,
                  md.descricao AS nome_dieta, pid.volume, pid.velocidade_infusao, p.vigencia_inicio_em,
                  p.vigencia_fim_em, pi.situacao, pi.suspenso_em, oc.codigo_cbo
             FROM prescricao_item_dieta pid
             JOIN prescricao_item pi ON pi.id = pid.prescricao_item_id AND pi.excluido_em IS NULL
             JOIN prescricao p ON p.id = pi.prescricao_id AND p.excluido_em IS NULL
             JOIN modalidade_dieta md ON md.id = pid.modalidade_dieta_id
             LEFT JOIN via_dieta vd ON vd.id = COALESCE(pid.via_dieta_id, md.via_dieta_id)
             LEFT JOIN ocupacao_cbo oc ON oc.id = p.ocupacao_cbo_id
            WHERE p.estabelecimento_id = ? AND p.atendimento_id = ? AND pid.excluido_em IS NULL
              AND (md.classe = 'enteral' OR vd.modalidade = 'enteral') AND p.vigencia_fim_em >= ?
            ORDER BY p.vigencia_inicio_em, pid.id`,
          [est, atendimento, instante(desde, fuso)],
          { teto: 2000 },
        )
      ).map((r) => ({
        itemDieta: n(r['item_dieta']),
        item: n(r['item']),
        prescricao: n(r['prescricao']),
        plano: n(r['numero']),
        dieta: nn(r['modalidade_dieta_id']),
        nomeDieta: textoN(r['nome_dieta']),
        quantidade: nn(r['volume']),
        velocidade: nn(r['velocidade_infusao']),
        vigenciaInicio: local(r['vigencia_inicio_em'], fuso) ?? '',
        vigenciaFim: local(r['vigencia_fim_em'], fuso) ?? '',
        suspensa: texto(r['situacao']) === 'suspenso' || r['suspenso_em'] !== null,
        cboLancamento: textoN(r['codigo_cbo']),
      })),
    );
  }

  checagens(c: ContextoNutricao, itens: readonly number[], desde: string): Promise<ChecagemDieta[]> {
    if (itens.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT h.prescricao_item_id, h.previsto_em, sc.categoria, h.quantidade_administrada, h.situacao_checagem_em
             FROM horario_administracao h
             JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
            WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.previsto_em >= ?
              AND h.prescricao_item_id IN (${marcas(itens)})
            ORDER BY h.previsto_em, h.id`,
          [est, instante(desde, fuso), ...itens],
          { teto: 5000 },
        )
      ).map((r) => ({
        item: n(r['prescricao_item_id']),
        previsto: local(r['previsto_em'], fuso) ?? '',
        situacao: texto(r['categoria']),
        quantidade: nn(r['quantidade_administrada']),
        situacaoEm: local(r['situacao_checagem_em'], fuso),
      })),
    );
  }

  primeiraAdministrada(c: ContextoNutricao, itens: readonly number[]): Promise<string | null> {
    if (itens.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(
        `SELECT MIN(h.administrado_em) AS em FROM horario_administracao h
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.administrado_em IS NOT NULL
            AND h.prescricao_item_id IN (${marcas(itens)})`,
        [est, ...itens],
      );
      return local(r?.['em'], fuso);
    });
  }

  terapia(
    c: ContextoNutricao,
    reg: number,
  ): Promise<{ metas: MetaTerapiaRegistrada[]; acompanhamentos: AcompanhamentoTerapiaRegistrado[] }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_METAS} AND i.id = ? ORDER BY t.criado_em DESC, t.id DESC`,
        [est, reg],
        {
          teto: 500,
        },
      );
      const as = await l.consultar(
        `SELECT a.id, a.terapia_nutricional_id, a.data_referencia, a.volume_prescrito_ml, a.volume_infundido_ml,
                a.origem_volume, a.calorias_atingidas_kcal, a.proteina_atingida_g, a.percentual_calorico,
                a.percentual_proteico, a.motivo_meta_nao_atingida, a.observacao, a.criado_em, u.login
           FROM acompanhamento_terapia_nutricional a
           JOIN terapia_nutricional t ON t.id = a.terapia_nutricional_id
           JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
           LEFT JOIN usuario u ON u.id = a.criado_por
          WHERE t.estabelecimento_id = ? AND i.id = ? AND a.excluido_em IS NULL AND t.excluido_em IS NULL
          ORDER BY a.data_referencia DESC, a.id DESC`,
        [est, reg],
        { teto: 2000 },
      );
      return {
        metas: rs.map((r) => {
          const { reg, ...m } = metaDe(r);
          void reg;
          return { ...m, em: local(r['criado_em'], fuso) ?? '' };
        }),
        acompanhamentos: as.map((a) => ({
          id: n(a['id']),
          meta: n(a['terapia_nutricional_id']),
          data: dataIso(a['data_referencia']) ?? '',
          volumePrescritoMl: nn(a['volume_prescrito_ml']),
          volumeInfundidoMl: n(a['volume_infundido_ml']),
          origemVolume: texto(a['origem_volume']) as AcompanhamentoTerapiaRegistrado['origemVolume'],
          kcalAtingida: n(a['calorias_atingidas_kcal']),
          proteinaAtingidaG: n(a['proteina_atingida_g']),
          pctKcal: n(a['percentual_calorico']),
          pctProteina: n(a['percentual_proteico']),
          motivo: textoN(a['motivo_meta_nao_atingida']),
          observacao: textoN(a['observacao']),
          por: texto(a['login']),
          em: local(a['criado_em'], fuso) ?? '',
        })),
      };
    });
  }

  meta(c: ContextoNutricao, id: number): Promise<(MetaTerapiaRegistrada & { reg: number }) | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = (await l.consultar(`${SQL_METAS} AND t.id = ?`, [est, id], { teto: 1 }))[0];
      return r ? { ...metaDe(r), em: local(r['criado_em'], fuso) ?? '' } : null;
    });
  }

  fichas(c: ContextoNutricao, paciente: number): Promise<{ quantidade: number; ultima: string | null }> {
    // As fichas nutricionais do paciente: as triagens já feitas (em qualquer internação do estabelecimento).
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(
        `SELECT COUNT(*) AS q, MAX(triado_em) AS ultima FROM triagem_nutricional
          WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL AND situacao = 'ativo'`,
        [est, paciente],
      );
      return { quantidade: n(r?.['q']), ultima: local(r?.['ultima'], fuso) };
    });
  }

  sociais(c: ContextoNutricao, reg: number): Promise<RegistroSocialRegistrado[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_SOCIAIS} AND r.internacao_id = ? ORDER BY r.criado_em DESC, r.id DESC`,
          [est, reg],
          {
            teto: 1000,
          },
        )
      ).map((r) => socialDe(r, fuso)),
    );
  }

  /** O último registro social de cada internação (sem os adendos e os corrigidos). */
  ultimosSociais(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, { risco: RiscoSocial; tipo: TipoRegistroSocial; em: string }>> {
    if (regs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_SOCIAIS} AND r.internacao_id IN (${marcas(regs)}) AND r.tipo <> 'adendo' AND r.situacao = 'ativo'
            AND NOT EXISTS (SELECT 1 FROM correcao_registro_nutricao k
                             WHERE k.estabelecimento_id = r.estabelecimento_id AND k.tipo_registro = 'social'
                               AND k.registro_id = r.id)
          ORDER BY r.criado_em DESC, r.id DESC`,
        [est, ...regs],
        { teto: 5000 },
      );
      const m = new Map<number, { risco: RiscoSocial; tipo: TipoRegistroSocial; em: string }>();
      for (const r of rs) {
        const reg = n(r['internacao_id']);
        if (!m.has(reg))
          m.set(reg, {
            risco: texto(r['risco']) as RiscoSocial,
            tipo: texto(r['tipo']) as TipoRegistroSocial,
            em: local(r['criado_em'], fuso) ?? '',
          });
      }
      return m;
    });
  }

  barreirasSociais(c: ContextoNutricao, regs: readonly number[]): Promise<Map<number, number>> {
    if (regs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT b.internacao_id, COUNT(*) AS q FROM barreira_alta b
           JOIN internacao i ON i.id = b.internacao_id AND i.estabelecimento_id = ?
           JOIN tipo_barreira_alta t ON t.id = b.tipo_barreira_alta_id
          WHERE b.excluido_em IS NULL AND b.situacao = 'aberta' AND t.categoria = 'social'
            AND b.internacao_id IN (${marcas(regs)})
          GROUP BY b.internacao_id`,
        [est, ...regs],
        { teto: 5000 },
      );
      return new Map(rs.map((r) => [n(r['internacao_id']), n(r['q'])]));
    });
  }

  barreiras(c: ContextoNutricao, regs: readonly number[]): Promise<BarreiraAltaRegistrada[]> {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT b.id, b.internacao_id, t.codigo, b.descricao, ur.nome AS responsavel, b.prazo_em, b.situacao,
                  uc.login AS criada_por, b.identificada_em, b.resolvida_em
             FROM barreira_alta b
             JOIN internacao i ON i.id = b.internacao_id AND i.estabelecimento_id = ?
             JOIN tipo_barreira_alta t ON t.id = b.tipo_barreira_alta_id
             LEFT JOIN usuario ur ON ur.id = b.responsavel_usuario_id
             LEFT JOIN usuario uc ON uc.id = b.criado_por
            WHERE b.excluido_em IS NULL AND b.internacao_id IN (${marcas(regs)})
            ORDER BY b.identificada_em DESC, b.id DESC`,
          [est, ...regs],
          { teto: 5000 },
        )
      ).map((r) => {
        const codigo = texto(r['codigo']);
        const sit = texto(r['situacao']);
        return {
          id: n(r['id']),
          reg: n(r['internacao_id']),
          tipo: ((CODIGOS_TIPO_BARREIRA as readonly string[]).includes(codigo)
            ? codigo
            : 'outro') as TipoBarreiraAlta,
          descricao: texto(r['descricao']),
          responsavel: texto(r['responsavel']),
          prazo: local(r['prazo_em'], fuso) ?? '',
          situacao: (['aberta', 'resolvida', 'cancelada'].includes(sit)
            ? sit
            : 'aberta') as BarreiraAltaRegistrada['situacao'],
          criadaPor: texto(r['criada_por']),
          criadaEm: local(r['identificada_em'], fuso) ?? '',
          resolvidaEm: local(r['resolvida_em'], fuso),
        };
      }),
    );
  }

  unidades(c: ContextoNutricao): Promise<UnidadeInternacaoNutricao[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ui.codigo, ui.descricao,
                  (SELECT COUNT(*) FROM internacao i
                    WHERE i.unidade_internacao_id = ui.id AND i.estabelecimento_id = ui.estabelecimento_id
                      AND i.situacao IN ('ativa', 'alta_medica') AND i.excluido_em IS NULL) AS internados
             FROM unidade_internacao ui
            WHERE ui.estabelecimento_id = ? AND ui.ativo = TRUE AND ui.excluido_em IS NULL
            ORDER BY ui.codigo`,
          [est],
          { teto: 500 },
        )
      ).map((r) => ({
        unidade: texto(r['codigo']),
        nome: texto(r['descricao']),
        internados: n(r['internados']),
      })),
    );
  }

  refeicoes(c: ContextoNutricao): Promise<RefeicaoDoCadastro[]> {
    // As refeições do dia são um cadastro da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao, horario_inicio FROM refeicao_do_dia WHERE ativo = TRUE ORDER BY ordem, id',
          [],
          { teto: 50 },
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: texto(r['descricao']),
        horario: r['horario_inicio'] ? texto(r['horario_inicio']).slice(0, 5) : null,
      })),
    );
  }

  itensDieta(
    c: ContextoNutricao,
    atendimentos: readonly number[],
    servirEm: string,
  ): Promise<ItemDietaMapa[]> {
    if (atendimentos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const quando = instante(servirEm, fuso);
      const rs = await l.consultar(
        `SELECT p.atendimento_id, pi.id AS item, pid.id AS item_dieta, p.id AS prescricao, p.numero,
                pid.modalidade_dieta_id, md.descricao AS nome_dieta, pid.volume, pi.criado_em, p.vigencia_inicio_em,
                p.vigencia_fim_em, pi.suspenso_em
           FROM prescricao_item_dieta pid
           JOIN prescricao_item pi ON pi.id = pid.prescricao_item_id AND pi.excluido_em IS NULL
           JOIN prescricao p ON p.id = pi.prescricao_id AND p.excluido_em IS NULL
           JOIN modalidade_dieta md ON md.id = pid.modalidade_dieta_id
          WHERE p.estabelecimento_id = ? AND pid.excluido_em IS NULL AND p.situacao NOT IN ('rascunho', 'cancelada')
            AND p.vigencia_inicio_em <= ? AND p.vigencia_fim_em > ? AND p.atendimento_id IN (${marcas(atendimentos)})
          ORDER BY p.atendimento_id, pi.criado_em, pid.id`,
        [est, quando, quando, ...atendimentos],
        { teto: 5000 },
      );
      const ids = rs.map((r) => n(r['item_dieta']));
      const cars = ids.length
        ? await l.consultar(
            `SELECT pc.prescricao_item_dieta_id, cd.descricao, pc.resposta
               FROM prescricao_item_dieta_caracteristica pc
               JOIN caracteristica_dieta cd ON cd.id = pc.caracteristica_dieta_id
              WHERE pc.excluido_em IS NULL AND pc.prescricao_item_dieta_id IN (${marcas(ids)})
              ORDER BY pc.id`,
            ids,
            { teto: 20000 },
          )
        : [];
      return rs.map((r) => ({
        atendimento: n(r['atendimento_id']),
        item: n(r['item']),
        itemDieta: n(r['item_dieta']),
        prescricao: n(r['prescricao']),
        plano: n(r['numero']),
        dieta: nn(r['modalidade_dieta_id']),
        nomeDieta: textoN(r['nome_dieta']),
        quantidade: textoN(r['volume']),
        gravadaEm: local(r['criado_em'], fuso) ?? '',
        vigenciaInicio: local(r['vigencia_inicio_em'], fuso) ?? '',
        vigenciaFim: local(r['vigencia_fim_em'], fuso) ?? '',
        suspensaEm: local(r['suspenso_em'], fuso),
        caracteristicas: cars
          .filter((x) => n(x['prescricao_item_dieta_id']) === n(r['item_dieta']))
          .map((x) => ({ nome: texto(x['descricao']), resposta: textoN(x['resposta']) })),
      }));
    });
  }

  alergiasAlimentares(c: ContextoNutricao, pacientes: readonly number[]): Promise<Map<number, string[]>> {
    if (pacientes.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      // A alergia é do paciente (vale em qualquer estabelecimento da rede): o filtro é o paciente, com o alérgeno
      // alimentar ou a descrição livre de uma intolerância.
      void est;
      const rs = await l.consultar(
        `SELECT a.paciente_id, COALESCE(al.descricao, a.descricao_livre) AS descricao
           FROM alergia_paciente a
           LEFT JOIN alergeno al ON al.id = a.alergeno_id
          WHERE a.excluido_em IS NULL AND a.ativa = TRUE AND a.tipo_registro IN ('alergia', 'intolerancia')
            AND (al.natureza = 'alimento' OR (a.alergeno_id IS NULL AND a.tipo_registro = 'intolerancia'))
            AND a.paciente_id IN (${marcas(pacientes)})
          ORDER BY a.paciente_id, a.id`,
        [...pacientes],
        { teto: 5000 },
      );
      const m = new Map<number, string[]>();
      for (const r of rs) {
        const p = n(r['paciente_id']);
        const d = texto(r['descricao']);
        if (d) m.set(p, [...(m.get(p) ?? []), d]);
      }
      return m;
    });
  }

  cirurgias(c: ContextoNutricao, de: string, ate: string): Promise<CirurgiaDaJanela[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT a.id, a.paciente_id, i.id AS internacao, a.sala_cirurgica_id, a.inicio_previsto_em,
                  a.duracao_prevista_minutos
             FROM agendamento_cirurgico a
             LEFT JOIN internacao i ON i.atendimento_id = a.atendimento_id AND i.excluido_em IS NULL
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.cancelado_em IS NULL
              AND a.situacao NOT IN ('cancelado', 'suspenso', 'reprovado') AND a.inicio_previsto_em IS NOT NULL
              AND a.inicio_previsto_em >= ? AND a.inicio_previsto_em < ?
            ORDER BY a.inicio_previsto_em, a.id`,
          [est, instante(de, fuso), instante(ate, fuso)],
          { teto: 2000 },
        )
      ).map((r) => ({
        agendamento: n(r['id']),
        reg: nn(r['internacao']),
        pront: nn(r['paciente_id']),
        sala: n(r['sala_cirurgica_id']),
        inicio: local(r['inicio_previsto_em'], fuso) ?? '',
        duracaoMin: n(r['duracao_prevista_minutos']),
      })),
    );
  }

  async exames(): Promise<ExameDaJanela[]> {
    return []; // os exames com jejum da agenda aguardam o modelo (pedido do lote)
  }

  acompanhantesVigentes(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, RefeicaoAcompanhanteRegistrada>> {
    if (regs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est, fuso) => {
      const xs = await this.planos(
        l,
        fuso,
        `p.estabelecimento_id = ? AND p.internacao_id IN (${marcas(regs)}) AND p.situacao = 'ativa'`,
        [est, ...regs],
      );
      return new Map(xs.map((x) => [x.reg, x]));
    });
  }

  acompanhantes(c: ContextoNutricao, reg: number): Promise<RefeicaoAcompanhanteRegistrada[]> {
    return this.ler(c, (l, est, fuso) =>
      this.planos(l, fuso, 'p.estabelecimento_id = ? AND p.internacao_id = ?', [est, reg]),
    );
  }

  acompanhante(c: ContextoNutricao, id: number): Promise<RefeicaoAcompanhanteRegistrada | null> {
    return this.ler(
      c,
      async (l, est, fuso) =>
        (await this.planos(l, fuso, 'p.estabelecimento_id = ? AND p.id = ?', [est, id]))[0] ?? null,
    );
  }

  /** Os planos de refeição do acompanhante, com as refeições (o mais novo primeiro). */
  private async planos(
    l: Leitor,
    fuso: string,
    filtro: string,
    p: unknown[],
  ): Promise<RefeicaoAcompanhanteRegistrada[]> {
    const rs = await l.consultar(
      `SELECT p.id, p.internacao_id, p.direito_legal, p.inicio_em, p.fim_em, p.dieta, p.observacao, p.situacao,
              p.criado_em, u.login
         FROM plano_refeicao_acompanhante p
         LEFT JOIN usuario u ON u.id = p.criado_por
        WHERE ${filtro} AND p.excluido_em IS NULL
        ORDER BY p.criado_em DESC, p.id DESC`,
      p,
      { teto: 2000 },
    );
    if (rs.length === 0) return [];
    const ids = rs.map((r) => n(r['id']));
    const refeicoes = await l.consultar(
      `SELECT plano_refeicao_acompanhante_id AS plano, refeicao_do_dia_id AS refeicao
         FROM plano_refeicao_acompanhante_refeicao
        WHERE plano_refeicao_acompanhante_id IN (${marcas(ids)}) AND excluido_em IS NULL
        ORDER BY refeicao_do_dia_id`,
      ids,
      { teto: 20000 },
    );
    return rs.map((r) => ({
      id: n(r['id']),
      reg: n(r['internacao_id']),
      baseLegal: texto(r['direito_legal']) as RefeicaoAcompanhanteRegistrada['baseLegal'],
      refeicoes: refeicoes.filter((x) => n(x['plano']) === n(r['id'])).map((x) => n(x['refeicao'])),
      inicio: (local(r['inicio_em'], fuso) ?? '').slice(0, 10),
      fim: r['fim_em'] ? (local(r['fim_em'], fuso) ?? '').slice(0, 10) : null,
      observacao: textoN(r['observacao']),
      situacao: texto(r['situacao']) === 'ativa' ? 'ativa' : 'encerrada',
      por: texto(r['login']),
      em: local(r['criado_em'], fuso) ?? '',
      dieta: textoN(r['dieta']),
    }));
  }

  retrato(c: ContextoNutricao, unidade: string, refeicao: number, data: string): Promise<RetratoMapa | null> {
    return this.ler(c, async (l, est, fuso) => {
      const m = await l.uma(
        `SELECT m.id, m.horario_corte, m.fechado_em, u.login
           FROM mapa_dieta m
           JOIN unidade_internacao ui ON ui.id = m.unidade_internacao_id
           LEFT JOIN usuario u ON u.id = m.fechado_por_usuario_id
          WHERE m.estabelecimento_id = ? AND ui.codigo = ? AND m.refeicao_do_dia_id = ? AND m.data_referencia = ?
            AND m.excluido_em IS NULL AND m.situacao <> 'cancelado'
          ORDER BY m.id DESC LIMIT 1`,
        [est, unidade, refeicao, data],
      );
      if (!m) return null;
      const linhas = await l.consultar(
        `SELECT i.id AS internacao, ac.codigo AS acomod, lh.codigo AS leito, it.jejum, it.jejum_motivo,
                it.prescricao_item_dieta_id, md.descricao AS dieta, md.classe, it.caracteristicas
           FROM mapa_dieta_item it
           JOIN internacao i ON i.atendimento_id = it.atendimento_id AND i.excluido_em IS NULL
           LEFT JOIN leito_hospitalar lh ON lh.id = COALESCE(it.leito_hospitalar_id, i.leito_hospitalar_id)
           LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
           LEFT JOIN modalidade_dieta md ON md.id = it.modalidade_dieta_id
          WHERE it.mapa_dieta_id = ? AND it.excluido_em IS NULL
          ORDER BY it.sequencia`,
        [n(m['id'])],
        { teto: 2000 },
      );
      const tipoDe = (r: Linha): TipoLinhaMapa =>
        verdadeiro(r['jejum'])
          ? 'jejum'
          : ((TIPOS_LINHA.includes(texto(r['classe'])) ? texto(r['classe']) : 'oral') as TipoLinhaMapa);
      return {
        id: n(m['id']),
        corteEm: local(m['horario_corte'], fuso) ?? '',
        itens: linhas.length,
        jejuns: linhas.filter((r) => verdadeiro(r['jejum'])).length,
        hash: '', // o hash do mapa aguarda a coluna (pedido do lote)
        por: texto(m['login']),
        em: local(m['fechado_em'], fuso) ?? '',
        linhas: linhas.map((r) => {
          const acomodacao = texto(r['acomod']);
          const leito = texto(r['leito']);
          return {
            reg: n(r['internacao']),
            acomodacao,
            leito: leito ? `${acomodacao}-${leito}` : acomodacao,
            tipo: tipoDe(r),
            itemDieta: nn(r['prescricao_item_dieta_id']),
            dieta: textoN(r['dieta']),
            caracteristicas: textoN(r['caracteristicas']),
            jejumOrigem: textoN(r['jejum_motivo']),
          };
        }),
      };
    });
  }

  correcoes(
    c: ContextoNutricao,
    registro: RegistroCorrigivel,
    ids: readonly number[],
  ): Promise<{ inativa: Map<number, CorrecaoRegistrada>; substitui: Map<number, number> }> {
    const vazio = { inativa: new Map<number, CorrecaoRegistrada>(), substitui: new Map<number, number>() };
    if (ids.length === 0) return Promise.resolve(vazio);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT k.registro_id, k.acao, k.novo_registro_id, k.motivo, k.criado_em, u.login
           FROM correcao_registro_nutricao k
           LEFT JOIN usuario u ON u.id = k.criado_por
          WHERE k.estabelecimento_id = ? AND k.tipo_registro = ?
            AND (k.registro_id IN (${marcas(ids)}) OR k.novo_registro_id IN (${marcas(ids)}))`,
        [est, registro, ...ids, ...ids],
        { teto: 5000 },
      );
      for (const r of rs) {
        const antigo = n(r['registro_id']);
        const novo = nn(r['novo_registro_id']);
        if (ids.includes(antigo))
          vazio.inativa.set(antigo, {
            registro,
            idRegistro: antigo,
            acao: ACAO_DA_TELA[texto(r['acao'])] ?? 'estorno',
            idNovo: novo,
            motivo: texto(r['motivo']),
            por: texto(r['login']),
            em: local(r['criado_em'], fuso) ?? '',
          });
        if (novo !== null && ids.includes(novo)) vazio.substitui.set(novo, antigo);
      }
      return vazio;
    });
  }

  internacaoDoRegistro(
    c: ContextoNutricao,
    registro: RegistroCorrigivel,
    id: number,
  ): Promise<number | null> {
    return this.ler(c, (l, est) => internacaoDoRegistroEm(l, est, registro, id));
  }

  avaliacoesNpt(c: ContextoNutricao, reg: number): Promise<AvaliacaoNptLida[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT a.id, a.terapia_nutricional_id, a.parecer, a.acesso, a.osmolaridade_mosm_l, a.estavel, a.compativel,
                  a.observacao, a.criado_em, u.login
             FROM avaliacao_nutricao_parenteral a
             JOIN terapia_nutricional t ON t.id = a.terapia_nutricional_id
             JOIN internacao i ON i.atendimento_id = t.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
             LEFT JOIN usuario u ON u.id = a.criado_por
            WHERE t.estabelecimento_id = ? AND i.id = ? AND a.excluido_em IS NULL
            ORDER BY a.criado_em DESC, a.id DESC`,
          [est, reg],
          { teto: 500 },
        )
      ).map((a) => ({
        id: n(a['id']),
        meta: n(a['terapia_nutricional_id']),
        parecer: texto(a['parecer']) as AvaliacaoNptLida['parecer'],
        acesso: texto(a['acesso']) as AvaliacaoNptLida['acesso'],
        osmolaridade: n(a['osmolaridade_mosm_l']),
        estabilidade: verdadeiro(a['estavel']),
        compatibilidade: verdadeiro(a['compativel']),
        observacao: textoN(a['observacao']),
        por: texto(a['login']),
        em: local(a['criado_em'], fuso) ?? '',
      })),
    );
  }

  async balancoParenteral(): Promise<VolumeBalanco[]> {
    return []; // o volume parenteral do balanço aguarda o modelo (pedido do lote)
  }

  /** O histórico de alteração do plano do acompanhante aguarda a tabela de eventos (pedido): nenhum foi gravado. */
  async alteracoesAcompanhante(): Promise<AlteracaoHotelariaRegistrada[]> {
    return [];
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaNutricaoIndisponivel(): PortaNutricao {
  return portaIndisponivel<PortaNutricao>(METODOS_PORTA_NUTRICAO);
}
