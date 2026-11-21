// M56 (etapa F0): os textos da operadora cobrem todo código das regras puras (situação da chave, problemas do produto
// e do envio, recusa da mensagem) e não citam o sistema anterior.
import type {
  DecisaoMensagem,
  ProblemaEnvio,
  ProblemaProduto,
  SituacaoChaveOperadora,
} from '@sgh/dominio-operadora';
import type { MotivoInelegibilidade, TipoCarencia } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensOperadora as m } from './i18n';

// Conferência de tipo: todo código das regras tem texto (falta um, o tsc recusa).
const situacoes: Record<SituacaoChaveOperadora, string> = m.situacoesChave;
const produto: Record<ProblemaProduto, string> = m.problemasProduto;
const envio: Record<ProblemaEnvio, string> = m.problemasEnvio;
const mensagem: Record<Extract<DecisaoMensagem, { enviar: false }>['motivo'], string> = m.mensagemRecusada;
// M56.2: os motivos da elegibilidade e as carências.
const motivos: Record<MotivoInelegibilidade, string> = m.f1.motivos;
const carencias: Record<TipoCarencia, string> = m.f1.carencias;

describe('textos da operadora', () => {
  it('cobrem os códigos das regras puras', () => {
    expect(Object.keys(situacoes)).toHaveLength(3);
    expect(Object.keys(produto)).toHaveLength(3);
    expect(Object.keys(envio)).toHaveLength(5);
    expect(Object.keys(mensagem)).toHaveLength(3);
    expect(Object.keys(motivos)).toHaveLength(9);
    expect(Object.keys(carencias)).toHaveLength(4);
    for (const t of Object.values(m.telas)) expect(t.titulo.length).toBeGreaterThan(3);
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = valores(m).join('\n');
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF)[A-Z_]{4,}\b/i);
  });
});
