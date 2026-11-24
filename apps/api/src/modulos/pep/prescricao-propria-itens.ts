// Detalhe de cada tipo de item da prescrição no banco próprio (03-PEP L105): medicamento com as condições de "se
// necessário", dieta com as características, solução em etapas (componentes e a velocidade de cada etapa) e suporte
// ventilatório invasivo e não invasivo. A coerência clínica é do domínio (conferirItemGravavel e as conferências de
// cadastro); aqui fica a leitura dos cadastros e a tradução para as tabelas. Tudo na transação da prescrição; nada é
// apagado. Parâmetro não prescrito fica NULL. As etapas da solução vão a prescricao_item_solucao_etapa;
// prescricao_item_velocidade fica só para as mudanças de velocidade posteriores (titulação, enfermagem).
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

function pendente(oque: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A gravação de ${oque} na prescrição ainda não tem adaptador no banco próprio.`,
  );
}

/**
 * Tipos com adaptador: medicamento padronizado (com ou sem "se necessário"), dieta, solução, VMI e VNI. A vigência
 * (civil), quando vem, limita as etapas da solução.
 */
export function conferirItensGravaveis(
  itens: readonly ItemGravacao[],
  vigencia: { readonly inicio: string; readonly fim: string } | null = null,
): void {
  for (const it of itens) {
    const d = it.detalhe;
    if (d.tipo === 'procedimento' || d.tipo === 'hemoterapia') throw pendente(`item do tipo ${d.tipo}`);
    if (d.tipo === 'medicamento') {
      if (d.naoPadronizado) throw pendente('medicamento não padronizado');
      if (d.kit.length > 0) throw pendente('kit do medicamento');
    }
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

/** O item prescritível que identifica o item: o produto do medicamento ou o componente principal da solução. */
export function produtoDoItem(d: Detalhe): number | null {
  if (d.tipo === 'medicamento') return d.produto;
  if (d.tipo === 'solucao') return d.componentes.find((c) => c.principal)?.produto ?? null;
  return null;
}

async function existe(tx: TxOperacao, tabela: string, id: number, rotulo: string): Promise<number> {
  const x = await tx.uma(`SELECT id FROM ${tabela} WHERE id = ?`, [id]);
  if (!x) throw recusar(422, 'cadastro-inexistente', `${rotulo} não está no cadastro.`);
  return id;
}

export interface ContextoDetalhe {
  readonly item: number;
  readonly profissional: number;
  readonly usuario: number;
  readonly agora: Date;
  /** Data e hora civil (AAAA-MM-DDTHH:MM) do estabelecimento → instante. */
  readonly instante: (civil: string) => Date;
  readonly unidade: (sigla: string) => Promise<number>;
}

/** Grava o detalhe do item conforme o tipo. O item (prescricao_item) já existe. */
export async function gravarDetalhe(tx: TxOperacao, d: Detalhe, c: ContextoDetalhe): Promise<void> {
  switch (d.tipo) {
    case 'medicamento': {
      await tx.incluir('prescricao_item_medicamento', {
        prescricao_item_id: c.item,
        item_prescritivel_id: d.produto,
        dose: d.dose,
        unidade_prescricao_id: await c.unidade(d.unidade),
        tempo_infusao_minutos: d.tempoInfusaoMinutos,
        iniciar_agora: d.agora,
        nao_ajustar_horario: d.naoAjustar,
        justificativa_alergia: d.justificativaAlergia,
        origem: 'sistema',
      });
      for (const cond of d.seNecessario) {
        const x = await tx.uma('SELECT id FROM condicao_se_necessario WHERE id = ? AND ativo', [cond]);
        if (!x)
          throw recusar(
            422,
            'motivo-desconhecido',
            'Condição de "se necessário" fora do cadastro ou inativa.',
          );
        await tx.incluir('prescricao_item_se_necessario', {
          prescricao_item_id: c.item,
          condicao_se_necessario_id: cond,
          intervalo_minimo_minutos: d.intervaloMinimoMinutos,
          dose_maxima_periodo: d.doseMaxima?.dose ?? null,
          periodo_horas: d.doseMaxima?.periodoHoras ?? null,
          unidade_prescricao_id: d.doseMaxima ? await c.unidade(d.unidade) : null,
        });
      }
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
    default:
      throw pendente(`item do tipo ${d.tipo}`);
  }
}
