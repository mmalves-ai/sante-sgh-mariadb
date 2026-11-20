// Textos da agência transfusional (M47): nenhum cita o sistema anterior e todo código de recusa do domínio tem texto.
import {
  MENSAGENS_BOLSA,
  MENSAGENS_INICIO,
  MENSAGENS_REACAO,
  MENSAGENS_REQUISICAO,
  type BloqueioInicio,
} from '@sgh/dominio-sadt';
import { describe, expect, it } from 'vitest';
import { mensagensTransfusao } from './i18n-transfusao.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos da agência transfusional', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    const todos = [
      ...textos(mensagensTransfusao),
      ...textos(MENSAGENS_REQUISICAO),
      ...textos(MENSAGENS_INICIO),
      ...textos(MENSAGENS_BOLSA),
      ...textos(MENSAGENS_REACAO),
    ];
    expect(
      todos.filter(([, t]) => /SPDATA|legado|sistema atual|\bSH[A-Z]{3,}\b|PRPRESCHEMO|PRCHKGERAL/i.test(t)),
    ).toEqual([]);
  });

  it('todo bloqueio do início tem texto (do início ou da bolsa)', () => {
    const codigos: BloqueioInicio[] = [
      'pulseira-nao-lida',
      'pulseira-outro-paciente',
      'sem-segundo-profissional',
      'segundo-profissional-igual',
      'segundo-profissional-sem-permissao',
      'sem-amostra',
      'amostra-vencida',
      'sem-termo',
      'sem-sinais-antes',
      'sinais-antes-antigos',
      'bolsa-ja-usada',
      'requisicao-fechada',
      'horario-nao-pendente',
      'bolsa-vencida',
      'bolsa-quarentena',
      'bolsa-indisponivel',
      'abo-incompativel',
      'rh-incompativel',
      'receptor-sem-tipagem',
      'hemocomponente-diferente',
    ];
    const texto = (c: BloqueioInicio) =>
      MENSAGENS_INICIO[c] ?? (MENSAGENS_BOLSA as Record<string, string | undefined>)[c];
    expect(codigos.filter((c) => !texto(c))).toEqual([]);
  });

  it('as três medidas de sinais vitais estão nomeadas', () => {
    expect(mensagensTransfusao.ato.sinaisDurante).toMatch(/10 a 15 minutos/);
    expect(mensagensTransfusao.ato.sinaisAntes).toBeTruthy();
    expect(mensagensTransfusao.ato.sinaisDepois).toBeTruthy();
  });
});
