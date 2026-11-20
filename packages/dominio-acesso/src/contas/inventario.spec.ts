// M59-F1, regras 1, 4 e 5: catalogação das contas do banco, destino e situação, resumo e a conta da aplicação.
import { describe, expect, it } from 'vitest';
import type { ContaBancoLida, UsoContaBanco } from '@sgh/contratos';
import {
  catalogarConta,
  conferirContaAplicacao,
  decidirDestinoConta,
  faixaContagem,
  LIMIAR_ESCRITA_AMPLA,
  nomesLegiveis,
  resumirInventario,
  type ContasSgh,
  type ContextoHospital,
} from './inventario.js';

const SGH: ContasSgh = { aplicacao: ['sgh_dev'], scripts: 'SGH_SCRIPTS', leitura: 'SGH_LEITURA' };
const H: ContextoHospital = { desligado: true, contingenciaAtiva: false, decisoes: new Set() };
const uso = (conta: string, sessoes: number, inicio = '2026-07-01', fim = '2026-09-30'): UsoContaBanco => ({
  conta,
  inicio,
  fim,
  sessoes,
  consultas: null,
  ultimoUso: null,
  fonte: 'trace',
});

describe('nomesLegiveis', () => {
  it('só as contas do catálogo, as do Sante SGH (em maiúsculas) e os prefixos', () => {
    const r = nomesLegiveis(SGH);
    expect(r.nomes).toContain('EXCEL_FIN');
    expect(r.nomes).toContain('SGH_DEV');
    expect(r.nomes).toContain('SGH_SCRIPTS');
    expect(r.nomes).toContain('SGH_LEITURA');
    expect(r.prefixos).toEqual(['RELATORIO_', 'SGH_APP_']);
    expect(nomesLegiveis({ aplicacao: [], scripts: null, leitura: null }).nomes).not.toContain('SGH_DEV');
  });
});

describe('catalogarConta', () => {
  it('Sante SGH, catálogo exato, prefixo e não catalogada', () => {
    expect(catalogarConta('sgh_dev', SGH).classe).toBe('aplicacao-sgh');
    expect(catalogarConta('SGH_APP_FATURAMENTO', SGH).classe).toBe('aplicacao-sgh');
    expect(catalogarConta('SGH_SCRIPTS', SGH).classe).toBe('scripts-sgh');
    expect(catalogarConta('SGH_LEITURA', SGH).classe).toBe('leitura-sgh');
    expect(catalogarConta('EXCEL_FIN', SGH)).toMatchObject({ classe: 'planilha', destino: 'revogar' });
    expect(catalogarConta('RELATORIO_X', SGH)).toMatchObject({ nome: 'RELATORIO_X', classe: 'planilha' });
    expect(catalogarConta('SGH_APLICACAO', SGH).classe).toBe('aplicacao-sgh');
    expect(catalogarConta('SGH_MOD_PEP', SGH).classe).toBe('aplicacao-sgh');
    expect(catalogarConta('PUBLIC', SGH).classe).toBe('publico');
    expect(catalogarConta('MASTER', SGH).classe).toBe('papel-legado');
    expect(catalogarConta('QUALQUER', SGH).classe).toBe('nao-catalogada');
    expect(catalogarConta(null, SGH).classe).toBe('nao-catalogada');
  });
});

