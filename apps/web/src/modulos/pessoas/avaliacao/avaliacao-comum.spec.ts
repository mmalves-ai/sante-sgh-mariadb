import { describe, expect, it } from 'vitest';
import { rotasPessoas } from '../rotas.js';
import { esquemaAlterarPdi, esquemaIncluirPdi, type PdiResposta } from '@sgh/contratos';
import {
  conclusaoSugerida,
  dadosDoPdi,
  formDoPdi,
  formPdiVazio,
  linhasDasNotas,
  marcosDoCiclo,
  mudancasDaCorrecao,
  notaMaxDe,
  notasMudaram,
  notasParaGravar,
  opcoesNota,
  passagensDoCiclo,
  pdiAtrasado,
  semNota,
  textoOuNulo,
} from './avaliacao-comum.js';
import { mensagensAvaliacao } from './i18n-avaliacao.js';

describe('comuns da avaliação de desempenho', () => {
  it('a escala de notas vai de 2 a 10', () => {
    expect(notaMaxDe('5')).toBe(5);
    expect(notaMaxDe(' 10 ')).toBe(10);
    expect(notaMaxDe('1')).toBeNull();
    expect(notaMaxDe('11')).toBeNull();
    expect(notaMaxDe('4,5')).toBeNull();
    expect(notaMaxDe('')).toBeNull();
  });

  it('o ciclo aberto se encerra ou se cancela; o fechado só se reabre', () => {
    expect(passagensDoCiclo('aberto')).toEqual(['encerrado', 'cancelado']);
    expect(passagensDoCiclo('encerrado')).toEqual(['aberto']);
    expect(passagensDoCiclo('cancelado')).toEqual(['aberto']);
  });

  it('a correção mostra só os campos que mudaram, sem a versão', () => {
    const m = mudancasDaCorrecao(
      {
        id: 1,
        operacao: 'ciclo.alterado',
        registro: 3,
        antes: { nome: 'Ciclo 2026', prazo: '2026-12-01', versao: 0 },
        depois: { nome: 'Ciclo 2026', prazo: '2026-12-15', versao: 1 },
        motivo: 'Prazo prorrogado pela diretoria',
        por: 'RH',
        em: '2026-11-18T10:00:00',
      },
      (v) => String(v),
    );
    expect(m).toEqual([{ campo: 'prazo', antes: '2026-12-01', depois: '2026-12-15' }]);
  });

  it('a tela tem rota com a permissão de leitura e os textos não citam tabela', () => {
    const r = rotasPessoas.find((x) => x.name === 'pessoas.avaliacoes');
    expect(r?.meta?.permissao).toBe('pessoas.avaliacao.ler');
    expect(JSON.stringify(mensagensAvaliacao)).not.toMatch(/SGH_|TB[A-Z]{3,}/);
  });

  it('"Minhas avaliações" abre para toda pessoa (ciência) e a observação em branco vai como null', () => {
    const r = rotasPessoas.find((x) => x.name === 'pessoas.avaliacoes.minhas');
    expect(r?.path).toBe('/pessoas/avaliacoes/minhas');
    expect(r?.meta?.permissao).toBe('pessoas.avaliacao.ciencia');
    expect(textoOuNulo('   ')).toBeNull();
    expect(textoOuNulo('  discordo da nota de pontualidade ')).toBe('discordo da nota de pontualidade');
  });

  it('as notas vão de 1 à nota máxima do ciclo, com o vazio "sem nota"', () => {
    expect(opcoesNota(3, 'Sem nota').map((o) => o.valor)).toEqual(['', '1', '2', '3']);
  });

  it('as notas lidas viram o formulário e voltam como o corpo da gravação', () => {
    const lidas = [
      { competencia: 1, nome: 'Comunicação', nota: 4, comentario: null },
      { competencia: 2, nome: 'Técnica', nota: null, comentario: 'rever' },
    ];
    const ls = linhasDasNotas(lidas);
    expect(semNota(ls)).toBe(1);
    expect(notasMudaram(ls, '', lidas, null)).toBe(false);
    ls[1]!.nota = '5';
    ls[0]!.comentario = '  ';
    expect(semNota(ls)).toBe(0);
    expect(notasMudaram(ls, '', lidas, null)).toBe(true);
    expect(notasParaGravar(ls)).toEqual([
      { competencia: 1, nota: 4, comentario: null },
      { competencia: 2, nota: 5, comentario: 'rever' },
    ]);
    expect(notasMudaram(linhasDasNotas(lidas), 'Bom ano', lidas, null)).toBe(true);
  });

  it('só o ciclo de experiência pede o marco de 45 ou 90 dias', () => {
    expect(marcosDoCiclo('experiencia')).toEqual([45, 90]);
    expect(marcosDoCiclo('periodico')).toEqual([]);
  });

  it('o formulário do PDI vira a entrada do contrato e a conclusão sugere a data do curso', () => {
    const p: PdiResposta = {
      id: 7,
      vinculo: 3,
      avaliacao: null,
      competencia: 2,
      competenciaNome: 'Comunicação',
      curso: 5,
      cursoTitulo: 'NR-32',
      cursoConcluidoEm: '2026-11-10',
      acao: 'Fazer o curso de NR-32',
      prazo: '2026-12-31',
      situacao: 'aberta',
      concluidaEm: null,
      motivoSituacao: null,
      versao: 1,
      alteradoPor: 'RH',
      alteradoEm: '2026-11-01T10:00:00',
    };
    expect(esquemaIncluirPdi.safeParse({ ...dadosDoPdi(formPdiVazio()), vinculo: 3 }).success).toBe(false);
    const f = formDoPdi(p);
    f.acao = '  Fazer o curso de NR-32 e multiplicar  ';
    expect(
      esquemaAlterarPdi.safeParse({
        ...dadosDoPdi(f),
        pdi: 7,
        versao: 1,
        motivo: 'Ajuste do combinado na devolutiva',
      }).data?.acao,
    ).toBe('Fazer o curso de NR-32 e multiplicar');
    expect(conclusaoSugerida(p, '2026-11-18')).toBe('2026-11-10');
    expect(conclusaoSugerida({ ...p, cursoConcluidoEm: null }, '2026-11-18')).toBe('2026-11-18');
    expect(pdiAtrasado(p, '2027-01-02')).toBe(true);
    expect(pdiAtrasado({ ...p, situacao: 'concluida' }, '2027-01-02')).toBe(false);
  });
});
