// Auditoria da profilaxia antimicrobiana cirúrgica (F8, 04-CC linha 106), no banco do cliente
// (`protocolo_profilaxia_cirurgica`, `auditoria_profilaxia_cirurgica`). Contrato de efeito:
//   - protocolos: leitura do cadastro do estabelecimento com as opções (procedimento, grupo, classe de contaminação,
//     antimicrobiano, unidade e via); inclusão validada pela regra do domínio (a mesma da tela), com o antimicrobiano
//     de infusão longa aceitando a janela de 120 minutos; ativação e desativação pela versão lida (nada apagado);
//   - auditar: lê a incisão, o fim e o peso do registro do ato no bloco, os protocolos vigentes na data da incisão
//     para os procedimentos do ato (procedimento ou grupo; classe de contaminação quando o protocolo a define) e as
//     administrações de antimicrobiano checadas no prontuário do atendimento (pela ficha do antimicrobiano ou pelo
//     princípio ativo do item prescrito), aplica a regra do domínio e grava uma linha nova da auditoria com o
//     avaliador, o instante e a justificativa da comissão. A auditoria vigente anterior recebe a marca de exclusão
//     (histórico preservado, nunca apagado). A linha do ato fica travada na transação (duas auditorias simultâneas
//     passam uma de cada vez);
//   - painel da CCIH: as cirurgias do período (pela data da incisão) com o paciente, o procedimento principal e a
//     auditoria vigente, e os indicadores (conformidade, momento e duração adequados).
import {
  type AdministracaoProfilaxia,
  auditarProfilaxia,
  conferirProtocoloProfilaxia,
  exigeJanelaLonga,
  indicadoresProfilaxia,
  type ItemProfilaxiaPrescrito,
  type ProtocoloProfilaxia,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_PROFILAXIA_CIRURGICA = Symbol('PORTA_PROFILAXIA_CIRURGICA');

const PROTOCOLO = 'protocolo_profilaxia_cirurgica';
const AUDITORIA = 'auditoria_profilaxia_cirurgica';
const ATO = 'ato_cirurgico';
const ERRNO_LINHA_MUDOU = 1020;
const HORA = 3_600_000;

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const idOuNull = id.nullable().optional();
const minutos = z.number().int().min(0).max(1440).nullable().optional();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaProtocolo = z
  .object({
    procedimento: idOuNull,
    grupo: idOuNull,
    classeContaminacao: idOuNull,
    antimicrobiano: id,
    itemPrescritivel: idOuNull,
    dose: z.number().positive().max(1e9),
    dosePorKg: z.boolean().default(false),
    unidade: id,
    via: idOuNull,
    antesMinimo: minutos,
    antesMaximo: minutos,
    intervaloRepiqueHoras: z.number().positive().max(999).nullable().optional(),
    duracaoMaximaHoras: z.number().int().positive().max(999).nullable().optional(),
    alternativaAlergia: z.boolean().default(false),
    ordem: z.number().int().min(1).max(99).default(1),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const esquemaAtivo = z.object({ versao: id, ativo: z.boolean() }).strict();
const esquemaAuditar = z
  .object({ justificativa: z.string().trim().max(4000).nullable().optional() })
  .strict();
const esquemaPeriodo = z.object({ de: data, ate: data }).strict();

export interface ProtocoloProfilaxiaLido {
  readonly id: number;
  readonly versao: number;
  readonly ativo: boolean;
  readonly procedimento: number | null;
  readonly procedimentoDescricao: string | null;
  readonly grupo: number | null;
  readonly grupoDescricao: string | null;
  readonly classeContaminacao: number | null;
  readonly classeDescricao: string | null;
  readonly antimicrobiano: number;
  readonly antimicrobianoDescricao: string;
  readonly dose: number;
  readonly dosePorKg: boolean;
  readonly unidade: number;
  readonly unidadeSigla: string;
  readonly via: number | null;
  readonly viaDescricao: string | null;
  readonly antesMinimo: number | null;
  readonly antesMaximo: number | null;
  /** A janela que vale na auditoria (a cadastrada ou a padrão pelo antimicrobiano). */
  readonly janelaMaxima: number;
  readonly intervaloRepiqueHoras: number | null;
  readonly duracaoMaximaHoras: number | null;
  readonly alternativaAlergia: boolean;
  readonly ordem: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly observacao: string | null;
}

const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const instante = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));
const boolOuNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));

