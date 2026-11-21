// Regras puras da conta do paciente sobre o modelo próprio (regras-conta.ts): situação na tela, filtro, fechamento,
// reabertura, etapas, grupo do item e valor do item. Sem banco.
import { describe, expect, it } from 'vitest';
import { versaoNumero, versaoTexto } from './esquemas.js';
import {
  competenciaDe,
  competenciaFechada,
  conferirCompetenciaDaConta,
  conferirConferenciaItens,
  conferirRecebimentoDaConta,
  conferirRegistroPendencia,
  ESPECIE_DA_FORMA,
  formaDaEspecie,
  pendenciaBloqueiaFechamento,
  conferirFechamentoConta,
  conferirLancamento,
  conferirReaberturaConta,
  filtroDaSituacao,
  marcaDeFechamento,
  naturezasDoTipoConta,
  situacaoNaTela,
  tipoContaDaNatureza,
  tipoDaTela,
  tiposDoGrupo,
  transicaoDaEtapa,
  valorDoItem,
} from './regras-conta.js';

describe('regras da conta (modelo próprio)', () => {
  it('situação na tela e marca de fechamento pela situação do modelo', () => {
    expect(situacaoNaTela('aberta', false)).toBe('aberta');
    expect(situacaoNaTela('em_auditoria', false)).toBe('em-auditoria');
    expect(situacaoNaTela('fechada', false)).toBe('fechada');
    expect(situacaoNaTela('fechada', true)).toBe('em-lote');
    expect(situacaoNaTela('enviada', false)).toBe('apresentada');
    expect(situacaoNaTela('qualquer', false)).toBe('erro-de-dado');
    expect(['aberta', 'fechada', 'enviada', 'cancelada'].map(marcaDeFechamento)).toEqual(['N', 'S', 'A', 'C']);
  });

  it('filtro da lista: em lote exige o lote; emitida e erro de dado não existem no modelo', () => {
    expect(filtroDaSituacao('em-lote')).toEqual({ situacoes: ['fechada', 'faturada'], emLote: true });
    expect(filtroDaSituacao('fechada')).toEqual({ situacoes: ['fechada'], emLote: false });
    expect(filtroDaSituacao('emitida')).toBeNull();
    expect(filtroDaSituacao('erro-de-dado')).toBeNull();
  });

  it('fechamento: sem itens, com pendência que bloqueia ou em auditoria que bloqueia é recusado', () => {
    const base = { situacao: 'aberta', itens: 1, pendenciasBloqueantes: 0, auditoriaBloqueante: false };
    expect(conferirFechamentoConta(base)).toBeNull();
    expect(conferirFechamentoConta({ ...base, itens: 0 })?.codigo).toBe('conta-sem-itens');
    expect(conferirFechamentoConta({ ...base, pendenciasBloqueantes: 2 })?.codigo).toBe('pendencia-bloqueante');
    expect(conferirFechamentoConta({ ...base, auditoriaBloqueante: true })?.codigo).toBe('auditoria-em-andamento');
    expect(conferirFechamentoConta({ ...base, situacao: 'fechada' })?.codigo).toBe('conta-ja-fechada');
    expect(conferirFechamentoConta({ ...base, situacao: 'paga' })?.codigo).toBe('conta-apresentada');
  });

  it('reabertura: só a fechada fora de lote, com motivo', () => {
    const base = { situacao: 'fechada', emLote: false, motivo: 'Correção do item' };
    expect(conferirReaberturaConta(base)).toBeNull();
    expect(conferirReaberturaConta({ ...base, emLote: true })?.codigo).toBe('em-lote');
    expect(conferirReaberturaConta({ ...base, situacao: 'faturada' })?.codigo).toBe('em-lote');
    expect(conferirReaberturaConta({ ...base, situacao: 'enviada' })?.codigo).toBe('conta-apresentada');
    expect(conferirReaberturaConta({ ...base, situacao: 'aberta' })?.codigo).toBe('conta-ja-aberta');
    expect(conferirReaberturaConta({ ...base, motivo: 'x' })?.codigo).toBe('motivo-obrigatorio');
  });

  it('etapas, lançamento e conferência valem só na conta em produção', () => {
    expect(transicaoDaEtapa('aberta', 'auditoria', 'iniciar')).toEqual({ nova: 'em_auditoria' });
    expect(transicaoDaEtapa('em_auditoria', 'auditoria', 'concluir')).toEqual({ nova: 'aberta' });
    expect(transicaoDaEtapa('em_conferencia', 'auditoria', 'iniciar')).toMatchObject({ codigo: 'conta-nao-aberta' });
    expect(transicaoDaEtapa('aberta', 'conferencia', 'concluir')).toMatchObject({ codigo: 'etapa-nao-iniciada' });
    expect(conferirLancamento('em_conferencia')).toBeNull();
    expect(conferirLancamento('fechada')?.codigo).toBe('conta-fechada');
    expect(conferirConferenciaItens('enviada')?.codigo).toBe('conta-fechada');
  });

  it('grupo do item, tipo da conta, valor, competência e versão da tela', () => {
    expect(['taxa', 'honorario', 'procedimento', 'medicamento'].map(tipoDaTela)).toEqual([1, 2, 3, 4]);
    for (const t of [1, 2, 3, 4] as const) for (const x of tiposDoGrupo(t)) expect(tipoDaTela(x)).toBe(t);
    expect(tipoContaDaNatureza('internacao')).toBe('I');
    expect(tipoContaDaNatureza('pronto_atendimento')).toBe('E');
    expect(naturezasDoTipoConta('I')).toEqual(['internacao']);
    expect(valorDoItem(33.33, 3)).toBe(99.99);
    expect(valorDoItem(100, 2, 50)).toBe(100);
    expect(competenciaDe('2026-11-21')).toBe('2026-11-01');
    expect(versaoNumero(versaoTexto(7))).toBe(7);
    expect(versaoTexto(7)).toHaveLength(10);
    expect(versaoNumero('2026-01-01T00:00:00Z')).toBeNull();
  });

  it('competência: o fechamento da fonte decide quando existe; sem ele, a competência geral', () => {
    expect(competenciaFechada(null, null)).toBe(false);
    expect(competenciaFechada(null, 'fechada')).toBe(true);
    expect(competenciaFechada('reaberta', 'fechada')).toBe(false);
    expect(competenciaFechada('fechada', 'aberta')).toBe(true);
    expect(conferirCompetenciaDaConta('fechada', null)?.codigo).toBe('competencia-fechada');
    expect(conferirCompetenciaDaConta('aberta', null)).toBeNull();
  });

  it('pendência: o tipo define o bloqueio, a tela só endurece; conta encerrada recusa', () => {
    expect(pendenciaBloqueiaFechamento('impede_fechamento', false)).toBe(true);
    expect(pendenciaBloqueiaFechamento('alerta', false)).toBe(false);
    expect(pendenciaBloqueiaFechamento('impede_envio', true)).toBe(true);
    expect(conferirRegistroPendencia('fechada')).toBeNull();
    expect(conferirRegistroPendencia('enviada')?.codigo).toBe('conta-encerrada');
    expect(conferirRegistroPendencia('cancelada')?.codigo).toBe('conta-encerrada');
  });

  it('particular pelo tipo da fonte e forma da tela ↔ espécie do caixa', () => {
    expect(conferirRecebimentoDaConta(true)).toBeNull();
    expect(conferirRecebimentoDaConta(false)?.codigo).toBe('conta-nao-particular');
    expect(ESPECIE_DA_FORMA['cartao-credito']).toBe('cartao_credito');
    for (const [forma, especie] of Object.entries(ESPECIE_DA_FORMA)) expect(formaDaEspecie(especie)).toBe(forma);
    expect(formaDaEspecie('cheque')).toBe('outras');
  });
});
