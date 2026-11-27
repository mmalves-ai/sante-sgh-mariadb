// C2-017 (09-AREA linha 81): adesão à ata de registro de preços por órgão não participante (Lei 14.133, art. 86).
import { describe, expect, it } from 'vitest';
import {
  type AdesaoParaConferir,
  conferirAdesao,
  conferirDecisaoAdesao,
  type DecisaoAdesaoParaConferir,
  limitesAdesao,
  quantidadeOcupada,
} from '../index.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);
const adesao = (x: Partial<AdesaoParaConferir> = {}): AdesaoParaConferir => ({
  numero: 'AD-1',
  tipo: 'carona',
  hoje: '2026-11-26',
  dataSolicitacao: '2026-11-20',
  quantidadeSolicitada: 40,
  valorUnitario: 2.5,
  justificativa: 'Preço registrado abaixo da pesquisa de mercado do hospital.',
  ataPropria: null,
  orgaoGerenciador: 'Secretaria Estadual de Saúde',
  quantidades: { registrada: 100, jaDoOrgao: 0, jaTotal: 0 },
  ...x,
});
const decisao = (x: Partial<DecisaoAdesaoParaConferir> = {}): DecisaoAdesaoParaConferir => ({
  situacao: 'solicitada',
  tipo: 'carona',
  decisao: 'autorizar',
  quantidadeSolicitada: 40,
  quantidadeAderida: 40,
  numeroOficio: 'OF-12/2026',
  aceiteGerenciador: true,
  aceiteFornecedor: true,
  documentacaoConferida: true,
  motivo: null,
  quantidades: { registrada: 100, jaDoOrgao: 0, jaTotal: 0 },
  ...x,
});

describe('adesão à ata (Lei 14.133, art. 86)', () => {
  it('limites: 50% por órgão e o dobro no total', () => {
    expect(limitesAdesao(100)).toEqual({ porOrgao: 50, total: 200 });
  });
  it('carona dentro dos limites passa', () => {
    expect(conferirAdesao(adesao())).toEqual([]);
  });
  it('por órgão: soma das adesões do mesmo órgão acima de 50% é recusada (§ 4º)', () => {
    expect(
      codigos(conferirAdesao(adesao({ quantidades: { registrada: 100, jaDoOrgao: 20, jaTotal: 20 } }))),
    ).toEqual(['adesao-acima-do-limite-do-orgao']);
  });
  it('no total: acima do dobro do registrado é recusada (§ 5º)', () => {
    expect(
      codigos(conferirAdesao(adesao({ quantidades: { registrada: 100, jaDoOrgao: 0, jaTotal: 180 } }))),
    ).toEqual(['adesao-acima-do-limite-total']);
  });
  it('carona sem justificativa, sem gerenciador e sem registrada é recusada', () => {
    expect(
      codigos(
        conferirAdesao(
          adesao({
            justificativa: 'curta',
            orgaoGerenciador: null,
            quantidades: { registrada: null, jaDoOrgao: 0, jaTotal: 0 },
          }),
        ),
      ),
    ).toEqual(['adesao-sem-gerenciador', 'adesao-sem-justificativa', 'adesao-sem-registrada']);
  });
  it('ata própria: vigente, dentro da vigência e preço não acima do registrado', () => {
    const ataPropria = {
      situacao: 'vigente',
      vigenciaInicio: '2026-01-02',
      vigenciaFim: '2027-01-01',
      valorRegistrado: 2,
    };
    expect(codigos(conferirAdesao(adesao({ ataPropria, orgaoGerenciador: null })))).toEqual([
      'adesao-preco-acima-do-registrado',
    ]);
    expect(
      codigos(
        conferirAdesao(adesao({ ataPropria: { ...ataPropria, situacao: 'encerrada' }, valorUnitario: 2 })),
      ),
    ).toEqual(['ata-nao-vigente']);
  });
  it('participante pede até o saldo registrado, sem o limite de 50%', () => {
    expect(
      conferirAdesao(adesao({ tipo: 'participante', quantidadeSolicitada: 90, justificativa: null })),
    ).toEqual([]);
    expect(codigos(conferirAdesao(adesao({ tipo: 'participante', quantidadeSolicitada: 101 })))).toEqual([
      'adesao-acima-do-registrado',
    ]);
  });
  it('data futura e quantidade zero são recusadas', () => {
    expect(
      codigos(conferirAdesao(adesao({ dataSolicitacao: '2026-12-01', quantidadeSolicitada: 0 }))),
    ).toEqual(['adesao-data-futura', 'adesao-quantidade-invalida']);
  });
  it('a ocupação conta a aderida da autorizada e ignora a negada', () => {
    expect(quantidadeOcupada({ situacao: 'autorizada', solicitada: 40, aderida: 30 })).toBe(30);
    expect(quantidadeOcupada({ situacao: 'solicitada', solicitada: 40, aderida: null })).toBe(40);
    expect(quantidadeOcupada({ situacao: 'negada', solicitada: 40, aderida: null })).toBe(0);
  });
});

describe('decisão da adesão', () => {
  it('autoriza com os dois aceites, documentação e quantidade dentro do limite', () => {
    expect(conferirDecisaoAdesao(decisao())).toEqual([]);
  });
  it('sem aceite do gerenciador, do fornecedor e sem documentação é recusada', () => {
    expect(
      codigos(
        conferirDecisaoAdesao(
          decisao({ aceiteGerenciador: false, aceiteFornecedor: false, documentacaoConferida: false }),
        ),
      ),
    ).toEqual([
      'adesao-sem-aceite-gerenciador',
      'adesao-sem-aceite-fornecedor',
      'adesao-documentacao-pendente',
    ]);
  });
  it('aderida acima da solicitada ou do limite do órgão é recusada', () => {
    expect(codigos(conferirDecisaoAdesao(decisao({ quantidadeAderida: 41 })))).toEqual([
      'adesao-aderida-invalida',
    ]);
    expect(
      codigos(
        conferirDecisaoAdesao(decisao({ quantidades: { registrada: 100, jaDoOrgao: 15, jaTotal: 15 } })),
      ),
    ).toEqual(['adesao-acima-do-limite-do-orgao']);
  });
  it('negar exige motivo; decidida não se decide de novo', () => {
    expect(codigos(conferirDecisaoAdesao(decisao({ decisao: 'negar', motivo: 'curto' })))).toEqual([
      'adesao-sem-motivo',
    ]);
    expect(
      conferirDecisaoAdesao(decisao({ decisao: 'negar', motivo: 'Fornecedor recusou o fornecimento.' })),
    ).toEqual([]);
    expect(codigos(conferirDecisaoAdesao(decisao({ situacao: 'autorizada' })))).toEqual([
      'adesao-ja-decidida',
    ]);
  });
});
