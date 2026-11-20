// Onda 0 (ficha do M38): estado das operações na onda, lista da primeira liberação, escopo, argumentos da vigia,
// amostra determinística e resumo da vigilância sem valor de linha.
import { type Diferenca, ITENS_PRIMEIRA_LIBERACAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  alertasDaVigia,
  amostrarGravacoes,
  argumentosVigia,
  avaliarPrimeiraLiberacao,
  conferirEstadoOnda0,
  dataValida,
  elementoDaDiferenca,
  noEscopoOnda0,
  resumirVigia,
} from './onda0.js';

const dif = (
  tipo: Diferenca['tipo'],
  elemento: string,
  esperado = 'x',
  obtido = 'y',
  aceita = false,
): Diferenca => ({
  tipo,
  elemento,
  esperado,
  obtido,
  aceita,
});

describe('conferirEstadoOnda0', () => {
  const hospitais = ['pc', 'hs'];
  it('passa com a trilha liberada só no pc', () => {
    expect(
      conferirEstadoOnda0({
        hospitais,
        iniciados: ['pc'],
        operacoes: [
          { nome: 'auditoria.registrarEventoLegado', estado: { pc: 'liberada', hs: 'verde' } },
          { nome: 'acesso.trocarSenha', estado: { pc: 'bloqueada', hs: 'bloqueada' } },
          { nome: 'agenda.agendarConsulta', estado: { pc: 'conferida' } },
          { nome: 'cadastro.cadastrarPaciente', estado: 'especificada' },
        ],
      }),
    ).toEqual([]);
  });

  it('iniciado sem a trilha dupla liberada: 1 problema (o login condicional não é exigido)', () => {
    const p = conferirEstadoOnda0({
      hospitais,
      iniciados: ['pc'],
      operacoes: [
        { nome: 'auditoria.registrarEventoLegado', estado: { pc: 'verde', hs: 'verde' } },
        { nome: 'acesso.trocarSenha', estado: { pc: 'bloqueada', hs: 'bloqueada' } },
      ],
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/registrarEventoLegado: verde em pc/);
    expect(conferirEstadoOnda0({ hospitais, iniciados: ['pc'], operacoes: [] })[0]).toContain(
      'fora do catálogo',
    );
    // Sem hospital iniciado, nada é exigido.
    expect(
      conferirEstadoOnda0({
        hospitais,
        iniciados: [],
        operacoes: [{ nome: 'auditoria.registrarEventoLegado', estado: { pc: 'verde' } }],
      }),
    ).toEqual([]);
  });

  it('recusa operação de negócio liberada, liberação no hospital que não começou e estado único liberada', () => {
    const p = conferirEstadoOnda0({
      hospitais,
      iniciados: ['pc'],
      operacoes: [
        { nome: 'agenda.agendarConsulta', estado: { pc: 'liberada' } },
        { nome: 'auditoria.registrarEventoLegado', estado: { pc: 'liberada', hs: 'liberada' } },
        { nome: 'acesso.trocarSenha', estado: 'liberada' },
      ],
    });
    expect(p).toHaveLength(3);
    expect(p[0]).toContain('negócio');
    expect(p[1]).toContain('hs');
    expect(p[2]).toContain('sem estado por hospital');
  });
});

describe('avaliarPrimeiraLiberacao', () => {
  const tudo = Object.fromEntries(
    ITENS_PRIMEIRA_LIBERACAO.map((i) => [
      i,
      { evidencia: `docs/marcos/M38/evidencias.md#${i}`, data: '2026-11-02' },
    ]),
  );
  it('libera só com todos os itens marcados', () => {
    expect(avaliarPrimeiraLiberacao(tudo)).toEqual({ liberavel: true, faltam: [], invalidas: [] });
    const semPentest = Object.fromEntries(Object.entries(tudo).filter(([k]) => k !== 'pentest'));
    const r = avaliarPrimeiraLiberacao(semPentest);
    expect(r.liberavel).toBe(false);
    expect(r.faltam).toEqual(['pentest']);
  });
  it('marca sem evidência ou com data inválida não vale', () => {
    const r = avaliarPrimeiraLiberacao({
      ...tudo,
      'logo-dp9': { evidencia: ' ', data: '2026-11-02' },
      'plantao-n3': { evidencia: 'ESTADO.md', data: '2026-02-30' },
    });
    expect(r.liberavel).toBe(false);
    expect(r.invalidas).toEqual(['logo-dp9', 'plantao-n3']);
  });
});

describe('dataValida', () => {
  it('só datas de calendário', () => {
    expect(dataValida('2026-11-03')).toBe(true);
    expect(dataValida('2026-13-01')).toBe(false);
    expect(dataValida('2026-11-3')).toBe(false);
  });
});

describe('noEscopoOnda0', () => {
  it('grupos MASTER e MASTER_SEM_FINANCEIRO, ou papel mapeado pelo comitê', () => {
    expect(noEscopoOnda0('MASTER')).toBe(true);
    expect(noEscopoOnda0(' master_sem_financeiro ')).toBe(true);
    expect(noEscopoOnda0('RECEPCAO')).toBe(false);
    expect(noEscopoOnda0(null)).toBe(false);
    expect(noEscopoOnda0('RECEPCAO', ['nir'])).toBe(true);
  });
});

describe('argumentosVigia', () => {
  it('exige hospital da Rede e dia fechado', () => {
    expect(argumentosVigia({ hospital: 'pc', data: '2026-11-02' }, '2026-11-03')).toEqual({
      ok: true,
      hospital: 'pc',
      data: '2026-11-02',
    });
    expect(argumentosVigia({ hospital: 'xx', data: '2026-11-02' }, '2026-11-03').ok).toBe(false);
    expect(argumentosVigia({ hospital: 'hs' }, '2026-11-03').ok).toBe(false);
    expect(argumentosVigia({ hospital: 'hs', data: '2026-11-03' }, '2026-11-03').ok).toBe(false);
  });
});

describe('amostrarGravacoes', () => {
  const ids = Array.from({ length: 200 }, (_, i) => i + 1);
  it('é determinística, sem repetição e do tamanho pedido', () => {
    const a = amostrarGravacoes(ids, 20, 'pc:2026-11-02:auditoria.registrarEventoLegado');
    const b = amostrarGravacoes([...ids].reverse(), 20, 'pc:2026-11-02:auditoria.registrarEventoLegado');
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(20);
    expect(amostrarGravacoes(ids, 20, 'pc:2026-11-03:auditoria.registrarEventoLegado')).not.toEqual(a);
  });
  it('amostra maior que o dia devolve o dia inteiro; tamanho inválido é recusado', () => {
    expect(amostrarGravacoes([1, 2, 2, 3], 10, 's').sort()).toEqual([1, 2, 3]);
    expect(() => amostrarGravacoes(ids, -1, 's')).toThrow(RangeError);
    expect(() => amostrarGravacoes(ids, 1.5, 's')).toThrow(RangeError);
  });
});

describe('elementoDaDiferenca', () => {
  it('lê os caminhos do comparador sem o valor da classe', () => {
    expect(
      elementoDaDiferenca(dif('classe', 'TBCABTRILHA:INSERT.colunas.USUARIO', 'constante:ABC', 'entrada')),
    ).toEqual({
      tipo: 'classe',
      tabela: 'TBCABTRILHA',
      coluna: 'USUARIO',
      classe: 'constante',
    });
    expect(
      elementoDaDiferenca(dif('formato', 'TBCABTRILHA:INSERT.colunas.DATA_HORA_ACAO.formato')),
    ).toMatchObject({
      tabela: 'TBCABTRILHA',
      coluna: 'DATA_HORA_ACAO',
      classe: null,
    });
    expect(elementoDaDiferenca(dif('linhas', 'TBLANTRILHASGH:INSERT.linhas'))).toMatchObject({
      tabela: 'TBLANTRILHASGH',
      coluna: null,
    });
    expect(elementoDaDiferenca(dif('acao', 'TBUSERS'))).toMatchObject({ tabela: 'TBUSERS' });
    expect(elementoDaDiferenca(dif('ligacao', 'ligacoes.TBLANTRILHASGH -> TBCABTRILHA'))).toMatchObject({
      tabela: 'TBLANTRILHASGH',
    });
    expect(
      elementoDaDiferenca(dif('efeito-trigger', 'efeitosTrigger.TRG_TBUSERS_AU:TBHISTSENHA:INSERT')),
    ).toMatchObject({
      tabela: 'TBHISTSENHA',
    });
    expect(elementoDaDiferenca(dif('generator', 'generators.GEN_TBCABTRILHA_ID'))).toMatchObject({
      tabela: 'GEN_TBCABTRILHA_ID',
    });
  });
  it('classe que não é do vocabulário e caminho estranho não vazam', () => {
    expect(
      elementoDaDiferenca(dif('colunas', 'TBUSERS:UPDATE.colunas.SENHA', 'ausente', 'entrada')).classe,
    ).toBeNull();
    expect(elementoDaDiferenca(dif('tabela', 'valor qualquer'))).toMatchObject({ tabela: 'DESCONHECIDO' });
    expect(elementoDaDiferenca(dif('colunas', 'T:INSERT.colunas.nome minúsculo'))).toMatchObject({
      coluna: null,
    });
  });
});

describe('resumirVigia e alertasDaVigia', () => {
  const comum = { hospital: 'pc', data: '2026-11-02', operacao: 'auditoria.registrarEventoLegado' };
  it('dia limpo: nenhuma divergência e nenhum alerta (diferença aceita não conta)', () => {
    const r = resumirVigia({
      ...comum,
      gravacoes: [
        [],
        [dif('classe', 'TBCABTRILHA:INSERT.colunas.MAQUINA_USUARIO', 'entrada', 'vazio', true)],
      ],
    });
    expect(r).toMatchObject({ amostradas: 2, divergentes: 0, elementos: [] });
    expect(alertasDaVigia([r])).toEqual([]);
  });
  it('conta cada elemento uma vez por gravação e gera o alerta direto', () => {
    const d = dif('classe', 'TBCABTRILHA:INSERT.colunas.ID_TBOPCOES', 'dominio:1|2', 'entrada');
    const r = resumirVigia({
      ...comum,
      gravacoes: [[d, d], [d, dif('linhas', 'TBLANTRILHASGH:INSERT.linhas', '1', '0')], []],
    });
    expect(r.amostradas).toBe(3);
    expect(r.divergentes).toBe(2);
    expect(r.elementos).toEqual([
      { tipo: 'classe', tabela: 'TBCABTRILHA', coluna: 'ID_TBOPCOES', classe: 'dominio', ocorrencias: 2 },
      { tipo: 'linhas', tabela: 'TBLANTRILHASGH', coluna: null, classe: null, ocorrencias: 1 },
    ]);
    expect(JSON.stringify(r)).not.toContain('1|2');
    const [a] = alertasDaVigia([r]);
    expect(a).toContain('2 de 3');
    expect(a).toContain('TBCABTRILHA.ID_TBOPCOES');
    expect(a).toContain('TBLANTRILHASGH');
  });
});
