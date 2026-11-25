// Detalhe de cada tipo de item da prescrição no banco próprio (03-PEP L105): medicamento com as condições de "se
// necessário", dieta com as características, solução em etapas (componentes e a velocidade de cada etapa) e suporte
// ventilatório invasivo e não invasivo. A coerência clínica é do domínio (conferirItemGravavel e as conferências de
// cadastro); aqui fica a leitura dos cadastros e a tradução para as tabelas. Tudo na transação da prescrição; nada é
// apagado. Parâmetro não prescrito fica NULL. As etapas da solução vão a prescricao_item_solucao_etapa;
// prescricao_item_velocidade fica só para as mudanças de velocidade posteriores (titulação, enfermagem).
// Também: medicamento não padronizado (o pedido em item_nao_padronizado, com a justificativa) e o kit do medicamento
// (prescricao_item_material marcado item_de_kit); cuidado de enfermagem (prescricao_item_cuidado), procedimento ou
// exame (prescricao_item_procedimento), "se necessário" do procedimento e a escala por glicemia
// (prescricao_item_glicemia); hemocomponente (prescricao_item_hemocomponente, que a agência transfusional usa para
// abrir a requisição).
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import {
  conferirCategoriaDoDetalhe,
  conferirItemGravavel,
  conferirVentilacaoNoCadastro,
  MENSAGENS_ITEM_GRAVAVEL,
  mlPorHoraDaSigla,
  type RecusaItemGravavel,
} from '@sgh/dominio-pep';
import type { ItemGravacao } from './tipos-pep.js';

type Detalhe = ItemGravacao['detalhe'];

const verdadeiro = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);
const recusaDoDominio = (r: RecusaItemGravavel | null): void => {
  if (r) throw recusar(422, r, MENSAGENS_ITEM_GRAVAVEL[r]);
};

/** O tipo do item (categoria do cadastro) tem de casar com o detalhe prescrito (plano do legado ou tipo próprio). */
export function conferirCategoriaDoItem(categoria: string, d: Detalhe): void {
  recusaDoDominio(conferirCategoriaDoDetalhe(categoria, d.tipo));
}

/**
 * Coerência clínica de todos os tipos (domínio) antes de gravar. A vigência (civil), quando vem, limita as etapas da
 * solução.
 */
export function conferirItensGravaveis(
  itens: readonly ItemGravacao[],
  vigencia: { readonly inicio: string; readonly fim: string } | null = null,
): void {
  for (const it of itens) {
    const d = it.detalhe;
    if (d.tipo === 'dieta' && d.caracteristicas.some((c) => c.resposta.length > 50))
      throw recusar(
        422,
        'dieta-resposta-longa',
        'A resposta da característica da dieta vai até 50 caracteres.',
      );
    recusaDoDominio(conferirItemGravavel(d, { horarios: it.horarios.length, vigencia }));
  }
}

/** Categoria do tipo de item quando o plano não é próprio: a do detalhe. */
export function categoriaDoDetalhe(d: Detalhe): string {
  if (d.tipo === 'vmi' || d.tipo === 'vni') return 'ventilacao';
  if (d.tipo === 'hemoterapia') return 'hemocomponente';
  return d.tipo;
}

/**
 * O item prescritível que identifica o item: o produto do medicamento padronizado, o procedimento ou cuidado, ou o
 * componente principal da solução. O não padronizado fica no pedido (item_nao_padronizado), sem item prescritível.
 */
export function produtoDoItem(d: Detalhe): number | null {
  if (d.tipo === 'medicamento') return d.naoPadronizado ? null : d.produto;
  if (d.tipo === 'procedimento') return d.procedimento;
  if (d.tipo === 'solucao') return d.componentes.find((c) => c.principal)?.produto ?? null;
  return null;
}

async function existe(tx: TxOperacao, tabela: string, id: number, rotulo: string): Promise<number> {
  const x = await tx.uma(`SELECT id FROM ${tabela} WHERE id = ?`, [id]);
  if (!x) throw recusar(422, 'cadastro-inexistente', `${rotulo} não está no cadastro.`);
  return id;
}

/**
 * Os cadastros de uma linha da composição da dieta, com a mesma regra que os domínios da tela usam: a refeição é do
 * estabelecimento da prescrição, ativa, com o horário geral (sem unidade de internação própria) e geral ou da própria
 * modalidade da dieta; o alimento está vigente hoje; a medida caseira está ativa e é genérica ou do alimento da linha.
 * Um POST montado à mão com cadastro de outro estabelecimento, de outro alimento ou fora de uso é recusado com 422 sem
 * gravar nada (a transação da prescrição é desfeita).
 */
