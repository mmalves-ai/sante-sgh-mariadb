// Textos da notificação de incidentes (M48, etapa 1): nenhum cita o sistema anterior nem tabela, nenhum usa caractere
// especial do vue-i18n, e todo evento da linha do tempo, prazo e período tem texto.
import { SITUACOES_PRAZO, TIPOS_EVENTO_NOTIFICACAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensQualidade, RECUSAS_NOTIFICACAO, RECUSAS_OCORRENCIA } from './i18n.js';
import { RECUSAS_ANALISE, RECUSAS_VIGILANCIA } from './i18n-seguranca.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

const todos = [
  ...textos(mensagensQualidade),
  ...textos(RECUSAS_NOTIFICACAO),
  ...textos(RECUSAS_OCORRENCIA),
  ...textos(RECUSAS_ANALISE),
  ...textos(RECUSAS_VIGILANCIA),
];

describe('textos da notificação de incidentes', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    expect(
      todos.filter(([, t]) => /SPDATA|legado|sistema atual|SGH_|ATCABECATEND|RICADPAC|TBUNIDAD/i.test(t)),
    ).toEqual([]);
  });

  it('nenhum texto usa "|" nem "@" (plural e ligação do vue-i18n)', () => {
    expect(todos.filter(([, t]) => /[|@]/.test(t))).toEqual([]);
  });

  it('todo evento da linha do tempo, situação de prazo e período tem texto', () => {
    for (const e of TIPOS_EVENTO_NOTIFICACAO) expect(mensagensQualidade.detalhe.eventos[e]).toBeTruthy();
    for (const s of SITUACOES_PRAZO) expect(mensagensQualidade.prazos.situacoes[s]).toBeTruthy();
    expect(Object.keys(mensagensQualidade.prazos.periodos).sort()).toEqual([
      'madrugada',
      'manha',
      'noite',
      'tarde',
    ]);
  });

  it('o diálogo diz que a notificação não é punitiva e que o gestor não vê quem notificou', () => {
    expect(mensagensQualidade.notificar.explicacao).toMatch(/não é punitiva/);
    expect(mensagensQualidade.notificar.anonima).toMatch(/gestor da área nunca vê/);
  });

  it('etapa 2: toda origem dos expostos tem texto e o painel imprime as parcelas', () => {
    expect(Object.keys(mensagensQualidade.vigilancia.origens).sort()).toEqual(['consumo-em-sala', 'estoque']);
    expect(mensagensQualidade.plano.resumo).toMatch(/\{verificadas\}/);
  });
});
