// Contratos do MPI da Rede (M57, etapa 1): faixas da pontuação, consulta da fila com padrões e tetos, decisão humana e
// desfazer com justificativa, CNS movido para os contratos, permissões no catálogo. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { cnsValido, tipoCns } from '../validacao/cns.js';
import {
  esquemaConsultaFilaRede,
  esquemaDecisaoCandidatoRede,
  esquemaDesfazerVinculoRede,
  TETO_PAGINA_FILA_REDE,
} from './telas.js';
import { faixaPontuacaoRede, LIMIAR_FILA_REDE, TABELAS_INDICE_REDE } from './vocabulario.js';

describe('faixas da pontuação', () => {
  it('cobre do limiar a 100 sem buraco e nada abaixo do limiar', () => {
    expect(faixaPontuacaoRede(LIMIAR_FILA_REDE - 1)).toBeNull();
    expect(faixaPontuacaoRede(LIMIAR_FILA_REDE)).toBe('baixa');
    expect(faixaPontuacaoRede(69)).toBe('baixa');
    expect(faixaPontuacaoRede(70)).toBe('media');
    expect(faixaPontuacaoRede(84)).toBe('media');
    expect(faixaPontuacaoRede(85)).toBe('alta');
    expect(faixaPontuacaoRede(100)).toBe('alta');
    for (let p = LIMIAR_FILA_REDE; p <= 100; p++) expect(faixaPontuacaoRede(p)).not.toBeNull();
  });

  it('o índice só tem tabelas SGH_REDE_', () => {
    expect(TABELAS_INDICE_REDE.every((t) => t.startsWith('SGH_REDE_'))).toBe(true);
  });
});

describe('consulta da fila', () => {
  it('padrões: abertos, página 1 de 20', () => {
    expect(esquemaConsultaFilaRede.parse({})).toEqual({ situacao: 'aberto', pagina: 1, porPagina: 20 });
  });

  it('teto da página e campos desconhecidos recusados', () => {
    expect(esquemaConsultaFilaRede.safeParse({ porPagina: TETO_PAGINA_FILA_REDE + 1 }).success).toBe(false);
    expect(esquemaConsultaFilaRede.safeParse({ cpf: '1' }).success).toBe(false);
    expect(esquemaConsultaFilaRede.safeParse({ outroEstabelecimento: 'HS' }).success).toBe(false);
    expect(esquemaConsultaFilaRede.parse({ faixa: 'alta', pagina: '2' }).pagina).toBe(2);
    // Busca por paciente: o prontuário (só número positivo).
    expect(esquemaConsultaFilaRede.parse({ prontuario: '50004' }).prontuario).toBe(50004);
    expect(esquemaConsultaFilaRede.safeParse({ prontuario: 'abc' }).success).toBe(false);
    expect(esquemaConsultaFilaRede.safeParse({ prontuario: '0' }).success).toBe(false);
  });
});

describe('decisão e desfazer', () => {
  it('"outra pessoa" exige justificativa; "mesma pessoa" não', () => {
    expect(esquemaDecisaoCandidatoRede.safeParse({ decisao: 'outra_pessoa' }).success).toBe(false);
    expect(
      esquemaDecisaoCandidatoRede.safeParse({ decisao: 'outra_pessoa', justificativa: 'mães diferentes' })
        .success,
    ).toBe(true);
    expect(esquemaDecisaoCandidatoRede.safeParse({ decisao: 'mesma_pessoa' }).success).toBe(true);
    expect(esquemaDecisaoCandidatoRede.safeParse({ decisao: 'unificar' }).success).toBe(false);
  });

  it('desfazer exige justificativa e não reabre por padrão', () => {
    expect(esquemaDesfazerVinculoRede.safeParse({}).success).toBe(false);
    expect(esquemaDesfazerVinculoRede.parse({ justificativa: 'vínculo errado' }).reabrir).toBe(false);
  });
});

describe('CNS nos contratos', () => {
  it('definitivo, provisório e recusas', () => {
    // Números sintéticos montados pelo algoritmo (não são de pessoa).
    expect(tipoCns('100000000000007')).toBe('definitivo');
    expect(tipoCns('700000000000005')).toBe('provisorio');
    expect(cnsValido('100000000000008')).toBe(false);
    expect(cnsValido('111111111111111')).toBe(false);
    expect(cnsValido(null)).toBe(false);
  });
});

describe('permissões do MPI no catálogo', () => {
  it('as três da etapa 1, no formato, com opções do cadastro', () => {
    // O MPI (etapa 1); a etapa 3 declara `rede.servico.registrar` (rede/bi.spec.ts).
    const rede = CATALOGO_DECLARADO.filter((p) => p.codigo.startsWith('rede.mpi.'));
    expect(rede.map((p) => p.codigo)).toEqual(['rede.mpi.ler', 'rede.mpi.vincular', 'rede.mpi.desfazer']);
    for (const p of rede) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length).toBeGreaterThan(0);
      expect(p.categoria).toBe('administrativa');
    }
  });

  it('as três da etapa 2 (aviso, acesso cruzado e unificação), no formato, com opções do legado', () => {
    const codigos = ['rede.mpiAviso.ler', 'pep.prontuario.lerRede', 'cadastro.paciente.unificar'];
    const e2 = CATALOGO_DECLARADO.filter((p) => codigos.includes(p.codigo));
    expect(e2.map((p) => p.codigo).sort()).toEqual([...codigos].sort());
    for (const p of e2) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length).toBeGreaterThan(0);
    }
    expect(e2.find((p) => p.codigo === 'cadastro.paciente.unificar')?.criticidade).toBe('critica');
    // O aviso e o acesso cruzado são clínicos (abrem a partir do prontuário).
    expect(e2.find((p) => p.codigo === 'pep.prontuario.lerRede')?.categoria).toBe('clinica');
  });
});