async function conferirCadastrosDaRefeicao(
  tx: TxOperacao,
  estabelecimento: number,
  dieta: number,
  r: { readonly refeicao: number; readonly alimento: number; readonly medidaCaseira: number | null },
): Promise<void> {
  const hr = await tx.uma(
    `SELECT id FROM horario_refeicao
      WHERE id = ? AND estabelecimento_id = ? AND ativo AND unidade_internacao_id IS NULL
        AND (modalidade_dieta_id IS NULL OR modalidade_dieta_id = ?)`,
    [r.refeicao, estabelecimento, dieta],
  );
  if (!hr)
    throw recusar(
      422,
      'dieta-refeicao-fora-do-estabelecimento',
      'A refeição não é do estabelecimento da prescrição, está inativa ou é de outra unidade ou modalidade de dieta.',
    );
  const al = await tx.uma(
    `SELECT id FROM alimento_referencia
      WHERE id = ? AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [r.alimento],
  );
  if (!al)
    throw recusar(
      422,
      'dieta-alimento-fora-da-vigencia',
      'O alimento não está no cadastro ou está fora da vigência da tabela de composição.',
    );
  if (r.medidaCaseira === null) return;
  const mc = await tx.uma(
    `SELECT id FROM medida_caseira_alimento
      WHERE id = ? AND ativo AND (alimento_referencia_id IS NULL OR alimento_referencia_id = ?)`,
    [r.medidaCaseira, r.alimento],
  );
  if (!mc)
    throw recusar(
      422,
      'dieta-medida-caseira-invalida',
      'A medida caseira está inativa ou é de outro alimento (só a genérica ou a do próprio alimento).',
    );
}

export interface ContextoDetalhe {
  readonly item: number;
  /** O estabelecimento da prescrição (a refeição da composição da dieta tem de ser dele). */
  readonly estabelecimento: number;
  readonly profissional: number;
  readonly usuario: number;
  readonly agora: Date;
  /** Data e hora civil (AAAA-MM-DDTHH:MM) do estabelecimento → instante. */
  readonly instante: (civil: string) => Date;
  readonly unidade: (sigla: string) => Promise<number>;
  /** Via de uso pela sigla (escala por glicemia). */
  readonly via: (sigla: string) => Promise<number>;
}

/** O pedido de item não padronizado do estabelecimento, ainda utilizável (solicitado, aprovado ou padronizado). */
export async function conferirNaoPadronizado(
  tx: TxOperacao,
  estabelecimento: number,
  id: number,
): Promise<void> {
  const x = await tx.uma(
    `SELECT id FROM item_nao_padronizado
      WHERE id = ? AND estabelecimento_id = ? AND situacao IN ('solicitado','aprovado','padronizado')`,
    [id, estabelecimento],
  );
  if (!x)
    throw recusar(
      422,
      'nao-padronizado-indisponivel',
      'O pedido de item não padronizado não é deste estabelecimento, foi recusado ou está inativo.',
    );
}

async function condicoesSeNecessario(
  tx: TxOperacao,
  item: number,
  condicoes: readonly number[],
  extra: {
    readonly intervalo: number | null;
    readonly dose: number | null;
    readonly periodo: number | null;
    readonly unidade: number | null;
  },
): Promise<void> {
  for (const cond of condicoes) {
    const x = await tx.uma('SELECT id FROM condicao_se_necessario WHERE id = ? AND ativo', [cond]);
    if (!x)
      throw recusar(422, 'motivo-desconhecido', 'Condição de "se necessário" fora do cadastro ou inativa.');
    await tx.incluir('prescricao_item_se_necessario', {
      prescricao_item_id: item,
      condicao_se_necessario_id: cond,
      intervalo_minimo_minutos: extra.intervalo,
      dose_maxima_periodo: extra.dose,
      periodo_horas: extra.periodo,
      unidade_prescricao_id: extra.unidade,
    });
  }
}

/** Grava o detalhe do item conforme o tipo. O item (prescricao_item) já existe. */
export async function gravarDetalhe(tx: TxOperacao, d: Detalhe, c: ContextoDetalhe): Promise<void> {
  switch (d.tipo) {
    case 'medicamento': {
      if (d.naoPadronizado) await conferirNaoPadronizado(tx, c.estabelecimento, d.naoPadronizado.htcid);
      await tx.incluir('prescricao_item_medicamento', {
        prescricao_item_id: c.item,
        item_prescritivel_id: d.naoPadronizado ? null : d.produto,
        item_nao_padronizado_id: d.naoPadronizado?.htcid ?? null,
        justificativa_nao_padronizado: d.naoPadronizado?.justificativa ?? null,
        dose: d.dose,
        unidade_prescricao_id: await c.unidade(d.unidade),
        tempo_infusao_minutos: d.tempoInfusaoMinutos,
        iniciar_agora: d.agora,
        nao_ajustar_horario: d.naoAjustar,
        justificativa_alergia: d.justificativaAlergia,
        origem: 'sistema',
      });
      await condicoesSeNecessario(tx, c.item, d.seNecessario, {
        intervalo: d.intervaloMinimoMinutos,
        dose: d.doseMaxima?.dose ?? null,
        periodo: d.doseMaxima?.periodoHoras ?? null,
        unidade: d.doseMaxima && d.seNecessario.length > 0 ? await c.unidade(d.unidade) : null,
      });
      // Kit do medicamento: os materiais que acompanham a dose, cada um com a sua quantidade (item_de_kit).
      let seqKit = 0;
      for (const k of d.kit) {
        await existe(tx, 'item_prescritivel', k.produto, 'O item do kit');
        await tx.incluir('prescricao_item_material', {
          prescricao_item_id: c.item,
          sequencia: ++seqKit,
          item_prescritivel_id: k.produto,
          quantidade: k.quantidade,
          unidade_prescricao_id: await c.unidade(k.unidade),
          item_de_kit: true,
          origem: 'sistema',
        });
      }
      return;
    }
    case 'procedimento': {
      // O item prescritível diz o que é: cuidado de enfermagem (prescricao_item_cuidado) ou procedimento/exame.
      const ip = await tx.uma(
        `SELECT ip.cuidado_enfermagem_id, ip.exame_id, t.categoria FROM item_prescritivel ip
           JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
          WHERE ip.id = ? AND ip.excluido_em IS NULL`,
        [d.procedimento],
      );
      if (!ip) throw recusar(422, 'cadastro-inexistente', 'O procedimento não está no cadastro.');
      const cuidado = ip['cuidado_enfermagem_id'] === null ? null : Number(ip['cuidado_enfermagem_id']);
      if (String(ip['categoria']) === 'cuidado') {
        if (cuidado === null)
          throw recusar(
            422,
            'cuidado-sem-cadastro',
            'O item de cuidado não está ligado a um cuidado de enfermagem do cadastro.',
          );
        await tx.incluir('prescricao_item_cuidado', {
          prescricao_item_id: c.item,
          cuidado_enfermagem_id: cuidado,
          origem: 'sistema',
        });
      } else
        await tx.incluir('prescricao_item_procedimento', {
          prescricao_item_id: c.item,
          item_prescritivel_id: d.procedimento,
          exame_id: ip['exame_id'] === null ? null : Number(ip['exame_id']),
          cuidado_enfermagem_id: cuidado,
          local_execucao: 'interno',
          situacao: 'solicitado',
          iniciar_agora: d.agora,
          nao_ajustar_horario: d.naoAjustar,
          origem: 'sistema',
        });
      await condicoesSeNecessario(tx, c.item, d.seNecessario, {
        intervalo: null,
        dose: null,
        periodo: null,
        unidade: null,
      });
      // Escala por glicemia (mg/dL): cada faixa com o produto, a dose, a unidade e a via (dose 0 = não aplicar).
      let seqFaixa = 0;
      for (const f of [...d.faixas].sort((a, b) => a.de - b.de)) {
        await existe(tx, 'item_prescritivel', f.produto, 'O produto da faixa de glicemia');
        await tx.incluir('prescricao_item_glicemia', {
          prescricao_item_id: c.item,
          sequencia: ++seqFaixa,
          glicemia_minima: f.de,
          glicemia_maxima: f.ate,
          item_prescritivel_id: f.produto,
          dose: f.dose,
          unidade_prescricao_id: await c.unidade(f.unidade),
          via_de_uso_id: await c.via(f.via),
          origem: 'sistema',
        });
      }
      return;
    }
    case 'hemoterapia': {
      const h = await tx.uma(
        `SELECT id FROM hemocomponente WHERE (UPPER(codigo) = UPPER(?) OR UPPER(sigla) = UPPER(?)) AND ativo
          ORDER BY (UPPER(codigo) = UPPER(?)) DESC, id LIMIT 1`,
        [d.codigo, d.codigo, d.codigo],
      );
      if (!h)
        throw recusar(422, 'cadastro-inexistente', 'O hemocomponente não está no cadastro ou está inativo.');
      await tx.incluir('prescricao_item_hemocomponente', {
        prescricao_item_id: c.item,
        hemocomponente_id: Number(h['id']),
        quantidade: d.dose,
        unidade_prescricao_id: await c.unidade(d.unidade),
        tipo_infusao_id: await existe(tx, 'tipo_infusao', d.tipoInfusao, 'O tipo de infusão'),
        indicacao_clinica: (d.indicacao ?? '').trim(),
        urgencia: d.agora ? 'urgente' : 'rotina',
        iniciar_agora: d.agora,
        origem: 'sistema',
      });
      return;
    }
    case 'dieta': {
      const dieta = await tx.incluir('prescricao_item_dieta', {
        prescricao_item_id: c.item,
        modalidade_dieta_id: await existe(tx, 'modalidade_dieta', d.dieta, 'A dieta'),
        via_dieta_id:
          d.viaDieta === null ? null : await existe(tx, 'via_dieta', d.viaDieta, 'A via da dieta'),
        volume: d.quantidade,
        unidade_prescricao_id: d.unidade === null ? null : await c.unidade(d.unidade),
        tipo_infusao_id:
          d.tipoInfusao === null
            ? null
            : await existe(tx, 'tipo_infusao', d.tipoInfusao, 'O tipo de infusão'),
        velocidade_infusao: d.velocidade,
        unidade_infusao_id:
          d.unidadeInfusao === null
            ? null
            : await existe(tx, 'unidade_infusao', d.unidadeInfusao, 'A unidade de infusão'),
        origem: 'sistema',
      });
      for (const x of d.caracteristicas)
        await tx.incluir('prescricao_item_dieta_caracteristica', {
          prescricao_item_dieta_id: dieta,
          caracteristica_dieta_id: await existe(
            tx,
            'caracteristica_dieta',
            x.caracteristica,
            'A característica da dieta',
          ),
          resposta: x.resposta,
        });
      // Composição por refeição (03-PEP L112): a regra é do domínio (conferirRefeicoesDieta, chamada por
      // conferirItemGravavel em conferirItensGravaveis, antes de qualquer gravação).
      const refeicoes = d.refeicoes ?? [];
      for (const r of refeicoes) await conferirCadastrosDaRefeicao(tx, c.estabelecimento, d.dieta, r);
      const gravados: number[] = [];
      for (const [i, r] of refeicoes.entries())
        gravados.push(
          await tx.incluir('prescricao_dieta_refeicao_item', {
            prescricao_item_dieta_id: dieta,
            sequencia: i + 1,
            horario_refeicao_id: r.refeicao,
            alimento_referencia_id: r.alimento,
            quantidade: r.quantidade,
            unidade_medida_id:
              r.unidade === null
                ? null
                : await existe(tx, 'unidade_medida', r.unidade, 'A unidade do alimento'),
            medida_caseira_alimento_id: r.medidaCaseira,
            quantidade_medida_caseira: r.quantidadeMedidaCaseira,
            substituto_prescricao_dieta_refeicao_item_id:
              r.substitui === null ? null : (gravados[r.substitui - 1] ?? null),
            percentual_diario: r.percentualDiario,
            calorias_kcal: r.calorias,
            origem: 'sistema',
          }),
        );
      return;
    }
    case 'solucao': {
      const etapas = [...d.etapas].sort((a, b) => a.etapa - b.etapa);
      const primeira = etapas[0]!;
      const fator = new Map<number, number | null>();
      for (const e of etapas) {
        const u = await tx.uma('SELECT sigla FROM unidade_infusao WHERE id = ?', [e.unidadeInfusao]);
        if (!u) throw recusar(422, 'cadastro-inexistente', 'A unidade de infusão não está no cadastro.');
        fator.set(e.unidadeInfusao, mlPorHoraDaSigla(String(u['sigla'])));
      }
      // Volume = velocidade × duração em cada etapa, pela unidade do cadastro (mL/h, gotas/min).
      recusaDoDominio(conferirItemGravavel(d, { mlPorHora: (u) => fator.get(u) ?? null }));
      const solucao = await tx.incluir('prescricao_item_solucao', {
        prescricao_item_id: c.item,
        volume_total: etapas.reduce((s, e) => s + e.volume, 0),
        unidade_prescricao_id: await c.unidade(d.unidade),
        tipo_infusao_id: await existe(tx, 'tipo_infusao', d.tipoInfusao, 'O tipo de infusão'),
        velocidade_infusao: primeira.velocidade,
        unidade_infusao_id: primeira.unidadeInfusao,
        etapas: etapas.length,
        esquema_alternado: etapas.length > 1,
        iniciar_agora: d.agora,
        nao_ajustar_horario: d.naoAjustar,
        origem: 'sistema',
      });
      let seq = 0;
      const unidades = new Map<string, number>();
      const unidadeDe = async (sigla: string) => {
        if (!unidades.has(sigla)) unidades.set(sigla, await c.unidade(sigla));
        return unidades.get(sigla)!;
      };
      for (const x of d.componentes) {
        await existe(tx, 'item_prescritivel', x.produto, 'O componente da solução');
        await tx.incluir('prescricao_item_solucao_componente', {
          prescricao_item_solucao_id: solucao,
          sequencia: ++seq,
          etapa: x.etapa,
          tipo_componente: x.principal ? 'principal' : 'aditivo',
          item_prescritivel_id: x.produto,
          quantidade: x.dose,
          unidade_prescricao_id: await unidadeDe(x.unidade),
          origem: 'sistema',
        });
      }
      // O esquema: cada componente na sua etapa, com o volume e o início previsto da etapa (a velocidade da etapa é
      // volume ÷ duração, conferida acima; a da primeira fica na solução).
      let seqEtapa = 0;
      for (const e of etapas)
        for (const x of d.componentes.filter((k) => k.etapa === e.etapa))
          await tx.incluir('prescricao_item_solucao_etapa', {
            prescricao_item_solucao_id: solucao,
            sequencia: ++seqEtapa,
            etapa: e.etapa,
            item_prescritivel_id: x.produto,
            componente_principal: x.principal,
            dose: x.dose,
            quantidade: x.dose,
            unidade_prescricao_id: await unidadeDe(x.unidade),
            volume_ml: x.principal ? e.volume : null,
            inicio_previsto_em: c.instante(e.inicio),
            origem: 'sistema',
          });
      return;
    }
    case 'vmi':
    case 'vni': {
      const invasiva = d.tipo === 'vmi';
      const via = await tx.uma('SELECT invasiva FROM via_aerea WHERE id = ?', [d.viaAerea]);
      if (!via) throw recusar(422, 'cadastro-inexistente', 'A via aérea não está no cadastro.');
      const modo = await tx.uma('SELECT ventilacao_controlada FROM modo_ventilatorio WHERE id = ?', [d.modo]);
      if (!modo) throw recusar(422, 'cadastro-inexistente', 'O modo ventilatório não está no cadastro.');
      recusaDoDominio(
        conferirVentilacaoNoCadastro(d.tipo === 'vmi' ? d : { tipo: 'vni' }, {
          viaInvasiva: verdadeiro(via['invasiva']),
          modoControlado: verdadeiro(modo['ventilacao_controlada']),
        }),
      );
      await tx.incluir('prescricao_item_ventilacao', {
        prescricao_item_id: c.item,
        sequencia: 1,
        modalidade: invasiva ? 'invasiva' : 'nao_invasiva',
        via_aerea_id: d.viaAerea,
        modo_ventilatorio_id: d.modo,
        frequencia_respiratoria: d.tipo === 'vmi' ? d.frequenciaRespiratoria : null,
        peep_cmh2o: d.tipo === 'vmi' ? d.peep : null,
        volume_corrente_ml: d.tipo === 'vmi' ? d.volumeCorrente : null,
        pressao_controlada_cmh2o: d.tipo === 'vmi' ? d.pressao : null,
        pressao_suporte_cmh2o: d.tipo === 'vni' ? d.pressaoSuporte : null,
        pressao_inspiratoria_cmh2o: d.tipo === 'vni' ? d.pressaoInspiratoria : null,
        pressao_expiratoria_cmh2o: d.tipo === 'vni' ? d.pressaoExpiratoria : null,
        tempo_inspiratorio_segundos: d.tipo === 'vmi' ? d.tempoInspiratorio : null,
        tempo_expiratorio_segundos: d.tipo === 'vmi' ? d.tempoExpiratorio : null,
        fracao_inspirada_oxigenio: d.fio2,
        duracao_minutos: d.tipo === 'vni' ? d.duracaoMinutos : null,
        origem: 'sistema',
      });
      return;
    }
    default: {
      const nunca: never = d;
      throw recusar(422, 'tipo-item-incoerente', `Tipo de item desconhecido: ${String(nunca)}.`);
    }
  }
}
