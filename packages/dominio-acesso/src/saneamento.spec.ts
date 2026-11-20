// Regra 8 do M59 (saneamento dos grupos sem perder acesso legítimo): simulador, sugestão, decisões, aprovação,
// aplicação e dissolução. Dados sintéticos (logins e grupos de exemplo; opções numeradas).
import { describe, expect, it } from 'vitest';
import {
  destinoValido,
  diasSemAcesso,
  ehGrupoGenerico,
  emLotes,
  itemVivo,
  semUsoParaBloqueio,
  simularTroca,
  sugerirDestino,
  validarAplicacao,
  validarAprovacao,
  validarDecisao,
  validarDescarte,
  validarDissolucao,
  validarEntradaNoMaster,
  type AlvoDecisao,
  type ContextoDecisao,
  type GrupoCandidato,
  type ItemParaRegra,
} from './saneamento.js';

const s = (...n: number[]) => new Set(n);
const uso = (...p: [number, number][]) => new Map(p);
const cand = (grupo: string, opcoes: number[], ativo = true): GrupoCandidato => ({
  grupo,
  ativo,
  opcoes: new Set(opcoes),
});

describe('grupos genéricos', () => {
  it('reconhece os quatro pela chave e recusa os de trabalho e o nulo', () => {
    expect(ehGrupoGenerico('MASTER')).toBe(true);
    expect(ehGrupoGenerico('master_sem_financeiro')).toBe(true);
    expect(ehGrupoGenerico('MASTER_CONSULTA_FINANCEIRO')).toBe(true);
    expect(ehGrupoGenerico('sem  grupo')).toBe(true);
    expect(ehGrupoGenerico('FATURAMENTO')).toBe(false);
    expect(ehGrupoGenerico(null)).toBe(false);
  });
});

describe('simularTroca (regra 8)', () => {
  it('antes, depois, ganhas, perdidas e as perdidas usadas exigem aprovação', () => {
    const r = simularTroca(s(1, 2, 3, 4), s(3, 4, 5), uso([2, 7], [1, 0], [3, 9]));
    expect(r).toMatchObject({ antes: 4, depois: 3, mantidas: 2, perdidasUsadas: 1, exigeAprovacao: true });
    expect(r.ganhas).toEqual([5]);
    expect(r.perdidas).toEqual([2, 1]); // a usada primeiro
  });
  it('sem perda usada, não exige aprovação', () => {
    const r = simularTroca(s(1, 2), s(2, 3), uso([2, 5]));
    expect(r.exigeAprovacao).toBe(false);
    expect(r.perdidas).toEqual([1]);
  });
  it('ordena as perdidas pelo uso e depois pelo ID', () => {
    const r = simularTroca(s(9, 8, 7, 6), s(), uso([7, 2], [6, 2], [9, 5]));
    expect(r.perdidas).toEqual([9, 6, 7, 8]);
    expect(r.perdidasUsadas).toBe(3);
  });
});

