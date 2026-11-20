import { esquemaPainelFimCoexistencia, esquemaRegistroFimCoexistencia } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { avaliarFimCoexistencia, ensaiosPendentes, type EntradaFim, proximoVerdeDesde } from './criterio.js';
import { avaliarDias } from './sem-sessao.js';

const dia = (n: number) => `2027-01-${String(n).padStart(2, '0')}`;
const limpos = (de: number, ate: number) =>
  avaliarDias(
    Array.from({ length: ate - de + 1 }, (_, i) => ({
      dia: dia(de + i),
      loginsComConexao: [],
      conexoesProgramaAnterior: 0,
    })),
    [],
  );
const ensaio = (tipo: string, data = '2027-01-10', resultado = 'aprovado') => ({
  tipo,
  data,
  papeis: ['ti'],
  resultado,
});
const registroCompleto = esquemaRegistroFimCoexistencia.parse({
  formato: 1,
  estabelecimento: 'pc',
  ensaios: ['kit-papel', 'relatorio-por-posto', 'pwa-offline', 'queda-do-banco'].map((t) => ensaio(t)),
  excecoesOperacao: [
    { operacao: 'sadt.laudoExterno', decisao: 'fica até o contrato novo', decididaEm: '2027-01-05' },
  ],
  aceiteDiretoria: { data: '2027-01-29', papel: 'diretoria' },
});

const verde = (): EntradaFim => ({
  estabelecimento: 'pc',
  hoje: dia(31),
  medidoEm: '2027-01-31T10:00:00Z',
  operacoes: [
    { nome: 'recepcao.emitirSenha', estado: 'liberada', assinatura: 'verde' },
    { nome: 'pep.prescrever', estado: 'liberada', assinatura: 'verde' },
    { nome: 'sadt.laudoExterno', estado: 'verde', assinatura: 'verde' },
  ],
  usuarios: { ativos: 700, comTrilhaEAcesso: 700, semTrilha: 0, semAcesso: 0 },
  dias: limpos(1, 31),
  competencia: {
    competencia: '2026-12',
    conveniosDoHospital: 20,
    fechadosPeloNovo: 20,
    lotes: 300,
    lotesPeloNovo: 300,
  },
  s1Abertos: 0,
  registro: registroCompleto,
  verdeDesdeAnterior: { 'sem-s1-aberto': dia(3) },
});

describe('regra 1: critério do cap-15 (DP-5)', () => {
  it('cinco itens verdes e contingência pronta: fim registrável, com a data de cada item', () => {
    const p = avaliarFimCoexistencia(verde());
    expect(esquemaPainelFimCoexistencia.safeParse(p).success).toBe(true);
    expect(p.cap15.map((i) => i.situacao)).toEqual(['verde', 'verde', 'verde', 'verde', 'verde']);
    expect(p.fimRegistravel).toBe(true);
    expect(p.pendencias).toEqual([]);
    const s1 = p.cap15.find((i) => i.item === 'sem-s1-aberto')!;
    expect(s1.verdeDesde).toBe(dia(3));
    expect(p.cap15.find((i) => i.item === 'sem-sessao-14-dias')!.verdeDesde).toBe(dia(14));
    const ops = p.cap15[0]!;
    expect(ops.valor).toBe('2 de 2');
    expect(ops.parcelas.map((x) => x.valor)).toEqual([2, 0, 1]);
  });

  it('item sem medida nunca é verde e bloqueia o registro', () => {
    const p = avaliarFimCoexistencia({
      ...verde(),
      s1Abertos: null,
      usuarios: null,
      competencia: null,
      operacoes: null,
    });
    expect(p.cap15.map((i) => i.situacao)).toEqual([
      'sem-medida',
      'sem-medida',
      'verde',
      'sem-medida',
      'sem-medida',
    ]);
    expect(p.fimRegistravel).toBe(false);
    expect(p.pendencias).toHaveLength(4);
  });

  it('pendências com o motivo', () => {
    const p = avaliarFimCoexistencia({
      ...verde(),
      operacoes: [{ nome: 'pep.prescrever', estado: 'conferida', assinatura: 'verde' }],
      usuarios: { ativos: 10, comTrilhaEAcesso: 8, semTrilha: 1, semAcesso: 1 },
      competencia: {
        competencia: '2026-12',
        conveniosDoHospital: 20,
        fechadosPeloNovo: 19,
        lotes: 3,
        lotesPeloNovo: 3,
      },
      s1Abertos: 2,
    });
    expect(p.cap15.filter((i) => i.situacao === 'pendente').map((i) => i.motivo)).toEqual([
      '1 fora de liberada',
      '2 ativo(s) sem trilha ou sem acesso',
      'competência 2026-12: 1 convênio(s) e 0 lote(s) fora deste sistema',
      '2 S1 aberto(s)',
    ]);
    expect(p.cap15.every((i) => i.situacao === 'verde' || i.verdeDesde === null)).toBe(true);
  });

  it('dia sem medida dentro da janela de 14 dias: sem medida, com o dia apontado', () => {
    const dias = [...limpos(1, 20), ...limpos(22, 31)];
    const p = avaliarFimCoexistencia({ ...verde(), dias });
    const i14 = p.cap15.find((i) => i.item === 'sem-sessao-14-dias')!;
    expect(i14.situacao).toBe('pendente');
    expect(i14.motivo).toBe(`sem medida em ${dia(21)}`);
  });

  it('regra 7: sem a contingência pronta, o fim não é registrável mesmo com os cinco verdes', () => {
    const registro = esquemaRegistroFimCoexistencia.parse({
      ...registroCompleto,
      ensaios: [...registroCompleto.ensaios, ensaio('queda-do-banco', '2027-01-20', 'reprovado')],
    });
    expect(ensaiosPendentes(registro)).toEqual(['queda-do-banco']);
    const p = avaliarFimCoexistencia({ ...verde(), registro });
    expect(p.cap15.every((i) => i.situacao === 'verde')).toBe(true);
    expect(p.fimRegistravel).toBe(false);
    expect(p.pendencias).toEqual(['contingência pós-coexistência: faltam queda-do-banco']);
  });
});

