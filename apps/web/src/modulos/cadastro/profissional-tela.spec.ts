// D-PROF-39: a lógica pura da ficha do profissional (iniciais, máscara dos sensíveis, aviso único, teclas das abas).
import { describe, expect, it } from 'vitest';
import {
  ABAS_PROFISSIONAL,
  ativoDaFicha,
  dataBr,
  destinoDaTecla,
  gruposDeRegistro,
  indisponiveis,
  OPERACOES_DA_ACAO,
  operacaoLigada,
  iniciais,
  mascarar,
  ocupacaoPadraoDoLogin,
  ocupacoesParaLogin,
} from './profissional-tela.js';

const reg = (id: number, ativo: boolean | null, cbo = '225125') => ({
  id,
  profissional: 1,
  conselho: 'CRM',
  sigla: null,
  numero: 1,
  uf: 'MG',
  cbo,
  cboDescricao: null,
  categoria: 'medico' as const,
  ativo,
});

describe('ficha do profissional: lógica pura', () => {
  it('iniciais, máscaras e datas', () => {
    expect(iniciais('ANA MÉDICA DA SILVA SINTETICO')).toBe('AS');
    expect(iniciais('')).toBe('?');
    expect(mascarar('email', 'ana.sint@exemplo.com')).toBe('a•••@exemplo.com');
    expect(mascarar('telefone', '(31) 99999-1234')).toBe('•••• 1234');
    expect(mascarar('data', '1980-05-01')).toBe('••/••/1980');
    expect(mascarar('texto', 'MARIA')).toMatch(/^M•{4}$/);
    expect(mascarar('email', null)).toBe('');
    expect(dataBr('1980-05-01')).toBe('01/05/1980');
  });

  it('ativo pelo registro real (o mantido pelo cadastro não conta)', () => {
    expect(ativoDaFicha({ registros: [reg(1, false), reg(2, true, '000000')] })).toBe(false);
    expect(ativoDaFicha({ registros: [reg(1, null)] })).toBe(true);
  });

  it('aviso único agrupado por motivo', () => {
    const t = (k: string) => k.split('.').pop()!;
    const sem = indisponiveis({ registros: [reg(1, true)] }, () => false, t);
    expect(sem.map((g) => g.motivo)).toEqual(['semEditar', 'semGestaoAcesso', 'semExcluir']);
    expect(sem[0]!.acoes).not.toContain('acaoLogin');
    expect(sem[1]!.acoes).toEqual(['acaoLogin']);
    expect(indisponiveis({ registros: [reg(1, true)] }, () => true, t)).toEqual([]);
    expect(indisponiveis({ registros: [] }, () => true, t)).toEqual([
      { motivo: 'semRegistro', acoes: ['acaoLogin'] },
    ]);
    // Quem edita o cadastro mas não gere acessos: o login fica de fora, com o motivo.
    expect(indisponiveis({ registros: [reg(1, true)] }, (p) => p !== 'acesso.perfil.gerir', t)).toEqual([
      { motivo: 'semGestaoAcesso', acoes: ['acaoLogin'] },
    ]);
  });

  it('revisão: o que o executor recusa para quem pergunta entra no aviso único, mesmo com as permissões', () => {
    const t = (k: string) => k.split('.').pop()!;
    const todas = [
      'cadastro.alterarProfissional',
      'cadastro.incluirRegistroProfissional',
      'cadastro.alterarRegistroProfissional',
      'cadastro.definirEspecialidadeProfissional',
      'cadastro.credenciarProfissional',
      'cadastro.vincularLoginProfissional',
      'cadastro.inativarProfissional',
      'cadastro.reativarProfissional',
      'cadastro.excluirProfissional',
      'cadastro.excluirRegistroProfissional',
    ];
    const recusadas = {
      registros: [reg(1, true)],
      operacoes: todas.map((operacao) => ({ operacao, ligada: false })),
    };
    const g = indisponiveis(recusadas, () => true, t);
    expect(g).toHaveLength(1);
    expect(g[0]!.motivo).toBe('semEscrita');
    expect(g[0]!.acoes).toEqual([
      'acaoDados',
      'acaoRegistros',
      'acaoEspecialidades',
      'acaoConvenios',
      'acaoLogin',
      'acaoSituacao',
      'acaoExcluir',
    ]);
    expect(operacaoLigada(recusadas, 'cadastro.credenciarProfissional')).toBe(false);
    // Só uma recusada: só a ação dela.
    const uma = {
      registros: [reg(1, true)],
      operacoes: [{ operacao: 'cadastro.credenciarProfissional', ligada: false }],
    };
    expect(indisponiveis(uma, () => true, t)).toEqual([{ motivo: 'semEscrita', acoes: ['acaoConvenios'] }]);
    // Sem a situação (ficha antiga): não bloqueia; o servidor decide.
    expect(operacaoLigada({}, 'cadastro.credenciarProfissional')).toBe(true);
    // F3.1 (02-CAD linha 18): a lotação grava pela rota própria (lotacoes), fora das operações da ficha.
    expect(Object.keys(OPERACOES_DA_ACAO)).not.toContain('acaoLotacao');
  });

  it('teclas das abas', () => {
    const n = ABAS_PROFISSIONAL.length;
    expect(destinoDaTecla('ArrowRight', n - 1, n)).toBe(0);
    expect(destinoDaTecla('ArrowLeft', 0, n)).toBe(n - 1);
    expect(destinoDaTecla('Home', 3, n)).toBe(0);
    expect(destinoDaTecla('End', 0, n)).toBe(n - 1);
    expect(destinoDaTecla('a', 0, n)).toBe(-1);
  });

  // Login único (pergunta do dono, 18/11/2026: "por que tem 3 logins?").
  const ocup = (id: number, ativo: boolean, cbo: string, numero = 66666, conselho = 'CRM') => ({
    ...reg(id, ativo, cbo),
    numero,
    conselho,
    cboDescricao: `DESCRICAO ${cbo}`,
  });

  it('cartão sem chips repetidos: o mesmo conselho, número e UF uma vez, com as ocupações e o inativo marcado', () => {
    const g = gruposDeRegistro([
      ocup(15, true, '225125'),
      ocup(16, true, '225250'),
      ocup(17, false, '225170'),
      ocup(20, true, '223208', 3333, 'CRO'),
      ocup(21, true, '000000'),
    ]);
    expect(g.map((x) => x.rotulo)).toEqual(['CRM 66666/MG', 'CRO 3333/MG']);
    expect(g[0]!.ocupacoes).toEqual([
      { id: 15, texto: '225125 · DESCRICAO 225125', ativo: true },
      { id: 16, texto: '225250 · DESCRICAO 225250', ativo: true },
      { id: 17, texto: '225170 · DESCRICAO 225170', ativo: false },
    ]);
    expect(g.map((x) => x.ativo)).toEqual([true, true]);
    expect(gruposDeRegistro([ocup(17, false, '225170')])[0]!.ativo).toBe(false);
  });

  it('ocupação padrão do login: a de médico (225…) ativa mais recente; sem ativa, as reais', () => {
    const regs = [
      ocup(15, true, '225125'),
      ocup(16, true, '225250'),
      ocup(18, true, '223505'),
      ocup(17, false, '225170'),
    ];
    expect(ocupacaoPadraoDoLogin(regs)).toBe(16);
    expect(ocupacoesParaLogin(regs).map((r) => r.id)).toEqual([15, 16, 18]);
    expect(ocupacaoPadraoDoLogin([ocup(30, true, '223505'), ocup(31, true, '223208')])).toBe(31);
    expect(
      ocupacoesParaLogin([ocup(40, false, '225125'), ocup(41, false, '000000')]).map((r) => r.id),
    ).toEqual([40]);
    expect(ocupacaoPadraoDoLogin([ocup(40, false, '225125')])).toBe(40);
    expect(ocupacaoPadraoDoLogin([])).toBeNull();
  });
});
