import { describe, expect, it } from 'vitest';
import {
  enderecoDeLista,
  mascararNome,
  mascararTelefone,
  nomeComparavel,
  permissoesDaFicha,
  textoOuNulo,
} from './mascaramento.js';
import { mudancasEntreVersoes, RESTRITO } from './historico.js';

describe('mascaramento e visibilidade (regra 9)', () => {
  it('iniciais, telefone e endereço de lista', () => {
    expect(mascararNome('MARIA DA SILVA')).toBe('M*** D*** S***');
    expect(mascararNome('  ')).toBeNull();
    expect(mascararTelefone('(31) 98765-4321')).toBe('(**) *****-4321');
    expect(mascararTelefone('12')).toBeNull();
    expect(enderecoDeLista('BELO HORIZONTE', 'MG')).toBe('BELO HORIZONTE/MG');
    expect(enderecoDeLista(null, ' ')).toBeNull();
    expect(textoOuNulo('  ')).toBeNull();
    expect(textoOuNulo(' X ')).toBe('X');
    expect(nomeComparavel('José')).toBe('JOSE');
  });
  it('permissões da ficha pela sessão', () => {
    const p = permissoesDaFicha((c) => c === 'cadastro.paciente.editar');
    expect(p).toEqual({
      editar: true,
      verDocumento: false,
      verSensivel: false,
      registrarConsentimento: false,
      lerHistorico: false,
    });
  });
});

describe('linha do tempo: mudanças entre versões', () => {
  const campos = [
    { coluna: 'NOME', campo: 'nome', rotulo: 'Nome' },
    { coluna: 'CPF', campo: 'cpf', rotulo: 'CPF', restricao: 'documento' as const },
    { coluna: 'ID_TBCOR', campo: 'racaCor', rotulo: 'Raça/cor', restricao: 'sensivel' as const },
    { coluna: 'DATA_NASCIMENTO', campo: 'nascimento', rotulo: 'Nascimento' },
  ];
  it('primeira versão: o que está preenchido; depois só o que mudou', () => {
    const v1 = { NOME: 'A', CPF: 1, ID_TBCOR: null, DATA_NASCIMENTO: new Date(Date.UTC(1990, 0, 2)) };
    const v2 = { ...v1, NOME: 'B', ID_TBCOR: 2 };
    const todos = { documento: true, sensivel: true };
    expect(mudancasEntreVersoes(null, v1, campos, todos).map((m) => m.campo)).toEqual([
      'nome',
      'cpf',
      'nascimento',
    ]);
    expect(mudancasEntreVersoes(v1, v2, campos, todos)).toEqual([
      { campo: 'nome', rotulo: 'Nome', antes: 'A', depois: 'B' },
      { campo: 'racaCor', rotulo: 'Raça/cor', antes: null, depois: '2' },
    ]);
  });
  it('sem a permissão, o valor restrito sai como "restrito ao seu perfil"; 1899 é vazio', () => {
    const v1 = { NOME: 'A', CPF: 1, ID_TBCOR: 1, DATA_NASCIMENTO: new Date(Date.UTC(1899, 11, 30)) };
    const v2 = { ...v1, CPF: 2, ID_TBCOR: 3 };
    const m = mudancasEntreVersoes(v1, v2, campos, { documento: false, sensivel: false });
    expect(m).toEqual([
      { campo: 'cpf', rotulo: 'CPF', antes: RESTRITO, depois: RESTRITO },
      { campo: 'racaCor', rotulo: 'Raça/cor', antes: RESTRITO, depois: RESTRITO },
    ]);
    expect(
      mudancasEntreVersoes(null, v1, campos, { documento: true, sensivel: true }).map((x) => x.campo),
    ).toEqual(['nome', 'cpf', 'racaCor']);
  });
});
