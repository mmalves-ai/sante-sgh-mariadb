import { TELAS_ONDA_0 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { implantacaoPronta, verificarConferenciaLeituras } from './onda0.js';
import { chaveDeTelaDaPermissao, situacaoDaChave, situacaoDaLeitura, situacaoDaTela } from './telas.js';

const agora = new Date('2026-11-03T12:00:00Z');
const base = { declarados: [], registrados: [], agora };
const tela = (id: string) => TELAS_ONDA_0.find((t) => t.id === id)!;

describe('onda 0: situação da chave de uma tela', () => {
  it('ligada para o grupo MASTER: ligada para quem é do grupo, fora do escopo para os demais', () => {
    const chaves = [{ escopo: 'grupo' as const, valor: 'MASTER', ligada: true }];
    expect(situacaoDaChave({ ...base, chaves, sujeito: { pessoa: 'A', grupo: 'MASTER' } })).toBe('ligada');
    expect(situacaoDaChave({ ...base, chaves, sujeito: { pessoa: 'B', grupo: 'RECEPCAO' } })).toBe(
      'fora-do-escopo',
    );
  });

  it('sem chave ou desligada no estabelecimento: desligada', () => {
    expect(situacaoDaChave({ ...base, chaves: [], sujeito: { pessoa: 'A' } })).toBe('desligada');
    const chaves = [
      { escopo: 'hospital' as const, valor: '*', ligada: false },
      { escopo: 'pessoa' as const, valor: 'A', ligada: true },
    ];
    expect(situacaoDaChave({ ...base, chaves, sujeito: { pessoa: 'B' } })).toBe('desligada');
  });

  it('ligada mas com pré-requisito pendente', () => {
    const r = situacaoDaChave({
      ...base,
      chaves: [{ escopo: 'hospital', valor: '*', ligada: true }],
      declarados: [{ tipo: 'aprovacao', descricao: 'x', responsavel: 'TI' }],
      sujeito: { pessoa: 'A' },
    });
    expect(r).toBe('prerequisito');
  });
});

describe('onda 0: situação de uma tela', () => {
  const ligada = { ...base, chaves: [{ escopo: 'hospital' as const, valor: '*', ligada: true }] };

  it('tela com escrita: liberada se alguma operação da tela grava para quem pergunta', async () => {
    const r = await situacaoDaTela(tela('pacientes'), { ...ligada, sujeito: { pessoa: 'A' } }, async (op) =>
      op.endsWith('alterarPaciente'),
    );
    expect(r).toEqual({
      id: 'pacientes',
      recurso: 'cadastro.paciente.consulta',
      permissao: 'cadastro.paciente.ler',
      situacao: 'ligada',
      escritaLiberada: true,
    });
    const so = await situacaoDaTela(
      tela('pacientes'),
      { ...ligada, sujeito: { pessoa: 'A' } },
      async () => false,
    );
    expect(so.escritaLiberada).toBe(false);
  });

  it('tela sem escrita: escritaLiberada null; sem chave: sem-chave', async () => {
    const r = await situacaoDaTela(tela('leitos'), { ...ligada, sujeito: { pessoa: 'A' } }, async () => true);
    expect(r.escritaLiberada).toBeNull();
    const b = await situacaoDaTela(tela('busca-global'), null, async () => true);
    expect(b.situacao).toBe('sem-chave');
  });
});

describe('onda 0: sondas da implantação', () => {
  const todas = ['saude', 'versao', 'login-sonda', 'painel-leitos', 'recusa-negocio'] as const;
  it('pronta só com todas as sondas verdes', () => {
    expect(implantacaoPronta(todas.map((sonda) => ({ sonda, ok: true })))).toBe(true);
    expect(implantacaoPronta(todas.map((sonda) => ({ sonda, ok: sonda !== 'versao' })))).toBe(false);
    expect(implantacaoPronta(todas.slice(1).map((sonda) => ({ sonda, ok: true })))).toBe(false);
  });
});

describe('onda 0: conferência de leitura (regra 6)', () => {
  const base = {
    formato: 1 as const,
    estabelecimento: 'pc',
    data: '2026-11-10',
    versao: '1.0.0',
    conferentes: [
      { papel: 'chave-usuario' as const, area: 'NIR' },
      { papel: 'chave-usuario' as const, area: 'diretoria-clinica' },
    ],
    leituras: [
      { tela: 'leitos' as const, resultado: 'conforme' as const, conferidas: 9 },
      { tela: 'prontuario' as const, resultado: 'conforme' as const, conferidas: 20 },
    ],
    resultado: 'aceita' as const,
    revisao: { pr: '#1', data: '2026-11-10' },
  };
  it('vale com NIR, diretoria clínica, leitos e prontuário conformes; recusa o que falta', () => {
    expect(verificarConferenciaLeituras(base)).toEqual([]);
    expect(verificarConferenciaLeituras({ ...base, conferentes: base.conferentes.slice(1) })).toEqual([
      'falta a conferência da área nir',
    ]);
    expect(
      verificarConferenciaLeituras({
        ...base,
        leituras: [{ tela: 'leitos', resultado: 'divergente', conferidas: 9 }],
      }),
    ).toEqual(['falta a leitura da tela prontuario', 'aceita com leitura divergente']);
    expect(verificarConferenciaLeituras({ ...base, resultado: 'recusada', data: '2026-13-01' })).toEqual([
      'data inválida',
    ]);
  });
});

describe('onda 0: leitura sob chave de tela (o servidor confere)', () => {
  const entradaCom =
    (
      porChave: Record<string, { escopo: 'hospital' | 'grupo' | 'pessoa'; valor: string; ligada: boolean }[]>,
      grupo?: string,
    ) =>
    (chave: string) => ({
      ...base,
      chaves: porChave[chave] ?? [],
      sujeito: { pessoa: 'A', ...(grupo ? { grupo } : {}) },
    });

  it('permissão fora das chaves de tela: null (a rota segue só pela permissão)', () => {
    expect(chaveDeTelaDaPermissao('agenda.marcacao.ler')).toBeNull();
    expect(situacaoDaLeitura('agenda.marcacao.ler', entradaCom({}))).toBeNull();
    expect(chaveDeTelaDaPermissao('cadastro.paciente.ler')).toBe('cadastro.paciente.consulta');
  });

  it('chave da tela ligada para o grupo MASTER: ligada para o MASTER, fora do escopo para o LEITOS', () => {
    const chaves = {
      'cadastro.paciente.consulta': [{ escopo: 'grupo' as const, valor: 'MASTER', ligada: true }],
    };
    expect(situacaoDaLeitura('cadastro.paciente.ler', entradaCom(chaves, 'MASTER'))).toBe('ligada');
    expect(situacaoDaLeitura('cadastro.paciente.ler', entradaCom(chaves, 'LEITOS'))).toBe('fora-do-escopo');
    expect(situacaoDaLeitura('config.dominio.ler', entradaCom(chaves, 'MASTER'))).toBe('desligada');
  });

  it('a busca de paciente também abre com a chave de uma tela das ondas seguintes; o histórico, não', () => {
    const chaves = { 'agenda.consulta': [{ escopo: 'hospital' as const, valor: '*', ligada: true }] };
    expect(situacaoDaLeitura('cadastro.paciente.ler', entradaCom(chaves))).toBe('ligada');
    expect(situacaoDaLeitura('cadastro.historico.ler', entradaCom(chaves))).toBe('desligada');
  });
});
