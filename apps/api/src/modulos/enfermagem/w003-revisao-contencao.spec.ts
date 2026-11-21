// Revisão do W0-03 (contenção mecânica): as regras do serviço sem banco nem HTTP, com dados sintéticos.
//   - a renovação ANTES do fim do prazo corta a anterior como a retirada (o horário da anterior depois do início da
//     nova fica cancelado na tela e não conta como previsto; as horas da anterior vão até o início da nova);
//   - a vigia não grava trilha quando não há aviso novo (dois ciclos sobre a mesma vencida: 1 aviso e 1 linha);
//   - o técnico de enfermagem com a permissão de aprazar não prescreve a contenção (a categoria vem do vínculo).
import { describe, expect, it } from 'vitest';
import { ContencaoController } from './contencao.controller.js';
import { contencaoParaTela, indicadorDoPeriodo, VigiaContencao } from './contencao-servico.js';
import type { PortaEscores } from './escores-porta.js';
import type { PortaEnfermagem } from './porta.js';
import type { ContencaoRegistrada } from './tipos.js';

const ALVO = { cliente: 'teste', estabelecimento: 1, usuario: null, correlacao: 'teste' };

const horarios = (lista: readonly string[], feitas: readonly string[] = []) =>
  lista.map((previsto, i) => ({
    id: i + 1,
    previsto,
    checagem: feitas.includes(previsto)
      ? {
          achados: { perfusao: 'normal' },
          alterado: false,
          observacao: null,
          usuario: 'TEC',
          feitaEm: `${previsto}:00`,
        }
      : null,
  }));

const base = {
  paciente: 1,
  atendimento: 10,
  unidade: 'UTI',
  motivo: 'agitacao',
  justificativa: 'Agitação sem resposta a outras medidas',
  tipo: 'leito',
  membros: ['msd'],
  prazoHoras: 4,
  intervaloMinutos: 60,
  prescritor: 'ENF',
  criadoEm: '',
  encerramento: null,
};

// A: 08:00, 4 h, a cada 60 min (09, 10, 11, 12); 09, 10 e 11 checadas. Renovada às 11:30 por B (4 h: 12:30 a 15:30,
// todas checadas no horário).
const A: ContencaoRegistrada = {
  ...base,
  id: 1,
  inicio: '2026-10-25T08:00:00',
  anterior: null,
  renovadaPor: 2,
  renovadaEm: '2026-10-25T11:30:00',
  horarios: horarios(
    ['2026-10-25T09:00', '2026-10-25T10:00', '2026-10-25T11:00', '2026-10-25T12:00'],
    ['2026-10-25T09:00', '2026-10-25T10:00', '2026-10-25T11:00'],
  ),
};
const B: ContencaoRegistrada = {
  ...base,
  id: 2,
  inicio: '2026-10-25T11:30:00',
  anterior: 1,
  renovadaPor: null,
  renovadaEm: null,
  horarios: horarios(
    ['2026-10-25T12:30', '2026-10-25T13:30', '2026-10-25T14:30', '2026-10-25T15:30'],
    ['2026-10-25T12:30', '2026-10-25T13:30', '2026-10-25T14:30', '2026-10-25T15:30'],
  ),
};