const SQL_PROTOCOLOS = `
  SELECT pp.id, pp.versao, pp.ativo, pp.procedimento_cirurgico_id, pc.descricao AS proc_desc,
         pp.grupo_procedimento_cirurgico_id, g.descricao AS grupo_desc,
         pp.classe_contaminacao_cirurgica_id, cc.descricao AS classe_desc,
         pp.antimicrobiano_id, am.descricao AS am_desc, ca.descricao AS am_classe,
         pp.dose, pp.dose_por_kg, pp.unidade_medida_id, um.sigla AS um_sigla, pp.via_de_uso_id, v.descricao AS via_desc,
         pp.antes_incisao_minimo_minutos, pp.antes_incisao_maximo_minutos, pp.intervalo_repique_horas,
         pp.duracao_maxima_horas, pp.alternativa_alergia, pp.ordem_preferencia, pp.vigencia_inicio, pp.vigencia_fim,
         pp.observacao
    FROM protocolo_profilaxia_cirurgica pp
    JOIN antimicrobiano am ON am.id = pp.antimicrobiano_id
    LEFT JOIN classe_antimicrobiano ca ON ca.id = am.classe_antimicrobiano_id
    JOIN unidade_medida um ON um.id = pp.unidade_medida_id
    LEFT JOIN procedimento_cirurgico pc ON pc.id = pp.procedimento_cirurgico_id
    LEFT JOIN grupo_procedimento_cirurgico g ON g.id = pp.grupo_procedimento_cirurgico_id
    LEFT JOIN classe_contaminacao_cirurgica cc ON cc.id = pp.classe_contaminacao_cirurgica_id
    LEFT JOIN via_de_uso v ON v.id = pp.via_de_uso_id`;

function protocoloRegra(r: Linha): ProtocoloProfilaxia {
  return {
    id: num(r['id']),
    antimicrobiano: num(r['antimicrobiano_id']),
    nomeAntimicrobiano: String(r['am_desc'] ?? ''),
    classe: txtOuNull(r['am_classe']),
    dose: num(r['dose']),
    dosePorKg: bool(r['dose_por_kg']),
    unidade: num(r['unidade_medida_id']),
    via: numOuNull(r['via_de_uso_id']),
    antesMinimo: numOuNull(r['antes_incisao_minimo_minutos']),
    antesMaximo: numOuNull(r['antes_incisao_maximo_minutos']),
    intervaloRepiqueHoras: numOuNull(r['intervalo_repique_horas']),
    duracaoMaximaHoras: numOuNull(r['duracao_maxima_horas']),
    ordem: num(r['ordem_preferencia']),
  };
}

function protocoloLido(r: Linha): ProtocoloProfilaxiaLido {
  const p = protocoloRegra(r);
  return {
    id: p.id,
    versao: num(r['versao']),
    ativo: bool(r['ativo']),
    procedimento: numOuNull(r['procedimento_cirurgico_id']),
    procedimentoDescricao: txtOuNull(r['proc_desc']),
    grupo: numOuNull(r['grupo_procedimento_cirurgico_id']),
    grupoDescricao: txtOuNull(r['grupo_desc']),
    classeContaminacao: numOuNull(r['classe_contaminacao_cirurgica_id']),
    classeDescricao: txtOuNull(r['classe_desc']),
    antimicrobiano: p.antimicrobiano,
    antimicrobianoDescricao: p.nomeAntimicrobiano,
    dose: p.dose,
    dosePorKg: p.dosePorKg,
    unidade: p.unidade,
    unidadeSigla: String(r['um_sigla'] ?? ''),
    via: p.via,
    viaDescricao: txtOuNull(r['via_desc']),
    antesMinimo: p.antesMinimo,
    antesMaximo: p.antesMaximo,
    janelaMaxima: p.antesMaximo ?? (exigeJanelaLonga(p.nomeAntimicrobiano, p.classe) ? 120 : 60),
    intervaloRepiqueHoras: p.intervaloRepiqueHoras,
    duracaoMaximaHoras: p.duracaoMaximaHoras,
    alternativaAlergia: bool(r['alternativa_alergia']),
    ordem: p.ordem,
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    observacao: txtOuNull(r['observacao']),
  };
}

const opcoesDe = async (l: Leitor, sql: string) =>
  (await l.consultar<Linha>(sql)).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) }));