describe('regra 2: conjunto do cap-14 ao lado e a divergência', () => {
  it('30 dias, assinaturas, contingência e aceite; divergência quando só o cap-15 está verde', () => {
    const p = avaliarFimCoexistencia({ ...verde(), dias: limpos(10, 31) });
    expect(p.cap14.map((i) => [i.item, i.situacao])).toEqual([
      ['sem-sessao-30-dias', 'pendente'],
      ['assinaturas-verdes', 'verde'],
      ['contingencia-pronta', 'verde'],
      ['aceite-diretoria', 'verde'],
    ]);
    expect(p.divergencias).toEqual(['critério do cap-15 verde e conjunto do cap-14 não: sem-sessao-30-dias']);
    expect(p.fimRegistravel).toBe(true);
  });

  it('assinatura com diferença ou sem execução não é verde', () => {
    const p = avaliarFimCoexistencia({
      ...verde(),
      operacoes: [
        { nome: 'a.b', estado: 'liberada', assinatura: 'diferenca' },
        { nome: 'a.c', estado: 'liberada', assinatura: null },
      ],
    });
    const a = p.cap14.find((i) => i.item === 'assinaturas-verdes')!;
    expect(a.situacao).toBe('pendente');
    expect(a.motivo).toBe('1 com diferença e 1 sem execução');
  });

  it('contingência verde desde o último ensaio aprovado', () => {
    const registro = esquemaRegistroFimCoexistencia.parse({
      ...registroCompleto,
      ensaios: [...registroCompleto.ensaios, ensaio('pwa-offline', '2027-01-18')],
    });
    const p = avaliarFimCoexistencia({ ...verde(), registro });
    expect(p.cap14.find((i) => i.item === 'contingencia-pronta')!.verdeDesde).toBe('2027-01-18');
  });
});

describe('fim registrado e verde desde', () => {
  it('mostra a data do registro do dono e guarda só os verdes', () => {
    const registro = esquemaRegistroFimCoexistencia.parse({
      ...registroCompleto,
      ata: { data: '2027-01-30', referencia: 'ata do comitê de janeiro' },
      fimRegistrado: { data: '2027-01-31', papel: 'dono-do-projeto' },
    });
    const p = avaliarFimCoexistencia({ ...verde(), registro, s1Abertos: 1 });
    expect(p.fimRegistradoEm).toBe('2027-01-31');
    const v = proximoVerdeDesde(p);
    expect(v['sem-s1-aberto']).toBeUndefined();
    expect(v['operacoes-liberadas']).toBe(dia(31));
  });
});
