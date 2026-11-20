// Motor de alertas da prescrição (regras 4 a 9 da ficha do M24; cap-11 §11.2, tabela de comportamentos padrão): junta
// os achados de cada alerta, aplica o nível da regra vigente (versionada: aviso, justificar ou bloqueio) e as decisões
// já tomadas, e diz se a prescrição pode ser assinada. Item cuja regra mudou desde a decisão é reavaliado (a decisão
// guarda a versão).
import type { AlertaPrescricao, DecisaoAlerta, NivelAlerta, TipoAlerta } from '@sgh/contratos';
import { alertasAlergia } from './alergia.js';
import { alertasAltoAlerta } from './alto-alerta.js';
import { alertasAntimicrobiano } from './antimicrobiano.js';
import { alertasCobertura } from './cobertura.js';
import { alertasControlado } from './controlado.js';
import { alertasDose } from './dose.js';
import { alertasDuplicidade } from './duplicidade.js';
import { alertasInteracao } from './interacao.js';
import { alertasRenal } from './renal.js';
import type { AlertaGerado, ContextoAlertas, ItemAvaliado, RegraAlerta } from './tipos.js';
import { alertasViaForma } from './via-forma.js';

/** Regras padrão (versão 1, comportamentos do cap-11 §11.2): valem até a farmácia clínica publicar outra versão. */
export const REGRAS_PADRAO: readonly RegraAlerta[] = [
  {
    codigo: 'alergia',
    tipo: 'alergia',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Alergia ativa ao princípio ou à classe: libera só com justificativa',
  },
  {
    codigo: 'duplicidade',
    tipo: 'duplicidade',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Medicamento ou princípio ativo em duplicidade: libera com justificativa, como hoje',
  },
  {
    codigo: 'dose-maxima',
    tipo: 'dose-maxima',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Dose ou intervalo além do cadastro do item: libera com justificativa',
  },
  {
    codigo: 'dose-minima',
    tipo: 'dose-minima',
    nivel: 'aviso',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Dose abaixo da mínima do cadastro: aviso',
  },
  {
    codigo: 'ajuste-renal',
    tipo: 'ajuste-renal',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Dose acima do ajuste renal pelo clearance estimado: libera com justificativa',
  },
  {
    codigo: 'interacao',
    tipo: 'interacao',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Interação grave: justificar; contraindicada: bloqueio; leve e moderada: aviso',
  },
  {
    codigo: 'via-forma',
    tipo: 'via-forma',
    nivel: 'bloqueio',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Via não aceita pelo cadastro do item: bloqueio',
  },
  {
    codigo: 'alto-alerta',
    tipo: 'alto-alerta',
    nivel: 'aviso',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Alta vigilância: aviso e dupla checagem na administração',
  },
  {
    codigo: 'antimicrobiano',
    tipo: 'antimicrobiano',
    nivel: 'justificar',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Antimicrobiano exige a ficha (indicação e dia de tratamento)',
  },
  {
    codigo: 'controlado',
    tipo: 'controlado',
    nivel: 'aviso',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Controlado: prescrição diária na internação; receita própria na alta',
  },
  {
    codigo: 'cobertura',
    tipo: 'cobertura',
    nivel: 'aviso',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Item sem cobertura do convênio: aviso',
  },
  {
    codigo: 'se-necessario',
    tipo: 'se-necessario',
    nivel: 'bloqueio',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: '"Se necessário" e ACM exigem condição objetiva e intervalo mínimo',
  },
  {
    codigo: 'dieta-de-outro',
    tipo: 'dieta-de-outro',
    nivel: 'justificar',
    versao: 2,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao:
      'Dieta ativa de outro profissional no período: suspender a anterior ou justificar manter as duas (uma só dieta por período)',
  },
  {
    codigo: 'categoria',
    tipo: 'categoria',
    nivel: 'bloqueio',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Categoria profissional que não prescreve o tipo de item: bloqueio',
  },
  {
    codigo: 'base-nao-contratada',
    tipo: 'base-nao-contratada',
    nivel: 'aviso',
    versao: 1,
    vigenteDesde: '2026-10-21',
    ativa: true,
    descricao: 'Base de interações não contratada: aviso informativo, nenhum alerta de interação',
  },
];

/** A regra vigente do tipo: a ativa de maior versão com vigência até hoje. */
export function regraVigente(
  regras: readonly RegraAlerta[],
  tipo: TipoAlerta,
  hoje: string,
): RegraAlerta | null {
  return (
    [...regras]
      .filter((r) => r.tipo === tipo && r.vigenteDesde <= hoje)
      .sort((a, b) => b.versao - a.versao || b.vigenteDesde.localeCompare(a.vigenteDesde))[0] ?? null
  );
}

function nivelDe(a: AlertaGerado, r: RegraAlerta): NivelAlerta {
  if (a.tipo === 'interacao') {
    if (a.gravidade === 'contraindicada') return 'bloqueio';
    if (a.gravidade === 'leve' || a.gravidade === 'moderada') return 'aviso';
  }
  return r.nivel;
}

