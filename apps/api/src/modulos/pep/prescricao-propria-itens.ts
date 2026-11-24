// Detalhe de cada tipo de item da prescrição no banco próprio (03-PEP L105): medicamento com as condições de "se
// necessário", dieta com as características, solução em etapas (componentes e a velocidade de cada etapa) e suporte
// ventilatório invasivo e não invasivo. A coerência clínica é do domínio (conferirItemGravavel); aqui fica a
// existência dos cadastros e a tradução para as tabelas. Tudo na transação da prescrição; nada é apagado.
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import { conferirItemGravavel, MENSAGENS_ITEM_GRAVAVEL } from '@sgh/dominio-pep';
import type { ItemGravacao } from './tipos-pep.js';

type Detalhe = ItemGravacao['detalhe'];

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

function pendente(oque: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A gravação de ${oque} na prescrição ainda não tem adaptador no banco próprio.`,
  );
}

/** Tipos com adaptador: medicamento padronizado (com ou sem "se necessário"), dieta, solução, VMI e VNI. */
export function conferirItensGravaveis(itens: readonly ItemGravacao[]): void {
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
    const r = conferirItemGravavel(d);
    if (r) throw recusar(422, r, MENSAGENS_ITEM_GRAVAVEL[r]);
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
      for (const e of etapas) await existe(tx, 'unidade_infusao', e.unidadeInfusao, 'A unidade de infusão');
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
      for (const x of d.componentes) {
        await existe(tx, 'item_prescritivel', x.produto, 'O componente da solução');
        await tx.incluir('prescricao_item_solucao_componente', {
          prescricao_item_solucao_id: solucao,
          sequencia: ++seq,
          etapa: x.etapa,
          tipo_componente: x.principal ? 'principal' : 'aditivo',
          item_prescritivel_id: x.produto,
          quantidade: x.dose,
          unidade_prescricao_id: await c.unidade(x.unidade),
          origem: 'sistema',
        });
      }
      for (const e of etapas) {
        const inicio = c.instante(e.inicio);
        const fim = c.instante(e.fim);
        await tx.incluir('prescricao_item_velocidade', {
          prescricao_item_solucao_id: solucao,
          operacao: 'inclusao',
          ocorrido_em: c.agora,
          usuario_id: c.usuario,
          etapa: e.etapa,
          velocidade: e.velocidade,
          unidade_infusao_id: e.unidadeInfusao,
          volume_ml: e.volume,
          duracao_minutos: Math.round((fim.getTime() - inicio.getTime()) / 60_000),
          inicio_em: inicio,
          fim_em: fim,
          tipo_registro: 'prescricao',
          profissional_id: c.profissional,
        });
      }
      return;
    }
    case 'vmi':
    case 'vni': {
      const invasiva = d.tipo === 'vmi';
      await tx.incluir('prescricao_item_ventilacao', {
        prescricao_item_id: c.item,
        sequencia: 1,
        modalidade: invasiva ? 'invasiva' : 'nao_invasiva',
        via_aerea_id: await existe(tx, 'via_aerea', d.viaAerea, 'A via aérea'),
        modo_ventilatorio_id: await existe(tx, 'modo_ventilatorio', d.modo, 'O modo ventilatório'),
        frequencia_respiratoria: invasiva ? d.frequenciaRespiratoria : null,
        peep_cmh2o: invasiva ? d.peep : null,
        volume_corrente_ml: invasiva ? d.volumeCorrente : null,
        pressao_controlada_cmh2o: invasiva ? d.pressao : null,
        pressao_inspiratoria_cmh2o: invasiva ? null : d.pressaoInspiratoria,
        tempo_inspiratorio_segundos: invasiva ? d.tempoInspiratorio : null,
        tempo_expiratorio_segundos: invasiva ? d.tempoExpiratorio : null,
        fracao_inspirada_oxigenio: d.fio2,
        origem: 'sistema',
      });
      return;
    }
    default:
      throw pendente(`item do tipo ${d.tipo}`);
  }
}
