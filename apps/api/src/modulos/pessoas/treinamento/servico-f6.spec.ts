// Serviços da fatia F6 (M52.6) sem a HTTP, com as portas em memória: o que depende da liberação desligada (POL-3) e da
// sessão "como" (ADR 0021): o "Meu espaço" desligado não lê nada pessoal; o lançamento no repasse sem a chave (DP-33) é
// recusado sem gravar; a ciência do POP e o registro e a decisão do realizado não se fazem na sessão de suporte; o
// coordenador não aprova o realizado do próprio plantão.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { csv, type SessaoCadastro } from '../../cadastro/comum.js';
import { ServicoMeuEspaco } from '../autoatendimento/servico-meu-espaco.js';
import { PortaEscalaMemoria } from '../escala/porta-escala-memoria.js';
import { PortaRealizadoMemoria } from '../escala/porta-realizado-memoria.js';
import { ServicoRealizado } from '../escala/servico-realizado.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import { PortaSesmtMemoria } from '../sesmt/porta-sesmt-memoria.js';
import { PortaTreinamentoMemoria } from './porta-treinamento-memoria.js';
import { ServicoTreinamento } from './servico-treinamento.js';

const sessao = (login: string, como = false, pode: (c: string) => boolean = () => true): SessaoCadastro =>
  ({
    req: { sghComo: como ? { alvo: login } : undefined, sgh: undefined, headers: {} },
    hospital: 'aa',
    rede: '',
    login,
    porta: { rede: '', hospital: 'aa' },
    pode,
  }) as unknown as SessaoCadastro;

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error).message}`;
  }
}

function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-26';
  const escala = new PortaEscalaMemoria(pessoas);
  const ponto = new PortaPontoMemoria(pessoas);
  const sesmt = new PortaSesmtMemoria(pessoas);
  const porta = new PortaTreinamentoMemoria(pessoas);
  const realizado = new PortaRealizadoMemoria(escala, pessoas);
  realizado.agoraFixo = '2026-10-26T10:00';
  const treino = new ServicoTreinamento(porta, pessoas, trilha, null, null);
  return {
    pessoas,
    ponto,
    realizado,
    treino,
    meu: new ServicoMeuEspaco(pessoas, ponto, escala, sesmt, treino, trilha, null, null),
    real: new ServicoRealizado(realizado, pessoas, ponto, trilha, null, null),
  };
}

describe('serviços da F6 (M52.6)', () => {
  it('CSV do relatório ao repasse: nome que abriria fórmula na planilha sai com apóstrofo (CWE-1236)', () => {
    expect(csv('=HYPERLINK("http://x","abrir")')).toBe(`"'=HYPERLINK(""http://x"",""abrir"")"`);
    expect(csv('+SOMA(A1)')).toBe("'+SOMA(A1)");
    expect(csv('@x')).toBe("'@x");
    expect(csv('-1')).toBe("'-1");
    expect(csv('\tx')).toBe("'\tx");
    expect(csv('a;b')).toBe('"a;b"');
    expect(csv('linha\rquebrada')).toBe('"linha\rquebrada"');
    expect(csv(1470.5)).toBe('1470.5');
    expect(csv(null)).toBe('');
    expect(csv('PLANTONISTA SINTETICO')).toBe('PLANTONISTA SINTETICO');
  });

  it('Meu espaço desligado (sem a configuração): só o aviso, nada pessoal', async () => {
    const { meu } = montar();
    const m = await meu.meuEspaco(sessao('SINT.COLAB.PONTO'), null);
    expect(m.liberado.ligada).toBe(false);
    expect(m.colaborador).toBeNull();
    expect(m.folha.disponivel).toBe(false);
  });

  it('o lançamento no repasse sem a chave (DP-33) é recusado sem gravar', async () => {
    const { real, realizado } = montar();
    const ap = await real.apoioTela(sessao('SINT.REP.ANALISTA'));
    expect(ap.repasse.ligado).toBe(false);
    expect(ap.acoes.lancar).toBe(false);
    expect(
      await codigo(
        real.lancar(sessao('SINT.REP.ANALISTA'), {
          competencia: '2026-10',
          prestador: 1,
          registro: 1,
          realizados: [1],
        }),
      ),
    ).toBe('repasse-plantao-desligado');
    expect(realizado.lancados).toHaveLength(0);
  });

  it('sessão "como": nem a ciência do POP nem o registro ou a decisão do realizado (D-COMO-526)', async () => {
    const { treino, real } = montar();
    const como = sessao('SINT.COLAB.PONTO', true);
    expect(await codigo(treino.ciencia(como, { pop: 1, vinculo: null }, [1]))).toBe('sessao-como');
    expect(
      await codigo(
        real.registrar(como, {
          plantao: 1,
          inicio: '2026-10-24T19:00',
          fim: '2026-10-25T07:00',
          origem: 'informado',
          observacao: null,
        }),
      ),
    ).toBe('sessao-como');
    expect(
      await codigo(real.decidir(como, { realizado: 1, decisao: 'aprovar', motivo: null, versao: 0 })),
    ).toBe('sessao-como');
    const ap = await real.apoioTela(como);
    expect(ap.acoes).toMatchObject({ registrar: false, aprovar: false });
  });

  it('sem a permissão, o registro, a decisão e a tarifa são recusados', async () => {
    const { real, treino } = montar();
    const sem = sessao('SINT.COLAB', false, () => false);
    expect(
      await codigo(
        real.registrar(sem, {
          plantao: 1,
          inicio: '2026-10-24T19:00',
          fim: '2026-10-25T07:00',
          origem: 'informado',
          observacao: null,
        }),
      ),
    ).toBe('sem-permissao');
    expect(
      await codigo(real.decidir(sem, { realizado: 1, decisao: 'aprovar', motivo: null, versao: 0 })),
    ).toBe('sem-permissao');
    expect(
      await codigo(
        real.incluirTarifa(sem, {
          tipo: 'presencial',
          unidade: null,
          inicio: '2026-01-01',
          fim: null,
          valorHora: 1,
        }),
      ),
    ).toBe('sem-permissao');
    expect(await codigo(real.encerrarTarifa(sem, { tarifa: 1, fim: '2026-01-02' }))).toBe('sem-permissao');
    expect(
      await codigo(
        treino.incluirCurso(sem, {
          codigo: 'X1',
          titulo: 'Curso',
          conteudo: 'Conteúdo sintético',
          categoria: 'outro',
          cargaMinimaMin: 60,
          validadeMeses: 0,
          obrigatorio: false,
          alvos: [],
        }),
      ),
    ).toBe('sem-permissao');
  });
});