describe('sugerirDestino', () => {
  const candidatos = [
    cand('FATURAMENTO', [1, 2, 3, 4, 5]),
    cand('FATURAMENTO_SUPERVISAO', [1, 2, 3, 4, 5, 6, 7]),
    cand('FINANCEIRO', [1, 9]),
    cand('MASTER_SEM_FINANCEIRO', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    cand('COMPRAS', [1, 2, 3, 4, 5, 6, 7, 8], false),
  ];
  it('o que cobre mais das usadas; no empate, o de menos opções', () => {
    expect(sugerirDestino(uso([1, 3], [2, 1], [3, 1]), candidatos)).toEqual({
      grupo: 'FATURAMENTO',
      cobertas: 3,
      usadas: 3,
    });
    expect(sugerirDestino(uso([6, 1], [1, 1]), candidatos)?.grupo).toBe('FATURAMENTO_SUPERVISAO');
  });
  it('nunca sugere grupo genérico nem inativo; sem uso, nenhuma sugestão', () => {
    expect(sugerirDestino(uso([8, 4]), candidatos)).toBeNull();
    expect(sugerirDestino(uso(), candidatos)).toBeNull();
    expect(sugerirDestino(uso([1, 0]), candidatos)).toBeNull();
  });
  it('empate exato de tamanho: pelo nome', () => {
    expect(sugerirDestino(uso([1, 1]), [cand('B', [1, 2]), cand('A', [1, 3])])?.grupo).toBe('A');
    expect(sugerirDestino(uso([1, 1]), [cand('A', [1, 3]), cand('B', [1, 2])])?.grupo).toBe('A');
  });
  it('destinoValido: grupo sem opção não serve', () => {
    expect(destinoValido(cand('X', []))).toBe(false);
  });
});

describe('dias sem acesso e bloqueio', () => {
  it('conta dias civis; nulo é nunca', () => {
    expect(diasSemAcesso('2026-04-01', '2026-10-01')).toBe(183);
    expect(diasSemAcesso('2026-10-02', '2026-10-01')).toBe(0);
    expect(diasSemAcesso(null, '2026-10-01')).toBeNull();
  });
  it('bloqueio só acima de 180 dias ou nunca', () => {
    expect(semUsoParaBloqueio(181)).toBe(true);
    expect(semUsoParaBloqueio(180)).toBe(false);
    expect(semUsoParaBloqueio(null)).toBe(true);
  });
});

describe('validarDecisao', () => {
  const alvo = (x: Partial<AlvoDecisao> = {}): AlvoDecisao => ({
    login: 'SINT.A',
    grupo: 'MASTER',
    ativo: true,
    bloqueado: false,
    diasSemAcesso: 3,
    ...x,
  });
  const ctx = (x: Partial<ContextoDecisao> = {}): ContextoDecisao => ({
    ator: 'SINT.GESTOR',
    destino: cand('FATURAMENTO', [1]),
    administradoresMaximo: 3,
    administradoresMantidos: 0,
    ...x,
  });
  it('troca para grupo de trabalho ativo: aceita', () => {
    expect(validarDecisao(alvo(), 'trocar-grupo', ctx())).toBeNull();
  });
  it('recusas da troca', () => {
    expect(validarDecisao(alvo({ grupo: 'FATURAMENTO' }), 'trocar-grupo', ctx())).toBe('grupo-nao-generico');
    expect(validarDecisao(alvo({ login: 'SINT.GESTOR' }), 'trocar-grupo', ctx())).toBe('a-si-mesmo');
    // Revisão do M59.4 (achado 2): o inativo e o bloqueado saem do grupo amplo pela troca; não ficam como administrador.
    expect(validarDecisao(alvo({ ativo: false }), 'trocar-grupo', ctx())).toBeNull();
    expect(validarDecisao(alvo({ bloqueado: true }), 'trocar-grupo', ctx())).toBeNull();
    expect(validarDecisao(alvo({ bloqueado: true }), 'manter-administrador', ctx())).toBe('usuario-inativo');
    expect(validarDecisao(alvo({ ativo: false }), 'manter-administrador', ctx())).toBe('usuario-inativo');
    expect(validarDecisao(alvo(), 'trocar-grupo', ctx({ destino: null }))).toBe('destino-invalido');
    expect(validarDecisao(alvo(), 'trocar-grupo', ctx({ destino: cand('SEM GRUPO', [1]) }))).toBe(
      'destino-generico',
    );
    expect(validarDecisao(alvo(), 'trocar-grupo', ctx({ destino: cand('X', [1], false) }))).toBe(
      'destino-invalido',
    );
  });
  it('administrador só no MASTER e até o máximo', () => {
    expect(validarDecisao(alvo(), 'manter-administrador', ctx())).toBeNull();
    expect(validarDecisao(alvo({ grupo: 'SEM GRUPO' }), 'manter-administrador', ctx())).toBe(
      'administrador-so-no-master',
    );
    expect(validarDecisao(alvo(), 'manter-administrador', ctx({ administradoresMantidos: 3 }))).toBe(
      'administradores-no-limite',
    );
  });
  it('bloqueio: só sem uso recente e se não estiver bloqueado (vale para inativo)', () => {
    expect(validarDecisao(alvo({ diasSemAcesso: 200, ativo: false }), 'bloquear', ctx())).toBeNull();
    expect(validarDecisao(alvo({ diasSemAcesso: null }), 'bloquear', ctx())).toBeNull();
    expect(validarDecisao(alvo({ diasSemAcesso: 10 }), 'bloquear', ctx())).toBe('bloqueio-com-uso-recente');
    expect(validarDecisao(alvo({ diasSemAcesso: 300, bloqueado: true }), 'bloquear', ctx())).toBe(
      'ja-bloqueado',
    );
  });
});

describe('aprovação, aplicação e descarte', () => {
  const item = (x: Partial<ItemParaRegra> = {}): ItemParaRegra => ({
    login: 'SINT.A',
    decisao: 'trocar-grupo',
    situacao: 'proposto',
    exigeAprovacao: true,
    perdasUsadas: 2,
    criadoPor: 'SINT.GESTOR',
    ...x,
  });
  it('aprovação: outra pessoa, nem o próprio, só quando exige e do proposto', () => {
    expect(validarAprovacao(item(), 'SINT.AREA')).toBeNull();
    expect(validarAprovacao(item(), 'SINT.GESTOR')).toBe('aprovacao-pelo-proponente');
    expect(validarAprovacao(item(), 'SINT.A')).toBe('aprovacao-pelo-proprio');
    expect(validarAprovacao(item({ exigeAprovacao: false }), 'SINT.AREA')).toBe('aprovacao-desnecessaria');
    expect(validarAprovacao(item({ situacao: 'aplicado' }), 'SINT.AREA')).toBe('situacao-nao-permite');
    expect(validarAprovacao(item({ login: null, decisao: 'dissolver-grupo' }), 'SINT.AREA')).toBeNull();
  });
  it('aplicação: aprovado; proposto sem perda usada; perdas que aumentaram recusam', () => {
    expect(validarAplicacao(item({ situacao: 'aprovado' }), 'SINT.GESTOR', 2)).toBeNull();
    expect(validarAplicacao(item({ situacao: 'aprovado' }), 'SINT.GESTOR', 1)).toBeNull();
    expect(validarAplicacao(item({ situacao: 'aprovado' }), 'SINT.GESTOR', 3)).toBe('perdas-aumentaram');
    expect(validarAplicacao(item(), 'SINT.GESTOR', 2)).toBe('exige-aprovacao');
    expect(validarAplicacao(item({ exigeAprovacao: false, perdasUsadas: 0 }), 'SINT.GESTOR', 0)).toBeNull();
    expect(validarAplicacao(item({ exigeAprovacao: false, perdasUsadas: 0 }), 'SINT.GESTOR', 1)).toBe(
      'perdas-aumentaram',
    );
    expect(validarAplicacao(item({ situacao: 'aprovado' }), 'SINT.A', 0)).toBe('a-si-mesmo');
    expect(validarAplicacao(item({ situacao: 'aplicado' }), 'SINT.GESTOR', 0)).toBe('situacao-nao-permite');
    expect(validarAplicacao(item({ situacao: 'falhou' }), 'SINT.GESTOR', 0)).toBe('situacao-nao-permite');
  });
  it('descarte: só o que não foi aplicado', () => {
    expect(validarDescarte(item())).toBeNull();
    expect(validarDescarte(item({ situacao: 'aprovado' }))).toBeNull();
    expect(validarDescarte(item({ situacao: 'falhou' }))).toBeNull();
    expect(validarDescarte(item({ situacao: 'aplicado' }))).toBe('situacao-nao-permite');
    expect(validarDescarte(item({ situacao: 'descartado' }))).toBe('situacao-nao-permite');
  });
  it('item vivo', () => {
    expect(itemVivo('proposto')).toBe(true);
    expect(itemVivo('aprovado')).toBe(true);
    expect(itemVivo('aplicado')).toBe(false);
  });
});

describe('dissolução e lotes', () => {
  it('só grupo genérico vazio com opções, nunca o MASTER', () => {
    expect(validarDissolucao('SEM GRUPO', 0, 10)).toBeNull();
    expect(validarDissolucao('MASTER', 0, 10)).toBe('master-nao-dissolve');
    expect(validarDissolucao('FATURAMENTO', 0, 10)).toBe('grupo-nao-generico');
    expect(validarDissolucao('MASTER_SEM_FINANCEIRO', 1, 10)).toBe('grupo-com-ativos');
    expect(validarDissolucao('MASTER_SEM_FINANCEIRO', 0, 0)).toBe('grupo-sem-opcoes');
  });
  it('lotes de tamanho fixo', () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emLotes([], 2)).toEqual([]);
    expect(emLotes([1], 0)).toEqual([[1]]);
  });
});

describe('validarEntradaNoMaster (revisão do M59.4, achado 1)', () => {
  it('recusa só quando quem entra passaria do máximo', () => {
    expect(validarEntradaNoMaster(true, 2, 3)).toBeNull();
    expect(validarEntradaNoMaster(true, 3, 3)).toBe('administradores-no-limite');
    expect(validarEntradaNoMaster(true, 5, 3)).toBe('administradores-no-limite');
    expect(validarEntradaNoMaster(false, 5, 3)).toBeNull();
  });
});
