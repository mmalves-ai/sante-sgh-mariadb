// M37, regra 5: o mascaramento e o reinício do treino recusam destino que não seja container de treino do projeto,
// AMBIENTE diferente de treino e método não registrado; o plano mascara as colunas pessoais, os textos longos e os
// BLOBs de texto; o reinício restaura, neutraliza, mascara, recria a turma, verifica e cabe em 1 h.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  conferirDestinoTreino,
  conferirMetodo,
  ErroTreino,
  type ExecutorTreino,
  lerColunasDaSaida,
  lerListaPessoais,
  mascarar,
  planoMascaramento,
  reiniciarTreino,
  RTF_SINTETICO,
} from './treino.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const lista = lerListaPessoais(raiz);
const SAIDA_COLUNAS = [
  'C                               RICADPAC|NOME|37|-1|60',
  'C                               RICADPAC|CPF|16|-1|8',
  'C                               PREVOL|TEXTO|261|1|8',
  'C                               PREVOL|IMAGEM|261|0|8',
  'C                               TBUNIDAD|COD|7|-1|2',
  'C                               TBUNIDAD|OBS|37|-1|200',
  'C                               SGH_TRILHA|USUARIO|37|-1|31',
  'C                               HTPACIENTE|DATA_NASCIMENTO|35|-1|8',
].join('\n');

function dockerFalso(falhar: string[] = []): ExecutorTreino & { chamadas: string[][] } {
  const chamadas: string[][] = [];
  return {
    chamadas,
    executar(args, entrada) {
      chamadas.push([...args, entrada ?? '']);
      if (falhar.some((f) => args.includes(f))) return { codigo: 1, saida: '', erro: 'falhou' };
      if ((entrada ?? '').includes('RDB$RELATION_FIELDS'))
        return { codigo: 0, saida: SAIDA_COLUNAS, erro: '' };
      return { codigo: 0, saida: '', erro: '' };
    },
  };
}

describe('destino e método do treino', () => {
  it('só container de treino do projeto, só AMBIENTE=treino; nunca a cópia de dev nem outro projeto', () => {
    expect(conferirDestinoTreino('redesante-fb-treino-pc', 'treino')).toBe('pc');
    expect(() => conferirDestinoTreino('redesante-fb-pc', 'treino')).toThrow(/não é container de treino/);
    expect(() => conferirDestinoTreino('sante-firebird', 'treino')).toThrow(/outro projeto/);
    expect(() => conferirDestinoTreino('redesante-fb-treino-pc', 'dev')).toThrow(/AMBIENTE=treino/);
    expect(() => conferirDestinoTreino(undefined, 'treino')).toThrow(/--container/);
  });
  it('sem o método registrado pelo dono: bloqueado (DP-41); método desconhecido recusa', () => {
    try {
      conferirMetodo(undefined);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroTreino);
      expect((e as ErroTreino).bloqueado).toBe(true);
    }
    expect(() => conferirMetodo('outro')).toThrow(/desconhecido/);
    expect(conferirMetodo('substituicao-sintetica-v1')).toBe('substituicao-sintetica-v1');
  });
});