export interface EntradaMotor {
  readonly itens: readonly ItemAvaliado[];
  readonly ctx: ContextoAlertas;
  /** Itens que a categoria de quem prescreve não pode prescrever (regra 10). */
  readonly foraDaCategoria: readonly string[];
  /** Itens de dieta (para o aviso da dieta de outro profissional). */
  readonly dietas: readonly string[];
  /** Decisões já registradas, por item (chave) e alerta. */
  readonly decisoes: ReadonlyMap<string, readonly DecisaoAlerta[]>;
}

export function achados(e: EntradaMotor): AlertaGerado[] {
  const r: AlertaGerado[] = [];
  const { ctx } = e;
  for (const item of e.itens) {
    r.push(
      ...alertasAlergia(item, ctx),
      ...alertasDuplicidade(item, e.itens, ctx),
      ...alertasDose(item),
      ...alertasRenal(item, ctx),
      ...alertasInteracao(item, e.itens, ctx),
      ...alertasViaForma(item),
      ...alertasAltoAlerta(item, ctx),
      ...alertasAntimicrobiano(item),
      ...alertasControlado(item, ctx),
      ...alertasCobertura(item, ctx),
    );
    if (item.aCriterio && (!item.seNecessario || item.seNecessario.motivos.length === 0))
      r.push({
        id: 'se-necessario',
        item: item.chave,
        tipo: 'se-necessario',
        titulo: 'Condição objetiva necessária',
        detalhe:
          '"Se necessário" e "a critério médico" exigem o motivo (febre, dor, náusea…) e o intervalo mínimo.',
      });
    if (e.foraDaCategoria.includes(item.chave))
      r.push({
        id: 'categoria',
        item: item.chave,
        tipo: 'categoria',
        titulo: 'Tipo de item fora da sua categoria',
        detalhe: 'A sua categoria profissional não prescreve este tipo de item.',
      });
    if (ctx.dietaDeOutro && e.dietas.includes(item.chave))
      r.push({
        id: 'dieta-de-outro',
        item: item.chave,
        tipo: 'dieta-de-outro',
        titulo: 'Já há dieta ativa no período',
        // Regra 10 (uma só dieta ativa por paciente e período): nada é suspenso sozinho. Quem prescreve suspende a
        // anterior pela prescrição dela (a suspensão do item) ou justifica manter as duas; a justificativa fica na
        // decisão do alerta, que a farmácia e a nutrição veem na prescrição.
        detalhe: `A dieta ativa${ctx.dietaDeOutro.prescricao ? ` (prescrição ${ctx.dietaDeOutro.prescricao})` : ''} foi prescrita por ${ctx.dietaDeOutro.autor}. Para ficar uma só dieta no período, suspenda a anterior antes de assinar; para manter as duas, justifique.`,
        ...(ctx.dietaDeOutro.prescricao && ctx.dietaDeOutro.item
          ? { referencia: { prescricao: ctx.dietaDeOutro.prescricao, item: ctx.dietaDeOutro.item } }
          : {}),
      });
  }
  if (ctx.interacoes === null && e.itens.some((i) => i.produtos.length > 0))
    r.push({
      id: 'base-nao-contratada',
      item: '*',
      tipo: 'base-nao-contratada',
      titulo: 'Base de interações não contratada',
      detalhe:
        'Os alertas de interação medicamentosa estão desligados até a contratação da base de interações.',
    });
  return r;
}

/** Os alertas com o nível da regra vigente e a decisão registrada (regra desligada: o alerta não aparece). */
export function avaliarAlertas(e: EntradaMotor): AlertaPrescricao[] {
  const r: AlertaPrescricao[] = [];
  for (const a of achados(e)) {
    const regra = regraVigente(e.ctx.regras, a.tipo, e.ctx.hoje);
    if (!regra || !regra.ativa) continue;
    const decisao = (e.decisoes.get(a.item) ?? []).find((d) => d.alerta === a.id) ?? null;
    r.push({
      id: a.id,
      item: a.item,
      tipo: a.tipo,
      nivel: nivelDe(a, regra),
      titulo: a.titulo,
      detalhe: a.detalhe,
      regra: regra.codigo,
      versaoRegra: regra.versao,
      decisao,
      ...(a.referencia ? { referencia: { ...a.referencia } } : {}),
    });
  }
  return r;
}

export const JUSTIFICATIVA_MINIMA = 10;

/** Pode assinar? Bloqueio total impede; "justificar" impede sem justificativa (10+ letras) ou com o item mantido. */
export function impede(alertas: readonly AlertaPrescricao[]): { impede: boolean; motivo: string | null } {
  for (const a of alertas) {
    if (a.decisao?.decisao === 'retirado') continue;
    if (a.nivel === 'bloqueio') return { impede: true, motivo: 'alerta-bloqueio' };
    if (
      a.nivel === 'justificar' &&
      (a.decisao?.decisao !== 'mantido' ||
        (a.decisao.justificativa ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    )
      return { impede: true, motivo: 'alerta-sem-justificativa' };
  }
  return { impede: false, motivo: null };
}

/** Justificativa de alergia de um item (vai para a coluna do legado do item alérgico). */
export function justificativaAlergia(alertas: readonly AlertaPrescricao[], item: string): string | null {
  const j = alertas
    .filter((a) => a.item === item && a.tipo === 'alergia' && a.decisao?.decisao === 'mantido')
    .map((a) => a.decisao?.justificativa?.trim() ?? '')
    .filter(Boolean);
  return j.length ? j.join('; ').slice(0, 255) : null;
}