describe('decidirDestinoConta (regra 5)', () => {
  it('hospital com o sistema anterior ligado: nada (regra 1)', () => {
    expect(decidirDestinoConta('EXCEL', SGH, uso('EXCEL', 0), { ...H, desligado: false }).situacao).toBe(
      'aguardando-desligamento',
    );
  });

  it('não catalogada, administrador e contas do Sante SGH', () => {
    expect(decidirDestinoConta(null, SGH, null, H).situacao).toBe('identificar');
    expect(decidirDestinoConta('SYSDBA', SGH, null, H)).toMatchObject({
      destino: 'manter-auditada',
      situacao: 'pronta',
    });
    expect(decidirDestinoConta('SGH_DEV', SGH, null, H)).toMatchObject({
      destino: 'privilegio-minimo',
      situacao: 'pronta',
    });
  });

  it('sem medição ou janela curta: medir antes de revogar', () => {
    expect(decidirDestinoConta('EXCEL', SGH, null, H).situacao).toBe('medir-uso');
    expect(decidirDestinoConta('EXCEL', SGH, uso('EXCEL', 0, '2026-09-01', '2026-09-30'), H).situacao).toBe(
      'medir-uso',
    );
    expect(
      decidirDestinoConta('EXCEL', SGH, uso('EXCEL', 0, '2026-09-01', '2026-09-30'), {
        ...H,
        janelaMinimaDias: 30,
      }).situacao,
    ).toBe('pronta');
  });

  it('sem uso na janela vira revogação; backup e sante-api nunca por desuso', () => {
    expect(decidirDestinoConta('TOLIFE', SGH, uso('TOLIFE', 0), H)).toMatchObject({
      destino: 'revogar',
      situacao: 'pronta',
    });
    expect(decidirDestinoConta('HAL_AI', SGH, uso('HAL_AI', 0), H)).toMatchObject({
      destino: 'fachada-sante-api',
      situacao: 'aguardando-decisao',
    });
    expect(decidirDestinoConta('SGHBACKUP', SGH, uso('SGHBACKUP', 0), H)).toMatchObject({
      destino: 'privilegio-reduzido',
      situacao: 'pronta',
    });
  });

  it('contingência ativa segura o que o sistema anterior usa (DP-6)', () => {
    const c = { ...H, contingenciaAtiva: true };
    expect(decidirDestinoConta('PORTALSERV', SGH, uso('PORTALSERV', 0), c)).toMatchObject({
      destino: 'revogar',
      situacao: 'aguardando-contingencia',
    });
    expect(decidirDestinoConta('SGHBACKUP', SGH, uso('SGHBACKUP', 10), c).situacao).toBe(
      'aguardando-contingencia',
    );
    // Planilha não é usada pelo sistema anterior: a contingência não a segura.
    expect(decidirDestinoConta('EXCEL', SGH, uso('EXCEL', 0), c).situacao).toBe('pronta');
  });

  it('PUBLIC e papéis do sistema anterior: sem medição; PUBLIC espera a contingência e a prova na cópia', () => {
    expect(decidirDestinoConta('MASTER', SGH, null, H)).toMatchObject({
      destino: 'manter-auditada',
      situacao: 'pronta',
    });
    expect(decidirDestinoConta('PUBLIC', SGH, null, { ...H, contingenciaAtiva: true }).situacao).toBe(
      'aguardando-contingencia',
    );
    expect(decidirDestinoConta('PUBLIC', SGH, null, H)).toMatchObject({
      destino: 'privilegio-reduzido',
      situacao: 'aguardando-decisao',
    });
    expect(
      decidirDestinoConta('PUBLIC', SGH, null, { ...H, decisoes: new Set(['prova-na-copia']) }).situacao,
    ).toBe('pronta');
  });

  it('em uso: decisões pendentes (DP-16, regra 12, concordância da área)', () => {
    expect(decidirDestinoConta('TOLIFE', SGH, uso('TOLIFE', 3), H)).toMatchObject({
      destino: 'cliente-api',
      situacao: 'aguardando-decisao',
    });
    expect(
      decidirDestinoConta('TOLIFE', SGH, uso('TOLIFE', 3), { ...H, decisoes: new Set(['DP-16']) }).situacao,
    ).toBe('pronta');
    const planilha = decidirDestinoConta('EXCEL_FIN', SGH, uso('EXCEL_FIN', 40), H);
    expect(planilha).toMatchObject({ destino: 'revogar', situacao: 'aguardando-decisao' });
    expect(planilha.motivo).toContain('area:EXCEL_FIN');
    expect(
      decidirDestinoConta('EXCEL_FIN', SGH, uso('EXCEL_FIN', 40), {
        ...H,
        decisoes: new Set(['area:EXCEL_FIN']),
      }).situacao,
    ).toBe('pronta');
    expect(decidirDestinoConta('PORTALSERV', SGH, uso('PORTALSERV', 9), H)).toMatchObject({
      destino: 'funcao-sgh',
      situacao: 'pronta',
    });
  });
});

const zero = { S: 0, I: 0, U: 0, D: 0, R: 0, X: 0, M: 0 };
const conta = (p: Partial<ContaBancoLida>): ContaBancoLida => ({
  nome: 'X',
  tipo: 'usuario',
  existeLogin: true,
  ativa: true,
  quantidade: 1,
  privilegios: zero,
  objetosComEscrita: 0,
  papeis: [],
  ...p,
});

describe('resumirInventario e faixaContagem', () => {
  it('soma contas com privilégio, com escrita e com escrita ampla; agregado das não catalogadas em faixa', () => {
    const r = resumirInventario([
      conta({ nome: 'A', privilegios: { ...zero, S: 2600, I: 2600 }, objetosComEscrita: 2648 }),
      conta({ nome: 'B', privilegios: { ...zero, S: 10, U: 3 }, objetosComEscrita: 3 }),
      conta({ nome: 'C', privilegios: { ...zero, S: 5 } }),
      conta({ nome: 'D' }),
      conta({ nome: null, quantidade: 3, privilegios: { ...zero, S: 1 } }),
      conta({ nome: 'MASTER', tipo: 'papel', existeLogin: false, ativa: null }),
      conta({
        nome: 'SGH_APLICACAO',
        tipo: 'papel',
        existeLogin: false,
        ativa: null,
        privilegios: { ...zero, S: 1 },
      }),
    ]);
    expect(r).toEqual({
      contasComPrivilegio: 6,
      contasComEscrita: 2,
      contasComEscritaAmpla: 1,
      maiorAlcanceEscrita: 2648,
      naoCatalogadas: '<5',
      papeisSemPrivilegio: ['MASTER'],
    });
    expect(LIMIAR_ESCRITA_AMPLA).toBe(1000);
    expect(resumirInventario([]).maiorAlcanceEscrita).toBe(0);
    expect(faixaContagem(0)).toBe(0);
    expect(faixaContagem(4)).toBe('<5');
    expect(faixaContagem(5)).toBe(5);
  });
});

describe('conferirContaAplicacao (regra 4)', () => {
  it('recusa o administrador e a conta dos scripts na aplicação', () => {
    expect(conferirContaAplicacao(SGH)).toEqual([]);
    expect(
      conferirContaAplicacao({ aplicacao: ['sysdba'], scripts: 'SGH_SCRIPTS', leitura: null }),
    ).toHaveLength(1);
    expect(
      conferirContaAplicacao({ aplicacao: ['SGH_SCRIPTS'], scripts: 'sgh_scripts', leitura: null }),
    ).toHaveLength(1);
    expect(conferirContaAplicacao({ aplicacao: [], scripts: 'SYSDBA', leitura: null })).toHaveLength(1);
  });
});
