// C1-051 (06-SUS linha 53): a permissão por usuário e setor vale em todo o faturamento SUS — a AIH (laudo, ações,
// espelho, listagem) e as operações da competência inteira (criticar, fechar, gerar) — sobre a porta em memória
// (setor sintético: registro par no setor 1, ímpar no 2; a produção da competência tem os setores 1 e 2).
import { cnsValido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import { REGISTROS_AIH_SINTETICOS, SOLICITANTES_AIH_SINTETICOS } from './porta-aih-memoria.js';
import { cnsSintetico, PortaSusMemoria, setorSinteticoApac } from './porta-memoria.js';
import { ServicoSusAih } from './servico-aih.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const HOJE = new Date().toISOString().slice(0, 10);
const COMP = `${HOJE.slice(0, 4)}${HOJE.slice(5, 7)}`;
const DIRETOR = (() => {
  for (let k = 0; k < 50; k++) {
    const c = cnsSintetico(880 + k);
    if (cnsValido(c)) return c;
  }
  throw new Error('sem CNS');
})();

type Permissao = NonNullable<SessaoSus['permissoesSetor']>[number];
const perm = (setor: number, tipo: Permissao['tipo']): Permissao => ({
  setor,
  tipo,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
});

function sessao(permissoesSetor: readonly Permissao[], usuario: number | null = 7): SessaoSus {
  return {
    rede: 'rede-teste',
    hospital: 'pc',
    login: 'FATURISTA.SINT',
    usuario,
    permissoesSetor,
    hoje: HOJE,
    convenios: null,
    parametros: {
      cnes: '9999991',
      conveniosSus: [1],
      conveniosParticular: [10],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map(),
      habilitacoes: new Set<string>(),
      bpa: {
        orgaoOrigem: 'H',
        siglaOrigem: 'H',
        cnpj: '11222333000181',
        orgaoDestino: 'SMS',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
      aih: { utiPorAcomodacao: '3:2:0802010083', diretorClinicoCns: DIRETOR },
    },
    pode: () => true,
    trilha: (evento, operacao, alvo) => ({
      rede: 'rede-teste',
      hospital: 'pc',
      usuario: 'FATURISTA.SINT',
      evento,
      recurso: 'faturamento.sus',
      operacao,
      tabelaAlvo: alvo.tabela,
      idAlvo: alvo.id,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'TESTE',
      correlacao: 'c',
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
  };
}

const recusa = (codigo: string) => expect.objectContaining({ extras: expect.objectContaining({ codigo }) });

function montar() {
  const porta = new PortaSusMemoria();
  const armazem = armazemSusMemoria();
  const sus = new ServicoSus(porta, armazem);
  const aih = new ServicoSusAih(
    porta,
    sus,
    armazem,
    async (s) =>
      s.parametros.aih ?? {
        utiPorAcomodacao: '',
        diretorClinicoCns: '',
      },
  );
  sus.registrarMontagem('aih', aih.montadorCritica());
  return { sus, aih };
}

const REGISTRO = REGISTROS_AIH_SINTETICOS[0] as number;
const SETOR = setorSinteticoApac(REGISTRO);
const OUTRO = SETOR === 1 ? 2 : 1;
const LAUDO = {
  registro: REGISTRO,
  procedimentoSolicitado: '0406010811',
  cidPrincipal: 'I21',
  cidSecundario: null,
  carater: '02' as const,
  solicitante: SOLICITANTES_AIH_SINTETICOS[0]?.cpf ?? '',
  dataLaudo: HOJE,
  justificativa: 'DOR TORACICA SINTETICA COM SUPRA DE ST (MASSA DE TESTE)',
};

describe('faturamento SUS: a permissão por usuário e setor (C1-051)', () => {
  it('a AIH: a internação, o laudo, a listagem e o espelho só no setor permitido', async () => {
    const { aih } = montar();
    const soOutro = sessao([perm(OUTRO, 'digitacao_faturamento')]);
    await expect(aih.internacao(soOutro, REGISTRO)).rejects.toEqual(recusa('sus-setor-sem-permissao'));
    await expect(aih.registrar(soOutro, { acao: 'laudo', laudo: LAUDO })).rejects.toEqual(
      recusa('sus-setor-sem-permissao'),
    );
    expect((await aih.listar(sessao([]), { pagina: 0, porPagina: 50, registro: REGISTRO })).total).toBe(0);
    // Com a digitação no setor da internação, o laudo grava; o usuário do outro setor não lista nem abre o espelho.
    const noSetor = sessao([perm(SETOR, 'digitacao')]);
    const a = await aih.registrar(noSetor, { acao: 'laudo', laudo: LAUDO });
    expect(a).toMatchObject({ situacao: 'solicitada', registro: REGISTRO });
    expect((await aih.listar(noSetor, { pagina: 0, porPagina: 50 })).itens.map((x) => x.id)).toContain(a.id);
    expect((await aih.listar(soOutro, { pagina: 0, porPagina: 50 })).itens.map((x) => x.id)).not.toContain(
      a.id,
    );
    expect(
      (await aih.listar(sessao([], null), { pagina: 0, porPagina: 50 })).itens.map((x) => x.id),
    ).toContain(a.id);
    await expect(aih.espelho(soOutro, a.id)).rejects.toEqual(recusa('sus-setor-sem-permissao'));
    // Ações do ciclo da AIH no outro setor recusam antes da versão; o fechamento exige 'faturamento'.
    await expect(
      aih.registrar(soOutro, {
        acao: 'fechar',
        aih: a.id,
        versao: a.versao,
        procedimentoRealizado: null,
        opm: [],
      }),
    ).rejects.toEqual(recusa('sus-setor-sem-permissao'));
  });

  it('a competência inteira: criticar, fechar e gerar exigem faturamento em todos os setores da produção', async () => {
    const { sus, aih } = montar();
    const so1 = sessao([perm(1, 'faturamento'), perm(2, 'digitacao')]);
    await expect(sus.criticar(so1, { instrumento: 'bpa', competencia: COMP })).rejects.toEqual(
      recusa('sus-setor-sem-permissao'),
    );
    await expect(
      sus.fechar(so1, { instrumento: 'bpa', competencia: COMP, versao: '1' } as never),
    ).rejects.toEqual(recusa('sus-setor-sem-permissao'));
    await expect(sus.gerarBpa(so1, { competencia: COMP, versao: '1' } as never)).rejects.toEqual(
      recusa('sus-setor-sem-permissao'),
    );
    await expect(aih.gerarSisaih(so1, { competencia: COMP, versao: '1' } as never)).rejects.toEqual(
      recusa('sus-setor-sem-permissao'),
    );
    // Com faturamento nos dois setores (ou sem restrição), o portão do setor passa: a recusa, se houver, é outra.
    for (const s of [sessao([perm(1, 'faturamento'), perm(2, 'digitacao_faturamento')]), sessao([], null)]) {
      const r = await sus.criticar(s, { instrumento: 'bpa', competencia: COMP }).catch((e: unknown) => e);
      expect(r).not.toEqual(recusa('sus-setor-sem-permissao'));
    }
  });

  it('o retorno do gestor: listar, importar e tratar exigem faturamento em todos os setores da competência', async () => {
    const { aih } = montar();
    const so1 = sessao([perm(1, 'faturamento')]);
    // Com permissão por setor, a listagem pede a competência (a produção dela tem os setores 1 e 2).
    await expect(aih.listarRetornos(so1, { pagina: 1, porPagina: 20 } as never)).rejects.toEqual(
      recusa('sus-setor-sem-permissao'),
    );
    await expect(
      aih.listarRetornos(so1, { competencia: COMP, pagina: 1, porPagina: 20 } as never),
    ).rejects.toEqual(recusa('sus-setor-sem-permissao'));
    await expect(
      aih.importarRetorno(so1, {
        instrumento: 'aih',
        competencia: COMP,
        conteudo: 'numero_aih;situacao;valor_aprovado;motivo\n3300000000001;aprovada;10,00;\n',
      } as never),
    ).rejects.toEqual(recusa('sus-setor-sem-permissao'));
    // Faturamento nos dois setores: a listagem passa.
    const ambos = sessao([perm(1, 'faturamento'), perm(2, 'faturamento')]);
    await expect(
      aih.listarRetornos(ambos, { competencia: COMP, pagina: 1, porPagina: 20 } as never),
    ).resolves.toMatchObject({ itens: [] });
    // Sem permissão cadastrada, vale o cargo (sem competência também).
    await expect(
      aih.listarRetornos(sessao([]), { pagina: 1, porPagina: 20 } as never),
    ).resolves.toMatchObject({
      itens: [],
    });
  });
});