describe('plano do mascaramento', () => {
  it('mascara nome, CPF, BLOB de texto (RTF sintético), imagem, texto longo e a data de nascimento; nunca SGH_ nem código', () => {
    const colunas = lerColunasDaSaida(SAIDA_COLUNAS);
    expect(colunas).toHaveLength(8);
    const plano = planoMascaramento(colunas, lista);
    expect(plano.some((p) => p.startsWith('UPDATE RICADPAC SET NOME = SUBSTRING('))).toBe(true);
    expect(plano).toContain('UPDATE RICADPAC SET CPF = 0 WHERE CPF IS NOT NULL;');
    expect(plano).toContain(`UPDATE PREVOL SET TEXTO = '${RTF_SINTETICO}' WHERE TEXTO IS NOT NULL;`);
    expect(plano.some((p) => p.startsWith('UPDATE TBUNIDAD SET OBS ='))).toBe(true);
    expect(plano.some((p) => p.includes('HTPACIENTE SET DATA_NASCIMENTO = DATEADD'))).toBe(true);
    expect(plano).toContain('UPDATE PREVOL SET IMAGEM = NULL WHERE IMAGEM IS NOT NULL;');
    expect(plano.some((p) => p.includes('SGH_TRILHA') || p.includes('TBUNIDAD SET COD'))).toBe(false);
    expect(
      planoMascaramento(
        [{ tabela: 'X;DROP', coluna: 'NOME', tipo: 37, subtipoBlob: null, tamanho: 10 }],
        lista,
      ),
    ).toEqual([]);
  });
  it('mascarar lê o catálogo e aplica o plano numa transação no container de treino', () => {
    const d = dockerFalso();
    const r = mascarar({
      container: 'redesante-fb-treino-pc',
      banco: '/firebird/data/treino.fdb',
      ambiente: 'treino',
      metodo: 'substituicao-sintetica-v1',
      lista,
      docker: d,
    });
    expect(r).toEqual({ colunas: 8, comandos: 6 });
    expect(d.chamadas.at(-1)?.at(-1)).toMatch(/COMMIT;/);
    expect(() =>
      mascarar({
        container: 'redesante-fb-treino-pc',
        banco: '/x.fdb',
        ambiente: 'treino',
        metodo: 'substituicao-sintetica-v1',
        lista,
        docker: dockerFalso(['isql']),
      }),
    ).toThrow(/isql/);
  });
});

describe('reinício semanal', () => {
  const base = {
    container: 'redesante-fb-treino-pc',
    banco: '/firebird/data/treino.fdb',
    retrato: '/firebird/retrato/estavel.fbk',
    ambiente: 'treino',
    metodo: 'substituicao-sintetica-v1',
    turma: ['SINT.TURMA01', 'SINT.TURMA02'],
    lista,
  };
  it('restaura, neutraliza, mascara, recria a turma e verifica, em menos de 1 h', async () => {
    let t = 0;
    const passos = await reiniciarTreino({
      ...base,
      docker: dockerFalso(),
      agora: () => (t += 1_000),
      recriarTurma: (l) => Promise.resolve(l.length),
      verificar: () => Promise.resolve(0),
    });
    expect(passos.map((p) => p.passo)).toEqual([
      'restaurar o retrato estável',
      'neutralizar as saídas',
      'mascarar os dados pessoais',
      'recriar os usuários da turma',
      'verificar sem dado real',
    ]);
    expect(passos[3]?.detalhe).toBe('2 usuário(s)');
  });
  it('sem retrato: bloqueado; achado no verificador, gbak falho ou mais de 1 h: falha', async () => {
    const ok = { recriarTurma: () => Promise.resolve(0), verificar: () => Promise.resolve(0) };
    await expect(reiniciarTreino({ ...base, ...ok, docker: dockerFalso(['test']) })).rejects.toThrow(
      /retrato estável/,
    );
    await expect(reiniciarTreino({ ...base, ...ok, docker: dockerFalso(['gbak']) })).rejects.toThrow(/gbak/);
    await expect(
      reiniciarTreino({ ...base, ...ok, retrato: '/../x.fbk', docker: dockerFalso() }),
    ).rejects.toThrow(/inválido/);
    await expect(
      reiniciarTreino({
        ...base,
        recriarTurma: () => Promise.resolve(0),
        verificar: () => Promise.resolve(2),
        docker: dockerFalso(),
      }),
    ).rejects.toThrow(/achou 2/);
    let t = 0;
    await expect(
      reiniciarTreino({ ...base, ...ok, docker: dockerFalso(), agora: () => (t += 20 * 60_000) }),
    ).rejects.toThrow(/meta: 60 min/);
  });
});
