// M44 (etapa 1): os textos da classificação cobrem todo código do motor (cores, motivos, problemas da publicação e
// recusas) e não citam o sistema anterior.
import {
  CORES_RISCO,
  MOTIVOS_RECLASSIFICACAO,
  SITUACOES_PROTOCOLO,
  TIPOS_PROTOCOLO_CLASSIFICACAO,
} from '@sgh/contratos';
import type {
  DecisaoCorFinal,
  MotivoRecusaClassificacao,
  ProblemaProtocolo,
  ProblemaReclassificacao,
} from '@sgh/dominio-recepcao';
import { describe, expect, it } from 'vitest';
import { mensagensClassificacao as m } from './i18n-classificacao';

// Conferência de tipo: todo código do motor tem texto (falta um, o tsc recusa).
type Recusa =
  MotivoRecusaClassificacao | ProblemaReclassificacao | Extract<DecisaoCorFinal, { ok: false }>['motivo'];
const problemas: Record<ProblemaProtocolo['codigo'], string> = m.protocolo.problemas;
const recusas: Record<Recusa, string> = m.recusas;

describe('textos da classificação', () => {
  it('cobrem cores, motivos, tipos e situações do protocolo', () => {
    for (const c of CORES_RISCO) expect(m.cores[c.codigo]).toBe(c.rotulo);
    for (const x of MOTIVOS_RECLASSIFICACAO) expect(m.reclassificacao.motivos[x]).toBeTruthy();
    for (const t of TIPOS_PROTOCOLO_CLASSIFICACAO) expect(m.protocolo.tipos[t.codigo]).toBe(t.rotulo);
    for (const s of SITUACOES_PROTOCOLO) expect(m.protocolo.situacoes[s]).toBeTruthy();
    expect(Object.keys(problemas)).toHaveLength(11);
    expect(Object.keys(recusas)).toHaveLength(9);
  });

  it('nenhum texto cita o sistema anterior pelo nome nem pela tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = valores(m).join('\n');
    expect(tudo).not.toMatch(/spdata|legado|prmanchester|\bE08\b/i);
  });
});
