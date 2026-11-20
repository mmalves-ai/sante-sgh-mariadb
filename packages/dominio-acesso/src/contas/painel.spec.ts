// M59-F1: respostas do painel "Contas do banco de dados e privilégios" (inventário e desvios).
import { describe, expect, it } from 'vitest';
import {
  esquemaDesviosPrivilegiosResposta,
  esquemaInventarioContasBancoResposta,
  TETO_ITENS_DESVIO,
  type ContaBancoLida,
} from '@sgh/contratos';
import { montarDesvios, montarInventarioContas } from './painel.js';

const zero = { S: 0, I: 0, U: 0, D: 0, R: 0, X: 0, M: 0 };
const conta = (nome: string | null, p: Partial<ContaBancoLida> = {}): ContaBancoLida => ({
  nome,
  tipo: 'usuario',
  existeLogin: false,
  ativa: null,
  quantidade: 1,
  privilegios: { ...zero, S: 10 },
  objetosComEscrita: 0,
  papeis: [],
  ...p,
});
const SGH = { aplicacao: ['SGH_DEV'], scripts: 'SGH_SCRIPTS', leitura: null };

describe('montarInventarioContas', () => {
  const contas = [
    conta('EXCEL'),
    conta('AUTORIZADOR', { objetosComEscrita: 2648, privilegios: { ...zero, S: 2648, I: 2648 } }),
    conta(null, { quantidade: 3 }),
    conta('MASTER', { tipo: 'papel', privilegios: zero }),
  ];

  it('antes do desligamento tudo aguarda; o agregado sai sem nome e com faixa', () => {
    const r = montarInventarioContas({
      hospital: 'pc',
      em: '2026-10-28T12:00:00.000Z',
      contas,
      loginsNaoLegiveis: 2,
      usos: [],
      sgh: SGH,
      contexto: { desligado: false, contingenciaAtiva: true, decisoes: new Set() },
      avisos: ['uso não medido'],
    });
    expect(esquemaInventarioContasBancoResposta.parse(r)).toEqual(r);
    expect(r.contas.every((c) => c.situacao === 'aguardando-desligamento')).toBe(true);
    const agregado = r.contas.find((c) => c.nome === null);
    expect(agregado?.quantidade).toBe('<5');
    expect(r.resumo.loginsSemPrivilegio).toBe('<5');
    expect(r.resumo.porSituacao['aguardando-desligamento']).toBe(4);
    expect(r.resumo.papeisSemPrivilegio).toEqual(['MASTER']);
    expect(r.contexto.janelaMinimaDias).toBe(90);
    // A escrita ampla vem antes dentro da mesma situação.
    expect(r.contas[0]?.nome).toBe('AUTORIZADOR');
  });

  it('depois do desligamento: o que pede ação vem primeiro e o uso medido entra na linha', () => {
    const r = montarInventarioContas({
      hospital: 'pc',
      em: '2026-10-28T12:00:00.000Z',
      contas,
      loginsNaoLegiveis: 0,
      usos: [
        {
          conta: 'EXCEL',
          inicio: '2026-07-01',
          fim: '2026-09-30',
          sessoes: 0,
          consultas: 0,
          ultimoUso: null,
          fonte: 'mon-attachments',
        },
      ],
      sgh: SGH,
      contexto: { desligado: true, contingenciaAtiva: false, decisoes: new Set(), janelaMinimaDias: 60 },
      avisos: [],
    });
    expect(r.contas[0]?.situacao).toBe('identificar');
    const excel = r.contas.find((c) => c.nome === 'EXCEL');
    expect(excel?.destino).toBe('revogar');
    expect(excel?.situacao).toBe('pronta');
    expect(excel?.uso?.sessoes).toBe(0);
    expect(r.contas.find((c) => c.nome === 'AUTORIZADOR')?.situacao).toBe('medir-uso');
    expect(r.resumo.loginsSemPrivilegio).toBe(0);
    expect(r.contexto.janelaMinimaDias).toBe(60);
  });
});

describe('montarDesvios', () => {
  const alcances = [
    { modulo: 'acesso', objetos: { TBUSERS: ['SELECT', 'UPDATE'] as const } },
    { modulo: 'cadastro', objetos: { TBPACIENTE: ['SELECT'] as const } },
  ];

  it('sem papel no banco: plano não aplicado e a falta é o plano inteiro', () => {
    const r = montarDesvios({
      hospital: 'pc',
      em: '2026-10-28T12:00:00.000Z',
      alcances,
      reais: [],
      contasConfiguradas: new Set(['acesso']),
    });
    expect(esquemaDesviosPrivilegiosResposta.parse(r)).toEqual(r);
    expect(r.planoAplicado).toBe(false);
    expect(r.faltaTotal).toBe(3);
    expect(r.iguais).toBe(0);
    expect(r.modulos).toEqual([
      {
        modulo: 'acesso',
        papel: 'SGH_MOD_ACESSO',
        conta: 'SGH_APP_ACESSO',
        objetos: 1,
        itens: 2,
        contaConfigurada: true,
      },
      {
        modulo: 'cadastro',
        papel: 'SGH_MOD_CADASTRO',
        conta: 'SGH_APP_CADASTRO',
        objetos: 1,
        itens: 1,
        contaConfigurada: false,
      },
    ]);
  });

  it('com o plano aplicado: excesso (privilégio direto na conta) e falta, com o teto nas listas', () => {
    const muitos = Array.from({ length: TETO_ITENS_DESVIO + 5 }, (_, i) => ({
      titular: 'SGH_APP_ACESSO',
      objeto: `TB${String(i).padStart(4, '0')}`,
      acao: 'SELECT' as const,
    }));
    const r = montarDesvios({
      hospital: 'pc',
      em: '2026-10-28T12:00:00.000Z',
      alcances,
      reais: [
        { titular: 'SGH_MOD_ACESSO', objeto: 'TBUSERS', acao: 'SELECT' },
        { titular: 'SGH_MOD_ACESSO', objeto: 'TBUSERS', acao: 'UPDATE' },
        ...muitos,
      ],
      contasConfiguradas: new Set(),
    });
    expect(r.planoAplicado).toBe(true);
    expect(r.iguais).toBe(2);
    expect(r.faltaTotal).toBe(1);
    expect(r.excessoTotal).toBe(TETO_ITENS_DESVIO + 5);
    expect(r.excesso).toHaveLength(TETO_ITENS_DESVIO);
    expect(esquemaDesviosPrivilegiosResposta.parse(r)).toEqual(r);
  });
});
