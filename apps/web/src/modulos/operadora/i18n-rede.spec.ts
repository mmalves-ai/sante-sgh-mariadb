// M56 (etapa 4, F3): os textos da rede credenciada cobrem todo código das regras puras (problemas do credenciamento e do
// descredenciamento, avisos), os campos do RPS e os meses, e não citam o sistema anterior nem nome de tabela.
import { CAMPOS_RPS, MENSAGENS_REDE } from '@sgh/contratos';
import type {
  CodigoAvisoDescredenciamento,
  CodigoProblemaDescredenciamento,
  CodigoProblemaPrestador,
} from '@sgh/dominio-operadora';
import { describe, expect, it } from 'vitest';
import { mensagensRedeOperadora as m } from './i18n-rede';

// Conferência de tipo: todo código das regras tem texto (falta um, o tsc recusa).
const codigos: Record<
  CodigoProblemaPrestador | CodigoProblemaDescredenciamento | CodigoAvisoDescredenciamento,
  true
> = {
  'documento-invalido': true,
  'pessoa-incompativel-com-tipo': true,
  'cnes-obrigatorio': true,
  'cnes-invalido': true,
  'municipio-fora-da-uf': true,
  'dominio-invalido': true,
  'intermediaria-obrigatoria': true,
  'intermediaria-invalida': true,
  'intermediaria-so-na-indireta': true,
  'contrato-fim-antes-do-inicio': true,
  'hospital-sem-estabelecimento': true,
  'estabelecimento-so-do-hospital': true,
  'hospital-pessoa-juridica': true,
  'estabelecimento-fora-da-rede': true,
  'ja-descredenciado': true,
  'saida-ja-agendada': true,
  'efetivo-no-passado': true,
  'aviso-no-futuro': true,
  'prazo-do-aviso': true,
  'substituto-obrigatorio': true,
  'substituto-ele-mesmo': true,
  'substituto-inexistente': true,
  'substituto-descredenciado': true,
  'substituto-com-saida-agendada': true,
  'substituto-nao-hospitalar': true,
  'substituto-outra-uf': true,
  'substituto-outro-municipio': true,
  'reducao-autorizada': true,
};

describe('textos da rede credenciada', () => {
  it('cobrem os códigos das regras, os campos do RPS e os 12 meses', () => {
    for (const c of Object.keys(codigos)) expect(MENSAGENS_REDE[c], c).toBeTruthy();
    for (const c of ['so-credenciado', 'so-descredenciado']) expect(MENSAGENS_REDE[c], c).toBeTruthy();
    for (const c of CAMPOS_RPS) expect(m.movimentos.camposRps[c], c).toBeTruthy();
    expect(Object.keys(m.meses)).toHaveLength(12);
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = [...valores(m), ...Object.values(MENSAGENS_REDE)].join('\n');
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)[A-Z_]{4,}\b/i);
  });
});
