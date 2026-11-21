// Leitura da ficha anestésica e do checklist pela porta própria, com um leitor dublê que devolve linhas no vocabulário
// do modelo (CHECK das tabelas): cada código chega à tela pelo mapa explícito, e o código desconhecido é recusado.
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaAnestesiaPropria } from './anestesia-porta-propria.js';
import { PortaBlocoSeguroPropria } from './bloco-seguro-porta-propria.js';
import {
  ErroVocabularioBanco,
  MARCO_FICHA,
  PARTE_FICHA,
  RESPOSTA_CHECKLIST,
  SITUACAO_CHECKLIST,
} from './vocabulario-banco.js';

type Linha = Record<string, unknown>;
const ctx = { cliente: 'dubl', estabelecimento: 1, usuario: 1, correlacao: 'teste' };
const em = (h: string) => new Date(`2030-01-10T${h}:00.000Z`);

/** Leitor dublê: a primeira regra cujo trecho aparece no SQL responde. */
function nucleoDuble(regras: readonly [string, Linha[]][]) {
  const responder = (sql: string): Linha[] => regras.find(([t]) => sql.includes(t))?.[1] ?? [];
  const l = {
    consultar: async (sql: string) => responder(sql),
    uma: async (sql: string) => responder(sql)[0] ?? null,
  } as unknown as Leitor;
  return { lerSomente: <T>(_c: unknown, fn: (x: Leitor) => Promise<T>) => fn(l) } as never;
}

const FICHA: Linha = {
  id: 10,
  situacao: 'encerrada',
  versao: 3,
  sala_cirurgica_id: 2,
  atendimento_id: 5,
  paciente_id: 6,
  anestesista_profissional_id: 7,
  criado_em: em('09:00'),
  inicio_previsto_em: em('09:30'),
  assinada_em: null,
};
const LANC = (id: number, parte: string): Linha => ({
  id,
  parte,
  momento_inicio: em('10:00'),
  momento_fim: null,
  criado_em: em('10:00'),
  login: 'u',
  profissional_id: null,
});

describe('vocabulário do banco → contrato', () => {
  it('os mapas cobrem os códigos do CHECK e recusam o desconhecido nos dois sentidos', () => {
    expect(MARCO_FICHA.doBanco('entrada_sala')).toBe('entradaSala');
    expect(PARTE_FICHA.doBanco('modo_ventilatorio')).toBe('modoRespiratorio');
    expect(PARTE_FICHA.doBanco('bomba_infusao')).toBe('bi');
    expect(PARTE_FICHA.paraBanco('bi')).toBe('bomba_infusao');
    expect(RESPOSTA_CHECKLIST.doBanco('nao_se_aplica')).toBe('na');
    expect(SITUACAO_CHECKLIST.doBanco('em_andamento')).toBe('aberto');
    expect(SITUACAO_CHECKLIST.doBanco('dispensado')).toBe('dispensado');
    expect(() => PARTE_FICHA.doBanco('xyz')).toThrow(ErroVocabularioBanco);
  });

  it('a ficha lida traz os marcos vigentes e as partes no código do contrato, campo a campo', async () => {
    const porta = new PortaAnestesiaPropria(
      nucleoDuble([
        ['FROM estabelecimento', [{ fuso_horario: 'UTC' }]],
        ['FROM ficha_anestesica f', [FICHA]],
        [
          'FROM marco_ficha_anestesica',
          [
            { marco: 'entrada_sala', momento: em('09:40') },
            { marco: 'intubacao', momento: em('09:50') },
            { marco: 'inicio_cirurgia', momento: em('10:05') },
          ],
        ],
        [
          'FROM lancamento_ficha_anestesica',
          [LANC(1, 'modo_ventilatorio'), LANC(2, 'bomba_infusao'), LANC(3, 'sinal')],
        ],
      ]),
    );
    const f = await porta.ficha(ctx, 99);
    expect(f).toMatchObject({ id: 10, situacao: 'encerrada', versao: 3, sala: 2, reg: 5, abertura: 7 });
    expect(f?.marcos).toEqual({ entradaSala: '2030-01-10 09:40', inicioCirurgia: '2030-01-10 10:05' });
    expect(f?.lancamentos.map((x) => x.parte)).toEqual(['modoRespiratorio', 'bi', 'sinal']);
  });

  it('a ficha com parte fora do vocabulário é recusada (não chega à tela com outro sentido)', async () => {
    const porta = new PortaAnestesiaPropria(
      nucleoDuble([
        ['FROM estabelecimento', [{ fuso_horario: 'UTC' }]],
        ['FROM ficha_anestesica f', [FICHA]],
        ['FROM lancamento_ficha_anestesica', [LANC(1, 'parte_nova')]],
      ]),
    );
    await expect(porta.ficha(ctx, 99)).rejects.toBeInstanceOf(ErroVocabularioBanco);
  });

  it('o checklist lido traz a situação, o momento e a resposta no código do contrato', async () => {
    const porta = new PortaBlocoSeguroPropria(
      nucleoDuble([
        ['FROM estabelecimento', [{ fuso_horario: 'UTC' }]],
        [
          'FROM checklist_cirurgia_segura c',
          [
            {
              id: 20,
              agendamento_cirurgico_id: 99,
              sala_cirurgica_id: 2,
              atendimento_id: 5,
              paciente_id: 6,
              ato_cirurgico_id: 30,
              modelo_checklist_cirurgia_id: 1,
              versao: 2,
              situacao: 'dispensado',
              inicio_previsto_em: em('09:30'),
              dispensado_urgencia: 1,
              justificativa_dispensa: 'Urgência',
              criado_em: em('09:00'),
              alterado_em: em('09:10'),
            },
          ],
        ],
        [
          'FROM confirmacao_checklist_cirurgia',
          [
            {
              id: 1,
              checklist_cirurgia_segura_id: 20,
              resposta: 'nao_se_aplica',
              codigo: 'X1',
              momento: 'inducao',
              confirmado_em: em('09:05'),
              login: 'u',
              profissional_id: 7,
              observacao: null,
            },
            {
              id: 2,
              checklist_cirurgia_segura_id: 20,
              resposta: 'sim',
              codigo: 'X2',
              momento: 'incisao',
              confirmado_em: em('09:06'),
              login: 'u',
              profissional_id: 7,
              observacao: null,
            },
          ],
        ],
      ]),
    );
    const k = await porta.checklist(ctx, 99);
    expect(k).toMatchObject({
      id: 20,
      situacao: 'dispensado',
      versao: 2,
      cirurgia: 30,
      excecaoMotivo: 'Urgência',
    });
    expect(k?.confirmacoes.map((c) => [c.momento, c.item, c.resposta])).toEqual([
      ['inducao', 'X1', 'na'],
      ['incisao', 'X2', 'sim'],
    ]);
  });
});
