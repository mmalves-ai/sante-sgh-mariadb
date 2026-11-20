// Matriz ação × categoria (ficha do M23, regra 2; cap-05b §5.6 e §5.9; cap-08 §8.4; Lei 12.842/2013): só médico com
// conselho ativo emite atestado médico, declaração de óbito e sumário de alta; cada profissão registra nos modelos do
// seu CBO. A categoria vem do CBO 2002 (família): 225 medicina; 2235 e 3222 enfermagem; 2236 fisioterapia; 2237
// nutrição; 2515 psicologia; 2238 fonoaudiologia; 2232 odontologia; 2234 farmácia; 2516 serviço social.
import type { CategoriaAssistencial } from '@sgh/contratos';

/** Categoria assistencial pelo código CBO (com ou sem pontuação; null sem CBO). */
export function categoriaDoCbo(cbo: string | null | undefined): CategoriaAssistencial | null {
  if (!cbo) return null;
  const c = cbo.replace(/\D/g, '');
  if (c.length < 4) return null;
  if (c.startsWith('225')) return 'medico';
  if (c.startsWith('2235') || c.startsWith('3222')) return 'enfermagem';
  if (c.startsWith('2236')) return 'fisioterapia';
  if (c.startsWith('2237')) return 'nutricao';
  if (c.startsWith('2515')) return 'psicologia';
  if (c.startsWith('2238')) return 'fonoaudiologia';
  if (c.startsWith('2232')) return 'odontologia';
  if (c.startsWith('2234')) return 'farmacia';
  if (c.startsWith('2516')) return 'servico-social';
  return 'outros';
}

export const ACOES_CLINICAS = [
  'atestado-medico',
  'declaracao-comparecimento',
  'requerimento',
  'declaracao-obito',
  'sumario-alta',
  'relatorio-transferencia',
  'receita',
  'receita-controlada',
  'pedido-exame',
  'tcle',
  'parecer-pedido',
  'parecer-resposta',
  'alergia',
  'problema',
  'ciencia-critico',
  'anexo',
] as const;
export type AcaoClinica = (typeof ACOES_CLINICAS)[number];

const SO_MEDICO: ReadonlySet<AcaoClinica> = new Set([
  'atestado-medico',
  'declaracao-obito',
  'sumario-alta',
  'relatorio-transferencia',
  'receita-controlada',
  'tcle',
]);
/** Ações de prescritor (médico e cirurgião-dentista, na área deles). */
const PRESCRITOR: ReadonlySet<AcaoClinica> = new Set(['receita', 'pedido-exame']);
/** Todas as categorias assistenciais com conselho. */
const MULTIPROFISSIONAL: ReadonlySet<AcaoClinica> = new Set([
  'declaracao-comparecimento',
  'requerimento',
  'parecer-pedido',
  'parecer-resposta',
  'alergia',
  'problema',
  'ciencia-critico',
  'anexo',
]);

export interface Profissional {
  readonly categoria: CategoriaAssistencial | null;
  /** Registro no conselho ativo (TBCBOPRO ativo, com sigla e número). */
  readonly conselhoAtivo: boolean;
}

export interface DecisaoAcao {
  readonly pode: boolean;
  readonly motivo: string | null;
}

const ROTULO_ACAO: Readonly<Record<AcaoClinica, string>> = {
  'atestado-medico': 'emitir atestado médico',
  'declaracao-comparecimento': 'emitir declaração de comparecimento',
  requerimento: 'emitir requerimento',
  'declaracao-obito': 'registrar a declaração de óbito',
  'sumario-alta': 'finalizar o sumário de alta',
  'relatorio-transferencia': 'emitir o relatório de transferência',
  receita: 'emitir receita',
  'receita-controlada': 'emitir receita de controle especial',
  'pedido-exame': 'solicitar exames',
  tcle: 'emitir o termo de consentimento',
  'parecer-pedido': 'pedir parecer',
  'parecer-resposta': 'responder parecer',
  alergia: 'registrar alergia',
  problema: 'registrar problema',
  'ciencia-critico': 'dar ciência de valor crítico',
  anexo: 'anexar documento',
};

/** A categoria pode praticar a ação? (com o motivo, para a tela e para a recusa do servidor) */
export function podePraticar(p: Profissional, acao: AcaoClinica): DecisaoAcao {
  const rotulo = ROTULO_ACAO[acao];
  if (!p.categoria)
    return { pode: false, motivo: `Sem ocupação no cadastro de profissionais para ${rotulo}.` };
  if (!p.conselhoAtivo)
    return { pode: false, motivo: `É preciso registro ativo no conselho profissional para ${rotulo}.` };
  if (SO_MEDICO.has(acao))
    return p.categoria === 'medico'
      ? { pode: true, motivo: null }
      : { pode: false, motivo: `Só médico pode ${rotulo} (Lei 12.842/2013).` };
  if (PRESCRITOR.has(acao))
    return p.categoria === 'medico' || p.categoria === 'odontologia'
      ? { pode: true, motivo: null }
      : { pode: false, motivo: `Só médico ou cirurgião-dentista pode ${rotulo}.` };
  if (MULTIPROFISSIONAL.has(acao))
    return p.categoria === 'outros'
      ? { pode: false, motivo: `A ocupação não é assistencial para ${rotulo}.` }
      : { pode: true, motivo: null };
  return { pode: false, motivo: `Ação não prevista: ${rotulo}.` };
}

/** Ação do atestado pelo tipo do documento (o atestado médico é privativo; os demais, multiprofissionais). */
export function acaoDoAtestado(tipo: 'atestado' | 'declaracao' | 'requerimento'): AcaoClinica {
  return tipo === 'atestado'
    ? 'atestado-medico'
    : tipo === 'declaracao'
      ? 'declaracao-comparecimento'
      : 'requerimento';
}
