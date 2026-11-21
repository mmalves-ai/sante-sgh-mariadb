// Atestados, declarações e requerimentos (ficha do M23, regra 5; cap-05b §5.6; CFM 2.381/2024): o atestado informa os
// dias de afastamento; o CID só sai com autorização expressa do paciente (ou do responsável) registrada ANTES de
// emitir. No banco do estabelecimento o documento guarda o modelo de impressão clínica usado (código e nome) e o
// conteúdo dos campos de texto do modelo em XML (<atestado codigo_ficha nome><componentes>…), cada campo com o RTF
// preenchido; a correção é um documento novo ligado ao original (ID_PRATESTREQIMP_ORIG_CORREC; 6 em 2026).
import { problemasCp1252, type TipoAtestado } from '@sgh/contratos';
import { escaparXml } from './gravador/xml.js';
import { paragrafosDoTexto, rtfDoCampo } from './gravador/rtf.js';

export interface PedidoAtestado {
  readonly tipo: TipoAtestado;
  readonly texto: string;
  readonly diasAfastamento?: number | undefined;
  readonly cid?: string | undefined;
  readonly autorizacaoCid?: 'paciente' | 'responsavel' | undefined;
}

export interface ProblemaAtestado {
  readonly campo: string;
  readonly codigo: 'cid-sem-autorizacao' | 'sem-dias' | 'texto-cp1252' | 'cid-fora-do-atestado';
  readonly motivo: string;
}

/** Regra 5: dias informados no atestado; CID só com autorização; CID só em atestado; texto no CP1252. */
export function conferirAtestado(p: PedidoAtestado): ProblemaAtestado[] {
  const r: ProblemaAtestado[] = [];
  if (p.tipo === 'atestado' && (p.diasAfastamento === undefined || p.diasAfastamento < 0))
    r.push({
      campo: 'diasAfastamento',
      codigo: 'sem-dias',
      motivo: 'O atestado informa os dias de afastamento.',
    });
  if (p.cid && !p.autorizacaoCid)
    r.push({
      campo: 'autorizacaoCid',
      codigo: 'cid-sem-autorizacao',
      motivo: 'O CID só sai no atestado com a autorização expressa do paciente registrada.',
    });
  if (p.cid && p.tipo !== 'atestado')
    r.push({ campo: 'cid', codigo: 'cid-fora-do-atestado', motivo: 'O CID só vai no atestado médico.' });
  if (problemasCp1252(p.texto).length > 0)
    r.push({
      campo: 'texto',
      codigo: 'texto-cp1252',
      motivo: 'Caractere que o banco não guarda (troque antes de salvar).',
    });
  return r;
}

/** Texto final do documento: o corpo digitado, os dias e o CID autorizado (quando há). */
export function textoDoAtestado(p: PedidoAtestado): string {
  const partes = [p.texto.trim()];
  if (p.tipo === 'atestado' && p.diasAfastamento !== undefined)
    partes.push(`Afastamento: ${p.diasAfastamento} ${p.diasAfastamento === 1 ? 'dia' : 'dias'}.`);
  if (p.cid && p.autorizacaoCid)
    partes.push(
      `CID-10: ${p.cid} (informado com autorização expressa do ${p.autorizacaoCid === 'paciente' ? 'paciente' : 'responsável'}).`,
    );
  return partes.join('\n\n');
}

export interface ComponenteFicha {
  /** Nome do campo de texto no modelo de impressão (TRichEdit), em ordem. */
  readonly nome: string;
  /** Texto formatado do modelo (o que o campo traz pronto). */
  readonly modelo: string | null;
}

/**
 * Conteúdo do documento como o legado grava (CONTEUDO_XML): o primeiro campo de texto do modelo recebe o texto do
 * documento; os demais (rodapé com a assinatura, por exemplo) seguem o texto do modelo.
 */
export function xmlDoAtestado(
  ficha: { readonly codigo: number; readonly nome: string },
  componentes: readonly ComponenteFicha[],
  texto: string,
): string {
  const rtf = rtfDoCampo(paragrafosDoTexto(texto));
  const comps = (componentes.length > 0 ? componentes : [{ nome: 'Rch0', modelo: null }]).map((c, i) => {
    const conteudo = i === 0 ? rtf : (c.modelo ?? rtfDoCampo([]));
    return `<componente><nome>${escaparXml(c.nome)}</nome><conteudo>${escaparXml(conteudo)}</conteudo></componente>`;
  });
  return `<atestado codigo_ficha="${ficha.codigo}" nome="${escaparXml(ficha.nome)}"><componentes>${comps.join('')}</componentes></atestado>`;
}

/** Tipo do documento pelo nome do modelo de impressão (atestado, declaração ou requerimento). */
export function tipoDoModelo(nome: string): TipoAtestado {
  const n = nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  if (n.includes('ATESTADO')) return 'atestado';
  if (n.includes('DECLARA') || n.includes('COMPARECIMENTO')) return 'declaracao';
  return 'requerimento';
}
