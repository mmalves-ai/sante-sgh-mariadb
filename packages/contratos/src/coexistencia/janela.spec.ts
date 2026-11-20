import { describe, expect, it } from 'vitest';
import {
  caminhoRelatorioJanela,
  esquemaRelatorioJanela,
  esquemaVerificacaoJanela,
  ETAPAS_ROTEIRO_JANELA,
  FASES_ROTEIRO_JANELA,
} from './janela.js';

const H = 'a'.repeat(64);
const verificacao = () => ({
  passo: 'firebird5',
  ambiente: 'ensaio',
  em: '2026-10-29T12:00:00.000Z',
  papel: 'coordenacao',
  plataforma: { versaoMotor: 'LI-V5.0.3', charsetBanco: 'NONE', charsetParametro: 'CP1252' },
  schema: { esperada: '0123456789abcdef', obtida: '0123456789abcdef', diferencas: 0 },
  contagens: { tabelas: 10, iguais: 10, diferentes: [], ausentes: [], hashAntes: H, hashDepois: H },
  saude: { conectou: true, latenciaMs: 12, codecConfere: true },
  operacoes: { total: 3, verdes: 3, falhas: [] },
});

describe('contrato da janela (M58-F5)', () => {
  it('ids estáveis e sem repetição', () => {
    expect(new Set(ETAPAS_ROTEIRO_JANELA).size).toBe(ETAPAS_ROTEIRO_JANELA.length);
    expect(FASES_ROTEIRO_JANELA.at(-1)).toBe('volta-atras');
    expect(caminhoRelatorioJanela('pc')).toBe('docs/marcos/M58/pc/janela.json');
  });

  it('aceita a verificação completa e preenche os padrões', () => {
    const v = esquemaVerificacaoJanela.parse(verificacao());
    expect(v.inicio).toBeNull();
    expect(v.observacao).toBeNull();
    expect(
      esquemaRelatorioJanela.parse({ formato: 1, estabelecimento: 'pc', verificacoes: [v] }).verificacoes,
    ).toHaveLength(1);
  });

  it('recusa números incoerentes, dado pessoal e campo a mais', () => {
    const iguais = verificacao();
    iguais.contagens.iguais = 11;
    expect(esquemaVerificacaoJanela.safeParse(iguais).success).toBe(false);
    const ops = verificacao();
    ops.operacoes.verdes = 4;
    expect(esquemaVerificacaoJanela.safeParse(ops).success).toBe(false);
    expect(
      esquemaVerificacaoJanela.safeParse({ ...verificacao(), observacao: 'ligar para fulano@x.com' }).success,
    ).toBe(false);
    expect(esquemaVerificacaoJanela.safeParse({ ...verificacao(), senha: 'x' }).success).toBe(false);
    expect(
      esquemaVerificacaoJanela.safeParse({
        ...verificacao(),
        inicio: '2026-10-29T12:00:00.000Z',
        fim: '2026-10-29T11:00:00.000Z',
      }).success,
    ).toBe(false);
    const nome = verificacao();
    (nome.contagens.diferentes as string[]).push('tabela minúscula');
    expect(esquemaVerificacaoJanela.safeParse(nome).success).toBe(false);
  });
});