describe('revisão W0-03: a renovação antes do fim do prazo', () => {
  it('o indicador não conta a sobreposição: 7 / 7 = 100% e 7,5 horas contidas', () => {
    const i = indicadorDoPeriodo(
      'UTI',
      '2026-10-25',
      '2026-10-25',
      [A, B],
      { pacientesDia: 8, diasFechados: 1 },
      '2026-10-25T23:00',
      15,
    );
    expect(i.checagensNoPrazo).toEqual({ numerador: 7, denominador: 7, percentual: 100 });
    expect(i.horasContidas).toBe(7.5);
    // A renovação não é contenção nova.
    expect(i.contencoes.numerador).toBe(1);
    expect(i.impressao).toMatch(/Checagens no prazo: 7 \/ 7 = 100%\. Horas contidas: 7\.5\./);
  });

  it('na tela, o horário da anterior depois do início da renovação fica cancelado (não atrasado)', () => {
    const t = contencaoParaTela(A, '2026-10-25T13:00', 15);
    expect(t.situacao).toBe('renovada');
    expect(t.renovadaEm).toBe('2026-10-25T11:30');
    expect(t.horarios.map((h) => h.estado)).toEqual(['feita', 'feita', 'feita', 'cancelada']);
    // Sem a renovação vigente (inativada), o mesmo horário seria atrasado.
    const sem = contencaoParaTela({ ...A, renovadaPor: null, renovadaEm: null }, '2026-10-25T13:00', 15);
    expect(sem.horarios.at(-1)!.estado).toBe('atrasada');
  });
});

describe('revisão W0-03: a vigia grava a trilha só com aviso novo', () => {
  it('dois ciclos sobre a mesma ordem vencida: 1 aviso e 1 linha de trilha', async () => {
    const vencida: ContencaoRegistrada = {
      ...base,
      id: 9,
      inicio: '2026-10-25T08:00:00',
      prazoHoras: 1,
      anterior: null,
      renovadaPor: null,
      horarios: horarios(['2026-10-25T09:00']),
    };
    const avisados = new Set<string>();
    const trilhas: unknown[] = [];
    const porta = {
      contencoes: async () => [vencida],
      gravarSgh: async (
        _c: unknown,
        trilha: (r: number) => unknown,
        fn: (g: {
          avisar: (xs: { login: string; objetoChave: string }[]) => Promise<number>;
        }) => Promise<number>,
      ) => {
        // A "transação": a trilha só é gravada se a função terminar (exceção desfaz tudo).
        const r = await fn({
          avisar: async (xs) => {
            let k = 0;
            for (const x of xs) {
              const chave = `${x.login}:${x.objetoChave}`;
              if (avisados.has(chave)) continue;
              avisados.add(chave);
              k++;
            }
            return k;
          },
        });
        trilhas.push(trilha(r));
        return r;
      },
    } as unknown as PortaEscores;
    const enfermagem = { relogio: async () => '2026-10-25T12:00:00' } as unknown as PortaEnfermagem;
    const vigia = new VigiaContencao(porta, enfermagem, [ALVO]);
    expect(await vigia.ciclo(ALVO)).toBe(1);
    expect(await vigia.ciclo(ALVO)).toBe(0);
    expect(await vigia.ciclo(ALVO)).toBe(0);
    expect(trilhas).toHaveLength(1);
    expect(trilhas[0]).toMatchObject({ entidade: 'aviso_central', dadosDepois: { avisos: 1 } });
  });
});

describe('revisão W0-03: quem prescreve a contenção', () => {
  const controlador = (cbo: string) =>
    new ContencaoController(
      {} as PortaEscores,
      { vinculos: async () => [{ codigo: cbo }] } as unknown as PortaEnfermagem,
      { registrar: async () => undefined } as never,
    );
  const sessao = (permissoes: readonly string[]) => ({
    login: 'SINT.X',
    porta: { rede: 'r', hospital: 'aa' },
    pode: (p: string) => permissoes.includes(p),
  });
  const pode = (c: ContencaoController, s: ReturnType<typeof sessao>) =>
    (c as unknown as { podePrescrever(s: unknown): Promise<boolean> }).podePrescrever(s);

  it('o técnico com a permissão de aprazar não prescreve; o enfermeiro com ela, sim; o prescritor sempre', async () => {
    const aprazar = sessao(['enfermagem.horario.aprazar']);
    expect(await pode(controlador('322205'), aprazar)).toBe(false);
    expect(await pode(controlador('223505'), aprazar)).toBe(true);
    expect(await pode(controlador('322205'), sessao(['pep.prescricao.criar']))).toBe(true);
    expect(await pode(controlador('223505'), sessao([]))).toBe(false);
  });
});
