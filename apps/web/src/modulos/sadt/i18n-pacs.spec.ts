// M47 (etapa 3): os textos da lista de trabalho DICOM cobrem toda situação, entrega e status do contrato e toda recusa
// das gravações; nada cita o sistema anterior nem nome de tabela.
import { CODIGOS_ENTREGA_MWL, CODIGOS_SITUACAO_WORKLIST, CODIGOS_STATUS_ESTUDO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensPacs as m } from './i18n-pacs';

describe('textos da lista de trabalho DICOM', () => {
  it('cobrem as situações, as entregas e os status', () => {
    for (const s of CODIGOS_SITUACAO_WORKLIST) expect(m.situacoes[s], s).toBeTruthy();
    for (const s of CODIGOS_ENTREGA_MWL) expect(m.entregas[s], s).toBeTruthy();
    for (const s of CODIGOS_STATUS_ESTUDO) expect(m.status[s], s).toBeTruthy();
  });
  it('toda recusa das gravações tem texto; nenhum nome de tabela nem do sistema anterior', () => {
    for (const c of [
      'recurso-desligado',
      'mwl-desatualizado',
      'pacs-sem-destino',
      'reenvios-esgotados',
      'simulador-fora-de-uso',
      'ja-na-worklist',
    ])
      expect(m.recusas[c as keyof typeof m.recusas], c).toBeTruthy();
    const tudo = JSON.stringify(m);
    expect(tudo).not.toMatch(/SPDATA|legado|sistema atual|SGH_|SILANEXA|SIPACS/i);
  });
});
