// Unidade dos geradores sintéticos puros da massa (F2.2, lote 05-06): documentos válidos pelo dígito, textos e
// códigos que cabem no limite e a entrada de reajuste aceita pelo esquema do contrato.
import { esquemaReajustar } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type CampoDaMassa,
  type DominioDaMassa,
  type LeitorDaMassa,
  MARCA_DOMINIO,
  SemOpcaoLivre,
  codigoLivre,
  itemAtivo,
  itemAtivoSemUso,
  leitorDaFonte,
  valoresDeAlteracao,
  valoresDeInclusao,
  cnsDaSemente,
  cnsValido,
  codigoTextoLivre,
  cpfDaBase,
  dataSintetica,
  documentoSintetico,
  textoSintetico,
} from './dominios.js';
import { MARCA_M12, entradaReajuste, loteSintetico } from './precos.js';

const cpfValido = (c: string) => {
  if (!/^\d{11}$/.test(c)) return false;
  const dv = (b: string) => {
    let t = 0;
    for (let i = 0; i < b.length; i++) t += Number(b[i]) * (b.length + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
};

describe('geradores de domínio', () => {
  it('texto marcado cabe no limite e é único', () => {
    const a = textoSintetico(60);
    const b = textoSintetico(60);
    expect(a.startsWith(MARCA_DOMINIO)).toBe(true);
    expect(a).not.toBe(b);
    for (const max of [1, 3, 8, 12]) expect(textoSintetico(max).length).toBeLessThanOrEqual(max);
  });

  it('CPF pela base tem os dois dígitos certos e recusa base inválida', () => {
    expect(cpfDaBase('111444777')).toBe('11144477735');
    expect(cpfValido(cpfDaBase('999888001'))).toBe(true);
    expect(() => cpfDaBase('12')).toThrow();
  });

  it('CNS provisório passa na soma ponderada', () => {
    const c = cnsDaSemente(900_123);
    expect(c).toHaveLength(15);
    expect(c[0]).toBe('7');
    expect(cnsValido(c)).toBe(true);
    const trocado = `${c.slice(0, 14)}${(Number(c[14]) + 1) % 10}`;
    expect(cnsValido(trocado)).toBe(false);
    expect(cnsValido('3' + c.slice(1))).toBe(false);
  });

  it('documento sintético foge do atual e dos usados', () => {
    const um = documentoSintetico('cpf');
    expect(cpfValido(um)).toBe(true);
    const outro = documentoSintetico('cpf', new Set([um]), um);
    expect(outro).not.toBe(um);
    expect(cnsValido(documentoSintetico('cns'))).toBe(true);
  });

  it('código de texto livre respeita o limite, o padrão e os usados', () => {
    const k = codigoTextoLivre(4, new Set());
    expect(k).toMatch(/^[A-Z0-9_]+$/);
    expect(k.length).toBeLessThanOrEqual(4);
    expect(codigoTextoLivre(4, new Set([k]))).not.toBe(k);
    expect(() => codigoTextoLivre(0, new Set())).toThrow();
  });

  it('data sintética é ISO válida e diferente da atual', () => {
    const d = dataSintetica();
    expect(d).toMatch(/^2099-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(d))).toBe(false);
    expect(dataSintetica(d)).not.toBe(d);
  });
});

describe('massa de preços', () => {
  const itens = [
    { codigo: 101, vigencia: '2026-01-01', valores: { ch: 10, co: 0, filme: 0, anes: 0, outros: 0 } },
    { codigo: 102, vigencia: null, valores: { ch: 20, co: 0, filme: 0, anes: 0, outros: 0 } },
  ];

  it('lote sintético é único e curto', () => {
    const a = loteSintetico('x');
    expect(a.length).toBeLessThanOrEqual(40);
    expect(loteSintetico('x')).not.toBe(a);
  });

  it('reajuste percentual: 5% no CH, base só quando há vigência, aceito pelo contrato', () => {
    const e = entradaReajuste(305, '2026-12-01', itens, 'percentual');
    expect(e.percentual).toBe(5);
    expect(e.itens[0]?.novos.ch).toBe(10.5);
    expect(e.itens[1]?.base).toBeNull();
    expect(e.justificativa.startsWith(MARCA_M12)).toBe(true);
    const r = esquemaReajustar.safeParse(e);
    expect(r.success, JSON.stringify(r.error?.issues?.slice(0, 3))).toBe(true);
  });

  it('reajuste por arquivo: origem importação e sem percentual', () => {
    const e = entradaReajuste(305, '2026-12-01', itens, 'arquivo');
    expect(e.origem).toBe('importacao');
    expect(e.percentual).toBeNull();
    expect(esquemaReajustar.safeParse(e).success).toBe(true);
  });
});

// Dublê da fonte própria: a mesma forma de declaração que dominios-catalogo.ts deriva dos metadados do MariaDB.
const campo = (c: Partial<CampoDaMassa> & Pick<CampoDaMassa, 'coluna' | 'campo' | 'tipo'>): CampoDaMassa => ({
  rotulo: c.campo,
  obrigatorio: false,
  editavel: c.coluna !== 'codigo',
  naInclusao: true,
  naLista: false,
  ...c,
});
const dominio: DominioDaMassa = {
  tabela: 'tipo_acomodacao_sintetico',
  campos: [
    campo({ coluna: 'codigo', campo: 'codigo', tipo: 'texto', maxBytes: 30, obrigatorio: true, codigo: 'manual' }),
    campo({ coluna: 'descricao', campo: 'descricao', tipo: 'texto', maxBytes: 120, obrigatorio: true }),
    campo({ coluna: 'ativo', campo: 'ativo', tipo: 'letra', booleano: true, valores: [{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não' }] }),
    campo({ coluna: 'permite_acompanhante', campo: 'permiteAcompanhante', tipo: 'letra', booleano: true, valores: [{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não' }] }),
    campo({ coluna: 'grupo_id', campo: 'grupoId', tipo: 'referencia', referencia: 'grupo', tabelaReferencia: 'grupo_sintetico' }),
    campo({ coluna: 'ordem', campo: 'ordem', tipo: 'inteiro', minimo: 0, maximo: 255 }),
    campo({ coluna: 'valor_diaria', campo: 'valorDiaria', tipo: 'decimal', casas: 2 }),
    campo({ coluna: 'vigente_desde', campo: 'vigenteDesde', tipo: 'data' }),
    campo({ coluna: 'hora_limite', campo: 'horaLimite', tipo: 'hora' }),
  ],
};
const item = (codigo: string, ativo: boolean) => ({ codigo, ativo, valores: {}, versao: '1' });
const leitor = (opcoes: string[], usados: string[] = []): LeitorDaMassa =>
  leitorDaFonte(
    {
      listar: async () => ({ itens: [item('ZZZZ', true), item('A1', false), item('B2', true)] }),
      uso: async (_h, _d, codigo) => [{ usos: usados.includes(codigo) }],
      opcoes: async () => opcoes.map((valor) => ({ valor })),
    },
    'f22_o5',
  );

describe('massa do CRUD genérico de domínios (modelo próprio)', () => {
  it('inclusão: código livre fora dos lidos, booleano sim/não, referência real, data ISO, sem HHMM', async () => {
    const v = await valoresDeInclusao(leitor(['7', '9']), dominio);
    expect(v['codigo']).toMatch(/^[A-Z0-9_]+$/);
    expect(['ZZZZ', 'A1', 'B2']).not.toContain(v['codigo']);
    expect(v['ativo']).toBe('sim');
    expect(v['permiteAcompanhante']).toBe('nao');
    expect(v['grupoId']).toBe(7);
    expect(v['vigenteDesde']).toMatch(/^2099-\d{2}-\d{2}$/);
    expect(v['horaLimite']).toBe('01:30');
    expect(String(v['descricao'])).toContain(MARCA_DOMINIO);
  });
  it('código livre respeita os ocupados da mesma rodada', async () => {
    const a = await codigoLivre(leitor([]), dominio);
    const b = await codigoLivre(leitor([]), dominio, new Set([a]));
    expect(b).not.toBe(a);
  });
  it('alteração: todo editável muda, menos ativo (é a inativação)', async () => {
    const atuais = { descricao: 'X', permiteAcompanhante: 'nao', grupoId: 7, ordem: 7, valorDiaria: 2.5, vigenteDesde: '2099-12-01', horaLimite: '02:45' };
    const v = await valoresDeAlteracao(leitor(['7', '9']), dominio, atuais);
    expect(v).not.toHaveProperty('ativo');
    expect(v).not.toHaveProperty('codigo');
    for (const [k, x] of Object.entries(atuais)) expect(v[k]).not.toEqual(x);
  });
  it('referência sem opção ativa: SemOpcaoLivre com a tabela das opções', async () => {
    await expect(valoresDeInclusao(leitor([]), dominio)).rejects.toBeInstanceOf(SemOpcaoLivre);
    await expect(valoresDeInclusao(leitor([]), dominio)).rejects.toMatchObject({ tabelaOpcoes: 'grupo_sintetico' });
  });
  it('item ativo e item ativo sem uso', async () => {
    expect((await itemAtivo(leitor([]), dominio)).codigo).toBe('ZZZZ');
    expect(await itemAtivoSemUso(leitor([], ['ZZZZ']), dominio)).toBe('B2');
    await expect(itemAtivoSemUso(leitor([], ['ZZZZ', 'B2']), dominio)).rejects.toThrow('nenhum item ativo sem uso');
  });
});