/** As administrações de antimicrobiano checadas no atendimento, na janela da cirurgia (um registro por horário). */
const SQL_ADMINISTRACOES = `
  SELECT h.id, h.prescricao_item_id, h.administrado_em, h.quantidade_administrada, pi.via_de_uso_id,
         up.unidade_medida_id, up.fator_conversao, COALESCE(fa.antimicrobiano_id, am.id) AS antimicrobiano
    FROM horario_administracao h
    JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
    LEFT JOIN unidade_prescricao up ON up.id = COALESCE(h.unidade_prescricao_id, pi.unidade_prescricao_id)
    LEFT JOIN ficha_antimicrobiano fa ON fa.prescricao_item_id = pi.id
    LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
    LEFT JOIN antimicrobiano am ON ip.principio_ativo_id IS NOT NULL AND am.principio_ativo_id = ip.principio_ativo_id
   WHERE h.atendimento_id = ? AND h.estabelecimento_id = ? AND h.administrado_em IS NOT NULL
     AND h.administrado_em BETWEEN ? AND ? AND (fa.id IS NOT NULL OR am.id IS NOT NULL)
   ORDER BY h.administrado_em, h.id`;

/** Os itens prescritos de antimicrobiano do atendimento que cruzam a janela, com o encerramento. */
const SQL_ITENS = `
  SELECT pi.id, COALESCE(fa.antimicrobiano_id, am.id) AS antimicrobiano,
         COALESCE(pi.suspenso_em, pi.fim_em, IF(pi.situacao <> 'ativo', pi.alterado_em, NULL)) AS encerrado_em
    FROM prescricao_item pi
    JOIN prescricao p ON p.id = pi.prescricao_id
    LEFT JOIN ficha_antimicrobiano fa ON fa.prescricao_item_id = pi.id
    LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
    LEFT JOIN antimicrobiano am ON ip.principio_ativo_id IS NOT NULL AND am.principio_ativo_id = ip.principio_ativo_id
   WHERE p.atendimento_id = ? AND p.estabelecimento_id = ? AND pi.inicio_em <= ?
     AND (pi.fim_em IS NULL OR pi.fim_em >= ?) AND (fa.id IS NOT NULL OR am.id IS NOT NULL)
   ORDER BY pi.id`;

export class PortaProfilaxiaCirurgicaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [PROTOCOLO, AUDITORIA, ATO], 'cirurgia.profilaxia');
  }

  /** O cadastro dos protocolos do estabelecimento e as opções da tela. */
  protocolos(c: ContextoPortaPropria) {
    return this.ler(c, 'protocolos', async (l, est) => ({
      protocolos: (
        await l.consultar<Linha>(
          `${SQL_PROTOCOLOS} WHERE pp.estabelecimento_id = ? ORDER BY pp.ativo DESC, pp.ordem_preferencia, pp.id`,
          [est.id],
        )
      ).map(protocoloLido),
      opcoes: {
        procedimentos: await opcoesDe(
          l,
          `SELECT id, CONCAT(codigo, ' - ', descricao) AS rotulo FROM procedimento_cirurgico
            WHERE ativo AND excluido_em IS NULL ORDER BY descricao LIMIT 2000`,
        ),
        grupos: await opcoesDe(
          l,
          'SELECT id, descricao AS rotulo FROM grupo_procedimento_cirurgico WHERE ativo ORDER BY descricao LIMIT 500',
        ),
        classes: await opcoesDe(
          l,
          'SELECT id, descricao AS rotulo FROM classe_contaminacao_cirurgica WHERE ativo ORDER BY id LIMIT 50',
        ),
        antimicrobianos: (
          await l.consultar<Linha>(
            `SELECT a.id, a.descricao AS rotulo, c.descricao AS classe FROM antimicrobiano a
               LEFT JOIN classe_antimicrobiano c ON c.id = a.classe_antimicrobiano_id
              WHERE a.ativo ORDER BY a.descricao LIMIT 1000`,
          )
        ).map((r) => ({
          id: num(r['id']),
          rotulo: String(r['rotulo']),
          janelaLonga: exigeJanelaLonga(String(r['rotulo']), txtOuNull(r['classe'])),
        })),
        unidades: await opcoesDe(
          l,
          'SELECT id, sigla AS rotulo FROM unidade_medida WHERE ativo ORDER BY sigla LIMIT 1000',
        ),
        vias: await opcoesDe(
          l,
          'SELECT id, descricao AS rotulo FROM via_de_uso WHERE ativo ORDER BY descricao LIMIT 200',
        ),
      },
    }));
  }

  /** Inclui o protocolo, validado pela regra do domínio (a mesma da tela). */
  async incluirProtocolo(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaProtocolo, entrada);
    return this.gravar(c, 'cirurgia.profilaxia.protocolo-incluir', [PROTOCOLO], async (tx, est) => {
      const am = await tx.uma(
        `SELECT a.descricao, c.descricao AS classe FROM antimicrobiano a
           LEFT JOIN classe_antimicrobiano c ON c.id = a.classe_antimicrobiano_id WHERE a.id = ? AND a.ativo`,
        [e.antimicrobiano],
      );
      if (!am) throw naoEncontrado('Antimicrobiano');
      if (e.procedimento) {
        const pc = await tx.uma(
          'SELECT id FROM procedimento_cirurgico WHERE id = ? AND excluido_em IS NULL',
          [e.procedimento],
        );
        if (!pc) throw naoEncontrado('Procedimento cirúrgico');
      }
      const problemas = conferirProtocoloProfilaxia(
        {
          procedimento: e.procedimento ?? null,
          grupo: e.grupo ?? null,
          antimicrobiano: e.antimicrobiano,
          dose: e.dose,
          dosePorKg: e.dosePorKg,
          unidade: e.unidade,
          antesMinimo: e.antesMinimo ?? null,
          antesMaximo: e.antesMaximo ?? null,
          intervaloRepiqueHoras: e.intervaloRepiqueHoras ?? null,
          duracaoMaximaHoras: e.duracaoMaximaHoras ?? null,
          vigenciaInicio: e.vigenciaInicio,
          vigenciaFim: e.vigenciaFim ?? null,
        },
        exigeJanelaLonga(String(am['descricao']), txtOuNull(am['classe'])),
      );
      if (problemas.length) throw recusaRegra('Protocolo de profilaxia recusado', problemas);
      const novo = await tx.incluir(PROTOCOLO, {
        estabelecimento_id: est.id,
        procedimento_cirurgico_id: e.procedimento ?? null,
        grupo_procedimento_cirurgico_id: e.grupo ?? null,
        classe_contaminacao_cirurgica_id: e.classeContaminacao ?? null,
        antimicrobiano_id: e.antimicrobiano,
        item_prescritivel_id: e.itemPrescritivel ?? null,
        dose: e.dose,
        unidade_medida_id: e.unidade,
        dose_por_kg: e.dosePorKg,
        via_de_uso_id: e.via ?? null,
        antes_incisao_minimo_minutos: e.antesMinimo ?? null,
        antes_incisao_maximo_minutos: e.antesMaximo ?? null,
        intervalo_repique_horas: e.intervaloRepiqueHoras ?? null,
        duracao_maxima_horas: e.duracaoMaximaHoras ?? null,
        alternativa_alergia: e.alternativaAlergia,
        ordem_preferencia: e.ordem,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim ?? null,
        ativo: true,
        observacao: e.observacao || null,
      });
      return { tabela: PROTOCOLO, id: novo };
    });
  }

  /** Ativa ou desativa o protocolo pela versão lida (nada apagado). */
  async ativarProtocolo(c: ContextoPortaPropria, protocolo: number, entrada: unknown) {
    const e = entradaValida(esquemaAtivo, entrada);
    return this.gravar(c, 'cirurgia.profilaxia.protocolo-ativo', [PROTOCOLO], async (tx, est) => {
      const p = await tx.uma(
        'SELECT id FROM protocolo_profilaxia_cirurgica WHERE id = ? AND estabelecimento_id = ?',
        [protocolo, est.id],
      );
      if (!p) throw naoEncontrado('Protocolo de profilaxia');
      await tx.alterar(PROTOCOLO, protocolo, e.versao, { ativo: e.ativo });
      return { tabela: PROTOCOLO, id: protocolo, ativo: e.ativo };
    });
  }

  /** Audita a profilaxia do ato e grava a linha nova (a vigente anterior fica no histórico, com a marca de exclusão). */
  async auditar(c: ContextoPortaPropria, ato: number, entrada: unknown) {
    const e = entradaValida(esquemaAuditar, entrada ?? {});
    return this.gravarSemCorrida(c, 'cirurgia.profilaxia.auditar', async (tx, est, usuario) => {
      const [a] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, atendimento_id, inicio_cirurgia_em, fim_cirurgia_em, peso_kg, classe_contaminacao_cirurgica_id,
                situacao FROM ato_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [ato, est.id],
      );
      if (!a) throw naoEncontrado('Ato cirúrgico');
      if (String(a['situacao']) === 'cancelado')
        throw recusaRegra('Auditoria recusada', [
          { campo: 'ato', mensagem: 'A cirurgia foi cancelada: não há profilaxia a auditar.' },
        ]);
      const incisao = instante(a['inicio_cirurgia_em']);
      const fim = instante(a['fim_cirurgia_em']);
      const protocolos = incisao
        ? (
            await tx.consultar<Linha>(
              `${SQL_PROTOCOLOS}
                WHERE pp.estabelecimento_id = ? AND pp.ativo AND pp.vigencia_inicio <= ?
                  AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= ?)
                  AND (pp.classe_contaminacao_cirurgica_id IS NULL OR pp.classe_contaminacao_cirurgica_id = ?)
                  AND EXISTS (SELECT 1 FROM ato_cirurgico_procedimento ap
                                JOIN procedimento_cirurgico px ON px.id = ap.procedimento_cirurgico_id
                               WHERE ap.ato_cirurgico_id = ? AND ap.excluido_em IS NULL
                                 AND (px.id = pp.procedimento_cirurgico_id
                                      OR px.grupo_procedimento_cirurgico_id = pp.grupo_procedimento_cirurgico_id))
                ORDER BY pp.ordem_preferencia, pp.procedimento_cirurgico_id IS NULL, pp.id`,
              [
                est.id,
                dataIso(incisao),
                dataIso(incisao),
                numOuNull(a['classe_contaminacao_cirurgica_id']),
                ato,
              ],
            )
          ).map(protocoloRegra)
        : [];
      const atendimento = num(a['atendimento_id']);
      const desde = incisao ? new Date(incisao.getTime() - 24 * HORA) : null;
      const ate = incisao ? new Date((fim ?? incisao).getTime() + 72 * HORA) : null;
      const vistos = new Set<number>();
      const administracoes: AdministracaoProfilaxia[] = incisao
        ? (await tx.consultar<Linha>(SQL_ADMINISTRACOES, [atendimento, est.id, desde, ate]))
            .filter((r) => !vistos.has(num(r['id'])) && vistos.add(num(r['id'])))
            .map((r) => {
              const q = numOuNull(r['quantidade_administrada']);
              const unidade = numOuNull(r['unidade_medida_id']);
              return {
                prescricaoItem: num(r['prescricao_item_id']),
                antimicrobiano: numOuNull(r['antimicrobiano']),
                administradoEm: instante(r['administrado_em'])!,
                dose: q !== null && unidade !== null ? q * (numOuNull(r['fator_conversao']) ?? 1) : null,
                unidade,
                via: numOuNull(r['via_de_uso_id']),
              };
            })
        : [];
      const itens: ItemProfilaxiaPrescrito[] = incisao
        ? (await tx.consultar<Linha>(SQL_ITENS, [atendimento, est.id, ate, desde])).map((r) => ({
            prescricaoItem: num(r['id']),
            antimicrobiano: numOuNull(r['antimicrobiano']),
            encerradoEm: instante(r['encerrado_em']),
          }))
        : [];
      const r = auditarProfilaxia(
        { incisao, fim, pesoKg: numOuNull(a['peso_kg']) },
        protocolos,
        administracoes,
        itens,
        new Date(),
      );
      const anteriores = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM auditoria_profilaxia_cirurgica WHERE ato_cirurgico_id = ? AND excluido_em IS NULL',
        [ato],
      );
      const agora = new Date();
      for (const x of anteriores)
        await tx.alterar(AUDITORIA, num(x['id']), num(x['versao']), {
          excluido_em: agora,
          excluido_por: usuario,
        });
      const nova = await tx.incluir(AUDITORIA, {
        ato_cirurgico_id: ato,
        protocolo_profilaxia_cirurgica_id: r.protocolo,
        antimicrobiano_id: r.antimicrobiano,
        prescricao_item_id: r.prescricaoItem,
        administrado_em: r.administradoEm,
        avaliavel: r.avaliavel,
        droga_adequada: r.drogaAdequada,
        dose_adequada: r.doseAdequada,
        momento_adequado: r.momentoAdequado,
        via_adequada: r.viaAdequada,
        repique_adequado: r.repiqueAdequado,
        duracao_adequada: r.duracaoAdequada,
        situacao: r.situacao,
        avaliador_usuario_id: usuario,
        avaliado_em: agora,
        justificativa: e.justificativa || null,
        origem: 'sistema',
      });
      return {
        tabela: AUDITORIA,
        id: nova,
        ato,
        substituidas: anteriores.length,
        ...r,
        administradoEm: r.administradoEm ? r.administradoEm.toISOString() : null,
      };
    });
  }

  /** O painel da CCIH: as cirurgias do período (pela incisão), a auditoria vigente e os indicadores. */
  async painel(c: ContextoPortaPropria, consulta: unknown) {
    const q = entradaValida(esquemaPeriodo, consulta);
    if (q.ate < q.de)
      throw recusaRegra('Período inválido', [
        { campo: 'ate', mensagem: 'O fim do período é antes do início.' },
      ]);
    return this.ler(c, 'painel', async (l, est) => {
      const rs = await l.consultar<Linha>(
        `SELECT a.id, a.numero, a.atendimento_id, a.inicio_cirurgia_em, a.fim_cirurgia_em, a.situacao AS ato_situacao,
                pac.numero_prontuario, pf.nome AS paciente, pc.descricao AS procedimento,
                au.id AS auditoria, au.versao, au.situacao, au.avaliavel, au.droga_adequada, au.dose_adequada,
                au.momento_adequado, au.via_adequada, au.repique_adequado, au.duracao_adequada, au.administrado_em,
                au.avaliado_em, au.justificativa, am.descricao AS antimicrobiano
           FROM ato_cirurgico a
           JOIN paciente pac ON pac.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
           LEFT JOIN ato_cirurgico_procedimento ap ON ap.ato_cirurgico_id = a.id AND ap.principal AND ap.excluido_em IS NULL
           LEFT JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
           LEFT JOIN auditoria_profilaxia_cirurgica au ON au.ato_cirurgico_id = a.id AND au.excluido_em IS NULL
           LEFT JOIN antimicrobiano am ON am.id = au.antimicrobiano_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
            AND a.inicio_cirurgia_em >= ? AND a.inicio_cirurgia_em < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY a.inicio_cirurgia_em DESC, a.id DESC LIMIT 500`,
        [est.id, q.de, q.ate],
      );
      const cirurgias = rs.map((r) => ({
        ato: num(r['id']),
        numero: String(r['numero']),
        atendimento: num(r['atendimento_id']),
        prontuario: txtOuNull(r['numero_prontuario']),
        paciente: String(r['paciente'] ?? ''),
        procedimento: txtOuNull(r['procedimento']),
        incisao: instante(r['inicio_cirurgia_em'])?.toISOString() ?? null,
        fim: instante(r['fim_cirurgia_em'])?.toISOString() ?? null,
        auditoria:
          r['auditoria'] === null || r['auditoria'] === undefined
            ? null
            : {
                id: num(r['auditoria']),
                versao: num(r['versao']),
                situacao: String(r['situacao']),
                avaliavel: bool(r['avaliavel']),
                antimicrobiano: txtOuNull(r['antimicrobiano']),
                administradoEm: instante(r['administrado_em'])?.toISOString() ?? null,
                drogaAdequada: boolOuNull(r['droga_adequada']),
                doseAdequada: boolOuNull(r['dose_adequada']),
                momentoAdequado: boolOuNull(r['momento_adequado']),
                viaAdequada: boolOuNull(r['via_adequada']),
                repiqueAdequado: boolOuNull(r['repique_adequado']),
                duracaoAdequada: boolOuNull(r['duracao_adequada']),
                avaliadoEm: instante(r['avaliado_em'])?.toISOString() ?? null,
                justificativa: txtOuNull(r['justificativa']),
              },
      }));
      const auditorias = cirurgias.flatMap((x) => (x.auditoria ? [x.auditoria] : []));
      return {
        de: q.de,
        ate: q.ate,
        indicadores: indicadoresProfilaxia(cirurgias.length, auditorias),
        cirurgias,
      };
    });
  }

  /**
   * A leitura com trava de uma linha que outra transação confirmou depois do instantâneo desta é recusada pelo banco
   * (erro 1020): vira 409, nada gravado, para a tela reler e tentar de novo.
   */
  private async gravarSemCorrida<T extends Record<string, unknown>>(
    c: ContextoPortaPropria,
    nome: string,
    fn: (
      tx: TxOperacao,
      est: { id: number; fuso: string },
      usuario: number,
    ) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
    try {
      return await this.gravar(c, nome, [AUDITORIA, ATO], fn);
    } catch (erro) {
      if ((erro as { errno?: unknown } | null)?.errno === ERRNO_LINHA_MUDOU)
        throw new ErroOperacao(
          409,
          'gravacao-concorrente',
          'Gravação simultânea',
          'Outra auditoria desta cirurgia foi gravada ao mesmo tempo. Nada foi gravado: confira e audite de novo.',
        );
      throw erro;
    }
  }
}
