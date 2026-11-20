// Sugestão automática de notificação (M48, etapa 2, regra 4): as fontes, a resolução e a origem gravada sem ligar a
// pessoa à notificação anônima. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  fonteDaChecagem,
  lerOrigem,
  lesaoSugere,
  origemDe,
  origemParaGravar,
  semeDaSugestaoResolvida,
  sugestoesDoUsuario,
  TETO_SUGESTOES_POR_FONTE,
} from './sugestao.js';

const ch = (id: number, situacao: string, motivo: string | null, avisos: string | null = null) => ({
  id,
  situacao,
  motivo,
  avisos,
  horaReal: `2026-10-2${String(id % 5)}T10:00:00`,
  atendimento: 80,
});

describe('sugestão automática', () => {
  it('a checagem sugere a omissão (falta do item, ausência) e o erro interceptado; recusa e jejum não', () => {
    expect(fonteDaChecagem(ch(1, 'N', 'faltaItem'))).toBe('omitida');
    expect(fonteDaChecagem(ch(1, 'N', 'ausente'))).toBe('omitida');
    expect(fonteDaChecagem(ch(1, 'N', 'recusa'))).toBeNull();
    expect(fonteDaChecagem(ch(1, 'N', null))).toBeNull();
    expect(fonteDaChecagem(ch(1, 'N', 'recusa', 'Dose acima da prescrita'))).toBe('interceptado');
    expect(fonteDaChecagem(ch(1, 'A', null, 'Aviso conferido'))).toBeNull();
  });

  it('monta as sugestões das três fontes, sem as resolvidas, das mais recentes para as mais antigas', () => {
    const r = sugestoesDoUsuario(
      {
        checagens: [ch(1, 'N', 'faltaItem'), ch(2, 'N', 'recusa', 'Paciente errado'), ch(3, 'N', 'recusa')],
        reacoes: [
          { id: 7, inicioEm: '2026-10-25T08:00:00', grau: 2, enviada: false },
          { id: 8, inicioEm: '2026-10-25T09:00:00', grau: 1, enviada: true },
        ],
        checklists: [{ id: 9, excecaoEm: '2026-10-24T07:00:00' }],
      },
      (o) => o === 'checklist:9',
    );
    expect(r.map((s) => s.origem)).toEqual(['reacao:7', 'interceptado:2', 'omitida:1']);
    const omitida = r.find((s) => s.fonte === 'omitida')!;
    expect(omitida).toMatchObject({ tipo: 'medicacao', chegouAoPaciente: true, atendimento: 80 });
    expect(omitida.descricao).toBe('Dose não administrada em 21/10/2026 às 10:00 (motivo: Falta do item).');
    expect(r.find((s) => s.fonte === 'interceptado')!.chegouAoPaciente).toBe(false);
    expect(r.find((s) => s.fonte === 'reacao')!.descricao).toContain('grau 2');
    const ck = sugestoesDoUsuario(
      { checagens: [], reacoes: [], checklists: [{ id: 9, excecaoEm: '2026-10-24T07:00:00' }] },
      () => false,
    );
    expect(ck[0]).toMatchObject({ tipo: 'cirurgia', chegouAoPaciente: false });
  });

  it('teto por fonte e ordem estável', () => {
    const muitas = Array.from({ length: TETO_SUGESTOES_POR_FONTE + 5 }, (_, i) => ({
      ...ch(i + 1, 'N', 'faltaItem'),
      horaReal: '2026-10-25T10:00:00',
    }));
    expect(sugestoesDoUsuario({ checagens: muitas, reacoes: [], checklists: [] }, () => false)).toHaveLength(
      TETO_SUGESTOES_POR_FONTE,
    );
  });

  it('a origem: formato, leitura e o que vai gravado (a anônima só com a fonte)', () => {
    expect(origemDe('reacao', 12)).toBe('reacao:12');
    expect(lerOrigem('reacao:12')).toEqual({ fonte: 'reacao', id: 12 });
    expect(lerOrigem('reacao:0')).toBeNull();
    expect(lerOrigem('outra:1')).toBeNull();
    expect(lerOrigem('omitida:99999999999999999')).toBeNull();
    expect(origemParaGravar('omitida:5', false)).toBe('omitida:5');
    expect(origemParaGravar('omitida:5', true)).toBe('omitida');
    expect(origemParaGravar('xyz:5', false)).toBeNull();
    expect(origemParaGravar(null, false)).toBeNull();
    expect(semeDaSugestaoResolvida('pc', ' sint.enf ', 'omitida:5')).toBe(
      'sante-nsp-sugestao:pc:SINT.ENF:omitida:5',
    );
  });

  it('o horário marcado como não administrado por fora vira a sugestão da dose não administrada, para conferir', () => {
    const r = sugestoesDoUsuario(
      {
        checagens: [ch(7, 'N', 'faltaItem')],
        reacoes: [],
        checklists: [],
        horarios: [{ id: 9001, quando: '2026-10-23T08:00:00', atendimento: 81 }],
      },
      (o) => o === 'naoAdministrada:1',
    );
    const h = r.find((x) => x.fonte === 'naoAdministrada');
    expect(h).toMatchObject({
      origem: 'naoAdministrada:9001',
      tipo: 'medicacao',
      atendimento: 81,
      chegouAoPaciente: true,
    });
    expect(h?.descricao).toContain('23/10/2026 às 08:00');
    expect(lerOrigem('naoAdministrada:9001')).toEqual({ fonte: 'naoAdministrada', id: 9001 });
    expect(origemParaGravar('naoAdministrada:9001', true)).toBe('naoAdministrada');
    // Resolvida, some; sem a lista (porta antiga), nada muda.
    expect(
      sugestoesDoUsuario(
        {
          checagens: [],
          reacoes: [],
          checklists: [],
          horarios: [{ id: 1, quando: '2026-10-23T08:00:00', atendimento: null }],
        },
        (o) => o === 'naoAdministrada:1',
      ),
    ).toEqual([]);
    expect(sugestoesDoUsuario({ checagens: [], reacoes: [], checklists: [] }, () => false)).toEqual([]);
  });

  it('a LPP adquirida sugere (grave nos estágios avançados); a presente na admissão e a inativada não', () => {
    const le = (id: number, o: Partial<Parameters<typeof lesaoSugere>[0]> = {}) => ({
      id,
      estagio: 'estagio2' as const,
      presenteNaAdmissao: false,
      inativada: false,
      identificadaEm: '2026-11-10T08:30:00',
      atendimento: 81,
      ...o,
    });
    expect(lesaoSugere(le(1))).toEqual({ sugerir: true, grave: false });
    expect(lesaoSugere(le(1, { estagio: 'estagio3' }))).toEqual({ sugerir: true, grave: true });
    expect(lesaoSugere(le(1, { estagio: 'tissularProfunda' }))).toEqual({ sugerir: true, grave: true });
    expect(lesaoSugere(le(1, { presenteNaAdmissao: true, estagio: 'estagio4' }))).toEqual({
      sugerir: false,
      grave: false,
    });
    expect(lesaoSugere(le(1, { inativada: true }))).toEqual({ sugerir: false, grave: false });
    const r = sugestoesDoUsuario(
      {
        checagens: [],
        reacoes: [],
        checklists: [],
        lesoes: [
          le(4),
          le(5, { estagio: 'estagio4', identificadaEm: '2026-11-11T09:00:00' }),
          le(6, { presenteNaAdmissao: true }),
          le(7, { inativada: true }),
          le(8, { identificadaEm: '2026-11-09T07:00:00' }),
        ],
      },
      (o) => o === 'lesao:8',
    );
    expect(r.map((s) => s.origem)).toEqual(['lesao:5', 'lesao:4']);
    expect(r[0]).toMatchObject({
      fonte: 'lesao',
      tipo: 'lesaoPressao',
      titulo: 'Lesão por pressão adquirida',
      chegouAoPaciente: true,
      atendimento: 81,
    });
    expect(r[0]!.descricao).toBe(
      'Lesão por pressão adquirida na internação (Estágio 4), identificada em 11/11/2026 às 09:00. ' +
        'Estágio grave: avalie a notificação como evento adverso grave.',
    );
    expect(r[1]!.descricao).toBe(
      'Lesão por pressão adquirida na internação (Estágio 2), identificada em 10/11/2026 às 08:30.',
    );
    expect(lerOrigem('lesao:5')).toEqual({ fonte: 'lesao', id: 5 });
  });
});
