import { resolve } from 'node:path';
import type { Escritor, Leitor } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { mensagemDoAlertaAssinatura } from './email.service.js';
import { EVENTO_ALERTA_ASSINATURA, EVENTOS_DE_EMAIL } from './relay-outbox.js';
import { cenarioDoCodigo, cicloVigiaGravacao, diaAnterior, vigiarUmDia } from './vigia-gravacao.js';
import { operacoesComGrupo, vigiaGravacaoLigada } from './vigia-gravacao.service.js';

const pastaSrc = resolve(import.meta.dirname, '../../../packages/legado/src');
const OP = 'auditoria.registrarEventoLegado';

/** Banco falso: a gravação 15 (login OK) com o cabeçalho igual à referência e sem detalhe. */
function banco() {
  const sqls: string[] = [];
  const colunas = [
    'ID',
    'DATA_HORA_ACAO',
    'ID_TBOPCOES',
    'ID_TBUSERS_TBPAPEL_LOGADO',
    'MAQUINA_USUARIO',
    'ID_ATCABECATEND',
    'ID_TBNVLCRITICID',
    'FUSO_HORARIO_LOCAL',
    'ID_TBTPACAOAUDIT',
    'ID_HTPACIENTE',
    'USUARIO',
  ];
  const l = {
    hospital: 'pc',
    async consultar(sql: string, p: readonly unknown[] = []) {
      sqls.push(sql);
      if (sql.includes('FROM SGH_TRILHA')) return [{ ID: 15, TIPO: 6 }];
      if (sql.includes('RDB$RELATION_FIELDS'))
        return p[0] === 'TBCABTRILHA' ? colunas.map((NOME) => ({ NOME, TIPO: 8 })) : [];
      if (sql.includes('FROM TBCABTRILHA')) {
        const x: Record<string, number> = {};
        colunas.forEach((c, i) => {
          x[`P${i}`] = c === 'ID_ATCABECATEND' || c === 'ID_HTPACIENTE' ? 0 : 1;
          if (c === 'FUSO_HORARIO_LOCAL') x[`C${i}`] = 1;
        });
        return [x];
      }
      return [];
    },
    async lerBlob() {
      return Buffer.alloc(0);
    },
  } as unknown as Leitor;
  const gravados: string[] = [];
  const e = {
    async executar(sql: string) {
      gravados.push(sql.trim().split(/\s/)[0]!);
      return sql.startsWith('UPDATE') ? 0 : 1;
    },
    async executarRetornando() {
      return { ID: '1' };
    },
  } as unknown as Escritor;
  return { l, e, sqls, gravados };
}

const deps = (b: ReturnType<typeof banco>, estado = 'liberada') => ({
  rede: 'redesante',
  hospitais: ['pc'],
  catalogo: { estado: (n: string) => (n === OP ? estado : 'verde') },
  operacoes: { [OP]: { grupo: 'auditoria' }, 'cadastro.cadastrarPaciente': { grupo: 'cadastro' } },
  pastaSrc,
  tamanho: 50,
  ler: <T>(_h: string, fn: (l: Leitor) => Promise<T>) => fn(b.l),
  gravarSgh: <T>(_h: string, fn: (e: Escritor) => Promise<T>) => fn(b.e),
  janela: { inicio: '03:00', fim: '05:00' },
  agoraMinutos: () => 200,
  hoje: () => '2026-11-04',
  ultimas: new Map<string, string>(),
});

describe('vigilância diária de gravação (worker)', () => {
  it('liga fora de dev/ci; em dev/ci só pedida; o dia anterior e o cenário pelo tipo do evento', () => {
    expect(vigiaGravacaoLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(vigiaGravacaoLigada({ AMBIENTE: 'producao', VIGIA_GRAVACAO: 'desligado' })).toBe(false);
    expect(vigiaGravacaoLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(vigiaGravacaoLigada({ AMBIENTE: 'ci', VIGIA_GRAVACAO: 'ligado' })).toBe(true);
    expect(diaAnterior('2026-11-01')).toBe('2026-10-31');
    expect(cenarioDoCodigo(OP, 6)).toBe('login-ok');
    expect(cenarioDoCodigo(OP, 99)).toBeNull();
    expect(cenarioDoCodigo(OP, null)).toBeNull();
    expect(cenarioDoCodigo('cadastro.cadastrarPaciente', 6)).toBeNull();
    expect(operacoesComGrupo()[OP]).toEqual({ grupo: 'auditoria' });
  });

  it('o ciclo na janela vigia o dia anterior uma vez por dia; fora da janela não roda', async () => {
    const b = banco();
    const d = deps(b);
    const [r] = await cicloVigiaGravacao(d);
    expect(r?.situacao).toBe('feita');
    expect(r?.data).toBe('2026-11-03');
    expect(r?.resultado?.resultados).toEqual([
      {
        hospital: 'pc',
        data: '2026-11-03',
        operacao: OP,
        amostradas: 1,
        divergentes: 0,
        elementos: [],
      },
    ]);
    expect(b.gravados).toEqual(['UPDATE', 'INSERT']);
    expect((await cicloVigiaGravacao(d))[0]?.situacao).toBe('ja-rodou-hoje');
    expect((await cicloVigiaGravacao({ ...deps(banco()), agoraMinutos: () => 60 }))[0]?.situacao).toBe(
      'fora-da-janela',
    );
  });

  it('sem operação liberada, nada a vigiar; ensaio não grava; falha vira situação sem derrubar o ciclo', async () => {
    const b = banco();
    const r = await vigiarUmDia(deps(b, 'verde'), 'pc', '2026-11-03');
    expect(r.resultados).toEqual([]);
    const ensaio = banco();
    const e = await vigiarUmDia(deps(ensaio), 'pc', '2026-11-03', true);
    expect(e.resultados).toHaveLength(1);
    expect(ensaio.gravados).toEqual([]);
    const quebrado = {
      ...deps(banco()),
      ler: async () => {
        throw new TypeError('x');
      },
    };
    expect((await cicloVigiaGravacao(quebrado))[0]).toMatchObject({ situacao: 'falhou', erro: 'TypeError' });
  });

  it('o alerta direto vai à fila de e-mail só com códigos e contagens', () => {
    expect(EVENTOS_DE_EMAIL.has(EVENTO_ALERTA_ASSINATURA)).toBe(true);
    const m = mensagemDoAlertaAssinatura(
      {
        hospital: 'pc',
        dia: '2026-11-03',
        operacao: OP,
        amostradas: 50,
        divergentes: 2,
        onde: 'TBCABTRILHA.FUSO_HORARIO_LOCAL,TBLANTRILHASGH',
      },
      'ti@x.invalid',
      'n@x.invalid',
    );
    expect(m.assunto).toBe('Divergência de gravação em pc (2026-11-03)');
    expect(m.texto).toContain('Divergentes: 2 de 50 amostrada(s)');
    expect(m.texto).toContain('Onde: TBCABTRILHA.FUSO_HORARIO_LOCAL, TBLANTRILHASGH');
    expect(() =>
      mensagemDoAlertaAssinatura(
        { hospital: 'pc', dia: '2026-11-03', operacao: OP, amostradas: 1, divergentes: 1, onde: 'Maria' },
        'a',
        'b',
      ),
    ).toThrow(/fora do formato/);
  });
});
